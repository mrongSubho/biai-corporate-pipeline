import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auditCorporateLeads } from '../lib/engine/hygiene.js';
import { executeCopilotQuery } from '../lib/engine/copilot.js';
import { generateCorporateFollowupEmail } from '../lib/engine/email_drafter.js';
import { sendCorporateEmail } from './adapters/resend.js';
import {
  authMiddleware,
  requireRole,
  requireTier,
  requireScope,
  requireReauth,
  type AuthenticatedCorporateUser
} from './auth.js';
import { AuthService } from './auth_service.js';
import { MessagingService } from './messaging_service.js';
import { PipelineRepository } from './db/repository.js';
import {
  MergeLeadsSchema,
  UnmergeLeadSchema,
  RemediateDateSchema,
  LeadStageTransitionSchema,
  FixTypoSchema,
  CopilotQueryRequestSchema,
  EmailDraftRequestSchema,
  EmailSendRequestSchema,
  LeadsQuerySchema
} from './validation.js';
import { generateRandomToken, sha256 } from './crypto.js';
import { getMissingProductionConfig } from './config.js';
import { retryQueuedPipelineDeliveries } from './delivery_retry.js';

export interface Env {
  DB?: any;
  AI?: any;
  ASSETS?: any;
  ENVIRONMENT?: string;
  DEFAULT_TIMEZONE?: string;
  BENCHMARK_DATE?: string;
  WORKSPACE_ID?: string;
  RESEND_API_KEY?: string;
  MFA_ENCRYPTION_KEY?: string;
  INITIAL_OWNER_BOOTSTRAP_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
}

const app = new Hono<{ Bindings: Env; Variables: { actor: AuthenticatedCorporateUser; workspaceId: string } }>();

app.use('*', async (c, next) => {
  // Allow healthcheck and static assets without configuration blockage
  if (c.req.path === '/api/health' || !c.req.path.startsWith('/api/')) {
    return next();
  }
  const missing = getMissingProductionConfig(c.env as unknown as Record<string, unknown>);
  if (missing.length > 0) {
    return c.json({
      error: 'Production configuration is incomplete',
      code: 'PRODUCTION_CONFIG_INVALID',
      missing
    }, 503);
  }
  return next();
});

// Enable CORS with secure origin checks for production
app.use('*', cors({
  origin: (origin, c) => {
    if (c.env?.ENVIRONMENT !== 'production') return origin || '*';
    const allowedOrigins = (c.env?.ALLOWED_ORIGINS || '').split(',').map((value: string) => value.trim()).filter(Boolean);
    return origin && allowedOrigins.includes(origin) ? origin : '';
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

// Apply authentication middleware across protected route namespaces
app.use('/api/v1/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);
app.use('/api/auth/me', authMiddleware);
app.use('/api/auth/logout', authMiddleware);
app.use('/api/auth/reauthenticate', authMiddleware);
app.use('/api/auth/mfa/*', authMiddleware);
app.use('/api/auth/password/change', authMiddleware);
app.use('/api/auth/profile', authMiddleware);
app.use('/api/auth/sessions', authMiddleware);
app.use('/api/auth/sessions/*', authMiddleware);
app.use('/api/auth/activity', authMiddleware);

// ============================================================================
// SYSTEM HEALTHCHECK
// ============================================================================
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    system: 'BIAI B2B Corporate Leads Pipeline & Data Health Engine',
    runtime: 'Cloudflare Workers (Edge V8 Isolate)',
    d1_connected: Boolean(c.env?.DB),
    timestamp: new Date().toISOString(),
    benchmark_date: c.env?.BENCHMARK_DATE || '2026-11-01',
    timezone: c.env?.DEFAULT_TIMEZONE || 'Asia/Dhaka',
    environment: c.env?.ENVIRONMENT || 'development'
  });
});

// ============================================================================
// IDENTITY & AUTHENTICATION CONTROL PLANE
// ============================================================================

// POST /api/auth/login
app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password, mfaCode } = body;

  if (!email || !password) {
    return c.json({ error: 'Email and password are required', code: 'INVALID_REQUEST' }, 400);
  }

  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const ua = c.req.header('user-agent') || 'Unknown';

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.login(ip, ua, { email, password, mfaCode });

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }

  if (result.requiresMfa) {
    return c.json(result.data, 200);
  }

  if (result.cookieHeader) {
    c.header('Set-Cookie', result.cookieHeader);
  }

  return c.json(result.data, 200);
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (c) => {
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const token = actor?.session_id_hash;

  const result = await authService.logout(token || '', actor?.id);
  if (result.cookieHeader) {
    c.header('Set-Cookie', result.cookieHeader);
  }
  return c.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me
app.get('/api/auth/me', async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    return c.json({ error: 'Unauthorized: missing authentication session', code: 'UNAUTHORIZED' }, 401);
  }
  return c.json({
    id: actor.id,
    workspace_id: actor.workspace_id,
    email: actor.email,
    full_name: actor.full_name,
    department: actor.department,
    role: actor.role,
    security_tier: actor.security_tier,
    scopes: actor.scopes,
    reauthenticated_at: actor.reauthenticated_at
  });
});

// POST /api/auth/reauthenticate
app.post('/api/auth/reauthenticate', async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const { password, mfaCode } = body;

  if (!password) {
    return c.json({ error: 'Password is required for reauthentication' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.reauthenticate(actor.id, actor.session_id_hash || '', { password, mfaCode });

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }

  return c.json(result.data, 200);
});

// POST /api/auth/mfa/enroll
app.post('/api/auth/mfa/enroll', requireReauth(10), async (c) => {
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.enrollMfa(actor.id);

  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }

  return c.json(result.data, 200);
});

// POST /api/auth/mfa/confirm
app.post('/api/auth/mfa/confirm', async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const { factorId, code } = body;

  if (!factorId || !code) {
    return c.json({ error: 'factorId and 6-digit code are required' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.confirmMfa(actor.id, factorId, code);

  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }

  return c.json(result.data, 200);
});

// POST /api/auth/password/change
app.post('/api/auth/password/change', requireReauth(10), async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'currentPassword and newPassword are required' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.changePassword(actor.id, currentPassword, newPassword, actor.session_id_hash);

  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }

  return c.json(result.data, 200);
});

// PATCH /api/auth/profile: Self-service update own profile
app.patch('/api/auth/profile', async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.updateProfile(actor.id, {
    fullName: body.fullName,
    department: body.department
  });
  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }
  return c.json(result.data, 200);
});

// GET /api/auth/sessions: Self-service list active sessions
app.get('/api/auth/sessions', async (c) => {
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.listSessions(actor.id, actor.session_id_hash);
  return c.json(result.data, 200);
});

// POST /api/auth/sessions/revoke-others: Revoke all other sessions
app.post('/api/auth/sessions/revoke-others', async (c) => {
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.revokeOtherSessions(actor.id, actor.session_id_hash || '');
  return c.json(result.data, 200);
});

// GET /api/auth/activity: Self-service user security activity
app.get('/api/auth/activity', async (c) => {
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.getUserActivity(actor.id);
  return c.json(result.data, 200);
});

// POST /api/auth/invitations
app.post('/api/auth/invitations', authMiddleware, requireTier('TIER_1'), requireReauth(10), async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const { email, fullName, department, role, securityTier, scopes } = body;

  if (!email || !fullName || !role || !securityTier) {
    return c.json({ error: 'email, fullName, role, and securityTier are required' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.createInvitation(actor, {
    email,
    fullName,
    department,
    role,
    securityTier,
    scopes: Array.isArray(scopes) ? scopes : ['PIPELINE_READ', 'PIPELINE_REMEDIATE']
  });

  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }

  return c.json(result.data, 201);
});

// POST /api/auth/invitations/accept
app.post('/api/auth/invitations/accept', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { token, fullName, password } = body;

  if (!token || !password) {
    return c.json({ error: 'token and password are required' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.acceptInvitation(token, { fullName, password });

  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }

  return c.json(result.data, 200);
});

// POST /api/auth/bootstrap-owner
app.post('/api/auth/bootstrap-owner', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, fullName, password, bootstrapToken } = body;

  if (!email || !fullName || !password) {
    return c.json({ error: 'email, fullName, and password are required' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.bootstrapOwner({ email, fullName, password, bootstrapToken });

  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }

  return c.json(result.data, 200);
});

// ============================================================================
// ADMINISTRATIVE USER & ACCESS CONTROL PLANE (TIER_0 / TIER_1)
// ============================================================================

// GET /api/admin/users: Enriched directory with scopes, active session counts & permissions
app.get('/api/admin/users', requireTier('TIER_1'), async (c) => {
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.listUsers(actor);
  if (!result.success) {
    return c.json({ error: result.error }, result.status as any);
  }
  return c.json(result.data, 200);
});

// POST /api/admin/users: Create new active user or tokenized invitation
app.post('/api/admin/users', requireTier('TIER_1'), async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const { email, fullName, department, role, securityTier, scopes } = body;
  const password = body.password || body.tempPassword;
  const mustChangePassword = body.mustChangePassword !== undefined ? !!body.mustChangePassword : true;

  if (!email || !fullName || !role || !securityTier) {
    return c.json({ error: 'email, fullName, role, and securityTier are required', code: 'INVALID_REQUEST' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.createUser(actor, {
    email,
    fullName,
    department,
    role,
    securityTier,
    scopes,
    password,
    mustChangePassword: !!mustChangePassword
  });

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 201);
});

// PATCH /api/admin/users/:id: Modify user role, tier, department, scopes
app.patch('/api/admin/users/:id', requireTier('TIER_1'), async (c) => {
  const actor = c.get('actor');
  const targetId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.updateUser(actor, targetId, {
    fullName: body.fullName,
    department: body.department,
    role: body.role,
    securityTier: body.securityTier,
    scopes: body.scopes
  });

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// POST /api/admin/users/:id/reset-password: Force set password for target user
app.post('/api/admin/users/:id/reset-password', requireTier('TIER_1'), async (c) => {
  const actor = c.get('actor');
  const targetId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const newPassword = body.newPassword || body.tempPassword;

  if (!newPassword) {
    return c.json({ error: 'newPassword or tempPassword is required', code: 'INVALID_REQUEST' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.adminResetPassword(actor, targetId, newPassword);

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// POST /api/admin/users/:id/status: Freeze, Reactivate, Unlock Lockout, Deactivate
app.post('/api/admin/users/:id/status', requireTier('TIER_1'), async (c) => {
  const actor = c.get('actor');
  const targetId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  let action = body.action;
  if (!action && body.status) {
    if (body.status === 'SUSPENDED') action = 'SUSPEND';
    else if (body.status === 'ACTIVE') action = 'ACTIVATE';
    else if (body.status === 'DEACTIVATED') action = 'DEACTIVATE';
  }
  const reason = body.reason;

  if (!action || !['SUSPEND', 'ACTIVATE', 'UNLOCK', 'DEACTIVATE'].includes(action)) {
    return c.json({ error: 'Valid action (SUSPEND, ACTIVATE, UNLOCK, DEACTIVATE) or status is required', code: 'INVALID_ACTION' }, 400);
  }

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.setUserStatus(actor, targetId, action, reason);

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// Backward-compatible endpoints for suspend and reactivate
app.post('/api/admin/users/:id/suspend', requireTier('TIER_1'), async (c) => {
  const targetId = c.req.param('id');
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.setUserStatus(actor, targetId, 'SUSPEND', 'Administrative suspension');
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

app.post('/api/admin/users/:id/reactivate', requireTier('TIER_1'), async (c) => {
  const targetId = c.req.param('id');
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.setUserStatus(actor, targetId, 'ACTIVATE');
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// POST /api/admin/users/:id/revoke-sessions: Force logout target user
app.post('/api/admin/users/:id/revoke-sessions', requireTier('TIER_1'), async (c) => {
  const targetId = c.req.param('id');
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.revokeUserSessions(actor, targetId);
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// DELETE /api/admin/users/:id: Decommission & deactivate user account
app.delete('/api/admin/users/:id', requireTier('TIER_1'), async (c) => {
  const targetId = c.req.param('id');
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const reason = body?.reason;

  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const result = await authService.deleteUser(actor, targetId, reason);
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// GET /api/admin/audit-logs: Comprehensive security audit stream
app.get('/api/admin/audit-logs', requireTier('TIER_1'), async (c) => {
  const actor = c.get('actor');
  const authService = new AuthService(c.env?.DB, c.env, 'PIPELINE');
  const userId = c.req.query('userId');
  const eventType = c.req.query('eventType');
  const outcome = c.req.query('outcome');
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 50;

  const result = await authService.getAuditLogs(actor.workspace_id, { userId, eventType, outcome, limit });
  return c.json(result.data, 200);
});

// ============================================================================
// CORE PIPELINE DOMAIN ENDPOINTS
// ============================================================================

// 2. Get Leads (Lineage-Aware Financial Reconciliation)
app.get('/api/v1/leads', async (c) => {
  const query = LeadsQuerySchema.safeParse({
    mode: c.req.query('mode'),
    stage: c.req.query('stage'),
    industry: c.req.query('industry')
  });

  if (!query.success) {
    return c.json({ error: 'Invalid query parameters', details: query.error.format() }, 400);
  }

  const { mode, stage, industry } = query.data;
  const actor = c.get('actor');
  const isProduction = c.env?.ENVIRONMENT === 'production';

  try {
    const summary = await PipelineRepository.getLeads(c.env?.DB, mode, stage, industry, actor, isProduction);
    return c.json(summary);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch leads', code: err.code || 'PIPELINE_ERROR' }, err.status || 500);
  }
});

// 3. Automated Data Health & Hygiene Audit
app.get('/api/v1/hygiene/audit', async (c) => {
  const benchmarkDate = c.env?.BENCHMARK_DATE || '2026-11-01';
  const actor = c.get('actor');
  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw', undefined, undefined, actor);
  const audit = auditCorporateLeads(summary.leads, benchmarkDate);

  return c.json({
    benchmark_date: benchmarkDate,
    total_leads_scanned: audit.totalLeadsScanned,
    unique_leads_flagged: audit.uniqueLeadsFlaggedCount,
    total_anomaly_findings: audit.totalFindingsCount,
    duplicate_pairs: audit.duplicatePairsCount,
    overdue_count: audit.overdueCount,
    findings: audit.findings
  });
});

// 4. Execute 1-Click Reversible Duplicate Merge (Scope: PIPELINE_MERGE + Reauth within 10 min)
app.post('/api/v1/hygiene/merge', requireRole(['PLATFORM_OWNER', 'OPERATIONS_ADMIN', 'TEAM_LEAD', 'ADMIN', 'SALES_MANAGER']), requireReauth(10), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = MergeLeadsSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { canonicalId, duplicateId } = validation.data;
  const actor = c.get('actor');
  const isProduction = c.env?.ENVIRONMENT === 'production';

  try {
    const result = await PipelineRepository.mergeLeads(c.env?.DB, canonicalId, duplicateId, actor, isProduction);
    return c.json({
      success: true,
      message: `Merged ${duplicateId} into ${canonicalId}. Removed ৳ ${result.phantomRevenueRemoved.toLocaleString()} BDT phantom revenue.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Merge failed', code: err.code }, err.status || 400);
  }
});

// 5. Revert Merge / Unmerge (Restores Canonical Pre-Merge State + Reauth within 10 min)
app.post('/api/v1/hygiene/unmerge', requireRole(['PLATFORM_OWNER', 'OPERATIONS_ADMIN', 'TEAM_LEAD', 'ADMIN', 'SALES_MANAGER']), requireReauth(10), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = UnmergeLeadSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { duplicateId } = validation.data;
  const actor = c.get('actor');
  const isProduction = c.env?.ENVIRONMENT === 'production';

  try {
    const result = await PipelineRepository.unmergeLead(c.env?.DB, duplicateId, actor, isProduction);
    return c.json({
      success: true,
      message: `Reverted merge for ${duplicateId}. Restored to active pipeline.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Unmerge failed', code: err.code }, err.status || 400);
  }
});

// 6. Remediate Chronological Date Order Error (Explicit Date Validation Required + Reauth within 10 min)
app.post('/api/v1/hygiene/remediate-date', requireRole(['PLATFORM_OWNER', 'OPERATIONS_ADMIN', 'TEAM_LEAD', 'ADMIN', 'SALES_MANAGER']), requireReauth(10), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = RemediateDateSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      error: 'Invalid remediation request: For RESCHEDULE strategy, newFollowup (YYYY-MM-DD) is required.',
      details: validation.error.format()
    }, 400);
  }

  const { leadId, strategy, newFollowup } = validation.data;
  const actor = c.get('actor');
  const isProduction = c.env?.ENVIRONMENT === 'production';

  try {
    const result = await PipelineRepository.remediateDate(c.env?.DB, leadId, strategy, newFollowup, actor, isProduction);
    return c.json({
      success: true,
      message: `Successfully remediated chronological date error for ${leadId}.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Date remediation failed', code: err.code }, err.status || 400);
  }
});

// 7. Fix Email Typo
app.post('/api/v1/hygiene/fix-typo', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = FixTypoSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { leadId } = validation.data;
  const actor = c.get('actor');
  const isProduction = c.env?.ENVIRONMENT === 'production';

  try {
    const result = await PipelineRepository.fixEmailTypo(c.env?.DB, leadId, actor, isProduction);
    return c.json({
      success: true,
      message: `Normalized email address for ${leadId}.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Fix typo failed', code: err.code }, err.status || 400);
  }
});

// 8. Lead Stage Transition
app.post('/api/v1/leads/:id/stage', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const validation = LeadStageTransitionSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error: invalid pipeline stage', details: validation.error.format() }, 400);
  }

  const { stage } = validation.data;
  const actor = c.get('actor');
  const isProduction = c.env?.ENVIRONMENT === 'production';

  try {
    const result = await PipelineRepository.transitionStage(c.env?.DB, id, stage, actor, isProduction);
    return c.json({ success: true, result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Stage transition failed', code: err.code }, err.status || 400);
  }
});

// 9. Natural Language Deal Copilot with Strict Error Handling
app.post('/api/v1/copilot/query', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = CopilotQueryRequestSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Question is required and must not be empty' }, 400);
  }

  const { question } = validation.data;
  const benchmarkDate = c.env?.BENCHMARK_DATE || '2026-11-01';
  const actor = c.get('actor');

  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw', undefined, undefined, actor);

  try {
    const queryResult = executeCopilotQuery(question, summary.leads, benchmarkDate);
    return c.json({ success: true, data: queryResult });
  } catch (err: any) {
    return c.json({
      error: 'Unsupported Copilot Query',
      message: err.message || 'Could not compile query to allowlisted AST',
      supported_queries: [
        'What is the total value in Proposal stage?',
        'Which deals are overdue?',
        'Show me Garments and Pharma leads',
        'Show deals with data anomalies or duplicates',
        'Show high-value deals >= 250k BDT'
      ]
    }, 422);
  }
});

// 10. AI B2B Follow-up Email Drafter
app.post('/api/v1/email/draft', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = EmailDraftRequestSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { leadId, tone } = validation.data;
  const actor = c.get('actor');
  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw', undefined, undefined, actor);
  const lead = summary.leads.find(l => l.id === leadId);

  if (!lead) return c.json({ error: `Lead ${leadId} not found` }, 404);
  if (!lead.contact_email) {
    return c.json({
      error: 'RECIPIENT_CONTACT_MISSING',
      message: 'A verified recipient email is required before dispatch.'
    }, 422);
  }

  const draft = generateCorporateFollowupEmail({ lead, tone });
  return c.json({ success: true, draft });
});

// 10.1 Outbound Email Dispatch with Policy Enforcement, Truthful Delivery & D1 State Machine
app.post('/api/v1/email/send', requireRole(['PLATFORM_OWNER', 'OPERATIONS_ADMIN', 'TEAM_LEAD', 'ADMIN', 'SALES_MANAGER', 'SPECIALIST_OPERATOR', 'ACCOUNT_EXECUTIVE']), requireReauth(10), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = EmailSendRequestSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { leadId, subject, bodyText, tone, bankConfirmed } = validation.data;
  const actor = c.get('actor');
  const isProduction = c.env?.ENVIRONMENT === 'production';
  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw', undefined, undefined, actor);
  const lead = summary.leads.find(l => l.id === leadId);

  if (!lead) return c.json({ error: `Lead ${leadId} not found` }, 404);
  if (!lead.contact_email) {
    return c.json({
      error: 'RECIPIENT_CONTACT_MISSING',
      message: 'A verified recipient email is required before dispatch.'
    }, 422);
  }

  // Policy Barrier: Invoiced deals require explicit bank confirmation before reminder dispatch
  if (lead.stage === 'Invoice sent' && !bankConfirmed) {
    return c.json({
      error: 'POLICY_BARRIER_VIOLATION',
      message: 'Finance policy requires bank statement confirmation before chasing an invoiced customer to avoid embarrassing double-billing.'
    }, 422);
  }

  const emailId = `em_${generateRandomToken(12)}`;
  const idempotencyKey = `pipeline_${actor.workspace_id}_${emailId}`;
  let canonicalPk = leadId.startsWith('can_') ? leadId : `can_${leadId}`;

  if (c.env?.DB) {
    try {
      const dbLead = await c.env.DB.prepare(
        'SELECT id FROM canonical_leads WHERE (lead_id_display = ? OR id = ?) AND workspace_id = ?'
      ).bind(leadId, leadId, actor.workspace_id).first();
      if (!dbLead) return c.json({ error: `Lead ${leadId} not found`, code: 'LEAD_NOT_FOUND' }, 404);
      canonicalPk = dbLead.id;
      await c.env.DB.prepare(`
        INSERT INTO outbound_emails (
          id, workspace_id, lead_id, recipient_email, recipient_name,
          subject, body_text, tone, status, approved_by, sent_at,
          provider_message_id, idempotency_key, retry_count, failure_code,
          delivery_status, next_retry_at, manual_dispatch_required
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, NULL, NULL, ?, 0, NULL, 'QUEUED', NULL, 0)
      `).bind(
        emailId,
        actor.workspace_id,
        canonicalPk,
        lead.contact_email,
        lead.contact_name || lead.company,
        subject,
        bodyText,
        tone,
        actor.id,
        idempotencyKey
      ).run();
    } catch (error) {
      console.error('Failed to queue outbound email in D1:', error);
      return c.json({ error: 'Delivery queue unavailable', code: 'DB_UNAVAILABLE' }, 503);
    }
  }

  const sendResult = await sendCorporateEmail({
    recipientEmail: lead.contact_email,
    recipientName: lead.contact_name || lead.company,
    subject,
    bodyText,
    idempotencyKey,
    apiKey: (c.env as any)?.RESEND_API_KEY,
    allowMock: !isProduction
  });

  const deliveryStatus = sendResult.success ? 'SENT' : 'FAILED';
  const failureCode = sendResult.success ? null : (sendResult.error || 'PROVIDER_FAILURE');

  if (c.env?.DB) {
    try {
      const auditEventType = sendResult.success ? 'EMAIL_APPROVED_DISPATCHED' : 'EMAIL_DISPATCH_FAILED';

      const batchOps = [
        c.env.DB.prepare(`
          UPDATE outbound_emails
          SET status = ?, sent_at = CASE WHEN ? = 'SENT' THEN datetime('now') ELSE NULL END,
              provider_message_id = ?, failure_code = ?, delivery_status = ?,
              retry_count = CASE WHEN ? = 'FAILED' THEN retry_count + 1 ELSE retry_count END,
              next_retry_at = CASE WHEN ? = 'FAILED' THEN datetime('now', '+15 minutes') ELSE NULL END,
              manual_dispatch_required = CASE WHEN ? = 'FAILED' THEN 1 ELSE 0 END,
              last_provider_response = ?
          WHERE id = ? AND workspace_id = ? AND idempotency_key = ?
        `).bind(
          deliveryStatus,
          deliveryStatus,
          sendResult.messageId || null,
          failureCode,
          deliveryStatus,
          deliveryStatus,
          deliveryStatus,
          deliveryStatus,
          JSON.stringify({ provider: sendResult.provider, status: sendResult.status, error: sendResult.error }),
          emailId,
          actor.workspace_id,
          idempotencyKey
        ),
        c.env.DB.prepare(`
          INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
          VALUES (?, ?, 'USER', ?, ?, ?, NULL, ?, ?)
        `).bind(
          actor.workspace_id,
          actor.id,
          actor.role,
          auditEventType,
          lead.id,
          JSON.stringify({ status: deliveryStatus, recipient: lead.contact_email }),
          JSON.stringify({
            message_id: sendResult.messageId,
            provider: sendResult.provider,
            error: failureCode,
            idempotency_key: idempotencyKey
          })
        )
      ];

      // If failed, also log MANUAL_DISPATCH_REQUIRED
      if (!sendResult.success) {
        batchOps.push(
          c.env.DB.prepare(`
            INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
            VALUES (?, ?, 'USER', ?, 'MANUAL_DISPATCH_REQUIRED', ?, NULL, ?, ?)
          `).bind(
            actor.workspace_id,
            actor.id,
            actor.role,
            lead.id,
            JSON.stringify({ status: 'FAILED', reason: failureCode }),
            JSON.stringify({ lead_id: leadId, recipient: lead.contact_email })
          )
        );
      }

      await c.env.DB.batch(batchOps);
    } catch (e) {
      console.error('Failed to persist outbound email in D1:', e);
    }
  }

  if (!sendResult.success) {
    return c.json({
      success: false,
      error: `Email dispatch failed: ${sendResult.error}`,
      code: 'MANUAL_DISPATCH_REQUIRED',
      delivery: sendResult
    }, 502);
  }

  return c.json({
    success: true,
    message: `Follow-up email dispatched successfully to ${lead.contact_email}`,
    delivery: sendResult
  });
});

// 11. Server-Controlled Role-Gated Export with Checksum & Audit
app.post('/api/v1/leads/export', requireRole(['PLATFORM_OWNER', 'OPERATIONS_ADMIN', 'TEAM_LEAD', 'ADMIN', 'SALES_MANAGER']), requireReauth(10), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const mode = body.mode === 'raw' ? 'raw' : 'cleaned';
  const maskPii = Boolean(body.maskPii);
  const actor = c.get('actor');

  const summary = await PipelineRepository.getLeads(c.env?.DB, mode, undefined, undefined, actor);

  const headers = ['Lead ID', 'Company', 'Industry', 'Contact', 'Email', 'Phone', 'Stage', 'Deal Value BDT', 'Collected BDT', 'Due BDT', 'Next Followup'];
  const rows = summary.leads.map(l => {
    let email = l.contact_email || '';
    let phone = l.contact_phone || '';

    if (maskPii) {
      if (email.includes('@')) {
        const [u, d] = email.split('@');
        email = `${u.slice(0, 2)}***@${d}`;
      }
      if (phone.length > 5) {
        phone = `${phone.slice(0, 6)}***${phone.slice(-2)}`;
      }
    }

    return [
      l.id,
      `"${l.company}"`,
      l.industry,
      l.contact_name ? `"${l.contact_name}"` : '',
      email,
      phone,
      l.stage,
      l.deal_value_bdt || 0,
      l.amount_collected_bdt || 0,
      l.amount_due_bdt || 0,
      l.next_followup || ''
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');

  // Compute SHA-256 Checksum
  const checksum = await sha256(csvContent);

  // Record Audit Event
  if (c.env?.DB) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, metadata_json)
        VALUES (?, ?, 'USER', ?, 'CLEANED_CSV_EXPORTED', ?, ?)
      `).bind(
        actor.workspace_id,
        actor.id,
        actor.role,
        `export_${mode}_${Date.now()}`,
        JSON.stringify({ row_count: rows.length, checksum_sha256: checksum, pii_masked: maskPii, actor_name: actor.full_name })
      ).run();
    } catch (e) {
      console.error('Failed to log export audit in D1:', e);
    }
  }

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="biai_leads_${mode}_${Date.now()}.csv"`);
  c.header('X-Export-SHA256', checksum);
  c.header('X-Export-Checksum-SHA256', checksum);
  c.header('X-Export-Rows', String(rows.length));

  return c.text(csvContent);
});

// ============================================================================
// INTERNAL COMMAND & OPERATIONAL MESSAGING CONTROL PLANE
// ============================================================================

// GET /api/v1/messages/recipients: List eligible messaging targets
app.get('/api/v1/messages/recipients', async (c) => {
  const actor = c.get('actor');
  const msgService = new MessagingService(c.env?.DB, c.env, 'PIPELINE');
  const result = await msgService.getRecipients(actor);
  return c.json(result.data, 200);
});

// GET /api/v1/messages/unread-summary: Fast badge counter
app.get('/api/v1/messages/unread-summary', async (c) => {
  const actor = c.get('actor');
  const msgService = new MessagingService(c.env?.DB, c.env, 'PIPELINE');
  const result = await msgService.getUnreadSummary(actor);
  return c.json(result.data, 200);
});

// GET /api/v1/messages/threads: List user threads
app.get('/api/v1/messages/threads', async (c) => {
  const actor = c.get('actor');
  const channel = c.req.query('channel');
  const msgService = new MessagingService(c.env?.DB, c.env, 'PIPELINE');
  const result = await msgService.listThreads(actor, channel);
  return c.json(result.data, 200);
});

// POST /api/v1/messages/threads: Create new thread
app.post('/api/v1/messages/threads', async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json().catch(() => ({}));
  const msgService = new MessagingService(c.env?.DB, c.env, 'PIPELINE');
  const result = await msgService.createThread(actor, body);
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 201);
});

// GET /api/v1/messages/threads/:id: Get thread and mark read
app.get('/api/v1/messages/threads/:id', async (c) => {
  const actor = c.get('actor');
  const threadId = c.req.param('id');
  const msgService = new MessagingService(c.env?.DB, c.env, 'PIPELINE');
  const result = await msgService.getThread(actor, threadId);
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// POST /api/v1/messages/threads/:id/messages: Send reply
app.post('/api/v1/messages/threads/:id/messages', async (c) => {
  const actor = c.get('actor');
  const threadId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const msgService = new MessagingService(c.env?.DB, c.env, 'PIPELINE');
  const result = await msgService.sendMessage(actor, threadId, body);
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 201);
});

// POST /api/v1/messages/threads/:id/acknowledge: Acknowledge directive
app.post('/api/v1/messages/threads/:id/acknowledge', async (c) => {
  const actor = c.get('actor');
  const threadId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const msgService = new MessagingService(c.env?.DB, c.env, 'PIPELINE');
  const result = await msgService.acknowledgeDirective(actor, threadId, body.messageId);
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json(result.data, 200);
});

// 12. Static Assets fallback for SPA
app.get('*', async (c) => {
  if (c.env?.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

// Cloudflare Cron retries queued/failed provider deliveries without exposing
// an unauthenticated HTTP dispatch endpoint.
(app as any).scheduled = async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
  ctx.waitUntil(retryQueuedPipelineDeliveries(env.DB, env));
};

export default app;
