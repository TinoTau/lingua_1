#!/usr/bin/env node
/**
 * Phase 4 — 2k ladder acceptance: validate → build → report → manifest gate.
 * Seed dir: data/lexicon/10k/ (run prepare-10k-seed.mjs first).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(electronNodeRoot, '../..');

const seedDirRel = 'data/lexicon/10k';
const seedInputRel = 'data/lexicon/10k/lexicon_10k_canonical_merged.jsonl';
const seedDir = path.join(electronNodeRoot, seedDirRel);
const bundleDir = path.join(repoRoot, 'node_runtime', 'lexicon', 'current');
const gatePath = path.join(
  repoRoot,
  'electron_node/docs/lexicon-assets/Lexicon_Phase5_Evaluation_Package/phase5_10k_manifest_gate.json'
);
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

function checkGate(manifest) {
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf-8'));
  const enabled = manifest.enabledCount ?? manifest.enabled_term_count ?? 0;
  const confusionCount = manifest.confusion_count ?? manifest.confusionCount ?? 0;

  if (manifest.schemaVersion !== gate.schemaVersion) {
    throw new Error(`schemaVersion expected ${gate.schemaVersion}`);
  }
  if (enabled < gate.expectedLexiconCountMin) {
    throw new Error(`enabledCount ${enabled} < min ${gate.expectedLexiconCountMin}`);
  }
  if (gate.requirePinyinIndex && (manifest.pinyinIndexCount ?? 0) <= 0) {
    throw new Error('pinyinIndexCount must be > 0');
  }
  if ((manifest.aliasIndexCount ?? 0) < gate.expectedAliasIndexCountMin) {
    throw new Error(`aliasIndexCount ${manifest.aliasIndexCount} < min ${gate.expectedAliasIndexCountMin}`);
  }
  if (gate.requireExactIndex && (manifest.exactIndexCount ?? 0) <= 0) {
    throw new Error('exactIndexCount must be > 0');
  }
  if (manifest.confusion_count != null || manifest.confusionCount != null) {
    throw new Error('manifest must not include confusion_count (canonical-only)');
  }
  if (gate.requireChecksum && !manifest.checksum) {
    throw new Error('manifest.checksum required');
  }
  for (const domain of ['travel', 'transport', 'restaurant', 'tech_ai']) {
    if ((manifest.domainDistribution?.[domain] ?? 0) <= 0) {
      throw new Error(`domainDistribution.${domain} must be > 0`);
    }
  }
  console.log('[10k-pilot] PASS manifest gate');
  return { gate, enabled, lexiconCount };
}

run('prepare', process.execPath, [path.join(__dirname, 'prepare-10k-seed.mjs')]);

if (!fs.existsSync(seedDir)) {
  console.error(`[10k-pilot] missing seed dir after prepare: ${seedDir}`);
  process.exit(1);
}
run('validate', process.execPath, [
  path.join(__dirname, 'validate-lexicon-seed.mjs'),
  '--input',
  seedInputRel,
  '--strict',
  '--report',
  'data/lexicon/10k/lexicon_10k_validation-report.json',
]);
run('build', process.execPath, [
  path.join(__dirname, 'build-for-electron.mjs'),
  '--input',
  seedInputRel,
]);
run('report', process.execPath, [path.join(__dirname, 'report.mjs')]);

const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf-8'));
const gateResult = checkGate(manifest);

const falseRepairPath = path.join(__dirname, 'eval-false-repair.mjs');
if (fs.existsSync(falseRepairPath)) {
  run('false-repair-eval', process.execPath, [falseRepairPath]);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      enabledCount: gateResult.enabled,
      lexiconCount: gateResult.lexiconCount,
      pinyinIndexCount: manifest.pinyinIndexCount,
      aliasIndexCount: manifest.aliasIndexCount,
      checksum: manifest.checksum,
    },
    null,
    2
  )
);
