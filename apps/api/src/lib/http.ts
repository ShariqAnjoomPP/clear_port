import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { ZodError, type ZodType } from 'zod';
import { currentUser, SESSION_COOKIE, type CurrentUser } from './current-user';
import { ApiError, fromPg, fromZod } from './errors';

/** Hono context variables available in every function. */
export type AppEnv = { Variables: { user: CurrentUser } };

function renderError(e: unknown, c: Context) {
  let problem: ApiError | undefined;
  if (e instanceof ApiError) problem = e;
  else if (e instanceof ZodError) problem = fromZod(e);
  else problem = fromPg(e);
  if (!problem) {
    console.error(e);
    problem = new ApiError(500, 'Internal error', 'Something went wrong. Check the API logs.');
  }
  return c.json(
    { title: problem.title, status: problem.status, detail: problem.detail, errors: problem.errors },
    problem.status as 400,
    { 'content-type': 'application/problem+json' },
  );
}

/** Signed-in staff only: sets c.get('user'), or answers 401 "Please sign in". */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', await currentUser(getCookie(c, SESSION_COOKIE)));
  await next();
};

/**
 * Creates one function's router. Every function is a self-contained Hono app:
 * locally it is mounted on the dev server, in production it becomes its own Lambda.
 * Public functions (customer and driver links) skip the sign-in check.
 */
export function createFunction(opts: { public?: boolean } = {}) {
  const app = new Hono<AppEnv>();
  if (!opts.public) app.use('*', requireUser);
  app.onError(renderError);
  app.notFound((c) => c.json({ title: 'Not found', status: 404 }, 404));
  return app;
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
