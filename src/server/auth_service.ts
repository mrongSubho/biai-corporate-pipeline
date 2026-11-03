import {
  hashPassword,
  verifyPassword,
  encryptSecret,
  decryptSecret,
  generateBase32Secret,
  verifyTotpCode,
  generateRandomToken,
  sha256,
  constantTimeCompare
} from './crypto.js';
import { checkRateLimit } from './rate_limiter.js';
import { parseSqlUtc, type AuthenticatedUser, type SecurityTier, type UserRole, type UserStatus } from './auth.js';

export interface LoginParams {
  email: string;
  password: string;
  mfaCode?: string;
}

export interface AuthServiceResponse<T = any> {
  success: boolean;
  status: number;
  data?: T;
  error?: string;
  code?: string;
  requiresMfa?: boolean;
  userId?: string;
  cookieHeader?: string;
}

export function getMfaKey(env: any): string {
  const key = env?.MFA_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('MFA_ENCRYPTION_KEY is required');
  }
  return key;
}

export function createSessionCookie(token: string, maxAgeSeconds = 604800, isProduction = false): string {
  const secureFlag = isProduction ? '; Secure' : '';
  return `__Host-biai_session=${token}; Path=/; HttpOnly${secureFlag}; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(isProduction = false): string {
  const secureFlag = isProduction ? '; Secure' : '';
  return `__Host-biai_session=; Path=/; HttpOnly${secureFlag}; SameSite=Lax; Max-Age=0`;
}

export async function logAuthEvent(
  db: any,
  params: {
    workspaceId?: string;
    actorUserId?: string;
    subjectUserId?: string;
    eventType: string;
    outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
    reasonCode?: string;
    ipHash?: string;
    metadata?: Record<string, any>;
  }
) {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO auth_events (
        workspace_id, actor_user_id, subject_user_id, event_type, outcome,
        reason_code, ip_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      params.workspaceId || null,
      params.actorUserId || null,
      params.subjectUserId || null,
      params.eventType,
      params.outcome,
      params.reasonCode || null,
      params.ipHash || null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ).run();
  } catch (err) {
    console.error('Failed to log auth event:', err);
  }
}

export class AuthService {
  constructor(private db: any, private env: any, private appKey: 'CRM' | 'PIPELINE' = 'PIPELINE') {}

  /**
   * Complete Login Flow: Rate Limiting, Account Lockout, Password & TOTP Verification, Session Creation
   */
  async login(
    ip: string,
    userAgent: string,
    params: LoginParams
  ): Promise<AuthServiceResponse> {
    const isProd = this.env?.ENVIRONMENT === 'production';
    const normalizedEmail = params.email.trim().toLowerCase();
    const ipHash = await sha256(ip);
    const uaHash = await sha256(userAgent);

    // 1. Rate limit by IP
    let ipLimit;
    let accountLimit;
    try {
      ipLimit = await checkRateLimit(this.db, {
        scope: 'login_ip',
        identifier: ip,
        maxAttempts: 15,
        windowSeconds: 900
      }, this.env?.ENVIRONMENT);
      accountLimit = await checkRateLimit(this.db, {
        scope: 'login_account',
        identifier: normalizedEmail,
        maxAttempts: 5,
        windowSeconds: 900
      }, this.env?.ENVIRONMENT);
    } catch (err) {
      console.error('Rate limiter unavailable:', err);
      return { success: false, status: 503, error: 'Authentication service unavailable', code: 'RATE_LIMITER_UNAVAILABLE' };
    }
    if (!ipLimit.allowed) {
      await logAuthEvent(this.db, {
        eventType: 'USER_LOGIN',
        outcome: 'DENIED',
        reasonCode: 'RATE_LIMIT_IP',
        ipHash
      });
      return {
        success: false,
        status: 429,
        error: `Too many login attempts from this IP. Please wait ${ipLimit.resetSeconds} seconds.`,
        code: 'RATE_LIMITED'
      };
    }

    // 2. Rate limit by Account
    if (!accountLimit.allowed) {
      await logAuthEvent(this.db, {
        eventType: 'USER_LOGIN',
        outcome: 'DENIED',
        reasonCode: 'RATE_LIMIT_ACCOUNT',
        ipHash
      });
      return {
        success: false,
        status: 429,
        error: `Too many failed login attempts for this account. Please wait ${accountLimit.resetSeconds} seconds.`,
        code: 'RATE_LIMITED'
      };
    }

    // 3. User Lookup
    if (!this.db) {
      return { success: false, status: 503, error: 'Database service unavailable', code: 'DB_UNAVAILABLE' };
    }

    const user = await this.db.prepare(`
      SELECT * FROM users WHERE normalized_email = ?
    `).bind(normalizedEmail).first();

    if (!user) {
      await logAuthEvent(this.db, {
        eventType: 'USER_LOGIN',
        outcome: 'FAILURE',
        reasonCode: 'USER_NOT_FOUND',
        ipHash,
        metadata: { email: normalizedEmail }
      });
      return { success: false, status: 401, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
    }

    // 4. Status Checks
    if (user.status === 'INVITED') {
      return { success: false, status: 403, error: 'Account invitation pending acceptance', code: 'ACCOUNT_INVITED' };
    }
    if (user.status === 'SUSPENDED') {
      await logAuthEvent(this.db, {
        workspaceId: user.workspace_id,
        subjectUserId: user.id,
        eventType: 'USER_LOGIN',
        outcome: 'DENIED',
        reasonCode: 'ACCOUNT_SUSPENDED',
        ipHash
      });
      return { success: false, status: 403, error: 'Account has been suspended by an administrator', code: 'ACCOUNT_SUSPENDED' };
    }
    if (user.status === 'DEACTIVATED') {
      return { success: false, status: 403, error: 'Account deactivated', code: 'ACCOUNT_DEACTIVATED' };
    }

    // 5. Account Lockout Check
    if (user.locked_until) {
      const lockExpiry = parseSqlUtc(user.locked_until);
      if (Date.now() < lockExpiry) {
        const remainingMinutes = Math.ceil((lockExpiry - Date.now()) / (60 * 1000));
        await logAuthEvent(this.db, {
          workspaceId: user.workspace_id,
          subjectUserId: user.id,
          eventType: 'USER_LOGIN',
          outcome: 'DENIED',
          reasonCode: 'ACCOUNT_LOCKED',
          ipHash
        });
        return {
          success: false,
          status: 423,
          error: `Account is temporarily locked. Please try again in ${remainingMinutes} minutes.`,
          code: 'ACCOUNT_LOCKED'
        };
      }
    }

    // 6. Password Verification (PBKDF2)
    const passwordValid = await verifyPassword(params.password, user.password_hash);
    if (!passwordValid) {
      const nextFailCount = (user.failed_login_count || 0) + 1;
      let lockUpdateSql = 'UPDATE users SET failed_login_count = ? WHERE id = ?';
      let lockParams: any[] = [nextFailCount, user.id];

      if (nextFailCount >= 5) {
        lockUpdateSql = "UPDATE users SET failed_login_count = ?, locked_until = datetime('now', '+15 minutes') WHERE id = ?";
        await logAuthEvent(this.db, {
          workspaceId: user.workspace_id,
          subjectUserId: user.id,
          eventType: 'USER_LOGIN',
          outcome: 'FAILURE',
          reasonCode: 'ACCOUNT_LOCKED_FAILED_LOGINS',
          ipHash
        });
      } else {
        await logAuthEvent(this.db, {
          workspaceId: user.workspace_id,
          subjectUserId: user.id,
          eventType: 'USER_LOGIN',
          outcome: 'FAILURE',
          reasonCode: 'INVALID_PASSWORD',
          ipHash
        });
      }

      await this.db.prepare(lockUpdateSql).bind(...lockParams).run();

      return {
        success: false,
        status: nextFailCount >= 5 ? 423 : 401,
        error: nextFailCount >= 5 ? 'Account locked for 15 minutes due to repeated failures.' : 'Invalid email or password',
        code: nextFailCount >= 5 ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS'
      };
    }

    // 7. MFA Verification
    const factor = await this.db.prepare(`
      SELECT * FROM mfa_factors WHERE user_id = ? AND enabled_at IS NOT NULL LIMIT 1
    `).bind(user.id).first();

    if (user.mfa_required === 1 && factor) {
      if (!params.mfaCode) {
        return {
          success: true,
          status: 200,
          requiresMfa: true,
          userId: user.id,
          data: {
            requiresMfa: true,
            userId: user.id,
            factorType: factor.factor_type
          }
        };
      }

      try {
        const secret = await decryptSecret(factor.secret_ciphertext, getMfaKey(this.env));
        const totpValid = await verifyTotpCode(secret, params.mfaCode);
        if (!totpValid) {
          await logAuthEvent(this.db, {
            workspaceId: user.workspace_id,
            subjectUserId: user.id,
            eventType: 'USER_LOGIN',
            outcome: 'FAILURE',
            reasonCode: 'INVALID_MFA_CODE',
            ipHash
          });
          return { success: false, status: 401, error: 'Invalid MFA verification code', code: 'INVALID_MFA' };
        }
      } catch (err) {
        console.error('MFA decryption/verification error:', err);
        return { success: false, status: 500, error: 'MFA service verification error', code: 'MFA_ERROR' };
      }
    }

    // 8. Succeeded -> Reset lockout, Create Session & CSRF tokens
    await this.db.prepare(`
      UPDATE users SET
        failed_login_count = 0,
        locked_until = NULL,
        last_login_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(user.id).run();

    const sessionToken = generateRandomToken(32);
    const csrfToken = generateRandomToken(32);
    const sessionTokenHash = await sha256(sessionToken);
    const csrfTokenHash = await sha256(csrfToken);

    await this.db.prepare(`
      INSERT INTO auth_sessions (
        id_hash, user_id, workspace_id, csrf_token_hash, mfa_verified_at,
        reauthenticated_at, created_at, last_seen_at, expires_at, idle_expires_at,
        ip_hash, user_agent_hash
      ) VALUES (
        ?, ?, ?, ?, datetime('now'),
        datetime('now'), datetime('now'), datetime('now'), datetime('now', '+7 days'), datetime('now', '+4 hours'),
        ?, ?
      )
    `).bind(
      sessionTokenHash,
      user.id,
      user.workspace_id,
      csrfTokenHash,
      ipHash,
      uaHash
    ).run();

    await logAuthEvent(this.db, {
      workspaceId: user.workspace_id,
      actorUserId: user.id,
      subjectUserId: user.id,
      eventType: 'USER_LOGIN',
      outcome: 'SUCCESS',
      ipHash
    });

    const scopesResult = await this.db.prepare(`
      SELECT permission FROM user_app_scopes WHERE user_id = ? AND app_key = ?
    `).bind(user.id, this.appKey).all();
    const scopes = (scopesResult.results || []).map((r: any) => r.permission);

    const cookieHeader = createSessionCookie(sessionToken, 604800, isProd);

    return {
      success: true,
      status: 200,
      cookieHeader,
      data: {
        sessionToken,
        csrfToken,
        user: {
          id: user.id,
          workspace_id: user.workspace_id,
          email: user.email,
          full_name: user.full_name,
          department: user.department,
          role: user.role,
          security_tier: user.security_tier,
          scopes
        }
      }
    };
  }

  async logout(sessionTokenOrHash: string, userId?: string): Promise<AuthServiceResponse> {
    if (!this.db) return { success: true, status: 200 };
    const tokenHash = await sha256(sessionTokenOrHash);

    await this.db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = datetime('now'), revoke_reason = 'USER_LOGOUT'
      WHERE id_hash = ? OR id_hash = ?
    `).bind(sessionTokenOrHash, tokenHash).run();

    if (userId) {
      await logAuthEvent(this.db, {
        actorUserId: userId,
        subjectUserId: userId,
        eventType: 'USER_LOGOUT',
        outcome: 'SUCCESS'
      });
    }

    return {
      success: true,
      status: 200,
      cookieHeader: clearSessionCookie(this.env?.ENVIRONMENT === 'production')
    };
  }

  async reauthenticate(
    userId: string,
    sessionTokenHash: string,
    params: { password: string; mfaCode?: string }
  ): Promise<AuthServiceResponse> {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const user = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    if (!user) return { success: false, status: 404, error: 'User not found' };

    const passwordValid = await verifyPassword(params.password, user.password_hash);
    if (!passwordValid) {
      await logAuthEvent(this.db, {
        workspaceId: user.workspace_id,
        actorUserId: userId,
        eventType: 'REAUTHENTICATION',
        outcome: 'FAILURE',
        reasonCode: 'INVALID_PASSWORD'
      });
      return { success: false, status: 401, error: 'Invalid password', code: 'INVALID_CREDENTIALS' };
    }

    const factor = await this.db.prepare(`
      SELECT * FROM mfa_factors WHERE user_id = ? AND enabled_at IS NOT NULL LIMIT 1
    `).bind(userId).first();

    if (user.mfa_required === 1 && factor) {
      if (!params.mfaCode) {
        return { success: false, status: 400, error: 'MFA code required for reauthentication', code: 'MFA_REQUIRED' };
      }
      const secret = await decryptSecret(factor.secret_ciphertext, getMfaKey(this.env));
      const totpValid = await verifyTotpCode(secret, params.mfaCode);
      if (!totpValid) {
        await logAuthEvent(this.db, {
          workspaceId: user.workspace_id,
          actorUserId: userId,
          eventType: 'REAUTHENTICATION',
          outcome: 'FAILURE',
          reasonCode: 'INVALID_MFA_CODE'
        });
        return { success: false, status: 401, error: 'Invalid MFA verification code', code: 'INVALID_MFA' };
      }
    }

    const reauthTime = new Date().toISOString();
    await this.db.prepare(`
      UPDATE auth_sessions
      SET reauthenticated_at = datetime('now')
      WHERE id_hash = ?
    `).bind(sessionTokenHash).run();

    await logAuthEvent(this.db, {
      workspaceId: user.workspace_id,
      actorUserId: userId,
      eventType: 'REAUTHENTICATION',
      outcome: 'SUCCESS'
    });

    return {
      success: true,
      status: 200,
      data: { reauthenticated_at: reauthTime }
    };
  }

  async enrollMfa(userId: string): Promise<AuthServiceResponse> {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const user = await this.db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
    if (!user) return { success: false, status: 404, error: 'User not found' };

    const secretBase32 = generateBase32Secret(20);
    const encryptedSecret = await encryptSecret(secretBase32, getMfaKey(this.env));
    const factorId = `mfa_${generateRandomToken(8)}`;

    await this.db.prepare(`
      DELETE FROM mfa_factors WHERE user_id = ? AND enabled_at IS NULL
    `).bind(userId).run();

    await this.db.prepare(`
      INSERT INTO mfa_factors (id, user_id, factor_type, secret_ciphertext, enabled_at, created_at)
      VALUES (?, ?, 'TOTP', ?, NULL, datetime('now'))
    `).bind(factorId, userId, encryptedSecret).run();

    const otpauthUri = `otpauth://totp/BIAI:${encodeURIComponent(user.email)}?secret=${secretBase32}&issuer=BIAI`;

    return {
      success: true,
      status: 200,
      data: {
        factorId,
        secret: secretBase32,
        otpauthUri
      }
    };
  }

  async confirmMfa(userId: string, factorId: string, code: string): Promise<AuthServiceResponse> {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const factor = await this.db.prepare(`
      SELECT * FROM mfa_factors WHERE id = ? AND user_id = ? AND enabled_at IS NULL
    `).bind(factorId, userId).first();

    if (!factor) {
      return { success: false, status: 404, error: 'Pending MFA enrollment not found or already confirmed' };
    }

    const secret = await decryptSecret(factor.secret_ciphertext, getMfaKey(this.env));
    const valid = await verifyTotpCode(secret, code);
    if (!valid) {
      return { success: false, status: 400, error: 'Invalid verification code. Please check your authenticator app.' };
    }

    await this.db.prepare(`
      UPDATE mfa_factors SET enabled_at = datetime('now') WHERE id = ?
    `).bind(factorId).run();

    await this.db.prepare(`
      UPDATE users SET mfa_required = 1, updated_at = datetime('now') WHERE id = ?
    `).bind(userId).run();

    await logAuthEvent(this.db, {
      actorUserId: userId,
      subjectUserId: userId,
      eventType: 'MFA_ENROLLED',
      outcome: 'SUCCESS'
    });

    return {
      success: true,
      status: 200,
      data: { message: 'MFA successfully enrolled and activated' }
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionHash?: string
  ): Promise<AuthServiceResponse> {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    if (newPassword.length < 10) {
      return { success: false, status: 400, error: 'New password must be at least 10 characters long' };
    }

    const user = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    if (!user) return { success: false, status: 404, error: 'User not found' };

    const validCurrent = await verifyPassword(currentPassword, user.password_hash);
    if (!validCurrent) {
      return { success: false, status: 401, error: 'Current password is incorrect' };
    }

    const newHash = await hashPassword(newPassword);

    await this.db.prepare(`
      UPDATE users SET
        password_hash = ?,
        password_changed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(newHash, userId).run();

    if (currentSessionHash) {
      await this.db.prepare(`
        UPDATE auth_sessions
        SET revoked_at = datetime('now'), revoke_reason = 'PASSWORD_CHANGED'
        WHERE user_id = ? AND id_hash != ? AND revoked_at IS NULL
      `).bind(userId, currentSessionHash).run();
    } else {
      await this.db.prepare(`
        UPDATE auth_sessions
        SET revoked_at = datetime('now'), revoke_reason = 'PASSWORD_CHANGED'
        WHERE user_id = ? AND revoked_at IS NULL
      `).bind(userId).run();
    }

    await logAuthEvent(this.db, {
      workspaceId: user.workspace_id,
      actorUserId: userId,
      subjectUserId: userId,
      eventType: 'PASSWORD_CHANGED',
      outcome: 'SUCCESS'
    });

    return { success: true, status: 200, data: { message: 'Password successfully updated' } };
  }

  async createInvitation(
    inviter: AuthenticatedUser,
    params: {
      email: string;
      fullName: string;
      department?: string;
      role: UserRole;
      securityTier: SecurityTier;
      scopes: string[];
    }
  ): Promise<AuthServiceResponse> {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const normalizedEmail = params.email.trim().toLowerCase();
    const existing = await this.db.prepare('SELECT id, status FROM users WHERE normalized_email = ?').bind(normalizedEmail).first();
    if (existing && existing.status !== 'DEACTIVATED') {
      return { success: false, status: 409, error: 'User with this email already exists' };
    }

    const userId = `usr_${generateRandomToken(8)}`;
    const inviteToken = generateRandomToken(32);
    const tokenHash = await sha256(inviteToken);
    const placeholderHash = await hashPassword(generateRandomToken(24));

    await this.db.prepare(`
      INSERT INTO users (
        id, workspace_id, email, normalized_email, full_name, department,
        password_hash, role, security_tier, status, mfa_required, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 'INVITED', 1, datetime('now'), datetime('now')
      )
    `).bind(
      userId,
      inviter.workspace_id,
      params.email.trim(),
      normalizedEmail,
      params.fullName.trim(),
      params.department || 'Operations',
      placeholderHash,
      params.role,
      params.securityTier
    ).run();

    await this.db.prepare(`
      INSERT INTO invitations (
        id, user_id, token_hash, invited_by, expires_at, created_at
      ) VALUES (
        ?, ?, ?, ?, datetime('now', '+7 days'), datetime('now')
      )
    `).bind(`inv_${generateRandomToken(8)}`, userId, tokenHash, inviter.id).run();

    for (const perm of params.scopes) {
      await this.db.prepare(`
        INSERT OR IGNORE INTO user_app_scopes (user_id, app_key, permission, granted_by, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(userId, this.appKey, perm, inviter.id).run();
    }

    await logAuthEvent(this.db, {
      workspaceId: inviter.workspace_id,
      actorUserId: inviter.id,
      subjectUserId: userId,
      eventType: 'USER_INVITED',
      outcome: 'SUCCESS',
      metadata: { role: params.role, securityTier: params.securityTier }
    });

    return {
      success: true,
      status: 201,
      data: {
        userId,
        email: params.email,
        invitationToken: inviteToken,
        expiresInDays: 7
      }
    };
  }

  async acceptInvitation(
    token: string,
    params: { fullName?: string; password: string }
  ): Promise<AuthServiceResponse> {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    if (params.password.length < 10) {
      return { success: false, status: 400, error: 'Password must be at least 10 characters long' };
    }

    const tokenHash = await sha256(token);
    const invite = await this.db.prepare(`
      SELECT i.*, u.email, u.workspace_id
      FROM invitations i
      JOIN users u ON i.user_id = u.id
      WHERE i.token_hash = ?
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
        AND i.expires_at > datetime('now')
    `).bind(tokenHash).first();

    if (!invite) {
      return { success: false, status: 400, error: 'Invitation link is invalid or expired' };
    }

    const passwordHash = await hashPassword(params.password);

    await this.db.prepare(`
      UPDATE users SET
        full_name = COALESCE(?, full_name),
        password_hash = ?,
        status = 'ACTIVE',
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(params.fullName?.trim() || null, passwordHash, invite.user_id).run();

    await this.db.prepare(`
      UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?
    `).bind(invite.id).run();

    await logAuthEvent(this.db, {
      workspaceId: invite.workspace_id,
      actorUserId: invite.user_id,
      subjectUserId: invite.user_id,
      eventType: 'INVITATION_ACCEPTED',
      outcome: 'SUCCESS'
    });

    return {
      success: true,
      status: 200,
      data: { message: 'Account successfully activated. Please log in.' }
    };
  }

  async bootstrapOwner(params: {
    email: string;
    fullName: string;
    password: string;
    bootstrapToken?: string;
  }): Promise<AuthServiceResponse> {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    if (this.env?.INITIAL_OWNER_BOOTSTRAP_TOKEN) {
      if (!params.bootstrapToken || !constantTimeCompare(params.bootstrapToken, this.env.INITIAL_OWNER_BOOTSTRAP_TOKEN)) {
        return { success: false, status: 403, error: 'Invalid bootstrap token' };
      }
    }

    const existingOwner = await this.db.prepare(`
      SELECT id, email FROM users WHERE role = 'PLATFORM_OWNER' AND status = 'ACTIVE' LIMIT 1
    `).first();

    if (existingOwner && !this.env?.INITIAL_OWNER_BOOTSTRAP_TOKEN) {
      return {
        success: false,
        status: 409,
        error: 'Platform Owner already initialized in database. Use administrative delegation.'
      };
    }

    const passwordHash = await hashPassword(params.password);
    const ownerId = existingOwner?.id || `usr_owner_${generateRandomToken(6)}`;
    const workspaceId = this.env?.WORKSPACE_ID || 'ws_biai_b2b';
    const normalizedEmail = params.email.trim().toLowerCase();

    if (existingOwner) {
      await this.db.prepare(`
        UPDATE users SET
          email = ?, normalized_email = ?, full_name = ?, password_hash = ?,
          role = 'PLATFORM_OWNER', security_tier = 'TIER_0', status = 'ACTIVE',
          failed_login_count = 0, locked_until = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).bind(params.email.trim(), normalizedEmail, params.fullName.trim(), passwordHash, existingOwner.id).run();
    } else {
      await this.db.prepare(`
        INSERT INTO users (
          id, workspace_id, email, normalized_email, full_name, department,
          password_hash, role, security_tier, status, mfa_required, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'Executive',
          ?, 'PLATFORM_OWNER', 'TIER_0', 'ACTIVE', 1, datetime('now'), datetime('now')
        )
      `).bind(ownerId, workspaceId, params.email.trim(), normalizedEmail, params.fullName.trim(), passwordHash).run();
    }

    const allScopes = [
      { app: 'CRM', perm: 'CRM_READ' },
      { app: 'CRM', perm: 'CRM_TRIAGE' },
      { app: 'CRM', perm: 'CRM_REPLY_APPROVE' },
      { app: 'CRM', perm: 'CRM_REPLY_DISPATCH' },
      { app: 'CRM', perm: 'CRM_KNOWLEDGE_BASE_MANAGE' },
      { app: 'CRM', perm: 'AUDIT_READ' },
      { app: 'CRM', perm: 'USER_PROVISION' },
      { app: 'CRM', perm: 'SECURITY_ADMIN' },
      { app: 'PIPELINE', perm: 'PIPELINE_READ' },
      { app: 'PIPELINE', perm: 'PIPELINE_REMEDIATE' },
      { app: 'PIPELINE', perm: 'PIPELINE_MERGE' },
      { app: 'PIPELINE', perm: 'PIPELINE_EMAIL_APPROVE' },
      { app: 'PIPELINE', perm: 'PIPELINE_EMAIL_DISPATCH' },
      { app: 'PIPELINE', perm: 'PIPELINE_EXPORT' },
      { app: 'PIPELINE', perm: 'AUDIT_READ' },
      { app: 'PIPELINE', perm: 'USER_PROVISION' },
      { app: 'PIPELINE', perm: 'SECURITY_ADMIN' },
    ];

    for (const s of allScopes) {
      await this.db.prepare(`
        INSERT OR IGNORE INTO user_app_scopes (user_id, app_key, permission, granted_by, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(ownerId, s.app, s.perm, ownerId).run();
    }

    await logAuthEvent(this.db, {
      workspaceId,
      actorUserId: ownerId,
      subjectUserId: ownerId,
      eventType: 'PLATFORM_OWNER_BOOTSTRAP',
      outcome: 'SUCCESS'
    });

    return {
      success: true,
      status: 200,
      data: {
        userId: ownerId,
        email: params.email,
        role: 'PLATFORM_OWNER',
        securityTier: 'TIER_0'
      }
    };
  }
}
