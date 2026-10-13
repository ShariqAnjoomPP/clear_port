// Bundles one Lambda per bounded context (arm64, Node 22) + the workers bundle. Output: dist/<name>/index.mjs
import { build } from 'esbuild';

const contexts = ['auth', 'platform', 'customer', 'clearance', 'workflow', 'fieldops', 'finance', 'engagement', 'insight'];
const common = {
  bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, sourcemap: true, treeShaking: true,
  external: ['@aws-sdk/*'], // provided by the Lambda runtime
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
};
for (const ctx of contexts) {
  await build({ ...common, entryPoints: ['src/lambda/api.ts'], outfile: `dist/api-${ctx}/index.mjs`, define: { __CONTEXT__: JSON.stringify(ctx) } });
}
await build({ ...common, entryPoints: ['src/lambda/workers.ts'], outfile: 'dist/workers/index.mjs' });
console.log(`Built ${contexts.length} API functions + workers into dist/`);
