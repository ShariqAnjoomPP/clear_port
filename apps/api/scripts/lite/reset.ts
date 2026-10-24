/** Drops everything in the local database and the uploaded files. Local development only. */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error('db:reset only runs against a local database');

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await client.end();
await rm(resolve(process.cwd(), process.env.FILE_DIR ?? '.data/lite-uploads'), { recursive: true, force: true });
console.log('Database and uploads cleared');
