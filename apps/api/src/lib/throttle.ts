import { ApiError } from './errors';

/**
 * Small in-memory throttle for no-login endpoints (sign-in, tracking lookup). It counts per process, so on
 * serverless hosting it is a speed bump only; production adds API Gateway / WAF rate limits.
 */
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map<string, number[]>();

export function throttle(bucket: string, client: string, limit: number, message: string) {
  const key = `${bucket}:${client}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) throw new ApiError(429, 'Too many requests', message);
  recent.push(now);
  hits.set(key, recent);
}

/** The caller's address as the proxy reports it (Vercel and API Gateway set x-forwarded-for). */
export const clientAddress = (header: string | undefined) => header?.split(',')[0]?.trim() || 'local';
