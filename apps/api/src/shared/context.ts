import type { Role } from '@clearport/kernel';

export type ActorKind = 'user' | 'driver-link' | 'approval-link' | 'system';

export interface Actor {
  kind: ActorKind;
  userId: string | null;
  tenantId: string;
  name: string;
  roles: Role[];
  customerId: string | null;
  email?: string;
}

export interface RequestMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const systemActor = (tenantId: string): Actor => ({ kind: 'system', userId: null, tenantId, name: 'ClearPort', roles: ['OWNER'], customerId: null });

/** Hono context variables shared by all modules. */
export type AppEnv = { Variables: { actor: Actor; meta: RequestMeta } };
