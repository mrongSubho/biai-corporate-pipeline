import { sendCorporateEmail } from './adapters/resend.js';

const MAX_RETRY_COUNT = 5;

export async function retryQueuedPipelineDeliveries(db: any, env: {
  ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
}, limit = 25): Promise<{ attempted: number; sent: number; failed: number }> {
  if (!db) return { attempted: 0, sent: 0, failed: 0 };

  const rows = await db.prepare(`
    SELECT e.id, e.recipient_email, e.recipient_name, e.subject, e.body_text,
           e.idempotency_key, e.retry_count
    FROM outbound_emails e
    WHERE e.delivery_status IN ('QUEUED', 'FAILED')
      AND (e.next_retry_at IS NULL OR e.next_retry_at <= datetime('now'))
      AND e.retry_count < ?
    ORDER BY e.created_at
    LIMIT ?
  `).bind(MAX_RETRY_COUNT, limit).all();

  let sent = 0;
  let failed = 0;
  for (const row of rows.results || []) {
    const claim = await db.prepare(`
      UPDATE outbound_emails
      SET next_retry_at = datetime('now', '+5 minutes')
      WHERE id = ?
        AND delivery_status IN ('QUEUED', 'FAILED')
        AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
        AND retry_count < ?
    `).bind(row.id, MAX_RETRY_COUNT).run();
    if (!claim?.meta?.changes) continue;

    const result = await sendCorporateEmail({
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name,
      subject: row.subject,
      bodyText: row.body_text,
      apiKey: env.RESEND_API_KEY,
      idempotencyKey: row.idempotency_key,
      allowMock: env.ENVIRONMENT !== 'production'
    });

    if (result.success) {
      sent++;
      await db.prepare(`
        UPDATE outbound_emails
        SET status = 'SENT', sent_at = datetime('now'), delivery_status = 'SENT',
            provider_message_id = ?, failure_code = NULL, next_retry_at = NULL,
            manual_dispatch_required = 0, last_provider_response = ?
        WHERE id = ? AND idempotency_key = ?
      `).bind(
        result.messageId || null,
        JSON.stringify({ provider: result.provider, status: result.status }),
        row.id,
        row.idempotency_key
      ).run();
    } else {
      failed++;
      const nextDelay = Math.min(60, 5 * 2 ** Number(row.retry_count || 0));
      await db.prepare(`
        UPDATE outbound_emails
        SET status = 'FAILED', delivery_status = 'FAILED', failure_code = ?,
            retry_count = retry_count + 1,
            next_retry_at = datetime('now', '+' || ? || ' minutes'),
            manual_dispatch_required = CASE WHEN retry_count + 1 >= ? THEN 1 ELSE 0 END,
            last_provider_response = ?
        WHERE id = ? AND idempotency_key = ?
      `).bind(
        result.error || 'PROVIDER_FAILURE',
        nextDelay,
        MAX_RETRY_COUNT,
        JSON.stringify({ provider: result.provider, status: result.status, error: result.error }),
        row.id,
        row.idempotency_key
      ).run();
    }
  }

  return { attempted: sent + failed, sent, failed };
}
