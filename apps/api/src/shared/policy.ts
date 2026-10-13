import { can, type Permission } from '@clearport/kernel';
import type { Actor } from './context';
import { forbidden } from './problem';

/** Policy layer: every route calls this before touching data (RBAC). Scope checks (ABAC) live next to queries. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor.roles, permission)) throw forbidden();
}

export const hasPermission = (actor: Actor, permission: Permission) => can(actor.roles, permission);
