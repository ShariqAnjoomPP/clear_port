import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { deleteCookie, setCookie } from 'hono/cookie';
import { config } from '../../lib/config';
import { SESSION_COOKIE } from '../../lib/current-user';
import { db } from '../../lib/db';
import { ApiError } from '../../lib/errors';
import { createFunction, parseBody, requireUser } from '../../lib/http';
import { verifyPassword } from '../../lib/passwords';
import { appUser } from '../../lib/schema';
import { clientAddress, throttle } from '../../lib/throttle';
import { SESSION_TTL_MS, signSession } from '../../lib/tokens';
import { getCompany } from '../settings/service';

// Sign-in and sign-out are open; everything else needs the session cookie.
const app = createFunction({ public: true });

const LoginInput = z.object({ username: z.string().trim().min(1, 'is required').max(80), password: z.string().min(1, 'is required').max(200) });

app.post('/login', async (c) => {
  throttle('login', clientAddress(c.req.header('x-forwarded-for')), 20, 'Too many sign-in attempts. Please wait a few minutes.');
  const { username, password } = await parseBody(c, LoginInput);
  const [u] = await db.select().from(appUser).where(eq(appUser.username, username.toLowerCase()));
  // One answer for an unknown user and a wrong password.
  if (!u || !(await verifyPassword(password, u.passwordHash))) throw new ApiError(401, 'Unauthorized', 'Wrong username or password');
  setCookie(c, SESSION_COOKIE, signSession(u.id), {
    httpOnly: true, sameSite: 'Lax', path: '/', secure: config.NODE_ENV === 'production', maxAge: SESSION_TTL_MS / 1000,
  });
  return c.json({ user: { id: u.id, name: u.name, email: u.email } });
});

app.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Who is signed in, and the agency they work for. */
app.get('/me', requireUser, async (c) => c.json({ user: c.get('user'), company: await getCompany(db) }));

export default app;
