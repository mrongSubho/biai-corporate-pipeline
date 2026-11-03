<script lang="ts">
  import { onMount } from 'svelte';

  interface OperatorUser {
    id: string;
    email: string;
    full_name: string;
    role: string;
    security_tier: string;
    scopes?: string[];
  }

  interface Props {
    currentUser: OperatorUser | null;
    collapsed?: boolean;
    theme: 'light' | 'dark';
    audioEnabled: boolean;
    onToggleTheme: () => void;
    onToggleAudio: () => void;
    onLogout: () => void;
  }

  let {
    currentUser,
    collapsed = false,
    theme,
    audioEnabled,
    onToggleTheme,
    onToggleAudio,
    onLogout
  }: Props = $props();

  let menuOpen = $state(false);
  let showProfileModal = $state(false);
  let showShortcutsModal = $state(false);
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
      class={`w-full flex items-center gap-2.5 p-2 rounded-xl transition text-left cursor-pointer border ${
        menuOpen
          ? 'bg-warm-100 border-warm-300 dark:bg-slate-800 dark:border-slate-700'
          : 'bg-transparent hover:bg-warm-100 border-transparent hover:border-warm-200 dark:hover:bg-slate-800/60 dark:hover:border-slate-800'
      }`}>
      
      <!-- 32px Initials Avatar -->
      <div class="w-8 h-8 rounded-lg bg-orange-600/10 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 font-mono font-bold text-xs flex items-center justify-center shrink-0 border border-orange-600/20">
        {initials}
      </div>

      {#if !collapsed}
        <!-- Operator Details -->
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold text-slate-900 dark:text-white truncate leading-tight">
            {currentUser.full_name}
          </div>
          <div class="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate leading-tight mt-0.5">
            {currentUser.role} · <span class="text-orange-600 dark:text-orange-400">{currentUser.security_tier}</span>
          </div>
        </div>

        <!-- Chevron Affordance -->
        <svg
          class={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 shrink-0 ${menuOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      {/if}
    </button>

    <!-- Upward Popover Menu -->
    {#if menuOpen}
      <div
        role="menu"
        tabindex="-1"
        onkeydown={handleMenuKeydown}
        class="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-slate-900 rounded-xl border border-warm-200 dark:border-slate-800 shadow-xl py-1.5 z-50 text-xs font-sans animate-in fade-in slide-in-from-bottom-2 duration-150">
        
        <!-- Header Info in Menu -->
        <div class="px-3 py-2 border-b border-warm-100 dark:border-slate-800/80">
          <div class="font-semibold text-slate-900 dark:text-white truncate">{currentUser.full_name}</div>
          <div class="text-[11px] font-mono text-slate-400 truncate">{currentUser.email}</div>
          <div class="mt-1 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span class="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">Authenticated ({currentUser.security_tier})</span>
          </div>
        </div>

        <div class="py-1">
          <!-- 1. View Profile -->
          <button
            type="button"
            onclick={() => { closeMenu(); showProfileModal = true; }}
            class="w-full text-left px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center gap-2 transition">
            <svg class="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>View Profile & Session</span>
          </button>

          <!-- 2. Preferences (Theme & Audio) -->
          <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Preferences
          </div>

          <button
            type="button"
            onclick={() => { onToggleTheme(); }}
            class="w-full text-left px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center justify-between transition">
            <span class="flex items-center gap-2">
              {#if theme === 'dark'}
                <svg class="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              {:else}
                <svg class="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              {/if}
              <span>Theme: {theme === 'dark' ? 'Obsidian Dark' : 'Warm Light'}</span>
            </span>
            <span class="text-[10px] font-mono text-slate-400">Toggle</span>
          </button>

          <button
            type="button"
            onclick={() => { onToggleAudio(); }}
            class="w-full text-left px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center justify-between transition">
            <span class="flex items-center gap-2">
              <span class="text-xs">{audioEnabled ? '🔊' : '🔇'}</span>
              <span>Audio FX Feedback</span>
            </span>
            <span class={`text-[10px] font-mono ${audioEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {audioEnabled ? 'Enabled' : 'Muted'}
            </span>
          </button>

          <!-- 3. Keyboard Shortcuts -->
          <button
            type="button"
            onclick={() => { closeMenu(); showShortcutsModal = true; }}
            class="w-full text-left px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center gap-2 transition">
            <svg class="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <span>Keyboard Shortcuts</span>
          </button>
        </div>

        <!-- 4. Sign Out -->
        <div class="pt-1 mt-1 border-t border-warm-100 dark:border-slate-800/80">
          <button
            type="button"
            onclick={() => { closeMenu(); onLogout(); }}
            class="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 transition font-medium">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Sign Out Session</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- Profile Dialog -->
    {#if showProfileModal}
      <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between border-b border-warm-200 dark:border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-orange-600/10 text-orange-700 dark:text-orange-300 font-mono font-bold flex items-center justify-center">
                {initials}
              </div>
              <div>
                <h3 class="text-sm font-bold text-slate-900 dark:text-white">Operator Profile</h3>
                <p class="text-[11px] text-slate-500 font-mono">Session Scope & Roles</p>
              </div>
            </div>
            <button
              type="button"
              onclick={() => showProfileModal = false}
              class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm">
              ✕
            </button>
          </div>

          <div class="space-y-3 text-xs">
            <div class="flex justify-between py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-500">Full Name</span>
              <span class="font-semibold text-slate-900 dark:text-white">{currentUser.full_name}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-500">Email</span>
              <span class="font-mono text-slate-900 dark:text-white">{currentUser.email}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-500">Role</span>
              <span class="font-semibold text-slate-900 dark:text-white">{currentUser.role}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-500">Security Tier</span>
              <span class="font-mono text-orange-600 dark:text-orange-400 font-bold">{currentUser.security_tier}</span>
            </div>
            {#if currentUser.scopes && currentUser.scopes.length > 0}
              <div class="py-1.5">
                <span class="text-slate-500 block mb-1">Granted Permissions</span>
                <div class="flex flex-wrap gap-1 font-mono text-[10px]">
                  {#each currentUser.scopes as sc}
                    <span class="px-2 py-0.5 rounded bg-warm-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {sc}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <div class="pt-3 border-t border-warm-200 dark:border-slate-800 flex justify-end">
            <button
              type="button"
              onclick={() => showProfileModal = false}
              class="px-4 py-1.5 rounded-lg bg-warm-100 hover:bg-warm-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium transition">
              Close
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Shortcuts Dialog -->
    {#if showShortcutsModal}
      <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between border-b border-warm-200 dark:border-slate-800 pb-3">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>⌨️</span>
              <span>Keyboard Shortcuts Reference</span>
            </h3>
            <button
              type="button"
              onclick={() => showShortcutsModal = false}
              class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm">
              ✕
            </button>
          </div>

          <div class="space-y-2 text-xs">
            <div class="flex justify-between items-center py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-600 dark:text-slate-300">Global Search / Copilot</span>
              <kbd class="px-2 py-0.5 rounded font-mono text-[11px] bg-warm-100 dark:bg-slate-800 border border-warm-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">⌘K / Ctrl+K</kbd>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-600 dark:text-slate-300">Inspect Deal / Row</span>
              <kbd class="px-2 py-0.5 rounded font-mono text-[11px] bg-warm-100 dark:bg-slate-800 border border-warm-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">Enter / Space</kbd>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-warm-100 dark:border-slate-800">
              <span class="text-slate-600 dark:text-slate-300">Close Modal / Dismiss Menu</span>
              <kbd class="px-2 py-0.5 rounded font-mono text-[11px] bg-warm-100 dark:bg-slate-800 border border-warm-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">Escape</kbd>
            </div>
          </div>

          <div class="pt-3 border-t border-warm-200 dark:border-slate-800 flex justify-end">
            <button
              type="button"
              onclick={() => showShortcutsModal = false}
              class="px-4 py-1.5 rounded-lg bg-warm-100 hover:bg-warm-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium transition">
              Close
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
