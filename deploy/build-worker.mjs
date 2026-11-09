import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const page = await readFile('dist/client/live/index.html', 'utf8');
const history = await readFile('dist/client/replay/evaluation.json', 'utf8');
const pdp = await readFile('dist/client/pdp.html', 'utf8');
const assets = Object.fromEntries(await Promise.all([...new Set(page.match(/\/assets\/[\w.-]+\.(?:js|css)/g))].map(async name => [
  name,
  await readFile('dist/client' + name, 'utf8'),
])));
await build({
  entryPoints: ['deploy/sites-worker.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  define: { NARA_WORKBENCH_HTML: JSON.stringify(page), NARA_WORKBENCH_ASSETS: JSON.stringify(assets), NARA_PDP_HTML: JSON.stringify(pdp), NARA_EVALUATION_HISTORY: JSON.stringify(history) },
});
