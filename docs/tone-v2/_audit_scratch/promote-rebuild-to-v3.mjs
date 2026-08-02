import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate');
const dst = path.join(repo, 'node_runtime/lexicon/v3');
const files = [
  'lexicon.sqlite',
  'manifest.json',
  'stats.json',
  'checksum.txt',
  'atomicity_report.json',
  'atomicity_report.csv',
  'content.sha256',
];
for (const f of files) {
  const from = path.join(src, f);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(dst, f));
  console.log('copied', f);
}
console.log('checksum', fs.readFileSync(path.join(dst, 'checksum.txt'), 'utf8').trim());
const m = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
console.log('bundleVersion', m.bundleVersion, 'contentHash', m.contentHash || '(see content.sha256)');
