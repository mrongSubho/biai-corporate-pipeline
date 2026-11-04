<script lang="ts">
  import Icon from './Icon.svelte';

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

  // Navigation State
  type NavSection = 'profile' | 'security' | 'sessions' | 'activity' | 'directory' | 'audit_logs';
  let activeNav = $state<NavSection>('profile');

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
  let showCurrentPass = $state(false);
  let showNewPass = $state(false);
  let passwordFeedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
  let isChangingPassword = $state(false);

  // Sessions State
  let activeSessions = $state<any[]>([]);
  let isLoadingSessions = $state(false);
  let sessionFeedback = $state<string | null>(null);
  let showRevokeOthersConfirm = $state(false);

  // Personal Activity State
  let personalActivity = $state<any[]>([]);
  let isLoadingActivity = $state(false);

  // Admin: User Directory State
  let usersList = $state<any[]>([]);
  let isLoadingUsers = $state(false);
  let userSearchQuery = $state('');
  let userFilterRole = $state('ALL');
  let userFilterStatus = $state('ALL');

  // Admin: Slide-Over Drawer State
  type DrawerMode = 'CREATE' | 'MANAGE' | null;
  let drawerMode = $state<DrawerMode>(null);
  let drawerTargetUser = $state<any | null>(null);

  // Drawer Form State - Manage
  let editRole = $state('');
  let editTier = $state('');
  let editDept = $state('');
  let resetTempPassword = $state('');
  let suspendReason = $state('');
  let isFreezing = $state(false);
  let drawerFeedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
  let copiedPassword = $state(false);

  // Drawer Form State - Create User
  let newUserName = $state('');
  let newUserEmail = $state('');
  let newUserRole = $state('');
  let newUserTier = $state('TIER_3');
  let newUserDept = $state('Operations');
  let newUserTempPassword = $state('');
  let isCreatingUser = $state(false);

  // Admin: Audit Logs State
  let auditLogs = $state<any[]>([]);
  let isLoadingAuditLogs = $state(false);
  let auditSearchQuery = $state('');

  // Available Roles based on workspace
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

  // Assignable Tiers based on actor
  let assignableTiers = $derived.by(() => {
    if (isPlatformOwner) {
      return [
        { value: 'TIER_0', label: 'Tier 0 · Platform Owner' },
        { value: 'TIER_1', label: 'Tier 1 · Operations Admin' },
        { value: 'TIER_2', label: 'Tier 2 · Strategist' },
        { value: 'TIER_3', label: 'Tier 3 · Specialist / Operator' }
      ];
    }
    return [
      { value: 'TIER_2', label: 'Tier 2 · Strategist' },
      { value: 'TIER_3', label: 'Tier 3 · Specialist / Operator' }
    ];
  });

  // Watch modal open
  $effect(() => {
    if (isOpen && currentUser) {
      profileName = currentUser.full_name || '';
      profileDept = currentUser.department || 'Operations';
      if (activeNav === 'sessions') loadSessions();
      if (activeNav === 'activity') loadPersonalActivity();
      if (activeNav === 'directory' && isElevated) loadUsers();
      if (activeNav === 'audit_logs' && isElevated) loadAuditLogs();
    }
  });

  // Reset nav if user doesn't have elevated privileges
  $effect(() => {
    if (!isElevated && (activeNav === 'directory' || activeNav === 'audit_logs')) {
      activeNav = 'profile';
    }
  });

  function selectNav(nav: NavSection) {
    activeNav = nav;
    profileFeedback = null;
    passwordFeedback = null;
    sessionFeedback = null;
    drawerFeedback = null;
    drawerMode = null;

    if (nav === 'sessions') loadSessions();
    if (nav === 'activity') loadPersonalActivity();
    if (nav === 'directory' && isElevated) loadUsers();
    if (nav === 'audit_logs' && isElevated) loadAuditLogs();
  }

  // --- PASSWORD GENERATOR HELPER ---
  function generateSecurePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let pass = '';
    for (let i = 0; i < 16; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedPassword = true;
      setTimeout(() => copiedPassword = false, 2000);
    } catch (e) {
      console.error(e);
    }
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
      passwordFeedback = { type: 'success', message: 'Password changed successfully. Other active sessions secured.' };
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
        showRevokeOthersConfirm = false;
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

  function canActorManage(target: any): boolean {
    if (!currentUser) return false;
    if (currentUser.id === target.id) return false;
    if (currentUser.security_tier === 'TIER_0') return true;
    if (currentUser.security_tier === 'TIER_1') {
      return target.security_tier !== 'TIER_0' && target.security_tier !== 'TIER_1';
    }
    return false;
  }

  function openCreateDrawer() {
    drawerMode = 'CREATE';
    drawerTargetUser = null;
    newUserName = '';
    newUserEmail = '';
    newUserRole = availableRoles[0].value;
    newUserTier = 'TIER_3';
    newUserDept = 'Operations';
    newUserTempPassword = generateSecurePassword();
    drawerFeedback = null;
  }

  function openManageDrawer(target: any) {
    drawerMode = 'MANAGE';
    drawerTargetUser = target;
    editRole = target.role;
    editTier = target.security_tier;
    editDept = target.department || 'Operations';
    resetTempPassword = '';
    suspendReason = '';
    isFreezing = false;
    drawerFeedback = null;
  }

  function closeDrawer() {
    drawerMode = null;
    drawerTargetUser = null;
    drawerFeedback = null;
  }

  async function submitCreateUser() {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserTempPassword.trim()) {
      drawerFeedback = { type: 'error', message: 'Name, email, and temporary password are required.' };
      return;
    }
    isCreatingUser = true;
    drawerFeedback = null;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newUserName.trim(),
          email: newUserEmail.trim(),
          role: newUserRole,
          securityTier: newUserTier,
          department: newUserDept.trim(),
          tempPassword: newUserTempPassword.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      drawerFeedback = { type: 'success', message: `User ${data.user?.full_name} provisioned successfully.` };
      await loadUsers();
      setTimeout(() => closeDrawer(), 1200);
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    } finally {
      isCreatingUser = false;
    }
  }

  async function submitPrivilegeUpdate() {
    if (!drawerTargetUser) return;
    drawerFeedback = null;
    try {
      const res = await fetch(`/api/admin/users/${drawerTargetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editRole,
          securityTier: editTier,
          department: editDept
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update privileges');
      drawerFeedback = { type: 'success', message: 'Operator privileges updated.' };
      await loadUsers();
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    }
  }

  async function submitPasswordReset() {
    if (!drawerTargetUser || !resetTempPassword) return;
    if (resetTempPassword.length < 8) {
      drawerFeedback = { type: 'error', message: 'Password must be at least 8 characters.' };
      return;
    }
    drawerFeedback = null;
    try {
      const res = await fetch(`/api/admin/users/${drawerTargetUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempPassword: resetTempPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      drawerFeedback = { type: 'success', message: 'Temporary password set. User must change it on login.' };
      await loadUsers();
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    }
  }

  async function submitStatusChange(isFreeze: boolean) {
    if (!drawerTargetUser) return;
    drawerFeedback = null;
    try {
      const res = await fetch(`/api/admin/users/${drawerTargetUser.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: isFreeze ? 'SUSPENDED' : 'ACTIVE',
          reason: suspendReason || (isFreeze ? 'Suspended by admin' : 'Reactivated')
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      drawerFeedback = { type: 'success', message: isFreeze ? 'Account frozen and sessions revoked.' : 'Account reactivated.' };
      isFreezing = false;
      await loadUsers();
      if (drawerTargetUser) {
        drawerTargetUser.status = isFreeze ? 'SUSPENDED' : 'ACTIVE';
      }
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    }
  }

  async function submitRevokeSessions() {
    if (!drawerTargetUser) return;
    drawerFeedback = null;
    try {
      const res = await fetch(`/api/admin/users/${drawerTargetUser.id}/revoke-sessions`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke sessions');
      drawerFeedback = { type: 'success', message: 'Active sessions revoked successfully.' };
      await loadUsers();
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
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

  // Filtered Audit Logs
  let filteredAuditLogs = $derived.by(() => {
    let list = auditLogs;
    if (auditSearchQuery.trim()) {
      const q = auditSearchQuery.toLowerCase();
      list = list.filter(l =>
        l.event_type?.toLowerCase().includes(q) ||
        l.actor_id?.toLowerCase().includes(q) ||
        l.metadata_json?.toLowerCase().includes(q)
      );
    }
    return list;
  });

  // Parse metadata JSON helper
  function formatMetadata(jsonStr: string | null): Array<{ key: string; val: string }> {
    if (!jsonStr) return [];
    try {
      const obj = JSON.parse(jsonStr);
      return Object.entries(obj).map(([k, v]) => ({
        key: k.replace(/_/g, ' '),
        val: typeof v === 'object' ? JSON.stringify(v) : String(v)
      }));
    } catch {
      return [{ key: 'info', val: jsonStr }];
    }
  }
</script>

{#if isOpen && currentUser}
  <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
    <!-- MODAL CONTAINER (2-Pane Architecture) -->
    <div class="relative bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl h-[680px] max-h-[92vh] flex shadow-2xl overflow-hidden font-sans">
      
      <!-- LEFT NAVIGATION SIDEBAR (w-64, shrink-0, border-r) -->
      <aside class="w-60 sm:w-64 border-r border-warm-200 dark:border-slate-800 bg-warm-50/60 dark:bg-slate-900/90 flex flex-col justify-between shrink-0">
        <div>
          <!-- Header Branding & Identity -->
          <div class="p-4 border-b border-warm-200 dark:border-slate-800">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-orange-600/10 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
                <Icon name="shield-check" size={18} />
              </div>
              <div class="min-w-0 flex-1">
                <h2 class="text-xs font-bold text-slate-900 dark:text-white truncate">Access & Security</h2>
                <div class="text-[10px] font-mono text-slate-400 truncate">Control Plane</div>
              </div>
            </div>

            <!-- Operator Pill -->
            <div class="mt-3 p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-warm-200 dark:border-slate-700/80">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-slate-900 dark:text-white truncate">{currentUser.full_name}</span>
                <span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300">
                  {currentUser.security_tier}
                </span>
              </div>
              <div class="text-[10px] font-mono text-slate-400 truncate mt-0.5">{currentUser.role}</div>
            </div>
          </div>

          <!-- Navigation Groups -->
          <nav class="p-3 space-y-4 text-xs font-medium">
            <!-- Group 1: Personal Account -->
            <div>
              <div class="px-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Personal Account
              </div>
              <div class="space-y-0.5">
                <button
                  type="button"
                  onclick={() => selectNav('profile')}
                  class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition ${
                    activeNav === 'profile'
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}>
                  <Icon name="user" size={15} />
                  <span>Profile & Details</span>
                </button>

                <button
                  type="button"
                  onclick={() => selectNav('security')}
                  class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition ${
                    activeNav === 'security'
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}>
                  <Icon name="key" size={15} />
                  <span>Password & Security</span>
                </button>

                <button
                  type="button"
                  onclick={() => selectNav('sessions')}
                  class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
                    activeNav === 'sessions'
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}>
                  <span class="flex items-center gap-2.5">
                    <Icon name="monitor" size={15} />
                    <span>Active Sessions</span>
                  </span>
                  {#if activeSessions.length > 0}
                    <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-warm-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {activeSessions.length}
                    </span>
                  {/if}
                </button>

                <button
                  type="button"
                  onclick={() => selectNav('activity')}
                  class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition ${
                    activeNav === 'activity'
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}>
                  <Icon name="activity" size={15} />
                  <span>Personal Activity Log</span>
                </button>
              </div>
            </div>

            <!-- Group 2: Workspace Admin (Elevated Only) -->
            {#if isElevated}
              <div>
                <div class="px-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Workspace Admin
                </div>
                <div class="space-y-0.5">
                  <button
                    type="button"
                    onclick={() => selectNav('directory')}
                    class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
                      activeNav === 'directory'
                        ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}>
                    <span class="flex items-center gap-2.5">
                      <Icon name="users" size={15} />
                      <span>Operator Directory</span>
                    </span>
                    {#if usersList.length > 0}
                      <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-warm-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {usersList.length}
                      </span>
                    {/if}
                  </button>

                  <button
                    type="button"
                    onclick={() => selectNav('audit_logs')}
                    class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition ${
                      activeNav === 'audit_logs'
                        ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}>
                    <Icon name="file-text" size={15} />
                    <span>Tenant Audit Ledger</span>
                  </button>
                </div>
              </div>
            {/if}
          </nav>
        </div>

        <!-- Sidebar Footer -->
        <div class="p-3 border-t border-warm-200 dark:border-slate-800">
          <button
            type="button"
            onclick={onClose}
            class="w-full py-2 px-3 rounded-xl border border-warm-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center justify-center gap-2 text-xs font-semibold transition">
            <Icon name="x" size={14} />
            <span>Close Control Plane</span>
          </button>
        </div>
      </aside>

      <!-- RIGHT MAIN CONTENT CANVAS (flex-1 flex flex-col min-h-0 overflow-hidden relative) -->
      <main class="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-slate-900">
        
        <!-- Pinned Header for Active Section -->
        <header class="p-4 border-b border-warm-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs">
          <div>
            <h3 class="text-sm font-bold text-slate-900 dark:text-white">
              {#if activeNav === 'profile'}Operator Profile & Scopes
              {:else if activeNav === 'security'}Security & Password Authentication
              {:else if activeNav === 'sessions'}Active Cloudflare Edge Sessions
              {:else if activeNav === 'activity'}Personal Security Activity Log
              {:else if activeNav === 'directory'}Operator Directory & Privilege Governance
              {:else if activeNav === 'audit_logs'}Tenant Operational & Security Audit Trail
              {/if}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {#if activeNav === 'profile'}Manage your profile details and inspect assigned role scopes.
              {:else if activeNav === 'security'}Secure your operator credentials with PBKDF2-SHA256 authentication.
              {:else if activeNav === 'sessions'}Real-time cryptographic session cookies authenticated at Cloudflare edge PoPs.
              {:else if activeNav === 'activity'}Chronological record of login events and credential changes on your account.
              {:else if activeNav === 'directory'}Provision accounts, manage security tiers, and execute emergency freezes.
              {:else if activeNav === 'audit_logs'}Immutable compliance log recording all system and privilege modifications.
              {/if}
            </p>
          </div>

          <button
            type="button"
            onclick={onClose}
            class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-warm-100 dark:hover:bg-slate-800 transition"
            aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </header>

        <!-- Scrollable Body Canvas (flex-1 min-h-0 overflow-y-auto overscroll-contain) -->
        <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 text-xs">
          
          <!-- 1. PROFILE & SCOPES -->
          {#if activeNav === 'profile'}
            <div class="max-w-2xl mx-auto space-y-6">
              {#if profileFeedback}
                <div class={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                  profileFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}>
                  <Icon name={profileFeedback.type === 'success' ? 'check-circle' : 'alert-circle'} size={15} />
                  <span>{profileFeedback.message}</span>
                </div>
              {/if}

              <!-- Profile Details Card -->
              <div class="bg-warm-50/70 dark:bg-slate-950 p-5 rounded-2xl border border-warm-200 dark:border-slate-800 space-y-4">
                <h4 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Identity Details</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label for="prof-email" class="block font-medium text-slate-600 dark:text-slate-400 mb-1">Work Email (Verified)</label>
                    <input
                      id="prof-email"
                      type="text"
                      disabled
                      value={currentUser.email}
                      class="w-full bg-warm-100 dark:bg-slate-800 text-slate-500 rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 cursor-not-allowed font-mono text-xs" />
                  </div>

                  <div>
                    <label for="prof-role" class="block font-medium text-slate-600 dark:text-slate-400 mb-1">Role Designation</label>
                    <input
                      id="prof-role"
                      type="text"
                      disabled
                      value={`${currentUser.role} (${currentUser.security_tier})`}
                      class="w-full bg-warm-100 dark:bg-slate-800 text-slate-500 rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 cursor-not-allowed font-mono text-xs" />
                  </div>

                  <div>
                    <label for="prof-name" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Display Name</label>
                    <input
                      id="prof-name"
                      type="text"
                      bind:value={profileName}
                      class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>

                  <div>
                    <label for="prof-dept" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
                    <input
                      id="prof-dept"
                      type="text"
                      bind:value={profileDept}
                      class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>
                </div>

                <div class="pt-2 flex justify-end">
                  <button
                    type="button"
                    onclick={saveProfile}
                    disabled={isSavingProfile}
                    class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-4 py-2 rounded-xl transition shadow-xs disabled:opacity-50 flex items-center gap-1.5">
                    {#if isSavingProfile}
                      <Icon name="refresh-cw" size={14} class="animate-spin" />
                    {:else}
                      <Icon name="check" size={14} />
                    {/if}
                    <span>{isSavingProfile ? 'Saving...' : 'Save Profile'}</span>
                  </button>
                </div>
              </div>

              <!-- Permission Scopes Card -->
              <div class="bg-warm-50/70 dark:bg-slate-950 p-5 rounded-2xl border border-warm-200 dark:border-slate-800 space-y-3">
                <div class="flex items-center justify-between">
                  <h4 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Assigned Scope Capabilities</h4>
                  <span class="text-[10px] font-mono text-slate-500">{currentUser.scopes?.length || 0} Permissions Granted</span>
                </div>

                {#if currentUser.scopes && currentUser.scopes.length > 0}
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[10px]">
                    {#each currentUser.scopes as sc}
                      <div class="p-2 rounded-xl bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Icon name="check-circle" size={13} class="text-emerald-500" />
                        <span class="truncate">{sc}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-slate-400 italic">No specific granular scopes assigned; inheriting standard role tier capabilities.</p>
                {/if}
              </div>
            </div>
          {/if}

          <!-- 2. SECURITY & PASSWORD -->
          {#if activeNav === 'security'}
            <div class="max-w-xl mx-auto space-y-6">
              {#if passwordFeedback}
                <div class={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                  passwordFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}>
                  <Icon name={passwordFeedback.type === 'success' ? 'check-circle' : 'alert-circle'} size={15} />
                  <span>{passwordFeedback.message}</span>
                </div>
              {/if}

              <div class="bg-warm-50/70 dark:bg-slate-950 p-6 rounded-2xl border border-warm-200 dark:border-slate-800 space-y-4">
                <div>
                  <h4 class="font-bold text-slate-900 dark:text-white text-sm">Change Operator Password</h4>
                  <p class="text-slate-500 text-xs mt-0.5">Changing your password invalidates your other edge sessions for protection.</p>
                </div>

                <div class="space-y-3">
                  <div>
                    <label for="curr-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Current Password</label>
                    <div class="relative">
                      <input
                        id="curr-pass"
                        type={showCurrentPass ? 'text' : 'password'}
                        bind:value={currentPassword}
                        class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2.5 pr-10 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                      <button
                        type="button"
                        onclick={() => showCurrentPass = !showCurrentPass}
                        class="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <Icon name={showCurrentPass ? 'eye-off' : 'eye'} size={15} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label for="new-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">New Password (12+ characters)</label>
                    <div class="relative">
                      <input
                        id="new-pass"
                        type={showNewPass ? 'text' : 'password'}
                        bind:value={newPassword}
                        class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2.5 pr-10 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                      <button
                        type="button"
                        onclick={() => showNewPass = !showNewPass}
                        class="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <Icon name={showNewPass ? 'eye-off' : 'eye'} size={15} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label for="conf-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm New Password</label>
                    <input
                      id="conf-pass"
                      type="password"
                      bind:value={confirmPassword}
                      class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>

                  <!-- Requirements Checklist -->
                  <div class="p-3 rounded-xl bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-700 space-y-1.5 text-[11px]">
                    <div class="flex items-center gap-2">
                      <Icon name="check" size={13} class={newPassword.length >= 12 ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'} />
                      <span class={newPassword.length >= 12 ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}>Minimum 12 characters</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Icon name="check" size={13} class={newPassword && newPassword === confirmPassword ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'} />
                      <span class={newPassword && newPassword === confirmPassword ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}>Passwords match</span>
                    </div>
                  </div>

                  <div class="pt-2">
                    <button
                      type="button"
                      onclick={changePassword}
                      disabled={isChangingPassword}
                      class="w-full bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold py-2.5 rounded-xl transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2">
                      <Icon name="lock" size={14} />
                      <span>{isChangingPassword ? 'Securing Account...' : 'Update Password'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          {/if}

          <!-- 3. ACTIVE SESSIONS -->
          {#if activeNav === 'sessions'}
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <h4 class="font-bold text-slate-900 dark:text-white text-sm">Active Edge Sessions</h4>
                  <p class="text-slate-500 text-xs">Sessions authenticated via signed cryptographic cookies across Cloudflare PoPs.</p>
                </div>

                <button
                  type="button"
                  onclick={() => showRevokeOthersConfirm = !showRevokeOthersConfirm}
                  class="bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900 dark:text-rose-300 font-semibold px-3 py-1.5 rounded-xl text-xs border border-rose-200 dark:border-rose-800 transition flex items-center gap-1.5">
                  <Icon name="log-out" size={13} />
                  <span>Revoke Other Sessions</span>
                </button>
              </div>

              {#if showRevokeOthersConfirm}
                <div class="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 text-xs">
                  <span class="text-rose-800 dark:text-rose-200">Are you sure? This will disconnect all your other devices.</span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onclick={() => showRevokeOthersConfirm = false}
                      class="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-700 dark:text-rose-300 font-medium">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onclick={revokeOtherSessions}
                      class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold">
                      Confirm Revoke
                    </button>
                  </div>
                </div>
              {/if}

              {#if sessionFeedback}
                <div class="p-3 rounded-xl bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium text-xs flex items-center gap-2">
                  <Icon name="check-circle" size={15} />
                  <span>{sessionFeedback}</span>
                </div>
              {/if}

              {#if isLoadingSessions}
                <div class="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
                  <Icon name="refresh-cw" size={18} class="animate-spin text-orange-500" />
                  <span>Inspecting active sessions...</span>
                </div>
              {:else if activeSessions.length === 0}
                <div class="text-center py-12 text-slate-400 italic">No active sessions found.</div>
              {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {#each activeSessions as s}
                    <div class="p-4 rounded-2xl border border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-950 flex items-start gap-3">
                      <div class="p-2 rounded-xl bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-warm-200 dark:border-slate-700 shrink-0">
                        <Icon name={s.user_agent?.toLowerCase().includes('mobile') ? 'smartphone' : 'monitor'} size={18} />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="font-mono font-semibold text-slate-900 dark:text-white truncate">{s.ip_address || 'Cloudflare Edge'}</span>
                          {#if s.is_current}
                            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                              Current Device
                            </span>
                          {/if}
                        </div>
                        <p class="text-slate-500 dark:text-slate-400 text-[11px] truncate mt-1">
                          {s.user_agent || 'Modern Web Browser'}
                        </p>
                        <div class="text-[10px] font-mono text-slate-400 mt-2 flex flex-wrap gap-x-3">
                          <span>Created: {s.created_at?.slice(0, 16)}</span>
                          <span>Last Active: {s.last_active_at?.slice(0, 16)}</span>
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- 4. PERSONAL ACTIVITY LOG -->
          {#if activeNav === 'activity'}
            <div class="space-y-4">
              {#if isLoadingActivity}
                <div class="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
                  <Icon name="refresh-cw" size={18} class="animate-spin text-orange-500" />
                  <span>Loading security timeline...</span>
                </div>
              {:else if personalActivity.length === 0}
                <div class="text-center py-12 text-slate-400 italic">No security activity recorded yet.</div>
              {:else}
                <div class="border border-warm-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-warm-100/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                      <tr>
                        <th class="p-3">Event Type</th>
                        <th class="p-3">Timestamp</th>
                        <th class="p-3">IP Address</th>
                        <th class="p-3">Event Details</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-warm-100 dark:divide-slate-800 font-mono text-[11px]">
                      {#each personalActivity as act}
                        {@const metaItems = formatMetadata(act.metadata_json)}
                        <tr class="hover:bg-warm-50/60 dark:hover:bg-slate-800 transition-colors">
                          <td class="p-3 font-sans font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            <Icon name="activity" size={13} class="text-orange-500" />
                            <span>{act.event_type}</span>
                          </td>
                          <td class="p-3 text-slate-500 whitespace-nowrap">{act.created_at?.slice(0, 19)}</td>
                          <td class="p-3 text-slate-500">{act.ip_address || '-'}</td>
                          <td class="p-3">
                            <div class="flex flex-wrap gap-1">
                              {#each metaItems as item}
                                <span class="px-1.5 py-0.5 rounded bg-warm-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px]">
                                  <strong class="font-semibold text-slate-900 dark:text-white">{item.key}:</strong> {item.val}
                                </span>
                              {/each}
                            </div>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          {/if}

          <!-- 5. OPERATOR DIRECTORY (Elevated Only) -->
          {#if activeNav === 'directory' && isElevated}
            <div class="space-y-4">
              <!-- Directory Action Strip -->
              <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-warm-50/50 dark:bg-slate-950 p-3 rounded-2xl border border-warm-200 dark:border-slate-800">
                <!-- Search & Filters -->
                <div class="flex items-center gap-2 flex-1 w-full sm:w-auto">
                  <div class="relative flex-1 max-w-xs">
                    <Icon name="search" size={14} class="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search name, email..."
                      bind:value={userSearchQuery}
                      class="w-full bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>

                  <select
                    bind:value={userFilterStatus}
                    class="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
                    <option value="ALL">All Status</option>
                    <option value="ACTIVE">Active Only</option>
                    <option value="SUSPENDED">Suspended Only</option>
                  </select>
                </div>

                <!-- Add Operator CTA -->
                <button
                  type="button"
                  onclick={openCreateDrawer}
                  class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-3.5 py-1.5 rounded-xl text-xs transition shadow-xs flex items-center gap-1.5 shrink-0">
                  <Icon name="user-plus" size={14} />
                  <span>Provision Operator</span>
                </button>
              </div>

              <!-- Operator Table -->
              {#if isLoadingUsers}
                <div class="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
                  <Icon name="refresh-cw" size={18} class="animate-spin text-orange-500" />
                  <span>Loading directory...</span>
                </div>
              {:else}
                <div class="border border-warm-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-warm-100/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                      <tr>
                        <th class="p-3">Operator</th>
                        <th class="p-3">Role & Tier</th>
                        <th class="p-3">Status</th>
                        <th class="p-3">Sessions</th>
                        <th class="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-warm-100 dark:divide-slate-800">
                      {#each filteredUsers as u}
                        {@const canManage = canActorManage(u)}
                        <tr class="hover:bg-warm-50/60 dark:hover:bg-slate-800 transition-colors">
                          <td class="p-3">
                            <div class="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{u.full_name}</span>
                              {#if u.id === currentUser.id}
                                <span class="text-[9px] font-mono bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 px-1.5 py-0.2 rounded font-bold">YOU</span>
                              {/if}
                            </div>
                            <div class="text-slate-500 font-mono text-[11px] truncate mt-0.5">{u.email}</div>
                            <div class="text-[10px] text-slate-400 mt-0.5">{u.department || 'Operations'}</div>
                          </td>

                          <td class="p-3">
                            <div class="font-medium text-slate-800 dark:text-slate-200">{u.role}</div>
                            <div class="font-mono text-[10px] font-semibold text-orange-600 dark:text-orange-400 mt-0.5 flex items-center gap-1">
                              <Icon name="shield" size={10} />
                              {u.security_tier}
                            </div>
                          </td>

                          <td class="p-3">
                            <div class="flex flex-col gap-1">
                              <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold w-fit ${
                                u.status === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                              }`}>
                                <span class={`w-1.5 h-1.5 rounded-full ${u.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                                {u.status}
                              </span>
                              {#if u.must_change_password}
                                <span class="text-[9px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                  <Icon name="key" size={10} />
                                  <span>Must Reset Pass</span>
                                </span>
                              {/if}
                              {#if u.suspended_reason}
                                <span class="text-[9px] text-rose-500 truncate max-w-[120px]" title={u.suspended_reason}>
                                  Reason: {u.suspended_reason}
                                </span>
                              {/if}
                            </div>
                          </td>

                          <td class="p-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                            {u.active_sessions_count || 0} active
                          </td>

                          <td class="p-3 text-right">
                            {#if canManage}
                              <button
                                type="button"
                                onclick={() => openManageDrawer(u)}
                                class="px-2.5 py-1.5 bg-warm-200 hover:bg-warm-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium text-xs transition inline-flex items-center gap-1.5">
                                <Icon name="sliders" size={12} />
                                <span>Manage</span>
                              </button>
                            {:else}
                              <span class="text-[10px] text-slate-400 italic">
                                {u.id === currentUser.id ? 'Self Account' : 'Protected Tier'}
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

          <!-- 6. TENANT AUDIT TRAIL (Elevated Only) -->
          {#if activeNav === 'audit_logs' && isElevated}
            <div class="space-y-4">
              <!-- Search filter -->
              <div class="relative max-w-sm">
                <Icon name="search" size={14} class="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter by actor or event..."
                  bind:value={auditSearchQuery}
                  class="w-full bg-warm-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-orange-500" />
              </div>

              {#if isLoadingAuditLogs}
                <div class="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
                  <Icon name="refresh-cw" size={18} class="animate-spin text-orange-500" />
                  <span>Loading compliance ledger...</span>
                </div>
              {:else if filteredAuditLogs.length === 0}
                <div class="text-center py-12 text-slate-400 italic">No administrative records found.</div>
              {:else}
                <div class="border border-warm-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-warm-100/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                      <tr>
                        <th class="p-3">Timestamp</th>
                        <th class="p-3">Actor</th>
                        <th class="p-3">Event Action</th>
                        <th class="p-3">Target</th>
                        <th class="p-3">Metadata Details</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-warm-100 dark:divide-slate-800 font-mono text-[11px]">
                      {#each filteredAuditLogs as log}
                        {@const metaItems = formatMetadata(log.metadata_json)}
                        <tr class="hover:bg-warm-50/60 dark:hover:bg-slate-800 transition-colors">
                          <td class="p-3 text-slate-500 whitespace-nowrap">{log.created_at?.slice(0, 19)}</td>
                          <td class="p-3 font-sans font-medium text-slate-800 dark:text-slate-200">{log.actor_id}</td>
                          <td class="p-3 font-semibold text-orange-600 dark:text-orange-400">{log.event_type}</td>
                          <td class="p-3 text-slate-600 dark:text-slate-300">{log.entity_id || '-'}</td>
                          <td class="p-3">
                            <div class="flex flex-wrap gap-1">
                              {#each metaItems as item}
                                <span class="px-1.5 py-0.5 rounded bg-warm-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px]">
                                  <strong class="font-semibold text-slate-900 dark:text-white">{item.key}:</strong> {item.val}
                                </span>
                              {/each}
                            </div>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          {/if}

        </div>

        <!-- SLIDE-OVER OPERATOR DRAWER (CREATE / MANAGE) -->
        {#if drawerMode}
          <div class="absolute inset-y-0 right-0 w-full sm:w-[420px] bg-white dark:bg-slate-900 border-l border-warm-200 dark:border-slate-800 shadow-2xl flex flex-col z-30 animate-in slide-in-from-right duration-200">
            <!-- Drawer Header -->
            <div class="p-4 border-b border-warm-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-warm-50/50 dark:bg-slate-950">
              <div class="flex items-center gap-2">
                <Icon name={drawerMode === 'CREATE' ? 'user-plus' : 'sliders'} size={16} class="text-orange-600 dark:text-orange-400" />
                <h4 class="font-bold text-slate-900 dark:text-white text-sm">
                  {drawerMode === 'CREATE' ? 'Provision New Operator' : `Manage: ${drawerTargetUser?.full_name}`}
                </h4>
              </div>
              <button
                type="button"
                onclick={closeDrawer}
                class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg">
                <Icon name="x" size={16} />
              </button>
            </div>

            <!-- Drawer Feedback -->
            {#if drawerFeedback}
              <div class={`p-3 mx-4 mt-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                drawerFeedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
              }`}>
                <Icon name={drawerFeedback.type === 'success' ? 'check-circle' : 'alert-circle'} size={14} />
                <span>{drawerFeedback.message}</span>
              </div>
            {/if}

            <!-- Drawer Scrollable Body -->
            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4 text-xs">
              
              {#if drawerMode === 'CREATE'}
                <!-- CREATE FORM -->
                <div>
                  <label for="new-op-name" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
                  <input
                    id="new-op-name"
                    type="text"
                    placeholder="e.g. Tariqul Islam"
                    bind:value={newUserName}
                    class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>

                <div>
                  <label for="new-op-email" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Work Email</label>
                  <input
                    id="new-op-email"
                    type="email"
                    placeholder="e.g. t.islam@biai.com.bd"
                    bind:value={newUserEmail}
                    class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label for="new-op-role" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Role</label>
                    <select
                      id="new-op-role"
                      bind:value={newUserRole}
                      class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs">
                      {#each availableRoles as r}
                        <option value={r.value}>{r.label}</option>
                      {/each}
                    </select>
                  </div>

                  <div>
                    <label for="new-op-tier" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Security Tier</label>
                    <select
                      id="new-op-tier"
                      bind:value={newUserTier}
                      class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs">
                      {#each assignableTiers as t}
                        <option value={t.value}>{t.label}</option>
                      {/each}
                    </select>
                  </div>
                </div>

                <div>
                  <label for="new-op-dept" class="block font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
                  <input
                    id="new-op-dept"
                    type="text"
                    bind:value={newUserDept}
                    class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs" />
                </div>

                <!-- Password Generator Helper -->
                <div class="p-3 rounded-2xl bg-warm-50 dark:bg-slate-950 border border-warm-200 dark:border-slate-700 space-y-2">
                  <div class="flex items-center justify-between">
                    <label for="new-op-pass" class="font-medium text-slate-700 dark:text-slate-300">Initial Temporary Password</label>
                    <button
                      type="button"
                      onclick={() => newUserTempPassword = generateSecurePassword()}
                      class="text-orange-600 dark:text-orange-400 hover:underline flex items-center gap-1 font-semibold text-[11px]">
                      <Icon name="sparkles" size={12} />
                      <span>Generate</span>
                    </button>
                  </div>
                  <div class="flex gap-2">
                    <input
                      id="new-op-pass"
                      type="text"
                      bind:value={newUserTempPassword}
                      class="flex-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 font-mono text-xs" />
                    <button
                      type="button"
                      onclick={() => copyToClipboard(newUserTempPassword)}
                      class="px-2.5 py-1.5 rounded-xl border border-warm-200 dark:border-slate-700 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center gap-1 text-[11px]"
                      title="Copy temporary password">
                      <Icon name={copiedPassword ? 'check' : 'copy'} size={13} class={copiedPassword ? 'text-emerald-500' : ''} />
                      <span>{copiedPassword ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                <div class="pt-2">
                  <button
                    type="button"
                    onclick={submitCreateUser}
                    disabled={isCreatingUser}
                    class="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-2.5 rounded-xl transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2">
                    <Icon name="user-plus" size={14} />
                    <span>{isCreatingUser ? 'Provisioning...' : 'Provision Operator'}</span>
                  </button>
                </div>

              {:else if drawerMode === 'MANAGE' && drawerTargetUser}
                <!-- MANAGE FORM -->
                
                <!-- Section A: Role & Tier -->
                <div class="p-3.5 rounded-2xl bg-warm-50 dark:bg-slate-950 border border-warm-200 dark:border-slate-700 space-y-3">
                  <h5 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Role & Security Tier</h5>
                  
                  <div class="space-y-2.5">
                    <div>
                      <label for="mng-role" class="block font-medium text-slate-600 dark:text-slate-400 mb-1 text-[11px]">Role</label>
                      <select
                        id="mng-role"
                        bind:value={editRole}
                        class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 text-xs">
                        {#each availableRoles as r}
                          <option value={r.value}>{r.label}</option>
                        {/each}
                      </select>
                    </div>

                    <div>
                      <label for="mng-tier" class="block font-medium text-slate-600 dark:text-slate-400 mb-1 text-[11px]">Security Tier</label>
                      <select
                        id="mng-tier"
                        bind:value={editTier}
                        class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 text-xs">
                        {#each assignableTiers as t}
                          <option value={t.value}>{t.label}</option>
                        {/each}
                      </select>
                    </div>

                    <div>
                      <label for="mng-dept" class="block font-medium text-slate-600 dark:text-slate-400 mb-1 text-[11px]">Department</label>
                      <input
                        id="mng-dept"
                        type="text"
                        bind:value={editDept}
                        class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 text-xs" />
                    </div>

                    <button
                      type="button"
                      onclick={submitPrivilegeUpdate}
                      class="w-full bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold py-2 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-xs">
                      <Icon name="check" size={13} />
                      <span>Update Privileges</span>
                    </button>
                  </div>
                </div>

                <!-- Section B: Administrative Password Reset -->
                <div class="p-3.5 rounded-2xl bg-warm-50 dark:bg-slate-950 border border-warm-200 dark:border-slate-700 space-y-3">
                  <div class="flex items-center justify-between">
                    <h5 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Reset Temporary Password</h5>
                    <button
                      type="button"
                      onclick={() => resetTempPassword = generateSecurePassword()}
                      class="text-orange-600 dark:text-orange-400 hover:underline flex items-center gap-1 font-semibold text-[11px]">
                      <Icon name="sparkles" size={12} />
                      <span>Generate</span>
                    </button>
                  </div>

                  <div class="flex gap-2">
                    <input
                      type="text"
                      placeholder="Min 8 characters"
                      bind:value={resetTempPassword}
                      class="flex-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2 border border-warm-200 dark:border-slate-700 font-mono text-xs" />
                    <button
                      type="button"
                      onclick={() => copyToClipboard(resetTempPassword)}
                      class="px-2.5 py-1.5 rounded-xl border border-warm-200 dark:border-slate-700 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center gap-1 text-[11px]">
                      <Icon name={copiedPassword ? 'check' : 'copy'} size={13} class={copiedPassword ? 'text-emerald-500' : ''} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onclick={submitPasswordReset}
                    disabled={!resetTempPassword}
                    class="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2 rounded-xl transition text-xs disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs">
                    <Icon name="key" size={13} />
                    <span>Set Temporary Password</span>
                  </button>
                </div>

                <!-- Section C: Account Freeze & Session Revocation -->
                <div class="p-3.5 rounded-2xl bg-warm-50 dark:bg-slate-950 border border-warm-200 dark:border-slate-700 space-y-3">
                  <h5 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Access Lock & Session Controls</h5>
                  
                  {#if drawerTargetUser.status === 'ACTIVE'}
                    {#if !isFreezing}
                      <button
                        type="button"
                        onclick={() => isFreezing = true}
                        class="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900 dark:text-rose-300 font-semibold py-2 rounded-xl border border-rose-200 dark:border-rose-800 transition text-xs flex items-center justify-center gap-1.5">
                        <Icon name="user-x" size={14} />
                        <span>Freeze / Suspend Operator Access</span>
                      </button>
                    {:else}
                      <div class="space-y-2 p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-800">
                        <label for="susp-reason-input" class="block text-[11px] font-medium text-rose-800 dark:text-rose-200">Reason for Account Suspension</label>
                        <input
                          id="susp-reason-input"
                          type="text"
                          placeholder="e.g. Audit inquiry or credential leak"
                          bind:value={suspendReason}
                          class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-rose-300 dark:border-rose-700 text-xs" />
                        <div class="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onclick={() => isFreezing = false}
                            class="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 dark:text-slate-300 text-xs">
                            Cancel
                          </button>
                          <button
                            type="button"
                            onclick={() => submitStatusChange(true)}
                            class="px-3 py-1 rounded-lg bg-rose-600 text-white font-semibold text-xs">
                            Confirm Freeze
                          </button>
                        </div>
                      </div>
                    {/if}
                  {:else}
                    <button
                      type="button"
                      onclick={() => submitStatusChange(false)}
                      class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-xs">
                      <Icon name="user-check" size={14} />
                      <span>Unfreeze / Reactivate Operator</span>
                    </button>
                  {/if}

                  <button
                    type="button"
                    onclick={submitRevokeSessions}
                    class="w-full py-2 rounded-xl border border-warm-200 dark:border-slate-700 hover:bg-warm-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium transition text-xs flex items-center justify-center gap-1.5">
                    <Icon name="log-out" size={13} />
                    <span>Revoke All Active Sessions</span>
                  </button>
                </div>

              {/if}

            </div>
          </div>
        {/if}

      </main>
    </div>
  </div>
{/if}
