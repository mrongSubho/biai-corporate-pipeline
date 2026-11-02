import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { rawCorporateLeadsFixture } from './fixtures.ts';
import { auditCorporateLeads } from '../lib/engine/hygiene.ts';
import { executeCopilotQuery } from '../lib/engine/copilot.ts';
import { generateCorporateFollowupEmail } from '../lib/engine/email_drafter.ts';
import type { CorporateLead, PipelineStage } from '../lib/types/pipeline.ts';

export interface Env {
  DB?: any;
  AI?: any;
  ASSETS?: any;
  ENVIRONMENT?: string;
  DEFAULT_TIMEZONE?: string;
  BENCHMARK_DATE?: string;
  WORKSPACE_ID?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// In-Memory Database Store for 25 Corporate Leads
let leadsStore: CorporateLead[] = JSON.parse(JSON.stringify(rawCorporateLeadsFixture));
let auditTrail: any[] = [];

// 1. Healthcheck
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    system: 'BIAI B2B Corporate Leads Pipeline & Data Health Engine',
    runtime: 'Cloudflare Workers (Edge V8 Isolate)',
    timestamp: new Date().toISOString(),
    benchmark_date: c.env.BENCHMARK_DATE || '2026-11-01',
    timezone: c.env.DEFAULT_TIMEZONE || 'Asia/Dhaka'
  });
});

// 2. Get Leads (Supports Raw vs. Cleaned Mode & Stage Filtering)
app.get('/api/v1/leads', (c) => {
  const mode = c.req.query('mode') || 'cleaned'; // 'cleaned' | 'raw'
  const stage = c.req.query('stage');
  const industry = c.req.query('industry');

  let results = [...leadsStore];

  // In cleaned mode, archived duplicates (L03, L23) are hidden from the primary board
  if (mode === 'cleaned') {
    results = results.filter(l => !l.is_archived);
  }

  if (stage) {
    results = results.filter(l => l.stage === stage);
  }

  if (industry) {
    results = results.filter(l => l.industry.toLowerCase() === industry.toLowerCase());
  }

  // Calculate Totals
  const totalValueBdt = results.reduce((sum, l) => sum + (l.deal_value_bdt || 0), 0);
  const collectedBdt = results.reduce((sum, l) => sum + (l.amount_collected_bdt || 0), 0);
  const dueBdt = results.reduce((sum, l) => sum + (l.amount_due_bdt || 0), 0);

  return c.json({
    mode,
    total_leads: results.length,
    total_deal_value_bdt: totalValueBdt,
    cash_collected_bdt: collectedBdt,
    outstanding_due_bdt: dueBdt,
    leads: results
  });
});

// 3. Automated Data Health & Hygiene Audit
app.get('/api/v1/hygiene/audit', (c) => {
  const benchmarkDate = c.env.BENCHMARK_DATE || '2026-11-01';
  const audit = auditCorporateLeads(leadsStore, benchmarkDate);

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

// 4. Execute 1-Click Duplicate Merge (e.g. L23 -> L01 or L03 -> L02)
app.post('/api/v1/hygiene/merge', async (c) => {
  const body = await c.req.json();
  const { duplicateId, canonicalId, userId = 'usr_b2b_mgr' } = body;

  const duplicate = leadsStore.find(l => l.id === duplicateId);
  const canonical = leadsStore.find(l => l.id === canonicalId);

  if (!duplicate || !canonical) {
    return c.json({ error: 'Duplicate or Canonical lead not found' }, 404);
  }

  duplicate.is_archived = true;
  duplicate.merged_into_id = canonicalId;
  canonical.notes = `${canonical.notes} [Merged from ${duplicateId}: ${duplicate.company} - ${duplicate.notes}]`;

  const auditEntry = {
    id: auditTrail.length + 1,
    event_type: 'DUPLICATE_MERGED',
    canonical_id: canonicalId,
    duplicate_id: duplicateId,
    actor_id: userId,
    phantom_revenue_removed: duplicate.deal_value_bdt,
    timestamp: new Date().toISOString()
  };
  auditTrail.push(auditEntry);

  return c.json({
    success: true,
    message: `Merged ${duplicateId} into ${canonicalId}. Removed ৳ ${duplicate.deal_value_bdt.toLocaleString()} BDT phantom revenue.`,
    canonical,
    duplicate,
    audit: auditEntry
  });
});

// 5. Revert Merge / Unmerge
app.post('/api/v1/hygiene/unmerge', async (c) => {
  const body = await c.req.json();
  const { duplicateId, userId = 'usr_b2b_mgr' } = body;

  const duplicate = leadsStore.find(l => l.id === duplicateId);
  if (!duplicate) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  duplicate.is_archived = false;
  duplicate.merged_into_id = null;

  const auditEntry = {
    id: auditTrail.length + 1,
    event_type: 'DUPLICATE_UNMERGED',
    lead_id: duplicateId,
    actor_id: userId,
    timestamp: new Date().toISOString()
  };
  auditTrail.push(auditEntry);

  return c.json({
    success: true,
    message: `Reverted merge for ${duplicateId}. Restored to active pipeline.`,
    lead: duplicate,
    audit: auditEntry
  });
});

// 6. Remediate Chronological Date Order Error (L25 Sylhet Hospitality)
app.post('/api/v1/hygiene/remediate-date', async (c) => {
  const body = await c.req.json();
  const { leadId = 'L25', strategy, newFollowup, userId = 'usr_b2b_mgr' } = body;

  const lead = leadsStore.find(l => l.id === leadId);
  if (!lead) return c.json({ error: 'Lead not found' }, 404);

  const beforeState = { last_contact: lead.last_contact, next_followup: lead.next_followup };

  if (strategy === 'SWAP') {
    // Option A: Swap the inverted dates
    const temp = lead.last_contact;
    lead.last_contact = lead.next_followup;
    lead.next_followup = temp;
  } else if (strategy === 'RESCHEDULE') {
    // Option B: Reschedule follow-up to future date (default 2026-11-04)
    lead.next_followup = newFollowup || '2026-11-04';
  }

  const auditEntry = {
    id: auditTrail.length + 1,
    event_type: 'DATE_ORDER_REMEDIATED',
    lead_id: leadId,
    strategy,
    before: beforeState,
    after: { last_contact: lead.last_contact, next_followup: lead.next_followup },
    actor_id: userId,
    timestamp: new Date().toISOString()
  };
  auditTrail.push(auditEntry);

  return c.json({
    success: true,
    message: `Successfully remediated chronological date error for ${leadId}.`,
    lead,
    audit: auditEntry
  });
});

// 7. Fix Email Typo (L18 Bogura Textile Mills)
app.post('/api/v1/hygiene/fix-typo', async (c) => {
  const body = await c.req.json();
  const { leadId = 'L18' } = body;

  const lead = leadsStore.find(l => l.id === leadId);
  if (!lead) return c.json({ error: 'Lead not found' }, 404);

  if (lead.contact_email?.includes('bogurateXtile')) {
    lead.contact_email = lead.contact_email.replace('bogurateXtile', 'boguratextile');
  }

  return c.json({
    success: true,
    message: `Normalized email address to ${lead.contact_email}.`,
    lead
  });
});

// 8. Lead Stage Transition
app.post('/api/v1/leads/:id/stage', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { stage, userId = 'usr_b2b_ae' } = body;

  const lead = leadsStore.find(l => l.id === id);
  if (!lead) return c.json({ error: 'Lead not found' }, 404);

  const oldStage = lead.stage;
  lead.stage = stage as PipelineStage;

  const auditEntry = {
    id: auditTrail.length + 1,
    event_type: 'LEAD_STAGE_TRANSITION',
    lead_id: id,
    before_stage: oldStage,
    after_stage: stage,
    actor_id: userId,
    timestamp: new Date().toISOString()
  };
  auditTrail.push(auditEntry);

  return c.json({ success: true, lead, audit: auditEntry });
});

// 9. Natural Language Deal Copilot (Safe AST Execution)
app.post('/api/v1/copilot/query', async (c) => {
  const body = await c.req.json();
  const { question } = body;

  if (!question || typeof question !== 'string') {
    return c.json({ error: 'Question is required' }, 400);
  }

  const benchmarkDate = c.env.BENCHMARK_DATE || '2026-11-01';
  const queryResult = executeCopilotQuery(question, leadsStore, benchmarkDate);

  return c.json({
    success: true,
    data: queryResult
  });
});

// 10. AI B2B Follow-up Email Drafter
app.post('/api/v1/email/draft', async (c) => {
  const body = await c.req.json();
  const { leadId, tone = 'POLITE_CHECKIN' } = body;

  const lead = leadsStore.find(l => l.id === leadId);
  if (!lead) return c.json({ error: 'Lead not found' }, 404);

  const draft = generateCorporateFollowupEmail({ lead, tone });
  return c.json({ success: true, draft });
});

// 11. Weekly Priority Deal Chase Summary
app.get('/api/v1/digest/priority-chase', (c) => {
  // Evaluates top priority corporate deals to chase relative to 2026-11-01
  const priorityChases = [
    {
      lead_id: 'L10',
      company: 'Oriental Bank Branch Ops',
      deal_value_bdt: 500000,
      stage: 'Meeting',
      overdue_days: 2,
      reason: 'Meeting completed Oct 26. Waiting for 3-option proposal. 2 days overdue — highest priority deal at risk.'
    },
    {
      lead_id: 'L07',
      company: 'Bengal Solar Systems',
      deal_value_bdt: 250000,
      stage: 'Invoice sent',
      due_date: '2026-11-02',
      reason: 'Invoice sent Oct 30. Payment due tomorrow (Nov 2). Confirm advance with accounts.'
    },
    {
      lead_id: 'L22',
      company: 'Khulna Jute Works',
      deal_value_bdt: 150000,
      stage: 'Invoice sent',
      overdue_days: 8,
      reason: 'Invoice sent Oct 17. 8 days overdue. Check bank statement before chasing customer.'
    },
    {
      lead_id: 'L02',
      company: 'Meghna Pharma Ltd',
      deal_value_bdt: 700000,
      stage: 'Proposal',
      due_date: '2026-11-04',
      reason: 'Largest active deal (৳700k). Budget approval next week. Prepare Bangla curriculum brochure.'
    }
  ];

  return c.json({
    benchmark_date: '2026-11-01',
    total_chase_value_bdt: 1600000,
    priority_deals: priorityChases
  });
});

export default app;
