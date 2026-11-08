import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
const root = 'dist/client';
const page = await readFile(root + '/index.html', 'utf8');
for (const name of ['live', 'replay']) {
  await mkdir(root + '/' + name, { recursive: true });
  await writeFile(root + '/' + name + '/index.html', page);
}
await copyFile('assets/mock-evaluation.json', root + '/replay/evaluation-300.json');
