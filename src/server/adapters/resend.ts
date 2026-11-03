/**
 * Resend Email Dispatch Adapter for BIAI Corporate Pipeline
 * Dispatches enterprise followup emails with template formatting and audit confirmation.
 */

export interface ResendSendOptions {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  bodyText: string;
  apiKey?: string;
  fromEmail?: string;
}

export interface ResendSendResult {
  success: boolean;
  messageId: string;
  provider: 'RESEND' | 'MOCK_ADAPTER';
  status: 'SENT' | 'FAILED';
  error?: string;
  timestamp: string;
}

export async function sendCorporateEmail(options: ResendSendOptions): Promise<ResendSendResult> {
  const { recipientEmail, recipientName, subject, bodyText, apiKey, fromEmail = 'sales@biai.com.bd' } = options;
  const timestamp = new Date().toISOString();

  if (apiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `BIAI Enterprise Solutions <${fromEmail}>`,
          to: [`${recipientName} <${recipientEmail}>`],
          subject,
          text: bodyText
        })
      });

      const data: any = await response.json();
      if (!response.ok) {
        return {
          success: false,
          messageId: '',
          provider: 'RESEND',
          status: 'FAILED',
          error: data?.message || `Resend API HTTP ${response.status}`,
          timestamp
        };
      }

      return {
        success: true,
        messageId: data.id || `msg_resend_${Date.now()}`,
        provider: 'RESEND',
        status: 'SENT',
        timestamp
      };
    } catch (err: any) {
      return {
        success: false,
        messageId: '',
        provider: 'RESEND',
        status: 'FAILED',
        error: err?.message || 'Network error reaching Resend API',
        timestamp
      };
    }
  }

  // Fallback Mock Adapter for Testing and Demonstrations
  const mockId = `msg_resend_${Math.random().toString(36).substring(2, 10)}`;
  return {
    success: true,
    messageId: mockId,
    provider: 'MOCK_ADAPTER',
    status: 'SENT',
    timestamp
  };
}
