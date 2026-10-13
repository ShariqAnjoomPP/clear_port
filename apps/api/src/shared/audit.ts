import { uuidv7 } from '@clearport/kernel';
import type { Actor, RequestMeta } from './context';
import type { Tx } from './db';
import { auditEvent } from './schema';

/** Append-only audit trail (BRD ADM-004 / NFR-004). The app role cannot UPDATE or DELETE these rows. */
export async function audit(
  tx: Tx,
  actor: Actor,
  meta: RequestMeta | undefined,
  entry: { action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown },
) {
  await tx.insert(auditEvent).values({
    id: uuidv7(),
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorName: actor.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent?.slice(0, 300) ?? null,
    requestId: meta?.requestId ?? null,
  });
}
