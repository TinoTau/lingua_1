#!/usr/bin/env node
/**
 * Phase 3 — lexicon 1k pilot acceptance (validate → v2-shadow → prepare → gate).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { runV2RuntimeBuildPipeline } from './lib/run-v2-runtime-build-pipeline.mjs';
import { v3RuntimeDir } from './lib/lexicon-v3-runtime.mjs';
import { V3_SCHEMA_VERSION_V2 } from './lib/lexicon-v3-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeRoot = path.resolve(__dirname, '../..');

const seedRel = 'data/lexicon/pilot/lexicon_1k_pilot_v1.jsonl';
const seedPath = path.join(electronNodeRoot, seedRel);
const bundleDir = v3RuntimeDir();

function run(label, cmd, args) {
  const result = spawnSync(cmd, args, { cwd: electronNodeRoot, encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`[1k-pilot] FAIL ${label}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  console.log(`[1k-pilot] PASS ${label}`);
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
  if ((tables.term_domain_tags ?? 0) <= 0) {
    throw new Error('manifest.tables.term_domain_tags must be > 0');
  }
  console.log('[1k-pilot] PASS v2 runtime manifest');
}

if (!fs.existsSync(seedPath)) {
  console.error(`[1k-pilot] missing seed: ${seedPath}`);
  console.error('[1k-pilot] run: node scripts/lexicon/sanitize-1k-pilot-seed.mjs');
  process.exit(1);
}

run('sanitize', process.execPath, [path.join(__dirname, 'sanitize-1k-pilot-seed.mjs')]);
runV2RuntimeBuildPipeline({
  input: seedRel,
  bundleTag: 'pilot-1k',
  validateReport: 'data/lexicon/pilot/lexicon_1k_validation-report.json',
});

const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf-8'));
checkV2Manifest(manifest);
console.log(
  JSON.stringify(
    {
      ok: true,
      schemaVersion: manifest.schemaVersion,
      tables: manifest.tables,
      checksum: manifest.checksum,
      bundleDir,
    },
    null,
    2
  )
);
