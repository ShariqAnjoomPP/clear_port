import { and, eq, inArray, sql } from 'drizzle-orm';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { config } from '../config';
import { db, definerQuery, setAfterCommit, withTenant, type Tx, type UnitOfWork } from './db';
import type { DomainEvent } from './events';
import { inbox, outbox } from './schema';

/** An idempotent event consumer (one SQS queue per consumer in production). */
export interface Consumer {
  name: string;
  handles: DomainEvent['type'][] | '*';
  handle(event: DomainEvent, tx: Tx, uow: UnitOfWork): Promise<void>;
}

const consumers: Consumer[] = [];
export const registerConsumer = (c: Consumer) => consumers.push(c);

/** Runs one consumer for one event inside the event's tenant, deduplicated through the inbox table. */
export async function deliver(consumer: Consumer, event: DomainEvent) {
  await withTenant({ tenantId: event.tenantId, customerId: null }, async (tx, uow) => {
    const inserted = await tx.insert(inbox).values({ consumer: consumer.name, eventId: event.id, tenantId: event.tenantId }).onConflictDoNothing().returning();
    if (!inserted.length) return; // already processed
    await consumer.handle(event, tx, uow);
  });
}

async function markPublished(tenantId: string, ids: string[], ok: boolean) {
  await withTenant({ tenantId, customerId: null }, async (tx) => {
    await tx
      .update(outbox)
      .set(ok ? { publishedAt: new Date(), attempts: sql`${outbox.attempts} + 1` } : { attempts: sql`${outbox.attempts} + 1` })
      .where(and(eq(outbox.tenantId, tenantId), inArray(outbox.id, ids)));
  });
}

/** Port: publishes committed events. Local = in-process dispatch; production = EventBridge → SQS per consumer. */
export interface EventPublisher {
  publish(tenantId: string, events: DomainEvent[]): Promise<void>;
}

class LocalPublisher implements EventPublisher {
  async publish(tenantId: string, events: DomainEvent[]) {
    let allOk = true;
    for (const event of events) {
      for (const c of consumers) {
        if (c.handles !== '*' && !c.handles.includes(event.type)) continue;
        try {
          await deliver(c, event);
        } catch (e) {
          allOk = false;
          console.error(JSON.stringify({ level: 'error', consumer: c.name, event: event.type, message: (e as Error).message }));
        }
      }
    }
    await markPublished(tenantId, events.map((e) => e.id), allOk);
  }
}

class EventBridgePublisher implements EventPublisher {
  private client = new EventBridgeClient({ region: config.AWS_REGION });
  async publish(tenantId: string, events: DomainEvent[]) {
    for (let i = 0; i < events.length; i += 10) {
      const batch = events.slice(i, i + 10);
      const r = await this.client.send(
        new PutEventsCommand({
          Entries: batch.map((e) => ({ EventBusName: config.EVENT_BUS_NAME, Source: 'clearport', DetailType: e.type, Detail: JSON.stringify(e) })),
        }),
      );
      await markPublished(tenantId, batch.map((e) => e.id), !r.FailedEntryCount);
    }
  }
}

export const publisher: EventPublisher = config.EVENT_BUS === 'eventbridge' ? new EventBridgePublisher() : new LocalPublisher();

/**
 * Outbox fast path: publish right after commit. Locally it runs in the background (off the request path);
 * on Lambda it is awaited, because a frozen execution environment would otherwise delay it. The relay is the safety net.
 */
export function enableOutboxFastPath(mode: 'background' | 'await' = config.EVENT_BUS === 'eventbridge' ? 'await' : 'background') {
  setAfterCommit((tenantId, events) => {
    const run = () =>
      publisher.publish(tenantId, events).catch((e) => console.error(JSON.stringify({ level: 'warn', message: 'fast-path publish failed; relay will retry', error: (e as Error).message })));
    if (mode === 'await') return run();
    setImmediate(() => void run());
  });
}

/** Outbox relay (EventBridge Scheduler, every minute): republishes anything the fast path missed. */
export async function relayOutbox(limit = 200) {
  const pending = await definerQuery<{ id: string; tenant_id: string }>('select * from shared.pending_outbox($1, $2::interval)', [limit, '30 seconds']);
  const byTenant = new Map<string, string[]>();
  for (const p of pending) byTenant.set(p.tenant_id, [...(byTenant.get(p.tenant_id) ?? []), p.id]);
  for (const [tenantId, ids] of byTenant) {
    const rows = await withTenant({ tenantId, customerId: null }, (tx) => tx.select().from(outbox).where(inArray(outbox.id, ids)));
    const events: DomainEvent[] = rows.map((r) => ({
      id: r.id, type: r.type as DomainEvent['type'], tenantId: r.tenantId, aggregateType: r.aggregateType as DomainEvent['aggregateType'],
      aggregateId: r.aggregateId, payload: r.payload, occurredAt: r.occurredAt.toISOString(),
    }));
    await publisher.publish(tenantId, events);
  }
  return pending.length;
}

export { db };
