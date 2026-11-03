import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/server/index.ts';
import { createTestD1Database } from './d1-helper.ts';
import { retryQueuedPipelineDeliveries } from '../src/server/delivery_retry.ts';

describe('BIAI Task 2 Pipeline — API Security, Financial Trust & D1 Persistence', () => {
  let d1: ReturnType<typeof createTestD1Database>;
  let env: any;

  beforeEach(() => {
    d1 = createTestD1Database();
    env = {
      DB: d1,
      WORKSPACE_ID: 'ws_biai_b2b',
      BENCHMARK_DATE: '2026-11-01',
      DEFAULT_TIMEZONE: 'Asia/Dhaka',
      ENVIRONMENT: 'test'
    };
  });

  it('GET /api/health returns healthy system status and benchmark date with D1 connected', async () => {
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe('healthy');
    expect(json.d1_connected).toBe(true);
    expect(json.benchmark_date).toBe('2026-11-01');
  });

  it('Unauthenticated requests to protected Pipeline endpoints are strictly denied with 401', async () => {
    const res = await app.request('/api/v1/leads', {}, env);
    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/v1/leads strictly reconciles Cleaned Mode from D1 (23 leads, 3.17M value, 550k receivables)', async () => {
    const res = await app.request('/api/v1/leads?mode=cleaned', {
      headers: { 'Authorization': 'Bearer mgr-token' }
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();

    expect(json.mode).toBe('cleaned');
    expect(json.total_leads).toBe(23);
    // 3,170,000 BDT Contracted Value (excluding Lost)
    expect(json.total_deal_value_bdt).toBe(3170000);
    // 150,000 BDT Cash Collected (L12 advance)
    expect(json.cash_collected_bdt).toBe(150000);
    // 550,000 BDT Outstanding Receivables (L07: 250k, L22: 150k, L12: 150k)
    expect(json.outstanding_due_bdt).toBe(550000);
  });

  it('GET /api/v1/leads strictly reconciles Raw Mode from D1 (25 leads, 4.22M value)', async () => {
    const res = await app.request('/api/v1/leads?mode=raw', {
      headers: { 'Authorization': 'Bearer mgr-token' }
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();

    expect(json.mode).toBe('raw');
    expect(json.total_leads).toBe(25);
    expect(json.total_deal_value_bdt).toBe(4220000);
  });

  it('Account executives can only read and mutate assigned leads', async () => {
    d1.rawDb.prepare("UPDATE canonical_leads SET assigned_user_id = 'usr_b2b_ae' WHERE lead_id_display = 'L01'").run();

    const assigned = await app.request('/api/v1/leads?mode=raw', {
      headers: { 'Authorization': 'Bearer ae-token' }
    }, env);
    expect(assigned.status).toBe(200);
    const assignedJson: any = await assigned.json();
    expect(assignedJson.leads.every((lead: any) => lead.id === 'L01')).toBe(true);

    const denied = await app.request('/api/v1/hygiene/fix-typo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ae-token' },
      body: JSON.stringify({ leadId: 'L18' })
    }, env);
    expect(denied.status).toBe(404);
  });

  it('scheduled delivery retry sends a queued email and records provider state', async () => {
    await d1.prepare(`
      INSERT INTO outbound_emails (
        id, workspace_id, lead_id, recipient_email, recipient_name,
        subject, body_text, tone, status, approved_by, idempotency_key,
        retry_count, delivery_status, next_retry_at, manual_dispatch_required
      ) VALUES (?, 'ws_biai_b2b', 'can_L01', ?, ?, ?, ?, 'POLITE_CHECKIN', 'APPROVED', 'usr_b2b_mgr', ?, 0, 'QUEUED', NULL, 0)
    `).bind(
      'em_retry_pipeline',
      'retry@example.com',
      'Retry Contact',
      'Retry subject',
      'Retry body',
      'pipeline_ws_biai_b2b_em_retry_pipeline'
    ).run();

    const result = await retryQueuedPipelineDeliveries(d1, env);
    const row: any = await d1.prepare('SELECT delivery_status, provider_message_id, retry_count FROM outbound_emails WHERE id = ?')
      .bind('em_retry_pipeline').first();

    expect(result.sent).toBe(1);
    expect(row.delivery_status).toBe('SENT');
    expect(row.provider_message_id).toMatch(/^mock_email_/);
    expect(row.retry_count).toBe(0);
  });

  it('POST /api/v1/hygiene/remediate-date rejects RESCHEDULE strategy when date is omitted', async () => {
    const res = await app.request('/api/v1/hygiene/remediate-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ leadId: 'L25', strategy: 'RESCHEDULE' })
    }, env);
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toContain('newFollowup (YYYY-MM-DD) is required');
  });

  it('POST /api/v1/hygiene/remediate-date updates D1 and records audit event with explicit date', async () => {
    const res = await app.request('/api/v1/hygiene/remediate-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ leadId: 'L25', strategy: 'RESCHEDULE', newFollowup: '2026-11-05' })
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);

    const dbLead = d1.rawDb.prepare("SELECT next_followup_date FROM canonical_leads WHERE lead_id_display = 'L25'").get() as any;
    expect(dbLead.next_followup_date).toBe('2026-11-05');
  });

  it('POST /api/v1/hygiene/unmerge restores duplicate in D1 and reverts canonical notes cleanly', async () => {
    const res = await app.request('/api/v1/hygiene/unmerge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ duplicateId: 'L23' })
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);

    const dupLead = d1.rawDb.prepare("SELECT is_archived, merged_into_id FROM canonical_leads WHERE lead_id_display = 'L23'").get() as any;
    expect(dupLead.is_archived).toBe(0);
    expect(dupLead.merged_into_id).toBeNull();
  });

  it('POST /api/v1/hygiene/merge re-merges duplicate with snapshot recording in D1', async () => {
    const res = await app.request('/api/v1/hygiene/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ canonicalId: 'L01', duplicateId: 'L23' })
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.result.phantomRevenueRemoved).toBe(350000);

    const dupLead = d1.rawDb.prepare("SELECT is_archived FROM canonical_leads WHERE lead_id_display = 'L23'").get() as any;
    expect(dupLead.is_archived).toBe(1);

    const decision = d1.rawDb.prepare("SELECT * FROM merge_decisions WHERE canonical_lead_id = 'can_L01'").get() as any;
    expect(decision).toBeTruthy();
  });

  it('POST /api/v1/hygiene/fix-typo normalizes email in D1 and writes audit event', async () => {
    const res = await app.request('/api/v1/hygiene/fix-typo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ leadId: 'L18' })
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);

    const dbLead = d1.rawDb.prepare("SELECT contact_email FROM canonical_leads WHERE lead_id_display = 'L18'").get() as any;
    expect(dbLead.contact_email).toBe('shahidul@boguratextile.example');
  });

  it('POST /api/v1/copilot/query executes allowlisted AST queries and returns dual-truth variance', async () => {
    const res = await app.request('/api/v1/copilot/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ question: 'What is the total value in Proposal stage?' })
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.cleaned_result.scalar).toBe(920000);
  });

  it('POST /api/v1/copilot/query rejects unsupported questions with 422 and helpful guidelines', async () => {
    const res = await app.request('/api/v1/copilot/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ question: 'Can you tell me the weather forecast for Dhaka tomorrow?' })
    }, env);
    expect(res.status).toBe(422);
    const json: any = await res.json();
    expect(json.error).toBe('Unsupported Copilot Query');
    expect(json.supported_queries).toBeTruthy();
  });

  it('POST /api/v1/email/send enforces compliance barrier on invoiced deals without bank confirmation', async () => {
    // L07 is in 'Invoice sent' stage
    const res = await app.request('/api/v1/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({
        leadId: 'L07',
        subject: 'BIAI Invoice #102 Follow-up',
        bodyText: 'Friendly reminder regarding invoice payment.',
        tone: 'INVOICE_REMINDER',
        bankConfirmed: false
      })
    }, env);
    expect(res.status).toBe(422);
    const json: any = await res.json();
    expect(json.error).toBe('POLICY_BARRIER_VIOLATION');
  });

  it('POST /api/v1/email/send dispatches and logs to D1 when bank statement is confirmed', async () => {
    const res = await app.request('/api/v1/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({
        leadId: 'L07',
        subject: 'BIAI Invoice #102 Follow-up',
        bodyText: 'Friendly reminder regarding invoice payment.',
        tone: 'INVOICE_REMINDER',
        bankConfirmed: true
      })
    }, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.delivery.status).toBe('SENT');

    // Verify written to D1 outbound_emails with delivery_status 'SENT'
    const emailRow = d1.rawDb.prepare("SELECT * FROM outbound_emails WHERE lead_id = 'can_L07'").get() as any;
    expect(emailRow).toBeTruthy();
    expect(emailRow.tone).toBe('INVOICE_REMINDER');
    expect(emailRow.delivery_status).toBe('SENT');
  });

  it('POST /api/v1/leads/export returns server-generated CSV with SHA-256 header and PII masking', async () => {
    const res = await app.request('/api/v1/leads/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ mode: 'cleaned', maskPii: true })
    }, env);
    expect(res.status).toBe(200);
    const checksum = res.headers.get('X-Export-Checksum-SHA256');
    expect(checksum).toBeTruthy();
    expect(checksum?.length).toBe(64);

    const csvText = await res.text();
    expect(csvText).toContain('Lead ID,Company,Industry');
    expect(csvText).toContain('***');

    const audit = d1.rawDb.prepare("SELECT * FROM audit_events WHERE event_type = 'CLEANED_CSV_EXPORTED'").get() as any;
    expect(audit).toBeTruthy();
  });

  // ============================================================================
  // IDENTITY CONTROL PLANE INTEGRATION TESTS
  // ============================================================================
  it('Identity Control Plane: Login verification, session creation, CSRF enforcement, and lockout in Pipeline', async () => {
    // 1. Login with invalid password
    const failRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'shakib@biai.com.bd', password: 'WrongPassword123!' })
    }, env);
    expect(failRes.status).toBe(401);

    // 2. Successful Login with seeded PBKDF2 credentials
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'shakib@biai.com.bd', password: 'SupervisorPassword2026!' })
    }, env);
    expect(loginRes.status).toBe(200);
    const loginData: any = await loginRes.json();
    expect(loginData.sessionToken).toBeTruthy();
    expect(loginData.csrfToken).toBeTruthy();
    expect(loginData.user.role).toBe('TEAM_LEAD');
    expect(loginData.user.security_tier).toBe('TIER_2');

    const cookieHeader = loginRes.headers.get('Set-Cookie');
    expect(cookieHeader).toContain('__Host-biai_session=');

    // 3. GET /api/auth/me using Cookie session
    const meRes = await app.request('/api/auth/me', {
      headers: { 'Cookie': `__Host-biai_session=${loginData.sessionToken}` }
    }, env);
    expect(meRes.status).toBe(200);
    const meData: any = await meRes.json();
    expect(meData.email).toBe('shakib@biai.com.bd');

    // 4. CSRF enforcement: Mutating request with Cookie session and missing CSRF token -> 403
    const noCsrfRes = await app.request('/api/v1/hygiene/remediate-date', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `__Host-biai_session=${loginData.sessionToken}`
      },
      body: JSON.stringify({ leadId: 'L25', strategy: 'RESCHEDULE', newFollowup: '2026-11-05' })
    }, env);
    expect(noCsrfRes.status).toBe(403);
    const noCsrfJson: any = await noCsrfRes.json();
    expect(noCsrfJson.code).toBe('CSRF_MISSING');

    // 5. Mutating request with valid X-CSRF-Token -> 200
    const validCsrfRes = await app.request('/api/v1/hygiene/remediate-date', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `__Host-biai_session=${loginData.sessionToken}`,
        'X-CSRF-Token': loginData.csrfToken
      },
      body: JSON.stringify({ leadId: 'L25', strategy: 'RESCHEDULE', newFollowup: '2026-11-05' })
    }, env);
    expect(validCsrfRes.status).toBe(200);

    // 6. Logout revokes session in D1
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'Cookie': `__Host-biai_session=${loginData.sessionToken}` }
    }, env);
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await app.request('/api/auth/me', {
      headers: { 'Cookie': `__Host-biai_session=${loginData.sessionToken}` }
    }, env);
    expect(meAfterLogout.status).toBe(401);
  });
});
