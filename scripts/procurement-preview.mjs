import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(path.resolve('web/package.json'));
const esbuild = require('esbuild');
const output = path.resolve('outputs/procurement-preview');
const input = path.resolve(process.env.PROCUREMENT_CATALOG_FILE || 'outputs/procurement-catalog/catalog-2023-2026.json');
const seed = JSON.parse(await fs.readFile(input, 'utf8'));
await fs.mkdir(output, { recursive: true });
const mock = path.resolve('web/tests/fixtures/procurementPreviewMock.ts');
await esbuild.build({ entryPoints: ['web/tests/fixtures/procurementPreview.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(output, 'preview.js'), plugins: [{ name: 'isolated-procurement-preview', setup(build) { build.onResolve({ filter: /.*/ }, args => { if (!args.path.startsWith('.')) return; const file = path.resolve(args.resolveDir, args.path).replaceAll('\\', '/'); if (['/features/auth', '/shared/context/DataContext', '/shared/firebase/resources', '/shared/firebase/procurement'].some(suffix => file.endsWith(suffix))) return { path: mock }; }); } }] });
await fs.writeFile(path.join(output, 'seed.js'), 'window.procurementSeed=' + JSON.stringify(seed).replaceAll('<', '\\u003c') + ';');
await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Склад CRM — локальная примерка</title><link rel="stylesheet" href="preview.css"><style>:root{--text:#243a4c;--text2:#526779;--text3:#738392;--bg2:#fff;--bg3:#f5f8fa;--border:#dce4eb;--border2:#dce4eb;--accent:#28795e;--accent2:#28795e}*{box-sizing:border-box}body{margin:0;font:14px Arial;background:#f3f6f8;color:var(--text)}#root{max-width:1380px;margin:auto}.preview-banner{padding:15px 28px;background:#e8f2ec;color:#28563e;display:flex;align-items:center;gap:15px;flex-wrap:wrap;font-size:12px}.preview-banner label{margin-left:auto;display:flex;gap:8px;align-items:center}.preview-banner select{border:1px solid #bfd4c6;border-radius:7px;padding:7px;background:#fff;font:inherit}button,input,select{max-width:100%}@media(max-width:600px){.preview-banner{padding:12px}.preview-banner label{margin-left:0}}</style><div id="root"></div><script src="seed.js"></script><script type="module" src="preview.js"></script></html>`);
const allowed = new Set(['index.html', 'preview.js', 'preview.css', 'seed.js']);
const server = http.createServer(async (req, res) => {
  const filename = path.basename(new URL(req.url, 'http://localhost').pathname) || 'index.html';
  if (!allowed.has(filename)) { res.writeHead(404); res.end(); return; }
  try { const body = await fs.readFile(path.join(output, filename)); res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'); res.end(body); } catch { res.writeHead(404); res.end(); }
});
server.listen(4176, '127.0.0.1', () => console.log('Procurement preview: http://127.0.0.1:4176'));
