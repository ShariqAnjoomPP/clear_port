import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config';

/** Unguessable token for no-login links (customer approval, driver trip, customer portal). */
export const newLinkToken = () => randomBytes(18).toString('base64url');

/**
 * Short-lived token for the public tracking page, issued after a phone number matched: which customers it may see
 * and until when, signed so it cannot be edited. Nothing is stored server-side.
 */
export function signTrackToken(customerIds: string[], ttlMs = 2 * 60 * 60 * 1000): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + ttlMs);
  const payload = Buffer.from(JSON.stringify({ c: customerIds, e: expiresAt.getTime() })).toString('base64url');
  return { token: `${payload}.${mac(payload)}`, expiresAt };
}

/** The customer ids in a valid, unexpired tracking token; null for anything else. */
export function verifyTrackToken(token: string | undefined): string[] | null {
  const [payload, sig] = (token ?? '').split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { c, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { c: string[]; e: number };
    return Array.isArray(c) && typeof e === 'number' && e > Date.now() ? c : null;
  } catch {
    return null;
  }
}

const mac = (payload: string, secret = config.TRACK_SECRET) => createHmac('sha256', secret).update(payload).digest('base64url');

/** Staff sign-in: "<user id>.<expiry>.<signature>", kept in an HttpOnly cookie. Nothing is stored server-side. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export function signSession(userId: string, ttlMs = SESSION_TTL_MS): string {
  const payload = `${userId}.${Date.now() + ttlMs}`;
  return `${payload}.${mac(payload, config.SESSION_SECRET)}`;
}

/** The user id in a valid, unexpired session; null for anything else. */
export function verifySession(token: string | undefined): string | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts as [string, string, string];
  const expected = Buffer.from(mac(`${userId}.${exp}`, config.SESSION_SECRET));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(exp) > Date.now() ? userId : null;
}
