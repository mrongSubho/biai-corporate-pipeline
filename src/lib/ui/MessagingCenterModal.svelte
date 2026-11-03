<script lang="ts">
  import { onMount } from 'svelte';

  export interface OperatorUser {
    id: string;
    email: string;
    full_name: string;
    role: string;
    security_tier: string;
  }

  interface Props {
    isOpen: boolean;
    currentUser: OperatorUser | null;
    initialContext?: { type: 'ENQUIRY' | 'LEAD'; id: string; label?: string } | null;
    workspaceType?: 'CRM' | 'PIPELINE';
    onClose: () => void;
    onNavigateContext?: (type: 'ENQUIRY' | 'LEAD', id: string) => void;
  }

  let {
    isOpen,
    currentUser,
    initialContext = null,
    workspaceType = 'PIPELINE',
    onClose,
    onNavigateContext
  }: Props = $props();

  // View state
  type FilterChannel = 'ALL' | 'DIRECTIVES' | 'OWNER_OPS' | 'UNREAD';
  let activeFilter = $state<FilterChannel>('ALL');
  let isCreatingThread = $state(false);

  // Data state
  let threads = $state<any[]>([]);
  let activeThreadId = $state<string | null>(null);
  let activeThread = $state<any | null>(null);
  let threadMessages = $state<any[]>([]);
  let recipients = $state<any[]>([]);
  let unreadSummary = $state<{ unreadCount: number; unreadDirectivesCount: number }>({ unreadCount: 0, unreadDirectivesCount: 0 });

  let isLoadingThreads = $state(false);
  let isLoadingMessages = $state(false);
  let isSendingReply = $state(false);
  let replyText = $state('');

  // New Thread Form state
  let newChannelType = $state<'DIRECT' | 'ROLE_BROADCAST'>('DIRECT');
  let newRecipientId = $state('');
  let newTargetRole = $state('OPERATIONS_ADMIN');
  let newSubject = $state('');
  let newContent = $state('');
  let newPriority = $state<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  let newRequiresAck = $state(false);
  let newContextType = $state<'ENQUIRY' | 'LEAD' | 'NONE'>('NONE');
  let newContextId = $state('');
  let createError = $state<string | null>(null);
  let isSubmittingThread = $state(false);

  // Watch for opening or initialContext changes
  $effect(() => {
    if (isOpen && currentUser) {
      loadThreads();
      loadRecipients();
      loadUnreadSummary();

      if (initialContext) {
        startNewThreadWithContext(initialContext);
      }
    }
  });

  function startNewThreadWithContext(ctx: { type: 'ENQUIRY' | 'LEAD'; id: string; label?: string }) {
    isCreatingThread = true;
    newContextType = ctx.type;
    newContextId = ctx.id;
    newSubject = `Operational Lead Review #${ctx.id}${ctx.label ? ` (${ctx.label})` : ''}`;
    newRequiresAck = true;
    newPriority = 'HIGH';
  }

  async function loadUnreadSummary() {
    try {
      const res = await fetch('/api/v1/messages/unread-summary');
      const data = await res.json();
      if (res.ok) {
        unreadSummary = data;
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function loadRecipients() {
    try {
      const res = await fetch('/api/v1/messages/recipients');
      const data = await res.json();
      if (res.ok && data.recipients) {
        recipients = data.recipients;
        if (recipients.length > 0 && !newRecipientId) {
          newRecipientId = recipients[0].id;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function loadThreads() {
    isLoadingThreads = true;
    try {
      let url = '/api/v1/messages/threads';
      if (activeFilter === 'DIRECTIVES') url += '?channel=DIRECTIVE';
      else if (activeFilter === 'OWNER_OPS') url += '?channel=OWNER_OPS';

      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && data.threads) {
        threads = data.threads;
        if (!isCreatingThread && threads.length > 0 && !activeThreadId) {
          selectThread(threads[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingThreads = false;
    }
  }

  async function selectThread(threadId: string) {
    isCreatingThread = false;
    activeThreadId = threadId;
    isLoadingMessages = true;
    try {
      const res = await fetch(`/api/v1/messages/threads/${threadId}`);
      const data = await res.json();
      if (res.ok) {
        activeThread = data.thread;
        threadMessages = data.messages || [];
        await loadUnreadSummary();
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingMessages = false;
    }
  }

  async function sendReply() {
    if (!activeThreadId || !replyText.trim()) return;
    isSendingReply = true;
    try {
      const res = await fetch(`/api/v1/messages/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText.trim() })
      });
      const data = await res.json();
      if (res.ok && data.message) {
        threadMessages = [...threadMessages, data.message];
        replyText = '';
        await loadThreads();
      }
    } catch (e) {
      console.error(e);
    } finally {
      isSendingReply = false;
    }
  }

  async function acknowledgeDirective() {
    if (!activeThreadId) return;
    try {
      const res = await fetch(`/api/v1/messages/threads/${activeThreadId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok) {
        if (activeThread) {
          activeThread = {
            ...activeThread,
            is_acknowledged: true,
            acknowledged_at: data.acknowledgedAt || new Date().toISOString()
          };
        }
        await loadThreads();
        await loadUnreadSummary();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function submitNewThread() {
    if (!newSubject.trim() || !newContent.trim()) {
      createError = 'Please provide both a subject and message body.';
      return;
    }
    isSubmittingThread = true;
    createError = null;
    try {
      const payload: any = {
        channelType: newChannelType,
        subject: newSubject.trim(),
        content: newContent.trim(),
        priority: newPriority,
        requiresAck: newRequiresAck,
        contextType: newContextType !== 'NONE' ? newContextType : undefined,
        contextId: newContextType !== 'NONE' && newContextId.trim() ? newContextId.trim() : undefined
      };

      if (newChannelType === 'DIRECT') {
        payload.recipientId = newRecipientId;
      } else {
        payload.targetRole = newTargetRole;
      }

      const res = await fetch('/api/v1/messages/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create thread');

      isCreatingThread = false;
      newSubject = '';
      newContent = '';
      newContextType = 'NONE';
      newContextId = '';
      await loadThreads();
      if (data.thread?.id) {
        selectThread(data.thread.id);
      }
    } catch (err: any) {
      createError = err.message;
    } finally {
      isSubmittingThread = false;
    }
  }

  function handleKeydownReply(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendReply();
    }
  }

  // Filtered threads computed
  let displayedThreads = $derived.by(() => {
    let list = threads;
    if (activeFilter === 'UNREAD') {
      list = list.filter(t => t.unread_count > 0);
    }
    return list;
  });
</script>

{#if isOpen && currentUser}
  <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl h-[680px] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans">
      
      <!-- MODAL HEADER (shrink-0) -->
      <div class="p-3.5 border-b border-warm-200 dark:border-slate-800 bg-warm-50/70 dark:bg-slate-900 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-orange-600/10 text-orange-700 dark:text-orange-400 font-mono font-bold text-sm flex items-center justify-center border border-orange-500/20 shrink-0">
            💬
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-bold text-slate-900 dark:text-white">Command & Operational Messaging</h2>
              {#if unreadSummary.unreadDirectivesCount > 0}
                <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-500 text-white animate-pulse">
                  {unreadSummary.unreadDirectivesCount} DIRECTIVE{unreadSummary.unreadDirectivesCount > 1 ? 'S' : ''} PENDING
                </span>
              {:else if unreadSummary.unreadCount > 0}
                <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-orange-500 text-white">
                  {unreadSummary.unreadCount} Unread
                </span>
              {/if}
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              Authenticated Channel: {currentUser.full_name} ({currentUser.role})
            </p>
          </div>
        </div>

        <button
          type="button"
          onclick={onClose}
          class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-warm-100 dark:hover:bg-slate-800 transition"
          aria-label="Close dialog">
          ✕
        </button>
      </div>

      <!-- 2-COLUMN MAIN BODY (flex-1, overflow-hidden) -->
      <div class="flex-1 flex min-h-0 overflow-hidden">
        
        <!-- LEFT COLUMN: THREAD LIST & FILTERS (w-80, flex flex-col min-h-0 border-r border-warm-200 dark:border-slate-800) -->
        <aside class="w-72 sm:w-80 border-r border-warm-200 dark:border-slate-800 flex flex-col h-full min-h-0 bg-warm-50/30 dark:bg-slate-900/60 shrink-0">
          
          <!-- Actions & Filters (shrink-0) -->
          <div class="p-3 border-b border-warm-200 dark:border-slate-800 space-y-2 shrink-0">
            <button
              type="button"
              onclick={() => { isCreatingThread = true; activeThreadId = null; }}
              class="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-xs">
              <span>➕</span>
              <span>New Directive / Message</span>
            </button>

            <!-- Channel Filter Pills -->
            <div class="flex items-center gap-1 overflow-x-auto text-[11px] pt-1">
              <button
                type="button"
                onclick={() => { activeFilter = 'ALL'; loadThreads(); }}
                class={`px-2 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                  activeFilter === 'ALL'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800'
                }`}>
                All
              </button>

              <button
                type="button"
                onclick={() => { activeFilter = 'DIRECTIVES'; loadThreads(); }}
                class={`px-2 py-1 rounded-lg font-medium transition whitespace-nowrap flex items-center gap-1 ${
                  activeFilter === 'DIRECTIVES'
                    ? 'bg-rose-600 text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800'
                }`}>
                <span>Directives</span>
                {#if unreadSummary.unreadDirectivesCount > 0}
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                {/if}
              </button>

              <button
                type="button"
                onclick={() => { activeFilter = 'OWNER_OPS'; loadThreads(); }}
                class={`px-2 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                  activeFilter === 'OWNER_OPS'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800'
                }`}>
                Owner ↔ Ops
              </button>

              <button
                type="button"
                onclick={() => { activeFilter = 'UNREAD'; }}
                class={`px-2 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                  activeFilter === 'UNREAD'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800'
                }`}>
                Unread
              </button>
            </div>
          </div>

          <!-- Thread List Scroll Container (flex-1 min-h-0 overflow-y-auto overscroll-contain) -->
          <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-1.5 divide-y divide-warm-100 dark:divide-slate-800/60">
            {#if isLoadingThreads}
              <div class="text-center py-10 text-slate-400 text-xs">Loading threads...</div>
            {:else if displayedThreads.length === 0}
              <div class="text-center py-10 text-slate-400 text-xs italic">No messages in view.</div>
            {:else}
              {#each displayedThreads as th}
                {@const isSelected = activeThreadId === th.id && !isCreatingThread}
                <div
                  role="button"
                  tabindex="0"
                  onclick={() => selectThread(th.id)}
                  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectThread(th.id); }}
                  class={`w-full text-left p-2.5 rounded-xl cursor-pointer transition text-xs border ${
                    isSelected
                      ? 'bg-orange-50/80 border-orange-300 dark:bg-orange-950/30 dark:border-orange-800'
                      : 'border-transparent hover:bg-warm-100/70 dark:hover:bg-slate-800/50'
                  }`}>
                  <div class="flex items-start justify-between gap-1.5">
                    <span class="font-semibold text-slate-900 dark:text-white truncate">
                      {th.subject}
                    </span>
                    {#if th.unread_count > 0}
                      <span class="w-2 h-2 rounded-full bg-orange-600 shrink-0 mt-1"></span>
                    {/if}
                  </div>

                  <div class="flex items-center gap-1.5 text-[10px] mt-1 text-slate-500 dark:text-slate-400">
                    {#if th.requires_ack}
                      <span class={`font-mono font-bold px-1 rounded ${
                        th.is_acknowledged
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      }`}>
                        {th.is_acknowledged ? '✓ ACK' : `REQ-ACK · ${th.priority}`}
                      </span>
                    {/if}
                    <span class="truncate font-mono">{th.channel_type}</span>
                    {#if th.context_id}
                      <span class="font-mono text-orange-600 dark:text-orange-400">#{th.context_id}</span>
                    {/if}
                  </div>

                  <p class="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-1 mt-1 font-sans">
                    {th.last_message_snippet || 'No message content yet.'}
                  </p>
                </div>
              {/each}
            {/if}
          </div>
        </aside>

        <!-- RIGHT COLUMN: ACTIVE THREAD OR NEW THREAD FORM (flex-1 flex flex-col min-h-0 overflow-hidden) -->
        <main class="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-slate-900">
          
          {#if isCreatingThread}
            <!-- NEW THREAD CREATION FORM -->
            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4 text-xs">
              <div class="border-b border-warm-200 dark:border-slate-800 pb-3">
                <h3 class="font-bold text-slate-900 dark:text-white text-sm">Compose Command Message / Directive</h3>
                <p class="text-slate-500">Dispatch directives or direct messages across Platform Owners and Operations Admins.</p>
              </div>

              {#if createError}
                <div class="p-2.5 rounded-lg bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 font-medium">
                  {createError}
                </div>
              {/if}

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="msg-channel-type" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Message Type</label>
                  <select
                    id="msg-channel-type"
                    bind:value={newChannelType}
                    class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700">
                    <option value="DIRECT">Direct Operator Message</option>
                    <option value="ROLE_BROADCAST">Role Broadcast Directive</option>
                  </select>
                </div>

                {#if newChannelType === 'DIRECT'}
                  <div>
                    <label for="msg-recipient" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Recipient</label>
                    <select
                      id="msg-recipient"
                      bind:value={newRecipientId}
                      class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700">
                      {#each recipients as rec}
                        <option value={rec.id}>{rec.full_name} ({rec.role} · {rec.security_tier})</option>
                      {/each}
                    </select>
                  </div>
                {:else}
                  <div>
                    <label for="msg-target-role" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Target Role</label>
                    <select
                      id="msg-target-role"
                      bind:value={newTargetRole}
                      class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700">
                      <option value="OPERATIONS_ADMIN">Operations Administrators</option>
                      <option value="COMMERCIAL_STRATEGIST">Commercial Strategists</option>
                      <option value="PLATFORM_OWNER">Platform Owners</option>
                    </select>
                  </div>
                {/if}
              </div>

              <div>
                <label for="msg-subject" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Subject</label>
                <input
                  id="msg-subject"
                  type="text"
                  placeholder="e.g. Urgent review needed for L11 payment dispute"
                  bind:value={newSubject}
                  class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700" />
              </div>

              <!-- Directive Policy Settings -->
              <div class="p-3 rounded-xl border border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-850 space-y-3">
                <label class="flex items-center gap-2 cursor-pointer select-none font-semibold text-slate-800 dark:text-slate-200">
                  <input type="checkbox" bind:checked={newRequiresAck} class="rounded text-orange-600 w-4 h-4" />
                  <span>Mark as Operational Directive (Requires Explicit 1-Click Acknowledgment)</span>
                </label>

                {#if newRequiresAck}
                  <div class="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label for="msg-priority" class="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Directive Priority</label>
                      <select
                        id="msg-priority"
                        bind:value={newPriority}
                        class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-1.5 border border-warm-200 dark:border-slate-700 text-xs">
                        <option value="LOW">Low</option>
                        <option value="NORMAL">Normal</option>
                        <option value="HIGH">High Priority</option>
                        <option value="URGENT">⚠️ Urgent Immediate Action</option>
                      </select>
                    </div>

                    <div>
                      <label for="msg-context-id" class="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Context Link ID (Optional)</label>
                      <div class="flex gap-2">
                        <select
                          bind:value={newContextType}
                          class="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-1.5 border border-warm-200 dark:border-slate-700 text-xs w-28">
                          <option value="NONE">None</option>
                          <option value="ENQUIRY">Enquiry</option>
                          <option value="LEAD">Lead</option>
                        </select>
                        <input
                          id="msg-context-id"
                          type="text"
                          placeholder="e.g. L11 or ENQ-04"
                          bind:value={newContextId}
                          class="flex-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-1.5 border border-warm-200 dark:border-slate-700 text-xs font-mono" />
                      </div>
                    </div>
                  </div>
                {/if}
              </div>

              <!-- Message Body -->
              <div>
                <label for="msg-content" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Directive Instructions / Message</label>
                <textarea
                  id="msg-content"
                  rows="6"
                  placeholder="Type operational directives, required actions, or escalations..."
                  bind:value={newContent}
                  class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2.5 border border-warm-200 dark:border-slate-700 text-xs leading-relaxed focus:ring-1 focus:ring-orange-500"></textarea>
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onclick={() => { isCreatingThread = false; if (threads.length > 0) selectThread(threads[0].id); }}
                  class="px-4 py-2 rounded-lg border border-warm-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">
                  Cancel
                </button>

                <button
                  type="button"
                  onclick={submitNewThread}
                  disabled={isSubmittingThread}
                  class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50">
                  {isSubmittingThread ? 'Dispatching...' : 'Dispatch Message'}
                </button>
              </div>
            </div>

          {:else if activeThread}
            <!-- ACTIVE THREAD CONVERSATION STREAM -->
            
            <!-- Pinned Thread Header (shrink-0) -->
            <div class="p-3.5 border-b border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-900/60 shrink-0 space-y-2">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-bold text-slate-900 dark:text-white text-sm truncate">{activeThread.subject}</h3>
                  <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono">
                    <span>Channel: {activeThread.channel_type}</span>
                    <span>·</span>
                    <span>Created: {activeThread.created_at?.slice(0, 16)}</span>
                  </div>
                </div>

                <!-- Context Deep-Link Chip -->
                {#if activeThread.context_id}
                  <button
                    type="button"
                    onclick={() => {
                      if (onNavigateContext && activeThread.context_type && activeThread.context_id) {
                        onNavigateContext(activeThread.context_type, activeThread.context_id);
                        onClose();
                      }
                    }}
                    class="px-2.5 py-1 rounded-lg bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900 text-orange-800 dark:text-orange-300 font-mono font-semibold text-xs transition flex items-center gap-1 shadow-xs"
                    title="Deep link into record workspace">
                    <span>🔗</span>
                    <span>#{activeThread.context_id}</span>
                  </button>
                {/if}
              </div>

              <!-- Operational Directive Banner -->
              {#if activeThread.requires_ack}
                <div class="p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
                  activeThread.is_acknowledged
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
                    : 'bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                }">
                  <div class="flex items-center gap-2 text-xs">
                    <span class="font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-[10px] ${
                      activeThread.is_acknowledged ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
                    }">
                      {activeThread.priority} DIRECTIVE
                    </span>
                    <span>
                      {#if activeThread.is_acknowledged}
                        Receipt acknowledged at {activeThread.acknowledged_at?.slice(0, 16)}
                      {:else}
                        Pending mandatory acknowledgment receipt
                      {/if}
                    </span>
                  </div>

                  {#if !activeThread.is_acknowledged}
                    <button
                      type="button"
                      onclick={acknowledgeDirective}
                      class="bg-rose-600 hover:bg-rose-500 text-white font-semibold px-3 py-1 rounded-lg text-xs transition shrink-0 shadow-xs">
                      Acknowledge Receipt
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Scrollable Message Stream (flex-1 min-h-0 overflow-y-auto overscroll-contain) -->
            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
              {#if isLoadingMessages}
                <div class="text-center py-10 text-slate-400 text-xs">Loading message stream...</div>
              {:else}
                {#each threadMessages as msg}
                  {@const isMe = msg.sender_id === currentUser.id}
                  <div class={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <div class="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mb-1">
                      <span class="font-semibold text-slate-700 dark:text-slate-300 font-sans">{msg.sender_name}</span>
                      <span>({msg.sender_role})</span>
                      <span>·</span>
                      <span>{msg.created_at?.slice(11, 16)}</span>
                    </div>

                    <div class={`p-3 rounded-2xl max-w-lg text-xs leading-relaxed whitespace-pre-wrap ${
                      isMe
                        ? 'bg-orange-600 text-white rounded-tr-xs'
                        : 'bg-warm-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-xs border border-warm-200 dark:border-slate-700'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                {/each}
              {/if}
            </div>

            <!-- Pinned Reply Composer (shrink-0) -->
            <div class="p-3 border-t border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-900 shrink-0">
              <div class="flex gap-2">
                <textarea
                  rows="2"
                  placeholder="Type an operational response... (Cmd+Enter to send)"
                  bind:value={replyText}
                  onkeydown={handleKeydownReply}
                  class="flex-1 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 text-xs leading-relaxed focus:ring-1 focus:ring-orange-500"></textarea>

                <button
                  type="button"
                  onclick={sendReply}
                  disabled={isSendingReply || !replyText.trim()}
                  class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-4 rounded-xl text-xs transition disabled:opacity-50 shrink-0">
                  {isSendingReply ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>

          {:else}
            <!-- Empty state -->
            <div class="m-auto text-center py-20 text-slate-400 text-xs">
              Select a thread to view directives or click "New Directive / Message" to begin.
            </div>
          {/if}

        </main>
      </div>

    </div>
  </div>
{/if}
