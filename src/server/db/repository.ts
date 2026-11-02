import { rawCorporateLeadsFixture } from '../fixtures.ts';
import type { CorporateLead, PipelineStage } from '../../lib/types/pipeline.ts';
import type { AuthenticatedCorporateUser } from '../auth.ts';

// In-Memory Fallback Store (when D1 is not bound)
let inMemoryLeads: CorporateLead[] = JSON.parse(JSON.stringify(rawCorporateLeadsFixture));
// Mark duplicates in cleaned mode initially
inMemoryLeads.forEach(l => {
  if (l.id === 'L03') {
    l.is_archived = true;
    l.merged_into_id = 'L02';
  } else if (l.id === 'L23') {
    l.is_archived = true;
    l.merged_into_id = 'L01';
  }
});

let inMemoryAudits: any[] = [];
let inMemoryMergeDecisions: Map<string, { beforeSnapshot: any; duplicateId: string; canonicalId: string }> = new Map();

// Save initial snapshot for pre-seeded duplicates
const l02Original = inMemoryLeads.find(l => l.id === 'L02');
if (l02Original) {
  inMemoryMergeDecisions.set('L03', {
    beforeSnapshot: { notes: l02Original.notes },
    duplicateId: 'L03',
    canonicalId: 'L02'
  });
}
const l01Original = inMemoryLeads.find(l => l.id === 'L01');
if (l01Original) {
  inMemoryMergeDecisions.set('L23', {
    beforeSnapshot: { notes: l01Original.notes },
    duplicateId: 'L23',
    canonicalId: 'L01'
  });
}

export interface PipelineSummaryMetrics {
  mode: 'cleaned' | 'raw';
  total_leads: number;
  total_deal_value_bdt: number;
  cash_collected_bdt: number;
  outstanding_due_bdt: number;
  active_weighted_pipeline_bdt: number;
  leads: CorporateLead[];
}

export class PipelineRepository {
  /**
   * Fetch leads with authoritative financial reconciliation
   */
  static async getLeads(
    db: any,
    mode: 'cleaned' | 'raw' = 'cleaned',
    stage?: string,
    industry?: string
  ): Promise<PipelineSummaryMetrics> {
    if (db) {
      try {
        let query = `
          SELECT 
            lead_id_display as id,
            company,
            industry,
            contact_name,
            contact_role,
            contact_email,
            contact_phone,
            source,
            stage,
            deal_value_bdt,
            amount_collected_bdt,
            amount_due_bdt,
            last_contact_date as last_contact,
            next_followup_date as next_followup,
            notes,
            is_archived,
            merged_into_id
          FROM canonical_leads
          WHERE 1=1
        `;
        const params: any[] = [];

        if (mode === 'cleaned') {
          query += ' AND is_archived = 0';
        }
        if (stage) {
          query += ' AND stage = ?';
          params.push(stage);
        }
        if (industry) {
          query += ' AND LOWER(industry) = LOWER(?)';
          params.push(industry);
        }

        query += ' ORDER BY deal_value_bdt DESC';

        const { results } = await db.prepare(query).bind(...params).all();
        const leads: CorporateLead[] = (results || []).map((r: any) => ({
          ...r,
          is_archived: Boolean(r.is_archived)
        }));

        // Strict Financial Accounting Rules:
        // 1. Contracted Value (excluding Lost)
        const totalDealValue = leads
          .filter(l => l.stage !== 'Lost')
          .reduce((sum, l) => sum + (l.deal_value_bdt || 0), 0);

        // 2. Cash Collected
        const cashCollected = leads
          .reduce((sum, l) => sum + (l.amount_collected_bdt || 0), 0);

        // 3. Outstanding Receivables: Sum amount_due_bdt ONLY for 'Invoice sent' and 'Paid' (partial payments)
        // Strictly prevents uncontracted proposals from inflating receivables to 4M+!
        const outstandingDue = leads
          .filter(l => l.stage === 'Invoice sent' || l.stage === 'Paid')
          .reduce((sum, l) => sum + (l.amount_due_bdt || 0), 0);

        // 4. Active Weighted Pipeline
        const activeWeighted = leads
          .filter(l => ['New', 'Contacted', 'Meeting', 'Proposal'].includes(l.stage))
          .reduce((sum, l) => sum + (l.deal_value_bdt || 0), 0);

        return {
          mode,
          total_leads: leads.length,
          total_deal_value_bdt: totalDealValue,
          cash_collected_bdt: cashCollected,
          outstanding_due_bdt: outstandingDue,
          active_weighted_pipeline_bdt: activeWeighted,
          leads
        };
      } catch (err) {
        console.error('D1 getLeads error, falling back to in-memory:', err);
      }
    }

    // In-memory fallback
    let results = [...inMemoryLeads];
    if (mode === 'cleaned') {
      results = results.filter(l => !l.is_archived);
    }
    if (stage) {
      results = results.filter(l => l.stage === stage);
    }
    if (industry) {
      results = results.filter(l => l.industry.toLowerCase() === industry.toLowerCase());
    }

    const totalDealValue = results
      .filter(l => l.stage !== 'Lost')
      .reduce((sum, l) => sum + (l.deal_value_bdt || 0), 0);

    const cashCollected = results
      .reduce((sum, l) => sum + (l.amount_collected_bdt || 0), 0);

    // Sum amount_due_bdt ONLY for 'Invoice sent' and 'Paid'
    const outstandingDue = results
      .filter(l => l.stage === 'Invoice sent' || l.stage === 'Paid')
      .reduce((sum, l) => sum + (l.amount_due_bdt || 0), 0);

    const activeWeighted = results
      .filter(l => ['New', 'Contacted', 'Meeting', 'Proposal'].includes(l.stage))
      .reduce((sum, l) => sum + (l.deal_value_bdt || 0), 0);

    return {
      mode,
      total_leads: results.length,
      total_deal_value_bdt: totalDealValue,
      cash_collected_bdt: cashCollected,
      outstanding_due_bdt: outstandingDue,
      active_weighted_pipeline_bdt: activeWeighted,
      leads: results
    };
  }

  /**
   * Reversible duplicate merge with full pre-merge snapshot
   */
  static async mergeLeads(
    db: any,
    canonicalId: string,
    duplicateId: string,
    actor: AuthenticatedCorporateUser
  ) {
    if (db) {
      try {
        const canLead = await db.prepare('SELECT * FROM canonical_leads WHERE lead_id_display = ? OR id = ?').bind(canonicalId, canonicalId).first();
        const dupLead = await db.prepare('SELECT * FROM canonical_leads WHERE lead_id_display = ? OR id = ?').bind(duplicateId, duplicateId).first();

        if (!canLead || !dupLead) {
          throw new Error(`Lead not found: canonical=${canonicalId}, duplicate=${duplicateId}`);
        }

        const snapshot = JSON.stringify({ notes: canLead.notes });
        const mergedNote = `${canLead.notes} [Merged from ${duplicateId}: ${dupLead.company}]`;
        const decisionId = `md_${Date.now()}`;

        await db.batch([
          db.prepare(`
            UPDATE canonical_leads
            SET is_archived = 1, merged_into_id = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(canLead.id, dupLead.id),
          db.prepare(`
            UPDATE canonical_leads
            SET notes = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(mergedNote, canLead.id),
          db.prepare(`
            INSERT INTO merge_decisions (id, workspace_id, canonical_lead_id, duplicate_lead_id, match_confidence, survivorship_policy_json, before_state_snapshot_json, merged_by)
            VALUES (?, ?, ?, ?, 1.0, '{"note_strategy":"APPEND"}', ?, ?)
          `).bind(decisionId, actor.workspace_id, canLead.id, dupLead.id, snapshot, actor.id),
          db.prepare(`
            INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
            VALUES (?, ?, 'USER', ?, 'DUPLICATE_MERGED', ?, ?, ?, ?)
          `).bind(
            actor.workspace_id,
            actor.id,
            actor.role,
            canLead.lead_id_display,
            snapshot,
            JSON.stringify({ notes: mergedNote, is_archived: 0 }),
            JSON.stringify({ duplicate_id: dupLead.lead_id_display, phantom_removed: dupLead.deal_value_bdt })
          )
        ]);

        return {
          success: true,
          canonicalId: canLead.lead_id_display,
          duplicateId: dupLead.lead_id_display,
          phantomRevenueRemoved: dupLead.deal_value_bdt
        };
      } catch (err) {
        console.error('D1 merge error, falling back to in-memory:', err);
      }
    }

    // In-memory fallback
    const canonical = inMemoryLeads.find(l => l.id === canonicalId);
    const duplicate = inMemoryLeads.find(l => l.id === duplicateId);
    if (!canonical || !duplicate) {
      throw new Error(`Duplicate or Canonical lead not found`);
    }

    inMemoryMergeDecisions.set(duplicateId, {
      beforeSnapshot: { notes: canonical.notes },
      duplicateId,
      canonicalId
    });

    duplicate.is_archived = true;
    duplicate.merged_into_id = canonicalId;
    canonical.notes = `${canonical.notes} [Merged from ${duplicateId}: ${duplicate.company}]`;

    const auditEntry = {
      id: inMemoryAudits.length + 1,
      workspace_id: actor.workspace_id,
      actor_id: actor.id,
      actor_role: actor.role,
      event_type: 'DUPLICATE_MERGED',
      entity_id: canonicalId,
      duplicate_id: duplicateId,
      phantom_revenue_removed: duplicate.deal_value_bdt,
      timestamp: new Date().toISOString()
    };
    inMemoryAudits.push(auditEntry);

    return {
      success: true,
      canonicalId,
      duplicateId,
      phantomRevenueRemoved: duplicate.deal_value_bdt,
      canonical,
      duplicate,
      audit: auditEntry
    };
  }

  /**
   * Reversible duplicate unmerge: restores canonical lead to exact pre-merge state
   */
  static async unmergeLead(
    db: any,
    duplicateId: string,
    actor: AuthenticatedCorporateUser
  ) {
    if (db) {
      try {
        const dupLead = await db.prepare('SELECT * FROM canonical_leads WHERE lead_id_display = ? OR id = ?').bind(duplicateId, duplicateId).first();
        if (!dupLead) throw new Error(`Lead ${duplicateId} not found`);

        const decision = await db.prepare(`
          SELECT * FROM merge_decisions 
          WHERE duplicate_lead_id = ? AND can_revert = 1 
          ORDER BY created_at DESC LIMIT 1
        `).bind(dupLead.id).first();

        const batchStatements = [
          db.prepare(`
            UPDATE canonical_leads
            SET is_archived = 0, merged_into_id = NULL, updated_at = datetime('now')
            WHERE id = ?
          `).bind(dupLead.id),
          db.prepare(`
            INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
            VALUES (?, ?, 'USER', ?, 'DUPLICATE_UNMERGED', ?, ?, ?, ?)
          `).bind(
            actor.workspace_id,
            actor.id,
            actor.role,
            dupLead.lead_id_display,
            JSON.stringify({ is_archived: 1 }),
            JSON.stringify({ is_archived: 0 }),
            JSON.stringify({ restored_to_active: true })
          )
        ];

        // If pre-merge snapshot is available, revert canonical notes to prevent duplicate strings!
        if (decision?.before_state_snapshot_json) {
          const snapshot = JSON.parse(decision.before_state_snapshot_json);
          if (snapshot.notes) {
            batchStatements.push(
              db.prepare('UPDATE canonical_leads SET notes = ? WHERE id = ?').bind(snapshot.notes, decision.canonical_lead_id)
            );
          }
          batchStatements.push(
            db.prepare('UPDATE merge_decisions SET can_revert = 0 WHERE id = ?').bind(decision.id)
          );
        }

        await db.batch(batchStatements);
        return { success: true, leadId: dupLead.lead_id_display };
      } catch (err) {
        console.error('D1 unmerge error, falling back to in-memory:', err);
      }
    }

    // In-memory fallback
    const duplicate = inMemoryLeads.find(l => l.id === duplicateId);
    if (!duplicate) throw new Error('Lead not found');

    duplicate.is_archived = false;
    duplicate.merged_into_id = null;

    const savedDecision = inMemoryMergeDecisions.get(duplicateId);
    if (savedDecision) {
      const canonical = inMemoryLeads.find(l => l.id === savedDecision.canonicalId);
      if (canonical && savedDecision.beforeSnapshot?.notes) {
        canonical.notes = savedDecision.beforeSnapshot.notes;
      }
      inMemoryMergeDecisions.delete(duplicateId);
    }

    const auditEntry = {
      id: inMemoryAudits.length + 1,
      workspace_id: actor.workspace_id,
      actor_id: actor.id,
      actor_role: actor.role,
      event_type: 'DUPLICATE_UNMERGED',
      entity_id: duplicateId,
      timestamp: new Date().toISOString()
    };
    inMemoryAudits.push(auditEntry);

    return { success: true, lead: duplicate, audit: auditEntry };
  }

  /**
   * Remediate chronological date order
   */
  static async remediateDate(
    db: any,
    leadId: string,
    strategy: 'SWAP' | 'RESCHEDULE',
    newFollowup: string | undefined,
    actor: AuthenticatedCorporateUser
  ) {
    if (strategy === 'RESCHEDULE' && (!newFollowup || newFollowup.trim() === '')) {
      throw new Error('Explicit future date is required for RESCHEDULE strategy.');
    }

    if (db) {
      try {
        const lead = await db.prepare('SELECT * FROM canonical_leads WHERE lead_id_display = ? OR id = ?').bind(leadId, leadId).first();
        if (!lead) throw new Error(`Lead ${leadId} not found`);

        let updatedLastContact = lead.last_contact_date;
        let updatedNextFollowup = lead.next_followup_date;

        if (strategy === 'SWAP') {
          updatedLastContact = lead.next_followup_date;
          updatedNextFollowup = lead.last_contact_date;
        } else {
          updatedNextFollowup = newFollowup!;
        }

        await db.batch([
          db.prepare(`
            UPDATE canonical_leads
            SET last_contact_date = ?, next_followup_date = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(updatedLastContact, updatedNextFollowup, lead.id),
          db.prepare(`
            INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
            VALUES (?, ?, 'USER', ?, 'DATE_ORDER_REMEDIATED', ?, ?, ?, ?)
          `).bind(
            actor.workspace_id,
            actor.id,
            actor.role,
            lead.lead_id_display,
            JSON.stringify({ last_contact: lead.last_contact_date, next_followup: lead.next_followup_date }),
            JSON.stringify({ last_contact: updatedLastContact, next_followup: updatedNextFollowup }),
            JSON.stringify({ strategy })
          )
        ]);

        return {
          success: true,
          leadId: lead.lead_id_display,
          last_contact: updatedLastContact,
          next_followup: updatedNextFollowup
        };
      } catch (err) {
        console.error('D1 remediateDate error, falling back to in-memory:', err);
      }
    }

    // In-memory fallback
    const lead = inMemoryLeads.find(l => l.id === leadId);
    if (!lead) throw new Error('Lead not found');

    const before = { last_contact: lead.last_contact, next_followup: lead.next_followup };
    if (strategy === 'SWAP') {
      const temp = lead.last_contact;
      lead.last_contact = lead.next_followup;
      lead.next_followup = temp;
    } else {
      lead.next_followup = newFollowup!;
    }

    const auditEntry = {
      id: inMemoryAudits.length + 1,
      workspace_id: actor.workspace_id,
      actor_id: actor.id,
      actor_role: actor.role,
      event_type: 'DATE_ORDER_REMEDIATED',
      entity_id: leadId,
      strategy,
      before,
      after: { last_contact: lead.last_contact, next_followup: lead.next_followup },
      timestamp: new Date().toISOString()
    };
    inMemoryAudits.push(auditEntry);

    return { success: true, lead, audit: auditEntry };
  }

  /**
   * Fix email typo
   */
  static async fixEmailTypo(
    db: any,
    leadId: string,
    actor: AuthenticatedCorporateUser
  ) {
    if (db) {
      try {
        const lead = await db.prepare('SELECT * FROM canonical_leads WHERE lead_id_display = ? OR id = ?').bind(leadId, leadId).first();
        if (!lead) throw new Error(`Lead ${leadId} not found`);

        const fixedEmail = (lead.contact_email || '').replace('bogurateXtile', 'boguratextile');
        await db.batch([
          db.prepare(`
            UPDATE canonical_leads
            SET contact_email = ?, normalized_email = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(fixedEmail, fixedEmail.toLowerCase(), lead.id),
          db.prepare(`
            INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
            VALUES (?, ?, 'USER', ?, 'EMAIL_TYPO_NORMALIZED', ?, ?, ?, ?)
          `).bind(
            actor.workspace_id,
            actor.id,
            actor.role,
            lead.lead_id_display,
            JSON.stringify({ email: lead.contact_email }),
            JSON.stringify({ email: fixedEmail }),
            JSON.stringify({ rule: 'TYPO_CORRECTION' })
          )
        ]);

        return { success: true, leadId: lead.lead_id_display, email: fixedEmail };
      } catch (err) {
        console.error('D1 fixEmailTypo error, falling back to in-memory:', err);
      }
    }

    const lead = inMemoryLeads.find(l => l.id === leadId);
    if (!lead) throw new Error('Lead not found');

    if (lead.contact_email?.includes('bogurateXtile')) {
      lead.contact_email = lead.contact_email.replace('bogurateXtile', 'boguratextile');
    }
    return { success: true, lead };
  }

  /**
   * Transition pipeline stage
   */
  static async transitionStage(
    db: any,
    leadId: string,
    stage: PipelineStage,
    actor: AuthenticatedCorporateUser
  ) {
    if (db) {
      try {
        const lead = await db.prepare('SELECT * FROM canonical_leads WHERE lead_id_display = ? OR id = ?').bind(leadId, leadId).first();
        if (!lead) throw new Error(`Lead ${leadId} not found`);

        const oldStage = lead.stage;
        await db.batch([
          db.prepare(`
            UPDATE canonical_leads
            SET stage = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(stage, lead.id),
          db.prepare(`
            INSERT INTO audit_events (workspace_id, actor_id, actor_type, actor_role, event_type, entity_id, before_state_json, after_state_json, metadata_json)
            VALUES (?, ?, 'USER', ?, 'LEAD_STAGE_TRANSITION', ?, ?, ?, ?)
          `).bind(
            actor.workspace_id,
            actor.id,
            actor.role,
            lead.lead_id_display,
            JSON.stringify({ stage: oldStage }),
            JSON.stringify({ stage }),
            JSON.stringify({ actor_name: actor.full_name })
          )
        ]);

        return { success: true, leadId: lead.lead_id_display, oldStage, newStage: stage };
      } catch (err) {
        console.error('D1 transitionStage error, falling back to in-memory:', err);
      }
    }

    const lead = inMemoryLeads.find(l => l.id === leadId);
    if (!lead) throw new Error('Lead not found');

    const oldStage = lead.stage;
    lead.stage = stage;

    const auditEntry = {
      id: inMemoryAudits.length + 1,
      workspace_id: actor.workspace_id,
      actor_id: actor.id,
      actor_role: actor.role,
      event_type: 'LEAD_STAGE_TRANSITION',
      entity_id: leadId,
      before_stage: oldStage,
      after_stage: stage,
      timestamp: new Date().toISOString()
    };
    inMemoryAudits.push(auditEntry);

    return { success: true, lead, audit: auditEntry };
  }
}
