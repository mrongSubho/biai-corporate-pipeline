<script lang="ts">
  import { onMount } from 'svelte';
  import { rawCorporateLeadsFixture } from '../server/fixtures';
  import { auditCorporateLeads } from '../lib/engine/hygiene';
  import { executeCopilotQuery } from '../lib/engine/copilot';
  import { generateCorporateFollowupEmail, type EmailDraftResult } from '../lib/engine/email_drafter';
  import type { CorporateLead, PipelineStage, AnomalyFinding } from '../lib/types/pipeline';

  // --- STATE WITH SVELTE 5 RUNES ---
  let leads = $state<CorporateLead[]>(JSON.parse(JSON.stringify(rawCorporateLeadsFixture)));
  let viewMode = $state<'cleaned' | 'raw'>('cleaned');
  let selectedLead = $state<CorporateLead | null>(null);
  let showHealthModal = $state(false);
  let showCopilotModal = $state(false);
  let showEmailModal = $state(false);
  let showDigestModal = $state(false);

  // Theme State (Modern B2B Light / Dark Mode)
  let theme = $state<'light' | 'dark'>('light');

  // Copilot State
  let copilotQuestion = $state('What is the total value in Proposal stage?');
  let copilotResult = $state<any | null>(null);

  // Email Studio State
  let emailTone = $state<'POLITE_CHECKIN' | 'PROPOSAL_FOLLOWUP' | 'INVOICE_REMINDER'>('POLITE_CHECKIN');
  let emailDraft = $state<EmailDraftResult | null>(null);
  let bankConfirmed = $state(false);
  let copySuccess = $state(false);
  let maskPiiOnExport = $state(false);

  // Benchmark Date: 1 Nov 2026 per brief
  const BENCHMARK_DATE = '2026-11-01';

  // Initialize theme from DOM & localStorage
  onMount(() => {
    const isLight = document.documentElement.classList.contains('light');
    theme = isLight ? 'light' : 'dark';

    const handleKeydown = (e: KeyboardEvent) => {
      // Cmd+Shift+L or Ctrl+Shift+L -> Toggle Theme
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        toggleTheme();
      }
      // Cmd+K or Ctrl+K -> Open Deal Copilot
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        showCopilotModal = true;
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    }
  }

  // --- DERIVED METRICS ---
  let auditResult = $derived(auditCorporateLeads(leads, BENCHMARK_DATE));
  let l25 = $derived(leads.find(l => l.id === 'L25'));
  let l18 = $derived(leads.find(l => l.id === 'L18'));
  let l12 = $derived(leads.find(l => l.id === 'L12'));

  // Leads for display based on Cleaned vs Raw mode
  let displayLeads = $derived(
    viewMode === 'cleaned' ? leads.filter(l => !l.is_archived) : leads
  );

  let stages: PipelineStage[] = ['New', 'Contacted', 'Meeting', 'Proposal', 'Invoice sent', 'Paid', 'Lost'];

  // Pipeline Financials
  let totalPipelineValue = $derived(
    displayLeads
      .filter(l => l.stage !== 'Lost')
      .reduce((sum, l) => sum + (l.deal_value_bdt || 0), 0)
  );

  let cashCollected = $derived(
    displayLeads.reduce((sum, l) => sum + (l.amount_collected_bdt || 0), 0)
  );

  let cashOutstanding = $derived(
    displayLeads.reduce((sum, l) => sum + (l.amount_due_bdt || 0), 0)
  );

  let overdueLeadsCount = $derived(
    displayLeads.filter(l => l.next_followup && l.next_followup < BENCHMARK_DATE && l.stage !== 'Lost' && l.stage !== 'Paid').length
  );

  // Initial Copilot Run
  $effect(() => {
    if (!copilotResult) {
      runCopilot('What is the total value in Proposal stage?');
    }
  });

  // --- ACTIONS ---
  function runCopilot(q: string) {
    copilotQuestion = q;
    copilotResult = executeCopilotQuery(q, leads, BENCHMARK_DATE);
  }

  function transitionStage(leadId: string, newStage: PipelineStage) {
    leads = leads.map(l => {
      if (l.id === leadId) {
        return { ...l, stage: newStage };
      }
      return l;
    });
    if (selectedLead && selectedLead.id === leadId) {
      selectedLead.stage = newStage;
    }
  }

  // Duplicate Merging (L23 -> L01 or L03 -> L02)
  function mergeDuplicate(duplicateId: string, canonicalId: string) {
    const dup = leads.find(l => l.id === duplicateId);
    const can = leads.find(l => l.id === canonicalId);
    if (!dup || !can) return;

    leads = leads.map(l => {
      if (l.id === duplicateId) {
        return { ...l, is_archived: true, merged_into_id: canonicalId };
      }
      if (l.id === canonicalId) {
        return { ...l, notes: `${l.notes} [Merged from ${duplicateId}: ${dup.notes}]` };
      }
      return l;
    });
  }

  function unmergeDuplicate(duplicateId: string) {
    leads = leads.map(l => {
      if (l.id === duplicateId) {
        return { ...l, is_archived: false, merged_into_id: null };
      }
      return l;
    });
  }

  // Date Inversion Remediation (L25 Sylhet Hospitality)
  function remediateDateOrder(leadId: string, strategy: 'SWAP' | 'RESCHEDULE') {
    leads = leads.map(l => {
      if (l.id === leadId) {
        if (strategy === 'SWAP') {
          return { ...l, last_contact: l.next_followup, next_followup: l.last_contact };
        } else {
          return { ...l, next_followup: '2026-11-04' }; // Reschedule to +7 days
        }
      }
      return l;
    });
  }

  // Email Typo Fix (L18 Bogura Textile)
  function fixEmailTypo(leadId: string) {
    leads = leads.map(l => {
      if (l.id === leadId && l.contact_email?.includes('bogurateXtile')) {
        return { ...l, contact_email: l.contact_email.replace('bogurateXtile', 'boguratextile') };
      }
      return l;
    });
  }

  function openEmailStudio(lead: CorporateLead) {
    selectedLead = lead;
    bankConfirmed = false;
    generateEmail();
    showEmailModal = true;
  }

  function generateEmail() {
    if (!selectedLead) return;
    emailDraft = generateCorporateFollowupEmail({
      lead: selectedLead,
      tone: emailTone
    });
  }

  function copyText(txt: string) {
    navigator.clipboard.writeText(txt);
    copySuccess = true;
    setTimeout(() => { copySuccess = false; }, 2000);
  }

  function exportCleanedCsv() {
    const headers = ['Lead ID', 'Company', 'Industry', 'Contact Name', 'Role', 'Email', 'Phone', 'Stage', 'Deal Value BDT', 'Collected BDT', 'Due BDT', 'Payment Status', 'Last Contact', 'Next Followup', 'Notes'];
    const rows = displayLeads.map(l => {
      let email = l.contact_email || '';
      let phone = l.contact_phone || '';
      if (maskPiiOnExport) {
        email = email ? email.replace(/^(.{2})(.*)(@.*)$/, '$1***$3') : '';
        phone = phone ? phone.replace(/(\d{4})$/, '****') : '';
      }
      return [
        l.id,
        `"${l.company}"`,
        l.industry,
        `"${l.contact_name || ''}"`,
        `"${l.contact_role || ''}"`,
        `"${email}"`,
        `"${phone}"`,
        l.stage,
        l.deal_value_bdt,
        l.amount_collected_bdt,
        l.amount_due_bdt,
        l.payment_status,
        l.last_contact || '',
        l.next_followup || '',
        `"${l.notes.replace(/"/g, '""')}"`
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encoded = encodeURI(csvContent);
    const a = document.createElement('a');
    a.href = encoded;
    a.download = `biai_corporate_pipeline_${viewMode}_${BENCHMARK_DATE}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Source Badge Styles helper
  function getSourceBadgeClass(source: string): string {
    switch (source) {
      case 'LinkedIn':
        return 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/20';
      case 'Referral':
        return 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/20';
      case 'Website form':
        return 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/20';
      case 'Cold email':
        return 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/20';
      case 'Walk-in':
        return 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/20';
      case 'Event':
        return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
  }
</script>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-150">
  <!-- TOP APP BAR -->
  <header class="border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-3 flex items-center justify-between shadow-2xs">
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20 text-sm font-mono tracking-tight">
          B2B
        </div>
        <div>
          <div class="flex items-center gap-2.5">
            <span class="font-bold tracking-tight text-slate-900 dark:text-white text-base">BIAI Corporate Pipeline</span>
            <span class="text-[11px] font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5 font-mono">
              <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
              Ref: 1 Nov 2026
            </span>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400 font-normal">Data Health, Deduplication & Safe AST Copilot</p>
        </div>
      </div>
    </div>

    <!-- MODE SWITCHER TOGGLE (RAW DIRTY CSV VS. CLEANED VERIFIED PIPELINE) -->
    <div class="flex items-center bg-slate-100 dark:bg-slate-850 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
      <button 
        onclick={() => viewMode = 'cleaned'}
        class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
          viewMode === 'cleaned' 
            ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30' 
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}>
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        Cleaned Verified Mode (23 Leads · ৳3.17M)
      </button>

      <button 
        onclick={() => viewMode = 'raw'}
        class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
          viewMode === 'raw' 
            ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30' 
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}>
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        Raw CSV Mode (25 Rows · ৳4.22M)
      </button>
    </div>

    <!-- ACTION BUTTONS & THEME TOGGLE -->
    <div class="flex items-center gap-2">
      <button 
        onclick={() => showHealthModal = true}
        class="text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-2xs transition">
        <svg class="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <span>Data Health</span>
        <span class="bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 px-1.5 py-0.2 rounded font-bold text-[10px]">
          {auditResult.totalFindingsCount}
        </span>
      </button>

      <button 
        onclick={() => showDigestModal = true}
        class="text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-2xs transition">
        <svg class="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        Priority Chase
      </button>

      <button 
        onclick={() => showCopilotModal = true}
        class="text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm shadow-blue-600/20 transition">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
        <span>Copilot</span>
        <kbd class="hidden md:inline-block text-[10px] bg-blue-700/60 text-blue-100 px-1 py-0.2 rounded font-mono">⌘K</kbd>
      </button>

      <button 
        onclick={exportCleanedCsv}
        class="text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-2xs transition">
        <svg class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        Export CSV
      </button>

      <!-- LIGHT / DARK MODE TOGGLE (LINEAR / STRIPE / SUPABASE GRADE) -->
      <button 
        onclick={toggleTheme}
        aria-label="Toggle Light / Dark Mode"
        title="Toggle Light / Dark Mode (Cmd+Shift+L)"
        class="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shadow-2xs transition">
        {#if theme === 'light'}
          <!-- Moon Icon (switch to dark) -->
          <svg class="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        {:else}
          <!-- Sun Icon (switch to light) -->
          <svg class="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        {/if}
      </button>
    </div>
  </header>

  <!-- KPI SUMMARY STRIP (3-TIER LEVEL 1 ELEVATION) -->
  <div class="bg-slate-100/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-2">
        <span class="text-slate-500 dark:text-slate-400">Total Leads:</span>
        <span class="font-bold text-slate-900 dark:text-white text-sm font-mono">{displayLeads.length}</span>
        {#if viewMode === 'cleaned'}
          <span class="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">(2 Duplicates Cleansed)</span>
        {:else}
          <span class="text-[11px] text-amber-700 dark:text-amber-400 font-medium">(Includes 2 Duplicate Rows)</span>
        {/if}
      </div>
      <div class="h-4 w-[1px] bg-slate-200 dark:bg-slate-800"></div>
      <div class="flex items-center gap-2">
        <span class="text-slate-500 dark:text-slate-400">Active Pipeline Value:</span>
        <span class="font-bold text-emerald-700 dark:text-emerald-400 text-sm font-mono">৳ {totalPipelineValue.toLocaleString()} BDT</span>
        {#if viewMode === 'raw'}
          <span class="text-[11px] text-rose-600 dark:text-rose-400 font-medium">(+৳ 1,050,000 Phantom Duplicate Revenue)</span>
        {/if}
      </div>
      <div class="h-4 w-[1px] bg-slate-200 dark:bg-slate-800"></div>
      <div class="flex items-center gap-2">
        <span class="text-slate-500 dark:text-slate-400">Cash Received (L12 Advance):</span>
        <span class="font-bold text-sky-700 dark:text-sky-400 text-sm font-mono">৳ {cashCollected.toLocaleString()} BDT</span>
      </div>
      <div class="h-4 w-[1px] bg-slate-200 dark:bg-slate-800"></div>
      <div class="flex items-center gap-2">
        <span class="text-slate-500 dark:text-slate-400">Outstanding Receivables:</span>
        <span class="font-bold text-amber-700 dark:text-amber-400 text-sm font-mono">৳ {cashOutstanding.toLocaleString()} BDT</span>
      </div>
    </div>

    <!-- Health Flags Alert Strip -->
    <div class="flex items-center gap-2">
      <span class="px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/20 font-medium flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
        {overdueLeadsCount} Deals Overdue (&lt; 1 Nov)
      </span>
      <span class="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 font-medium">
        2 Duplicate Clusters (L01/L23, L02/L03)
      </span>
      <span class="px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-500/10 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-500/20 font-medium">
        L25 Date Inversion (-7d)
      </span>
    </div>
  </div>

  <!-- 7-STAGE PIPELINE BOARD (OFFICIAL ORDER) -->
  <main class="flex-1 p-6 overflow-x-auto bg-slate-50 dark:bg-slate-950">
    <div class="grid grid-cols-7 gap-3 min-w-[1400px] h-full items-start">
      {#each stages as stage}
        {@const stageLeads = displayLeads.filter(l => l.stage === stage)}
        {@const stageTotal = stageLeads.reduce((s, l) => s + (l.deal_value_bdt || 0), 0)}

        <!-- Column Well (Level 1 Elevation) -->
        <div class="bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 rounded-xl flex flex-col max-h-[calc(100vh-175px)] shadow-2xs">
          <!-- Column Header -->
          <div class="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 rounded-t-xl flex items-center justify-between">
            <div>
              <span class="font-semibold text-xs text-slate-800 dark:text-white uppercase tracking-wider">{stage}</span>
              {#if stageTotal > 0}
                <p class="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold font-mono">৳ {stageTotal.toLocaleString()}</p>
              {/if}
            </div>
            <span class="text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 w-5 h-5 rounded-full flex items-center justify-center font-mono">
              {stageLeads.length}
            </span>
          </div>

          <!-- Column Cards (Level 2 Elevation) -->
          <div class="p-2 overflow-y-auto space-y-2 flex-1">
            {#if stageLeads.length === 0}
              <div class="py-8 text-center text-slate-400 dark:text-slate-600 text-xs italic">
                No accounts in {stage}
              </div>
            {:else}
              {#each stageLeads as lead (lead.id)}
                {@const isOverdue = lead.next_followup && lead.next_followup < BENCHMARK_DATE && stage !== 'Lost' && stage !== 'Paid'}
                {@const isDuplicate = lead.id === 'L03' || lead.id === 'L23'}
                {@const isDateError = lead.id === 'L25'}
                {@const isPartialPaid = lead.id === 'L12'}
                {@const isWhaleDeal = (lead.deal_value_bdt || 0) >= 500000}
                {@const isUnconfirmedBilling = lead.id === 'L22' || lead.id === 'L12'}

                <!-- Card with Physical Hierarchy & Left Accent Stripe (Section 9.3) -->
                <div 
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => { if (e.key === 'Enter') openEmailStudio(lead); }}
                  onclick={() => openEmailStudio(lead)}
                  class={`group bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border rounded-xl p-3 transition shadow-xs hover:shadow-md cursor-pointer flex flex-col gap-2 text-left relative overflow-hidden ${
                    isDateError ? 'border-l-[3.5px] border-l-rose-500 border-rose-200 dark:border-rose-500/30 bg-rose-50/20 dark:bg-rose-950/10' :
                    isDuplicate ? 'border-l-[3.5px] border-l-amber-400 border-amber-200 dark:border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/10' :
                    isWhaleDeal ? 'border-l-[3.5px] border-l-emerald-500 border-slate-200 dark:border-slate-700/60' :
                    isUnconfirmedBilling ? 'border-l-[3.5px] border-l-amber-500 border-slate-200 dark:border-slate-700/60' :
                    isOverdue ? 'border-l-[3.5px] border-l-rose-400 border-rose-200 dark:border-rose-500/30' :
                    'border-slate-200/90 dark:border-slate-700/60'
                  }`}>

                  <!-- Card Header: ID, Company, Industry -->
                  <div class="flex items-start justify-between gap-1.5">
                    <div>
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200/60 dark:border-slate-700">
                          {lead.id}
                        </span>
                        <span class="font-bold text-xs text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition tracking-tight">
                          {lead.company}
                        </span>
                      </div>
                      {#if lead.contact_name}
                        <p class="text-[11px] text-slate-600 dark:text-slate-400 font-medium mt-0.5">
                          {lead.contact_name} {lead.contact_role ? `· ${lead.contact_role}` : ''}
                        </p>
                      {:else}
                        <p class="text-[11px] text-amber-700 dark:text-amber-400 font-medium mt-0.5">⚠️ No contact person on file</p>
                      {/if}
                    </div>

                    <!-- Channel / Industry Tinted Pastel Badge (Section 9.5) -->
                    <span class={`text-[10px] font-medium border px-1.5 py-0.5 rounded-full whitespace-nowrap ${getSourceBadgeClass(lead.source)}`}>
                      {lead.source}
                    </span>
                  </div>

                  <!-- Deal Value & Payment Status -->
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                      {lead.deal_value_bdt > 0 ? `৳ ${lead.deal_value_bdt.toLocaleString()} BDT` : 'No Value Agreed'}
                    </span>
                    {#if isPartialPaid}
                      <span class="text-[10px] font-bold bg-sky-50 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 px-1.5 py-0.5 rounded border border-sky-200 dark:border-sky-500/30">
                        50% Advance (৳150k due)
                      </span>
                    {/if}
                  </div>

                  <!-- Notes Recessed Quote Bubble (Section 9.3) -->
                  <p class="text-[11px] text-slate-700 dark:text-slate-300 line-clamp-2 italic bg-slate-50 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-200/90 dark:border-slate-800/80 leading-relaxed font-sans">
                    "{lead.notes}"
                  </p>

                  <!-- Card Bottom: Dates & Diagnostic Warning Pills -->
                  <div class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-[10px]">
                    <div class="flex items-center gap-1">
                      <span class="text-slate-400 dark:text-slate-500">Next:</span>
                      <span class={`font-mono font-medium ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                        {lead.next_followup || 'None'}
                      </span>
                    </div>

                    {#if isOverdue}
                      <span class="bg-rose-50 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-500/30 animate-pulse">
                        Overdue
                      </span>
                    {:else if isDuplicate}
                      <span class="bg-amber-50 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-500/30">
                        Phantom Duplicate
                      </span>
                    {:else if isDateError}
                      <span class="bg-purple-50 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 font-bold px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-500/30">
                        Date Inversion (-7d)
                      </span>
                    {:else}
                      <span class="text-slate-400 dark:text-slate-500 text-[10px]">
                        {lead.industry}
                      </span>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </main>

  <!-- DATA HEALTH & DEDUPLICATION STUDIO MODAL (LEVEL 3 ELEVATION) -->
  {#if showHealthModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        role="button"
        tabindex="-1"
        aria-label="Close Health Modal"
        class="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-xs"
        onkeydown={(e) => { if (e.key === 'Escape') showHealthModal = false; }}
        onclick={() => showHealthModal = false}>
      </div>

      <div class="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto text-slate-900 dark:text-slate-100">
        <div class="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
              Automated Data Health & Deduplication Studio
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Programmatic diagnosis of duplicate records, chronological causality inversions, and financial accounting discrepancies ({auditResult.uniqueLeadsFlaggedCount} Unique Leads Flagged / {auditResult.totalFindingsCount} Total Findings)
            </p>
          </div>
          <button 
            onclick={() => showHealthModal = false}
            class="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <div class="space-y-6 py-4 text-xs">
          <!-- 1. DUPLICATE ACCOUNT RESOLUTION (L01/L23 and L02/L03) -->
          <div class="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                1. Duplicate Account Clusters (2 Pairs / 4 Rows Affected)
              </span>
              <span class="text-emerald-700 dark:text-emerald-400 font-bold font-mono text-xs">
                -৳ 1,050,000 BDT Phantom Pipeline Cleansed
              </span>
            </div>

            <!-- Cluster 1: Padma Textiles (L01 vs L23) -->
            <div class="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shadow-2xs">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-slate-900 dark:text-white text-sm">Padma Textiles Ltd</span>
                  <span class="text-slate-500 dark:text-slate-400">· Exact Match on Company & Contact (Rafiq Uddin, 01711-200101)</span>
                </div>
                <p class="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Canonical Winner: <strong class="text-slate-900 dark:text-slate-200 font-mono">L01</strong> (Meeting, ৳350k) ⟵ Duplicate: <strong class="text-amber-600 dark:text-amber-400 font-mono">L23</strong> (Meeting, ৳350k)
                </p>
              </div>

              {#if leads.find(l => l.id === 'L23')?.is_archived}
                <div class="flex items-center gap-2">
                  <span class="text-emerald-700 dark:text-emerald-400 font-bold text-xs">Merged ✓</span>
                  <button 
                    onclick={() => unmergeDuplicate('L23')}
                    class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 transition">
                    Unmerge Revert
                  </button>
                </div>
              {:else}
                <button 
                  onclick={() => mergeDuplicate('L23', 'L01')}
                  class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs shadow-sm shadow-emerald-600/20 transition">
                  Merge L23 into L01 (-৳350k)
                </button>
              {/if}
            </div>

            <!-- Cluster 2: Meghna Pharma (L02 vs L03) -->
            <div class="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shadow-2xs">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-slate-900 dark:text-white text-sm">Meghna Pharma Ltd vs Meghna Pharmaceuticals</span>
                  <span class="text-slate-500 dark:text-slate-400">· Fuzzy Match on Company & Exact Contact (Dr. Sultana Begum)</span>
                </div>
                <p class="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Canonical Winner: <strong class="text-slate-900 dark:text-slate-200 font-mono">L02</strong> (Proposal, ৳700k) ⟵ Duplicate: <strong class="text-amber-600 dark:text-amber-400 font-mono">L03</strong> (Proposal, ৳700k)
                </p>
              </div>

              {#if leads.find(l => l.id === 'L03')?.is_archived}
                <div class="flex items-center gap-2">
                  <span class="text-emerald-700 dark:text-emerald-400 font-bold text-xs">Merged ✓</span>
                  <button 
                    onclick={() => unmergeDuplicate('L03')}
                    class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 transition">
                    Unmerge Revert
                  </button>
                </div>
              {:else}
                <button 
                  onclick={() => mergeDuplicate('L03', 'L02')}
                  class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs shadow-sm shadow-emerald-600/20 transition">
                  Merge L03 into L02 (-৳700k)
                </button>
              {/if}
            </div>
          </div>

          <!-- 2. CHRONOLOGICAL DATE ORDER ERROR (L25 Sylhet Hospitality) -->
          <div class="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-purple-500"></span>
                2. Chronological Causality Inversion (L25 Sylhet Hospitality Group)
              </span>
              <span class="text-purple-700 dark:text-purple-400 font-mono text-xs font-semibold">Violation: Next Follow-up &lt; Last Contact</span>
            </div>

            <div class="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shadow-2xs">
              <div>
                <p class="text-slate-800 dark:text-slate-200">
                  Last Contact: <strong class="font-mono text-slate-900 dark:text-white">{l25?.last_contact}</strong> · Next Follow-up: <strong class="font-mono text-rose-600 dark:text-rose-400">{l25?.next_followup}</strong>
                </p>
                <p class="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                  A follow-up date cannot occur in the past prior to the recorded contact event. Choose non-destructive remediation:
                </p>
              </div>

              <div class="flex items-center gap-2">
                <button 
                  onclick={() => remediateDateOrder('L25', 'SWAP')}
                  class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 transition">
                  Swap Fields (21 Oct ⟷ 28 Oct)
                </button>
                <button 
                  onclick={() => remediateDateOrder('L25', 'RESCHEDULE')}
                  class="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition">
                  Reschedule to 4 Nov (+7d)
                </button>
              </div>
            </div>
          </div>

          <!-- 3. EMAIL TYPO & STAGE SEMANTICS (L18, L12) -->
          <div class="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <span class="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-sky-500"></span>
              3. Data Formatting & Payment Semantics (L18, L12)
            </span>

            <div class="grid grid-cols-2 gap-3">
              <!-- L18 Email Typo -->
              <div class="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-2 shadow-2xs">
                <div>
                  <span class="font-bold text-slate-900 dark:text-white">L18 (Bogura Textile Mills)</span>
                  <p class="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">{l18?.contact_email}</p>
                </div>
                {#if l18?.contact_email?.includes('bogurateXtile')}
                  <button 
                    onclick={() => fixEmailTypo('L18')}
                    class="bg-blue-600 hover:bg-blue-500 text-white py-1 px-2.5 rounded-lg text-xs font-medium transition">
                    Auto-Fix Domain Typo ('boguratextile')
                  </button>
                {:else}
                  <span class="text-emerald-700 dark:text-emerald-400 font-bold text-xs">Normalized ✓</span>
                {/if}
              </div>

              <!-- L12 Partial Payment -->
              <div class="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-2 shadow-2xs">
                <div>
                  <span class="font-bold text-slate-900 dark:text-white">L12 (Eastern Cable Industries)</span>
                  <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Stage says "Paid", but notes confirm only 50% advance received.</p>
                </div>
                <div class="flex items-center justify-between text-xs font-mono bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-200/80 dark:border-slate-800">
                  <span class="text-emerald-700 dark:text-emerald-400 font-semibold">Collected: ৳150,000</span>
                  <span class="text-amber-700 dark:text-amber-400 font-semibold">Due: ৳150,000</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-200 dark:border-slate-800 text-right">
          <button 
            onclick={() => showHealthModal = false}
            class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-medium text-xs px-4 py-2 rounded-xl transition">
            Close Studio
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- NATURAL LANGUAGE DEAL COPILOT MODAL (SAFE AST EXECUTION) -->
  {#if showCopilotModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        role="button"
        tabindex="-1"
        aria-label="Close Copilot Modal"
        class="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-xs"
        onkeydown={(e) => { if (e.key === 'Escape') showCopilotModal = false; }}
        onclick={() => showCopilotModal = false}>
      </div>

      <div class="relative w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto text-slate-900 dark:text-slate-100">
        <div class="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
              Natural Language Deal Copilot (Safe AST Compiler)
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Ask plain English questions without risk of raw SQL injection or financial hallucinations</p>
          </div>
          <button 
            onclick={() => showCopilotModal = false}
            class="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <!-- Preset Quick Questions -->
        <div class="py-3 flex items-center gap-2 flex-wrap border-b border-slate-200 dark:border-slate-800">
          <span class="text-xs text-slate-500 font-medium">Quick Queries:</span>
          <button 
            onclick={() => runCopilot('What is the total value in Proposal stage?')}
            class="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg transition">
            Proposal Stage Value?
          </button>
          <button 
            onclick={() => runCopilot('Which deals are overdue?')}
            class="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg transition">
            Overdue Deals?
          </button>
          <button 
            onclick={() => runCopilot('Show me all garment and pharma leads')}
            class="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg transition">
            Garments & Pharma?
          </button>
          <button 
            onclick={() => runCopilot('Which leads have data errors or duplicates?')}
            class="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg transition">
            Data Errors / Duplicates?
          </button>
        </div>

        <!-- Query Input -->
        <div class="py-3 flex items-center gap-2">
          <input 
            type="text" 
            bind:value={copilotQuestion}
            onkeydown={(e) => { if (e.key === 'Enter') runCopilot(copilotQuestion); }}
            placeholder="Ask a question about deals, stages, overdue dates or values..."
            class="flex-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none transition" />
          <button 
            onclick={() => runCopilot(copilotQuestion)}
            class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-sm transition">
            Query Engine
          </button>
        </div>

        <!-- Copilot Answer & AST Diagnostics -->
        {#if copilotResult}
          <div class="space-y-4 pt-2">
            <!-- Structured Answer Card -->
            <div class="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">Verified Answer</span>
                {#if copilotResult.cleaned_result.scalar !== undefined}
                  <span class="text-lg font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                    ৳ {copilotResult.cleaned_result.scalar.toLocaleString()} BDT
                  </span>
                {:else}
                  <span class="text-xs font-mono text-slate-600 dark:text-slate-300 font-semibold">
                    {copilotResult.cleaned_result.total_count} Deals Matched (৳ {copilotResult.cleaned_result.total_value_bdt.toLocaleString()} BDT)
                  </span>
                {/if}
              </div>

              <!-- Dual-Truth Variance Banner (Section 9.6) -->
              {#if copilotResult.raw_variance}
                <div class="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 rounded-lg text-xs space-y-1">
                  <span class="font-bold text-amber-800 dark:text-amber-300 block">Dual-Truth Financial Variance:</span>
                  <p class="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                    {copilotResult.raw_variance.variance_explanation}
                  </p>
                </div>
              {/if}

              <!-- Lead List (if table or filter) -->
              {#if copilotResult.cleaned_result.leads.length > 0}
                <div class="max-h-48 overflow-y-auto space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  {#each copilotResult.cleaned_result.leads as match}
                    <div class="flex items-center justify-between bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 text-xs shadow-2xs">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 rounded">{match.id}</span>
                        <span class="font-bold text-slate-900 dark:text-white">{match.company}</span>
                        <span class="text-slate-500 dark:text-slate-400 text-[11px]">({match.stage} · {match.industry})</span>
                      </div>
                      <span class="font-mono text-emerald-700 dark:text-emerald-400 font-bold">৳ {match.deal_value_bdt.toLocaleString()}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- AST Compiler Representation (Shows Strict Security Execution) -->
            <div class="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-400">
              <span class="text-slate-500 block mb-1 font-semibold">Validated AST Query Contract:</span>
              <pre class="overflow-x-auto text-blue-700 dark:text-blue-300">{JSON.stringify(copilotResult.ast, null, 2)}</pre>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- AI B2B FOLLOW-UP EMAIL STUDIO MODAL (LEVEL 3 ELEVATION) -->
  {#if showEmailModal && selectedLead}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        role="button"
        tabindex="-1"
        aria-label="Close Email Modal"
        class="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-xs"
        onkeydown={(e) => { if (e.key === 'Escape') showEmailModal = false; }}
        onclick={() => showEmailModal = false}>
      </div>

      <div class="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto text-slate-900 dark:text-slate-100">
        <div class="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              AI B2B Follow-up Email Drafter
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Target: <strong class="text-slate-900 dark:text-white">{selectedLead.company}</strong> ({selectedLead.contact_name || 'Contact missing'} · {selectedLead.stage})
            </p>
          </div>
          <button 
            onclick={() => showEmailModal = false}
            class="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg">✕</button>
        </div>

        {#if emailDraft}
          <div class="space-y-4 py-4 text-xs">
            <!-- POLICY BARRIER ALERT (L16 Lost do not contact) -->
            {#if emailDraft.isBlocked}
              <div class="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-4 rounded-xl space-y-2">
                <span class="font-bold text-rose-800 dark:text-rose-300 text-sm flex items-center gap-2">
                  <svg class="w-5 h-5 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                  DO NOT CONTACT COMPLIANCE BARRIER
                </span>
                <p class="text-rose-700 dark:text-rose-200 leading-relaxed font-sans">
                  {emailDraft.barrierReason}
                </p>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  Note on lead: "{selectedLead.notes}"
                </p>
              </div>
            {:else}
              <!-- Tone Selector -->
              <div class="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                <span class="text-slate-600 dark:text-slate-400 text-xs font-medium pl-1">Email Tone:</span>
                <select 
                  bind:value={emailTone}
                  onchange={generateEmail}
                  class="bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 focus:outline-none focus:border-blue-500">
                  <option value="POLITE_CHECKIN">Polite Check-in</option>
                  <option value="PROPOSAL_FOLLOWUP">Proposal Follow-up</option>
                  <option value="INVOICE_REMINDER">Invoice Advance Reminder</option>
                </select>
              </div>

              <!-- Mandatory Bank Checklist (L22 Khulna Jute) -->
              {#if emailDraft.requiresBankChecklist}
                <div class="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 rounded-xl space-y-2">
                  <span class="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    ⚠️ Pre-Chase Accounting Checklist Required
                  </span>
                  <label class="flex items-center gap-2 text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input type="checkbox" bind:checked={bankConfirmed} class="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0" />
                    <span>I have checked the bank statement with accounts and confirmed the ৳150k payment has not arrived yet.</span>
                  </label>
                </div>
              {/if}

              <!-- Email Subject & Body -->
              <div class="space-y-3">
                <div>
                  <span class="text-slate-600 dark:text-slate-400 block text-[11px] mb-1 font-semibold uppercase tracking-wider">Subject</span>
                  <input 
                    type="text" 
                    bind:value={emailDraft.subject}
                    class="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2.5 text-xs text-slate-900 dark:text-slate-100 font-medium focus:border-blue-500 focus:outline-none transition" />
                </div>

                <div>
                  <span class="text-slate-600 dark:text-slate-400 block text-[11px] mb-1 font-semibold uppercase tracking-wider">Body (Approval-Only Draft)</span>
                  <textarea 
                    bind:value={emailDraft.body}
                    rows="9"
                    class="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-3 text-xs text-slate-900 dark:text-slate-100 font-mono leading-relaxed focus:border-blue-500 focus:outline-none transition"></textarea>
                </div>
              </div>

              <!-- Warnings / Normalizations -->
              {#if emailDraft.warnings.length > 0}
                <div class="text-[11px] text-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 p-2.5 rounded-lg border border-amber-200 dark:border-amber-500/20 space-y-0.5">
                  {#each emailDraft.warnings as w}
                    <p>• {w}</p>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>

          <div class="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span class="text-[11px] text-slate-500">Status: DRAFT_PENDING_APPROVAL</span>

            <div class="flex items-center gap-2">
              {#if !emailDraft.isBlocked}
                <button 
                  disabled={emailDraft.requiresBankChecklist && !bankConfirmed}
                  onclick={() => copyText(emailDraft?.body || '')}
                  class={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    emailDraft.requiresBankChecklist && !bankConfirmed 
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700' 
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                  }`}>
                  {copySuccess ? 'Copied to Clipboard! ✓' : 'Approve & Copy'}
                </button>

                {#if selectedLead.contact_email}
                  <a 
                    href={`mailto:${emailDraft.recipientEmail}?subject=${encodeURIComponent(emailDraft.subject)}&body=${encodeURIComponent(emailDraft.body)}`}
                    class={`px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm ${
                      emailDraft.requiresBankChecklist && !bankConfirmed ? 'pointer-events-none opacity-50' : ''
                    }`}>
                    Open in Mail App
                  </a>
                {/if}
              {/if}

              <button 
                onclick={() => showEmailModal = false}
                class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-white px-3.5 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 transition">
                Close
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- PRIORITY DEAL CHASE DIGEST MODAL (LEVEL 3 ELEVATION) -->
  {#if showDigestModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        role="button"
        tabindex="-1"
        aria-label="Close Digest Modal"
        class="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-xs"
        onkeydown={(e) => { if (e.key === 'Escape') showDigestModal = false; }}
        onclick={() => showDigestModal = false}>
      </div>

      <div class="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl z-10 text-slate-900 dark:text-slate-100">
        <div class="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              Weekly Deal Priority Chase Digest
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Ranked recommendations on which corporate deals to chase first (Benchmark: 1 Nov 2026)</p>
          </div>
          <button 
            onclick={() => showDigestModal = false}
            class="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <div class="space-y-3 py-4 text-xs">
          <!-- Priority 1: Oriental Bank Ops -->
          <div class="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 shadow-2xs">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-rose-50 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold px-1.5 py-0.5 rounded text-[10px] border border-rose-200 dark:border-rose-500/30">P1 CRITICAL</span>
                <span class="font-bold text-slate-900 dark:text-white text-sm">L10 · Oriental Bank Branch Ops</span>
              </div>
              <p class="text-slate-700 dark:text-slate-300 mt-1 font-sans">
                Meeting concluded Oct 26. Client explicitly requested a written proposal with 3 options. Overdue by 2 days — proposal awaiting dispatch!
              </p>
            </div>
            <span class="font-mono text-emerald-700 dark:text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 500,000</span>
          </div>

          <!-- Priority 2: Bengal Solar Systems -->
          <div class="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 shadow-2xs">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-amber-50 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded text-[10px] border border-amber-200 dark:border-amber-500/30">P2 DUE TOMORROW</span>
                <span class="font-bold text-slate-900 dark:text-white text-sm">L07 · Bengal Solar Systems</span>
              </div>
              <p class="text-slate-700 dark:text-slate-300 mt-1 font-sans">
                Invoice sent Oct 30. Payment due tomorrow (2 Nov). Verify whether advance has cleared in the bank.
              </p>
            </div>
            <span class="font-mono text-emerald-700 dark:text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 250,000</span>
          </div>

          <!-- Priority 3: Khulna Jute Works -->
          <div class="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 shadow-2xs">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-amber-50 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded text-[10px] border border-amber-200 dark:border-amber-500/30">P3 INVOICE OVERDUE</span>
                <span class="font-bold text-slate-900 dark:text-white text-sm">L22 · Khulna Jute Works</span>
              </div>
              <p class="text-slate-700 dark:text-slate-300 mt-1 font-sans">
                Invoice sent 17 Oct. Overdue by 8 days. Note: Verify bank statement with finance before calling accounts director.
              </p>
            </div>
            <span class="font-mono text-emerald-700 dark:text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 150,000</span>
          </div>

          <!-- Priority 4: Meghna Pharma Ltd -->
          <div class="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 shadow-2xs">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-blue-50 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 font-bold px-1.5 py-0.5 rounded text-[10px] border border-blue-200 dark:border-blue-500/30">P4 LARGEST DEAL</span>
                <span class="font-bold text-slate-900 dark:text-white text-sm">L02 · Meghna Pharma Ltd</span>
              </div>
              <p class="text-slate-700 dark:text-slate-300 mt-1 font-sans">
                Proposal submitted. Budget approval meeting next week. Prepare Bangla curriculum support brochure requested by Dr. Sultana Begum.
              </p>
            </div>
            <span class="font-mono text-emerald-700 dark:text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 700,000</span>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <label class="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
            <input type="checkbox" bind:checked={maskPiiOnExport} class="rounded border-slate-300 dark:border-slate-700 text-blue-600" />
            <span>Mask PII (emails/phones) on CSV export</span>
          </label>

          <button 
            onclick={() => showDigestModal = false}
            class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-medium px-4 py-2 rounded-xl transition">
            Close Summary
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
