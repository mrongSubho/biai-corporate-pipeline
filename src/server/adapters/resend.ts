/**
 * Resend Email Dispatch Adapter for BIAI Corporate Pipeline.
 */

export interface ResendSendOptions {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  bodyText: string;
  apiKey?: string;
  fromEmail?: string;
  idempotencyKey?: string;
  allowMock?: boolean;
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
  const { recipientEmail, recipientName, subject, bodyText, apiKey, fromEmail = 'sales@biai.com.bd', idempotencyKey, allowMock = false } = options;
  const timestamp = new Date().toISOString();

  if (apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: JSON.stringify({
          from: `BIAI Enterprise Solutions <${fromEmail}>`,
          to: [`${recipientName} <${recipientEmail}>`],
          subject,
          text: bodyText
        }),
        signal: controller.signal
      });

      const data: any = await response.json().catch(() => ({}));
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
        messageId: data.id || '',
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
        error: err?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : (err?.message || 'Network error reaching Resend API'),
        timestamp
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  if (allowMock) {
    return {
      success: true,
      messageId: `mock_email_${crypto.randomUUID()}`,
      provider: 'MOCK_ADAPTER',
      status: 'SENT',
      timestamp
    };
  }

  return {
    success: false,
    messageId: '',
    provider: 'RESEND',
    status: 'FAILED',
    error: 'MISSING_CREDENTIALS: Resend API key not configured',
    timestamp
  };
}
