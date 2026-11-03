import { z } from 'zod';
import { PipelineStageEnum } from '../lib/types/pipeline.ts';

export const MergeLeadsSchema = z.object({
  canonicalId: z.string().min(1, 'canonicalId is required'),
  duplicateId: z.string().min(1, 'duplicateId is required')
});

export const UnmergeLeadSchema = z.object({
  duplicateId: z.string().min(1, 'duplicateId is required')
});

export const RemediateDateSchema = z.object({
  leadId: z.string().min(1).default('L25'),
  strategy: z.enum(['SWAP', 'RESCHEDULE']),
  newFollowup: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Follow-up date must be YYYY-MM-DD').optional()
}).refine(data => {
  if (data.strategy === 'RESCHEDULE') {
    return !!data.newFollowup && data.newFollowup.trim().length > 0;
  }
  return true;
}, {
  message: 'Field "newFollowup" (YYYY-MM-DD) is required when strategy is RESCHEDULE',
  path: ['newFollowup']
});

export const LeadStageTransitionSchema = z.object({
  stage: PipelineStageEnum
});

export const FixTypoSchema = z.object({
  leadId: z.string().min(1).default('L18')
});

export const CopilotQueryRequestSchema = z.object({
  question: z.string().min(1, 'Field "question" is required and cannot be empty')
});

export const EmailDraftRequestSchema = z.object({
  leadId: z.string().min(1, 'Field "leadId" is required'),
  tone: z.enum(['POLITE_CHECKIN', 'PROPOSAL_FOLLOWUP', 'INVOICE_REMINDER']).default('POLITE_CHECKIN')
});

export const EmailSendRequestSchema = z.object({
  leadId: z.string().min(1, 'Field "leadId" is required'),
  subject: z.string().min(1, 'Field "subject" is required'),
  bodyText: z.string().min(1, 'Field "bodyText" is required'),
  tone: z.enum(['POLITE_CHECKIN', 'PROPOSAL_FOLLOWUP', 'INVOICE_REMINDER']).default('POLITE_CHECKIN'),
  bankConfirmed: z.boolean().default(false)
});

export const LeadsQuerySchema = z.object({
  mode: z.enum(['cleaned', 'raw']).default('cleaned'),
  stage: PipelineStageEnum.optional(),
  industry: z.string().optional()
});
