import { z } from 'zod';

/** Environment is parsed once at cold start; a misconfiguration fails fast instead of at the first request. */
const Env = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().url(),
  AUTH_MODE: z.enum(['dev', 'cognito']).default('dev'),
  JWT_SECRET: z.string().min(32).optional(),
  COGNITO_REGION: z.string().optional(),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  FILE_STORE: z.enum(['local', 's3']).default('local'),
  LOCAL_FILE_DIR: z.string().default('.data/uploads'),
  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().default('me-central-1'),
  EVENT_BUS: z.enum(['local', 'eventbridge']).default('local'),
  EVENT_BUS_NAME: z.string().default('clearport-events'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  SES_FROM_ADDRESS: z.string().optional(),
  API_PORT: z.coerce.number().default(4000),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_APP_URL: z.string().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', z.treeifyError(parsed.error));
  throw new Error('Invalid environment configuration');
}
export const config = parsed.data;

if (config.AUTH_MODE === 'dev' && config.NODE_ENV === 'production') {
  throw new Error('AUTH_MODE=dev must never run in production');
}
if (config.AUTH_MODE === 'dev' && !config.JWT_SECRET) throw new Error('JWT_SECRET is required for AUTH_MODE=dev');
