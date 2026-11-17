// Builds the hosted demo in Vercel's prebuilt format (Build Output API v3), so Vercel never has to understand the monorepo:
//   .vercel/output/static/            the web app (apps/web/dist-lite)
//   .vercel/output/functions/api.func  the whole API as one Node 22 function (apps/api/src/vercel.ts, bundled)
//   .vercel/output/config.json        /api/* → the function, files as they are, everything else → index.html
import { execSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.vercel/output');
const region = process.env.VERCEL_FUNCTION_REGION || 'fra1'; // Frankfurt: next to Neon's aws-eu-central-1

await rm(out, { recursive: true, force: true });

// 1. Web app
execSync('npm run build -w @clearport/web', { cwd: root, stdio: 'inherit' });
await cp(resolve(root, 'apps/web/dist-lite'), resolve(out, 'static'), { recursive: true });

// 2. API: one bundle with the workspace packages inlined
const fnDir = resolve(out, 'functions/api.func');
await build({
  entryPoints: [resolve(root, 'apps/api/src/vercel.ts')],
  outfile: resolve(fnDir, 'index.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, sourcemap: true,
  external: ['pg-native'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
await writeFile(resolve(fnDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, regions: [region], maxDuration: 30,
}, null, 2));

// 3. Routing
await writeFile(resolve(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '/api/(.*)', dest: '/api' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2));

await mkdir(out, { recursive: true });
console.log(`Vercel output ready in .vercel/output (function region ${region})`);
