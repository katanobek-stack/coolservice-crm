import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { build } = require('esbuild');
const root = process.cwd(), output = path.join(root, 'outputs/cashflow-preview'), fixture = path.join(root, 'web/tests/fixtures/cashflowPreview.tsx');
await mkdir(output, { recursive: true });
await build({ entryPoints: [fixture], bundle: true, format: 'esm', outfile: path.join(output, 'preview.js'), jsx: 'automatic', plugins: [{ name: 'isolated-finance-preview', setup(b) {
  b.onResolve({ filter: /^(\.\.\/auth|\.\.\/\.\.\/shared\/context\/DataContext|\.\/useCashflow|\.\.\/\.\.\/shared\/firebase\/cashflow)$/ }, () => ({ path: fixture }));
} } ] });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ДДС — тестовый просмотр</title><link rel="stylesheet" href="preview.css"><style>body{margin:0;padding:24px;background:#dbe6ef;font-family:Arial,sans-serif}#root{width:100%}@media(max-width:600px){body{padding:8px}}</style><body><div id="root"></div><script type="module" src="preview.js"></script></body></html>');
console.log(output);
