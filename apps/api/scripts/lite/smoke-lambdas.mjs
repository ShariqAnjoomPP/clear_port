// Loads every built Lambda bundle (dist/<name>/index.mjs) and invokes its handler with an API Gateway HTTP API (v2) event,
// exactly as AWS would. Run after `npm run build`, with the local database up and seeded (an empty database is fine).
// It signs in first (demouser / SEED_DEMO_PASSWORD or Demo@123) and sends the session cookie like API Gateway does.
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = resolve(import.meta.dirname, '../../dist');

/** One request per function: a read that must succeed (public links: an unknown token must be a clean 404). */
const PROBES = {
  session: { path: '/api/session/me', expect: 200, check: (b) => b.user?.name && b.company?.name },
  settings: { path: '/api/settings/staff', query: 'role=PRO', expect: 200, check: (b) => b.items.length > 0 },
  // A write with an invalid JSON body: proves the request body reaches the function through the API Gateway event (nothing is saved).
  'settings (POST)': { fn: 'settings', method: 'POST', path: '/api/settings/staff', body: { name: 'x', role: 'PILOT' }, expect: 400, check: (b) => b.errors?.some((e) => e.path === 'role') },
  workflow: { path: '/api/workflow/definition', expect: 200, check: (b) => b.active.stages.length === 10 },
  customers: { path: '/api/customers', expect: 200, check: (b) => Array.isArray(b.items) },
  jobs: { path: '/api/jobs', query: 'status=OPEN', expect: 200, check: (b) => Array.isArray(b.items) },
  documents: { path: '/api/documents/00000000-0000-7000-8000-000000000000/file', expect: 404 },
  fieldops: { path: '/api/fieldops/ready-containers', expect: 200, check: (b) => Array.isArray(b.items) },
  finance: { path: '/api/finance/receivables', expect: 200, check: (b) => Array.isArray(b.items) },
  engagement: { path: '/api/engagement/alerts', expect: 200, check: (b) => Array.isArray(b.overdue) },
  insight: { path: '/api/insight/dashboard', expect: 200, check: (b) => typeof b.kpis.open_jobs === 'number' },
  public: { path: '/api/public/trips/not-a-real-token', expect: 404 },
  'jobs (signed out)': { fn: 'jobs', path: '/api/jobs', signedOut: true, expect: 401 },
};

const event = ({ path, query = '', method = 'GET', body, cookies = [] }) => ({
  version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: query, cookies,
  headers: { host: 'api.example.com', accept: 'application/json', ...(body && { 'content-type': 'application/json' }) },
  queryStringParameters: query ? Object.fromEntries(new URLSearchParams(query)) : undefined,
  requestContext: { accountId: 'local', apiId: 'local', domainName: 'api.example.com', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'smoke' }, requestId: 'smoke', routeKey: '$default', stage: '$default', time: new Date().toISOString(), timeEpoch: Date.now() },
  body: body ? JSON.stringify(body) : undefined,
  isBase64Encoded: false,
});

const built = new Set((await readdir(dist, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name));
const fnOf = (label) => PROBES[label].fn ?? label;
const missing = [...new Set(Object.keys(PROBES).map(fnOf))].filter((n) => !built.has(n));
let failed = missing.length;
if (missing.length) console.log(`✗ not built: ${missing.join(', ')}`);
const labels = Object.keys(PROBES).filter((l) => built.has(fnOf(l)));

// Sign in through the session Lambda; API Gateway returns Set-Cookie in `cookies` and sends it back in `event.cookies`.
const { handler: sessionFn } = await import(pathToFileURL(resolve(dist, 'session', 'index.mjs')).href);
const login = await sessionFn(event({ method: 'POST', path: '/api/session/login', body: { username: 'demouser', password: process.env.SEED_DEMO_PASSWORD || 'Demo@123' } }), { functionName: 'clearport-session', awsRequestId: 'smoke' });
const session = (login.cookies ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('cp_session='));
console.log(`${session ? '✓' : '✗'} sign-in          POST /api/session/login → ${login.statusCode}`);
if (!session) failed++;

for (const name of labels) {
  const probe = PROBES[name];
  const { handler } = await import(pathToFileURL(resolve(dist, fnOf(name), 'index.mjs')).href);
  const res = await handler(event({ ...probe, cookies: probe.signedOut || !session ? [] : [session] }), { functionName: `clearport-${name}`, awsRequestId: 'smoke' });
  const body = res.body ? JSON.parse(res.isBase64Encoded ? Buffer.from(res.body, 'base64').toString() : res.body) : {};
  const ok = res.statusCode === probe.expect && (!probe.check || probe.check(body));
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(16)} ${probe.method ?? 'GET'} ${probe.path}${probe.query ? `?${probe.query}` : ''} → ${res.statusCode}`);
}
console.log(failed ? `${failed} probe(s) failed` : `All ${new Set(labels.map(fnOf)).size} functions answer correctly as Lambda handlers (${labels.length} probes)`);
process.exit(failed ? 1 : 0);
