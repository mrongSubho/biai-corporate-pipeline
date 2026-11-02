<script lang="ts">
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
</script>

<div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
  <!-- TOP APP BAR -->
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-400 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20 text-lg font-mono">
          B2B
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold tracking-tight text-white text-base">BIAI Corporate Leads Pipeline</span>
            <span class="text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5 font-mono">
              <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
              Ref: 1 Nov 2026
            </span>
          </div>
          <p class="text-xs text-slate-400 font-normal">Automated Data Hygiene, Deduplication & Safe AST Copilot</p>
        </div>
      </div>
    </div>

    <!-- MODE SWITCHER TOGGLE (RAW DIRTY CSV VS. CLEANED VERIFIED PIPELINE) -->
    <div class="flex items-center bg-slate-850 p-1 rounded-xl border border-slate-800 shadow-inner">
      <button 
        onclick={() => viewMode = 'cleaned'}
        class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
          viewMode === 'cleaned' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
        }`}>
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        Cleaned Verified Mode (23 Leads · ৳3.17M)
      </button>

      <button 
        onclick={() => viewMode = 'raw'}
        class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
          viewMode === 'raw' ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30' : 'text-slate-400 hover:text-white'
        }`}>
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        Raw CSV Mode (25 Rows · ৳4.22M)
      </button>
    </div>

    <!-- ACTION BUTTONS -->
    <div class="flex items-center gap-2.5">
      <button 
        onclick={() => showHealthModal = true}
        class="text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
        <svg class="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        Data Health Center
        <span class="bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-bold text-[10px]">
          {auditResult.totalFindingsCount}
        </span>
      </button>

      <button 
        onclick={() => showDigestModal = true}
        class="text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
        <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        Priority Chase
      </button>

      <button 
        onclick={() => showCopilotModal = true}
        class="text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
        Deal Copilot (Cmd+K)
      </button>

      <button 
        onclick={exportCleanedCsv}
        class="text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
        <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        Export CSV
      </button>
    </div>
  </header>

  <!-- KPI SUMMARY STRIP -->
  <div class="bg-slate-900/50 border-b border-slate-800 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-2">
        <span class="text-slate-400">Total Leads:</span>
        <span class="font-bold text-white text-sm font-mono">{displayLeads.length}</span>
        {#if viewMode === 'cleaned'}
          <span class="text-[11px] text-emerald-400">(2 Duplicates Removed)</span>
        {:else}
          <span class="text-[11px] text-amber-400">(Includes 2 Duplicate Rows)</span>
        {/if}
      </div>
      <div class="h-4 w-[1px] bg-slate-800"></div>
      <div class="flex items-center gap-2">
        <span class="text-slate-400">Pipeline Deal Value:</span>
        <span class="font-bold text-emerald-400 text-sm font-mono">৳ {totalPipelineValue.toLocaleString()} BDT</span>
        {#if viewMode === 'raw'}
          <span class="text-[11px] text-rose-400 font-medium">(+৳ 1,050,000 Phantom Duplicate Revenue)</span>
        {/if}
      </div>
      <div class="h-4 w-[1px] bg-slate-800"></div>
      <div class="flex items-center gap-2">
        <span class="text-slate-400">Cash Received (L12 Advance):</span>
        <span class="font-bold text-sky-400 text-sm font-mono">৳ {cashCollected.toLocaleString()} BDT</span>
      </div>
      <div class="h-4 w-[1px] bg-slate-800"></div>
      <div class="flex items-center gap-2">
        <span class="text-slate-400">Outstanding Receivables:</span>
        <span class="font-bold text-amber-400 text-sm font-mono">৳ {cashOutstanding.toLocaleString()} BDT</span>
      </div>
    </div>

    <!-- Health Flags Alert Strip -->
    <div class="flex items-center gap-2">
      <span class="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 font-medium flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span>
        {overdueLeadsCount} Deals Overdue (&lt; 1 Nov)
      </span>
      <span class="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
        2 Duplicate Pairs (L01/L23, L02/L03)
      </span>
      <span class="px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 font-medium">
        L25 Date Inversion (-7d)
      </span>
    </div>
  </div>

  <!-- 7-STAGE PIPELINE BOARD (OFFICIAL ORDER) -->
  <main class="flex-1 p-6 overflow-x-auto">
    <div class="grid grid-cols-7 gap-3 min-w-[1400px] h-full items-start">
      {#each stages as stage}
        {@const stageLeads = displayLeads.filter(l => l.stage === stage)}
        {@const stageTotal = stageLeads.reduce((s, l) => s + (l.deal_value_bdt || 0), 0)}

        <div class="bg-slate-900/60 border border-slate-800/80 rounded-xl flex flex-col max-h-[calc(100vh-175px)] shadow-lg">
          <!-- Column Header -->
          <div class="p-3 border-b border-slate-800 bg-slate-900/80 rounded-t-xl flex items-center justify-between">
            <div>
              <span class="font-semibold text-xs text-white uppercase tracking-wider">{stage}</span>
              {#if stageTotal > 0}
                <p class="text-[11px] text-emerald-400 font-medium font-mono">৳ {stageTotal.toLocaleString()}</p>
              {/if}
            </div>
            <span class="text-xs font-semibold bg-slate-800 text-slate-300 w-5 h-5 rounded-full flex items-center justify-center font-mono">
              {stageLeads.length}
            </span>
          </div>

          <!-- Column Cards -->
          <div class="p-2 overflow-y-auto space-y-2 flex-1">
            {#if stageLeads.length === 0}
              <div class="py-8 text-center text-slate-600 text-xs italic">
                No deals in {stage}
              </div>
            {:else}
              {#each stageLeads as lead (lead.id)}
                {@const isOverdue = lead.next_followup && lead.next_followup < BENCHMARK_DATE && stage !== 'Lost' && stage !== 'Paid'}
                {@const isDuplicate = lead.id === 'L03' || lead.id === 'L23'}
                {@const isDateError = lead.id === 'L25'}
                {@const isPartialPaid = lead.id === 'L12'}

                <div 
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => { if (e.key === 'Enter') openEmailStudio(lead); }}
                  onclick={() => openEmailStudio(lead)}
                  class={`bg-slate-850 hover:bg-slate-800 border rounded-xl p-3 transition shadow-sm hover:shadow-md cursor-pointer flex flex-col gap-2 text-left ${
                    isDuplicate ? 'border-amber-500/40 bg-amber-950/20' :
                    isDateError ? 'border-purple-500/40 bg-purple-950/20' :
                    isOverdue ? 'border-rose-500/40' :
                    'border-slate-700/60'
                  }`}>

                  <!-- Card Header: ID, Company, Industry -->
                  <div class="flex items-start justify-between gap-1.5">
                    <div>
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-[10px] font-bold text-slate-400 font-mono bg-slate-800 px-1.5 py-0.5 rounded">
                          {lead.id}
                        </span>
                        <span class="font-bold text-xs text-white hover:text-blue-400 transition">
                          {lead.company}
                        </span>
                      </div>
                      {#if lead.contact_name}
                        <p class="text-[11px] text-slate-400 font-normal mt-0.5">
                          {lead.contact_name} {lead.contact_role ? `· ${lead.contact_role}` : ''}
                        </p>
                      {:else}
                        <p class="text-[11px] text-amber-400 font-medium mt-0.5">⚠️ No contact name on file</p>
                      {/if}
                    </div>

                    <span class="text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      {lead.industry}
                    </span>
                  </div>

                  <!-- Deal Value & Payment Status -->
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-bold text-emerald-400 font-mono">
                      {lead.deal_value_bdt > 0 ? `৳ ${lead.deal_value_bdt.toLocaleString()} BDT` : 'No Value Agreed'}
                    </span>
                    {#if isPartialPaid}
                      <span class="text-[10px] font-bold bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded border border-sky-500/30">
                        50% Paid (৳150k due)
                      </span>
                    {/if}
                  </div>

                  <!-- Notes Snippet -->
                  <p class="text-[11px] text-slate-300 line-clamp-2 italic bg-slate-900/60 p-1.5 rounded border border-slate-800/80">
                    "{lead.notes}"
                  </p>

                  <!-- Card Bottom: Dates & Anomaly Badges -->
                  <div class="flex items-center justify-between pt-1 border-t border-slate-800 text-[10px]">
                    <div class="flex items-center gap-1">
                      <span class="text-slate-500">Next:</span>
                      <span class={`font-mono ${isOverdue ? 'text-rose-400 font-bold' : 'text-slate-300'}`}>
                        {lead.next_followup || 'None'}
                      </span>
                    </div>

                    {#if isOverdue}
                      <span class="bg-rose-500/20 text-rose-300 font-bold px-1.5 py-0.5 rounded border border-rose-500/30 animate-pulse">
                        Overdue
                      </span>
                    {:else if isDuplicate}
                      <span class="bg-amber-500/20 text-amber-300 font-bold px-1.5 py-0.5 rounded border border-amber-500/30">
                        Duplicate
                      </span>
                    {:else if isDateError}
                      <span class="bg-purple-500/20 text-purple-300 font-bold px-1.5 py-0.5 rounded border border-purple-500/30">
                        Date Inversion
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

  <!-- DATA HEALTH & DEDUPLICATION STUDIO MODAL -->
  {#if showHealthModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        role="button"
        tabindex="-1"
        aria-label="Close Health Modal"
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
        onkeydown={(e) => { if (e.key === 'Escape') showHealthModal = false; }}
        onclick={() => showHealthModal = false}>
      </div>

      <div class="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
              Automated Data Health & Deduplication Studio
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">
              Programmatic diagnosis of duplicates, chronological errors, and financial contradictions ({auditResult.uniqueLeadsFlaggedCount} Unique Leads Flagged / {auditResult.totalFindingsCount} Total Findings)
            </p>
          </div>
          <button 
            onclick={() => showHealthModal = false}
            class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <div class="space-y-6 py-4 text-xs">
          <!-- 1. DUPLICATE ACCOUNT RESOLUTION (L01/L23 and L02/L03) -->
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white uppercase tracking-wider text-[11px] flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                1. Duplicate Account Clusters (2 Pairs / 4 Rows Affected)
              </span>
              <span class="text-emerald-400 font-bold font-mono text-xs">
                -৳ 1,050,000 BDT Phantom Pipeline Removed upon Merge
              </span>
            </div>

            <!-- Cluster 1: Padma Textiles (L01 vs L23) -->
            <div class="bg-slate-900 p-3.5 rounded-lg border border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-white text-sm">Padma Textiles Ltd</span>
                  <span class="text-slate-400">· Exact Match on Company & Contact (Rafiq Uddin, 01711-200101)</span>
                </div>
                <p class="text-[11px] text-slate-400 mt-1">
                  Canonical: <strong class="text-slate-200 font-mono">L01</strong> (Meeting, ৳350k) ⟵ Duplicate: <strong class="text-amber-400 font-mono">L23</strong> (Meeting, ৳350k)
                </p>
              </div>

              {#if leads.find(l => l.id === 'L23')?.is_archived}
                <div class="flex items-center gap-2">
                  <span class="text-emerald-400 font-bold text-xs">Merged ✓</span>
                  <button 
                    onclick={() => unmergeDuplicate('L23')}
                    class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs border border-slate-700">
                    Unmerge Revert
                  </button>
                </div>
              {:else}
                <button 
                  onclick={() => mergeDuplicate('L23', 'L01')}
                  class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs shadow-md shadow-emerald-600/20">
                  Merge L23 into L01 (-৳350k)
                </button>
              {/if}
            </div>

            <!-- Cluster 2: Meghna Pharma (L02 vs L03) -->
            <div class="bg-slate-900 p-3.5 rounded-lg border border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-white text-sm">Meghna Pharma Ltd vs Meghna Pharmaceuticals</span>
                  <span class="text-slate-400">· Fuzzy Match on Company & Exact Contact (Dr. Sultana Begum)</span>
                </div>
                <p class="text-[11px] text-slate-400 mt-1">
                  Canonical: <strong class="text-slate-200 font-mono">L02</strong> (Proposal, ৳700k) ⟵ Duplicate: <strong class="text-amber-400 font-mono">L03</strong> (Proposal, ৳700k)
                </p>
              </div>

              {#if leads.find(l => l.id === 'L03')?.is_archived}
                <div class="flex items-center gap-2">
                  <span class="text-emerald-400 font-bold text-xs">Merged ✓</span>
                  <button 
                    onclick={() => unmergeDuplicate('L03')}
                    class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs border border-slate-700">
                    Unmerge Revert
                  </button>
                </div>
              {:else}
                <button 
                  onclick={() => mergeDuplicate('L03', 'L02')}
                  class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs shadow-md shadow-emerald-600/20">
                  Merge L03 into L02 (-৳700k)
                </button>
              {/if}
            </div>
          </div>

          <!-- 2. CHRONOLOGICAL DATE ORDER ERROR (L25 Sylhet Hospitality) -->
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white uppercase tracking-wider text-[11px] flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-purple-400"></span>
                2. Chronological Causality Inversion (L25 Sylhet Hospitality Group)
              </span>
              <span class="text-purple-400 font-mono text-xs">Violation: Next Follow-up &lt; Last Contact</span>
            </div>

            <div class="bg-slate-900 p-3.5 rounded-lg border border-slate-800 flex items-center justify-between gap-4">
              <div>
                <p class="text-slate-200">
                  Last Contact: <strong class="font-mono text-white">{l25?.last_contact}</strong> · Next Follow-up: <strong class="font-mono text-rose-400">{l25?.next_followup}</strong>
                </p>
                <p class="text-slate-400 text-[11px] mt-0.5">
                  A follow-up cannot occur in the past before the contact date. Select an audited remediation strategy:
                </p>
              </div>

              <div class="flex items-center gap-2">
                <button 
                  onclick={() => remediateDateOrder('L25', 'SWAP')}
                  class="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs border border-slate-700">
                  Swap Fields (21 Oct ⟷ 28 Oct)
                </button>
                <button 
                  onclick={() => remediateDateOrder('L25', 'RESCHEDULE')}
                  class="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded text-xs font-semibold">
                  Reschedule to 4 Nov (+7d)
                </button>
              </div>
            </div>
          </div>

          <!-- 3. EMAIL TYPO & STAGE SEMANTICS (L18, L12) -->
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <span class="font-bold text-white uppercase tracking-wider text-[11px] flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-sky-400"></span>
              3. Data Formatting & Payment Semantics (L18, L12)
            </span>

            <div class="grid grid-cols-2 gap-3">
              <!-- L18 Email Typo -->
              <div class="bg-slate-900 p-3 rounded-lg border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <span class="font-bold text-white">L18 (Bogura Textile Mills)</span>
                  <p class="text-[11px] text-slate-400 font-mono mt-0.5">{l18?.contact_email}</p>
                </div>
                {#if l18?.contact_email?.includes('bogurateXtile')}
                  <button 
                    onclick={() => fixEmailTypo('L18')}
                    class="bg-blue-600 hover:bg-blue-500 text-white py-1 rounded text-xs font-medium">
                    Auto-Fix Domain Typo ('boguratextile')
                  </button>
                {:else}
                  <span class="text-emerald-400 font-bold text-xs">Normalized ✓</span>
                {/if}
              </div>

              <!-- L12 Partial Payment -->
              <div class="bg-slate-900 p-3 rounded-lg border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <span class="font-bold text-white">L12 (Eastern Cable Industries)</span>
                  <p class="text-[11px] text-slate-400 mt-0.5">Marked "Paid", but source notes confirm only 50% advance received.</p>
                </div>
                <div class="flex items-center justify-between text-xs font-mono bg-slate-950 p-1.5 rounded">
                  <span class="text-emerald-400">Collected: ৳150,000</span>
                  <span class="text-amber-400">Due: ৳150,000</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-800 text-right">
          <button 
            onclick={() => showHealthModal = false}
            class="bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs px-4 py-2 rounded-xl transition">
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
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
        onkeydown={(e) => { if (e.key === 'Escape') showCopilotModal = false; }}
        onclick={() => showCopilotModal = false}>
      </div>

      <div class="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
              Natural Language Deal Copilot (Safe AST Compiler)
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">Ask plain English questions without risk of raw SQL injection or math hallucinations</p>
          </div>
          <button 
            onclick={() => showCopilotModal = false}
            class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <!-- Preset Questions -->
        <div class="py-3 flex items-center gap-2 flex-wrap border-b border-slate-800">
          <span class="text-xs text-slate-500 font-medium">Quick Queries:</span>
          <button 
            onclick={() => runCopilot('What is the total value in Proposal stage?')}
            class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2.5 py-1 rounded-lg">
            Proposal Stage Value?
          </button>
          <button 
            onclick={() => runCopilot('Which deals are overdue?')}
            class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2.5 py-1 rounded-lg">
            Overdue Deals?
          </button>
          <button 
            onclick={() => runCopilot('Show me all garment and pharma leads')}
            class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2.5 py-1 rounded-lg">
            Garments & Pharma?
          </button>
          <button 
            onclick={() => runCopilot('Which leads have data errors or duplicates?')}
            class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2.5 py-1 rounded-lg">
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
            class="flex-1 bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none" />
          <button 
            onclick={() => runCopilot(copilotQuestion)}
            class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold">
            Query Engine
          </button>
        </div>

        <!-- Copilot Answer & AST Diagnostics -->
        {#if copilotResult}
          <div class="space-y-4 pt-2">
            <!-- Structured Answer Card -->
            <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white uppercase tracking-wider">Answer & Result</span>
                {#if copilotResult.cleaned_result.scalar !== undefined}
                  <span class="text-lg font-bold text-emerald-400 font-mono">
                    ৳ {copilotResult.cleaned_result.scalar.toLocaleString()} BDT
                  </span>
                {:else}
                  <span class="text-xs font-mono text-slate-300">
                    {copilotResult.cleaned_result.total_count} Deals Matched (৳ {copilotResult.cleaned_result.total_value_bdt.toLocaleString()} BDT)
                  </span>
                {/if}
              </div>

              <!-- Dual-Truth Variance Banner (if available) -->
              {#if copilotResult.raw_variance}
                <div class="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg text-xs space-y-1">
                  <span class="font-bold text-amber-300 block">Dual-Truth Financial Variance:</span>
                  <p class="text-slate-300 leading-relaxed">
                    {copilotResult.raw_variance.variance_explanation}
                  </p>
                </div>
              {/if}

              <!-- Lead List (if table or filter) -->
              {#if copilotResult.cleaned_result.leads.length > 0}
                <div class="max-h-48 overflow-y-auto space-y-1.5 pt-2 border-t border-slate-800">
                  {#each copilotResult.cleaned_result.leads as match}
                    <div class="flex items-center justify-between bg-slate-900 p-2 rounded text-xs">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-[10px] text-slate-400 bg-slate-800 px-1 rounded">{match.id}</span>
                        <span class="font-bold text-white">{match.company}</span>
                        <span class="text-slate-400 text-[11px]">({match.stage} · {match.industry})</span>
                      </div>
                      <span class="font-mono text-emerald-400 font-bold">৳ {match.deal_value_bdt.toLocaleString()}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- AST Compiler Representation (Shows Strict Security Execution) -->
            <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-400">
              <span class="text-slate-500 block mb-1">Validated AST Query Contract:</span>
              <pre class="overflow-x-auto text-blue-300">{JSON.stringify(copilotResult.ast, null, 2)}</pre>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- AI B2B FOLLOW-UP EMAIL STUDIO MODAL -->
  {#if showEmailModal && selectedLead}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        role="button"
        tabindex="-1"
        aria-label="Close Email Modal"
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
        onkeydown={(e) => { if (e.key === 'Escape') showEmailModal = false; }}
        onclick={() => showEmailModal = false}>
      </div>

      <div class="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              AI B2B Follow-up Email Drafter
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">
              Target: <strong class="text-white">{selectedLead.company}</strong> ({selectedLead.contact_name || 'Contact missing'} · {selectedLead.stage})
            </p>
          </div>
          <button 
            onclick={() => showEmailModal = false}
            class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
        </div>

        {#if emailDraft}
          <div class="space-y-4 py-4 text-xs">
            <!-- POLICY BARRIER ALERT (L16 Lost do not contact) -->
            {#if emailDraft.isBlocked}
              <div class="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl space-y-2">
                <span class="font-bold text-rose-300 text-sm flex items-center gap-2">
                  <svg class="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                  DO NOT CONTACT COMPLIANCE BARRIER
                </span>
                <p class="text-rose-200/90 leading-relaxed">
                  {emailDraft.barrierReason}
                </p>
                <p class="text-[11px] text-slate-400 italic">
                  Note on lead: "{selectedLead.notes}"
                </p>
              </div>
            {:else}
              <!-- Tone Selector -->
              <div class="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800">
                <span class="text-slate-400 text-xs font-medium pl-1">Email Tone:</span>
                <select 
                  bind:value={emailTone}
                  onchange={generateEmail}
                  class="bg-slate-900 text-xs text-slate-200 border border-slate-700 rounded-lg px-2 py-1 focus:outline-none">
                  <option value="POLITE_CHECKIN">Polite Check-in</option>
                  <option value="PROPOSAL_FOLLOWUP">Proposal Follow-up</option>
                  <option value="INVOICE_REMINDER">Invoice Advance Reminder</option>
                </select>
              </div>

              <!-- Mandatory Bank Checklist (L22 Khulna Jute) -->
              {#if emailDraft.requiresBankChecklist}
                <div class="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl space-y-2">
                  <span class="font-bold text-amber-300 flex items-center gap-1.5">
                    ⚠️ Pre-Chase Accounting Checklist Required
                  </span>
                  <label class="flex items-center gap-2 text-slate-200 cursor-pointer">
                    <input type="checkbox" bind:checked={bankConfirmed} class="rounded border-slate-700 text-blue-600 focus:ring-0" />
                    <span>I have checked the bank statement with accounts and confirmed the ৳150k payment has not arrived yet.</span>
                  </label>
                </div>
              {/if}

              <!-- Email Subject & Body -->
              <div class="space-y-3">
                <div>
                  <span class="text-slate-400 block text-[11px] mb-1 font-semibold uppercase">Subject</span>
                  <input 
                    type="text" 
                    bind:value={emailDraft.subject}
                    class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100 font-medium" />
                </div>

                <div>
                  <span class="text-slate-400 block text-[11px] mb-1 font-semibold uppercase">Body (Approval-Only Draft)</span>
                  <textarea 
                    bind:value={emailDraft.body}
                    rows="9"
                    class="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-100 font-mono leading-relaxed"></textarea>
                </div>
              </div>

              <!-- Warnings / Normalizations -->
              {#if emailDraft.warnings.length > 0}
                <div class="text-[11px] text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                  {#each emailDraft.warnings as w}
                    <p>• {w}</p>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>

          <div class="pt-3 border-t border-slate-800 flex items-center justify-between">
            <span class="text-[11px] text-slate-500">Status: DRAFT_PENDING_APPROVAL</span>

            <div class="flex items-center gap-2">
              {#if !emailDraft.isBlocked}
                <button 
                  disabled={emailDraft.requiresBankChecklist && !bankConfirmed}
                  onclick={() => copyText(emailDraft?.body || '')}
                  class={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    emailDraft.requiresBankChecklist && !bankConfirmed ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}>
                  {copySuccess ? 'Copied to Clipboard! ✓' : 'Approve & Copy'}
                </button>

                {#if selectedLead.contact_email}
                  <a 
                    href={`mailto:${emailDraft.recipientEmail}?subject=${encodeURIComponent(emailDraft.subject)}&body=${encodeURIComponent(emailDraft.body)}`}
                    class={`px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white ${
                      emailDraft.requiresBankChecklist && !bankConfirmed ? 'pointer-events-none opacity-50' : ''
                    }`}>
                    Open in Mail App
                  </a>
                {/if}
              {/if}

              <button 
                onclick={() => showEmailModal = false}
                class="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-xl text-xs">
                Close
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- PRIORITY DEAL CHASE DIGEST MODAL -->
  {#if showDigestModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        role="button"
        tabindex="-1"
        aria-label="Close Digest Modal"
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
        onkeydown={(e) => { if (e.key === 'Escape') showDigestModal = false; }}
        onclick={() => showDigestModal = false}>
      </div>

      <div class="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl z-10">
        <div class="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              Weekly Deal Priority Chase Digest
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">Ranked recommendations on which B2B deals to chase first (Benchmark: 1 Nov 2026)</p>
          </div>
          <button 
            onclick={() => showDigestModal = false}
            class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <div class="space-y-3 py-4 text-xs">
          <!-- Priority 1: Oriental Bank Ops -->
          <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-rose-500/20 text-rose-300 font-bold px-1.5 py-0.5 rounded text-[10px]">P1 CRITICAL</span>
                <span class="font-bold text-white text-sm">L10 · Oriental Bank Branch Ops</span>
              </div>
              <p class="text-slate-300 mt-1">
                Meeting concluded Oct 26. Client explicitly requested a written proposal with 3 options. Overdue by 2 days — nobody sent it yet!
              </p>
            </div>
            <span class="font-mono text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 500,000</span>
          </div>

          <!-- Priority 2: Bengal Solar Systems -->
          <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-amber-500/20 text-amber-300 font-bold px-1.5 py-0.5 rounded text-[10px]">P2 DUE TOMORROW</span>
                <span class="font-bold text-white text-sm">L07 · Bengal Solar Systems</span>
              </div>
              <p class="text-slate-300 mt-1">
                Invoice sent Oct 30. Payment due tomorrow (2 Nov). Verify whether advance has come into bank.
              </p>
            </div>
            <span class="font-mono text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 250,000</span>
          </div>

          <!-- Priority 3: Khulna Jute Works -->
          <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-amber-500/20 text-amber-300 font-bold px-1.5 py-0.5 rounded text-[10px]">P3 INVOICE OVERDUE</span>
                <span class="font-bold text-white text-sm">L22 · Khulna Jute Works</span>
              </div>
              <p class="text-slate-300 mt-1">
                Invoice sent 17 Oct. Overdue by 8 days. Note: Confirm bank receipt before calling accounts director.
              </p>
            </div>
            <span class="font-mono text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 150,000</span>
          </div>

          <!-- Priority 4: Meghna Pharma Ltd -->
          <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="bg-blue-500/20 text-blue-300 font-bold px-1.5 py-0.5 rounded text-[10px]">P4 LARGEST DEAL</span>
                <span class="font-bold text-white text-sm">L02 · Meghna Pharma Ltd</span>
              </div>
              <p class="text-slate-300 mt-1">
                Proposal submitted. Budget approval meeting next week. Prepare Bangla curriculum support brochure requested by Dr. Sultana Begum.
              </p>
            </div>
            <span class="font-mono text-emerald-400 font-bold text-sm whitespace-nowrap">৳ 700,000</span>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
          <label class="flex items-center gap-2 text-slate-400 cursor-pointer">
            <input type="checkbox" bind:checked={maskPiiOnExport} class="rounded border-slate-700 text-blue-600" />
            <span>Mask PII (emails/phones) on CSV export</span>
          </label>

          <button 
            onclick={() => showDigestModal = false}
            class="bg-slate-800 hover:bg-slate-700 text-white font-medium px-4 py-2 rounded-xl transition">
            Close Summary
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
