import { z } from 'zod';

/** Environment is parsed once at start-up; a misconfiguration fails fast instead of at the first request. */
const Env = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(5),
  API_PORT: z.coerce.number().default(4000),
  FILE_DIR: z.string().default('.data/lite-uploads'),
  PUBLIC_APP_URL: z.string().default('http://localhost:5173'),
  /** Signs the short-lived tokens of the public tracking page. Set a long random value in production. */
  TRACK_SECRET: z.string().min(16).default('clearport-dev-track-secret-change-me'),
  /** Staff app sign-in. Off only in the API tests, which act as the demo user directly. */
  AUTH_REQUIRED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Signs the staff sign-in cookie. Set a long random value in production. */
  SESSION_SECRET: z.string().min(16).default('clearport-dev-session-secret-change-me'),
  /** Where uploaded files live: local disk (dev) or the database (free hosting without a disk). */
  FILE_STORE: z.enum(['local', 'db']).default('local'),
  /** Phone lookups allowed per IP per 15 minutes on the tracking page. */
  TRACK_LOOKUPS_PER_15MIN: z.coerce.number().int().min(1).default(10),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', z.treeifyError(parsed.error));
  throw new Error('Invalid environment configuration — copy .env.example to .env');
}
export const config = parsed.data;
