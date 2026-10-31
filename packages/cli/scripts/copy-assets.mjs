import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const target = path.resolve(import.meta.dirname, '../assets');

fs.rmSync(target, { recursive: true, force: true });
for (const folder of ['features', 'templates']) {
  fs.cpSync(path.join(root, folder), path.join(target, folder), { recursive: true });
}
