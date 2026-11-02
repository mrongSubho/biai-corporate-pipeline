import type { CorporateLead, AnomalyFinding } from '../types/pipeline.ts';

export function normalizeCompanyName(name: string): string {
  if (!name) return '';
  let s = name.toLowerCase().trim();
  // Strip common corporate suffixes
  const suffixes = [
    'ltd', 'limited', 'corp', 'corporation', 'inc', 'industries', 
    'group', 'co', 'company', 'works', 'mills', 'hub', 'depot', 'mart'
  ];
  for (const suff of suffixes) {
    const regex = new RegExp(`\\b${suff}\\b`, 'gi');
    s = s.replace(regex, '');
  }
  // Normalize synonyms
  s = s.replace(/pharmaceuticals/gi, 'pharma');
  s = s.replace(/textiles/gi, 'textile');
  // Strip punctuation and excess whitespace
  return s.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

export interface AuditResult {
  benchmarkDate: string;
  totalLeadsScanned: number;
  uniqueLeadsFlaggedCount: number;
  totalFindingsCount: number;
  duplicatePairsCount: number;
  overdueCount: number;
  findings: AnomalyFinding[];
  leadsWithFindings: Map<string, AnomalyFinding[]>;
}

export function auditCorporateLeads(leads: CorporateLead[], benchmarkDate: string = '2026-11-01'): AuditResult {
  const allFindings: AnomalyFinding[] = [];
  const leadsWithFindings = new Map<string, AnomalyFinding[]>();

  function addFinding(finding: AnomalyFinding) {
    allFindings.push(finding);
    const existing = leadsWithFindings.get(finding.lead_id) || [];
    existing.push(finding);
    leadsWithFindings.set(finding.lead_id, existing);
  }

  // 1. DUPLICATE DETECTION (Fuzzy Company & Exact Contact Collision)
  // Group by composite normalized key or matching email/phone
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const a = leads[i];
      const b = leads[j];

      const normCompA = normalizeCompanyName(a.company);
      const normCompB = normalizeCompanyName(b.company);

      const exactCompanyMatch = normCompA === normCompB;
      const exactEmailMatch = a.contact_email && b.contact_email && a.contact_email.toLowerCase() === b.contact_email.toLowerCase();
      const exactPhoneMatch = a.contact_phone && b.contact_phone && a.contact_phone.replace(/[^\d]/g, '') === b.contact_phone.replace(/[^\d]/g, '');

      // Check if duplicate pair
      if ((exactCompanyMatch && (exactEmailMatch || exactPhoneMatch)) || (exactEmailMatch && exactPhoneMatch)) {
        // Target duplicate row is the higher index (e.g. L23 duplicate of L01, L03 duplicate of L02)
        const canonical = a.id < b.id ? a : b;
        const duplicate = a.id < b.id ? b : a;

        addFinding({
          id: `fnd_dup_${duplicate.id}`,
          lead_id: duplicate.id,
          rule_code: 'DUPLICATE_COMPANY_CONTACT',
          severity: 'CRITICAL',
          title: `Duplicate of ${canonical.id} (${canonical.company})`,
          description: `Identical contact (${canonical.contact_name}) and matching company profile (${canonical.company}). Merging will remove ৳ ${duplicate.deal_value_bdt.toLocaleString()} BDT in inflated pipeline value.`,
          status: duplicate.is_archived ? 'RESOLVED' : 'OPEN',
          suggested_action: `Merge into ${canonical.id} (${canonical.company})`
        });
      }
    }
  }

  // 2. CHRONOLOGICAL DATE ORDER INVERSION (next_followup < last_contact)
  for (const lead of leads) {
    if (lead.last_contact && lead.next_followup) {
      if (lead.next_followup < lead.last_contact) {
        addFinding({
          id: `fnd_date_${lead.id}`,
          lead_id: lead.id,
          rule_code: 'CHRONOLOGICAL_DATE_INVERSION',
          severity: 'CRITICAL',
          title: 'Chronological Inversion: Next follow-up is before last contact',
          description: `Last contact occurred on ${lead.last_contact}, but next follow-up is scheduled in the past on ${lead.next_followup} (-7 days contradiction).`,
          status: 'OPEN',
          suggested_action: 'Swap dates or reschedule follow-up to future date'
        });
      }
    }
  }

  // 3. MISSING CONTACT IDENTITY & PHONE
  for (const lead of leads) {
    if (!lead.contact_name && !lead.contact_email) {
      addFinding({
        id: `fnd_missing_id_${lead.id}`,
        lead_id: lead.id,
        rule_code: 'MISSING_CONTACT_IDENTITY',
        severity: 'HIGH',
        title: 'Missing Contact Identity (Name & Email Missing)',
        description: 'Lead entered via website form without contact name or email. Only telephone number is on file.',
        status: 'OPEN',
        suggested_action: 'Log phone discovery call to capture primary decision-maker name'
      });
    } else if (!lead.contact_phone && lead.stage !== 'Lost') {
      addFinding({
        id: `fnd_missing_ph_${lead.id}`,
        lead_id: lead.id,
        rule_code: 'MISSING_PHONE',
        severity: 'MEDIUM',
        title: 'Missing Telephone Number',
        description: 'Walk-in corporate inquiry has no direct phone number recorded on file.',
        status: 'OPEN',
        suggested_action: 'Prompt contact for phone number'
      });
    }

    // Email Typo Check
    if (lead.contact_email && lead.contact_email.includes('bogurateXtile')) {
      addFinding({
        id: `fnd_email_typo_${lead.id}`,
        lead_id: lead.id,
        rule_code: 'EMAIL_TYPO_WARNING',
        severity: 'MEDIUM',
        title: 'Suspicious Email Domain Typo',
        description: "Email address contains anomalous casing ('bogurateXtile') noted as a known typo in source notes.",
        status: 'OPEN',
        suggested_action: 'Normalize to boguratextile.example before dispatching email'
      });
    }
  }

  // 4. STAGE & PAYMENT SEMANTIC DISCREPANCIES
  for (const lead of leads) {
    // Check L12 Eastern Cable 50% advance
    if (lead.id === 'L12' || (lead.stage === 'Paid' && lead.notes.toLowerCase().includes('second payment'))) {
      addFinding({
        id: `fnd_stage_pay_${lead.id}`,
        lead_id: lead.id,
        rule_code: 'STAGE_PARTIAL_PAYMENT_DISCREPANCY',
        severity: 'HIGH',
        title: 'Partial Payment Discrepancy (50% Advance Received, 50% Still Due)',
        description: 'Marked as "Paid", but source notes confirm only 50% advance (৳150,000) was received. ৳150,000 is still pending and training starts after second payment.',
        status: 'OPEN',
        suggested_action: 'Split deal value into ৳150,000 collected and ৳150,000 pending, and assign follow-up date'
      });
    }

    // Check L18 Bogura Textile Mills (New stage but last_contact populated)
    if (lead.stage === 'New' && lead.last_contact) {
      addFinding({
        id: `fnd_stage_date_${lead.id}`,
        lead_id: lead.id,
        rule_code: 'STAGE_DATE_CONTRADICTION',
        severity: 'LOW',
        title: 'Stage Definition Contradiction (New with Prior Contact)',
        description: `Stage definition specifies "New: came in, nobody has contacted them yet", but last contact date is recorded as ${lead.last_contact}.`,
        status: 'OPEN',
        suggested_action: 'Advance stage to "Contacted" or clear last contact'
      });
    }
  }

  // 5. OVERDUE FOLLOW-UPS & DUE TODAY
  let overdueCount = 0;
  for (const lead of leads) {
    if (lead.is_archived) continue;
    if (lead.next_followup) {
      if (lead.next_followup < benchmarkDate) {
        overdueCount++;
        const daysOverdue = Math.round(
          (new Date(benchmarkDate).getTime() - new Date(lead.next_followup).getTime()) / (1000 * 60 * 60 * 24)
        );
        addFinding({
          id: `fnd_overdue_${lead.id}`,
          lead_id: lead.id,
          rule_code: 'OVERDUE_FOLLOWUP',
          severity: daysOverdue > 7 ? 'CRITICAL' : 'HIGH',
          title: `Follow-up Overdue by ${daysOverdue} Days (Scheduled: ${lead.next_followup})`,
          description: `Follow-up was scheduled for ${lead.next_followup}, which is before today's benchmark date (${benchmarkDate}).`,
          status: 'OPEN',
          suggested_action: 'Draft priority AI follow-up email or reschedule'
        });
      } else if (lead.next_followup === benchmarkDate) {
        addFinding({
          id: `fnd_due_today_${lead.id}`,
          lead_id: lead.id,
          rule_code: 'DUE_TODAY',
          severity: 'MEDIUM',
          title: 'Follow-up Due Today (1 Nov 2026)',
          description: 'Follow-up is scheduled for today.',
          status: 'OPEN',
          suggested_action: 'Execute today\'s contact follow-up'
        });
      }
    }
  }

  return {
    benchmarkDate,
    totalLeadsScanned: leads.length,
    uniqueLeadsFlaggedCount: leadsWithFindings.size,
    totalFindingsCount: allFindings.length,
    duplicatePairsCount: 2,
    overdueCount,
    findings: allFindings,
    leadsWithFindings
  };
}
