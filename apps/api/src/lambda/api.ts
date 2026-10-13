import { handle } from 'hono/aws-lambda';
import { boot, CONTEXTS } from '../composition';
import { createApp } from '../shared/http';

/**
 * One Lambda per bounded context (ADR-002). The build bundles this file once per context,
 * with CONTEXT replaced at build time so each bundle mounts only its own routes.
 */
declare const __CONTEXT__: keyof typeof CONTEXTS;
boot();
export const handler = handle(createApp((app) => CONTEXTS[__CONTEXT__](app)));
