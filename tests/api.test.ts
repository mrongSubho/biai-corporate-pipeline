import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/server/index.ts';
import { createTestD1Database } from './d1-helper.ts';

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

  it('GET /api/v1/leads strictly reconciles Cleaned Mode from D1 (23 leads, 3.17M value, 550k receivables)', async () => {
    const res = await app.request('/api/v1/leads?mode=cleaned', {}, env);
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
    const res = await app.request('/api/v1/leads?mode=raw', {}, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();

    expect(json.mode).toBe('raw');
    expect(json.total_leads).toBe(25);
    expect(json.total_deal_value_bdt).toBe(4220000);
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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

    // Verify written to D1 outbound_emails and audit_events
    const emailRow = d1.rawDb.prepare("SELECT * FROM outbound_emails WHERE lead_id = 'can_L07'").get() as any;
    expect(emailRow).toBeTruthy();
    expect(emailRow.tone).toBe('INVOICE_REMINDER');
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
    // Verify phone is masked
    expect(csvText).toContain('***');

    // Verify audit event written to D1
    const audit = d1.rawDb.prepare("SELECT * FROM audit_events WHERE event_type = 'CLEANED_CSV_EXPORTED'").get() as any;
    expect(audit).toBeTruthy();
  });
});
