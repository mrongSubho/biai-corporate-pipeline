<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  interface OperatorUser {
    id: string;
    email: string;
    full_name: string;
    role: string;
    security_tier: string;
    department?: string;
    scopes?: string[];
  }

  interface Props {
    currentUser: OperatorUser | null;
    collapsed?: boolean;
    theme: 'light' | 'dark';
    audioEnabled: boolean;
    unreadCount?: number;
    onToggleTheme: () => void;
    onToggleAudio: () => void;
    onLogout: () => void;
    onOpenAccountControl?: () => void;
    onOpenMessaging?: () => void;
  }

  let {
    currentUser,
    collapsed = false,
    theme,
    audioEnabled,
    unreadCount = 0,
    onToggleTheme,
    onToggleAudio,
    onLogout,
    onOpenAccountControl,
    onOpenMessaging
  }: Props = $props();

  let menuOpen = $state(false);
  let showShortcutsModal = $state(false);
  let showScopesExpanded = $state(false);
  let menuContainer: HTMLDivElement | null = $state(null);
  let triggerButton: HTMLButtonElement | null = $state(null);

  // Initials computation
  let initials = $derived.by(() => {
    if (!currentUser?.full_name) return 'OP';
    const parts = currentUser.full_name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  });

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function handleTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      menuOpen = true;
    } else if (e.key === 'Escape') {
      menuOpen = false;
    }
  }

  function handleMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      menuOpen = false;
      triggerButton?.focus();
    }
  }

  onMount(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuOpen && menuContainer && !menuContainer.contains(e.target as Node)) {
        menuOpen = false;
      }
    }
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  });
</script>

{#if currentUser}
  <div bind:this={menuContainer} class="relative w-full">
    <!-- Trigger Button -->
    <button
      bind:this={triggerButton}
      type="button"
      onclick={toggleMenu}
      onkeydown={handleTriggerKeydown}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      title={collapsed ? `${currentUser.full_name} (${currentUser.role})` : undefined}
      class={`group relative w-full flex items-center gap-2.5 p-2 rounded-xl transition-all duration-150 text-left cursor-pointer border ${
        menuOpen
          ? 'bg-warm-100/90 border-warm-300 dark:bg-slate-800 dark:border-slate-700 shadow-xs'
          : 'bg-transparent hover:bg-warm-100/70 border-transparent hover:border-warm-200 dark:hover:bg-slate-800/60 dark:hover:border-slate-800'
      }`}>
      
      <!-- Monogram Avatar with Status Dot -->
      <div class="relative shrink-0">
        <div class="w-8 h-8 rounded-lg bg-orange-600/10 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 font-mono font-bold text-xs flex items-center justify-center border border-orange-600/25 transition group-hover:scale-[1.02]">
          {initials}
        </div>
        {#if unreadCount > 0}
          <span class="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-600 border border-white dark:border-slate-900"></span>
          </span>
        {/if}
      </div>

      {#if !collapsed}
        <!-- Operator Details -->
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold text-slate-900 dark:text-white truncate leading-tight flex items-center gap-1.5">
            <span>{currentUser.full_name}</span>
          </div>
          <div class="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate leading-tight mt-0.5">
            {currentUser.role} · <span class="text-orange-600 dark:text-orange-400 font-semibold">{currentUser.security_tier}</span>
          </div>
        </div>

        <!-- Chevron Affordance -->
        <Icon
          name="chevron-down"
          size={14}
          class={`text-slate-400 transition-transform duration-200 shrink-0 ${menuOpen ? 'rotate-180 text-slate-700 dark:text-slate-200' : ''}`}
        />
      {/if}
    </button>

    <!-- Upward Popover Menu -->
    {#if menuOpen}
      <div
        role="menu"
        tabindex="-1"
        onkeydown={handleMenuKeydown}
        class="absolute bottom-full left-0 mb-2 w-72 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl border border-warm-200 dark:border-slate-800 shadow-2xl p-1.5 z-50 text-xs font-sans animate-in fade-in zoom-in-95 duration-150">
        
        <!-- Header Info in Menu -->
        <div class="p-3 bg-warm-100/80 dark:bg-slate-950 rounded-xl border border-warm-200 dark:border-slate-800 mb-1">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-slate-900 dark:text-white truncate">{currentUser.full_name}</div>
              <div class="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate mt-0.5">{currentUser.email}</div>
            </div>
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 border border-orange-200 dark:border-orange-800 shrink-0">
              <Icon name="shield-check" size={10} class="text-orange-600 dark:text-orange-400" />
              {currentUser.security_tier}
            </span>
          </div>

          <!-- Granted Scopes Strip -->
          {#if currentUser.scopes && currentUser.scopes.length > 0}
            <div class="mt-2.5 pt-2 border-t border-warm-200 dark:border-slate-800">
              <button
                type="button"
                onclick={() => showScopesExpanded = !showScopesExpanded}
                class="flex items-center justify-between w-full text-[10px] font-mono text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition">
                <span>{currentUser.scopes.length} Permission Scopes</span>
                <Icon name={showScopesExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
              </button>
              {#if showScopesExpanded}
                <div class="flex flex-wrap gap-1 mt-1.5 max-h-24 overflow-y-auto font-mono text-[9px]">
                  {#each currentUser.scopes as sc}
                    <span class="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-800">
                      {sc}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="space-y-0.5 py-1">
          <!-- 1. Account & Access Controls -->
          <button
            type="button"
            onclick={() => { closeMenu(); onOpenAccountControl?.(); }}
            class="w-full text-left px-2.5 py-2 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800/70 rounded-lg flex items-center justify-between transition group font-medium">
            <span class="flex items-center gap-2.5">
              <span class="p-1 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:bg-orange-500/20 transition">
                <Icon name="shield" size={14} />
              </span>
              <span>Account & Access Controls</span>
            </span>
            <Icon name="chevron-right" size={12} class="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </button>

          <!-- 2. Command Messages -->
          <button
            type="button"
            onclick={() => { closeMenu(); onOpenMessaging?.(); }}
            class="w-full text-left px-2.5 py-2 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800/70 rounded-lg flex items-center justify-between transition group font-medium">
            <span class="flex items-center gap-2.5">
              <span class="p-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500/20 transition">
                <Icon name="message-square" size={14} />
              </span>
              <span>Command Messages</span>
            </span>
            {#if unreadCount > 0}
              <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-orange-600 text-white font-mono shadow-xs">
                {unreadCount}
              </span>
            {:else}
              <Icon name="chevron-right" size={12} class="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            {/if}
          </button>
        </div>

        <!-- Section: Preferences -->
        <div class="pt-2 mt-1 border-t border-warm-100 dark:border-slate-800/80">
          <div class="px-2.5 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Preferences
          </div>

          <!-- Theme Toggle Switch -->
          <button
            type="button"
            onclick={onToggleTheme}
            class="w-full text-left px-2.5 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800/70 rounded-lg flex items-center justify-between transition">
            <span class="flex items-center gap-2.5">
              <span class="p-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={14} />
              </span>
              <span>Theme</span>
            </span>
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-mono text-slate-400">
                {theme === 'dark' ? 'Obsidian' : 'Ivory'}
              </span>
              <!-- Tactile Pill Switch -->
              <div class={`w-7 h-4 rounded-full transition-colors relative flex items-center p-0.5 ${
                theme === 'dark' ? 'bg-orange-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}>
                <div class={`w-3 h-3 rounded-full bg-white shadow-xs transition-transform ${
                  theme === 'dark' ? 'translate-x-3' : 'translate-x-0'
                }`}></div>
              </div>
            </div>
          </button>

          <!-- Audio FX Feedback Switch -->
          <button
            type="button"
            onclick={onToggleAudio}
            class="w-full text-left px-2.5 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800/70 rounded-lg flex items-center justify-between transition">
            <span class="flex items-center gap-2.5">
              <span class="p-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Icon name={audioEnabled ? 'volume-2' : 'volume-x'} size={14} />
              </span>
              <span>Audio FX</span>
            </span>
            <div class="flex items-center gap-2">
              <span class={`text-[11px] font-mono ${audioEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                {audioEnabled ? 'Active' : 'Muted'}
              </span>
              <!-- Tactile Pill Switch -->
              <div class={`w-7 h-4 rounded-full transition-colors relative flex items-center p-0.5 ${
                audioEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}>
                <div class={`w-3 h-3 rounded-full bg-white shadow-xs transition-transform ${
                  audioEnabled ? 'translate-x-3' : 'translate-x-0'
                }`}></div>
              </div>
            </div>
          </button>

          <!-- Keyboard Shortcuts -->
          <button
            type="button"
            onclick={() => { closeMenu(); showShortcutsModal = true; }}
            class="w-full text-left px-2.5 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800/70 rounded-lg flex items-center justify-between transition group">
            <span class="flex items-center gap-2.5">
              <span class="p-1 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <Icon name="command" size={14} />
              </span>
              <span>Shortcuts</span>
            </span>
            <span class="text-[10px] font-mono text-slate-400 border border-slate-200 dark:border-slate-700 px-1 py-0.2 rounded">?</span>
          </button>
        </div>

        <!-- Section: Sign Out -->
        <div class="pt-1.5 mt-1 border-t border-warm-100 dark:border-slate-800/80">
          <button
            type="button"
            onclick={() => { closeMenu(); onLogout(); }}
            class="w-full text-left px-2.5 py-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg flex items-center gap-2.5 transition font-medium">
            <Icon name="log-out" size={14} class="text-rose-600" />
            <span>Sign Out Session</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- Shortcuts Dialog -->
    {#if showShortcutsModal}
      <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between border-b border-warm-200 dark:border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <span class="p-1.5 rounded-lg bg-orange-600/10 text-orange-600 dark:text-orange-400">
                <Icon name="command" size={18} />
              </span>
              <h3 class="text-sm font-bold text-slate-900 dark:text-white">Workspace Shortcuts</h3>
            </div>
            <button
              type="button"
              onclick={() => showShortcutsModal = false}
              class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg">
              <Icon name="x" size={16} />
            </button>
          </div>

          <div class="space-y-2 text-xs">
            <div class="flex justify-between items-center py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-600 dark:text-slate-300">Global Search</span>
              <kbd class="font-mono text-[11px] bg-warm-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-warm-200 dark:border-slate-700">⌘K / Ctrl+K</kbd>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-600 dark:text-slate-300">Next / Prev Lead</span>
              <kbd class="font-mono text-[11px] bg-warm-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-warm-200 dark:border-slate-700">J / K or ↓ / ↑</kbd>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-600 dark:text-slate-300">Open Deal Inspector</span>
              <kbd class="font-mono text-[11px] bg-warm-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-warm-200 dark:border-slate-700">Enter</kbd>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-600 dark:text-slate-300">Switch Board / Table View</span>
              <kbd class="font-mono text-[11px] bg-warm-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-warm-200 dark:border-slate-700">1 / 2</kbd>
            </div>
            <div class="flex justify-between items-center py-1.5">
              <span class="text-slate-600 dark:text-slate-300">Close Overlay / Drawer</span>
              <kbd class="font-mono text-[11px] bg-warm-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-warm-200 dark:border-slate-700">Esc</kbd>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
