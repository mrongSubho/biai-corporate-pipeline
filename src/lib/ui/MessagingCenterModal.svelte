<script lang="ts">
  import Icon from './Icon.svelte';

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
  let searchQuery = $state('');
  let isCreatingThread = $state(false);

  // Data state
  let threads = $state<any[]>([]);
  let activeThreadId = $state<string | null>(null);
  let activeThread = $state<any | null>(null);
  let threadMessages = $state<any[]>([]);
  let recipients = $state<any[]>([]);
  let unreadSummary = $state<{ unreadCount: number; unreadDirectivesCount: number }>({ unreadCount: 0, unreadDirectivesCount: 0 });

  let isLoadingThreads = $state(false);
  let isFetchingThread = $state(false);
  let isSendingReply = $state(false);
  let isAcknowledging = $state(false);
  let replyText = $state('');

  // Scroll container for messages
  let messageScrollContainer: HTMLDivElement | null = $state(null);

  // New Thread Form state
  let newChannelType = $state<'DIRECT' | 'ROLE_BROADCAST'>('DIRECT');
  let newRecipientId = $state('');
  let newTargetRole = $state('OPERATIONS_ADMIN');
  let newSubject = $state('');
  let newContent = $state('');
  let newPriority = $state<'NORMAL' | 'HIGH' | 'CRITICAL'>('NORMAL');
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
    newSubject = `Operational Directive: #${ctx.id}${ctx.label ? ` (${ctx.label})` : ''}`;
    newRequiresAck = true;
    newPriority = 'HIGH';
  }

  function scrollToBottom(smooth = true) {
    setTimeout(() => {
      if (messageScrollContainer) {
        messageScrollContainer.scrollTo({
          top: messageScrollContainer.scrollHeight,
          behavior: smooth ? 'smooth' : 'auto'
        });
      }
    }, 60);
  }

  function formatRelativeTime(dateStr?: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
      if (diffSec < 60) return 'Just now';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr.slice(0, 16);
    }
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
    activeThreadId = threadId;
    isFetchingThread = true;
    try {
      const res = await fetch(`/api/v1/messages/threads/${threadId}`);
      const data = await res.json();
      if (res.ok) {
        activeThread = data.thread;
        threadMessages = data.messages || [];
        scrollToBottom(false);
        await loadUnreadSummary();
      }
    } catch (e) {
      console.error(e);
    } finally {
      isFetchingThread = false;
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
        scrollToBottom(true);
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
    isAcknowledging = true;
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
    } finally {
      isAcknowledging = false;
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
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t =>
        t.subject?.toLowerCase().includes(q) ||
        t.last_message_snippet?.toLowerCase().includes(q) ||
        t.context_id?.toLowerCase().includes(q)
      );
    }
    return list;
  });
</script>

{#if isOpen && currentUser}
  <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="relative bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl h-[680px] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans">
      
      <!-- MODAL HEADER (shrink-0) -->
      <header class="p-3.5 border-b border-warm-200 dark:border-slate-800 bg-warm-50/70 dark:bg-slate-900/90 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-orange-600/10 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
            <Icon name="message-square" size={17} />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-bold text-slate-900 dark:text-white">Command & Operational Messaging</h2>
              {#if unreadSummary.unreadDirectivesCount > 0}
                <span class="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500 text-white animate-pulse">
                  <Icon name="shield-alert" size={11} />
                  <span>{unreadSummary.unreadDirectivesCount} DIRECTIVE{unreadSummary.unreadDirectivesCount > 1 ? 'S' : ''} PENDING</span>
                </span>
              {:else if unreadSummary.unreadCount > 0}
                <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-orange-500 text-white">
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
          aria-label="Close messaging dialog">
          <Icon name="x" size={16} />
        </button>
      </header>

      <!-- 2-COLUMN MAIN BODY (flex-1, overflow-hidden relative) -->
      <div class="flex-1 flex min-h-0 overflow-hidden relative">
        
        <!-- LEFT COLUMN: THREAD LIST & SEARCH (w-80, flex flex-col min-h-0 border-r) -->
        <aside class="w-72 sm:w-80 border-r border-warm-200 dark:border-slate-800 flex flex-col h-full min-h-0 bg-warm-50/40 dark:bg-slate-900/60 shrink-0">
          
          <!-- Actions, Search & Filters (shrink-0) -->
          <div class="p-3 border-b border-warm-200 dark:border-slate-800 space-y-2 shrink-0">
            <!-- New Directive Button -->
            <button
              type="button"
              onclick={() => isCreatingThread = true}
              class="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-2 transition shadow-xs">
              <Icon name="plus" size={14} />
              <span>Compose Message / Directive</span>
            </button>

            <!-- Search Bar -->
            <div class="relative">
              <Icon name="search" size={13} class="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search subject, context #ID..."
                bind:value={searchQuery}
                class="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg pl-8 pr-2.5 py-1.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
            </div>

            <!-- Segmented Filter Pills -->
            <div class="flex items-center gap-1 overflow-x-auto text-[11px] pt-0.5">
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
                <Icon name="shield-alert" size={12} />
                <span>Directives</span>
                {#if unreadSummary.unreadDirectivesCount > 0}
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
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

          <!-- Thread List Scroll Container -->
          <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-1">
            {#if isLoadingThreads}
              <div class="text-center py-12 text-slate-400 flex flex-col items-center gap-2 text-xs">
                <Icon name="refresh-cw" size={16} class="animate-spin text-orange-500" />
                <span>Syncing inbox...</span>
              </div>
            {:else if displayedThreads.length === 0}
              <div class="text-center py-12 text-slate-400 text-xs italic">No messages found.</div>
            {:else}
              {#each displayedThreads as th}
                {@const isSelected = activeThreadId === th.id}
                <div
                  role="button"
                  tabindex="0"
                  onclick={() => selectThread(th.id)}
                  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectThread(th.id); }}
                  class={`w-full text-left p-2.5 rounded-xl cursor-pointer transition text-xs border ${
                    isSelected
                      ? 'bg-orange-50/80 border-orange-300 dark:bg-orange-950/30 dark:border-orange-800 shadow-xs'
                      : 'border-transparent hover:bg-warm-100/70 dark:hover:bg-slate-800/50'
                  }`}>
                  <div class="flex items-start justify-between gap-1.5">
                    <span class="font-semibold text-slate-900 dark:text-white truncate">
                      {th.subject}
                    </span>
                    <span class="text-[10px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                      {formatRelativeTime(th.last_message_at)}
                    </span>
                  </div>

                  <div class="flex items-center gap-1.5 text-[10px] mt-1.5 text-slate-500 dark:text-slate-400 flex-wrap">
                    {#if th.requires_ack}
                      <span class={`font-mono font-bold px-1.5 py-0.2 rounded flex items-center gap-1 ${
                        th.is_acknowledged
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      }`}>
                        <Icon name={th.is_acknowledged ? 'check-circle' : 'shield-alert'} size={10} />
                        <span>{th.is_acknowledged ? 'ACKNOWLEDGED' : `DIRECTIVE · ${th.priority}`}</span>
                      </span>
                    {/if}

                    <span class="inline-flex items-center gap-1 font-mono text-slate-600 dark:text-slate-400">
                      <Icon name={th.channel_type === 'ROLE_BROADCAST' ? 'radio' : 'user'} size={11} />
                      <span>{th.channel_type === 'ROLE_BROADCAST' ? 'Broadcast' : 'Direct'}</span>
                    </span>

                    {#if th.context_id}
                      <span class="font-mono text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 px-1 rounded flex items-center gap-0.5">
                        <Icon name="link" size={9} />
                        <span>#{th.context_id}</span>
                      </span>
                    {/if}

                    {#if th.unread_count > 0}
                      <span class="ml-auto w-2 h-2 rounded-full bg-orange-600 shrink-0"></span>
                    {/if}
                  </div>

                  <p class="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-1 mt-1 font-sans">
                    {th.last_message_snippet || 'No message content.'}
                  </p>
                </div>
              {/each}
            {/if}
          </div>
        </aside>

        <!-- RIGHT COLUMN: ACTIVE THREAD CONVERSATION (flex-1 flex flex-col min-h-0) -->
        <main class="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-slate-900">
          
          {#if activeThread}
            <!-- Pinned Thread Header (shrink-0) -->
            <div class="p-4 border-b border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-900/60 shrink-0 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <h3 class="font-bold text-slate-900 dark:text-white text-sm truncate">{activeThread.subject}</h3>
                  <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-500 font-mono">
                    <span class="flex items-center gap-1">
                      <Icon name={activeThread.channel_type === 'ROLE_BROADCAST' ? 'radio' : 'user'} size={12} />
                      <span>{activeThread.channel_type === 'ROLE_BROADCAST' ? 'Role Broadcast' : 'Direct Message'}</span>
                    </span>
                    <span>·</span>
                    <span>Created {formatRelativeTime(activeThread.created_at)}</span>
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
                    class="px-2.5 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/60 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 font-mono font-semibold text-xs border border-orange-200 dark:border-orange-800 transition flex items-center gap-1.5 shadow-xs"
                    title="Deep link into record workspace">
                    <Icon name="external-link" size={13} />
                    <span>#{activeThread.context_id}</span>
                  </button>
                {/if}
              </div>

              <!-- High-Impact Directive Receipt Card -->
              {#if activeThread.requires_ack}
                <div class={`p-3 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                  activeThread.is_acknowledged
                    ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
                    : 'bg-rose-50/80 border-rose-300 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                }`}>
                  <div class="flex items-center gap-2.5 text-xs">
                    <div class={`p-1.5 rounded-xl shrink-0 ${
                      activeThread.is_acknowledged ? 'bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200' : 'bg-rose-200 dark:bg-rose-900 text-rose-800 dark:text-rose-200'
                    }`}>
                      <Icon name={activeThread.is_acknowledged ? 'check-circle' : 'shield-alert'} size={16} />
                    </div>
                    <div>
                      <div class="font-bold font-mono uppercase tracking-wider text-[10px]">
                        {activeThread.priority} OPERATIONAL DIRECTIVE
                      </div>
                      <div class="text-[11px] mt-0.5">
                        {#if activeThread.is_acknowledged}
                          Receipt acknowledged {formatRelativeTime(activeThread.acknowledged_at)}
                        {:else}
                          Mandatory operational directive awaiting 1-click receipt confirmation
                        {/if}
                      </div>
                    </div>
                  </div>

                  {#if !activeThread.is_acknowledged}
                    <button
                      type="button"
                      onclick={acknowledgeDirective}
                      disabled={isAcknowledging}
                      class="bg-rose-600 hover:bg-rose-500 text-white font-semibold px-3.5 py-1.5 rounded-xl text-xs transition shrink-0 shadow-xs flex items-center gap-1.5">
                      <Icon name="check" size={13} />
                      <span>{isAcknowledging ? 'Confirming...' : 'Acknowledge Receipt'}</span>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Scrollable Message Stream -->
            <div
              bind:this={messageScrollContainer}
              class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
              {#if isFetchingThread}
                <div class="flex justify-center py-2">
                  <span class="text-[10px] font-mono text-slate-400 bg-warm-100 dark:bg-slate-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Icon name="refresh-cw" size={10} class="animate-spin text-orange-500" />
                    <span>Syncing messages...</span>
                  </span>
                </div>
              {/if}

              {#each threadMessages as msg}
                {@const isMe = msg.sender_id === currentUser.id}
                <div class={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div class="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mb-1">
                    <span class="font-semibold text-slate-700 dark:text-slate-300 font-sans">{msg.sender_name}</span>
                    <span>({msg.sender_role})</span>
                    <span>·</span>
                    <span>{formatRelativeTime(msg.created_at)}</span>
                  </div>

                  <div class={`p-3 rounded-2xl max-w-lg text-xs leading-relaxed whitespace-pre-wrap ${
                    isMe
                      ? 'bg-orange-600 text-white rounded-tr-xs shadow-xs'
                      : 'bg-warm-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-xs border border-warm-200 dark:border-slate-700'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              {/each}
            </div>

            <!-- Pinned Reply Composer -->
            <div class="p-3 border-t border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-900 shrink-0">
              <div class="flex gap-2">
                <textarea
                  rows="2"
                  placeholder="Type an operational response... (⌘Enter to send)"
                  bind:value={replyText}
                  onkeydown={handleKeydownReply}
                  class="flex-1 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs leading-relaxed focus:ring-1 focus:ring-orange-500"></textarea>

                <button
                  type="button"
                  onclick={sendReply}
                  disabled={isSendingReply || !replyText.trim()}
                  class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-4 rounded-xl text-xs transition disabled:opacity-50 shrink-0 flex items-center justify-center gap-1.5">
                  <Icon name="send" size={13} />
                  <span>{isSendingReply ? 'Sending...' : 'Send'}</span>
                </button>
              </div>
            </div>

          {:else}
            <!-- Empty state -->
            <div class="m-auto text-center py-20 text-slate-400 text-xs flex flex-col items-center gap-2">
              <Icon name="message-square" size={24} class="text-slate-300 dark:text-slate-700" />
              <span>Select a message thread or compose a new operational directive.</span>
            </div>
          {/if}

        </main>

        <!-- SLIDE-OVER COMPOSE DRAWER -->
        {#if isCreatingThread}
          <div class="absolute inset-y-0 right-0 w-full sm:w-[460px] bg-white dark:bg-slate-900 border-l border-warm-200 dark:border-slate-800 shadow-2xl flex flex-col z-30 animate-in slide-in-from-right duration-200">
            <!-- Drawer Header -->
            <div class="p-4 border-b border-warm-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-warm-50/50 dark:bg-slate-950">
              <div class="flex items-center gap-2">
                <Icon name="plus" size={16} class="text-orange-600 dark:text-orange-400" />
                <h4 class="font-bold text-slate-900 dark:text-white text-sm">Compose Directive or Message</h4>
              </div>
              <button
                type="button"
                onclick={() => isCreatingThread = false}
                class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg">
                <Icon name="x" size={16} />
              </button>
            </div>

            <!-- Drawer Body -->
            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 space-y-4 text-xs">
              {#if createError}
                <div class="p-3 rounded-xl bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 font-medium flex items-center gap-2 border border-rose-200 dark:border-rose-800">
                  <Icon name="alert-circle" size={15} />
                  <span>{createError}</span>
                </div>
              {/if}

              <!-- Channel Type Selector -->
              <div class="grid grid-cols-2 gap-2 p-1 bg-warm-100 dark:bg-slate-800 rounded-xl">
                <button
                  type="button"
                  onclick={() => newChannelType = 'DIRECT'}
                  class={`py-1.5 rounded-lg font-medium text-xs transition flex items-center justify-center gap-1.5 ${
                    newChannelType === 'DIRECT'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}>
                  <Icon name="user" size={13} />
                  <span>Direct Message</span>
                </button>
                <button
                  type="button"
                  onclick={() => newChannelType = 'ROLE_BROADCAST'}
                  class={`py-1.5 rounded-lg font-medium text-xs transition flex items-center justify-center gap-1.5 ${
                    newChannelType === 'ROLE_BROADCAST'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}>
                  <Icon name="radio" size={13} />
                  <span>Role Broadcast</span>
                </button>
              </div>

              <!-- Recipient / Target -->
              {#if newChannelType === 'DIRECT'}
                <div>
                  <label for="msg-recipient" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Target Recipient</label>
                  <select
                    id="msg-recipient"
                    bind:value={newRecipientId}
                    class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs">
                    {#each recipients as rec}
                      <option value={rec.id}>{rec.full_name} ({rec.role} · {rec.security_tier})</option>
                    {/each}
                  </select>
                </div>
              {:else}
                <div>
                  <label for="msg-target-role" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Broadcast Role Group</label>
                  <select
                    id="msg-target-role"
                    bind:value={newTargetRole}
                    class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs">
                    <option value="OPERATIONS_ADMIN">Operations Administrators</option>
                    <option value="COMMERCIAL_STRATEGIST">Commercial Strategists</option>
                    <option value="PLATFORM_OWNER">Platform Owners</option>
                  </select>
                </div>
              {/if}

              <!-- Subject -->
              <div>
                <label for="msg-subject" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Directive Subject</label>
                <input
                  id="msg-subject"
                  type="text"
                  placeholder="e.g. Urgent review needed for Motijheel Bank proposal"
                  bind:value={newSubject}
                  class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
              </div>

              <!-- Directive Policy Settings -->
              <div class="p-3.5 rounded-2xl border border-warm-200 dark:border-slate-700 bg-warm-50/70 dark:bg-slate-950 space-y-3">
                <label class="flex items-center gap-2.5 cursor-pointer select-none font-semibold text-slate-800 dark:text-slate-200">
                  <input type="checkbox" bind:checked={newRequiresAck} class="rounded text-orange-600 w-4 h-4 focus:ring-orange-500" />
                  <span>Mark as Operational Directive (1-Click Ack Required)</span>
                </label>

                {#if newRequiresAck}
                  <div class="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label for="msg-priority" class="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Priority Level</label>
                      <select
                        id="msg-priority"
                        bind:value={newPriority}
                        class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 text-xs">
                        <option value="NORMAL">Normal</option>
                        <option value="HIGH">High Priority</option>
                        <option value="CRITICAL">Critical Immediate</option>
                      </select>
                    </div>

                    <div>
                      <label for="msg-context-id" class="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Context Link</label>
                      <div class="flex gap-1.5">
                        <select
                          bind:value={newContextType}
                          class="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 text-xs w-24">
                          <option value="NONE">None</option>
                          <option value="ENQUIRY">Enquiry</option>
                          <option value="LEAD">Lead</option>
                        </select>
                        <input
                          id="msg-context-id"
                          type="text"
                          placeholder="ID #..."
                          bind:value={newContextId}
                          class="flex-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 text-xs font-mono" />
                      </div>
                    </div>
                  </div>
                {/if}
              </div>

              <!-- Message Body -->
              <div>
                <label for="msg-content" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Message Instructions</label>
                <textarea
                  id="msg-content"
                  rows="5"
                  placeholder="Type clear instructions, priorities, or required response steps..."
                  bind:value={newContent}
                  class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs leading-relaxed focus:ring-1 focus:ring-orange-500"></textarea>
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onclick={() => isCreatingThread = false}
                  class="px-4 py-2 rounded-xl border border-warm-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">
                  Cancel
                </button>

                <button
                  type="button"
                  onclick={submitNewThread}
                  disabled={isSubmittingThread}
                  class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-5 py-2 rounded-xl transition shadow-xs disabled:opacity-50 flex items-center gap-1.5">
                  <Icon name="send" size={13} />
                  <span>{isSubmittingThread ? 'Dispatching...' : 'Dispatch Message'}</span>
                </button>
              </div>
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>
{/if}
