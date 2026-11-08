import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

await build({
  entryPoints: ['deploy/sites-worker.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  loader: { '.html': 'text', '.css': 'text' },
  plugins: [{
    name: 'inline-live-browser-script',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]public[\\/]live[\\/]live\.js$/ }, async ({ path }) => ({
        contents: await readFile(path, 'utf8'), loader: 'text',
      }));
    },
  }],
});
