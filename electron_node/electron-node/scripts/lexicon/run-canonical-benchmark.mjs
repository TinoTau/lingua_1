#!/usr/bin/env node
/**
 * Canonical recall benchmark — reads manifest + optional cases JSONL (offline).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultBundleDir } from './lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const args = parseCliArgs(process.argv);
const bundleDir = path.resolve(args.bundle ?? defaultBundleDir());
const manifestPath = path.join(bundleDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('[lexicon:canonical-benchmark] missing manifest');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const casesPath =
  args.cases ??
  path.join(
    repoRoot,
    'docs/lexicon-assets/Lexicon_Phase5_Evaluation_Package/benchmark/canonical_recall_benchmark_cases.jsonl'
  );

let cases = [];
if (fs.existsSync(casesPath)) {
  cases = fs
    .readFileSync(casesPath, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const summary = {
  ok: true,
  bundleDir,
  manifest: {
    lexiconCount: manifest.lexiconCount ?? manifest.hotword_count,
    enabledCount: manifest.enabledCount,
    pinyinIndexCount: manifest.pinyinIndexCount,
    exactIndexCount: manifest.exactIndexCount,
    aliasIndexCount: manifest.aliasIndexCount,
    domainDistribution: manifest.domainDistribution ?? {},
    checksum: manifest.checksum,
  },
  benchmarkCasesLoaded: cases.length,
  notes: 'Runtime TopK/alias hits require dialog_200 or live recall; this script reports bundle readiness.',
};

const outPath = args.output ?? path.join(bundleDir, 'canonical_recall_report.json');
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
console.log(JSON.stringify(summary, null, 2));
console.log(`[lexicon:canonical-benchmark] → ${outPath}`);
