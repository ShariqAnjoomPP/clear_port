import type { Hono } from 'hono';
import { enableOutboxFastPath, registerConsumer } from './shared/bus';
import type { AppEnv } from './shared/context';
import { authRoutes } from './modules/platform/auth-routes';
import { platformRoutes } from './modules/platform/routes';
import { customerRoutes } from './modules/customer/routes';
import { clearanceRoutes } from './modules/clearance/routes';
import { workflowRoutes } from './modules/workflow/routes';
import { approvalToWorkflow } from './modules/workflow/consumers';
import { fieldRoutes, publicTripRoutes, tripProgress } from './modules/fieldops/routes';
import { financeRoutes } from './modules/finance/routes';
import { notificationRoutes, portalRoutes, publicApprovalRoutes } from './modules/engagement/routes';
import { notifier } from './modules/engagement/consumers';
import { insightRoutes } from './modules/insight/routes';
import { jobBoardProjector } from './modules/insight/projector';

/** Composition root: wires adapters to ports and contexts to route prefixes (one prefix = one Lambda in production). */
export const CONTEXTS = {
  auth: (app: Hono<AppEnv>) => app.route('/auth', authRoutes()),
  platform: (app: Hono<AppEnv>) => app.route('/v1/platform', platformRoutes()),
  customer: (app: Hono<AppEnv>) => app.route('/v1/customers', customerRoutes()),
  clearance: (app: Hono<AppEnv>) => app.route('/v1/clearance', clearanceRoutes()),
  workflow: (app: Hono<AppEnv>) => app.route('/v1/workflow', workflowRoutes()),
  fieldops: (app: Hono<AppEnv>) => {
    app.route('/v1/field', fieldRoutes());
    app.route('/public/trips', publicTripRoutes());
  },
  finance: (app: Hono<AppEnv>) => app.route('/v1/finance', financeRoutes()),
  engagement: (app: Hono<AppEnv>) => {
    app.route('/v1/notifications', notificationRoutes());
    app.route('/v1/portal', portalRoutes());
    app.route('/public/approvals', publicApprovalRoutes());
  },
  insight: (app: Hono<AppEnv>) => app.route('/v1/insight', insightRoutes()),
} as const;

export const CONSUMERS = { jobBoardProjector, notifier, approvalToWorkflow, tripProgress } as const;

let booted = false;
export function boot() {
  if (booted) return;
  booted = true;
  Object.values(CONSUMERS).forEach(registerConsumer);
  enableOutboxFastPath();
}
