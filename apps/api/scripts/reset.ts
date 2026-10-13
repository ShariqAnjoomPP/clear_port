/** Drops everything (local development only). */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
await client.connect();
await client.query(`DROP SCHEMA IF EXISTS platform, customer, clearance, workflow, fieldops, finance, engagement, insight, shared CASCADE;
  DROP TABLE IF EXISTS public.schema_migrations;`);
await client.end();
await rm(resolve(process.cwd(), process.env.LOCAL_FILE_DIR ?? '.data/uploads'), { recursive: true, force: true });
console.log('Database reset');
