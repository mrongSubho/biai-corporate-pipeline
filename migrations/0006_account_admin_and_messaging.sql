-- ============================================================================
-- 0006_account_admin_and_messaging.sql
-- BIAI Control Plane: User Lifecycle, Admin Controls & Internal Messaging
-- ============================================================================

-- 1. Extend users table for admin freeze and password-change enforcement
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;
ALTER TABLE users ADD COLUMN suspended_by TEXT;

-- 2. Internal Messaging Threads
CREATE TABLE IF NOT EXISTS internal_threads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    thread_type TEXT NOT NULL CHECK (thread_type IN ('DIRECT', 'ROLE_BROADCAST')),
    target_role TEXT,
    subject TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH', 'CRITICAL')),
    context_type TEXT CHECK (context_type IN ('NONE', 'ENQUIRY', 'LEAD', 'USER')),
    context_id TEXT,
    context_label TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_threads_workspace_last_msg
ON internal_threads(workspace_id, last_message_at DESC);

-- 3. Thread Participants & Read / Acknowledgment State
CREATE TABLE IF NOT EXISTS internal_thread_participants (
    thread_id TEXT NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_role TEXT NOT NULL DEFAULT 'PARTICIPANT' CHECK (participant_role IN ('CREATOR', 'RECIPIENT', 'BROADCAST_MEMBER')),
    last_read_at TEXT,
    acknowledged_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_internal_participants_user_read
ON internal_thread_participants(user_id, last_read_at);

-- 4. Internal Messages
CREATE TABLE IF NOT EXISTS internal_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'MESSAGE' CHECK (message_type IN ('MESSAGE', 'DIRECTIVE', 'SYSTEM_NOTICE')),
    requires_ack INTEGER NOT NULL DEFAULT 0,
    acknowledged_by TEXT REFERENCES users(id),
    acknowledged_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_messages_thread_created
ON internal_messages(thread_id, created_at ASC);

-- 5. Seed Tier 1 OPERATIONS_ADMIN (Tariqul Islam) for B2B Pipeline
INSERT OR IGNORE INTO users (
    id, workspace_id, email, normalized_email, full_name, department,
    password_hash, role, security_tier, status, mfa_required, created_at, updated_at
) VALUES (
    'usr_b2b_ops', 'ws_biai_b2b', 'opsadmin@biai.com.bd', 'opsadmin@biai.com.bd', 'Tariqul Islam', 'Operations',
    '$pbkdf2-sha256$i=100000$b3BzYWRtaW4tc2FsdC0xMjM0$g9Wz1p1bE+o7sN3wE6fL3n5sR8tU2vX1yZ0aB4cD6eE=',
    'ADMIN', 'TIER_1', 'ACTIVE', 0, datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO user_app_scopes (user_id, app_key, permission, granted_by) VALUES
('usr_b2b_ops', 'PIPELINE', 'PIPELINE_READ', 'usr_b2b_admin'),
('usr_b2b_ops', 'PIPELINE', 'PIPELINE_REMEDIATE', 'usr_b2b_admin'),
('usr_b2b_ops', 'PIPELINE', 'PIPELINE_MERGE', 'usr_b2b_admin'),
('usr_b2b_ops', 'PIPELINE', 'PIPELINE_EMAIL_APPROVE', 'usr_b2b_admin'),
('usr_b2b_ops', 'PIPELINE', 'PIPELINE_EMAIL_DISPATCH', 'usr_b2b_admin'),
('usr_b2b_ops', 'PIPELINE', 'PIPELINE_EXPORT', 'usr_b2b_admin'),
('usr_b2b_ops', 'PIPELINE', 'AUDIT_READ', 'usr_b2b_admin'),
('usr_b2b_ops', 'PIPELINE', 'USER_PROVISION', 'usr_b2b_admin');

-- 6. Seed Initial Directive Thread from PLATFORM_OWNER to OPERATIONS_ADMIN
INSERT OR IGNORE INTO internal_threads (
    id, workspace_id, thread_type, target_role, subject, priority,
    context_type, context_id, context_label, created_by, last_message_at, is_archived, created_at
) VALUES (
    'th_b2b_directive_1', 'ws_biai_b2b', 'DIRECT', NULL,
    'Deal Follow-up Directive: Bogura Textile Invoice Remediation',
    'HIGH', 'LEAD', 'L18', 'Lead L18 - Bogura Textile (৳ 350,000)',
    'usr_b2b_admin', datetime('now', '-3 hours'), 0, datetime('now', '-3 hours')
);

INSERT OR IGNORE INTO internal_thread_participants (thread_id, user_id, participant_role, last_read_at, acknowledged_at) VALUES
('th_b2b_directive_1', 'usr_b2b_admin', 'CREATOR', datetime('now', '-3 hours'), datetime('now', '-3 hours')),
('th_b2b_directive_1', 'usr_b2b_ops', 'RECIPIENT', NULL, NULL);

INSERT OR IGNORE INTO internal_messages (
    id, thread_id, sender_id, body, message_type, requires_ack, acknowledged_by, acknowledged_at, created_at
) VALUES (
    'msg_b2b_directive_1', 'th_b2b_directive_1', 'usr_b2b_admin',
    'Tariqul: Note lead L18 email typo has been remediated. Please follow up on invoice confirmation with the account executive today.',
    'DIRECTIVE', 1, NULL, NULL, datetime('now', '-3 hours')
);
