#!/usr/bin/env node
/**
 * Patch Build Gate — granularity + alias ownership (Contract V1.0.0).
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const patches = process.argv.slice(2);

if (!patches.length) {
  console.error('Usage: node scripts/lexicon/run-patch-build-gate.mjs <patch.json> [...]');
  process.exit(1);
}

function run(script, args) {
  const res = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return res.status ?? 1;
}

for (const patch of patches) {
  const rel = path.isAbsolute(patch) ? patch : path.resolve(process.cwd(), patch);
  if (run('scan-patch-granularity.mjs', [rel]) !== 0) {
    process.exit(1);
  }
  if (run('scan-alias-legality.mjs', [rel]) !== 0) {
    process.exit(1);
  }
}

console.log('[patch-build-gate] PASS', patches.join(', '));
