import type { Table } from 'dexie';
import { uuidv7 } from '@clearport/kernel';
import { ApiProblem, isNetworkError, request } from './api';

/**
 * Offline outbox for field actions (architecture §9). Each action keeps the Idempotency-Key it was created with,
 * so a retry after a dropped connection can never apply twice. Server state wins on conflict.
 */
export interface QueuedAction {
  id: string;
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
  idempotencyKey: string;
  label: string;
  createdAt: string;
  status: 'pending' | 'failed';
  error?: string;
}

type OutboxDb = { actions: Table<QueuedAction, string> };
let dbPromise: Promise<OutboxDb> | null = null;
/** IndexedDB (Dexie) is loaded on first use, keeping it out of the initial bundle. */
function getDb(): Promise<OutboxDb> {
  dbPromise ??= import('dexie').then(({ default: Dexie }) => {
    const d = new Dexie('clearport-outbox') as InstanceType<typeof Dexie> & OutboxDb;
    d.version(1).stores({ actions: 'id, status, createdAt' });
    return d;
  });
  return dbPromise;
}
const changed = () => window.dispatchEvent(new Event('outbox-changed'));

export async function listQueued() {
  return (await getDb()).actions.orderBy('createdAt').toArray();
}

/** Try now; if there is no network, keep it in IndexedDB and report "queued". */
export async function sendOrQueue<T>(method: 'POST' | 'PUT', path: string, body: unknown, label: string): Promise<{ queued: true } | { queued: false; result: T }> {
  const idempotencyKey = uuidv7();
  if (navigator.onLine) {
    try {
      return { queued: false, result: await request<T>(method, path, body, { idempotencyKey }) };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  await (await getDb()).actions.add({ id: uuidv7(), method, path, body, idempotencyKey, label, createdAt: new Date().toISOString(), status: 'pending' });
  changed();
  return { queued: true };
}

let syncing = false;
export async function syncOutbox() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const db = await getDb();
    for (const a of await db.actions.where('status').equals('pending').sortBy('createdAt')) {
      try {
        await request(a.method, a.path, a.body, { idempotencyKey: a.idempotencyKey });
        await db.actions.delete(a.id);
      } catch (e) {
        if (isNetworkError(e)) break;
        const msg = e instanceof ApiProblem ? [e.detail, ...e.errors.map((x) => x.message)].filter(Boolean).join(' · ') : String(e);
        await db.actions.update(a.id, { status: 'failed', error: msg });
      }
      changed();
    }
  } finally {
    syncing = false;
    changed();
  }
}

export async function discardQueued(id: string) {
  await (await getDb()).actions.delete(id);
  changed();
}

export function startOutboxSync() {
  window.addEventListener('online', () => void syncOutbox());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncOutbox());
  setInterval(() => void syncOutbox(), 30_000); // iOS Safari has no Background Sync: sync on focus and on a timer
  void syncOutbox();
}
