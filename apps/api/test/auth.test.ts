import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { FUNCTIONS } from '../src/functions';
import { config } from '../src/lib/config';
import { db, pool } from '../src/lib/db';
import { appUser } from '../src/lib/schema';
import { signSession } from '../src/lib/tokens';

/** Staff sign-in for the hosted demo: demouser / Demo@123, an HttpOnly cookie, customer pages stay open. */
const app = new Hono();
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json, setCookie: res.headers.get('set-cookie') ?? '' };
}
const cookieOf = (setCookie: string) => setCookie.split(';')[0]!;

beforeAll(() => { config.AUTH_REQUIRED = true; });
afterAll(async () => { config.AUTH_REQUIRED = false; await pool.end(); });

describe('staff sign-in', () => {
  it('keeps the staff app closed and customer pages open', async () => {
    const jobs = await call('GET', '/jobs');
    expect(jobs.status).toBe(401);
    expect(jobs.json.detail).toBe('Please sign in.');
    expect((await call('GET', '/session/me')).status).toBe(401);
    expect((await call('GET', '/public/track/agency')).status).toBe(200);
  });

  it('gives one answer for a wrong password and an unknown user', async () => {
    for (const body of [{ username: 'demouser', password: 'wrong' }, { username: 'nobody', password: 'Demo@123' }]) {
      const r = await call('POST', '/session/login', body);
      expect(r.status).toBe(401);
      expect(r.json.detail).toBe('Wrong username or password');
      expect(r.setCookie).toBe('');
    }
  });

  it('signs in as demouser / Demo@123, then signs out', async () => {
    const login = await call('POST', '/session/login', { username: 'DemoUser', password: 'Demo@123' });
    expect(login.status).toBe(200);
    expect(login.setCookie).toMatch(/^cp_session=.+; .*HttpOnly/i);
    expect(login.setCookie).toMatch(/SameSite=Lax/i);
    const cookie = cookieOf(login.setCookie);
    expect((await call('GET', '/session/me', undefined, cookie)).json.user.name).toBe('Demo User');
    expect((await call('GET', '/jobs', undefined, cookie)).status).toBe(200);
    const out = await call('POST', '/session/logout', {}, cookie);
    expect(out.setCookie).toMatch(/^cp_session=;/);
    expect((await call('GET', '/jobs', undefined, cookieOf(out.setCookie))).status).toBe(401);
  });

  it('rejects edited and expired sessions', async () => {
    const [u] = await db.select().from(appUser).where(eq(appUser.username, 'demouser'));
    const good = signSession(u!.id);
    expect((await call('GET', '/jobs', undefined, `cp_session=${good}`)).status).toBe(200);
    expect((await call('GET', '/jobs', undefined, `cp_session=${good}x`)).status).toBe(401);
    expect((await call('GET', '/jobs', undefined, `cp_session=${signSession(u!.id, -1000)}`)).status).toBe(401);
    const otherUser = good.replace(/^[^.]+/, '00000000-0000-0000-0000-000000000000');
    expect((await call('GET', '/jobs', undefined, `cp_session=${otherUser}`)).status).toBe(401);
  });

  it('stores only a hash of the password', async () => {
    const [u] = await db.select().from(appUser).where(eq(appUser.username, 'demouser'));
    expect(u!.passwordHash).toMatch(/^scrypt\$/);
    expect(u!.passwordHash).not.toContain('Demo@123');
  });
});
