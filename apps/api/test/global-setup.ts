import { execSync } from 'node:child_process';

/** Every run starts from the same state: reset → migrate → base seed → demo customers and jobs, on the test database. */
export default function globalSetup() {
  const env = { ...process.env };
  for (const script of ['reset', 'migrate', 'seed', 'demo-data']) {
    execSync(`npx tsx scripts/lite/${script}.ts`, { env, stdio: 'pipe' });
  }
}
