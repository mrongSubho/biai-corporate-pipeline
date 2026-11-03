ALTER TABLE outbound_emails ADD COLUMN next_retry_at TEXT;
ALTER TABLE outbound_emails ADD COLUMN manual_dispatch_required INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_outbound_emails_delivery_queue
ON outbound_emails(delivery_status, next_retry_at);
