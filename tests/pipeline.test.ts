import { describe, it, expect } from 'vitest';
import { rawCorporateLeadsFixture } from '../src/server/fixtures.ts';
import { auditCorporateLeads, normalizeCompanyName } from '../src/lib/engine/hygiene.ts';
import { interpretNaturalLanguageQuery, executeCopilotQuery } from '../src/lib/engine/copilot.ts';
import { generateCorporateFollowupEmail } from '../src/lib/engine/email_drafter.ts';

describe('Corporate Leads Programmatic Reconciliation', () => {
  it('loads exactly 25 leads from fixture', () => {
    expect(rawCorporateLeadsFixture.length).toBe(25);
  });

  it('verifies exact raw stage distribution', () => {
    const stages: Record<string, number> = {};
    for (const lead of rawCorporateLeadsFixture) {
      stages[lead.stage] = (stages[lead.stage] || 0) + 1;
    }

    expect(stages['New']).toBe(3);
    expect(stages['Contacted']).toBe(8); // Mathematically verified 8 (L04, L06, L11, L13, L15, L20, L21, L25)
    expect(stages['Meeting']).toBe(6);
    expect(stages['Proposal']).toBe(3);
    expect(stages['Invoice sent']).toBe(2);
    expect(stages['Paid']).toBe(1);
    expect(stages['Lost']).toBe(2);

    expect(3 + 8 + 6 + 3 + 2 + 1 + 2).toBe(25);
  });

  it('verifies raw total deal value is 4,220,000 BDT', () => {
    const totalRaw = rawCorporateLeadsFixture.reduce((sum, l) => sum + l.deal_value_bdt, 0);
    expect(totalRaw).toBe(4220000);
  });
});

describe('Automated Hygiene & Anomaly Engine', () => {
  const audit = auditCorporateLeads(rawCorporateLeadsFixture, '2026-11-01');

  it('detects both duplicate clusters (L01/L23 and L02/L03)', () => {
    const dupFindings = audit.findings.filter(f => f.rule_code === 'DUPLICATE_COMPANY_CONTACT');
    expect(dupFindings.length).toBe(2);
    const dupLeadIds = dupFindings.map(f => f.lead_id);
    expect(dupLeadIds).toContain('L23'); // Padma Textiles duplicate
    expect(dupLeadIds).toContain('L03'); // Meghna Pharmaceuticals duplicate
  });

  it('detects chronological date order inversion on L25 (Sylhet Hospitality)', () => {
    const dateFinding = audit.findings.find(f => f.rule_code === 'CHRONOLOGICAL_DATE_INVERSION');
    expect(dateFinding).toBeDefined();
    expect(dateFinding?.lead_id).toBe('L25');
  });

  it('detects missing contact identity on L24 and missing phone on L06', () => {
    const missingId = audit.findings.find(f => f.rule_code === 'MISSING_CONTACT_IDENTITY');
    expect(missingId?.lead_id).toBe('L24');

    const missingPhone = audit.findings.find(f => f.rule_code === 'MISSING_PHONE');
    expect(missingPhone?.lead_id).toBe('L06');
  });

  it('detects email typo warning on L18 (Bogura Textile Mills)', () => {
    const typoFinding = audit.findings.find(f => f.rule_code === 'EMAIL_TYPO_WARNING');
    expect(typoFinding?.lead_id).toBe('L18');
  });

  it('detects stage partial payment anomaly on L12 (Eastern Cable)', () => {
    const partialPay = audit.findings.find(f => f.rule_code === 'STAGE_PARTIAL_PAYMENT_DISCREPANCY');
    expect(partialPay?.lead_id).toBe('L12');
  });

  it('detects exactly 9 overdue follow-ups strictly before 2026-11-01', () => {
    const overdueFindings = audit.findings.filter(f => f.rule_code === 'OVERDUE_FOLLOWUP');
    expect(overdueFindings.length).toBe(9);
    const overdueIds = overdueFindings.map(f => f.lead_id);
    // Verified 9 overdue IDs
    expect(overdueIds).toEqual(
      expect.arrayContaining(['L04', 'L06', 'L10', 'L13', 'L15', 'L19', 'L20', 'L22', 'L25'])
    );
  });

  it('detects L09 as Due Today on 2026-11-01', () => {
    const dueToday = audit.findings.find(f => f.rule_code === 'DUE_TODAY');
    expect(dueToday?.lead_id).toBe('L09');
  });
});

describe('Safe Natural Language Deal Copilot (AST Compiler)', () => {
  it('correctly compiles "What is the total value in Proposal stage?" and reports dual-truth variance', () => {
    // When L03 is marked archived (merged)
    const cleanedLeads = rawCorporateLeadsFixture.map(l => l.id === 'L03' || l.id === 'L23' ? { ...l, is_archived: true } : l);
    const res = executeCopilotQuery('What is the total value in Proposal stage?', cleanedLeads, '2026-11-01');

    expect(res.ast.intent).toBe('AGGREGATE');
    expect(res.ast.aggregation).toBe('SUM');
    expect(res.cleaned_result.scalar).toBe(920000); // Cleaned: 920k BDT (L02: 700k, L14: 220k)
    expect(res.raw_variance?.raw_scalar).toBe(1620000); // Raw: 1.62M BDT
    expect(res.raw_variance?.phantom_value_removed_bdt).toBe(700000); // 700k phantom duplicate L03 removed
  });

  it('correctly compiles "Which deals are overdue?" into filtered list', () => {
    const cleanedLeads = rawCorporateLeadsFixture.map(l => l.id === 'L03' || l.id === 'L23' ? { ...l, is_archived: true } : l);
    const res = executeCopilotQuery('Which deals are overdue?', cleanedLeads, '2026-11-01');

    expect(res.ast.intent).toBe('FILTER_LIST');
    expect(res.cleaned_result.leads.length).toBe(9);
  });

  it('correctly filters Garments and Pharma leads', () => {
    const res = executeCopilotQuery('Show me all garment and pharma leads', rawCorporateLeadsFixture, '2026-11-01');
    expect(res.cleaned_result.leads.every(l => l.industry === 'Garments' || l.industry === 'Pharma')).toBe(true);
  });
});

describe('Context-Aware AI Follow-up Email Drafter', () => {
  it('enforces DO_NOT_CONTACT policy barrier on L16 (Sundarban Shipping)', () => {
    const lead16 = rawCorporateLeadsFixture.find(l => l.id === 'L16')!;
    const res = generateCorporateFollowupEmail({ lead: lead16 });

    expect(res.isBlocked).toBe(true);
    expect(res.barrierReason).toContain('DO NOT CONTACT');
  });

  it('mandates bank statement verification on L22 (Khulna Jute Works)', () => {
    const lead22 = rawCorporateLeadsFixture.find(l => l.id === 'L22')!;
    const res = generateCorporateFollowupEmail({ lead: lead22, tone: 'INVOICE_REMINDER' });

    expect(res.isBlocked).toBe(false);
    expect(res.requiresBankChecklist).toBe(true);
    expect(res.warnings).toContain('Bank statement reconciliation required before sending invoice chase email.');
  });

  it('normalizes email domain typo on L18 (Bogura Textile Mills)', () => {
    const lead18 = rawCorporateLeadsFixture.find(l => l.id === 'L18')!;
    const res = generateCorporateFollowupEmail({ lead: lead18 });

    expect(res.recipientEmail).toBe('shahidul@boguratextile.example');
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});
