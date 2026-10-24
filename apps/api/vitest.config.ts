import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Tests run against a separate database (clearport_test) and upload folder, so local dev data is never touched.
const env = loadEnv('test', '../..', '');
const testDb = env.DATABASE_URL_TEST ?? env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, '/clearport_test$1');

// The API tests act as the demo user directly (AUTH_REQUIRED=false); auth.test.ts switches sign-in on for itself.
const testEnv = { ...env, DATABASE_URL: testDb ?? '', FILE_DIR: '.data/test-uploads', FILE_STORE: 'local', AUTH_REQUIRED: 'false' };
// Also set on this process so test/global-setup.ts (which runs here, not in a worker) uses the test database.
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: './test/global-setup.ts',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
