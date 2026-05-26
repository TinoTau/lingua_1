#!/usr/bin/env node
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultRegistryPath, defaultSeedPath } from './lib/paths.mjs';
import { mergePatchReviewBundle } from './lib/patch-merge.mjs';

const args = parseCliArgs(process.argv);
const reviewPath = args.patches ?? args.positional[0];
const seedPath = args.seed ?? defaultSeedPath();
const outPath = args.output;
const registry = args.registry ?? defaultRegistryPath();

if (!reviewPath || !outPath) {
  console.error(
    'Usage: node scripts/lexicon/patch-merge.mjs <review-bundle.json> --seed <seed.jsonl> --output <merged.jsonl> [--registry profile-registry.json]'
  );
  process.exit(1);
}

const result = mergePatchReviewBundle({ reviewPath, seedPath, outPath, registryPath: registry });
if (!result.ok) {
  console.error('[lexicon:patch-merge] failed');
  console.error(JSON.stringify(result.errors ?? result.validation, null, 2));
  process.exit(1);
}

console.log(`[lexicon:patch-merge] merged ${result.approvedCount} patches → ${result.outPath}`);
