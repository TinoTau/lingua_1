#!/usr/bin/env node
/**
 * Compute LexiconPatchV3 hash (requires build:main).
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
  console.error('Usage: node scripts/lexicon/compute-patch-hash.mjs <patch.json>');
  process.exit(1);
}

const distHash = path.join(
  root,
  'dist/main/electron-node/main/src/lexicon-patch-v3/patch-hash.js'
);
if (!fs.existsSync(distHash)) {
  console.error('[compute-patch-hash] run npm run build:main first');
  process.exit(1);
}

const { computePatchHash } = require(distHash);
const patch = JSON.parse(fs.readFileSync(path.resolve(patchPath), 'utf8'));
patch.hash = computePatchHash(patch);
console.log(JSON.stringify({ patchId: patch.patchId, hash: patch.hash }, null, 2));
