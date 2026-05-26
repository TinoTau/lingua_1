#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateSeedFiles } from './lib/validate-seed.mjs';
import { defaultRegistryPath } from './lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-validate-'));
const seedPath = path.join(tmp, 'seed.jsonl');

fs.writeFileSync(
  seedPath,
  [
    JSON.stringify({
      type: 'canonical_term',
      word: '测试词',
      domains: ['travel'],
      priorScore: 0.8,
      source: 'test',
      pinyin: 'ce shi ci',
    }),
    JSON.stringify({
      type: 'confusion',
      term: '错词',
      replacement: '测试词',
      pinyin: 'cuo ci',
      source: 'test',
    }),
  ].join('\n') + '\n'
);

const result = validateSeedFiles({
  inputFiles: [seedPath],
  registryPath: defaultRegistryPath(),
  strict: true,
});

assert.strictEqual(result.ok, false, 'confusion row must fail validation');
assert.ok(
  result.errors.some((e) => e.code === 'confusion_row_rejected'),
  'expected confusion_row_rejected error'
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('[validate-seed-rejects-confusion] PASS');
