import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from './config';
import * as schema from './schema';

pg.types.setTypeParser(1082, (v) => v); // keep DATE as 'YYYY-MM-DD' strings

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX, // small per Lambda instance
  idleTimeoutMillis: 10_000,
  ssl: config.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: true } : undefined,
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run a query: the pool-backed db or an open transaction. */
export type Q = Db | Tx;

/** Runs `fn` in one transaction: all writes of a command commit or roll back together. */
export const transaction = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => db.transaction(fn);
