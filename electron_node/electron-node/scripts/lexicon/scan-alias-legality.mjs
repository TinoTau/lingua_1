#!/usr/bin/env node
/**
 * Patch Build Gate — Alias Ownership Contract V1.0.0
 * SSOT: docs/lexicon-v3/ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md
 */
import fs from 'fs';
import path from 'path';
import { scanPatchAliasLegality } from './lib/alias-ownership-contract.mjs';

const patchPath = process.argv[2];
if (!patchPath) {
  console.error('Usage: node scripts/lexicon/scan-alias-legality.mjs <patch.json>');
  process.exit(1);
}

const resolved = path.resolve(patchPath);
const patch = JSON.parse(fs.readFileSync(resolved, 'utf8'));
const hits = scanPatchAliasLegality(patch);

if (hits.length) {
  console.error('[scan-alias-legality] FAIL', JSON.stringify(hits, null, 2));
  process.exit(1);
}

console.log('[scan-alias-legality] PASS', patch.patchId || resolved);
