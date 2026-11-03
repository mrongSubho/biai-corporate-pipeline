import { z } from 'zod';

export const PipelineStageEnum = z.enum([
  'New',
  'Contacted',
  'Meeting',
  'Proposal',
  'Invoice sent',
  'Paid',
  'Lost'
]);
export type PipelineStage = z.infer<typeof PipelineStageEnum>;

export const PaymentStatusEnum = z.enum([
  'UNPAID',
  'PARTIALLY_PAID',
  'FULLY_PAID',
  'OVERDUE'
]);
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;

export const AnomalySeverityEnum = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type AnomalySeverity = z.infer<typeof AnomalySeverityEnum>;

export const AnomalyRuleCodeEnum = z.enum([
  'DUPLICATE_COMPANY_CONTACT',
  'CHRONOLOGICAL_DATE_INVERSION',
  'MISSING_CONTACT_IDENTITY',
  'MISSING_PHONE',
  'EMAIL_TYPO_WARNING',
  'STAGE_PARTIAL_PAYMENT_DISCREPANCY',
  'STAGE_DATE_CONTRADICTION',
  'OVERDUE_FOLLOWUP',
  'DUE_TODAY'
]);
export type AnomalyRuleCode = z.infer<typeof AnomalyRuleCodeEnum>;

export interface CorporateLead {
  id: string; // e.g. 'L01'
  company: string;
  normalized_company: string;
  industry: string;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source: string;
  stage: PipelineStage;
  deal_value_bdt: number;
  amount_collected_bdt: number;
  amount_due_bdt: number;
  payment_status: PaymentStatus;
  last_contact: string | null;
  next_followup: string | null;
  notes: string;
  is_archived: boolean;
  merged_into_id?: string | null;
  assigned_to?: string | null;
  anomaly_count?: number;
  anomalies?: AnomalyFinding[];
}

export interface AnomalyFinding {
  id: string;
  lead_id: string;
  rule_code: AnomalyRuleCode;
  severity: AnomalySeverity;
  title: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  suggested_action: string;
}

// Strict Allowlisted AST Schema for Safe Copilot Queries
export const CopilotQueryAstSchema = z.object({
  intent: z.enum(['AGGREGATE', 'FILTER_LIST', 'ANOMALY_SUMMARY', 'CHASE_RECOMMENDATION']),
  aggregation: z.enum(['SUM', 'COUNT', 'AVG']).optional(),
  target_field: z.enum(['deal_value_bdt', 'amount_collected_bdt', 'amount_due_bdt', 'id']).optional(),
  filters: z.array(z.object({
    field: z.enum(['stage', 'industry', 'is_overdue', 'payment_status', 'has_anomaly', 'deal_value_bdt']),
    operator: z.enum(['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN']),
    value: z.union([z.string(), z.number(), z.array(z.string())])
  })).default([]),
  sort: z.object({
    field: z.enum(['deal_value_bdt', 'next_followup', 'company']),
    direction: z.enum(['ASC', 'DESC'])
  }).optional(),
  limit: z.number().int().min(1).max(50).default(25)
});

export type CopilotQueryAst = z.infer<typeof CopilotQueryAstSchema>;

export interface CopilotQueryResult {
  question: string;
  interpreted_intent: string;
  ast: CopilotQueryAst;
  cleaned_result: {
    scalar?: number | string;
    leads: CorporateLead[];
    total_count: number;
    total_value_bdt: number;
  };
  raw_variance?: {
    raw_scalar?: number | string;
    variance_explanation: string;
    phantom_value_removed_bdt: number;
  };
}
