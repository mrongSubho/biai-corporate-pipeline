-- ============================================================================
-- 0003_identity_control_plane.sql
-- BIAI Access & Operations Control Plane: Identity, Sessions, MFA & Outbound States
-- ============================================================================

PRAGMA foreign_keys = OFF;

INSERT OR IGNORE INTO workspaces (id, name, default_currency, benchmark_date)
VALUES ('ws_biai_b2b', 'BIAI Corporate Pipeline', 'BDT', '2026-11-01');

-- 1. Extend the existing users table in place. D1 runs migrations in a
-- transaction where PRAGMA foreign_keys cannot be toggled safely; rebuilding
-- users would invalidate existing pipeline foreign keys and production data.
ALTER TABLE users ADD COLUMN normalized_email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN department TEXT;
ALTER TABLE users ADD COLUMN security_tier TEXT NOT NULL DEFAULT 'TIER_3';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;

UPDATE users
SET normalized_email = lower(email),
    department = CASE
      WHEN role = 'ADMIN' THEN 'Executive Management'
      WHEN role = 'SALES_MANAGER' THEN 'Enterprise Sales'
      ELSE 'Account Executive'
    END,
    security_tier = CASE
      WHEN role = 'ADMIN' THEN 'TIER_0'
      WHEN role = 'SALES_MANAGER' THEN 'TIER_2'
      ELSE 'TIER_3'
    END,
    status = CASE
      WHEN is_active = 1 THEN 'ACTIVE'
      ELSE 'DEACTIVATED'
    END,
    mfa_required = CASE WHEN role = 'ADMIN' THEN 1 ELSE 0 END,
    updated_at = datetime('now');

CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_normalized_email ON users(normalized_email);

-- 2. User Application Scopes
CREATE TABLE IF NOT EXISTS user_app_scopes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_key TEXT NOT NULL CHECK (app_key IN ('CRM', 'PIPELINE')),
    permission TEXT NOT NULL,
    granted_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, app_key, permission)
);

-- Seed app scopes for Task 2
INSERT OR IGNORE INTO user_app_scopes (user_id, app_key, permission, granted_by) VALUES
('usr_b2b_admin', 'PIPELINE', 'PIPELINE_READ', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'PIPELINE_REMEDIATE', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'PIPELINE_MERGE', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'PIPELINE_EMAIL_APPROVE', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'PIPELINE_EMAIL_DISPATCH', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'PIPELINE_EXPORT', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'AUDIT_READ', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'USER_PROVISION', 'usr_b2b_admin'),
('usr_b2b_admin', 'PIPELINE', 'SECURITY_ADMIN', 'usr_b2b_admin'),
('usr_b2b_admin', 'CRM', 'CRM_READ', 'usr_b2b_admin'),
('usr_b2b_admin', 'CRM', 'CRM_TRIAGE', 'usr_b2b_admin'),
('usr_b2b_mgr', 'PIPELINE', 'PIPELINE_READ', 'usr_b2b_admin'),
('usr_b2b_mgr', 'PIPELINE', 'PIPELINE_REMEDIATE', 'usr_b2b_admin'),
('usr_b2b_mgr', 'PIPELINE', 'PIPELINE_MERGE', 'usr_b2b_admin'),
('usr_b2b_mgr', 'PIPELINE', 'PIPELINE_EMAIL_APPROVE', 'usr_b2b_admin'),
('usr_b2b_mgr', 'PIPELINE', 'PIPELINE_EMAIL_DISPATCH', 'usr_b2b_admin'),
('usr_b2b_mgr', 'PIPELINE', 'PIPELINE_EXPORT', 'usr_b2b_admin'),
('usr_b2b_mgr', 'PIPELINE', 'AUDIT_READ', 'usr_b2b_admin'),
('usr_b2b_ae', 'PIPELINE', 'PIPELINE_READ', 'usr_b2b_admin'),
('usr_b2b_ae', 'PIPELINE', 'PIPELINE_EMAIL_APPROVE', 'usr_b2b_admin'),
('usr_b2b_ae', 'PIPELINE', 'PIPELINE_EMAIL_DISPATCH', 'usr_b2b_admin');

-- 3. Production auth_sessions Table
CREATE TABLE IF NOT EXISTS auth_sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    csrf_token_hash TEXT NOT NULL,
    mfa_verified_at TEXT,
    reauthenticated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    idle_expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoke_reason TEXT,
    ip_hash TEXT,
    user_agent_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions(expires_at);

-- 4. MFA Factors Table
CREATE TABLE IF NOT EXISTS mfa_factors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    factor_type TEXT NOT NULL CHECK (factor_type IN ('TOTP', 'RECOVERY_CODE')),
    secret_ciphertext TEXT NOT NULL,
    enabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mfa_factors_user ON mfa_factors(user_id);

-- 5. Operator Invitations
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    invited_by TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Password Resets
CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. Durable Rate Limit Buckets
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    counter INTEGER NOT NULL DEFAULT 1,
    window_start TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets(expires_at);

-- 8. Append-Only Security Auth Events
CREATE TABLE IF NOT EXISTS auth_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT,
    actor_user_id TEXT,
    subject_user_id TEXT,
    event_type TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
    reason_code TEXT,
    ip_hash TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_auth_events_no_update
BEFORE UPDATE ON auth_events
BEGIN
    SELECT RAISE(FAIL, 'auth_events is append-only and cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_auth_events_no_delete
BEFORE DELETE ON auth_events
BEGIN
    SELECT RAISE(FAIL, 'auth_events is append-only and cannot be deleted');
END;

-- 9. Outbound Email State Fields Addition
ALTER TABLE outbound_emails ADD COLUMN provider_message_id TEXT;
ALTER TABLE outbound_emails ADD COLUMN idempotency_key TEXT;
ALTER TABLE outbound_emails ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbound_emails ADD COLUMN failure_code TEXT;
ALTER TABLE outbound_emails ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'PENDING';

-- 10. Table Rebuild for audit_events to expand CHECK constraint
CREATE TABLE audit_events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER', 'SYSTEM', 'WEBHOOK')),
    actor_role TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'LEAD_STAGE_TRANSITION',
        'DUPLICATE_MERGED',
        'DUPLICATE_UNMERGED',
        'DATE_ORDER_REMEDIATED',
        'PAYMENT_STATUS_UPDATED',
        'EMAIL_APPROVED_DISPATCHED',
        'CLEANED_CSV_EXPORTED',
        'EMAIL_TYPO_NORMALIZED',
        'EMAIL_DISPATCH_FAILED',
        'MANUAL_DISPATCH_REQUIRED'
    )),
    entity_id TEXT NOT NULL,
    before_state_json TEXT,
    after_state_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO audit_events_new (
    id, workspace_id, actor_id, actor_type, actor_role, event_type,
    entity_id, before_state_json, after_state_json, metadata_json, created_at
)
SELECT
    id, workspace_id, actor_id, 'USER', actor_role, event_type,
    entity_id, before_state_json, after_state_json, metadata_json, created_at
FROM audit_events;
DROP TABLE audit_events;
ALTER TABLE audit_events_new RENAME TO audit_events;

CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(FAIL, 'audit_events is append-only and cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(FAIL, 'audit_events is append-only and cannot be deleted');
END;

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
