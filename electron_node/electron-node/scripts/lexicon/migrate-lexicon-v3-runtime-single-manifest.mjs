#!/usr/bin/env node
/**
 * Migrate node_runtime/lexicon/v3 from dual manifest → single manifest.json layout.
 */
import { parseCliArgs } from './lib/cli-args.mjs';
import {
  isSingleManifestLayout,
  migrateBundleToSingleManifest,
  v3BundleFiles,
  v3RuntimeDir,
} from './lib/lexicon-v3-runtime.mjs';

const args = parseCliArgs(process.argv);
const bundleDir = args.output ?? args.bundle ?? v3RuntimeDir();

function die(msg) {
  console.error('[lexicon:migrate:v3-runtime]', msg);
  process.exit(1);
}

try {
  if (isSingleManifestLayout(bundleDir)) {
    console.log('[lexicon:migrate:v3-runtime] already single-manifest layout — skip');
    console.log(`  path: ${bundleDir}`);
    process.exit(0);
  }

  const result = migrateBundleToSingleManifest(bundleDir);
  const files = v3BundleFiles(bundleDir);
  console.log('[lexicon:migrate:v3-runtime] OK');
  console.log(`  path: ${bundleDir}`);
  if (result.backupDir) {
    console.log(`  backup: ${result.backupDir}`);
  }
  console.log(`  manifest: ${files.manifestPath}`);
  console.log(`  sqlite:   ${files.sqlitePath}`);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
