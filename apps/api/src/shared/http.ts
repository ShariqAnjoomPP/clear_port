import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { ZodError, type ZodType } from 'zod';
import { uuidv7 } from '@clearport/kernel';
import { config } from '../config';
import { tokenVerifier } from './auth';
import type { AppEnv } from './context';
import { ApiError, fromPg, fromZod, unauthorized } from './problem';
import { idempotency } from './idempotency';

export const requestMeta: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? uuidv7();
  c.set('meta', { requestId, ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(), userAgent: c.req.header('user-agent') });
  await next();
  c.header('x-request-id', requestId);
};

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  c.set('actor', await tokenVerifier.verify(header.slice(7)));
  await next();
};

export function renderError(e: unknown, c: Context<AppEnv>) {
  const requestId = c.get('meta')?.requestId;
  let problem: ApiError | undefined;
  if (e instanceof ApiError) problem = e;
  else if (e instanceof ZodError) problem = fromZod(e);
  else problem = fromPg(e);
  if (!problem) {
    // Never leak internals: log with the request id, return a generic 500.
    console.error(JSON.stringify({ level: 'error', requestId, message: (e as Error)?.message, stack: (e as Error)?.stack }));
    problem = new ApiError(500, 'Internal error', 'Something went wrong. Quote the request id if you contact support.');
  }
  return c.json(
    { type: problem.type, title: problem.title, status: problem.status, detail: problem.detail, errors: problem.errors, requestId },
    problem.status as 400,
    { 'content-type': 'application/problem+json' },
  );
}

/** Builds a Hono app with the shared middleware chain. Each Lambda mounts only its own context's routes. */
export function createApp(mount: (app: Hono<AppEnv>) => void) {
  const app = new Hono<AppEnv>();
  app.use('*', requestMeta);
  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-site' }));
  app.use('*', cors({ origin: config.APP_ORIGIN, credentials: true, allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'if-match', 'x-request-id'], exposeHeaders: ['etag', 'x-request-id'] }));
  app.use('*', compress());
  app.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ title: 'Payload too large', status: 413 }, 413) }));
  app.onError(renderError);
  app.notFound((c) => c.json({ type: 'about:blank', title: 'Not found', status: 404 }, 404));
  mount(app);
  return app;
}

/** Router for an authenticated context under /v1. Idempotency is enforced on every write. */
export function protectedRouter() {
  const r = new Hono<AppEnv>();
  r.use('*', authenticate);
  r.use('*', idempotency);
  return r;
}

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}

export const parseQuery = <T>(c: Context, schema: ZodType<T>): T => schema.parse(c.req.query());

/** Optimistic concurrency: If-Match carries the aggregate version (sent back as ETag). */
export const ifMatchVersion = (c: Context): number | undefined => {
  const v = c.req.header('if-match')?.replace(/"/g, '');
  return v ? Number(v) : undefined;
};
