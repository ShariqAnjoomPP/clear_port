import customers from './customers/routes';
import documents from './documents/routes';
import engagement from './engagement/routes';
import fieldops from './fieldops/routes';
import insight from './insight/routes';
import finance from './finance/routes';
import jobs from './jobs/routes';
import publicLinks from './public/routes';
import session from './session/routes';
import settings from './settings/routes';
import workflow from './workflow/routes';

/**
 * Every backend function, keyed by name. Each is mounted at /api/<name>:
 * locally all together on the dev server, in production each as its own Lambda.
 */
export const FUNCTIONS = { session, settings, workflow, customers, jobs, documents, fieldops, finance, engagement, insight, public: publicLinks } as const;
export type FunctionName = keyof typeof FUNCTIONS;
