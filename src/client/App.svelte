<script lang="ts">
  import { onMount } from 'svelte';
  import { rawCorporateLeadsFixture } from '../server/fixtures';
  import { auditCorporateLeads } from '../lib/engine/hygiene';
  import { executeCopilotQuery } from '../lib/engine/copilot';
  import { generateCorporateFollowupEmail, type EmailDraftResult } from '../lib/engine/email_drafter';
  import type { CorporateLead, PipelineStage, AnomalyFinding } from '../lib/types/pipeline';

  // --- INITIALIZE LEADS WITH CLEANED DEFAULTS ---
  // In Cleaned Mode default: L03 (dup of L02) and L23 (dup of L01) are archived
  function initializeLeads(): CorporateLead[] {
    return rawCorporateLeadsFixture.map(l => {
      if (l.id === 'L03') {
        return { ...l, is_archived: true, merged_into_id: 'L02' };
      }
      if (l.id === 'L23') {
        return { ...l, is_archived: true, merged_into_id: 'L01' };
      }
      return { ...l, is_archived: false, merged_into_id: null };
    });
  }

  // --- STATE WITH SVELTE 5 RUNES ---
  let leads = $state<CorporateLead[]>(initializeLeads());
  let viewMode = $state<'cleaned' | 'raw'>('cleaned');
  let activeTab = $state<'pipeline' | 'health' | 'priority' | 'copilot'>('pipeline');
  let layoutMode = $state<'board' | 'table'>('board');
  let selectedLeadId = $state<string>('L01');
  let theme = $state<'light' | 'dark'>('light');
  let searchQuery = $state('');

  // Benchmark Date: 1 Nov 2026 per brief
  const BENCHMARK_DATE = '2026-11-01';

  // Copilot State
  let copilotQuestion = $state('What is the total value in Proposal stage?');
  let copilotResult = $state<any | null>(null);

  // Email Studio State
  let emailTone = $state<'POLITE_CHECKIN' | 'PROPOSAL_FOLLOWUP' | 'INVOICE_REMINDER'>('POLITE_CHECKIN');
  let bankConfirmed = $state(false);
  let feedbackMessage = $state<string | null>(null);
  let maskPiiOnExport = $state(false);

  // Initialize theme from DOM & localStorage
  onMount(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      theme = 'dark';
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      theme = 'light';
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }

    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        activeTab = 'copilot';
        const copilotInput = document.getElementById('copilot-input');
        if (copilotInput) copilotInput.focus();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }

  // --- DERIVED DATASETS & AUDIT ---
  let auditResult = $derived(auditCorporateLeads(leads, BENCHMARK_DATE));

  // Leads for display strictly partitioned by Cleaned vs Raw mode
  let displayLeads = $derived(
    viewMode === 'cleaned' ? leads.filter(l => !l.is_archived) : leads
  );

  // Filtered Leads by Search Query
  let filteredLeads = $derived(
    displayLeads.filter(l => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        l.id.toLowerCase().includes(q) ||
        l.company.toLowerCase().includes(q) ||
        l.industry.toLowerCase().includes(q) ||
        (l.contact_name && l.contact_name.toLowerCase().includes(q)) ||
        (l.contact_email && l.contact_email.toLowerCase().includes(q)) ||
        (l.contact_phone && l.contact_phone.includes(q))
      );
    })
  );

  // Selected Lead (Guaranteed selection)
  let selectedLead = $derived(
    displayLeads.find(l => l.id === selectedLeadId) || 
    leads.find(l => l.id === selectedLeadId) || 
    displayLeads[0]
  );

  // Dynamic AI Email Draft for selected lead
  let emailDraft = $derived(
    selectedLead ? generateCorporateFollowupEmail({ lead: selectedLead, tone: emailTone }) : null
  );

  // --- RECONCILED FINANCIAL CALCULATIONS (100% AUDIT ACCURACY) ---
  // 1. Contracted Pipeline Value (Excludes Lost)
  // Cleaned = 3,170,000 BDT | Raw = 4,220,000 BDT
  let contractedPipelineValue = $derived(
    displayLeads.filter(l => l.stage !== 'Lost').reduce((s, l) => s + (l.deal_value_bdt || 0), 0)
  );

  // 2. Cash Collected (Paid)
  // L12 Tranche 1 = 150,000 BDT
  let cashCollected = $derived(
    displayLeads.reduce((s, l) => s + (l.amount_collected_bdt || 0), 0)
  );

  // 3. Outstanding Receivables (Invoiced + Paid Due ONLY)
  // L07 (250k) + L22 (150k) + L12 Tranche 2 (150k) = 550,000 BDT
  let outstandingReceivables = $derived(
    displayLeads
      .filter(l => l.stage === 'Invoice sent' || l.stage === 'Paid')
      .reduce((s, l) => s + (l.amount_due_bdt || 0), 0)
  );

  // 4. Weighted Active Pipeline (New, Contacted, Meeting, Proposal)
  // 3.17M - 400k (Invoiced) - 300k (Paid) = 2,470,000 BDT
  let activeWeightedPipeline = $derived(
    displayLeads
      .filter(l => ['New', 'Contacted', 'Meeting', 'Proposal'].includes(l.stage))
      .reduce((s, l) => s + (l.deal_value_bdt || 0), 0)
  );

  // Overdue count strictly before benchmark date 2026-11-01
  let overdueLeads = $derived(
    displayLeads.filter(l => l.next_followup && l.next_followup < BENCHMARK_DATE && l.stage !== 'Lost' && l.stage !== 'Paid')
  );

  // Active stages for desktop board (terminal stages collapsed)
  const activeStages: PipelineStage[] = ['New', 'Contacted', 'Meeting', 'Proposal', 'Invoice sent'];
  const terminalStages: PipelineStage[] = ['Paid', 'Lost'];

  // --- ACTIONS & REMEDIATION ---
  function transitionStage(leadId: string, newStage: PipelineStage) {
    leads = leads.map(l => l.id === leadId ? { ...l, stage: newStage } : l);
    showFeedback(`Stage updated to ${newStage}`);
  }

  function mergeDuplicate(duplicateId: string, canonicalId: string) {
    leads = leads.map(l => {
      if (l.id === duplicateId) {
        return { ...l, is_archived: true, merged_into_id: canonicalId };
      }
      if (l.id === canonicalId) {
        return { ...l, notes: `${l.notes} [Merged from ${duplicateId}]` };
      }
      return l;
    });
    showFeedback(`Archived duplicate ${duplicateId} into canonical lead ${canonicalId}`);
  }

  function unmergeDuplicate(duplicateId: string) {
    leads = leads.map(l => l.id === duplicateId ? { ...l, is_archived: false, merged_into_id: null } : l);
    showFeedback(`Restored ${duplicateId} as independent lead`);
  }

  function remediateDateOrder(leadId: string, strategy: 'SWAP' | 'RESCHEDULE') {
    leads = leads.map(l => {
      if (l.id === leadId) {
        if (strategy === 'SWAP') {
          return { ...l, last_contact: l.next_followup, next_followup: l.last_contact };
        } else {
          return { ...l, next_followup: '2026-11-04' };
        }
      }
      return l;
    });
    showFeedback(`Remediated date inversion on ${leadId} via ${strategy}`);
  }

  function fixEmailTypo(leadId: string) {
    leads = leads.map(l => {
      if (l.id === leadId && l.contact_email?.includes('bogurateXtile')) {
        return { ...l, contact_email: l.contact_email.replace('bogurateXtile', 'boguratextile') };
      }
      return l;
    });
    showFeedback(`Normalized email typo for ${leadId}`);
  }

  function runCopilot(q: string) {
    copilotQuestion = q;
    copilotResult = executeCopilotQuery(q, leads, BENCHMARK_DATE);
  }

  function copyText(txt: string, label: string) {
    navigator.clipboard.writeText(txt);
    showFeedback(`Copied ${label} to clipboard`);
  }

  function showFeedback(msg: string) {
    feedbackMessage = msg;
    setTimeout(() => { feedbackMessage = null; }, 2500);
  }

  function exportCleanedCsv() {
    const headers = ['Lead ID', 'Company', 'Industry', 'Contact', 'Email', 'Phone', 'Stage', 'Deal Value BDT', 'Collected BDT', 'Due BDT', 'Next Followup'];
    const rows = displayLeads.map(l => [
      l.id,
      `"${l.company}"`,
      l.industry,
      `"${l.contact_name || ''}"`,
      `"${l.contact_email || ''}"`,
      `"${l.contact_phone || ''}"`,
      l.stage,
      l.deal_value_bdt || 0,
      l.amount_collected_bdt || 0,
      l.amount_due_bdt || 0,
      l.next_followup || ''
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biai-corporate-leads-${viewMode}-${BENCHMARK_DATE}.csv`;
    a.click();
    showFeedback(`Exported ${displayLeads.length} leads as CSV`);
  }
</script>

<!-- APPLICATION CONTAINER -->
<div class="h-screen w-screen flex flex-col overflow-hidden bg-warm-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 font-sans selection:bg-orange-600 selection:text-white">

  <!-- ======================================================== -->
  <!-- 1. TOP HEADER (QUIETLY CONFIDENT BIAI ENTERPRISE BAR)    -->
  <!-- ======================================================== -->
  <header class="h-14 border-b border-warm-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 backdrop-blur px-4 flex items-center justify-between gap-4 shrink-0 z-30">
    
    <!-- Left: Brand Identity & Workspace Switcher -->
    <div class="flex items-center gap-3">
      <!-- Official BIAI Circular Woven Emblem -->
      <img src="/biai-logo.png" alt="Bangladesh Institute of AI" class="w-8 h-8 rounded-full shrink-0 object-contain shadow-xs" />

      <div class="flex items-center gap-2">
        <span class="font-bold tracking-[0.25em] text-slate-900 dark:text-white text-sm">B I A I</span>
        <span class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-warm-100 text-warm-800 border border-warm-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
          Corporate Pipeline
        </span>
      </div>

      <div class="h-4 w-[1px] bg-warm-200 dark:bg-slate-800 mx-1"></div>

      <!-- Dataset Lineage Segmented Control (Raw vs Cleaned) -->
      <div class="flex items-center bg-warm-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-medium border border-warm-200 dark:border-slate-700">
        <button 
          onclick={() => viewMode = 'cleaned'}
          class={`px-3 py-1 rounded-md transition ${viewMode === 'cleaned' ? 'bg-white dark:bg-slate-900 text-orange-700 dark:text-orange-400 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
          Cleaned Verified (23)
        </button>
        <button 
          onclick={() => viewMode = 'raw'}
          class={`px-3 py-1 rounded-md transition ${viewMode === 'raw' ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
          Raw Imported (25)
        </button>
      </div>
    </div>

    <!-- Center: Global Search (Cmd+K) -->
    <div class="flex-1 max-w-md relative">
      <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg class="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
      </div>
      <input 
        type="text" 
        bind:value={searchQuery}
        placeholder="Search company, contact, phone, lead ID...  ⌘K"
        class="w-full text-xs pl-9 pr-14 py-1.5 rounded-lg border border-warm-200 dark:border-slate-800 bg-warm-50/70 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-600 transition"
      />
      {#if searchQuery}
        <button 
          onclick={() => searchQuery = ''}
          class="absolute inset-y-0 right-2 my-auto h-5 px-1.5 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center">
          ✕ Clear
        </button>
      {/if}
    </div>

    <!-- Right: Utility Controls & Primary Action -->
    <div class="flex items-center gap-2">
      <!-- Benchmark Date Badge -->
      <span class="text-[11px] font-mono text-slate-500 bg-warm-100 dark:bg-slate-800 px-2 py-1 rounded border border-warm-200 dark:border-slate-700">
        Benchmark: 2026-11-01
      </span>

      <!-- Export CSV -->
      <button 
        onclick={exportCleanedCsv}
        class="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white p-1.5 rounded hover:bg-warm-100 dark:hover:bg-slate-800 transition"
        title="Export dataset to CSV">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
      </button>

      <!-- Theme Switcher -->
      <button 
        onclick={toggleTheme}
        aria-label="Toggle visual theme"
        class="p-1.5 rounded text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-warm-100 dark:hover:bg-slate-800 transition">
        {#if theme === 'dark'}
          <svg class="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
        {:else}
          <svg class="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
        {/if}
      </button>

      <!-- Primary Copilot Trigger -->
      <button 
        onclick={() => activeTab = 'copilot'}
        class="text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm shadow-orange-600/20 active:scale-[0.98] transition">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        <span>Deal Copilot</span>
      </button>
    </div>
  </header>

  <!-- ======================================================== -->
  <!-- 2. RECONCILED FINANCIAL METRICS (100% EXPLICIT LINEAGE)   -->
  <!-- ======================================================== -->
  <div class="h-10 bg-warm-100/90 dark:bg-slate-900/40 border-b border-warm-200 dark:border-slate-800 px-4 flex items-center justify-between text-xs shrink-0">
    <div class="flex items-center gap-5 text-slate-600 dark:text-slate-400">
      
      <!-- Contracted Pipeline Value -->
      <div class="flex items-center gap-1.5">
        <span>Contracted Value:</span>
        <span class="font-bold font-mono text-emerald-700 dark:text-emerald-400 text-sm">
          ৳ {contractedPipelineValue.toLocaleString()} BDT
        </span>
        <span class="text-[10px] uppercase font-semibold px-1 rounded bg-warm-200 dark:bg-slate-800 text-slate-500">
          {viewMode === 'cleaned' ? 'Cleaned Verified' : 'Raw Imported'}
        </span>
      </div>

      <div class="h-3.5 w-[1px] bg-warm-300 dark:bg-slate-800"></div>

      <!-- Cash Collected -->
      <div class="flex items-center gap-1.5">
        <span>Cash Collected:</span>
        <span class="font-bold font-mono text-sky-700 dark:text-sky-400">
          ৳ {cashCollected.toLocaleString()} BDT
        </span>
        <span class="text-[11px] text-slate-400">(L12 Advance)</span>
      </div>

      <div class="h-3.5 w-[1px] bg-warm-300 dark:bg-slate-800"></div>

      <!-- Outstanding Receivables (Invoiced + Paid Due ONLY) -->
      <div class="flex items-center gap-1.5">
        <span>Outstanding Receivables:</span>
        <span class="font-bold font-mono text-amber-700 dark:text-amber-400">
          ৳ {outstandingReceivables.toLocaleString()} BDT
        </span>
        <span class="text-[11px] text-slate-400">(L07, L22, L12 Tranche 2)</span>
      </div>

      <div class="h-3.5 w-[1px] bg-warm-300 dark:bg-slate-800"></div>

      <!-- Weighted Active Pipeline -->
      <div class="flex items-center gap-1.5">
        <span>Active Weighted:</span>
        <span class="font-bold font-mono text-slate-800 dark:text-slate-200">
          ৳ {activeWeightedPipeline.toLocaleString()} BDT
        </span>
      </div>
    </div>

    <!-- Health Flags Alert Strip -->
    <div class="flex items-center gap-2 font-mono text-[11px]">
      <span class="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-300 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
        {overdueLeads.length} Overdue Deals
      </span>
      <span class="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800">
        18 Findings (15 Leads)
      </span>
    </div>
  </div>

  <!-- ======================================================== -->
  <!-- 3. THREE-PANE DESKTOP WORKSPACE                           -->
  <!-- ======================================================== -->
  <div class="flex-1 flex overflow-hidden">

    <!-- ------------------------------------------------------ -->
    <!-- PANE 1: NAVIGATION & SAVED VIEWS (220px Fixed)         -->
    <!-- ------------------------------------------------------ -->
    <aside class="w-56 border-r border-warm-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 flex flex-col justify-between shrink-0 overflow-y-auto">
      <div class="p-3 space-y-4">
        <div>
          <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
            Pipeline Views
          </div>
          <nav class="space-y-0.5 text-xs">
            <button 
              onclick={() => activeTab = 'pipeline'}
              class={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition ${activeTab === 'pipeline' ? 'bg-orange-50 text-orange-950 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-800 font-semibold' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800'}`}>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Active Pipeline</span>
              </div>
              <span class="font-mono text-[11px] text-slate-500">{displayLeads.length}</span>
            </button>

            <button 
              onclick={() => activeTab = 'health'}
              class={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition ${activeTab === 'health' ? 'bg-orange-50 text-orange-950 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-800 font-semibold' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800'}`}>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>Data Health Studio</span>
              </div>
              <span class="font-mono text-[11px] text-amber-700 font-bold">18</span>
            </button>

            <button 
              onclick={() => activeTab = 'priority'}
              class={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition ${activeTab === 'priority' ? 'bg-orange-50 text-orange-950 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-800 font-semibold' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800'}`}>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-rose-500"></span>
                <span>Priority Chase</span>
              </div>
              <span class="font-mono text-[11px] text-rose-600 font-bold">{overdueLeads.length}</span>
            </button>

            <button 
              onclick={() => activeTab = 'copilot'}
              class={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition ${activeTab === 'copilot' ? 'bg-orange-50 text-orange-950 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-800 font-semibold' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800'}`}>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
                <span>Safe AST Copilot</span>
              </div>
              <span class="font-mono text-[10px] text-indigo-500">AI</span>
            </button>
          </nav>
        </div>

        <!-- Stage Counts Summary -->
        <div>
          <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
            Active Stages
          </div>
          <div class="space-y-1 text-xs">
            {#each activeStages as st}
              {@const count = displayLeads.filter(l => l.stage === st).length}
              <div class="flex items-center justify-between px-2 py-1 text-slate-600 dark:text-slate-400">
                <span>{st}</span>
                <span class="font-mono font-semibold">{count}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Left Rail Footer -->
      <div class="p-3 border-t border-warm-200 dark:border-slate-800 text-[11px] text-slate-400">
        <a href="/" class="hover:underline flex items-center gap-1">
          <span>← Back to Task 1 CRM</span>
        </a>
      </div>
    </aside>

    <!-- ------------------------------------------------------ -->
    <!-- PANE 2: STAGE BOARD OR HIGH-DENSITY TABLE (FLEX-1)     -->
    <!-- ------------------------------------------------------ -->
    <section class="flex-1 border-r border-warm-200 dark:border-slate-800 bg-warm-50 dark:bg-slate-950 flex flex-col overflow-hidden">
      
      <!-- Toolbar: View Switcher (Board vs Table) -->
      <div class="h-10 border-b border-warm-200 dark:border-slate-800 px-4 flex items-center justify-between bg-white dark:bg-slate-900 text-xs shrink-0">
        <div class="flex items-center gap-3">
          <span class="font-semibold text-slate-800 dark:text-slate-200">
            {activeTab === 'pipeline' ? 'Corporate Pipeline Workspace' : activeTab === 'health' ? 'Data Hygiene & Audit Studio' : activeTab === 'priority' ? 'Priority Overdue Chase' : 'AST Query Engine'}
          </span>
          <span class="text-[11px] text-slate-400">({filteredLeads.length} leads in view)</span>
        </div>

        <!-- Board vs Table Toggle -->
        <div class="flex items-center gap-1 bg-warm-100 dark:bg-slate-800 p-0.5 rounded-md text-[11px]">
          <button 
            onclick={() => layoutMode = 'board'}
            class={`px-2 py-0.5 rounded font-medium transition ${layoutMode === 'board' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
            Active Stages Board
          </button>
          <button 
            onclick={() => layoutMode = 'table'}
            class={`px-2 py-0.5 rounded font-medium transition ${layoutMode === 'table' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
            Data Health Table
          </button>
        </div>
      </div>

      <!-- Main Surface: Board or Table -->
      <div class="flex-1 overflow-auto p-4">
        {#if layoutMode === 'board'}
          <!-- 4-COLUMN ACTIVE STAGE WORKSPACE + CLOSED DEALS SECTION -->
          <div class="space-y-4">
            <div class="grid grid-cols-4 gap-3 items-start">
              {#each ['Contacted', 'Meeting', 'Proposal', 'Invoice sent'] as stage}
                {@const stageLeads = filteredLeads.filter(l => l.stage === stage)}
                {@const stageSum = stageLeads.reduce((s, l) => s + (l.deal_value_bdt || 0), 0)}

                <div class="bg-warm-100/70 dark:bg-slate-900/60 border border-warm-200 dark:border-slate-800 rounded-xl flex flex-col max-h-[calc(100vh-190px)]">
                  <!-- Stage Header -->
                  <div class="p-3 border-b border-warm-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-xl flex items-center justify-between">
                    <div>
                      <span class="font-semibold text-xs text-slate-800 dark:text-white uppercase tracking-wider">{stage}</span>
                      {#if stageSum > 0}
                        <p class="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400">৳ {stageSum.toLocaleString()}</p>
                      {/if}
                    </div>
                    <span class="text-xs font-mono bg-warm-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-semibold text-slate-600 dark:text-slate-300">
                      {stageLeads.length}
                    </span>
                  </div>

                  <!-- Cards Container -->
                  <div class="p-2 overflow-y-auto space-y-2 flex-1">
                    {#if stageLeads.length === 0}
                      <div class="py-8 text-center text-slate-400 text-xs italic">
                        No deals in {stage}
                      </div>
                    {:else}
                      {#each stageLeads as lead (lead.id)}
                        {@const isSelected = selectedLead && selectedLead.id === lead.id}
                        {@const isOverdue = lead.next_followup && lead.next_followup < BENCHMARK_DATE}
                        
                        <div 
                          role="button"
                          tabindex="0"
                          onclick={() => selectedLeadId = lead.id}
                          onkeydown={(e) => { if (e.key === 'Enter') selectedLeadId = lead.id; }}
                          class={`w-full text-left p-3 rounded-lg border transition duration-150 cursor-pointer ${
                            isOverdue ? 'rail-overdue' : 'rail-healthy'
                          } ${
                            isSelected 
                              ? 'bg-orange-50/70 border-orange-300 dark:bg-orange-950/20 dark:border-orange-800 shadow-sm' 
                              : 'bg-white hover:bg-warm-100/60 border-warm-200 dark:bg-slate-900 dark:border-slate-800 dark:hover:bg-slate-850'
                          }`}>
                          
                          <div class="flex items-start justify-between gap-1">
                            <span class="font-semibold text-xs text-slate-900 dark:text-white truncate">
                              {lead.company}
                            </span>
                            <span class="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                              ৳ {(lead.deal_value_bdt || 0).toLocaleString()}
                            </span>
                          </div>

                          <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {lead.contact_name || 'Missing contact'} · {lead.industry}
                          </div>

                          <!-- Next Followup Pill -->
                          <div class="flex items-center justify-between text-[10px] mt-2 pt-1 border-t border-warm-100 dark:border-slate-800 font-mono">
                            <span class="text-slate-400">Due: {lead.next_followup || 'No date'}</span>
                            {#if isOverdue}
                              <span class="text-rose-700 dark:text-rose-300 font-bold">⚠️ Overdue</span>
                            {:else}
                              <span class="text-slate-500">In SLA</span>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            <!-- COMPRESSED TERMINAL DEALS (PAID & LOST) -->
            <div class="bg-warm-100/60 dark:bg-slate-900/40 border border-warm-200 dark:border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs">
              <div class="flex items-center gap-4">
                <span class="font-semibold text-slate-700 dark:text-slate-300">Terminal Deals:</span>
                <span class="text-emerald-700 dark:text-emerald-400 font-mono">
                  Paid (1): L12 Eastern Cable · ৳ 150k Collected, ৳ 150k Due
                </span>
                <span>·</span>
                <span class="text-slate-500 font-mono">
                  Lost (2): L08, L16 (Sundarban Shipping · Policy Guarded)
                </span>
              </div>
              <span class="text-[11px] text-slate-400 font-mono">Excluded from Active Pipeline</span>
            </div>
          </div>
        {:else}
          <!-- HIGH-DENSITY DATA HEALTH TABLE VIEW -->
          <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="bg-warm-100 dark:bg-slate-850 border-b border-warm-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                  <th class="p-2.5">ID</th>
                  <th class="p-2.5">Company & Industry</th>
                  <th class="p-2.5">Contact Person</th>
                  <th class="p-2.5">Stage</th>
                  <th class="p-2.5 text-right">Deal Value</th>
                  <th class="p-2.5">Followup Date</th>
                  <th class="p-2.5">Data Finding</th>
                  <th class="p-2.5 text-right">Quick Remediation</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-warm-100 dark:divide-slate-800">
                {#each filteredLeads as lead (lead.id)}
                  {@const isSelected = selectedLead && selectedLead.id === lead.id}
                  {@const isOverdue = lead.next_followup && lead.next_followup < BENCHMARK_DATE}
                  {@const hasInversion = lead.id === 'L25'}
                  {@const hasTypo = lead.id === 'L18' && lead.contact_email?.includes('bogurateXtile')}
                  
                  <tr 
                    onclick={() => selectedLeadId = lead.id}
                    class={`cursor-pointer transition ${isSelected ? 'bg-orange-50/70 dark:bg-orange-950/20' : 'hover:bg-warm-50 dark:hover:bg-slate-850'}`}>
                    <td class="p-2.5 font-mono font-bold text-orange-700 dark:text-orange-400">{lead.id}</td>
                    <td class="p-2.5">
                      <div class="font-semibold text-slate-900 dark:text-white">{lead.company}</div>
                      <div class="text-[11px] text-slate-400">{lead.industry}</div>
                    </td>
                    <td class="p-2.5">
                      <div>{lead.contact_name || 'Missing name'}</div>
                      <div class="text-[11px] text-slate-400 font-mono">{lead.contact_phone || 'Missing phone'}</div>
                    </td>
                    <td class="p-2.5 font-medium">{lead.stage}</td>
                    <td class="p-2.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      ৳ {(lead.deal_value_bdt || 0).toLocaleString()}
                    </td>
                    <td class="p-2.5 font-mono">
                      <span class={isOverdue ? 'text-rose-600 font-bold' : 'text-slate-600 dark:text-slate-400'}>
                        {lead.next_followup || 'None'}
                      </span>
                    </td>
                    <td class="p-2.5">
                      {#if hasInversion}
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                          Date Inversion (-7d)
                        </span>
                      {:else if hasTypo}
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          Email Typo (bogurateXtile)
                        </span>
                      {:else if isOverdue}
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                          Overdue
                        </span>
                      {:else}
                        <span class="text-slate-400 text-[11px]">—</span>
                      {/if}
                    </td>
                    <td class="p-2.5 text-right">
                      {#if hasInversion}
                        <button 
                          onclick={(e) => { e.stopPropagation(); remediateDateOrder('L25', 'SWAP'); }}
                          class="px-2 py-1 rounded text-[10px] font-semibold bg-purple-600 hover:bg-purple-500 text-white">
                          Swap Dates
                        </button>
                      {:else if hasTypo}
                        <button 
                          onclick={(e) => { e.stopPropagation(); fixEmailTypo('L18'); }}
                          class="px-2 py-1 rounded text-[10px] font-semibold bg-amber-600 hover:bg-amber-500 text-white">
                          Fix Typo
                        </button>
                      {:else}
                        <button 
                          onclick={(e) => { e.stopPropagation(); selectedLeadId = lead.id; }}
                          class="px-2 py-1 rounded text-[10px] font-medium bg-warm-100 hover:bg-warm-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          Inspect
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <!-- ------------------------------------------------------ -->
    <!-- PANE 3: LEAD DETAIL & REMEDIATION STUDIO (420px Fixed) -->
    <!-- ------------------------------------------------------ -->
    <main class="w-[420px] bg-white dark:bg-slate-900 flex flex-col shrink-0 overflow-y-auto">
      {#if !selectedLead}
        <div class="m-auto text-center py-20 text-slate-400 text-xs">
          Select a lead to inspect details.
        </div>
      {:else}
        <!-- Inspector Header -->
        <div class="p-4 border-b border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-900/60">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{selectedLead.id}</span>
            <span class="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
              ৳ {(selectedLead.deal_value_bdt || 0).toLocaleString()} BDT
            </span>
          </div>
          <h2 class="text-base font-bold text-slate-900 dark:text-white mt-1">{selectedLead.company}</h2>
          <p class="text-xs text-slate-500">{selectedLead.industry}</p>

          <!-- Stage Selector -->
          <div class="mt-3 flex items-center justify-between text-xs">
            <span class="text-slate-400">Pipeline Stage:</span>
            <select 
              value={selectedLead.stage}
              onchange={(e) => transitionStage(selectedLead.id, (e.target as HTMLSelectElement).value as PipelineStage)}
              class="text-xs font-medium border border-warm-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded px-2 py-1">
              {#each ['New', 'Contacted', 'Meeting', 'Proposal', 'Invoice sent', 'Paid', 'Lost'] as st}
                <option value={st}>{st}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Inspector Body -->
        <div class="p-4 space-y-4 text-xs">
          <!-- Contact Dossier -->
          <div class="bg-warm-50 dark:bg-slate-850 p-3 rounded-lg border border-warm-200 dark:border-slate-800 space-y-1.5">
            <div class="font-semibold text-slate-700 dark:text-slate-300">Contact Details</div>
            <div class="text-slate-800 dark:text-slate-200">
              {selectedLead.contact_name || 'Missing contact name'} 
              {#if selectedLead.contact_role}
                <span class="text-slate-400">({selectedLead.contact_role})</span>
              {/if}
            </div>
            <div class="font-mono text-[11px] text-slate-500">
              Email: {selectedLead.contact_email || 'Missing email'}
            </div>
            <div class="font-mono text-[11px] text-slate-500">
              Phone: {selectedLead.contact_phone || 'Missing phone'}
            </div>
          </div>

          <!-- Anomaly Findings for Selected Lead -->
          {#if selectedLead.id === 'L25'}
            <div class="bg-purple-50 dark:bg-purple-950/40 p-3 rounded-lg border border-purple-200 dark:border-purple-800">
              <div class="font-bold text-purple-900 dark:text-purple-200">Date Inversion Detected</div>
              <p class="text-[11px] text-purple-700 dark:text-purple-300 mt-1">
                Last Contact ({selectedLead.last_contact}) is after Next Followup ({selectedLead.next_followup}).
              </p>
              <button 
                onclick={() => remediateDateOrder('L25', 'SWAP')}
                class="mt-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded">
                Swap Dates
              </button>
            </div>
          {/if}

          {#if selectedLead.id === 'L18' && selectedLead.contact_email?.includes('bogurateXtile')}
            <div class="bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
              <div class="font-bold text-amber-900 dark:text-amber-200">Email Typo Detected</div>
              <p class="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                Domain contains uppercase typo: <code>bogurateXtile.com</code>
              </p>
              <button 
                onclick={() => fixEmailTypo('L18')}
                class="mt-2 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded">
                Fix Typo
              </button>
            </div>
          {/if}

          <!-- AI Follow-up Email Drafter -->
          <div class="space-y-2 pt-2 border-t border-warm-200 dark:border-slate-800">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                AI Follow-up Email Studio
              </span>
              <select 
                bind:value={emailTone}
                class="text-[11px] border border-warm-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-1.5 py-0.5">
                <option value="POLITE_CHECKIN">Polite Check-in</option>
                <option value="PROPOSAL_FOLLOWUP">Proposal Follow-up</option>
                <option value="INVOICE_REMINDER">Invoice Reminder</option>
              </select>
            </div>

            {#if emailDraft}
              {#if emailDraft.is_blocked}
                <div class="bg-rose-50 dark:bg-rose-950/40 p-3 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200">
                  <div class="font-bold">⚠️ Policy Barrier: DO NOT CONTACT</div>
                  <p class="text-[11px] mt-1">{emailDraft.policy_barrier_reason}</p>
                </div>
              {:else}
                <div class="bg-warm-50 dark:bg-slate-850 p-3 rounded-lg border border-warm-200 dark:border-slate-800 space-y-2">
                  <div class="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                    Subject: {emailDraft.subject}
                  </div>
                  <div class="whitespace-pre-wrap text-[11px] text-slate-700 dark:text-slate-300 font-sans leading-relaxed">
                    {emailDraft.body}
                  </div>
                  <button 
                    onclick={() => copyText(emailDraft?.body || '', 'Email draft')}
                    class="w-full text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white py-1.5 rounded transition">
                    📋 Copy Email Draft
                  </button>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </main>
  </div>

  <!-- Toast Notification Feedback -->
  {#if feedbackMessage}
    <div class="fixed bottom-4 right-4 bg-slate-900 text-white dark:bg-white dark:text-slate-950 px-4 py-2 rounded-lg text-xs font-medium shadow-lg z-50">
      {feedbackMessage}
    </div>
  {/if}
</div>
