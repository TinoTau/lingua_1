#!/usr/bin/env node
/**
 * P0 granularity denylist scan for LexiconPatchV3 JSON.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { DENY_LIST } = require('./expansion-v1_1/terms-manifest.cjs');

const patchPath = process.argv[2];
if (!patchPath) {
  console.error('Usage: node scripts/lexicon/scan-patch-granularity.mjs <patch.json>');
  process.exit(1);
}

const patch = JSON.parse(fs.readFileSync(path.resolve(patchPath), 'utf8'));
const hits = [];

for (const op of patch.operations || []) {
  const word = op.word || op.entry?.word;
  if (word && DENY_LIST.includes(word)) {
    hits.push({ op: op.op, table: op.table, word, reason: 'denylist canonical' });
  }
  const aliases = op.entry?.aliases || op.fields?.aliases || [];
  for (const a of aliases) {
    if (DENY_LIST.includes(a)) {
      hits.push({ op: op.op, table: op.table, word, alias: a, reason: 'denylist alias' });
    }
    if ([...a].filter((c) => /[\u4e00-\u9fff]/.test(c)).length > 5) {
      hits.push({ op: op.op, table: op.table, alias: a, reason: 'alias length > 5' });
    }
  }
  if (word) {
    const len = [...word].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
    if (len > 5) {
      hits.push({ op: op.op, table: op.table, word, reason: 'canonical length > 5' });
    }
  }
}

if (hits.length) {
  console.error('[scan-patch-granularity] FAIL', JSON.stringify(hits, null, 2));
  process.exit(1);
}
console.log('[scan-patch-granularity] PASS', patch.patchId || patchPath);
