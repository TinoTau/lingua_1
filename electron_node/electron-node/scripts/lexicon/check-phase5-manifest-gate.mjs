#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultBundleDir, repoRoot } from './lib/paths.mjs';
import { phase5GatePath } from './lib/phase5-paths.mjs';

const args = parseCliArgs(process.argv);
const ladder = args.ladder ?? '5k';
const bundleDir = path.resolve(args.bundle ?? defaultBundleDir());
const gatePath = phase5GatePath(ladder);
const manifestPath = path.join(bundleDir, 'manifest.json');

if (!fs.existsSync(gatePath) || !fs.existsSync(manifestPath)) {
  console.error('[phase5-gate] missing gate or manifest');
  process.exit(1);
}

const gate = JSON.parse(fs.readFileSync(gatePath, 'utf-8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const enabled = manifest.enabledCount ?? manifest.enabled_term_count ?? 0;
const countMin = gate.enabledCountMin ?? gate.lexiconCountMin;

if (manifest.schemaVersion !== gate.schemaVersion) {
  throw new Error(`schemaVersion expected ${gate.schemaVersion}`);
}
if (enabled < countMin) {
  throw new Error(`enabledCount ${enabled} < min ${countMin}`);
}
if (gate.requirePinyinIndex && (manifest.pinyinIndexCount ?? 0) <= 0) {
  throw new Error('pinyinIndexCount must be > 0');
}
if (gate.requireExactIndex && (manifest.exactIndexCount ?? 0) <= 0) {
  throw new Error('exactIndexCount must be > 0');
}
if ((manifest.aliasIndexCount ?? 0) < (gate.aliasIndexCountMin ?? gate.expectedAliasIndexCountMin ?? 0)) {
  throw new Error('aliasIndexCount below min');
}
if (manifest.confusion_count != null || manifest.confusionCount != null) {
  throw new Error('manifest must not include confusion_count');
}
if (gate.requireChecksum && !manifest.checksum) {
  throw new Error('checksum required');
}
if (gate.priorScoreScale && manifest.prior_score_scale !== gate.priorScoreScale) {
  throw new Error(`prior_score_scale expected ${gate.priorScoreScale}`);
}
for (const domain of ['travel', 'transport', 'restaurant', 'tech_ai']) {
  if ((manifest.domainDistribution?.[domain] ?? 0) <= 0) {
    throw new Error(`domainDistribution.${domain} must be > 0`);
  }
  const minPerDomain = gate.minPerDomain;
  if (minPerDomain && (manifest.domainDistribution?.[domain] ?? 0) < minPerDomain) {
    throw new Error(`domainDistribution.${domain} < minPerDomain ${minPerDomain}`);
  }
}

console.log(`[phase5-gate] PASS ladder=${ladder} enabled=${enabled}`);
