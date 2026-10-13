import type { MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { AppEnv } from './context';
import { withTenant } from './db';
import { badRequest, conflict, unprocessable } from './problem';
import { idempotencyKey } from './schema';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(d).toString('hex');
}

/**
 * Idempotency-Key on every write (offline retries and SQS redelivery never double-post a payment).
 * The first response is stored for 24 h and replayed for the same key + same body.
 */
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!WRITE_METHODS.has(c.req.method)) return next();
  const key = c.req.header('idempotency-key');
  if (!key) throw badRequest('Idempotency-Key header is required on write requests');
  if (key.length > 100) throw badRequest('Idempotency-Key is too long');

  const actor = c.get('actor');
  const body = await c.req.raw.clone().text();
  const requestHash = await sha256(`${c.req.method} ${c.req.path} ${body}`);
  const where = and(eq(idempotencyKey.tenantId, actor.tenantId), eq(idempotencyKey.key, key));

  const existing = await withTenant(actor, async (tx) => {
    const [row] = await tx.select().from(idempotencyKey).where(where);
    if (row) return row;
    await tx.insert(idempotencyKey).values({ tenantId: actor.tenantId, key, method: c.req.method, path: c.req.path, requestHash }).onConflictDoNothing();
    return undefined;
  });

  if (existing) {
    if (existing.requestHash !== requestHash) throw unprocessable('This Idempotency-Key was already used with a different request');
    if (existing.statusCode == null) throw conflict('The original request with this Idempotency-Key is still being processed');
    c.header('idempotent-replay', 'true');
    return c.json(existing.response as object, existing.statusCode as 200);
  }

  try {
    await next();
  } finally {
    const status = c.res.status;
    await withTenant(actor, async (tx) => {
      if (status >= 500 || c.error) {
        await tx.delete(idempotencyKey).where(where); // allow a clean retry
      } else {
        let response: unknown = null;
        try {
          response = await c.res.clone().json();
        } catch {
          response = null;
        }
        await tx.update(idempotencyKey).set({ statusCode: status, response }).where(where);
      }
    });
  }
};
