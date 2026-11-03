<script lang="ts">
  import { onMount } from 'svelte';

  export interface OperatorUser {
    id: string;
    email: string;
    full_name: string;
    department?: string;
    role: string;
    security_tier: string;
    status?: string;
    scopes?: string[];
  }

  interface Props {
    isOpen: boolean;
    currentUser: OperatorUser | null;
    workspaceType?: 'CRM' | 'PIPELINE';
    onClose: () => void;
    onUserUpdated?: (user: OperatorUser) => void;
  }

  let {
    isOpen,
    currentUser,
    workspaceType = 'PIPELINE',
    onClose,
    onUserUpdated
  }: Props = $props();

  // Active Tab State
  type TabId = 'profile' | 'sessions' | 'activity' | 'directory' | 'create_user' | 'audit_logs';
  let activeTab = $state<TabId>('profile');

  // Permission Checks
  let isPlatformOwner = $derived(currentUser?.security_tier === 'TIER_0');
  let isOpsAdmin = $derived(currentUser?.security_tier === 'TIER_1');
  let isElevated = $derived(isPlatformOwner || isOpsAdmin);

  // Self Profile Form
  let profileName = $state('');
  let profileDept = $state('');
  let profileFeedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
  let isSavingProfile = $state(false);

  // Password Change Form
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let passwordFeedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
  let isChangingPassword = $state(false);

  // Sessions State
  let activeSessions = $state<any[]>([]);
  let isLoadingSessions = $state(false);
  let sessionFeedback = $state<string | null>(null);

  // Personal Activity State
  let personalActivity = $state<any[]>([]);
  let isLoadingActivity = $state(false);

  // Admin: User Directory State
  let usersList = $state<any[]>([]);
  let isLoadingUsers = $state(false);
  let userSearchQuery = $state('');
  let userFilterRole = $state('ALL');
  let userFilterStatus = $state('ALL');

  // Admin: Audit Logs State
  let auditLogs = $state<any[]>([]);
  let isLoadingAuditLogs = $state(false);

  // Admin: Action Modals
  let actionTargetUser = $state<any | null>(null);
  let showSuspendModal = $state(false);
  let suspendReason = $state('');
  let showResetModal = $state(false);
  let tempResetPassword = $state('');
  let showEditRoleModal = $state(false);
  let editSelectedRole = $state('');
  let editSelectedTier = $state('');
  let editSelectedDept = $state('');
  let actionFeedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);

  // Admin: Create User Form
  let newUserName = $state('');
  let newUserEmail = $state('');
  let newUserRole = $state('');
  let newUserTier = $state('TIER_3');
  let newUserDept = $state('Operations');
  let newUserTempPassword = $state('');
  let createUserFeedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
  let isCreatingUser = $state(false);

  // Role lists based on workspace
  const crmRoles = [
    { value: 'COMMERCIAL_STRATEGIST', label: 'Commercial Strategist' },
    { value: 'TRIAGE_SPECIALIST', label: 'Triage Specialist' },
    { value: 'OPERATIONS_ADMIN', label: 'Operations Admin' }
  ];

  const pipelineRoles = [
    { value: 'COMMERCIAL_STRATEGIST', label: 'Commercial Strategist' },
    { value: 'ACCOUNT_EXECUTIVE', label: 'Account Executive' },
    { value: 'OPERATIONS_ADMIN', label: 'Operations Admin' }
  ];

  let availableRoles = $derived(
    workspaceType === 'PIPELINE' ? pipelineRoles : crmRoles
  );

  // Available Tiers for creation/editing based on actor's tier
  let assignableTiers = $derived.by(() => {
    if (isPlatformOwner) {
      return [
        { value: 'TIER_0', label: 'Tier 0 · Platform Owner' },
        { value: 'TIER_1', label: 'Tier 1 · Operations Admin' },
        { value: 'TIER_2', label: 'Tier 2 · Strategist' },
        { value: 'TIER_3', label: 'Tier 3 · Specialist / Operator' }
      ];
    }
    // Tier 1 (Ops Admin) can only assign lower tiers (Tier 2, Tier 3)
    return [
      { value: 'TIER_2', label: 'Tier 2 · Strategist' },
      { value: 'TIER_3', label: 'Tier 3 · Specialist / Operator' }
    ];
  });

  // Watch modal open and populate initial values
  $effect(() => {
    if (isOpen && currentUser) {
      profileName = currentUser.full_name || '';
      profileDept = currentUser.department || 'Operations';
      if (activeTab === 'sessions') loadSessions();
      if (activeTab === 'activity') loadPersonalActivity();
      if (activeTab === 'directory' && isElevated) loadUsers();
      if (activeTab === 'audit_logs' && isElevated) loadAuditLogs();
    }
  });

  // Reset tab selection if an unprivileged user opens
  $effect(() => {
    if (!isElevated && (activeTab === 'directory' || activeTab === 'create_user' || activeTab === 'audit_logs')) {
      activeTab = 'profile';
    }
  });

  function selectTab(tab: TabId) {
    activeTab = tab;
    profileFeedback = null;
    passwordFeedback = null;
    actionFeedback = null;
    createUserFeedback = null;

    if (tab === 'sessions') loadSessions();
    if (tab === 'activity') loadPersonalActivity();
    if (tab === 'directory' && isElevated) loadUsers();
    if (tab === 'audit_logs' && isElevated) loadAuditLogs();
  }

  // --- API HANDLERS: SELF SERVICE ---

  async function saveProfile() {
    if (!profileName.trim()) {
      profileFeedback = { type: 'error', message: 'Full name cannot be empty.' };
      return;
    }
    isSavingProfile = true;
    profileFeedback = null;
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: profileName.trim(), department: profileDept.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');
      profileFeedback = { type: 'success', message: 'Profile details updated successfully.' };
      if (onUserUpdated && currentUser) {
        onUserUpdated({ ...currentUser, full_name: profileName.trim(), department: profileDept.trim() });
      }
    } catch (err: any) {
      profileFeedback = { type: 'error', message: err.message };
    } finally {
      isSavingProfile = false;
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword) {
      passwordFeedback = { type: 'error', message: 'Please fill out all password fields.' };
      return;
    }
    if (newPassword.length < 12) {
      passwordFeedback = { type: 'error', message: 'New password must be at least 12 characters long.' };
      return;
    }
    if (newPassword !== confirmPassword) {
      passwordFeedback = { type: 'error', message: 'New passwords do not match.' };
      return;
    }

    isChangingPassword = true;
    passwordFeedback = null;
    try {
      const res = await fetch('/api/auth/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password update failed');
      passwordFeedback = { type: 'success', message: 'Password changed successfully. Your other sessions have been secured.' };
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } catch (err: any) {
      passwordFeedback = { type: 'error', message: err.message };
    } finally {
      isChangingPassword = false;
    }
  }

  async function loadSessions() {
    isLoadingSessions = true;
    try {
      const res = await fetch('/api/auth/sessions');
      const data = await res.json();
      if (res.ok && data.sessions) {
        activeSessions = data.sessions;
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingSessions = false;
    }
  }

  async function revokeOtherSessions() {
    try {
      const res = await fetch('/api/auth/sessions/revoke-others', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        sessionFeedback = `Revoked ${data.revokedCount || 0} other active session(s).`;
        await loadSessions();
      }
    } catch (e: any) {
      sessionFeedback = 'Failed to revoke other sessions.';
    }
  }

  async function loadPersonalActivity() {
    isLoadingActivity = true;
    try {
      const res = await fetch('/api/auth/activity');
      const data = await res.json();
      if (res.ok && data.activity) {
        personalActivity = data.activity;
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingActivity = false;
    }
  }

  // --- API HANDLERS: ADMIN CONTROL ---

  async function loadUsers() {
    isLoadingUsers = true;
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (res.ok && data.users) {
        usersList = data.users;
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingUsers = false;
    }
  }

  async function loadAuditLogs() {
    isLoadingAuditLogs = true;
    try {
      const res = await fetch('/api/admin/audit-logs');
      const data = await res.json();
      if (res.ok && data.auditLogs) {
        auditLogs = data.auditLogs;
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingAuditLogs = false;
    }
  }

  // Check if current user has permission to manage target user
  function canActorManage(target: any): boolean {
    if (!currentUser) return false;
    if (currentUser.id === target.id) return false; // Cannot self-manage via admin controls
    if (currentUser.security_tier === 'TIER_0') return true;
    if (currentUser.security_tier === 'TIER_1') {
      return target.security_tier !== 'TIER_0' && target.security_tier !== 'TIER_1';
    }
    return false;
  }

  function openSuspendDialog(target: any) {
    actionTargetUser = target;
    suspendReason = '';
    actionFeedback = null;
    showSuspendModal = true;
  }

  async function confirmSuspend(isFreeze: boolean) {
    if (!actionTargetUser) return;
    const newStatus = isFreeze ? 'SUSPENDED' : 'ACTIVE';
    try {
      const res = await fetch(`/api/admin/users/${actionTargetUser.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason: suspendReason || (isFreeze ? 'Suspended by admin' : 'Reactivated') })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user status');
      showSuspendModal = false;
      actionTargetUser = null;
      await loadUsers();
    } catch (err: any) {
      actionFeedback = { type: 'error', message: err.message };
    }
  }

  function openResetDialog(target: any) {
    actionTargetUser = target;
    tempResetPassword = '';
    actionFeedback = null;
    showResetModal = true;
  }

  async function confirmResetPassword() {
    if (!actionTargetUser || !tempResetPassword) return;
    if (tempResetPassword.length < 8) {
      actionFeedback = { type: 'error', message: 'Temporary password must be at least 8 characters.' };
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${actionTargetUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempPassword: tempResetPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      showResetModal = false;
      actionTargetUser = null;
      await loadUsers();
    } catch (err: any) {
      actionFeedback = { type: 'error', message: err.message };
    }
  }

  function openEditRoleDialog(target: any) {
    actionTargetUser = target;
    editSelectedRole = target.role;
    editSelectedTier = target.security_tier;
    editSelectedDept = target.department || 'Operations';
    actionFeedback = null;
    showEditRoleModal = true;
  }

  async function confirmEditRole() {
    if (!actionTargetUser) return;
    try {
      const res = await fetch(`/api/admin/users/${actionTargetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editSelectedRole,
          securityTier: editSelectedTier,
          department: editSelectedDept
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user privileges');
      showEditRoleModal = false;
      actionTargetUser = null;
      await loadUsers();
    } catch (err: any) {
      actionFeedback = { type: 'error', message: err.message };
    }
  }

  async function revokeUserSessions(target: any) {
    if (!confirm(`Revoke all active sessions for ${target.full_name}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${target.id}/revoke-sessions`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await loadUsers();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function createUser() {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserTempPassword.trim()) {
      createUserFeedback = { type: 'error', message: 'Please provide full name, email, and temporary password.' };
      return;
    }
    isCreatingUser = true;
    createUserFeedback = null;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newUserName.trim(),
          email: newUserEmail.trim(),
          role: newUserRole || availableRoles[0].value,
          securityTier: newUserTier,
          department: newUserDept.trim(),
          tempPassword: newUserTempPassword.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      createUserFeedback = { type: 'success', message: `User ${data.user?.full_name || ''} created successfully with mandatory password change on first login.` };
      newUserName = '';
      newUserEmail = '';
      newUserTempPassword = '';
      await loadUsers();
    } catch (err: any) {
      createUserFeedback = { type: 'error', message: err.message };
    } finally {
      isCreatingUser = false;
    }
  }

  // Filtered Users
  let filteredUsers = $derived.by(() => {
    let list = usersList;
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase();
      list = list.filter(u =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.department?.toLowerCase().includes(q)
      );
    }
    if (userFilterRole !== 'ALL') {
      list = list.filter(u => u.role === userFilterRole);
    }
    if (userFilterStatus !== 'ALL') {
      list = list.filter(u => u.status === userFilterStatus);
    }
    return list;
  });
</script>

{#if isOpen && currentUser}
  <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl h-[650px] max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
      
      <!-- MODAL HEADER (shrink-0) -->
      <div class="p-4 border-b border-warm-200 dark:border-slate-800 bg-warm-50/70 dark:bg-slate-900 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-orange-600/10 text-orange-700 dark:text-orange-400 font-mono font-bold text-sm flex items-center justify-center border border-orange-500/20 shrink-0">
            🛡️
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-bold text-slate-900 dark:text-white">Account & Access Control Plane</h2>
              <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 border border-orange-300 dark:border-orange-800">
                {currentUser.security_tier}
              </span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {currentUser.full_name} · {currentUser.email}
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

      <!-- NAVIGATION TABS STRIP (shrink-0) -->
      <div class="px-4 border-b border-warm-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 flex items-center gap-1 overflow-x-auto shrink-0 text-xs">
        <button
          type="button"
          onclick={() => selectTab('profile')}
          class={`px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
            activeTab === 'profile'
              ? 'border-orange-600 text-orange-600 dark:text-orange-400 font-semibold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}>
          👤 Profile & Credentials
        </button>

        <button
          type="button"
          onclick={() => selectTab('sessions')}
          class={`px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
            activeTab === 'sessions'
              ? 'border-orange-600 text-orange-600 dark:text-orange-400 font-semibold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}>
          💻 Active Sessions
        </button>

        <button
          type="button"
          onclick={() => selectTab('activity')}
          class={`px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
            activeTab === 'activity'
              ? 'border-orange-600 text-orange-600 dark:text-orange-400 font-semibold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}>
          📜 Personal Security Log
        </button>

        {#if isElevated}
          <div class="h-4 w-px bg-warm-200 dark:bg-slate-800 mx-1"></div>

          <button
            type="button"
            onclick={() => selectTab('directory')}
            class={`px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === 'directory'
                ? 'border-orange-600 text-orange-600 dark:text-orange-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}>
            👥 User Directory & Access
          </button>

          <button
            type="button"
            onclick={() => selectTab('create_user')}
            class={`px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === 'create_user'
                ? 'border-orange-600 text-orange-600 dark:text-orange-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}>
            ➕ Add Operator
          </button>

          <button
            type="button"
            onclick={() => selectTab('audit_logs')}
            class={`px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === 'audit_logs'
                ? 'border-orange-600 text-orange-600 dark:text-orange-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}>
            🛡️ Tenant Audit Trail
          </button>
        {/if}
      </div>

      <!-- MAIN TAB CONTENT AREA (flex-1, ONLY THIS REGION SCROLLS) -->
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 text-xs">
        
        <!-- 1. PROFILE & CREDENTIALS TAB -->
        {#if activeTab === 'profile'}
          <div class="max-w-2xl mx-auto space-y-6">
            <!-- Profile Info Form -->
            <div class="bg-warm-50 dark:bg-slate-850 p-4 rounded-xl border border-warm-200 dark:border-slate-800 space-y-3">
              <h3 class="font-bold text-slate-900 dark:text-white text-sm">Operator Identity</h3>
              
              {#if profileFeedback}
                <div class={`p-2.5 rounded-lg text-xs font-medium ${profileFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                  {profileFeedback.message}
                </div>
              {/if}

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label for="prof-email" class="block font-medium text-slate-600 dark:text-slate-400 mb-1">Email Address (Read-only)</label>
                  <input
                    id="prof-email"
                    type="text"
                    disabled
                    value={currentUser.email}
                    class="w-full bg-warm-100 dark:bg-slate-800 text-slate-500 rounded-lg p-2 border border-warm-200 dark:border-slate-700 cursor-not-allowed font-mono text-xs" />
                </div>

                <div>
                  <label for="prof-role" class="block font-medium text-slate-600 dark:text-slate-400 mb-1">Assigned Role & Tier</label>
                  <input
                    id="prof-role"
                    type="text"
                    disabled
                    value={`${currentUser.role} (${currentUser.security_tier})`}
                    class="w-full bg-warm-100 dark:bg-slate-800 text-slate-500 rounded-lg p-2 border border-warm-200 dark:border-slate-700 cursor-not-allowed font-mono text-xs" />
                </div>

                <div>
                  <label for="prof-name" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Display Name</label>
                  <input
                    id="prof-name"
                    type="text"
                    bind:value={profileName}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>

                <div>
                  <label for="prof-dept" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
                  <input
                    id="prof-dept"
                    type="text"
                    bind:value={profileDept}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>
              </div>

              <div class="pt-2 flex justify-end">
                <button
                  type="button"
                  onclick={saveProfile}
                  disabled={isSavingProfile}
                  class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
                  {isSavingProfile ? 'Saving...' : 'Save Profile Changes'}
                </button>
              </div>
            </div>

            <!-- Self Password Change Form -->
            <div class="bg-warm-50 dark:bg-slate-850 p-4 rounded-xl border border-warm-200 dark:border-slate-800 space-y-3">
              <h3 class="font-bold text-slate-900 dark:text-white text-sm">Update Password</h3>
              <p class="text-slate-500 dark:text-slate-400 text-xs">
                Minimum 12 characters. Changing your password secures your account and invalidates other sessions.
              </p>

              {#if passwordFeedback}
                <div class={`p-2.5 rounded-lg text-xs font-medium ${passwordFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                  {passwordFeedback.message}
                </div>
              {/if}

              <div class="space-y-2.5 max-w-md">
                <div>
                  <label for="curr-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Current Password</label>
                  <input
                    id="curr-pass"
                    type="password"
                    bind:value={currentPassword}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>

                <div>
                  <label for="new-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">New Password (12+ characters)</label>
                  <input
                    id="new-pass"
                    type="password"
                    bind:value={newPassword}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>

                <div>
                  <label for="conf-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm New Password</label>
                  <input
                    id="conf-pass"
                    type="password"
                    bind:value={confirmPassword}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>

                <div class="pt-2">
                  <button
                    type="button"
                    onclick={changePassword}
                    disabled={isChangingPassword}
                    class="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
                    {isChangingPassword ? 'Securing...' : 'Change Password'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- 2. ACTIVE SESSIONS TAB -->
        {#if activeTab === 'sessions'}
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-bold text-slate-900 dark:text-white text-sm">Active Edge Sessions</h3>
                <p class="text-slate-500 text-xs">Sessions authenticated via signed cryptographic cookies across Cloudflare PoPs.</p>
              </div>

              <button
                type="button"
                onclick={revokeOtherSessions}
                class="bg-rose-600 hover:bg-rose-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs transition">
                Revoke All Other Sessions
              </button>
            </div>

            {#if sessionFeedback}
              <div class="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium text-xs">
                {sessionFeedback}
              </div>
            {/if}

            {#if isLoadingSessions}
              <div class="text-center py-10 text-slate-400">Loading active sessions...</div>
            {:else if activeSessions.length === 0}
              <div class="text-center py-10 text-slate-400">No active sessions found.</div>
            {:else}
              <div class="space-y-2">
                {#each activeSessions as s}
                  <div class="p-3 rounded-xl border border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-850 flex items-center justify-between">
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="font-mono font-semibold text-slate-800 dark:text-slate-200">{s.ip_address || 'Cloudflare Edge'}</span>
                        {#if s.is_current}
                          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            Current Device
                          </span>
                        {/if}
                      </div>
                      <p class="text-slate-500 dark:text-slate-400 text-[11px] truncate mt-0.5 max-w-md">
                        {s.user_agent || 'Modern Web Browser'}
                      </p>
                      <div class="text-[10px] font-mono text-slate-400 mt-1 flex gap-3">
                        <span>Started: {s.created_at?.slice(0, 16)}</span>
                        <span>Last Active: {s.last_active_at?.slice(0, 16)}</span>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- 3. PERSONAL SECURITY LOG TAB -->
        {#if activeTab === 'activity'}
          <div class="space-y-4">
            <div>
              <h3 class="font-bold text-slate-900 dark:text-white text-sm">Personal Security Activity</h3>
              <p class="text-slate-500 text-xs">Immutable audit log of authentication and credential events on your account.</p>
            </div>

            {#if isLoadingActivity}
              <div class="text-center py-10 text-slate-400">Loading activity...</div>
            {:else if personalActivity.length === 0}
              <div class="text-center py-10 text-slate-400">No security events recorded yet.</div>
            {:else}
              <div class="border border-warm-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table class="w-full text-left text-xs border-collapse">
                  <thead class="bg-warm-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                    <tr>
                      <th class="p-2.5">Event</th>
                      <th class="p-2.5">Timestamp</th>
                      <th class="p-2.5">IP Address</th>
                      <th class="p-2.5">Details</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-warm-100 dark:divide-slate-800 font-mono text-[11px]">
                    {#each personalActivity as act}
                      <tr class="hover:bg-warm-50 dark:hover:bg-slate-850/60">
                        <td class="p-2.5 font-sans font-medium text-slate-800 dark:text-slate-200">{act.event_type}</td>
                        <td class="p-2.5 text-slate-500">{act.created_at?.slice(0, 19)}</td>
                        <td class="p-2.5 text-slate-500">{act.ip_address || '-'}</td>
                        <td class="p-2.5 text-slate-600 dark:text-slate-400 truncate max-w-xs">{act.metadata_json || '-'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {/if}

        <!-- 4. USER DIRECTORY & ACCESS TAB (Admin Only) -->
        {#if activeTab === 'directory' && isElevated}
          <div class="space-y-4">
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 class="font-bold text-slate-900 dark:text-white text-sm">User Directory & Privilege Management</h3>
                <p class="text-slate-500 text-xs">Review operator statuses, reset credentials, and enforce account lockouts.</p>
              </div>

              <!-- Filter Strip -->
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search user or email..."
                  bind:value={userSearchQuery}
                  class="bg-warm-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs" />

                <select
                  bind:value={userFilterStatus}
                  class="bg-warm-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs">
                  <option value="ALL">All Status</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
            </div>

            {#if isLoadingUsers}
              <div class="text-center py-10 text-slate-400">Loading tenant directory...</div>
            {:else}
              <div class="border border-warm-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                <table class="w-full text-left text-xs border-collapse">
                  <thead class="bg-warm-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                    <tr>
                      <th class="p-2.5">Operator</th>
                      <th class="p-2.5">Role & Tier</th>
                      <th class="p-2.5">Status</th>
                      <th class="p-2.5">Sessions</th>
                      <th class="p-2.5 text-right">Administrative Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-warm-100 dark:divide-slate-800">
                    {#each filteredUsers as u}
                      {@const canManage = canActorManage(u)}
                      <tr class="hover:bg-warm-50/60 dark:hover:bg-slate-850/50">
                        <td class="p-2.5">
                          <div class="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{u.full_name}</span>
                            {#if u.id === currentUser.id}
                              <span class="text-[9px] font-mono bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 px-1 rounded">YOU</span>
                            {/if}
                          </div>
                          <div class="text-slate-500 font-mono text-[11px] truncate">{u.email}</div>
                          <div class="text-[10px] text-slate-400">{u.department || 'Operations'}</div>
                        </td>

                        <td class="p-2.5">
                          <div class="font-medium text-slate-800 dark:text-slate-200">{u.role}</div>
                          <div class="font-mono text-[10px] font-semibold text-orange-600 dark:text-orange-400">{u.security_tier}</div>
                        </td>

                        <td class="p-2.5">
                          <div class="flex flex-col gap-1">
                            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold w-fit ${
                              u.status === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}>
                              <span class={`w-1.5 h-1.5 rounded-full ${u.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                              {u.status}
                            </span>
                            {#if u.must_change_password}
                              <span class="text-[9px] font-mono text-amber-600 dark:text-amber-400">Must Change Password</span>
                            {/if}
                            {#if u.suspended_reason}
                              <span class="text-[9px] text-rose-500 truncate max-w-[120px]" title={u.suspended_reason}>
                                Reason: {u.suspended_reason}
                              </span>
                            {/if}
                          </div>
                        </td>

                        <td class="p-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {u.active_sessions_count || 0} active
                        </td>

                        <td class="p-2.5 text-right">
                          {#if canManage}
                            <div class="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onclick={() => openEditRoleDialog(u)}
                                class="px-2 py-1 bg-warm-200 hover:bg-warm-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded font-medium text-[11px] transition">
                                Edit Role
                              </button>

                              <button
                                type="button"
                                onclick={() => openResetDialog(u)}
                                class="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900 dark:text-amber-300 rounded font-medium text-[11px] transition">
                                Reset Pass
                              </button>

                              {#if u.status === 'ACTIVE'}
                                <button
                                  type="button"
                                  onclick={() => openSuspendDialog(u)}
                                  class="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-950 dark:hover:bg-rose-900 dark:text-rose-300 rounded font-medium text-[11px] transition">
                                  Freeze
                                </button>
                              {:else}
                                <button
                                  type="button"
                                  onclick={() => { actionTargetUser = u; confirmSuspend(false); }}
                                  class="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:hover:bg-emerald-900 dark:text-emerald-300 rounded font-medium text-[11px] transition">
                                  Unfreeze
                                </button>
                              {/if}

                              <button
                                type="button"
                                onclick={() => revokeUserSessions(u)}
                                class="px-2 py-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-[11px]"
                                title="Revoke all active sessions">
                                🔌
                              </button>
                            </div>
                          {:else}
                            <span class="text-[10px] text-slate-400 italic">
                              {u.id === currentUser.id ? 'Self Account' : 'Higher Tier Protected'}
                            </span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {/if}

        <!-- 5. ADD OPERATOR TAB (Admin Only) -->
        {#if activeTab === 'create_user' && isElevated}
          <div class="max-w-xl mx-auto bg-warm-50 dark:bg-slate-850 p-5 rounded-xl border border-warm-200 dark:border-slate-800 space-y-4">
            <div>
              <h3 class="font-bold text-slate-900 dark:text-white text-sm">Provision New Operator</h3>
              <p class="text-slate-500 text-xs">Create an authenticated operator account. User will be prompted to reset their password on first sign-in.</p>
            </div>

            {#if createUserFeedback}
              <div class={`p-3 rounded-lg text-xs font-medium ${createUserFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                {createUserFeedback.message}
              </div>
            {/if}

            <div class="space-y-3">
              <div>
                <label for="new-fullname" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
                <input
                  id="new-fullname"
                  type="text"
                  placeholder="e.g. Shakib Rahman"
                  bind:value={newUserName}
                  class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
              </div>

              <div>
                <label for="new-email" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Work Email</label>
                <input
                  id="new-email"
                  type="email"
                  placeholder="e.g. s.rahman@biai.com.bd"
                  bind:value={newUserEmail}
                  class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="new-role" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Role Designation</label>
                  <select
                    id="new-role"
                    bind:value={newUserRole}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500">
                    {#each availableRoles as r}
                      <option value={r.value}>{r.label}</option>
                    {/each}
                  </select>
                </div>

                <div>
                  <label for="new-tier" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Security Tier</label>
                  <select
                    id="new-tier"
                    bind:value={newUserTier}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500">
                    {#each assignableTiers as t}
                      <option value={t.value}>{t.label}</option>
                    {/each}
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="new-dept" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
                  <input
                    id="new-dept"
                    type="text"
                    bind:value={newUserDept}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>

                <div>
                  <label for="new-temppass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Temporary Password</label>
                  <input
                    id="new-temppass"
                    type="password"
                    placeholder="Min 8 characters"
                    bind:value={newUserTempPassword}
                    class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>
              </div>

              <div class="pt-3 flex justify-end">
                <button
                  type="button"
                  onclick={createUser}
                  disabled={isCreatingUser}
                  class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
                  {isCreatingUser ? 'Provisioning...' : 'Provision Operator'}
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- 6. TENANT AUDIT TRAIL TAB (Admin Only) -->
        {#if activeTab === 'audit_logs' && isElevated}
          <div class="space-y-4">
            <div>
              <h3 class="font-bold text-slate-900 dark:text-white text-sm">Tenant Security & Operational Audit Trail</h3>
              <p class="text-slate-500 text-xs">Immutable system records of user management, tier changes, and security events.</p>
            </div>

            {#if isLoadingAuditLogs}
              <div class="text-center py-10 text-slate-400">Loading audit trail...</div>
            {:else if auditLogs.length === 0}
              <div class="text-center py-10 text-slate-400">No administrative audit records logged yet.</div>
            {:else}
              <div class="border border-warm-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                <table class="w-full text-left text-xs border-collapse">
                  <thead class="bg-warm-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                    <tr>
                      <th class="p-2.5">Timestamp</th>
                      <th class="p-2.5">Actor</th>
                      <th class="p-2.5">Event</th>
                      <th class="p-2.5">Target</th>
                      <th class="p-2.5">Metadata Details</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-warm-100 dark:divide-slate-800 font-mono text-[11px]">
                    {#each auditLogs as log}
                      <tr class="hover:bg-warm-50 dark:hover:bg-slate-850/60">
                        <td class="p-2.5 text-slate-500 whitespace-nowrap">{log.created_at?.slice(0, 19)}</td>
                        <td class="p-2.5 font-sans font-medium text-slate-800 dark:text-slate-200">{log.actor_id} ({log.actor_role})</td>
                        <td class="p-2.5 font-semibold text-orange-600 dark:text-orange-400">{log.event_type}</td>
                        <td class="p-2.5 text-slate-600 dark:text-slate-300">{log.entity_id || '-'}</td>
                        <td class="p-2.5 text-slate-500 truncate max-w-sm">{log.metadata_json || '-'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {/if}

      </div>
    </div>
  </div>

  <!-- POPUP: SUSPEND / FREEZE USER MODAL -->
  {#if showSuspendModal && actionTargetUser}
    <div class="fixed inset-0 z-60 bg-black/60 flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
        <h4 class="font-bold text-slate-900 dark:text-white text-sm">Freeze / Suspend Account Access</h4>
        <p class="text-xs text-slate-600 dark:text-slate-400">
          Suspending <strong>{actionTargetUser.full_name}</strong> immediately revokes all active sessions and blocks future sign-in attempts.
        </p>

        <div>
          <label for="susp-reason" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Reason for suspension</label>
          <input
            id="susp-reason"
            type="text"
            placeholder="e.g. Compromised credentials or policy review"
            bind:value={suspendReason}
            class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs" />
        </div>

        {#if actionFeedback}
          <div class="text-rose-600 text-xs">{actionFeedback.message}</div>
        {/if}

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onclick={() => { showSuspendModal = false; actionTargetUser = null; }}
            class="px-3 py-1.5 rounded-lg border border-warm-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs">
            Cancel
          </button>
          <button
            type="button"
            onclick={() => confirmSuspend(true)}
            class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs">
            Confirm Freeze
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- POPUP: RESET PASSWORD MODAL -->
  {#if showResetModal && actionTargetUser}
    <div class="fixed inset-0 z-60 bg-black/60 flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
        <h4 class="font-bold text-slate-900 dark:text-white text-sm">Admin Password Reset</h4>
        <p class="text-xs text-slate-600 dark:text-slate-400">
          Set a temporary password for <strong>{actionTargetUser.full_name}</strong>. The user will be required to change it on their next login.
        </p>

        <div>
          <label for="admin-temp-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">New Temporary Password</label>
          <input
            id="admin-temp-pass"
            type="password"
            placeholder="Minimum 8 characters"
            bind:value={tempResetPassword}
            class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs" />
        </div>

        {#if actionFeedback}
          <div class="text-rose-600 text-xs">{actionFeedback.message}</div>
        {/if}

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onclick={() => { showResetModal = false; actionTargetUser = null; }}
            class="px-3 py-1.5 rounded-lg border border-warm-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs">
            Cancel
          </button>
          <button
            type="button"
            onclick={confirmResetPassword}
            class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs">
            Set Temporary Password
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- POPUP: EDIT PRIVILEGES MODAL -->
  {#if showEditRoleModal && actionTargetUser}
    <div class="fixed inset-0 z-60 bg-black/60 flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
        <h4 class="font-bold text-slate-900 dark:text-white text-sm">Update Privileges: {actionTargetUser.full_name}</h4>
        
        <div class="space-y-3">
          <div>
            <label for="edit-role-sel" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Role</label>
            <select
              id="edit-role-sel"
              bind:value={editSelectedRole}
              class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs">
              {#each availableRoles as r}
                <option value={r.value}>{r.label}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="edit-tier-sel" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Security Tier</label>
            <select
              id="edit-tier-sel"
              bind:value={editSelectedTier}
              class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs">
              {#each assignableTiers as t}
                <option value={t.value}>{t.label}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="edit-dept-input" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Department</label>
            <input
              id="edit-dept-input"
              type="text"
              bind:value={editSelectedDept}
              class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-warm-200 dark:border-slate-700 text-xs" />
          </div>
        </div>

        {#if actionFeedback}
          <div class="text-rose-600 text-xs">{actionFeedback.message}</div>
        {/if}

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onclick={() => { showEditRoleModal = false; actionTargetUser = null; }}
            class="px-3 py-1.5 rounded-lg border border-warm-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs">
            Cancel
          </button>
          <button
            type="button"
            onclick={confirmEditRole}
            class="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs">
            Save Privileges
          </button>
        </div>
      </div>
    </div>
  {/if}

{/if}
