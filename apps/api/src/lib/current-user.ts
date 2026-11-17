import { asc, eq } from 'drizzle-orm';
import { config } from './config';
import { db } from './db';
import { ApiError } from './errors';
import { appUser } from './schema';
import { verifySession } from './tokens';

export type CurrentUser = { id: string; name: string; email: string };

const cache = new Map<string, CurrentUser>();
let firstUser: CurrentUser | undefined;

/** Name of the HttpOnly sign-in cookie. */
export const SESSION_COOKIE = 'cp_session';

export const signedOut = () => new ApiError(401, 'Unauthorized', 'Please sign in.');

/**
 * The signed-in staff user, from the session cookie. With AUTH_REQUIRED=false (the API tests) every request acts as
 * the first seeded user. Replace with real authentication (e.g. Cognito JWT) later; this is the one place.
 */
export async function currentUser(sessionToken: string | undefined): Promise<CurrentUser> {
  if (!config.AUTH_REQUIRED) {
    if (firstUser) return firstUser;
    const [u] = await db.select().from(appUser).orderBy(asc(appUser.createdAt)).limit(1);
    if (!u) throw new Error('No demo user found — run `npm run db:reset`');
    firstUser = { id: u.id, name: u.name, email: u.email };
    return firstUser;
  }
  const id = verifySession(sessionToken);
  if (!id) throw signedOut();
  const hit = cache.get(id);
  if (hit) return hit;
  const [u] = await db.select().from(appUser).where(eq(appUser.id, id));
  if (!u) throw signedOut();
  const user = { id: u.id, name: u.name, email: u.email };
  cache.set(id, user);
  return user;
}
