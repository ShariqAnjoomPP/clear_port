/** Applies db/migrations-lite/*.sql in order, each in its own transaction. */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const dir = resolve(import.meta.dirname, '../../../../db/migrations-lite');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const applied = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) continue;
  try {
    await client.query('BEGIN');
    await client.query(await readFile(resolve(dir, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`applied ${file}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`failed ${file}:`, (e as Error).message);
    process.exitCode = 1;
    break;
  }
}
await client.end();
