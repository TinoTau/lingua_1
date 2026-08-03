#!/usr/bin/env node
/**
 * Bootstrap: copy v2_shadow → v3 runtime bundle (single manifest layout).
 *
 * NOT PRODUCTION FULL REBUILD.
 * Seed-only shadow MUST NOT be used to overwrite the production Full Rebuild lexicon.
 * Production content rebuild: `npm run lexicon:full-rebuild`.
 */
import fs from 'fs';
import path from 'path';
import { parseCliArgs } from './lib/cli-args.mjs';
import {
  migrateBundleToSingleManifest,
  v2ShadowRuntimeDir,
  v3BundleFiles,
  v3RuntimeDir,
} from './lib/lexicon-v3-runtime.mjs';

const args = parseCliArgs(process.argv);
const force = args.force === true || args.force === 'true';
const srcDir = path.resolve(args.from ?? v2ShadowRuntimeDir());
const destDir = path.resolve(args.output ?? v3RuntimeDir());

function die(msg) {
  console.error('[lexicon:prepare:v3-runtime]', msg);
  process.exit(1);
}

const srcManifestV2 = path.join(srcDir, 'manifest_v2.json');
const srcSqlite = path.join(srcDir, 'lexicon_v2.sqlite');
if (!fs.existsSync(srcManifestV2) || !fs.existsSync(srcSqlite)) {
  die(`missing v2_shadow bundle under ${srcDir} (run npm run lexicon:build:v2-shadow)`);
}

if (fs.existsSync(destDir)) {
  if (!force) {
    die(`destination exists: ${destDir} (pass --force to replace)`);
  }
  fs.rmSync(destDir, { recursive: true, force: true });
}

fs.mkdirSync(path.dirname(destDir), { recursive: true });
fs.cpSync(srcDir, destDir, { recursive: true });

const { migrated, backupDir } = migrateBundleToSingleManifest(destDir);
const files = v3BundleFiles(destDir);
const manifest = JSON.parse(fs.readFileSync(files.manifestPath, 'utf-8'));

// Parent Fragment Full Retirement cutover: bump past prior five-table-v2 identity (bundleVersion 10).
const MIN_RETIREMENT_BUNDLE_VERSION = 11;
if ((manifest.bundleVersion ?? 0) < MIN_RETIREMENT_BUNDLE_VERSION) {
  manifest.bundleVersion = MIN_RETIREMENT_BUNDLE_VERSION;
  const statsPath = files.statsPath;
  const stats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, 'utf-8')) : {};
  stats.bundleVersion = MIN_RETIREMENT_BUNDLE_VERSION;
  fs.writeFileSync(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
}

console.log('[lexicon:prepare:v3-runtime] OK');
console.log(`  from: ${srcDir}`);
console.log(`  to:   ${destDir}`);
console.log(`  migrated: ${migrated}`);
if (backupDir) {
  console.log(`  backup: ${backupDir}`);
}
console.log(`  schemaVersion: ${manifest.schemaVersion}`);
console.log(`  bundleVersion: ${manifest.bundleVersion}`);
console.log(`  tables: ${JSON.stringify(manifest.tables)}`);
