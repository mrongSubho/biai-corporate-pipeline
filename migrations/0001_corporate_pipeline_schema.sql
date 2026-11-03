-- ============================================================================
-- 0001_corporate_pipeline_schema.sql
-- Cloudflare D1 Relational Schema: Raw Immutability, Canonical Views & Audits
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Tenant / Organization Boundary
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_currency TEXT NOT NULL DEFAULT 'BDT',
    benchmark_date TEXT NOT NULL DEFAULT '2026-11-01',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Staff Users & Authentication
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SALES_MANAGER', 'ACCOUNT_EXECUTIVE')),
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. File Imports Tracking
CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    filename TEXT NOT NULL,
    file_hash_sha256 TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    imported_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_hash ON imports(workspace_id, file_hash_sha256);

-- 4. Immutable Raw Leads (Verbatim Source Data)
CREATE TABLE IF NOT EXISTS raw_leads (
    id TEXT PRIMARY KEY,
    import_id TEXT NOT NULL REFERENCES imports(id),
    lead_id_csv TEXT NOT NULL, -- Original L01, L02...
    company_raw TEXT NOT NULL,
    industry_raw TEXT,
    contact_name_raw TEXT,
    contact_role_raw TEXT,
    contact_email_raw TEXT,
    contact_phone_raw TEXT,
    source_raw TEXT,
    stage_raw TEXT NOT NULL,
    deal_value_raw INTEGER NOT NULL DEFAULT 0,
    last_contact_raw TEXT,
    next_followup_raw TEXT,
    notes_raw TEXT,
    row_hash_sha256 TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_raw_leads_csv_id ON raw_leads(lead_id_csv);

-- Immutability Triggers for raw_leads
CREATE TRIGGER IF NOT EXISTS trg_raw_leads_no_update
BEFORE UPDATE ON raw_leads
BEGIN
    SELECT RAISE(FAIL, 'raw_leads is immutable and cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_raw_leads_no_delete
BEFORE DELETE ON raw_leads
BEGIN
    SELECT RAISE(FAIL, 'raw_leads is immutable and cannot be deleted');
END;

-- 5. Canonical Operational Leads (Cleaned Working Entity)
CREATE TABLE IF NOT EXISTS canonical_leads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    raw_lead_id TEXT NOT NULL REFERENCES raw_leads(id),
    lead_id_display TEXT NOT NULL, -- L01, L02...
    company TEXT NOT NULL,
    normalized_company TEXT NOT NULL, -- Suffix stripped & lowercased
    industry TEXT NOT NULL,
    contact_name TEXT,
    contact_role TEXT,
    contact_email TEXT,
    normalized_email TEXT,
    contact_phone TEXT,
    normalized_phone TEXT,
    source TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN (
        'New', 'Contacted', 'Meeting', 'Proposal', 'Invoice sent', 'Paid', 'Lost'
    )),
    deal_value_bdt INTEGER NOT NULL DEFAULT 0,
    amount_collected_bdt INTEGER NOT NULL DEFAULT 0,
    amount_due_bdt INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (
        payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID', 'OVERDUE')
    ),
    last_contact_date TEXT,
    next_followup_date TEXT,
    notes TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    merged_into_id TEXT REFERENCES canonical_leads(id),
    assigned_user_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canonical_stage ON canonical_leads(stage);
CREATE INDEX IF NOT EXISTS idx_canonical_followup ON canonical_leads(next_followup_date);
CREATE INDEX IF NOT EXISTS idx_canonical_archived ON canonical_leads(is_archived);

-- 6. Anomaly Diagnostics & Findings
CREATE TABLE IF NOT EXISTS anomaly_findings (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    lead_id TEXT NOT NULL REFERENCES canonical_leads(id),
    rule_code TEXT NOT NULL CHECK (rule_code IN (
        'DUPLICATE_COMPANY_CONTACT',
        'CHRONOLOGICAL_DATE_INVERSION',
        'MISSING_CONTACT_IDENTITY',
        'MISSING_PHONE',
        'EMAIL_TYPO_WARNING',
        'STAGE_PARTIAL_PAYMENT_DISCREPANCY',
        'STAGE_DATE_CONTRADICTION',
        'OVERDUE_FOLLOWUP',
        'DUE_TODAY'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    title TEXT NOT NULL,
    details_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    resolution_action TEXT,
    resolved_by TEXT REFERENCES users(id),
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_anomaly_status ON anomaly_findings(status);
CREATE INDEX IF NOT EXISTS idx_anomaly_lead ON anomaly_findings(lead_id);

-- 7. Deduplication & Merge Decisions Ledger
CREATE TABLE IF NOT EXISTS merge_decisions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    canonical_lead_id TEXT NOT NULL REFERENCES canonical_leads(id),
    duplicate_lead_id TEXT NOT NULL REFERENCES canonical_leads(id),
    match_confidence REAL NOT NULL,
    survivorship_policy_json TEXT NOT NULL,
    before_state_snapshot_json TEXT,
    merged_by TEXT NOT NULL REFERENCES users(id),
    can_revert INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Outbound Email Communications (Approval & Dispatch)
CREATE TABLE IF NOT EXISTS outbound_emails (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    lead_id TEXT NOT NULL REFERENCES canonical_leads(id),
    recipient_email TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    tone TEXT NOT NULL CHECK (tone IN ('POLITE_CHECKIN', 'PROPOSAL_FOLLOWUP', 'INVOICE_REMINDER')),
    status TEXT NOT NULL DEFAULT 'DRAFT_PENDING_APPROVAL' CHECK (
        status IN ('DRAFT_PENDING_APPROVAL', 'APPROVED', 'SENT', 'FAILED', 'BLOCKED_POLICY')
    ),
    policy_barrier_reason TEXT,
    approved_by TEXT REFERENCES users(id),
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 9. Immutable Audit Ledger
CREATE TABLE IF NOT EXISTS audit_events (
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
        'EMAIL_TYPO_NORMALIZED'
    )),
    entity_id TEXT NOT NULL,
    before_state_json TEXT,
    after_state_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Immutability Triggers for audit_events (Append-Only)
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
