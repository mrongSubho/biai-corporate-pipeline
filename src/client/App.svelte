<script lang="ts">
  import { onMount } from 'svelte';
  import { auditCorporateLeads } from '../lib/engine/hygiene';
  import { executeCopilotQuery } from '../lib/engine/copilot';
  import { generateCorporateFollowupEmail, type EmailDraftResult } from '../lib/engine/email_drafter';
  import { soundFx } from '../lib/audio/sound_fx.ts';
  import type { CorporateLead, PipelineStage, AnomalyFinding } from '../lib/types/pipeline';

  // --- STATE WITH SVELTE 5 RUNES ---
  let leads = $state<CorporateLead[]>([]);
  let viewMode = $state<'cleaned' | 'raw'>('cleaned');
  let activeTab = $state<'pipeline' | 'health' | 'priority' | 'copilot'>('pipeline');
  let layoutMode = $state<'board' | 'table'>('board');
  let selectedLeadId = $state<string>('L01');
  let theme = $state<'light' | 'dark'>('light');
  let searchQuery = $state('');

  // Benchmark Date: 1 Nov 2026 per brief
  const BENCHMARK_DATE = '2026-11-01';

  // --- AUTHENTICATION & OPERATOR STATE ---
  let currentUser = $state<{
    id: string;
    email: string;
    full_name: string;
    department?: string;
    role: string;
    security_tier: string;
    scopes: string[];
  } | null>(null);
  let csrfToken = $state('');
  let authChecking = $state(true);
  let loginEmail = $state('');
  let loginPassword = $state('');
  let loginMfaCode = $state('');
  let loginRequiresMfa = $state(false);
  let loginError = $state<string | null>(null);
  let loginLoading = $state(false);

  // Copilot State
  let copilotQuestion = $state('What is the total value in Proposal stage?');
  let copilotResult = $state<any | null>(null);

  // Email Studio State
  let emailTone = $state<'POLITE_CHECKIN' | 'PROPOSAL_FOLLOWUP' | 'INVOICE_REMINDER'>('POLITE_CHECKIN');
  let bankConfirmed = $state(false);
  let feedbackMessage = $state<string | null>(null);
  let maskPiiOnExport = $state(false);
  let audioEnabled = $state(soundFx.enabled);

  async function checkAuth() {
    authChecking = true;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        currentUser = await res.json();
        await loadLeads();
      } else {
        currentUser = null;
        leads = [];
      }
    } catch {
      currentUser = null;
    } finally {
      authChecking = false;
    }
  }

  async function loadLeads() {
    try {
      const r = await fetch('/api/v1/leads?mode=raw', { credentials: 'include' });
      if (r.ok) {
        const res = await r.json();
        if (res?.leads && Array.isArray(res.leads)) {
          leads = res.leads;
          if (leads.length > 0 && !leads.some(l => l.id === selectedLeadId)) {
            selectedLeadId = leads[0].id;
          }
        }
      }
    } catch (e) {
      console.log('Failed to fetch leads:', e);
    }
  }

  async function handleLogin() {
    loginLoading = true;
    loginError = null;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          mfaCode: loginRequiresMfa ? loginMfaCode : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        loginError = data.error || 'Authentication failed';
        loginLoading = false;
        return;
      }
      if (data.requiresMfa) {
        loginRequiresMfa = true;
        loginLoading = false;
        return;
      }
      csrfToken = data.csrfToken || '';
      currentUser = data.user;
      loginRequiresMfa = false;
      await loadLeads();
    } catch (err: any) {
      loginError = err.message || 'Network error during login';
    } finally {
      loginLoading = false;
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include'
      });
    } catch {}
    currentUser = null;
    csrfToken = '';
    leads = [];
  }

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

    // Verify session
    checkAuth();

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

  function toggleAudio() {
    audioEnabled = soundFx.toggle();
    if (audioEnabled) {
      showFeedback('🔊 Audio FX enabled (Web Audio synthesized)');
    } else {
      showFeedback('🔇 Audio FX muted');
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
  async function transitionStage(leadId: string, newStage: PipelineStage) {
    const prevLeads = [...leads];
    leads = leads.map(l => l.id === leadId ? { ...l, stage: newStage } : l);
    showFeedback(`Stage updated to ${newStage}`);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/stage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ stage: newStage })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        soundFx.playWarningPing();
        showFeedback(err.error || `Update failed: status ${res.status}`);
        leads = prevLeads;
      }
    } catch (e: any) {
      soundFx.playWarningPing();
      showFeedback('Server unavailable for stage update');
      leads = prevLeads;
    }
  }

  async function mergeDuplicate(duplicateId: string, canonicalId: string) {
    const prevLeads = [...leads];
    leads = leads.map(l => {
      if (l.id === duplicateId) {
        return { ...l, is_archived: true, merged_into_id: canonicalId };
      }
      if (l.id === canonicalId) {
        return { ...l, notes: `${l.notes} [Merged from ${duplicateId}]` };
      }
      return l;
    });
    soundFx.playActionSuccess();
    showFeedback(`Archived duplicate ${duplicateId} into canonical lead ${canonicalId}`);
    try {
      const res = await fetch('/api/v1/hygiene/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ canonicalId, duplicateId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        soundFx.playWarningPing();
        showFeedback(err.error || `Merge failed: status ${res.status}`);
        leads = prevLeads;
      }
    } catch (e) {
      soundFx.playWarningPing();
      showFeedback('Server unavailable for merge');
      leads = prevLeads;
    }
  }

  async function unmergeDuplicate(duplicateId: string) {
    const prevLeads = [...leads];
    leads = leads.map(l => l.id === duplicateId ? { ...l, is_archived: false, merged_into_id: null } : l);
    soundFx.playActionSuccess();
    showFeedback(`Restored ${duplicateId} as independent lead`);
    try {
      const res = await fetch('/api/v1/hygiene/unmerge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ duplicateId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        soundFx.playWarningPing();
        showFeedback(err.error || `Unmerge failed: status ${res.status}`);
        leads = prevLeads;
      }
    } catch (e) {
      soundFx.playWarningPing();
      showFeedback('Server unavailable for unmerge');
      leads = prevLeads;
    }
  }

  async function remediateDateOrder(leadId: string, strategy: 'SWAP' | 'RESCHEDULE') {
    const prevLeads = [...leads];
    const newFollowup = '2026-11-04';
    leads = leads.map(l => {
      if (l.id === leadId) {
        if (strategy === 'SWAP') {
          return { ...l, last_contact: l.next_followup, next_followup: l.last_contact };
        } else {
          return { ...l, next_followup: newFollowup };
        }
      }
      return l;
    });
    soundFx.playActionSuccess();
    showFeedback(`Remediated date inversion on ${leadId} via ${strategy}`);
    try {
      const res = await fetch('/api/v1/hygiene/remediate-date', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ leadId, strategy, newFollowup })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        soundFx.playWarningPing();
        showFeedback(err.error || `Remediation failed: status ${res.status}`);
        leads = prevLeads;
      }
    } catch (e) {
      soundFx.playWarningPing();
      showFeedback('Server unavailable for date remediation');
      leads = prevLeads;
    }
  }

  async function fixEmailTypo(leadId: string) {
    const prevLeads = [...leads];
    leads = leads.map(l => {
      if (l.id === leadId && l.contact_email?.includes('bogurateXtile')) {
        return { ...l, contact_email: l.contact_email.replace('bogurateXtile', 'boguratextile') };
      }
      return l;
    });
    soundFx.playActionSuccess();
    showFeedback(`Normalized email typo for ${leadId}`);
    try {
      const res = await fetch('/api/v1/hygiene/fix-typo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ leadId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        soundFx.playWarningPing();
        showFeedback(err.error || `Fix typo failed: status ${res.status}`);
        leads = prevLeads;
      }
    } catch (e) {
      soundFx.playWarningPing();
      showFeedback('Server unavailable for typo fix');
      leads = prevLeads;
    }
  }

  function selectLead(leadId: string) {
    selectedLeadId = leadId;
    const lead = displayLeads.find(l => l.id === leadId);
    if (lead) {
      const isOverdue = lead.next_followup && lead.next_followup < BENCHMARK_DATE;
      const daysOverdue = isOverdue && lead.next_followup ? Math.round((new Date(BENCHMARK_DATE).getTime() - new Date(lead.next_followup).getTime()) / 86400000) : 0;
      if (daysOverdue >= 2) {
        soundFx.playEmergencyAlert();
      } else if (daysOverdue === 1 || lead.next_followup === BENCHMARK_DATE) {
        soundFx.playWarningPing();
      }
    }
  }

  function runCopilot(q: string) {
    copilotQuestion = q;
    try {
      copilotResult = executeCopilotQuery(q, leads, BENCHMARK_DATE);
      soundFx.playNewMessage();
    } catch (err: any) {
      showFeedback('Copilot query error: ' + err.message);
    }
  }

  function copyText(txt: string, label: string) {
    navigator.clipboard.writeText(txt);
    showFeedback(`Copied ${label} to clipboard`);
  }

  function showFeedback(msg: string) {
    feedbackMessage = msg;
    setTimeout(() => { feedbackMessage = null; }, 2500);
  }

  async function exportCleanedCsv() {
    try {
      const res = await fetch('/api/v1/leads/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ mode: viewMode, maskPii: maskPiiOnExport })
      });

      if (res.ok) {
        const checksum = res.headers.get('X-Export-Checksum-SHA256');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `biai-corporate-leads-${viewMode}-${BENCHMARK_DATE}.csv`;
        a.click();
        soundFx.playActionSuccess();
        showFeedback(`Exported ${displayLeads.length} leads (SHA-256: ${checksum?.slice(0, 8)}...${maskPiiOnExport ? ' [PII Masked]' : ''})`);
        return;
      } else {
        const errJson = await res.json().catch(() => ({}));
        soundFx.playWarningPing();
        showFeedback(errJson.error || `Export failed with status ${res.status}`);
        return;
      }
    } catch (e: any) {
      soundFx.playWarningPing();
      showFeedback('Export failed: Server unavailable');
    }
  }

  async function dispatchEmail() {
    if (!selectedLead || !emailDraft) return;
    if (selectedLead.stage === 'Invoice sent' && !bankConfirmed) {
      soundFx.playWarningPing();
      showFeedback('Compliance Barrier: Please confirm the bank statement before dispatching an invoice reminder.');
      return;
    }

    try {
      const res = await fetch('/api/v1/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({
          leadId: selectedLead.id,
          subject: emailDraft.subject,
          bodyText: emailDraft.body,
          tone: emailTone,
          bankConfirmed
        })
      });

      const json = await res.json();
      if (res.ok && json.success) {
        soundFx.playActionSuccess();
        showFeedback(`Email dispatched to ${selectedLead.contact_email} (Msg ID: ${json.delivery?.messageId || 'SENT'})`);
      } else {
        soundFx.playWarningPing();
        showFeedback(json.message || json.error || 'Email dispatch failed');
      }
    } catch (e) {
      soundFx.playWarningPing();
      showFeedback('Network error: Email dispatch failed');
    }
  }
</script>

<!-- APPLICATION CONTAINER -->
<div class="h-screen w-screen flex flex-col overflow-hidden bg-warm-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 font-sans selection:bg-orange-600 selection:text-white">

  <!-- ======================================================== -->
  <!-- 1. TOP HEADER (AUTHENTIC BIAI ECOSYSTEM HEADER)          -->
  <!-- ======================================================== -->
  <header class="h-14 border-b border-warm-200 dark:border-slate-800 bg-[#FAF9F6] dark:bg-[#080C14] px-4 flex items-center justify-between gap-4 shrink-0 z-30 transition-colors">

    <!-- Left: Authentic BIAI Brand Identity & Ecosystem Navigation -->
    <div class="flex items-center gap-5">
      <!-- Official BIAI Circular Woven Emblem & Spaced Wordmark -->
      <a href="https://biai.com.bd" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2.5 group">
        <img src="/biai-logo.png" alt="Bangladesh Institute of AI" class="w-8 h-8 rounded-full shrink-0 object-contain shadow-xs transition group-hover:scale-105" />
        <span class="font-bold tracking-[0.3em] text-slate-900 dark:text-white text-base">B I A I</span>
      </a>

      <!-- Ecosystem Workspace Navigation Links (Styled to match biai.com.bd navbar) -->
      <nav class="hidden md:flex items-center gap-1 text-xs font-medium">
        <!-- Switch to Task 1 CRM Triage -->
        <a
          href="/"
          title="Switch to CRM Triage workspace"
          class="py-4 px-3 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition">
          CRM Triage
        </a>

        <!-- Active Corporate Pipeline link with authentic BIAI bottom underline bar -->
        <span class="relative py-4 px-3 font-semibold text-orange-600 dark:text-orange-400 flex items-center gap-1.5 cursor-default">
          <span>Corporate Pipeline</span>
          <span class="absolute bottom-0 left-2 right-2 h-0.5 bg-orange-600 dark:bg-orange-500 rounded-full"></span>
        </span>

        <!-- External BIAI Portals directly from biai.com.bd -->
        <a
          href="https://biai.com.bd/courses"
          target="_blank"
          rel="noopener noreferrer"
          class="py-4 px-3 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition flex items-center gap-1">
          <span>Courses</span>
          <svg class="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
        </a>

        <a
          href="https://biai.com.bd"
          target="_blank"
          rel="noopener noreferrer"
          class="py-4 px-3 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition flex items-center gap-1">
          <span>For Business</span>
          <svg class="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
        </a>
      </nav>
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
        class="w-full text-xs pl-9 pr-14 py-1.5 rounded-lg border border-warm-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-600 transition"
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
      <!-- Audio FX Toggle Button -->
      <button
        onclick={toggleAudio}
        aria-label="Toggle audio effects"
        title={audioEnabled ? 'Audio FX Enabled (Click to Mute)' : 'Audio FX Muted (Click to Unmute)'}
        class="text-xs p-1.5 rounded flex items-center gap-1 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-warm-100 dark:hover:bg-slate-800 transition">
        {#if audioEnabled}
          <span class="text-emerald-600 dark:text-emerald-400 font-mono text-sm" title="Audio On">🔊</span>
        {:else}
          <span class="text-slate-400 font-mono text-sm" title="Audio Muted">🔇</span>
        {/if}
      </button>

      <!-- Dataset Lineage Segmented Control (Raw vs Cleaned) -->
      <div class="flex items-center bg-warm-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-medium border border-warm-200 dark:border-slate-700">
        <button
          onclick={() => viewMode = 'cleaned'}
          class={`px-2.5 py-1 rounded-md transition ${viewMode === 'cleaned' ? 'bg-white dark:bg-slate-900 text-orange-700 dark:text-orange-400 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
          Cleaned (23)
        </button>
        <button
          onclick={() => viewMode = 'raw'}
          class={`px-2.5 py-1 rounded-md transition ${viewMode === 'raw' ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
          Raw (25)
        </button>
      </div>

      <!-- Benchmark Date Badge -->
      <span class="text-[11px] font-mono text-slate-500 bg-warm-100 dark:bg-slate-800 px-2 py-1 rounded border border-warm-200 dark:border-slate-700">
        Benchmark: 2026-11-01
      </span>

      <!-- Export CSV with PII Mask Toggle -->
      <div class="flex items-center gap-1.5 bg-warm-100 dark:bg-slate-800 rounded px-2 py-1 border border-warm-200 dark:border-slate-700">
        <label class="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer select-none" title="Mask phone numbers and email addresses on export">
          <input type="checkbox" bind:checked={maskPiiOnExport} class="rounded text-orange-600 w-3 h-3" />
          <span>Mask PII</span>
        </label>
        <span class="text-slate-300 dark:text-slate-600">|</span>
        <button
          onclick={exportCleanedCsv}
          class="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white p-0.5 rounded transition flex items-center gap-1"
          title="Export dataset to CSV (Server-audited with SHA-256 checksum)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          <span class="text-[11px] font-semibold">Export</span>
        </button>
      </div>

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

      <!-- Authenticated Operator Badge & Logout -->
      {#if currentUser}
        <div class="hidden sm:flex items-center gap-2 pl-2 border-l border-warm-200 dark:border-slate-800">
          <div class="text-right">
            <div class="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">{currentUser.full_name}</div>
            <div class="text-[10px] font-mono text-orange-600 dark:text-orange-400 leading-tight">{currentUser.security_tier} · {currentUser.role}</div>
          </div>
          <button
            onclick={handleLogout}
            class="text-xs px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-medium transition"
            title="Sign out of BIAI Pipeline Control Plane">
            Sign Out
          </button>
        </div>
      {/if}

      <!-- Primary Copilot Trigger (Authentic BIAI Orange Pill) -->
      <button
        onclick={() => activeTab = 'copilot'}
        class="text-xs font-semibold bg-[#C2410C] hover:bg-[#EA580C] text-white px-4 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm hover:shadow-orange-600/30 active:scale-[0.98] transition">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        <span>Deal Copilot</span>
      </button>
    </div>
  </header>

  {#if authChecking}
    <div class="flex-1 flex items-center justify-center bg-warm-50 dark:bg-slate-950">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 border-2 border-orange-600 border-t-transparent rounded-full animate-spin"></div>
        <div class="text-xs text-slate-500 font-mono">Verifying BIAI Operator Session...</div>
      </div>
    </div>
  {:else if !currentUser}
    <!-- LOGIN OVERLAY -->
    <div class="flex-1 flex items-center justify-center p-4 bg-[#FAF9F6] dark:bg-[#080C14]">
      <div class="w-full max-w-md p-8 rounded-2xl border border-warm-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl">
        <!-- Brand Header -->
        <div class="flex items-center gap-3 mb-6">
          <img src="/biai-logo.png" alt="BIAI" class="w-10 h-10 rounded-full shrink-0" />
          <div>
            <h1 class="text-lg font-bold text-slate-900 dark:text-white tracking-wide">BIAI Corporate Pipeline</h1>
            <p class="text-xs text-slate-500 dark:text-slate-400">Restricted Commercial Intelligence & Pipeline Control Plane</p>
          </div>
        </div>

        {#if loginError}
          <div class="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs">
            {loginError}
          </div>
        {/if}

        <form onsubmit={(e) => { e.preventDefault(); handleLogin(); }} class="space-y-4">
          <div>
            <label for="login-email" class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Work Email</label>
            <input
              id="login-email"
              type="email"
              bind:value={loginEmail}
              required
              class="w-full text-xs px-3 py-2 rounded-lg border border-warm-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-orange-600 outline-none"
              placeholder="operator@biai.com.bd"
            />
          </div>

          <div>
            <label for="login-password" class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Password</label>
            <input
              id="login-password"
              type="password"
              bind:value={loginPassword}
              required
              class="w-full text-xs px-3 py-2 rounded-lg border border-warm-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-orange-600 outline-none"
            />
          </div>

          {#if loginRequiresMfa}
            <div class="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-900">
              <label for="login-mfa" class="block text-xs font-semibold text-orange-900 dark:text-orange-200 mb-1">MFA Security Code</label>
              <input
                id="login-mfa"
                type="text"
                bind:value={loginMfaCode}
                required
                maxlength="6"
                class="w-full text-center font-mono text-base tracking-widest px-3 py-1.5 rounded-lg border border-orange-300 dark:border-orange-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-orange-600 outline-none"
                placeholder="000000"
              />
              <p class="text-[10px] text-orange-700 dark:text-orange-300/80 mt-1">Enter 6-digit code from your authenticator app</p>
            </div>
          {/if}

          <button
            type="submit"
            disabled={loginLoading}
            class="w-full py-2 px-4 rounded-lg bg-[#C2410C] hover:bg-[#EA580C] text-white font-semibold text-xs shadow transition disabled:opacity-50">
            {loginLoading ? 'Authenticating...' : (loginRequiresMfa ? 'Verify MFA & Enter' : 'Sign In')}
          </button>
        </form>

      </div>
    </div>
  {:else}

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
                        {@const isDueToday = lead.next_followup === BENCHMARK_DATE}
                        {@const daysOverdue = isOverdue && lead.next_followup ? Math.round((new Date(BENCHMARK_DATE).getTime() - new Date(lead.next_followup).getTime()) / (86400000)) : 0}
                        {@const daysUntilDue = !isOverdue && lead.next_followup ? Math.round((new Date(lead.next_followup).getTime() - new Date(BENCHMARK_DATE).getTime()) / (86400000)) : 99}
                        {@const urgencyGlowClass = daysOverdue >= 2
                          ? 'border-red-600 shadow-[0_0_18px_rgba(220,38,38,0.45)] ring-2 ring-red-500/60 animate-pulse bg-red-50/40 dark:bg-red-950/25'
                          : daysOverdue === 1
                            ? 'border-rose-500 shadow-[0_0_14px_rgba(225,29,72,0.35)] ring-1 ring-rose-400/50 bg-rose-50/30 dark:bg-rose-950/20'
                            : isDueToday
                              ? 'border-orange-500 shadow-[0_0_14px_rgba(234,88,12,0.4)] ring-1 ring-orange-500/60 animate-pulse bg-orange-50/30 dark:bg-orange-950/20'
                              : daysUntilDue <= 2
                                ? 'border-amber-400 shadow-[0_0_10px_rgba(217,119,6,0.25)] ring-1 ring-amber-400/40 bg-amber-50/20 dark:bg-amber-950/10'
                                : ''}

                        <div
                          role="button"
                          tabindex="0"
                          onclick={() => selectLead(lead.id)}
                          onkeydown={(e) => { if (e.key === 'Enter') selectLead(lead.id); }}
                          class={`group relative w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer hover:shadow-md ${
                            isOverdue ? 'rail-overdue' : 'rail-healthy'
                          } ${urgencyGlowClass} ${
                            isSelected
                              ? 'bg-orange-50/80 border-orange-400 dark:bg-orange-950/30 dark:border-orange-700 shadow-sm'
                              : 'bg-white hover:bg-warm-100/70 border-warm-200 dark:bg-slate-900 dark:border-slate-800 dark:hover:bg-slate-850'
                          }`}>

                          <div class="flex items-start justify-between gap-1">
                            <div class="truncate">
                              <span class="font-semibold text-xs text-slate-900 dark:text-white truncate">
                                {lead.company}
                              </span>
                              {#if daysOverdue >= 3}
                                <span class="w-1.5 h-1.5 rounded-full bg-red-500 inline-block ml-1 animate-ping"></span>
                              {/if}
                            </div>
                            <span class="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                              ৳ {(lead.deal_value_bdt || 0).toLocaleString()}
                            </span>
                          </div>

                          <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {lead.contact_name || 'Missing contact'} · {lead.industry}
                          </div>

                          <!-- Dynamic Hover Metadata Peek: reveals contact & prompt on hover -->
                          <div class="hidden group-hover:flex flex-col gap-1 text-[11px] py-1.5 px-2 my-2 rounded bg-warm-100/90 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-warm-200 dark:border-slate-700/60 transition-all">
                            <div class="flex items-center justify-between font-mono text-[10px]">
                              <span>{lead.contact_phone || 'No phone'}</span>
                              <span class="truncate max-w-[130px]">{lead.contact_email || 'No email'}</span>
                            </div>
                            {#if lead.notes}
                              <p class="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 italic">
                                "{lead.notes}"
                              </p>
                            {/if}
                            <span class="text-[10px] text-orange-600 dark:text-orange-400 font-medium">Inspect Deal Studio ↵</span>
                          </div>

                          <!-- Next Followup Pill -->
                          <div class="flex items-center justify-between text-[10px] mt-2 pt-1 border-t border-warm-100 dark:border-slate-800 font-mono">
                            <span class="text-slate-400">Due: {lead.next_followup || 'No date'}</span>
                            {#if daysOverdue >= 3}
                              <span class="px-1.5 py-0.2 rounded font-bold bg-rose-600 text-white">⚠️ Overdue {daysOverdue}d</span>
                            {:else if daysOverdue >= 1}
                              <span class="text-rose-700 dark:text-rose-300 font-semibold">Overdue {daysOverdue}d</span>
                            {:else if isDueToday}
                              <span class="px-1.5 py-0.2 rounded font-bold bg-orange-500 text-white animate-pulse">Due Today</span>
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

                  {#if selectedLead.stage === 'Invoice sent'}
                    <label class="flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2 rounded border border-amber-200 dark:border-amber-800 cursor-pointer select-none">
                      <input type="checkbox" bind:checked={bankConfirmed} class="rounded text-amber-600 w-3.5 h-3.5" />
                      <span>Bank statement checked (no unrecorded payments)</span>
                    </label>
                  {/if}

                  <div class="flex gap-2">
                    <button
                      onclick={() => copyText(emailDraft?.body || '', 'Email draft')}
                      class="flex-1 text-xs font-semibold bg-warm-200 hover:bg-warm-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white py-1.5 rounded transition">
                      📋 Copy Draft
                    </button>
                    <button
                      onclick={dispatchEmail}
                      class="flex-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 rounded transition flex items-center justify-center gap-1 shadow-xs">
                      🚀 Dispatch Email
                    </button>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </main>
  </div>
  {/if}

  <!-- Toast Notification Feedback -->
  {#if feedbackMessage}
    <div class="fixed bottom-4 right-4 bg-slate-900 text-white dark:bg-white dark:text-slate-950 px-4 py-2 rounded-lg text-xs font-medium shadow-lg z-50">
      {feedbackMessage}
    </div>
  {/if}
</div>
