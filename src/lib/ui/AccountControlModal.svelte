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
    created_at?: string;
    last_login_at?: string;
    must_change_password?: boolean | number;
    suspended_reason?: string;
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
  let drawerActiveTab = $state<'overview' | 'activity'>('overview');

  // Drawer Form State - Manage
  let editRole = $state('');
  let editTier = $state('');
  let editDept = $state('');
  let resetTempPassword = $state('');
  let suspendReason = $state('');
  let isFreezing = $state(false);
  let showDeleteConfirm = $state(false);
  let deleteReason = $state('');
  let isDeletingUser = $state(false);
  let drawerFeedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
  let copiedPassword = $state(false);

  // Drawer Individual Activity Stream
  let operatorActivityLogs = $state<any[]>([]);
  let isLoadingOperatorActivity = $state(false);
  let operatorActivityFilter = $state<'ALL' | 'SECURITY' | 'GOVERNANCE' | 'OPERATIONS'>('ALL');

  // Drawer Form State - Create User
  let newUserName = $state('');
  let newUserEmail = $state('');
  let newUserRole = $state('');
  let newUserTier = $state('TIER_3');
  let newUserDept = $state('Operations');
  let newUserTempPassword = $state('');
  let isCreatingUser = $state(false);

  // Admin: Audit Logs State (Tenant Audit Ledger)
  let auditLogs = $state<any[]>([]);
  let isLoadingAuditLogs = $state(false);
  let auditSearchQuery = $state('');
  let auditCategoryFilter = $state<'ALL' | 'SECURITY' | 'GOVERNANCE' | 'OPERATIONS'>('ALL');
  let auditOutcomeFilter = $state<'ALL' | 'SUCCESS' | 'DENIED' | 'FAILURE'>('ALL');
  let selectedMetadataLog = $state<any | null>(null);

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
    selectedMetadataLog = null;

    if (nav === 'sessions') loadSessions();
    if (nav === 'activity') loadPersonalActivity();
    if (nav === 'directory' && isElevated) loadUsers();
    if (nav === 'audit_logs' && isElevated) loadAuditLogs();
  }

  // --- FORMATTING HELPERS ---
  function formatRole(role?: string): string {
    if (!role) return 'Specialist';
    return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  function formatTier(tier?: string): string {
    if (!tier) return 'Tier 3 · Specialist';
    switch (tier) {
      case 'TIER_0': return 'Tier 0 · Platform Owner';
      case 'TIER_1': return 'Tier 1 · Operations Admin';
      case 'TIER_2': return 'Tier 2 · Strategist';
      case 'TIER_3': return 'Tier 3 · Specialist';
      case 'TIER_4': return 'Tier 4 · Viewer';
      default: return tier.replace('_', ' ');
    }
  }

  function formatTimestamp(isoStr?: string): { exact: string; relative: string } {
    if (!isoStr) return { exact: '-', relative: '-' };
    const date = new Date(isoStr);
    const exact = date.toLocaleString('en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ' +06';

    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    let relative = 'Just now';
    if (diffMins > 0 && diffMins < 60) relative = `${diffMins}m ago`;
    else if (diffHours > 0 && diffHours < 24) relative = `${diffHours}h ago`;
    else if (diffDays > 0) relative = `${diffDays}d ago`;

    return { exact, relative };
  }

  function getMonogram(name?: string): string {
    if (!name) return 'OP';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  // Event categorization arrays
  const securityEventTypes = ['USER_LOGIN', 'USER_LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET_ADMIN', 'SESSIONS_REVOKED', 'FAILED_LOGIN'];
  const governanceEventTypes = ['USER_PROVISIONED', 'USER_SUSPENDED', 'USER_REACTIVATED', 'USER_DEACTIVATED', 'USER_DELETED', 'PRIVILEGES_UPDATED', 'SCOPES_UPDATED'];
  const operationsEventTypes = ['CRM_REPLY_DISPATCHED', 'CRM_TRIAGE_OVERRIDE', 'PIPELINE_DEAL_UPDATED', 'STAGE_TRANSITION', 'PII_EXPORT_CSV', 'REPLY_APPROVED', 'TICKET_STATUS_UPDATED'];

  function getEventCategory(eventType: string): 'SECURITY' | 'GOVERNANCE' | 'OPERATIONS' {
    if (securityEventTypes.includes(eventType)) return 'SECURITY';
    if (governanceEventTypes.includes(eventType)) return 'GOVERNANCE';
    return 'OPERATIONS';
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
      } else {
        usersList = [];
      }
    } catch (e) {
      console.error('Failed to load users directory:', e);
      usersList = [];
    } finally {
      isLoadingUsers = false;
    }
  }

  async function loadAuditLogs() {
    isLoadingAuditLogs = true;
    try {
      const res = await fetch('/api/admin/audit-logs?limit=150');
      const data = await res.json();
      if (res.ok && (data.auditLogs || data.logs)) {
        auditLogs = data.auditLogs || data.logs || [];
      } else {
        auditLogs = [];
      }
    } catch (e) {
      console.error('Failed to load audit logs:', e);
      auditLogs = [];
    } finally {
      isLoadingAuditLogs = false;
    }
  }

  async function loadOperatorActivity(userId: string) {
    isLoadingOperatorActivity = true;
    try {
      const res = await fetch(`/api/admin/audit-logs?userId=${encodeURIComponent(userId)}&limit=100`);
      const data = await res.json();
      if (res.ok && (data.auditLogs || data.logs)) {
        operatorActivityLogs = data.auditLogs || data.logs || [];
      } else {
        operatorActivityLogs = [];
      }
    } catch (e) {
      console.error('Failed to load operator activity:', e);
      operatorActivityLogs = [];
    } finally {
      isLoadingOperatorActivity = false;
    }
  }

  function canActorManage(target: any): boolean {
    if (!currentUser || !target) return false;
    if (currentUser.id === target.id) return false;
    if (currentUser.security_tier === 'TIER_0') return true;
    if (currentUser.security_tier === 'TIER_1') {
      return target.security_tier !== 'TIER_0' && target.security_tier !== 'TIER_1';
    }
    return false;
  }

  function canDeleteUser(target: any): boolean {
    if (!currentUser || !target) return false;
    if (currentUser.id === target.id) return false;
    if (currentUser.security_tier === 'TIER_0') {
      if (target.security_tier === 'TIER_0') {
        const ownerCount = usersList.filter(u => u.security_tier === 'TIER_0' && u.status === 'ACTIVE').length;
        return ownerCount > 1;
      }
      return true;
    }
    if (currentUser.security_tier === 'TIER_1') {
      return target.security_tier !== 'TIER_0' && target.security_tier !== 'TIER_1';
    }
    return false;
  }

  function openCreateDrawer() {
    drawerMode = 'CREATE';
    drawerTargetUser = null;
    drawerActiveTab = 'overview';
    newUserName = '';
    newUserEmail = '';
    newUserRole = availableRoles[0].value;
    newUserTier = 'TIER_3';
    newUserDept = 'Operations';
    newUserTempPassword = generateSecurePassword();
    drawerFeedback = null;
  }

  function openManageDrawer(target: any, initialTab: 'overview' | 'activity' = 'overview') {
    drawerMode = 'MANAGE';
    drawerTargetUser = target;
    drawerActiveTab = initialTab;
    editRole = target.role;
    editTier = target.security_tier;
    editDept = target.department || 'Operations';
    resetTempPassword = '';
    suspendReason = '';
    isFreezing = false;
    showDeleteConfirm = false;
    deleteReason = '';
    drawerFeedback = null;
    loadOperatorActivity(target.id);
  }

  function closeDrawer() {
    drawerMode = null;
    drawerTargetUser = null;
    drawerFeedback = null;
    showDeleteConfirm = false;
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
      if (activeNav === 'audit_logs') await loadAuditLogs();
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
      drawerFeedback = { type: 'success', message: 'Operator privileges updated successfully.' };
      await loadUsers();
      await loadOperatorActivity(drawerTargetUser.id);
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
      drawerFeedback = { type: 'success', message: 'Temporary password set. User must change it upon login.' };
      await loadUsers();
      await loadOperatorActivity(drawerTargetUser.id);
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    }
  }

  async function submitStatusChange(isFreeze: boolean, customReason?: string) {
    if (!drawerTargetUser) return;
    drawerFeedback = null;
    try {
      const res = await fetch(`/api/admin/users/${drawerTargetUser.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: isFreeze ? 'SUSPENDED' : 'ACTIVE',
          reason: customReason || suspendReason || (isFreeze ? 'Suspended by administrator' : 'Reactivated by administrator')
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      drawerFeedback = { type: 'success', message: isFreeze ? 'Account frozen and sessions revoked.' : 'Account reactivated.' };
      isFreezing = false;
      await loadUsers();
      if (drawerTargetUser) {
        drawerTargetUser.status = isFreeze ? 'SUSPENDED' : 'ACTIVE';
        drawerTargetUser.suspended_reason = isFreeze ? (customReason || suspendReason) : null;
      }
      await loadOperatorActivity(drawerTargetUser.id);
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    }
  }

  async function quickToggleFreeze(target: any, e?: Event) {
    if (e) e.stopPropagation();
    if (!canActorManage(target)) return;
    const willFreeze = target.status === 'ACTIVE';
    try {
      const res = await fetch(`/api/admin/users/${target.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: willFreeze ? 'SUSPENDED' : 'ACTIVE',
          reason: willFreeze ? 'Direct 1-click administrative freeze' : 'Direct administrative reactivation'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to toggle status');
      await loadUsers();
      if (drawerTargetUser && drawerTargetUser.id === target.id) {
        drawerTargetUser.status = willFreeze ? 'SUSPENDED' : 'ACTIVE';
        await loadOperatorActivity(target.id);
      }
      if (activeNav === 'audit_logs') await loadAuditLogs();
    } catch (err: any) {
      console.error('Failed to toggle user status:', err);
    }
  }

  async function submitDeleteUser(targetId: string, customReason?: string) {
    if (!targetId) return;
    isDeletingUser = true;
    drawerFeedback = null;
    try {
      const res = await fetch(`/api/admin/users/${targetId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: customReason || deleteReason || 'Decommissioned by administrator' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to decommission user');
      drawerFeedback = { type: 'success', message: data.message || 'Operator account decommissioned.' };
      showDeleteConfirm = false;
      await loadUsers();
      if (activeNav === 'audit_logs') await loadAuditLogs();
      setTimeout(() => closeDrawer(), 1200);
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    } finally {
      isDeletingUser = false;
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
      await loadOperatorActivity(drawerTargetUser.id);
    } catch (err: any) {
      drawerFeedback = { type: 'error', message: err.message };
    }
  }

  // --- CSV EXPORT FOR TENANT AUDIT LEDGER ---
  function exportAuditCsv() {
    if (!filteredAuditLogs || filteredAuditLogs.length === 0) return;
    const headers = ['Timestamp_Dhaka', 'Actor_Name', 'Actor_Email', 'Actor_Role', 'Actor_Tier', 'Event_Type', 'Outcome', 'Subject_Name', 'Subject_Email', 'IP_Hash', 'Metadata'];
    const rows = filteredAuditLogs.map(l => [
      l.created_at || '',
      `"${(l.actor_name || '').replace(/"/g, '""')}"`,
      `"${(l.actor_email || '').replace(/"/g, '""')}"`,
      `"${(l.actor_role || '').replace(/"/g, '""')}"`,
      `"${(l.actor_tier || '').replace(/"/g, '""')}"`,
      `"${(l.event_type || '').replace(/"/g, '""')}"`,
      `"${(l.outcome || '').replace(/"/g, '""')}"`,
      `"${(l.subject_name || '').replace(/"/g, '""')}"`,
      `"${(l.subject_email || '').replace(/"/g, '""')}"`,
      `"${(l.ip_hash || '').replace(/"/g, '""')}"`,
      `"${(l.metadata_json || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `biai-compliance-audit-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Filtered Users for Directory
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

  // Filtered Audit Logs for Tenant Ledger
  let filteredAuditLogs = $derived.by(() => {
    let list = auditLogs;
    if (auditSearchQuery.trim()) {
      const q = auditSearchQuery.toLowerCase();
      list = list.filter(l =>
        l.event_type?.toLowerCase().includes(q) ||
        l.actor_name?.toLowerCase().includes(q) ||
        l.actor_email?.toLowerCase().includes(q) ||
        l.subject_name?.toLowerCase().includes(q) ||
        l.subject_email?.toLowerCase().includes(q) ||
        l.metadata_json?.toLowerCase().includes(q)
      );
    }
    if (auditCategoryFilter === 'SECURITY') {
      list = list.filter(l => securityEventTypes.includes(l.event_type));
    } else if (auditCategoryFilter === 'GOVERNANCE') {
      list = list.filter(l => governanceEventTypes.includes(l.event_type));
    } else if (auditCategoryFilter === 'OPERATIONS') {
      list = list.filter(l => operationsEventTypes.includes(l.event_type) || (!securityEventTypes.includes(l.event_type) && !governanceEventTypes.includes(l.event_type)));
    }

    if (auditOutcomeFilter !== 'ALL') {
      list = list.filter(l => l.outcome === auditOutcomeFilter);
    }
    return list;
  });

  // Filtered Individual Activity Logs
  let filteredOperatorActivity = $derived.by(() => {
    let list = operatorActivityLogs;
    if (operatorActivityFilter === 'SECURITY') {
      list = list.filter(l => securityEventTypes.includes(l.event_type));
    } else if (operatorActivityFilter === 'GOVERNANCE') {
      list = list.filter(l => governanceEventTypes.includes(l.event_type));
    } else if (operatorActivityFilter === 'OPERATIONS') {
      list = list.filter(l => !securityEventTypes.includes(l.event_type) && !governanceEventTypes.includes(l.event_type));
    }
    return list;
  });

  // Compliance metrics for Tenant Audit Ledger
  let totalAuditCount = $derived(auditLogs.length);
  let securityGovCount = $derived(auditLogs.filter(l => securityEventTypes.includes(l.event_type) || governanceEventTypes.includes(l.event_type)).length);
  let operationsCount = $derived(auditLogs.filter(l => operationsEventTypes.includes(l.event_type) || (!securityEventTypes.includes(l.event_type) && !governanceEventTypes.includes(l.event_type))).length);
  let alertCount = $derived(auditLogs.filter(l => l.outcome === 'DENIED' || l.outcome === 'FAILURE' || l.event_type === 'USER_SUSPENDED' || l.event_type === 'USER_DELETED').length);

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
  <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
    <!-- MODAL CONTAINER (2-Pane Architecture) -->
    <div class="relative bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-6xl h-[720px] max-h-[94vh] flex shadow-2xl overflow-hidden font-sans">
      
      <!-- LEFT NAVIGATION SIDEBAR (w-60 sm:w-64, shrink-0, border-r) -->
      <aside class="w-56 sm:w-64 border-r border-warm-200 dark:border-slate-800 bg-warm-50/70 dark:bg-slate-900 flex flex-col justify-between shrink-0 select-none">
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
            <div class="mt-3 p-2.5 rounded-xl bg-white dark:bg-slate-800/90 border border-warm-200 dark:border-slate-700/80 shadow-xs">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-lg bg-orange-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                  {getMonogram(currentUser.full_name)}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-xs font-semibold text-slate-900 dark:text-white truncate">{currentUser.full_name}</span>
                    <span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 shrink-0">
                      {currentUser.security_tier}
                    </span>
                  </div>
                  <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {formatRole(currentUser.role)}
                  </div>
                </div>
              </div>
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
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold shadow-xs'
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
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold shadow-xs'
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
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}>
                  <span class="flex items-center gap-2.5">
                    <Icon name="monitor" size={15} />
                    <span>Active Sessions</span>
                  </span>
                  {#if activeSessions.length > 0}
                    <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                      {activeSessions.length}
                    </span>
                  {/if}
                </button>

                <button
                  type="button"
                  onclick={() => selectNav('activity')}
                  class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition ${
                    activeNav === 'activity'
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold shadow-xs'
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
                <div class="px-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Workspace Admin</span>
                  <span class="text-[9px] font-mono font-bold text-orange-600 dark:text-orange-400">ELEVATED</span>
                </div>
                <div class="space-y-0.5">
                  <button
                    type="button"
                    onclick={() => selectNav('directory')}
                    class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
                      activeNav === 'directory'
                        ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}>
                    <span class="flex items-center gap-2.5">
                      <Icon name="users" size={15} />
                      <span>Operator Directory</span>
                    </span>
                    {#if usersList.length > 0}
                      <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 font-bold">
                        {usersList.length}
                      </span>
                    {/if}
                  </button>

                  <button
                    type="button"
                    onclick={() => selectNav('audit_logs')}
                    class={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition ${
                      activeNav === 'audit_logs'
                        ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-warm-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}>
                    <span class="flex items-center gap-2.5">
                      <Icon name="file-text" size={15} />
                      <span>Tenant Audit Ledger</span>
                    </span>
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  </button>
                </div>
              </div>
            {/if}
          </nav>
        </div>

        <!-- Sidebar Footer Action -->
        <div class="p-3 border-t border-warm-200 dark:border-slate-800">
          <button
            type="button"
            onclick={onClose}
            class="w-full py-2 px-3 rounded-xl border border-warm-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 hover:bg-warm-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs transition flex items-center justify-center gap-2 shadow-xs">
            <Icon name="x" size={14} />
            <span>Close Control Plane</span>
          </button>
        </div>
      </aside>

      <!-- RIGHT MAIN CONTENT WORKSPACE -->
      <main class="flex-1 min-w-0 bg-white dark:bg-slate-900 flex flex-col overflow-hidden relative">
        
        <!-- Main Top Bar -->
        <header class="px-6 py-4 border-b border-warm-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-warm-50/30 dark:bg-slate-900/50">
          <div>
            <h3 class="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {#if activeNav === 'profile'}
                <span>Operator Profile & Identity Scopes</span>
              {:else if activeNav === 'security'}
                <span>Password & Authentication Security</span>
              {:else if activeNav === 'sessions'}
                <span>Active Edge Sessions & Token Revocation</span>
              {:else if activeNav === 'activity'}
                <span>Personal Security & Audit Timeline</span>
              {:else if activeNav === 'directory'}
                <span>Operator Directory & Privilege Governance</span>
              {:else if activeNav === 'audit_logs'}
                <span>Tenant Audit Ledger & Compliance Stream</span>
              {/if}
            </h3>
            <p class="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
              {#if activeNav === 'profile'}
                View your active authorization scopes, credentials, and update details.
              {:else if activeNav === 'security'}
                Update your credentials. Enforces 12+ character entropy and session re-keying.
              {:else if activeNav === 'sessions'}
                Audit and revoke cryptographic session cookies across Cloudflare edge PoPs.
              {:else if activeNav === 'activity'}
                Historical security log of all authentication and account actions.
              {:else if activeNav === 'directory'}
                Provision team accounts, inspect individual activity logs, execute freezes, or decommission operators.
              {:else if activeNav === 'audit_logs'}
                Organization-wide immutable compliance stream. Records all security, credential, and operational actions.
              {/if}
            </p>
          </div>

          <button
            type="button"
            onclick={onClose}
            class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-xl hover:bg-warm-100 dark:hover:bg-slate-800 transition"
            title="Close modal (Esc)">
            <Icon name="x" size={18} />
          </button>
        </header>

        <!-- Main Body Scroll Area -->
        <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6">

          <!-- 1. PROFILE & DETAILS -->
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
              <div class="bg-warm-50/70 dark:bg-slate-950 p-6 rounded-2xl border border-warm-200 dark:border-slate-800 space-y-4">
                <div class="flex items-center gap-3">
                  <div class="w-12 h-12 rounded-2xl bg-orange-600 text-white font-bold text-base flex items-center justify-center shrink-0 shadow-xs">
                    {getMonogram(currentUser.full_name)}
                  </div>
                  <div>
                    <h4 class="font-bold text-slate-900 dark:text-white text-base">{currentUser.full_name}</h4>
                    <p class="text-slate-500 font-mono text-xs">{currentUser.email}</p>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label for="prof-name" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Full Name</label>
                    <input
                      id="prof-name"
                      type="text"
                      bind:value={profileName}
                      class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>

                  <div>
                    <label for="prof-dept" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Department</label>
                    <input
                      id="prof-dept"
                      type="text"
                      bind:value={profileDept}
                      class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-2.5 border border-warm-200 dark:border-slate-700 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>
                </div>

                <div class="flex justify-end pt-2">
                  <button
                    type="button"
                    onclick={saveProfile}
                    disabled={isSavingProfile}
                    class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-4 py-2 rounded-xl text-xs transition shadow-xs disabled:opacity-50 flex items-center gap-1.5">
                    <Icon name="check" size={14} />
                    <span>{isSavingProfile ? 'Saving...' : 'Save Profile Changes'}</span>
                  </button>
                </div>
              </div>

              <!-- Permission Scopes Grid -->
              <div class="p-6 rounded-2xl border border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-950 space-y-3">
                <div class="flex items-center justify-between">
                  <h4 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Granular Security Capabilities</h4>
                  <span class="text-[10px] font-mono text-orange-600 dark:text-orange-400 font-bold">{formatTier(currentUser.security_tier)}</span>
                </div>

                {#if currentUser.scopes && currentUser.scopes.length > 0}
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    {#each currentUser.scopes as sc}
                      <div class="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Icon name="check-circle" size={14} class="text-emerald-500 shrink-0" />
                        <span class="truncate">{sc}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-slate-400 italic text-xs">No specific granular scopes assigned; inheriting standard role tier capabilities.</p>
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
                    <label for="curr-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Current Password</label>
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
                    <label for="new-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">New Password (12+ characters)</label>
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
                    <label for="conf-pass" class="block font-medium text-slate-700 dark:text-slate-300 mb-1 text-xs">Confirm New Password</label>
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
                      class="w-full bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold py-2.5 rounded-xl transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 text-xs">
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
                  class="bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900 dark:text-rose-300 font-semibold px-3 py-1.5 rounded-xl text-xs border border-rose-200 dark:border-rose-800 transition flex items-center gap-1.5 shadow-xs">
                  <Icon name="log-out" size={13} />
                  <span>Revoke Other Sessions</span>
                </button>
              </div>

              {#if showRevokeOthersConfirm}
                <div class="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 text-xs">
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
                <div class="text-center py-12 text-slate-400 italic text-xs">No active sessions found.</div>
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
                  <span>Loading personal security timeline...</span>
                </div>
              {:else if personalActivity.length === 0}
                <div class="text-center py-12 text-slate-400 italic text-xs">No personal security activity recorded yet.</div>
              {:else}
                <div class="border border-warm-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-warm-100/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                      <tr>
                        <th class="p-3">Event Type</th>
                        <th class="p-3">Timestamp (Dhaka)</th>
                        <th class="p-3">Edge / IP</th>
                        <th class="p-3">Details</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-warm-100 dark:divide-slate-800 font-mono text-[11px]">
                      {#each personalActivity as act}
                        {@const metaItems = formatMetadata(act.metadata_json)}
                        {@const time = formatTimestamp(act.created_at)}
                        <tr class="hover:bg-warm-50/60 dark:hover:bg-slate-800 transition-colors">
                          <td class="p-3 font-sans font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            <Icon name="activity" size={13} class="text-orange-500" />
                            <span>{act.event_type}</span>
                          </td>
                          <td class="p-3 text-slate-500 whitespace-nowrap">
                            <div>{time.exact}</div>
                            <div class="text-[10px] text-slate-400">{time.relative}</div>
                          </td>
                          <td class="p-3 text-slate-500">{act.ip_address || 'Cloudflare Edge'}</td>
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
              <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-warm-50/60 dark:bg-slate-950 p-3 rounded-2xl border border-warm-200 dark:border-slate-800">
                <!-- Search & Filters -->
                <div class="flex flex-wrap items-center gap-2 flex-1 w-full sm:w-auto">
                  <div class="relative flex-1 min-w-[200px] max-w-xs">
                    <Icon name="search" size={14} class="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search name, email, department..."
                      bind:value={userSearchQuery}
                      class="w-full bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>

                  <select
                    bind:value={userFilterStatus}
                    class="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
                    <option value="ALL">All Status</option>
                    <option value="ACTIVE">Active Only</option>
                    <option value="SUSPENDED">Suspended / Frozen Only</option>
                    <option value="DEACTIVATED">Deactivated Only</option>
                  </select>

                  <select
                    bind:value={userFilterRole}
                    class="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
                    <option value="ALL">All Roles</option>
                    {#each availableRoles as r}
                      <option value={r.value}>{r.label}</option>
                    {/each}
                  </select>
                </div>

                <!-- Add Operator CTA -->
                <div class="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onclick={loadUsers}
                    class="p-2 bg-white dark:bg-slate-900 hover:bg-warm-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-warm-200 dark:border-slate-700 text-xs transition"
                    title="Reload Directory">
                    <Icon name="refresh-cw" size={14} class={isLoadingUsers ? 'animate-spin text-orange-500' : ''} />
                  </button>

                  <button
                    type="button"
                    onclick={openCreateDrawer}
                    class="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-3.5 py-1.5 rounded-xl text-xs transition shadow-xs flex items-center gap-1.5">
                    <Icon name="user-plus" size={14} />
                    <span>Provision Operator</span>
                  </button>
                </div>
              </div>

              <!-- Operator Table -->
              {#if isLoadingUsers}
                <div class="text-center py-16 text-slate-400 flex flex-col items-center gap-2">
                  <Icon name="refresh-cw" size={20} class="animate-spin text-orange-500" />
                  <span class="text-xs">Loading operator directory...</span>
                </div>
              {:else if filteredUsers.length === 0}
                <div class="text-center py-16 border border-dashed border-warm-200 dark:border-slate-800 rounded-2xl text-slate-400 text-xs space-y-2">
                  <Icon name="users" size={28} class="mx-auto text-slate-300 dark:text-slate-600" />
                  <p class="font-medium">No team members match your filter criteria.</p>
                  <button
                    type="button"
                    onclick={() => { userSearchQuery = ''; userFilterRole = 'ALL'; userFilterStatus = 'ALL'; }}
                    class="text-orange-600 dark:text-orange-400 hover:underline">
                    Reset filters
                  </button>
                </div>
              {:else}
                <div class="border border-warm-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-warm-100/70 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700 select-none">
                      <tr>
                        <th class="p-3 pl-4">Operator</th>
                        <th class="p-3">Role & Tier</th>
                        <th class="p-3">Status</th>
                        <th class="p-3">Sessions</th>
                        <th class="p-3 pr-4 text-right">Quick Governance</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-warm-100 dark:divide-slate-800">
                      {#each filteredUsers as u}
                        {@const canManage = canActorManage(u)}
                        {@const canDelete = canDeleteUser(u)}
                        <tr
                          onclick={() => openManageDrawer(u, 'overview')}
                          class="hover:bg-warm-50/80 dark:hover:bg-slate-800/70 cursor-pointer transition-colors group">
                          
                          <!-- Operator Identity -->
                          <td class="p-3 pl-4">
                            <div class="flex items-center gap-3">
                              <!-- Avatar with Status Pip -->
                              <div class="relative shrink-0">
                                <div class="w-8 h-8 rounded-xl bg-orange-600/10 text-orange-700 dark:bg-orange-950/80 dark:text-orange-300 font-bold text-xs flex items-center justify-center border border-orange-200 dark:border-orange-900">
                                  {getMonogram(u.full_name)}
                                </div>
                                <span class={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                                  u.status === 'ACTIVE' ? 'bg-emerald-500' : u.status === 'SUSPENDED' ? 'bg-rose-500' : 'bg-slate-400'
                                }`}></span>
                              </div>

                              <div class="min-w-0">
                                <div class="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                  <span class="group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">{u.full_name}</span>
                                  {#if u.id === currentUser.id}
                                    <span class="text-[9px] font-mono bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 px-1.5 py-0.2 rounded font-bold">YOU</span>
                                  {/if}
                                </div>
                                <div class="text-slate-500 font-mono text-[11px] truncate mt-0.5">{u.email}</div>
                                <div class="text-[10px] text-slate-400 mt-0.5">{u.department || 'Operations'}</div>
                              </div>
                            </div>
                          </td>

                          <!-- Role & Tier -->
                          <td class="p-3">
                            <div class="font-medium text-slate-800 dark:text-slate-200">{formatRole(u.role)}</div>
                            <div class="font-mono text-[10px] font-semibold text-orange-600 dark:text-orange-400 mt-0.5 flex items-center gap-1">
                              <Icon name="shield" size={10} />
                              <span>{formatTier(u.security_tier)}</span>
                            </div>
                          </td>

                          <!-- Status -->
                          <td class="p-3">
                            <div class="flex flex-col gap-1 items-start">
                              <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                u.status === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                  : u.status === 'SUSPENDED'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700'
                              }`}>
                                <span class={`w-1.5 h-1.5 rounded-full ${
                                  u.status === 'ACTIVE' ? 'bg-emerald-500' : u.status === 'SUSPENDED' ? 'bg-rose-500' : 'bg-slate-400'
                                }`}></span>
                                <span>{u.status === 'SUSPENDED' ? 'FROZEN / BLOCKED' : u.status}</span>
                              </span>

                              {#if u.must_change_password}
                                <span class="text-[9px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                  <Icon name="key" size={10} />
                                  <span>Must Reset Pass</span>
                                </span>
                              {/if}

                              {#if u.suspended_reason}
                                <span class="text-[9px] text-rose-500 truncate max-w-[130px]" title={u.suspended_reason}>
                                  Reason: {u.suspended_reason}
                                </span>
                              {/if}
                            </div>
                          </td>

                          <!-- Sessions -->
                          <td class="p-3 font-mono text-slate-600 dark:text-slate-400">
                            <div>{u.active_sessions_count || 0} active</div>
                            <div class="text-[10px] text-slate-400 mt-0.5">
                              {u.last_login_at ? formatTimestamp(u.last_login_at).relative : 'Never logged in'}
                            </div>
                          </td>

                          <!-- Quick Actions -->
                          <td class="p-3 pr-4 text-right">
                            <div
                              class="flex items-center justify-end gap-1.5"
                              role="toolbar"
                              tabindex="-1"
                              aria-label="Operator Quick Actions"
                              onclick={(e) => e.stopPropagation()}
                              onkeydown={(e) => e.stopPropagation()}>
                              {#if canManage}
                                <!-- Freeze / Unblock Toggle -->
                                {#if u.status === 'ACTIVE'}
                                  <button
                                    type="button"
                                    onclick={(e) => quickToggleFreeze(u, e)}
                                    title="Freeze / Block Operator Access"
                                    class="p-1.5 rounded-xl border border-rose-200 dark:border-rose-800/80 bg-rose-50/70 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 transition">
                                    <Icon name="lock" size={13} />
                                  </button>
                                {:else if u.status === 'SUSPENDED'}
                                  <button
                                    type="button"
                                    onclick={(e) => quickToggleFreeze(u, e)}
                                    title="Unblock / Reactivate Operator"
                                    class="p-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 transition">
                                    <Icon name="unlock" size={13} />
                                  </button>
                                {/if}

                                <!-- Manage / Dossier Button -->
                                <button
                                  type="button"
                                  onclick={() => openManageDrawer(u, 'overview')}
                                  class="px-2.5 py-1.5 bg-warm-200 hover:bg-warm-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium text-xs transition inline-flex items-center gap-1.5 shadow-xs">
                                  <Icon name="sliders" size={12} />
                                  <span>Dossier & Logs</span>
                                </button>

                                <!-- Decommission / Delete Button -->
                                {#if canDelete}
                                  <button
                                    type="button"
                                    onclick={() => { openManageDrawer(u, 'overview'); showDeleteConfirm = true; }}
                                    title="Decommission & Remove Operator"
                                    class="p-1.5 rounded-xl border border-warm-200 dark:border-slate-700 hover:bg-rose-100 hover:border-rose-300 dark:hover:bg-rose-950/60 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition">
                                    <Icon name="trash-2" size={13} />
                                  </button>
                                {/if}
                              {:else}
                                <span class="text-[10px] text-slate-400 italic">
                                  {u.id === currentUser.id ? 'Self Account' : 'Protected Tier'}
                                </span>
                              {/if}
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

          <!-- 6. TENANT AUDIT LEDGER (Elevated Only) -->
          {#if activeNav === 'audit_logs' && isElevated}
            <div class="space-y-4">
              
              <!-- Compliance Overview Banner -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="p-3.5 rounded-2xl bg-warm-50/70 dark:bg-slate-950 border border-warm-200 dark:border-slate-800">
                  <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Audit Records</div>
                  <div class="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">{totalAuditCount}</div>
                  <div class="text-[10px] text-slate-500 mt-0.5">Immutable event trail</div>
                </div>

                <div class="p-3.5 rounded-2xl bg-warm-50/70 dark:bg-slate-950 border border-warm-200 dark:border-slate-800">
                  <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Security & Governance</div>
                  <div class="text-xl font-bold font-mono text-orange-600 dark:text-orange-400 mt-1">{securityGovCount}</div>
                  <div class="text-[10px] text-slate-500 mt-0.5">Auth, roles & freezes</div>
                </div>

                <div class="p-3.5 rounded-2xl bg-warm-50/70 dark:bg-slate-950 border border-warm-200 dark:border-slate-800">
                  <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Operational Events</div>
                  <div class="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">{operationsCount}</div>
                  <div class="text-[10px] text-slate-500 mt-0.5">Dispatches & stages</div>
                </div>

                <div class="p-3.5 rounded-2xl bg-warm-50/70 dark:bg-slate-950 border border-warm-200 dark:border-slate-800">
                  <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Security Alerts</div>
                  <div class="text-xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">{alertCount}</div>
                  <div class="text-[10px] text-slate-500 mt-0.5">Denied / freeze actions</div>
                </div>
              </div>

              <!-- Search & Filter Bar -->
              <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-warm-50/60 dark:bg-slate-950 p-3 rounded-2xl border border-warm-200 dark:border-slate-800">
                <div class="flex flex-wrap items-center gap-2 flex-1 w-full sm:w-auto">
                  <div class="relative flex-1 min-w-[200px] max-w-sm">
                    <Icon name="search" size={14} class="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search actor, event type, subject, IP..."
                      bind:value={auditSearchQuery}
                      class="w-full bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-orange-500" />
                  </div>

                  <select
                    bind:value={auditCategoryFilter}
                    class="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
                    <option value="ALL">All Categories</option>
                    <option value="SECURITY">Security & Auth</option>
                    <option value="GOVERNANCE">Access Governance</option>
                    <option value="OPERATIONS">Operations & Workflows</option>
                  </select>

                  <select
                    bind:value={auditOutcomeFilter}
                    class="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-warm-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
                    <option value="ALL">All Outcomes</option>
                    <option value="SUCCESS">SUCCESS Only</option>
                    <option value="DENIED">DENIED Only</option>
                    <option value="FAILURE">FAILURE Only</option>
                  </select>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onclick={loadAuditLogs}
                    class="p-2 bg-white dark:bg-slate-900 hover:bg-warm-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-warm-200 dark:border-slate-700 text-xs transition"
                    title="Refresh Ledger">
                    <Icon name="refresh-cw" size={14} class={isLoadingAuditLogs ? 'animate-spin text-orange-500' : ''} />
                  </button>

                  <button
                    type="button"
                    onclick={exportAuditCsv}
                    disabled={filteredAuditLogs.length === 0}
                    class="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold px-3 py-1.5 rounded-xl text-xs transition shadow-xs flex items-center gap-1.5 disabled:opacity-50">
                    <Icon name="download" size={14} />
                    <span>Export Audit CSV</span>
                  </button>
                </div>
              </div>

              <!-- Compliance Table -->
              {#if isLoadingAuditLogs}
                <div class="text-center py-16 text-slate-400 flex flex-col items-center gap-2">
                  <Icon name="refresh-cw" size={20} class="animate-spin text-orange-500" />
                  <span class="text-xs">Loading compliance audit ledger...</span>
                </div>
              {:else if filteredAuditLogs.length === 0}
                <div class="text-center py-16 border border-dashed border-warm-200 dark:border-slate-800 rounded-2xl text-slate-400 text-xs space-y-2">
                  <Icon name="file-text" size={28} class="mx-auto text-slate-300 dark:text-slate-600" />
                  <p class="font-medium">No audit ledger records match the active criteria.</p>
                  <button
                    type="button"
                    onclick={() => { auditSearchQuery = ''; auditCategoryFilter = 'ALL'; auditOutcomeFilter = 'ALL'; }}
                    class="text-orange-600 dark:text-orange-400 hover:underline">
                    Reset filters
                  </button>
                </div>
              {:else}
                <div class="border border-warm-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-warm-100/70 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 font-semibold border-b border-warm-200 dark:border-slate-700">
                      <tr>
                        <th class="p-3 pl-4">Timestamp (Dhaka)</th>
                        <th class="p-3">Actor</th>
                        <th class="p-3">Event Action</th>
                        <th class="p-3">Target</th>
                        <th class="p-3">Outcome</th>
                        <th class="p-3 pr-4 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-warm-100 dark:divide-slate-800 font-mono text-[11px]">
                      {#each filteredAuditLogs as log}
                        {@const metaItems = formatMetadata(log.metadata_json)}
                        {@const time = formatTimestamp(log.created_at)}
                        {@const cat = getEventCategory(log.event_type)}
                        <tr class="hover:bg-warm-50/60 dark:hover:bg-slate-800/70 transition-colors">
                          <td class="p-3 pl-4 whitespace-nowrap">
                            <div class="font-mono text-slate-900 dark:text-white font-medium">{time.exact}</div>
                            <div class="text-[10px] text-slate-400">{time.relative}</div>
                          </td>

                          <td class="p-3 font-sans">
                            <div class="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{log.actor_name || log.actor_user_id || 'System'}</span>
                            </div>
                            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
                              {log.actor_tier ? formatTier(log.actor_tier) : (log.actor_role ? formatRole(log.actor_role) : 'Edge Worker')}
                            </div>
                          </td>

                          <td class="p-3">
                            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              cat === 'SECURITY'
                                ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-300 dark:border-sky-800'
                                : cat === 'GOVERNANCE'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            }`}>
                              <span class={`w-1.5 h-1.5 rounded-full ${
                                cat === 'SECURITY' ? 'bg-sky-500' : cat === 'GOVERNANCE' ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}></span>
                              <span>{log.event_type}</span>
                            </span>
                          </td>

                          <td class="p-3 font-sans text-slate-700 dark:text-slate-300">
                            <div>{log.subject_name || log.subject_user_id || log.entity_id || '-'}</div>
                            {#if log.subject_email}
                              <div class="text-[10px] font-mono text-slate-400">{log.subject_email}</div>
                            {/if}
                          </td>

                          <td class="p-3">
                            <span class={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.outcome === 'SUCCESS'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}>
                              {log.outcome || 'SUCCESS'}
                            </span>
                          </td>

                          <td class="p-3 pr-4 text-right">
                            <button
                              type="button"
                              onclick={() => selectedMetadataLog = log}
                              class="px-2 py-1 bg-warm-100 hover:bg-warm-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-[10px] font-mono transition">
                              Inspect JSON
                            </button>
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

        <!-- SLIDE-OVER OPERATOR DOSSIER DRAWER (CREATE / MANAGE) -->
        {#if drawerMode}
          <div class="absolute inset-y-0 right-0 w-full sm:w-[500px] bg-white dark:bg-slate-900 border-l border-warm-200 dark:border-slate-800 shadow-2xl flex flex-col z-30 animate-in slide-in-from-right duration-200">
            
            <!-- Drawer Header -->
            <div class="p-4 border-b border-warm-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-warm-50/50 dark:bg-slate-950">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-xl bg-orange-600/10 text-orange-600 dark:bg-orange-950 dark:text-orange-400 flex items-center justify-center font-bold text-xs shrink-0">
                  <Icon name={drawerMode === 'CREATE' ? 'user-plus' : 'sliders'} size={16} />
                </div>
                <div class="min-w-0">
                  <h4 class="font-bold text-slate-900 dark:text-white text-sm truncate">
                    {drawerMode === 'CREATE' ? 'Provision New Operator' : drawerTargetUser?.full_name}
                  </h4>
                  <p class="text-[10px] font-mono text-slate-400 truncate">
                    {drawerMode === 'CREATE' ? 'Assign Security Tier & Scopes' : drawerTargetUser?.email}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onclick={closeDrawer}
                class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg">
                <Icon name="x" size={16} />
              </button>
            </div>

            <!-- Drawer Mode Tabs (Manage Mode Only) -->
            {#if drawerMode === 'MANAGE' && drawerTargetUser}
              <div class="px-4 border-b border-warm-200 dark:border-slate-800 flex items-center gap-4 bg-warm-50/30 dark:bg-slate-900/60 text-xs font-medium">
                <button
                  type="button"
                  onclick={() => drawerActiveTab = 'overview'}
                  class={`py-2.5 border-b-2 transition flex items-center gap-1.5 ${
                    drawerActiveTab === 'overview'
                      ? 'border-orange-600 text-orange-600 dark:border-orange-400 dark:text-orange-400 font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}>
                  <Icon name="sliders" size={13} />
                  <span>Overview & Governance</span>
                </button>

                <button
                  type="button"
                  onclick={() => drawerActiveTab = 'activity'}
                  class={`py-2.5 border-b-2 transition flex items-center gap-1.5 ${
                    drawerActiveTab === 'activity'
                      ? 'border-orange-600 text-orange-600 dark:border-orange-400 dark:text-orange-400 font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}>
                  <Icon name="activity" size={13} />
                  <span>Activity Log Stream</span>
                  {#if operatorActivityLogs.length > 0}
                    <span class="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                      {operatorActivityLogs.length}
                    </span>
                  {/if}
                </button>
              </div>
            {/if}

            <!-- Drawer Feedback Alert -->
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
                <div class="p-3.5 rounded-2xl bg-warm-50 dark:bg-slate-950 border border-warm-200 dark:border-slate-700 space-y-2">
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
                      class="px-2.5 py-1.5 rounded-xl border border-warm-200 dark:border-slate-700 hover:bg-warm-100 dark:hover:bg-slate-800 flex items-center gap-1 text-[11px]">
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
                
                <!-- TAB A: OVERVIEW & GOVERNANCE -->
                {#if drawerActiveTab === 'overview'}
                  <!-- Operator Badge Banner -->
                  <div class="p-3.5 rounded-2xl bg-warm-50 dark:bg-slate-950 border border-warm-200 dark:border-slate-800 flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      <div class="w-10 h-10 rounded-xl bg-orange-600/10 text-orange-600 dark:bg-orange-950 dark:text-orange-400 font-bold text-sm flex items-center justify-center">
                        {getMonogram(drawerTargetUser.full_name)}
                      </div>
                      <div>
                        <div class="font-bold text-slate-900 dark:text-white">{drawerTargetUser.full_name}</div>
                        <div class="text-[11px] font-mono text-slate-400">{drawerTargetUser.email}</div>
                      </div>
                    </div>

                    <span class={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      drawerTargetUser.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                    }`}>
                      {drawerTargetUser.status === 'SUSPENDED' ? 'FROZEN' : drawerTargetUser.status}
                    </span>
                  </div>

                  <!-- Section 1: Role & Security Tier Governance -->
                  <div class="p-3.5 rounded-2xl bg-warm-50/70 dark:bg-slate-950 border border-warm-200 dark:border-slate-800 space-y-3">
                    <h5 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Icon name="shield" size={13} class="text-orange-500" />
                      <span>Role & Security Privilege Tier</span>
                    </h5>
                    
                    <div class="space-y-2.5">
                      <div>
                        <label for="mng-role" class="block font-medium text-slate-600 dark:text-slate-400 mb-1 text-[11px]">Role Title</label>
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

                  <!-- Section 2: Freeze / Block & Account Lock Controls -->
                  <div class="p-3.5 rounded-2xl bg-warm-50/70 dark:bg-slate-950 border border-warm-200 dark:border-slate-800 space-y-3">
                    <h5 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Icon name="lock" size={13} class="text-rose-500" />
                      <span>Access Freeze & Block Controls</span>
                    </h5>
                    
                    {#if drawerTargetUser.status === 'ACTIVE'}
                      {#if !isFreezing}
                        <button
                          type="button"
                          onclick={() => isFreezing = true}
                          class="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900 dark:text-rose-300 font-semibold py-2 rounded-xl border border-rose-200 dark:border-rose-800 transition text-xs flex items-center justify-center gap-1.5 shadow-xs">
                          <Icon name="lock" size={14} />
                          <span>Freeze / Block Operator Access</span>
                        </button>
                      {:else}
                        <div class="space-y-2.5 p-3 bg-rose-50/80 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-800">
                          <label for="susp-reason-input" class="block text-[11px] font-semibold text-rose-800 dark:text-rose-200">
                            Reason for Account Freeze / Suspension
                          </label>

                          <!-- Quick Chips -->
                          <div class="flex flex-wrap gap-1.5">
                            {#each ['Administrative Leave', 'Policy Investigation', 'Suspicious Login Attempt', 'Manual Security Audit'] as chip}
                              <button
                                type="button"
                                onclick={() => suspendReason = chip}
                                class="px-2 py-0.5 rounded-full text-[10px] border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition">
                                {chip}
                              </button>
                            {/each}
                          </div>

                          <input
                            id="susp-reason-input"
                            type="text"
                            placeholder="Enter specific audit reason..."
                            bind:value={suspendReason}
                            class="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2 border border-rose-300 dark:border-rose-700 text-xs focus:ring-1 focus:ring-rose-500" />
                          
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
                              class="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-xs">
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
                        <Icon name="unlock" size={14} />
                        <span>Unblock / Restore Account Access</span>
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

                  <!-- Section 3: Force Password Reset -->
                  <div class="p-3.5 rounded-2xl bg-warm-50/70 dark:bg-slate-950 border border-warm-200 dark:border-slate-800 space-y-3">
                    <div class="flex items-center justify-between">
                      <h5 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <Icon name="key" size={13} class="text-amber-500" />
                        <span>Force Temporary Password</span>
                      </h5>
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
                        placeholder="Min 8 characters temporary password"
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
                      <span>Set & Require Reset on Next Login</span>
                    </button>
                  </div>

                  <!-- Section 4: Danger Zone (Decommission Operator) -->
                  {#if canDeleteUser(drawerTargetUser)}
                    <div class="p-3.5 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/60 space-y-3">
                      <h5 class="font-bold text-rose-800 dark:text-rose-300 text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <Icon name="trash-2" size={13} />
                        <span>Danger Zone: Decommission Operator</span>
                      </h5>

                      {#if !showDeleteConfirm}
                        <button
                          type="button"
                          onclick={() => showDeleteConfirm = true}
                          class="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-xs">
                          <Icon name="trash-2" size={14} />
                          <span>Decommission & Remove Operator</span>
                        </button>
                      {:else}
                        <div class="p-3 bg-white dark:bg-slate-900 rounded-xl border border-rose-300 dark:border-rose-800 space-y-2">
                          <p class="text-rose-800 dark:text-rose-200 font-medium text-[11px]">
                            Are you certain? This will immediately revoke all sessions, purge granted scopes, and deactivate this operator.
                          </p>
                          <input
                            type="text"
                            placeholder="Decommission reason (e.g. Employee offboarded)"
                            bind:value={deleteReason}
                            class="w-full bg-warm-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg p-2 border border-rose-300 dark:border-rose-700 text-xs" />
                          <div class="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onclick={() => showDeleteConfirm = false}
                              class="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 dark:text-slate-300 text-xs">
                              Cancel
                            </button>
                            <button
                              type="button"
                              onclick={() => submitDeleteUser(drawerTargetUser.id, deleteReason)}
                              disabled={isDeletingUser}
                              class="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-xs">
                              {isDeletingUser ? 'Decommissioning...' : 'Confirm Decommission'}
                            </button>
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/if}
                {/if}

                <!-- TAB B: INDIVIDUAL OPERATOR ACTIVITY LOG STREAM -->
                {#if drawerActiveTab === 'activity'}
                  <div class="space-y-3">
                    <!-- Stream Filter Chips -->
                    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                      <button
                        type="button"
                        onclick={() => operatorActivityFilter = 'ALL'}
                        class={`px-2.5 py-1 rounded-xl font-medium transition ${
                          operatorActivityFilter === 'ALL'
                            ? 'bg-orange-600 text-white'
                            : 'bg-warm-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}>
                        All Events
                      </button>
                      <button
                        type="button"
                        onclick={() => operatorActivityFilter = 'SECURITY'}
                        class={`px-2.5 py-1 rounded-xl font-medium transition ${
                          operatorActivityFilter === 'SECURITY'
                            ? 'bg-orange-600 text-white'
                            : 'bg-warm-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}>
                        Security & Auth
                      </button>
                      <button
                        type="button"
                        onclick={() => operatorActivityFilter = 'GOVERNANCE'}
                        class={`px-2.5 py-1 rounded-xl font-medium transition ${
                          operatorActivityFilter === 'GOVERNANCE'
                            ? 'bg-orange-600 text-white'
                            : 'bg-warm-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}>
                        Governance
                      </button>
                      <button
                        type="button"
                        onclick={() => operatorActivityFilter = 'OPERATIONS'}
                        class={`px-2.5 py-1 rounded-xl font-medium transition ${
                          operatorActivityFilter === 'OPERATIONS'
                            ? 'bg-orange-600 text-white'
                            : 'bg-warm-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}>
                        Operations
                      </button>
                    </div>

                    <!-- Activity List Stream -->
                    {#if isLoadingOperatorActivity}
                      <div class="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
                        <Icon name="refresh-cw" size={18} class="animate-spin text-orange-500" />
                        <span class="text-xs">Loading operator audit timeline...</span>
                      </div>
                    {:else if filteredOperatorActivity.length === 0}
                      <div class="text-center py-12 text-slate-400 italic text-xs border border-dashed border-warm-200 dark:border-slate-800 rounded-xl">
                        No activity records found for this operator.
                      </div>
                    {:else}
                      <div class="space-y-2.5">
                        {#each filteredOperatorActivity as act}
                          {@const time = formatTimestamp(act.created_at)}
                          {@const cat = getEventCategory(act.event_type)}
                          {@const metaItems = formatMetadata(act.metadata_json)}
                          <div class="p-3 rounded-xl border border-warm-200 dark:border-slate-800 bg-warm-50/50 dark:bg-slate-950 space-y-1.5">
                            <div class="flex items-center justify-between">
                              <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                cat === 'SECURITY'
                                  ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                  : cat === 'GOVERNANCE'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              }`}>
                                <span class={`w-1.5 h-1.5 rounded-full ${
                                  cat === 'SECURITY' ? 'bg-sky-500' : cat === 'GOVERNANCE' ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}></span>
                                <span>{act.event_type}</span>
                              </span>
                              <span class="font-mono text-[10px] text-slate-400">{time.relative}</span>
                            </div>

                            <div class="text-[11px] text-slate-700 dark:text-slate-300 font-sans">
                              {#if act.event_type === 'USER_LOGIN'}
                                Authenticated via Edge session cookie
                              {:else if act.event_type === 'USER_SUSPENDED'}
                                Account frozen by {act.actor_name || act.actor_user_id}
                              {:else if act.event_type === 'USER_REACTIVATED'}
                                Account restored by {act.actor_name || act.actor_user_id}
                              {:else if act.event_type === 'USER_PROVISIONED'}
                                Operator provisioned by {act.actor_name || act.actor_user_id}
                              {:else if act.event_type === 'PASSWORD_RESET_ADMIN'}
                                Temporary password set by administrator
                              {:else if act.event_type === 'SESSIONS_REVOKED'}
                                Active edge sessions revoked
                              {:else}
                                {act.event_type}
                              {/if}
                            </div>

                            <div class="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-warm-100 dark:border-slate-800/80">
                              <span>{time.exact}</span>
                              <span>{act.ip_hash || 'Cloudflare Edge'}</span>
                            </div>

                            {#if metaItems.length > 0}
                              <div class="flex flex-wrap gap-1 pt-1">
                                {#each metaItems as item}
                                  <span class="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-400">
                                    <strong class="font-semibold text-slate-800 dark:text-slate-200">{item.key}:</strong> {item.val}
                                  </span>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}

              {/if}

            </div>
          </div>
        {/if}

        <!-- JSON METADATA INSPECTOR MODAL -->
        {#if selectedMetadataLog}
          <div class="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div class="bg-white dark:bg-slate-900 border border-warm-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
              <div class="flex items-center justify-between border-b border-warm-200 dark:border-slate-800 pb-3">
                <div class="flex items-center gap-2">
                  <Icon name="file-text" size={16} class="text-orange-500" />
                  <h4 class="font-bold text-slate-900 dark:text-white text-sm">Audit Record Metadata</h4>
                </div>
                <button
                  type="button"
                  onclick={() => selectedMetadataLog = null}
                  class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1">
                  <Icon name="x" size={16} />
                </button>
              </div>

              <div class="space-y-2 text-xs">
                <div class="grid grid-cols-2 gap-2 text-[11px] p-2.5 rounded-xl bg-warm-50 dark:bg-slate-950 font-mono">
                  <div><strong>Event:</strong> {selectedMetadataLog.event_type}</div>
                  <div><strong>Outcome:</strong> {selectedMetadataLog.outcome}</div>
                  <div><strong>Actor:</strong> {selectedMetadataLog.actor_name || selectedMetadataLog.actor_user_id}</div>
                  <div><strong>Target:</strong> {selectedMetadataLog.subject_name || selectedMetadataLog.subject_user_id || '-'}</div>
                </div>

                <div>
                  <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Payload JSON</div>
                  <pre class="bg-warm-100 dark:bg-slate-950 p-3 rounded-xl font-mono text-[11px] text-slate-800 dark:text-slate-200 overflow-x-auto max-h-60 border border-warm-200 dark:border-slate-800">{JSON.stringify(JSON.parse(selectedMetadataLog.metadata_json || '{}'), null, 2)}</pre>
                </div>
              </div>

              <div class="flex justify-end pt-1">
                <button
                  type="button"
                  onclick={() => selectedMetadataLog = null}
                  class="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold text-xs shadow-xs">
                  Done
                </button>
              </div>
            </div>
          </div>
        {/if}

      </main>
    </div>
  </div>
{/if}
