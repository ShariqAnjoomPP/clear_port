import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import type { AppEnv } from './lib/http';

/**
 * Wraps one function as an AWS Lambda handler, mounted at the same /api/<name> path
 * API Gateway forwards to it. The build generates one entry per function that calls this.
 */
export const lambdaFor = (name: string, fn: Hono<AppEnv>) => handle(new Hono().route(`/api/${name}`, fn));
