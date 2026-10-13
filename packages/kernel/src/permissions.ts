/**
 * Role-based access control. One policy map, used by the API (enforcement) and the PWA (hiding actions).
 * Stage permissions follow the pattern `stage.<stageKey>.update` so a PRO can update Bayan but not close a BL.
 */
export const ROLES = ['OWNER', 'ADMIN', 'COORDINATOR', 'PRO', 'INSPECTOR', 'DRIVER', 'ACCOUNTS', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'job.read' | 'job.create' | 'job.update' | 'job.close' | 'job.reopen'
  | 'stage.assign' | `stage.${string}.update`
  | 'document.upload' | 'document.read'
  | 'comment.create'
  | 'customer.read' | 'customer.manage'
  | 'field.read' | 'field.manage'
  | 'disbursement.create' | 'disbursement.reconcile' | 'float.manage'
  | 'invoice.read' | 'invoice.manage'
  | 'report.read'
  | 'admin.users' | 'admin.config'
  | 'portal.access';

const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  OWNER: ['*'],
  ADMIN: ['admin.*', 'job.read', 'customer.read', 'field.read', 'report.read', 'document.read'],
  COORDINATOR: [
    'job.*', 'stage.*', 'document.*', 'comment.create', 'customer.*', 'field.*',
    'disbursement.create', 'invoice.read', 'report.read',
  ],
  PRO: [
    'job.read', 'stage.BAYAN.update', 'stage.DO.update', 'stage.CCRO.update', 'stage.INSPECTION.update',
    'document.*', 'comment.create', 'disbursement.create', 'field.read',
  ],
  INSPECTOR: ['job.read', 'stage.PHYSICAL_INSPECTION.update', 'document.*', 'comment.create', 'field.read'],
  DRIVER: ['job.read', 'stage.TRUCK.update', 'stage.RELEASE.update', 'stage.DELIVERY.update', 'document.*', 'field.read'],
  ACCOUNTS: ['job.read', 'disbursement.*', 'float.manage', 'invoice.*', 'report.read', 'customer.read', 'document.read'],
  CUSTOMER: ['portal.access'],
};

function matches(pattern: string, permission: string): boolean {
  if (pattern === '*') return true;
  const p = pattern.split('.');
  const q = permission.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') return i === p.length - 1 ? true : q[i] !== undefined;
    if (p[i] !== q[i]) return false;
  }
  return p.length === q.length;
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => (ROLE_PERMISSIONS[r] ?? []).some((pattern) => matches(pattern, permission)));
}

export const isStaff = (roles: readonly Role[]): boolean => roles.some((r) => r !== 'CUSTOMER');
