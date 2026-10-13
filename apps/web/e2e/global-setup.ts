import { execSync } from 'node:child_process';
import path from 'node:path';

/** Every run starts from the same seeded state (reset → migrate → seed), so tests are repeatable. */
export default function globalSetup() {
  execSync('npm run db:reset', { cwd: path.resolve(import.meta.dirname, '../../..'), stdio: 'inherit' });
}
