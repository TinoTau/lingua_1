#!/usr/bin/env node
/**
 * Compute LexiconPatchV4 hash (requires build:main).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);

const patchPath = process.argv[2];
if (!patchPath) {
  console.error('Usage: node scripts/lexicon/compute-patch-hash-v4.mjs <patch.json>');
  process.exit(1);
}

const distHash = path.join(
  root,
  'dist/main/electron-node/main/src/lexicon-patch-v4/patch-hash-v4.js'
);
if (!fs.existsSync(distHash)) {
  console.error('[compute-patch-hash-v4] run npm run build:main first');
  process.exit(1);
}

const { computePatchHashV4 } = require(distHash);
const patch = JSON.parse(fs.readFileSync(path.resolve(patchPath), 'utf8'));
patch.hash = computePatchHashV4(patch);
console.log(JSON.stringify({ patchId: patch.patchId, hash: patch.hash }, null, 2));
