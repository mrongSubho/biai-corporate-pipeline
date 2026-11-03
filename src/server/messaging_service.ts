import { generateRandomToken } from './crypto.js';
import { logAuthEvent } from './auth_service.js';
import { normalizeStoredRole, type AuthenticatedUser, type UserRole, type SecurityTier } from './auth.js';

export interface CreateThreadParams {
  recipientId?: string;
  targetRole?: string;
  subject: string;
  body: string;
  priority?: 'NORMAL' | 'HIGH' | 'CRITICAL';
  messageType?: 'MESSAGE' | 'DIRECTIVE';
  requiresAck?: boolean;
  contextType?: 'NONE' | 'ENQUIRY' | 'LEAD' | 'USER';
  contextId?: string;
  contextLabel?: string;
}

export class MessagingService {
  constructor(private db: any, private env: any, private appKey: 'CRM' | 'PIPELINE' = 'PIPELINE') {}

  /**
   * Get eligible messaging recipients and role broadcast channels
   */
  async getRecipients(actor: AuthenticatedUser) {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const usersResult = await this.db.prepare(`
      SELECT id, full_name, email, role, security_tier, department
      FROM users
      WHERE workspace_id = ? AND status = 'ACTIVE' AND id != ?
      ORDER BY
        CASE security_tier
          WHEN 'TIER_0' THEN 0
          WHEN 'TIER_1' THEN 1
          WHEN 'TIER_2' THEN 2
          WHEN 'TIER_3' THEN 3
          ELSE 4
        END,
        full_name ASC
    `).bind(actor.workspace_id, actor.id).all();

    const users = (usersResult.results || []).map((u: any) => ({
      ...u,
      role: normalizeStoredRole(u.role)
    }));

    const broadcastRoles: string[] = [];
    if (['TIER_0', 'TIER_1'].includes(actor.security_tier)) {
      broadcastRoles.push('OPERATIONS_ADMIN', 'TEAM_LEAD', 'ALL_OPERATORS');
    }

    return {
      success: true,
      status: 200,
      data: {
        recipients: users,
        broadcastRoles
      }
    };
  }

  /**
   * Fast badge counter: unread threads & pending directives
   */
  async getUnreadSummary(actor: AuthenticatedUser) {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const unreadRow = await this.db.prepare(`
      SELECT COUNT(DISTINCT t.id) as unread_count
      FROM internal_threads t
      JOIN internal_thread_participants p ON t.id = p.thread_id
      WHERE p.user_id = ?
        AND t.is_archived = 0
        AND (p.last_read_at IS NULL OR p.last_read_at < t.last_message_at)
    `).bind(actor.id).first();

    const pendingAckRow = await this.db.prepare(`
      SELECT COUNT(DISTINCT m.id) as pending_ack_count
      FROM internal_messages m
      JOIN internal_thread_participants p ON m.thread_id = p.thread_id
      WHERE p.user_id = ?
        AND m.sender_id != ?
        AND m.requires_ack = 1
        AND m.acknowledged_at IS NULL
    `).bind(actor.id, actor.id).first();

    const latestMsgRow = await this.db.prepare(`
      SELECT MAX(t.last_message_at) as latest_message_at
      FROM internal_threads t
      JOIN internal_thread_participants p ON t.id = p.thread_id
      WHERE p.user_id = ?
    `).bind(actor.id).first();

    const unreadCount = Number(unreadRow?.unread_count || 0);
    const pendingAckCount = Number(pendingAckRow?.pending_ack_count || 0);

    return {
      success: true,
      status: 200,
      data: {
        unreadCount,
        unreadThreadsCount: unreadCount,
        unreadDirectivesCount: pendingAckCount,
        pendingAckCount,
        latestMessageAt: latestMsgRow?.latest_message_at || null
      }
    };
  }

  /**
   * List threads where actor is a participant
   */
  async listThreads(actor: AuthenticatedUser, channel?: string) {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    let sql = `
      SELECT
        t.id, t.workspace_id, t.thread_type, t.target_role, t.subject,
        t.priority, t.context_type, t.context_id, t.context_label,
        t.created_by, t.last_message_at, t.created_at,
        p.last_read_at, p.acknowledged_at as participant_ack_at,
        u_creator.full_name as creator_name, u_creator.role as creator_role,
        (SELECT body FROM internal_messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message_preview,
        (SELECT sender_id FROM internal_messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message_sender_id,
        (SELECT COUNT(*) FROM internal_messages WHERE thread_id = t.id AND requires_ack = 1 AND acknowledged_at IS NULL) as unack_directive_count,
        CASE WHEN (p.last_read_at IS NULL OR p.last_read_at < t.last_message_at) THEN 1 ELSE 0 END as is_unread
      FROM internal_threads t
      JOIN internal_thread_participants p ON t.id = p.thread_id
      JOIN users u_creator ON t.created_by = u_creator.id
      WHERE p.user_id = ? AND t.is_archived = 0
    `;
    const params: any[] = [actor.id];

    if (channel === 'owner_admin') {
      sql += ` AND (
        (u_creator.role IN ('ADMIN', 'PLATFORM_OWNER') AND t.target_role = 'OPERATIONS_ADMIN')
        OR (t.thread_type = 'DIRECT' AND EXISTS (
          SELECT 1 FROM internal_thread_participants p2
          JOIN users u2 ON p2.user_id = u2.id
          WHERE p2.thread_id = t.id AND u2.security_tier IN ('TIER_0', 'TIER_1')
        ))
      )`;
    } else if (channel === 'directives') {
      sql += ' AND EXISTS (SELECT 1 FROM internal_messages m WHERE m.thread_id = t.id AND m.requires_ack = 1)';
    } else if (channel === 'unread') {
      sql += ' AND (p.last_read_at IS NULL OR p.last_read_at < t.last_message_at)';
    }

    sql += ' ORDER BY t.last_message_at DESC LIMIT 50';

    const rows = await this.db.prepare(sql).bind(...params).all();

    const threads = (rows.results || []).map((t: any) => ({
      ...t,
      creator_role: normalizeStoredRole(t.creator_role),
      is_unread: Boolean(t.is_unread),
      unack_directive_count: Number(t.unack_directive_count || 0)
    }));

    return { success: true, status: 200, data: { threads } };
  }

  /**
   * Get single thread details and message history; marks thread read for actor
   */
  async getThread(actor: AuthenticatedUser, threadId: string) {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const thread = await this.db.prepare(`
      SELECT
        t.*,
        u_creator.full_name as creator_name,
        u_creator.email as creator_email,
        u_creator.role as creator_role,
        u_creator.security_tier as creator_tier
      FROM internal_threads t
      JOIN users u_creator ON t.created_by = u_creator.id
      WHERE t.id = ? AND t.workspace_id = ?
    `).bind(threadId, actor.workspace_id).first();

    if (!thread) {
      return { success: false, status: 404, error: 'Thread not found', code: 'THREAD_NOT_FOUND' };
    }

    let participant = await this.db.prepare(`
      SELECT * FROM internal_thread_participants WHERE thread_id = ? AND user_id = ?
    `).bind(threadId, actor.id).first();

    if (!participant) {
      if (thread.thread_type === 'ROLE_BROADCAST') {
        await this.db.prepare(`
          INSERT OR IGNORE INTO internal_thread_participants (thread_id, user_id, participant_role, last_read_at, created_at)
          VALUES (?, ?, 'BROADCAST_MEMBER', datetime('now'), datetime('now'))
        `).bind(threadId, actor.id).run();
      } else {
        return { success: false, status: 403, error: 'Access denied: not a participant in this thread', code: 'ACCESS_DENIED' };
      }
    } else {
      await this.db.prepare(`
        UPDATE internal_thread_participants
        SET last_read_at = datetime('now')
        WHERE thread_id = ? AND user_id = ?
      `).bind(threadId, actor.id).run();
    }

    const participantsResult = await this.db.prepare(`
      SELECT
        p.user_id, p.participant_role, p.last_read_at, p.acknowledged_at,
        u.full_name, u.email, u.role, u.security_tier, u.department
      FROM internal_thread_participants p
      JOIN users u ON p.user_id = u.id
      WHERE p.thread_id = ?
    `).bind(threadId).all();

    const messagesResult = await this.db.prepare(`
      SELECT
        m.id, m.thread_id, m.sender_id, m.body, m.message_type,
        m.requires_ack, m.acknowledged_by, m.acknowledged_at, m.created_at,
        u.full_name as sender_name, u.email as sender_email, u.role as sender_role, u.security_tier as sender_tier,
        u_ack.full_name as ack_by_name
      FROM internal_messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN users u_ack ON m.acknowledged_by = u_ack.id
      WHERE m.thread_id = ?
      ORDER BY m.created_at ASC
    `).bind(threadId).all();

    const participants = (participantsResult.results || []).map((p: any) => ({
      ...p,
      role: normalizeStoredRole(p.role)
    }));

    const messages = (messagesResult.results || []).map((m: any) => ({
      ...m,
      sender_role: normalizeStoredRole(m.sender_role),
      requires_ack: Boolean(m.requires_ack),
      is_acknowledged: Boolean(m.acknowledged_at)
    }));

    const hasDirectives = messages.some((m: any) => m.requires_ack);
    const hasUnack = messages.some((m: any) => m.requires_ack && !m.is_acknowledged);
    const isAcknowledged = hasDirectives ? !hasUnack : true;

    return {
      success: true,
      status: 200,
      data: {
        thread: {
          ...thread,
          creator_role: normalizeStoredRole(thread.creator_role),
          requires_ack: hasDirectives ? 1 : 0,
          is_acknowledged: isAcknowledged ? 1 : 0
        },
        participants,
        messages
      }
    };
  }

  /**
   * Create a new direct or broadcast thread
   */
  async createThread(actor: AuthenticatedUser, params: CreateThreadParams) {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const subject = (params.subject || '').trim();
    const body = (params.body || (params as any).content || '').trim();
    if (!subject || !body) {
      return { success: false, status: 400, error: 'subject and content/body are required', code: 'INVALID_REQUEST' };
    }

    const threadId = `th_${generateRandomToken(8)}`;
    const messageId = `msg_${generateRandomToken(8)}`;
    const threadType = params.targetRole ? 'ROLE_BROADCAST' : 'DIRECT';
    let priority = params.priority || (params.messageType === 'DIRECTIVE' ? 'HIGH' : 'NORMAL');
    if ((priority as string) === 'URGENT') priority = 'CRITICAL';
    if (!['NORMAL', 'HIGH', 'CRITICAL'].includes(priority)) priority = 'NORMAL';
    const messageType = params.messageType || 'MESSAGE';
    const requiresAck = params.requiresAck ? 1 : (messageType === 'DIRECTIVE' ? 1 : 0);

    // 1. Insert thread
    await this.db.prepare(`
      INSERT INTO internal_threads (
        id, workspace_id, thread_type, target_role, subject, priority,
        context_type, context_id, context_label, created_by, last_message_at, is_archived, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, datetime('now'), 0, datetime('now')
      )
    `).bind(
      threadId,
      actor.workspace_id,
      threadType,
      params.targetRole || null,
      subject,
      priority,
      params.contextType || 'NONE',
      params.contextId || null,
      params.contextLabel || null,
      actor.id
    ).run();

    // 2. Creator participant
    await this.db.prepare(`
      INSERT INTO internal_thread_participants (thread_id, user_id, participant_role, last_read_at, created_at)
      VALUES (?, ?, 'CREATOR', datetime('now'), datetime('now'))
    `).bind(threadId, actor.id).run();

    // 3. Add recipient(s)
    if (params.recipientId && params.recipientId !== actor.id) {
      await this.db.prepare(`
        INSERT OR IGNORE INTO internal_thread_participants (thread_id, user_id, participant_role, last_read_at, created_at)
        VALUES (?, ?, 'RECIPIENT', NULL, datetime('now'))
      `).bind(threadId, params.recipientId).run();
    } else if (params.targetRole) {
      const users = await this.db.prepare(`
        SELECT id FROM users
        WHERE workspace_id = ? AND status = 'ACTIVE' AND id != ?
      `).bind(actor.workspace_id, actor.id).all();

      for (const u of (users.results || [])) {
        await this.db.prepare(`
          INSERT OR IGNORE INTO internal_thread_participants (thread_id, user_id, participant_role, last_read_at, created_at)
          VALUES (?, ?, 'BROADCAST_MEMBER', NULL, datetime('now'))
        `).bind(threadId, u.id).run();
      }
    }

    // 4. Insert initial message
    await this.db.prepare(`
      INSERT INTO internal_messages (
        id, thread_id, sender_id, body, message_type, requires_ack, acknowledged_by, acknowledged_at, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NULL, NULL, datetime('now')
      )
    `).bind(
      messageId,
      threadId,
      actor.id,
      body,
      messageType,
      requiresAck
    ).run();

    await logAuthEvent(this.db, {
      workspaceId: actor.workspace_id,
      actorUserId: actor.id,
      subjectUserId: params.recipientId || undefined,
      eventType: 'MESSAGE_DISPATCHED',
      outcome: 'SUCCESS',
      metadata: { threadId, threadType, priority, messageType, subject }
    });

    return {
      success: true,
      status: 201,
      data: {
        thread: {
          id: threadId,
          subject,
          priority,
          requires_ack: requiresAck,
          thread_type: threadType,
          is_acknowledged: 0
        },
        threadId,
        messageId,
        subject,
        priority,
        messageType
      }
    };
  }

  /**
   * Post a reply message in an existing thread
   */
  async sendMessage(
    actor: AuthenticatedUser,
    threadId: string,
    params: { body: string; messageType?: 'MESSAGE' | 'DIRECTIVE'; requiresAck?: boolean }
  ) {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const body = (params.body || (params as any).content || '').trim();
    if (!body) {
      return { success: false, status: 400, error: 'body/content is required', code: 'INVALID_REQUEST' };
    }

    const thread = await this.db.prepare(`
      SELECT * FROM internal_threads WHERE id = ? AND workspace_id = ?
    `).bind(threadId, actor.workspace_id).first();

    if (!thread) {
      return { success: false, status: 404, error: 'Thread not found', code: 'THREAD_NOT_FOUND' };
    }

    const participant = await this.db.prepare(`
      SELECT * FROM internal_thread_participants WHERE thread_id = ? AND user_id = ?
    `).bind(threadId, actor.id).first();

    if (!participant) {
      return { success: false, status: 403, error: 'Access denied: not a participant in this thread', code: 'ACCESS_DENIED' };
    }

    const messageId = `msg_${generateRandomToken(8)}`;
    const messageType = params.messageType || 'MESSAGE';
    const requiresAck = params.requiresAck ? 1 : (messageType === 'DIRECTIVE' ? 1 : 0);

    await this.db.batch([
      this.db.prepare(`
        INSERT INTO internal_messages (
          id, thread_id, sender_id, body, message_type, requires_ack, acknowledged_by, acknowledged_at, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, NULL, NULL, datetime('now')
        )
      `).bind(messageId, threadId, actor.id, body, messageType, requiresAck),
      this.db.prepare(`
        UPDATE internal_threads SET last_message_at = datetime('now') WHERE id = ?
      `).bind(threadId),
      this.db.prepare(`
        UPDATE internal_thread_participants SET last_read_at = datetime('now') WHERE thread_id = ? AND user_id = ?
      `).bind(threadId, actor.id)
    ]);

    await logAuthEvent(this.db, {
      workspaceId: actor.workspace_id,
      actorUserId: actor.id,
      eventType: 'MESSAGE_DISPATCHED',
      outcome: 'SUCCESS',
      metadata: { threadId, messageId, messageType }
    });

    const now = new Date().toISOString();
    return {
      success: true,
      status: 201,
      data: {
        message: {
          id: messageId,
          thread_id: threadId,
          sender_id: actor.id,
          sender_name: actor.full_name,
          sender_role: actor.role,
          content: body,
          body,
          created_at: now
        },
        messageId,
        threadId,
        body,
        messageType,
        created_at: now
      }
    };
  }

  /**
   * Explicitly acknowledge an operational directive
   */
  async acknowledgeDirective(actor: AuthenticatedUser, threadId: string, messageId?: string) {
    if (!this.db) return { success: false, status: 503, error: 'Database service unavailable' };

    const updateSql = messageId
      ? "UPDATE internal_messages SET acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ? AND thread_id = ? AND acknowledged_at IS NULL"
      : "UPDATE internal_messages SET acknowledged_by = ?, acknowledged_at = datetime('now') WHERE thread_id = ? AND requires_ack = 1 AND acknowledged_at IS NULL";

    const updateParams = messageId ? [actor.id, messageId, threadId] : [actor.id, threadId];

    await this.db.prepare(updateSql).bind(...updateParams).run();

    await this.db.prepare(`
      UPDATE internal_thread_participants
      SET acknowledged_at = datetime('now'), last_read_at = datetime('now')
      WHERE thread_id = ? AND user_id = ?
    `).bind(threadId, actor.id).run();

    await logAuthEvent(this.db, {
      workspaceId: actor.workspace_id,
      actorUserId: actor.id,
      eventType: 'DIRECTIVE_ACKNOWLEDGED',
      outcome: 'SUCCESS',
      metadata: { threadId, messageId }
    });

    return {
      success: true,
      status: 200,
      data: {
        success: true,
        message: 'Directive successfully acknowledged',
        acknowledged_by: actor.id,
        acknowledged_at: new Date().toISOString()
      }
    };
  }
}
