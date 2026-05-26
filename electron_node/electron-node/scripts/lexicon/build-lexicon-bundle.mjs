#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { parseCliArgs } from './lib/cli-args.mjs';
import {
  defaultBundleDir,
  defaultRegistryPath,
  defaultSeedPath,
  electronNodeRoot,
  repoRoot,
  resolveInputFiles,
} from './lib/paths.mjs';
import { validateSeedFiles } from './lib/validate-seed.mjs';
import { migrateSeedFiles } from './lib/migrate-seed.mjs';
import { buildLexiconBundle } from './lib/build-bundle.mjs';

const args = parseCliArgs(process.argv);
const input = args.input ?? defaultSeedPath();
const registry = args.registry ?? defaultRegistryPath();
const bundleDir = args.output ?? defaultBundleDir();
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const dataDir = path.join(electronNodeRoot(), 'data', 'lexicon');
const reportPath = args.report ?? path.join(bundleDir, 'validation-report.json');
const bundleTag = process.env.BUNDLE_TAG?.trim() || 'final-v1-from-seed';

const inputFiles = resolveInputFiles(input);
fs.mkdirSync(bundleDir, { recursive: true });
const validation = validateSeedFiles({ inputFiles, registryPath: registry, strict: args.strict });
fs.writeFileSync(reportPath, JSON.stringify(validation, null, 2), 'utf-8');

if (!validation.ok) {
  console.error('[lexicon:build] validation failed');
  console.error(JSON.stringify(validation, null, 2));
  process.exit(1);
}

const { hotwords, confusions, errors } = migrateSeedFiles({ inputFiles, registryPath: registry });
if (errors.length) {
  console.error('[lexicon:build] migration errors (validation fail = build fail):');
  errors.forEach((e) => console.error(e));
  process.exit(1);
}
if (!hotwords.length) {
  console.error('[lexicon:build] no hotwords after migration');
  process.exit(1);
}

const withoutPrior = hotwords.filter((h) => h.enabled === 1 && !(h.prior_score > 0));
if (withoutPrior.length) {
  console.error(`[lexicon:build] terms_without_prior_count=${withoutPrior.length}`);
  process.exit(1);
}

const seedRel = path.relative(repoRoot(), path.resolve(input));
const { manifest, indexStats } = buildLexiconBundle({
  hotwords,
  confusions,
  bundleDir,
  sqlitePath,
  seedPath: seedRel,
  bundleTag,
  dataDir,
});

console.log('[lexicon:build] sqlite →', sqlitePath);
console.log('[lexicon:build] manifest →', path.join(bundleDir, 'manifest.json'));
console.log(
  `[lexicon:build] hotwords=${hotwords.length} confusions=${confusions.length} pinyinIndex=${indexStats.pinyinIndexCount} exactIndex=${indexStats.exactIndexCount} aliasIndex=${indexStats.aliasIndexCount}`
);
console.log('[lexicon:build] domainDistribution', manifest.domainDistribution);
