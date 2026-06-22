#!/usr/bin/env node
/**
 * Import Lexicon V3 Canonical / 5k Asset Package → deploy seed + sqlite bundle + benchmark sync.
 *
 * Usage:
 *   npm run lexicon:import-v3-assets
 *   npm run lexicon:import-v3-5k-assets
 *   node scripts/lexicon/import-v3-canonical-asset.mjs --package "path/to/Lexicon_V3_5k_Canonical_Assets"
 *   node scripts/lexicon/import-v3-canonical-asset.mjs --review-status approved --skip-build
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { parseCliArgs } from './lib/cli-args.mjs';
import { electronNodeRoot, repoRoot, defaultRegistryPath, v3RuntimeDir } from './lib/paths.mjs';
import { runV2RuntimeBuildPipeline } from './lib/run-v2-runtime-build-pipeline.mjs';
import { phase5PackageDir, phase5BenchmarkDir } from './lib/phase5-paths.mjs';
import { validateSeedFiles } from './lib/validate-seed.mjs';
import { sanitizeV3CanonicalSeed } from './lib/v3-import-sanitize.mjs';
import {
  readPackageImportBatch,
  resolveDeployArtifact,
  resolvePackageSeed,
} from './lib/v3-asset-package.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = parseCliArgs(process.argv);

const defaultPackage = path.join(
  repoRoot(),
  'electron_node/docs/lexicon-assets/Lexicon_V3_Canonical_Asset_Package'
);
const default5kPackage = path.join(
  repoRoot(),
  'electron_node/docs/lexicon-assets/Lexicon_V3_5k_Canonical_Assets'
);

const packageDir = path.resolve(
  args.package ?? (args.ladder === '5k' ? default5kPackage : defaultPackage)
);
const artifact = resolveDeployArtifact(packageDir, args.ladder);
const seedIn = resolvePackageSeed(packageDir, args.input ?? args.seed);
const deployDir = path.join(electronNodeRoot(), 'data/lexicon/v3');
const deploySeed = path.join(deployDir, artifact.deployFile);
const registry = args.registry ?? defaultRegistryPath();
const reviewStatusDeploy = args.reviewStatus ?? 'approved';
const importBatchDefault =
  readPackageImportBatch(packageDir) ?? '2026-05-27-v3-canonical-seed';

function copyDirJsonl(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    return 0;
  }
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith('.jsonl')) {
      continue;
    }
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
    n += 1;
  }
  return n;
}

function copyDirJson(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    return 0;
  }
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
    n += 1;
  }
  return n;
}

function run(label, cmd, cmdArgs, opts = {}) {
  console.log(`[import-v3] ${label}...`);
  const r = spawnSync(cmd, cmdArgs, { cwd: electronNodeRoot(), encoding: 'utf-8', ...opts });
  if (r.stdout) {
    process.stdout.write(r.stdout);
  }
  if (r.stderr) {
    process.stderr.write(r.stderr);
  }
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status})`);
  }
}

console.log('[import-v3] package →', packageDir);
console.log('[import-v3] seed in  →', seedIn);
console.log('[import-v3] reviewStatus deploy →', reviewStatusDeploy);

const rawLines = fs.readFileSync(seedIn, 'utf-8').split(/\r?\n/).filter(Boolean);
const { rows: out, stats } = sanitizeV3CanonicalSeed(rawLines, {
  reviewStatusDeploy,
  termIdPrefix: artifact.termIdPrefix,
  importBatchDefault,
});

fs.mkdirSync(deployDir, { recursive: true });
fs.writeFileSync(deploySeed, `${out.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8');
console.log(
  `[import-v3] deploy seed → ${deploySeed} (${stats.deployRows} rows, raw=${stats.rawRows}, merged_dup=${stats.mergedDup}, alias_stripped=${stats.aliasStripped})`
);

const importMeta = {
  packageDir,
  seedIn,
  deploySeed,
  importBatch: importBatchDefault,
  reviewStatusDeploy,
  stats,
  importedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(deployDir, `${path.basename(deploySeed, '.jsonl')}_import_meta.json`),
  JSON.stringify(importMeta, null, 2)
);

const validation = validateSeedFiles({
  inputFiles: [deploySeed],
  registryPath: registry,
  strict: true,
});
const reportPath = path.join(deployDir, `${path.basename(deploySeed, '.jsonl')}_validation-report.json`);
fs.writeFileSync(reportPath, JSON.stringify(validation, null, 2), 'utf-8');

if (!validation.ok) {
  console.error('[import-v3] validation failed after sanitize — see', reportPath);
  const codes = {};
  for (const e of validation.errors) {
    codes[e.code] = (codes[e.code] ?? 0) + 1;
  }
  const wcodes = {};
  for (const w of validation.warnings) {
    wcodes[w.code] = (wcodes[w.code] ?? 0) + 1;
  }
  console.error('[import-v3] error codes:', codes, 'warnings:', wcodes);
  process.exit(1);
}

const approvedCount = out.filter((r) => r.reviewStatus === 'approved').length;
if (reviewStatusDeploy === 'approved' && approvedCount !== out.length) {
  console.error(`[import-v3] expected all approved, got ${approvedCount}/${out.length}`);
  process.exit(1);
}
console.log(`[import-v3] validate --strict PASS ${validation.validRows} rows (approved=${approvedCount})`);

const benchCopied = copyDirJsonl(path.join(packageDir, 'benchmark'), phase5BenchmarkDir());
const reportsCopied = copyDirJson(
  path.join(packageDir, 'reports'),
  path.join(phase5PackageDir(), 'reports')
);
console.log(`[import-v3] benchmark synced (${benchCopied} jsonl), reports synced (${reportsCopied} json)`);

const gate5k = path.join(packageDir, 'gates/phase5_5k_manifest_gate.json');
const gate10k = path.join(packageDir, 'gates/phase5_10k_manifest_gate.json');
if (fs.existsSync(gate5k)) {
  const gate = JSON.parse(fs.readFileSync(gate5k, 'utf-8'));
  gate.enabledCountMin = out.length;
  gate.lexiconCountMin = out.length;
  gate.reviewStatusRequired = 'approved';
  fs.writeFileSync(path.join(phase5PackageDir(), 'phase5_5k_manifest_gate.json'), JSON.stringify(gate, null, 2));
}
if (fs.existsSync(gate10k)) {
  fs.copyFileSync(gate10k, path.join(phase5PackageDir(), 'phase5_10k_manifest_gate.json'));
}
console.log('[import-v3] manifest gates synced (countMin=', out.length, ')');

if (args.skipBuild) {
  console.log('[import-v3] --skip-build: done');
  process.exit(0);
}

const deploySeedRel = path.relative(electronNodeRoot(), deploySeed);
const buildReportRel = path.join(
  'data/lexicon/v3',
  `${path.basename(deploySeed, '.jsonl')}_build-validation-report.json`
);

runV2RuntimeBuildPipeline({
  input: deploySeedRel,
  registry,
  bundleTag: `${artifact.bundleTagPrefix}-${out.length}`,
  validateReport: buildReportRel,
  skipValidate: true,
});

const gateScript = path.join(__dirname, 'check-phase5-manifest-gate.mjs');
run('phase5-gate', process.execPath, [gateScript, '--ladder', artifact.gateLadder]);

console.log('[import-v3] Tip: npm run lexicon:rebuild-sqlite && restart node');
console.log('[import-v3] DONE — v3 runtime bundle at', v3RuntimeDir());
