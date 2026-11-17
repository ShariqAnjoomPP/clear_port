// Bundles each function in src/functions/<name>/routes.ts into its own Lambda: dist/<name>/index.mjs (Node 22, arm64).
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const fnDir = resolve(root, 'src/functions');
const names = [];
for (const entry of await readdir(fnDir)) {
  if ((await stat(resolve(fnDir, entry))).isDirectory()) names.push(entry);
}

for (const name of names) {
  await build({
    stdin: {
      contents: `import fn from './functions/${name}/routes';\nimport { lambdaFor } from './lambda';\nexport const handler = lambdaFor(${JSON.stringify(name)}, fn);\n`,
      resolveDir: resolve(root, 'src'),
      loader: 'ts',
    },
    outfile: resolve(root, `dist/${name}/index.mjs`),
    bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, sourcemap: true,
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    logLevel: 'warning',
  });
}
console.log(`Built ${names.length} functions into dist/: ${names.join(', ')}`);
