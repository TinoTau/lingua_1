#!/usr/bin/env node
/**
 * Unique PRODUCTION Full Rebuild entry.
 *
 * Reads formal Source under docs/lexicon-assets/full_rebuild_v1 (+ idiom JSONL + profile-registry).
 * Does NOT read tmp/, does NOT copy from existing production SQLite.
 *
 * Default output: node_runtime/lexicon/_rebuild_candidate
 */
import fs from 'fs';
import path from 'path';
import { parseCliArgs } from './lib/cli-args.mjs';
import { repoRoot } from './lib/paths.mjs';
import { runFullRebuildFromSources } from './lib/full-rebuild-from-csv.mjs';

const args = parseCliArgs(process.argv);
const outDir = path.resolve(
  args.output || args.out || path.join(repoRoot(), 'node_runtime/lexicon/_rebuild_candidate')
);

if (fs.existsSync(outDir)) {
  if (!(args.force === true || args.force === 'true')) {
    console.error(`[lexicon:full-rebuild] destination exists: ${outDir} (pass --force)`);
    process.exit(1);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
}

console.log('[lexicon:full-rebuild] PRODUCTION FULL REBUILD (not seed-only shadow)');
console.log(`[lexicon:full-rebuild] out: ${outDir}`);

// Atomicity Closure: production Full Rebuild defaults to enforce (opt-out: --atomicity-mode=audit).
const atomicityMode =
  args.atomicityMode === 'audit' || args['atomicity-mode'] === 'audit' ? 'audit' : 'enforce';

const result = runFullRebuildFromSources({
  outDir,
  bundleVersion: args.bundleVersion != null ? Number(args.bundleVersion) : undefined,
  atomicityMode,
});

console.log('[lexicon:full-rebuild] OK');
console.log(JSON.stringify({
  schemaVersion: result.manifest.schemaVersion,
  bundleVersion: result.manifest.bundleVersion,
  tables: result.counts,
  checksum: result.checksumHex,
  contentHash: result.contentHash,
  上线计划: result.sampleTerms.上线计划?.id,
  接口文档: result.sampleTerms.接口文档?.id,
  atomicityNote: result.manifest.atomicityNote,
  atomicity: result.manifest.atomicity,
}, null, 2));
