#!/usr/bin/env node
/**
 * Phase 3 — lexicon 1k pilot acceptance (validate → build → report → gate).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(electronNodeRoot, '../..');

const seedRel = 'data/lexicon/pilot/lexicon_1k_pilot_v1.jsonl';
const seedPath = path.join(electronNodeRoot, seedRel);
const bundleDir = path.join(repoRoot, 'node_runtime', 'lexicon', 'current');
const gatePath = path.join(
  repoRoot,
  'electron_node/docs/lexicon-assets/Lexicon_1k_Pilot_Phase3_Package/lexicon_1k_expected_manifest_gate.json'
);

function run(label, cmd, args) {
  const result = spawnSync(cmd, args, { cwd: electronNodeRoot, encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`[1k-pilot] FAIL ${label}`);
    if (result.stdout) {
      console.error(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
  console.log(`[1k-pilot] PASS ${label}`);
}

function checkGate(manifest) {
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf-8'));
  const enabled = manifest.enabledCount ?? manifest.enabled_term_count ?? 0;
  const [min, max] = gate.expectedEnabledRange;

  if (manifest.schemaVersion !== gate.schemaVersion) {
    throw new Error(`schemaVersion expected ${gate.schemaVersion}`);
  }
  if (enabled < min || enabled > max) {
    throw new Error(`enabledCount ${enabled} outside [${min}, ${max}]`);
  }
  for (const domain of ['travel', 'transport', 'restaurant', 'tech_ai']) {
    const count = manifest.domainDistribution?.[domain] ?? 0;
    const expected = gate.expectedDomainDistribution?.[domain];
    if (count <= 0) {
      throw new Error(`domainDistribution.${domain} must be > 0`);
    }
    if (expected && Math.abs(count - expected) > 30) {
      console.warn(`[1k-pilot] warn domain ${domain}: built=${count} expected~${expected}`);
    }
  }
  if ((manifest.pinyinIndexCount ?? 0) <= 0) {
    throw new Error('pinyinIndexCount must be > 0');
  }
  if ((manifest.exactIndexCount ?? 0) <= 0) {
    throw new Error('exactIndexCount must be > 0');
  }
  if ((manifest.aliasIndexCount ?? 0) <= 0) {
    throw new Error('aliasIndexCount must be > 0');
  }
  if ((manifest.domainDistribution?.asr ?? 0) > 0) {
    throw new Error('domainDistribution.asr must be 0');
  }
  console.log('[1k-pilot] PASS manifest gate');
}

if (!fs.existsSync(seedPath)) {
  console.error(`[1k-pilot] missing seed: ${seedPath}`);
  console.error('[1k-pilot] run: node scripts/lexicon/sanitize-1k-pilot-seed.mjs');
  process.exit(1);
}

run('sanitize', process.execPath, [path.join(__dirname, 'sanitize-1k-pilot-seed.mjs')]);
run('validate', process.execPath, [
  path.join(__dirname, 'validate-lexicon-seed.mjs'),
  '--input',
  seedRel,
  '--strict',
  '--report',
  'data/lexicon/pilot/lexicon_1k_validation-report.json',
]);
run('build', process.execPath, [path.join(__dirname, 'build-for-electron.mjs'), '--input', seedRel]);
run('report', process.execPath, [path.join(__dirname, 'report.mjs')]);

const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf-8'));
checkGate(manifest);
console.log(JSON.stringify({
  ok: true,
  lexiconCount: manifest.lexiconCount,
  enabledCount: manifest.enabledCount,
  pinyinIndexCount: manifest.pinyinIndexCount,
  exactIndexCount: manifest.exactIndexCount,
  aliasIndexCount: manifest.aliasIndexCount,
  domainDistribution: manifest.domainDistribution,
  checksum: manifest.checksum,
}, null, 2));
