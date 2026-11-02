import { describe, it, expect } from 'vitest';
import app from '../src/server/index.ts';

describe('BIAI Task 2 Pipeline — API Security, Financial Trust & D1 Mutations', () => {
  it('GET /api/health returns healthy system status and benchmark date', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe('healthy');
    expect(json.benchmark_date).toBe('2026-11-01');
  });

  it('GET /api/v1/leads strictly reconciles Cleaned Mode (23 leads, 3.17M value, 550k receivables)', async () => {
    const res = await app.request('/api/v1/leads?mode=cleaned');
    expect(res.status).toBe(200);
    const json: any = await res.json();

    expect(json.mode).toBe('cleaned');
    expect(json.total_leads).toBe(23);
    // 3,170,000 BDT Contracted Value (excluding Lost)
    expect(json.total_deal_value_bdt).toBe(3170000);
    // 150,000 BDT Cash Collected (L12 advance)
    expect(json.cash_collected_bdt).toBe(150000);
    // 550,000 BDT Outstanding Receivables (L07: 250k, L22: 150k, L12: 150k)
    // Never mixes uncontracted proposals into receivables!
    expect(json.outstanding_due_bdt).toBe(550000);
  });

  it('GET /api/v1/leads strictly reconciles Raw Mode (25 leads, 4.22M value)', async () => {
    const res = await app.request('/api/v1/leads?mode=raw');
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
    });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toContain('newFollowup (YYYY-MM-DD) is required');
  });

  it('POST /api/v1/hygiene/remediate-date succeeds with explicit new follow-up date', async () => {
    const res = await app.request('/api/v1/hygiene/remediate-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ leadId: 'L25', strategy: 'RESCHEDULE', newFollowup: '2026-11-05' })
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
  });

  it('POST /api/v1/hygiene/unmerge restores duplicate and reverts canonical notes cleanly', async () => {
    const res = await app.request('/api/v1/hygiene/unmerge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ duplicateId: 'L23' })
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
  });

  it('POST /api/v1/hygiene/merge re-merges duplicate with snapshot recording', async () => {
    const res = await app.request('/api/v1/hygiene/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ canonicalId: 'L01', duplicateId: 'L23' })
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.result.phantomRevenueRemoved).toBe(350000);
  });

  it('POST /api/v1/copilot/query executes allowlisted AST queries and returns dual-truth variance', async () => {
    const res = await app.request('/api/v1/copilot/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What is the total value in Proposal stage?' })
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.cleaned_result.scalar).toBe(920000);
  });

  it('POST /api/v1/leads/:id/stage transitions corporate stage', async () => {
    const res = await app.request('/api/v1/leads/L01/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer mgr-token' },
      body: JSON.stringify({ stage: 'Proposal' })
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
  });

  it('POST /api/v1/copilot/query rejects unsupported questions with 422 and helpful guidelines', async () => {
    const res = await app.request('/api/v1/copilot/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Can you tell me the weather forecast for Dhaka tomorrow?' })
    });
    expect(res.status).toBe(422);
    const json: any = await res.json();
    expect(json.error).toBe('Unsupported Copilot Query');
    expect(json.supported_queries).toBeTruthy();
  });
});
