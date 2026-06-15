#!/usr/bin/env node
/**
 * Lexicon V2 Phase 0 — shadow build only.
 * Does NOT replace node_runtime/lexicon/current or LexiconRuntime V1.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/cli-args.mjs';
import {
  defaultRegistryPath,
  defaultV2ShadowSeedPath,
  repoRoot,
  resolveV2ShadowInputFiles,
} from './lib/paths.mjs';
import { loadJsonlInputs } from './lib/read-jsonl.mjs';
import { loadRegistry } from './lib/v2-classify-row.mjs';
import { buildV2ShadowBundle } from './lib/build-v2-shadow-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultV2ShadowDir() {
  return path.join(repoRoot(), 'node_runtime', 'lexicon', 'v2_shadow');
}

const args = parseCliArgs(process.argv);
const input = args.input ?? defaultV2ShadowSeedPath();
const registryPath = args.registry ?? defaultRegistryPath();
const bundleDir = args.output ?? defaultV2ShadowDir();
const bundleTag = process.env.V2_BUNDLE_TAG?.trim() || 'v2-shadow';

const v1Current = path.join(repoRoot(), 'node_runtime', 'lexicon', 'current');
const resolvedBundle = path.resolve(bundleDir);
if (path.resolve(v1Current) === resolvedBundle) {
  console.error('[lexicon:build:v2-shadow] refuse to write into V1 current bundle path');
  process.exit(1);
}

let inputFiles;
try {
  inputFiles = resolveV2ShadowInputFiles(input);
} catch (err) {
  console.error('[lexicon:build:v2-shadow]', err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const registry = loadRegistry(registryPath);
const { rows } = loadJsonlInputs(inputFiles);
const inputRoot = path.resolve(input);
const seedRootRel = path.relative(repoRoot(), inputRoot);
const seedInputRels = inputFiles.map((file) => path.relative(repoRoot(), file));

console.log('[lexicon:build:v2-shadow] input root:', seedRootRel);
console.log('[lexicon:build:v2-shadow] input files:', inputFiles.length);
for (const file of inputFiles) {
  console.log('[lexicon:build:v2-shadow]   -', path.relative(repoRoot(), file));
}
console.log('[lexicon:build:v2-shadow] rows:', rows.length);
console.log('[lexicon:build:v2-shadow] output:', resolvedBundle);

const result = buildV2ShadowBundle({
  rows,
  registry,
  bundleDir: resolvedBundle,
  seedRootRel,
  seedInputRels,
  bundleTag,
});

console.log('[lexicon:build:v2-shadow] sqlite →', result.sqlitePath);
console.log('[lexicon:build:v2-shadow] manifest →', path.join(resolvedBundle, 'manifest_v2.json'));
console.log('[lexicon:build:v2-shadow] stats →', result.statsPath);
console.log('[lexicon:build:v2-shadow] rejected →', result.rejectedPath);
console.log(
  `[lexicon:build:v2-shadow] base=${result.baseRows.length} idiom=${result.idiomRows.length} domain=${result.domainRows.length} routing=${result.routingRows.length} rejected=${result.rejected.length}`
);
console.log('[lexicon:build:v2-shadow] rejectStats', result.rejectStats);

if (result.rejected.length > 0) {
  console.warn(
    `[lexicon:build:v2-shadow] completed with ${result.rejected.length} rejected rows (see rejected_v2.jsonl)`
  );
}

console.log('[lexicon:build:v2-shadow] done — V1 runtime unchanged');
