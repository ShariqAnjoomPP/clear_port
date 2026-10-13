import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Role } from '@clearport/kernel';
import { config } from '../../config';
import { issueDevTokens, verifyDevRefresh } from '../../shared/auth';
import type { AppEnv } from '../../shared/context';
import { definerQuery } from '../../shared/db';
import { parseBody } from '../../shared/http';
import { badRequest, notFound, unauthorized } from '../../shared/problem';

const COOKIE = 'cp_refresh';
const COOKIE_PATH = '/api/auth';

type LoginRow = { user_id: string; tenant_id: string; tenant_name: string; name: string; roles: Role[]; customer_id: string | null; locale: string };

/**
 * Token handler (ADR-005). In production the PWA uses Cognito hosted login + PKCE and this Lambda exchanges the code;
 * in local/demo mode it issues tokens for seeded users. Either way the refresh token lives only in an HttpOnly cookie
 * and the access token only in memory.
 */
export function authRoutes() {
  const r = new Hono<AppEnv>();

  const issue = async (c: Context<AppEnv>, email: string) => {
    const rows = await definerQuery<LoginRow>('select * from platform.find_login($1)', [email]);
    if (rows.length !== 1) throw unauthorized('Unknown user');
    const u = rows[0]!;
    const tokens = await issueDevTokens({ sub: u.user_id, tid: u.tenant_id, name: u.name, email, roles: u.roles, cid: u.customer_id });
    setCookie(c, COOKIE, tokens.refresh, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'Strict', path: COOKIE_PATH, maxAge: 7 * 24 * 3600 });
    return c.json({ accessToken: tokens.access, expiresIn: tokens.expiresIn, user: { id: u.user_id, name: u.name, email, roles: u.roles, customerId: u.customer_id, locale: u.locale, tenantName: u.tenant_name } });
  };

  r.get('/config', (c) =>
    c.json({ mode: config.AUTH_MODE, cognito: config.AUTH_MODE === 'cognito' ? { region: config.COGNITO_REGION, userPoolId: config.COGNITO_USER_POOL_ID, clientId: config.COGNITO_CLIENT_ID } : null }),
  );

  r.get('/demo-users', async (c) => {
    if (config.AUTH_MODE !== 'dev') throw notFound();
    return c.json({ items: await definerQuery('select * from platform.list_demo_logins()', []) });
  });

  r.post('/dev-login', async (c) => {
    if (config.AUTH_MODE !== 'dev') throw notFound();
    const { email } = await parseBody(c, z.object({ email: z.email() }));
    return issue(c, email);
  });

  r.post('/refresh', async (c) => {
    if (config.AUTH_MODE !== 'dev') throw badRequest('Use the Cognito token endpoint');
    const token = getCookie(c, COOKIE);
    if (!token) throw unauthorized('No session');
    const { email } = await verifyDevRefresh(token);
    return issue(c, email);
  });

  r.post('/logout', (c) => {
    deleteCookie(c, COOKIE, { path: COOKIE_PATH });
    return c.json({ ok: true });
  });

  return r;
}
