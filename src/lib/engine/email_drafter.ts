import type { CorporateLead } from '../types/pipeline.ts';

export interface EmailDraftRequest {
  lead: CorporateLead;
  tone?: 'POLITE_CHECKIN' | 'PROPOSAL_FOLLOWUP' | 'INVOICE_REMINDER';
  senderName?: string;
  senderTitle?: string;
}

export interface EmailDraftResult {
  isBlocked: boolean;
  barrierReason?: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  tone: 'POLITE_CHECKIN' | 'PROPOSAL_FOLLOWUP' | 'INVOICE_REMINDER';
  requiresBankChecklist: boolean;
  warnings: string[];
}

export function generateCorporateFollowupEmail(req: EmailDraftRequest): EmailDraftResult {
  const { lead, tone = 'POLITE_CHECKIN', senderName = 'Shakib Rahman', senderTitle = 'Head of Corporate Partnerships' } = req;
  const warnings: string[] = [];

  // 1. POLICY BARRIER: Lost Lead with Do Not Contact Instruction (L16 Sundarban Shipping)
  if (lead.stage === 'Lost' || lead.notes.toLowerCase().includes('do not contact')) {
    return {
      isBlocked: true,
      barrierReason: 'POLICY BARRIER (DO NOT CONTACT): Lead notes state client chose an international vendor and explicitly requested no contact this year.',
      recipientEmail: lead.contact_email || '',
      recipientName: lead.contact_name || lead.company,
      subject: '',
      body: '',
      tone,
      requiresBankChecklist: false,
      warnings: ['Outbound transmission locked by compliance policy.']
    };
  }

  // 2. Email Address Normalization (L18 Typo Check)
  let recipientEmail = lead.contact_email || '';
  if (recipientEmail.includes('bogurateXtile')) {
    recipientEmail = recipientEmail.replace('bogurateXtile', 'boguratextile');
    warnings.push("Normalized email typo from 'bogurateXtile' to 'boguratextile.example'.");
  }

  const recipientName = lead.contact_name || lead.contact_role || 'Sir/Madam';
  const firstName = recipientName.split(' ')[0] || 'Sir/Madam';

  // 3. Mandatory Bank Checklist for Unmarked Invoices (L22 Khulna Jute Works)
  let requiresBankChecklist = false;
  if (lead.notes.toLowerCase().includes('check bank before chasing')) {
    requiresBankChecklist = true;
    warnings.push('Bank statement reconciliation required before sending invoice chase email.');
  }

  // 4. Tone-based Subject & Body Synthesis
  let subject = '';
  let body = '';

  if (lead.stage === 'Invoice sent' || tone === 'INVOICE_REMINDER') {
    subject = `Follow-up: BIAI Corporate AI Training Invoice — ${lead.company}`;
    body = `Dear ${recipientName},

I hope this email finds you well.

I am writing to respectfully follow up on the training invoice sent on ${lead.last_contact || 'October 17'} regarding the upcoming AI enablement program for ${lead.company} (Amount: ৳ ${lead.deal_value_bdt.toLocaleString()} BDT).

Could you kindly confirm if the advance payment has been scheduled with your finance department, or if you require any additional vendor documentation from our accounts team?

We are reserving your cohort dates and look forward to partnering with your team.

Warm regards,

${senderName}
${senderTitle}
Bangladesh Institute of AI (BIAI)
corporate@biai.com.bd | +880 1711-000000`;
  } else if (lead.stage === 'Proposal' || tone === 'PROPOSAL_FOLLOWUP') {
    subject = `Proposal Review: Tailored AI Training for ${lead.company}`;
    body = `Dear ${recipientName},

I hope you have had a productive week.

Following our proposal submission on ${lead.last_contact || 'October 27'} regarding the AI upskilling initiative for ${lead.company} (৳ ${lead.deal_value_bdt.toLocaleString()} BDT), I wanted to check if you and your leadership team have had the opportunity to review the curriculum modules.

As discussed, our syllabus includes specialized workflows for ${lead.industry.toLowerCase()} operations and hands-on tools tailored to your team's specific goals. 

Could we arrange a brief 15-minute call this Thursday or next Sunday to answer any questions and assist with your internal budget review?

Sincerely,

${senderName}
${senderTitle}
Bangladesh Institute of AI (BIAI)`;
  } else if (lead.stage === 'Meeting') {
    // e.g. L10 Oriental Bank Ops (Wants 3 proposal options)
    const wantsOptions = lead.notes.toLowerCase().includes('3 options');
    subject = `Following up on our meeting: AI Enablement for ${lead.company}`;
    body = `Dear ${recipientName},

Thank you for taking the time to meet with us on ${lead.last_contact || 'October 26'}.

${wantsOptions ? 'We are finalizing the tailored 3-tiered proposal options you requested for your team, covering foundational productivity, workflow automation, and enterprise governance.' : `We were delighted to learn more about ${lead.company}'s objectives in exploring AI training for your team.`}

I would welcome the opportunity to share our comprehensive slide deck and review the implementation roadmap with you. Would you have 15 minutes for a brief follow-up call this week?

Warm regards,

${senderName}
${senderTitle}
Bangladesh Institute of AI (BIAI)`;
  } else {
    // New / Contacted
    subject = `Exploring AI Training Opportunities for ${lead.company}`;
    body = `Dear ${recipientName},

I hope you are having a wonderful week.

Thank you for your interest in the Bangladesh Institute of AI (BIAI). We recently received your inquiry regarding AI training for ${lead.company}.

We deliver practical, industry-specific AI workshops designed to help teams in ${lead.industry} automate routine tasks and enhance productivity without complex technical barriers.

Could we schedule a quick 10-minute introductory call this week to understand your team's requirements?

Best regards,

${senderName}
${senderTitle}
Bangladesh Institute of AI (BIAI)`;
  }

  return {
    isBlocked: false,
    recipientEmail,
    recipientName,
    subject,
    body,
    tone,
    requiresBankChecklist,
    warnings
  };
}
