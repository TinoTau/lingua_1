#!/usr/bin/env node
/**
 * Phase 4 — 2k ladder acceptance: validate → v2-shadow → prepare → gate.
 * Seed dir: data/lexicon/10k/ (run prepare-10k-seed.mjs first).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { runV2RuntimeBuildPipeline } from './lib/run-v2-runtime-build-pipeline.mjs';
import { v3RuntimeDir, V3_SCHEMA_VERSION_V2 } from './lib/lexicon-v3-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeRoot = path.resolve(__dirname, '../..');

const seedDirRel = 'data/lexicon/10k';
const seedInputRel = 'data/lexicon/10k/lexicon_10k_canonical_merged.jsonl';
const seedDir = path.join(electronNodeRoot, seedDirRel);
const bundleDir = v3RuntimeDir();

function run(label, cmd, args) {
  const result = spawnSync(cmd, args, { cwd: electronNodeRoot, encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`[10k-pilot] FAIL ${label}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  console.log(`[10k-pilot] PASS ${label}`);
}

function checkV2Manifest(manifest) {
  if (manifest.schemaVersion !== V3_SCHEMA_VERSION_V2) {
    throw new Error(`schemaVersion must be ${V3_SCHEMA_VERSION_V2}, got ${manifest.schemaVersion}`);
  }
  if (!manifest.checksum) {
    throw new Error('manifest.checksum missing');
  }
  const tables = manifest.tables ?? {};
  if ((tables.term ?? 0) <= 0) {
    throw new Error('manifest.tables.term must be > 0');
  }
  console.log('[10k-pilot] PASS v2 runtime manifest');
  return { enabled: tables.term, lexiconCount: tables.term };
}

run('prepare', process.execPath, [path.join(__dirname, 'prepare-10k-seed.mjs')]);

if (!fs.existsSync(seedDir)) {
  console.error(`[10k-pilot] missing seed dir after prepare: ${seedDir}`);
  process.exit(1);
}

runV2RuntimeBuildPipeline({
  input: seedInputRel,
  bundleTag: 'pilot-10k',
  validateReport: 'data/lexicon/10k/lexicon_10k_validation-report.json',
});

const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf-8'));
const gateResult = checkV2Manifest(manifest);

const falseRepairPath = path.join(__dirname, 'eval-false-repair.mjs');
if (fs.existsSync(falseRepairPath)) {
  run('false-repair-eval', process.execPath, [falseRepairPath]);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      schemaVersion: manifest.schemaVersion,
      enabledCount: gateResult.enabled,
      lexiconCount: gateResult.lexiconCount,
      checksum: manifest.checksum,
      bundleDir,
    },
    null,
    2
  )
);
