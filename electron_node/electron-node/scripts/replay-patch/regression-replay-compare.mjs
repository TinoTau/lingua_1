#!/usr/bin/env node
/**
 * Compare two dialog/replay batch result JSON files (before vs after rebuild).
 *
 * Usage:
 *   node scripts/replay-patch/regression-replay-compare.mjs before.json after.json
 */
import fs from 'fs';
import path from 'path';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Usage: node regression-replay-compare.mjs <before.json> <after.json>');
  process.exit(1);
}

function loadSummary(filePath) {
  const data = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  return {
    file: path.resolve(filePath),
    replayBatchId: data.replayBatchId || data.timestamp || null,
    pass: data.summary?.pass ?? data.summary?.passed ?? 0,
    fail: data.summary?.fail ?? data.summary?.failed ?? 0,
    v5: data.summary?.v5_summary || {},
    manifestChecksum: data.summary?.manifest_checksum || null,
    runtimeFeatureDowngrade: data.summary?.runtimeFeatureDowngrade ?? false,
    downgradeReason: data.summary?.downgradeReason ?? null,
  };
}

const before = loadSummary(beforePath);
const after = loadSummary(afterPath);

const report = {
  schemaVersion: 'regression-replay-compare-v1',
  comparedAt: new Date().toISOString(),
  replayBatchId: process.env.REPLAY_BATCH_ID?.trim() || `replay-compare-${Date.now()}`,
  before,
  after,
  patchAcceptanceMetrics: {
    baselineWER: before.fail / Math.max(1, before.pass + before.fail),
    patchedWER: after.fail / Math.max(1, after.pass + after.fail),
  },
  delta: {
    pass: after.pass - before.pass,
    fail: after.fail - before.fail,
    out_of_bundle: (after.v5.out_of_bundle_candidate_count_total ?? 0) - (before.v5.out_of_bundle_candidate_count_total ?? 0),
    no_topk: (after.v5.no_topk_candidate_count ?? 0) - (before.v5.no_topk_candidate_count ?? 0),
  },
};

console.log(JSON.stringify(report, null, 2));
