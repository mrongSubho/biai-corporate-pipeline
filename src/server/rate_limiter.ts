/**
 * Durable Rate Limiter backed by Cloudflare D1
 * Prevents credential stuffing, brute force login attacks, and endpoint abuse.
 */

export interface RateLimitOptions {
  scope: string; // e.g. 'login_ip', 'login_account', 'password_reset'
  identifier: string; // e.g. ip address or email
  maxAttempts: number; // e.g. 5
  windowSeconds: number; // e.g. 300 (5 minutes)
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

const memoryRateLimit = new Map<string, { count: number; expiresAt: number }>();

export async function checkRateLimit(
  db: any,
  options: RateLimitOptions,
  environment = 'development'
): Promise<RateLimitResult> {
  const { scope, identifier, maxAttempts, windowSeconds } = options;
  const now = Math.floor(Date.now() / 1000);
  const windowSlot = Math.floor(now / windowSeconds);
  const bucketKey = `${scope}:${identifier}:${windowSlot}`;
  const expiresAt = (windowSlot + 1) * windowSeconds;
  const resetSeconds = Math.max(1, expiresAt - now);

  if (db) {
    try {
      if (Math.random() < 0.05) {
        db.prepare('DELETE FROM rate_limit_buckets WHERE expires_at < datetime("now")').run().catch(() => {});
      }

      await db.prepare(`
        INSERT INTO rate_limit_buckets (bucket_key, counter, window_start, expires_at, updated_at)
        VALUES (?, 1, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), datetime('now'))
        ON CONFLICT(bucket_key) DO UPDATE SET
          counter = counter + 1,
          updated_at = datetime('now')
      `).bind(bucketKey, windowSlot * windowSeconds, expiresAt).run();

      const row = await db.prepare('SELECT counter FROM rate_limit_buckets WHERE bucket_key = ?').bind(bucketKey).first();
      const currentCount = row?.counter || 1;

      const remaining = Math.max(0, maxAttempts - currentCount);
      return {
        allowed: currentCount <= maxAttempts,
        remaining,
        resetSeconds
      };
    } catch (err) {
      if (environment === 'production') {
        throw new Error('Durable rate limiter unavailable');
      }
      console.warn('D1 rate limiter error, using memory fallback:', err);
    }
  }

  if (environment === 'production') {
    throw new Error('Durable rate limiter unavailable');
  }

  const entry = memoryRateLimit.get(bucketKey);
  if (!entry || entry.expiresAt <= now) {
    memoryRateLimit.set(bucketKey, { count: 1, expiresAt });
    return { allowed: true, remaining: maxAttempts - 1, resetSeconds };
  }

  entry.count += 1;
  const remaining = Math.max(0, maxAttempts - entry.count);
  return {
    allowed: entry.count <= maxAttempts,
    remaining,
    resetSeconds
  };
}
