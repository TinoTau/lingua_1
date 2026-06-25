#!/usr/bin/env node
/**
 * Industry Pack V1 case manifest validator (V1.1 Addendum §12).
 * Full FW recall/apply execution requires live node + lexicon reload — this script validates schema only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, 'industry-pack-v1-cases.manifest.json');

const ALLOWED_BEHAVIOR = new Set([
  'recall_hit',
  'assembly_selected',
  'apply_expected',
  'apply_not_required',
]);

const cases = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(cases) || cases.length < 1) {
  console.error('[industry-pack-v1-cases] manifest must be non-empty array');
  process.exit(1);
}

let failed = 0;
for (const c of cases) {
  if (!c.id?.trim()) {
    console.error('[industry-pack-v1-cases] missing id');
    failed += 1;
    continue;
  }
  if (!Array.isArray(c.domainScope) || !c.domainScope.length) {
    console.error(`[industry-pack-v1-cases] ${c.id}: domainScope required`);
    failed += 1;
  }
  if (!c.raw?.trim()) {
    console.error(`[industry-pack-v1-cases] ${c.id}: raw required`);
    failed += 1;
  }
  if (!ALLOWED_BEHAVIOR.has(c.expectedBehavior)) {
    console.error(`[industry-pack-v1-cases] ${c.id}: invalid expectedBehavior`);
    failed += 1;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`[industry-pack-v1-cases] PASS — ${cases.length} cases`);
process.exit(0);
