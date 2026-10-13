import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config';
import * as schema from './schema';
import type { DomainEvent } from './events';
import type { Actor } from './context';

pg.types.setTypeParser(1082, (v) => v); // keep DATE as 'YYYY-MM-DD' strings

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 5), // small per Lambda instance; reserved concurrency caps the total
  idleTimeoutMillis: 10_000,
  ssl: config.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: true } : undefined,
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Collects domain events during a command; they are written to the outbox in the same transaction. */
export class UnitOfWork {
  readonly events: DomainEvent[] = [];
  emit(e: DomainEvent) {
    this.events.push(e);
  }
}

type AfterCommit = (tenantId: string, events: DomainEvent[]) => void | Promise<void>;
let afterCommit: AfterCommit = () => {};
/** Wired by the composition root: the outbox fast path publishes right after commit. */
export const setAfterCommit = (fn: AfterCommit) => {
  afterCommit = fn;
};

/**
 * Runs `fn` in one transaction scoped to the actor's tenant (and customer for portal users).
 * RLS policies read these settings, so a missing WHERE clause can never leak another tenant's rows.
 */
export async function withTenant<T>(actor: Pick<Actor, 'tenantId' | 'customerId'>, fn: (tx: Tx, uow: UnitOfWork) => Promise<T>): Promise<T> {
  const uow = new UnitOfWork();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${actor.tenantId}, true), set_config('app.customer_id', ${actor.customerId ?? ''}, true)`);
    const value = await fn(tx, uow);
    if (uow.events.length) {
      await tx.insert(schema.outbox).values(
        uow.events.map((e) => ({ id: e.id, tenantId: e.tenantId, type: e.type, aggregateType: e.aggregateType, aggregateId: e.aggregateId, payload: e.payload, occurredAt: new Date(e.occurredAt) })),
      );
    }
    return value;
  });
  if (uow.events.length) await afterCommit(actor.tenantId, uow.events);
  return result;
}

/** Calls a SECURITY DEFINER lookup function (login, trip link, approval link) outside any tenant. */
export async function definerQuery<T extends pg.QueryResultRow>(text: string, params: unknown[]): Promise<T[]> {
  const r = await pool.query<T>(text, params);
  return r.rows;
}
