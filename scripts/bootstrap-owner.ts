/**
 * BIAI Access Control Plane — First Platform Owner Bootstrap Utility
 * Safely provisions or emits single-use setup instructions for the Platform Owner.
 * Adheres strictly to BIAI Security Architecture Plan Section 6 & 8.
 */

import { hashPassword, generateRandomToken, sha256 } from '../src/server/crypto.ts';

async function main() {
  const email = process.env.OWNER_EMAIL || 'owner@biai.com.bd';
  const fullName = process.env.OWNER_NAME || 'Tariq Mansoor';
  const initialPassword = process.env.OWNER_PASSWORD || `BIAI-${generateRandomToken(6)}!Aa1`;
  const workspaceId = process.env.WORKSPACE_ID || 'ws_biai_b2b';
  const bootstrapToken = process.env.INITIAL_OWNER_BOOTSTRAP_TOKEN || generateRandomToken(16);

  console.log('================================================================');
  console.log('       BIAI IDENTITY CONTROL PLANE — PLATFORM OWNER BOOTSTRAP   ');
  console.log('================================================================');
  console.log(`Target Email:     ${email}`);
  console.log(`Full Name:        ${fullName}`);
  console.log(`Workspace:        ${workspaceId}`);
  console.log(`Security Tier:    TIER_0 (PLATFORM_OWNER)`);
  console.log('----------------------------------------------------------------');

  const passwordHash = await hashPassword(initialPassword);
  const tokenHash = await sha256(bootstrapToken);
  const ownerId = `usr_owner_${generateRandomToken(4)}`;

  console.log('\n[1] Generated Secure Credentials:');
  console.log(`    One-Time Initial Password: ${initialPassword}`);
  console.log(`    Bootstrap Token:           ${bootstrapToken}`);
  console.log(`    PBKDF2 Password Hash:      ${passwordHash}`);

  console.log('\n[2] Direct D1 SQL Bootstrap Statement:');
  console.log(`
INSERT INTO users (
  id, workspace_id, email, normalized_email, full_name, department,
  password_hash, role, security_tier, status, failed_login_count, mfa_required, created_at, updated_at
) VALUES (
  '${ownerId}', '${workspaceId}', '${email}', '${email.toLowerCase()}', '${fullName}', 'Executive',
  '${passwordHash}', 'PLATFORM_OWNER', 'TIER_0', 'ACTIVE', 0, 1, datetime('now'), datetime('now')
)
ON CONFLICT (workspace_id, normalized_email) DO UPDATE SET
  password_hash = '${passwordHash}',
  role = 'PLATFORM_OWNER',
  security_tier = 'TIER_0',
  status = 'ACTIVE',
  failed_login_count = 0,
  locked_until = NULL,
  updated_at = datetime('now');

INSERT OR IGNORE INTO user_app_scopes (user_id, app_key, permission, granted_by, created_at) VALUES
('${ownerId}', 'PIPELINE', 'PIPELINE_READ', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'PIPELINE_REMEDIATE', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'PIPELINE_MERGE', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'PIPELINE_EMAIL_APPROVE', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'PIPELINE_EMAIL_DISPATCH', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'PIPELINE_EXPORT', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'AUDIT_READ', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'USER_PROVISION', '${ownerId}', datetime('now')),
('${ownerId}', 'PIPELINE', 'SECURITY_ADMIN', '${ownerId}', datetime('now'));

INSERT INTO auth_events (workspace_id, actor_user_id, subject_user_id, event_type, outcome, created_at)
VALUES ('${workspaceId}', '${ownerId}', '${ownerId}', 'PLATFORM_OWNER_BOOTSTRAP', 'SUCCESS', datetime('now'));
  `.trim());

  console.log('\n[3] Single-Use API Bootstrap Call:');
  console.log(`    curl -X POST https://biaileads.mrong.tech/api/auth/bootstrap-owner \\`);
  console.log(`      -H "Content-Type: application/json" \\`);
  console.log(`      -d '{"email":"${email}","fullName":"${fullName}","password":"${initialPassword}","bootstrapToken":"${bootstrapToken}"}'`);

  console.log('\n================================================================');
  console.log('Keep these credentials secure. Once logged in, immediately enroll');
  console.log('MFA and rotate your password.');
  console.log('================================================================\n');
}

main().catch(console.error);
