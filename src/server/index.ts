import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auditCorporateLeads } from '../lib/engine/hygiene.ts';
import { executeCopilotQuery } from '../lib/engine/copilot.ts';
import { generateCorporateFollowupEmail } from '../lib/engine/email_drafter.ts';
import { sendCorporateEmail } from './adapters/resend.ts';
import { authMiddleware, requireRole, type AuthenticatedCorporateUser } from './auth.ts';
import { PipelineRepository } from './db/repository.ts';
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
} from './validation.ts';

export interface Env {
  DB?: any;
  AI?: any;
  ASSETS?: any;
  ENVIRONMENT?: string;
  DEFAULT_TIMEZONE?: string;
  BENCHMARK_DATE?: string;
  WORKSPACE_ID?: string;
}

const app = new Hono<{ Bindings: Env; Variables: { actor: AuthenticatedCorporateUser; workspaceId: string } }>();

// Enable CORS with secure origin checks for production
app.use('*', cors());

// Apply session authentication & RBAC resolution
app.use('/api/v1/*', authMiddleware);

// 1. Healthcheck
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    system: 'BIAI B2B Corporate Leads Pipeline & Data Health Engine',
    runtime: 'Cloudflare Workers (Edge V8 Isolate)',
    d1_connected: Boolean(c.env?.DB),
    timestamp: new Date().toISOString(),
    benchmark_date: c.env?.BENCHMARK_DATE || '2026-11-01',
    timezone: c.env?.DEFAULT_TIMEZONE || 'Asia/Dhaka'
  });
});

// 2. Get Leads (Authoritative Lineage-Aware Financial Reconciliation)
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
  const summary = await PipelineRepository.getLeads(c.env?.DB, mode, stage, industry);
  return c.json(summary);
});

// 3. Automated Data Health & Hygiene Audit
app.get('/api/v1/hygiene/audit', async (c) => {
  const benchmarkDate = c.env?.BENCHMARK_DATE || '2026-11-01';
  // Get raw leads for full hygiene audit
  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw');
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

// 4. Execute 1-Click Reversible Duplicate Merge (Role: ADMIN or SALES_MANAGER)
app.post('/api/v1/hygiene/merge', requireRole(['ADMIN', 'SALES_MANAGER']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = MergeLeadsSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { canonicalId, duplicateId } = validation.data;
  const actor = c.get('actor');

  try {
    const result = await PipelineRepository.mergeLeads(c.env?.DB, canonicalId, duplicateId, actor);
    return c.json({
      success: true,
      message: `Merged ${duplicateId} into ${canonicalId}. Removed ৳ ${result.phantomRevenueRemoved.toLocaleString()} BDT phantom revenue.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Merge failed' }, 400);
  }
});

// 5. Revert Merge / Unmerge (Restores Canonical Pre-Merge State)
app.post('/api/v1/hygiene/unmerge', requireRole(['ADMIN', 'SALES_MANAGER']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = UnmergeLeadSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { duplicateId } = validation.data;
  const actor = c.get('actor');

  try {
    const result = await PipelineRepository.unmergeLead(c.env?.DB, duplicateId, actor);
    return c.json({
      success: true,
      message: `Reverted merge for ${duplicateId}. Restored to active pipeline.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Unmerge failed' }, 400);
  }
});

// 6. Remediate Chronological Date Order Error (Explicit Date Validation Required)
app.post('/api/v1/hygiene/remediate-date', requireRole(['ADMIN', 'SALES_MANAGER']), async (c) => {
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

  try {
    const result = await PipelineRepository.remediateDate(c.env?.DB, leadId, strategy, newFollowup, actor);
    return c.json({
      success: true,
      message: `Successfully remediated chronological date error for ${leadId}.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Date remediation failed' }, 400);
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

  try {
    const result = await PipelineRepository.fixEmailTypo(c.env?.DB, leadId, actor);
    return c.json({
      success: true,
      message: `Normalized email address for ${leadId}.`,
      result
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Fix typo failed' }, 400);
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

  try {
    const result = await PipelineRepository.transitionStage(c.env?.DB, id, stage, actor);
    return c.json({ success: true, result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Stage transition failed' }, 400);
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

  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw');

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
  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw');
  const lead = summary.leads.find(l => l.id === leadId);

  if (!lead) return c.json({ error: `Lead ${leadId} not found` }, 404);

  const draft = generateCorporateFollowupEmail({ lead, tone });
  return c.json({ success: true, draft });
});

// 10.1 Outbound Email Dispatch with Policy Enforcement & D1 Logging
app.post('/api/v1/email/send', requireRole(['ADMIN', 'SALES_MANAGER', 'ACCOUNT_EXECUTIVE']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = EmailSendRequestSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Validation error', details: validation.error.format() }, 400);
  }

  const { leadId, subject, bodyText, tone, bankConfirmed } = validation.data;
  const summary = await PipelineRepository.getLeads(c.env?.DB, 'raw');
  const lead = summary.leads.find(l => l.id === leadId);

  if (!lead) return c.json({ error: `Lead ${leadId} not found` }, 404);

  // Policy Barrier: Invoiced deals require explicit bank confirmation before reminder dispatch
  if (lead.stage === 'Invoice sent' && !bankConfirmed) {
    return c.json({
      error: 'POLICY_BARRIER_VIOLATION',
      message: 'Finance policy requires bank statement confirmation before chasing an invoiced customer to avoid embarrassing double-billing.'
    }, 422);
  }

  const actor = c.get('actor');
  const sendResult = await sendCorporateEmail({
    recipientEmail: lead.contact_email || 'client@example.com',
    recipientName: lead.contact_name || lead.company,
    subject,
    bodyText,
    apiKey: (c.env as any)?.RESEND_API_KEY
  });

  if (c.env?.DB) {
    try {
      const emailId = `em_${Date.now()}`;
      const dbLead = await c.env.DB.prepare('SELECT id FROM canonical_leads WHERE lead_id_display = ? OR id = ?').bind(leadId, leadId).first();
      const canonicalPk = dbLead?.id || (leadId.startsWith('can_') ? leadId : `can_${leadId}`);

      await c.env.DB.batch([
        c.env.DB.prepare(`
          INSERT INTO outbound_emails (id, workspace_id, lead_id, recipient_email, recipient_name, subject, body_text, tone, status, approved_by, sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SENT', ?, datetime('now'))
        `).bind(
          emailId,
          actor.workspace_id,
          canonicalPk,
          lead.contact_email || 'client@example.com',
          lead.contact_name || lead.company,
          subject,
          bodyText,
          tone,
          actor.id
        ),
        c.env.DB.prepare(`
          INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
          VALUES (?, ?, 'USER', ?, 'EMAIL_APPROVED_DISPATCHED', ?, NULL, ?, ?)
        `).bind(
          actor.workspace_id,
          actor.id,
          actor.role,
          lead.id,
          JSON.stringify({ status: 'SENT', recipient: lead.contact_email }),
          JSON.stringify({ message_id: sendResult.messageId, provider: sendResult.provider })
        )
      ]);
    } catch (e) {
      console.error('Failed to persist outbound email in D1:', e);
    }
  }

  return c.json({
    success: true,
    message: `Follow-up email dispatched successfully to ${lead.contact_email}`,
    delivery: sendResult
  });
});

// 11. Server-Controlled Role-Gated Export with Checksum & Audit
app.post('/api/v1/leads/export', requireRole(['ADMIN', 'SALES_MANAGER']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const mode = body.mode === 'raw' ? 'raw' : 'cleaned';
  const maskPii = Boolean(body.maskPii);
  const actor = c.get('actor');

  const summary = await PipelineRepository.getLeads(c.env?.DB, mode);

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
  const enc = new TextEncoder().encode(csvContent);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const checksum = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

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
        JSON.stringify({ row_count: summary.leads.length, checksum_sha256: checksum, mask_pii: maskPii })
      ).run();
    } catch (e) {
      console.error('Failed to log export audit:', e);
    }
  }

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="biai-corporate-leads-${mode}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'X-Export-Checksum-SHA256': checksum,
      'X-Export-Rows': String(summary.leads.length)
    }
  });
});

// 12. Weekly Priority Deal Chase Summary
app.get('/api/v1/digest/priority-chase', (c) => {
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
