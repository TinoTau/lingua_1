#!/usr/bin/env node
/**
 * 从 dialog-200-batch-result.json 导出 Q1.7 冻结 regression manifest（30 条，按 bucket 配额）。
 *
 * 用法：
 *   node scripts/export-q17-regression-manifest.mjs
 *   node scripts/export-q17-regression-manifest.mjs path/to/dialog-200-batch-result.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BATCH_PATH =
  process.argv[2] ||
  path.join(__dirname, '../tests/dialog-200-batch-result.json');

const OUT_PATH = path.join(
  __dirname,
  '../../docs/recover/v4/q17-regression-manifest.json'
);

const QUOTAS = {
  no_observed_substring: 10,
  pinyin_no_hit: 10,
  normalization_mismatch: 5,
  segment_alignment_risk: 5,
};

function effectiveBucket(row) {
  if ((row.window_candidate_count || 0) > 0) {
    return null;
  }
  const d = row.extra?.window_recall_diagnostics ?? {};
  if (d.noWindowBucket) {
    return d.noWindowBucket;
  }
  const align = row.extra?.segment_alignment_diagnostics?.alignmentStatus;
  if (align === 'mismatched') {
    return 'segment_alignment_risk';
  }
  const hits =
    (d.hitsObserved || 0) +
    (d.hitsPinyin || 0) +
    (d.hitsConfusion || 0) +
    (d.hitsFuzzyObserved || 0);
  if ((d.windowsEnumerated || 0) > 0 && hits === 0) {
    return 'pinyin_no_hit';
  }
  if (hits > 0) {
    return 'normalization_mismatch';
  }
  return 'no_observed_substring';
}

function toEntry(row, bucket) {
  const cov = row.extra?.recall_coverage_diagnostics;
  const d = row.extra?.window_recall_diagnostics ?? {};
  return {
    caseId: row.id,
    bucket,
    windowText: cov?.sampleWindowText ?? row.text_asr_preview?.slice(0, 40) ?? '',
    targetObserved: cov?.closestObserved ?? '',
    expectedCandidate: '',
    currentFailureStage: 'recall_miss',
    whyRejected: cov?.whyRejected ?? null,
    windowsEnumerated: d.windowsEnumerated ?? 0,
    windowCandidateCount: row.window_candidate_count ?? 0,
  };
}

function main() {
  if (!fs.existsSync(BATCH_PATH)) {
    console.error('Missing batch result:', BATCH_PATH);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(BATCH_PATH, 'utf8'));
  const noWindow = report.cases.filter((r) => !r.skip && (r.window_candidate_count || 0) === 0);

  const byBucket = {};
  for (const row of noWindow) {
    const b = effectiveBucket(row);
    if (!b) {
      continue;
    }
    if (!byBucket[b]) {
      byBucket[b] = [];
    }
    byBucket[b].push(row);
  }

  const picked = [];
  const shortfall = {};

  for (const [bucket, quota] of Object.entries(QUOTAS)) {
    const pool = byBucket[bucket] ?? [];
    const take = pool.slice(0, quota);
    shortfall[bucket] = Math.max(0, quota - take.length);
    for (const row of take) {
      picked.push(toEntry(row, bucket));
    }
  }

  let fillFrom = 'no_observed_substring';
  for (const [bucket, need] of Object.entries(shortfall)) {
    if (need <= 0) {
      continue;
    }
    const pool = (byBucket[fillFrom] ?? []).filter(
      (r) => !picked.some((p) => p.caseId === r.id)
    );
    for (const row of pool.slice(0, need)) {
      picked.push(toEntry(row, bucket));
    }
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    sourceBatch: BATCH_PATH,
    kpi: 'window_candidates_nonempty_count >= 130/200',
    quotas: QUOTAS,
    shortfall,
    cases: picked,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('Wrote', OUT_PATH);
  console.log('Picked', picked.length, 'cases');
  console.log('Shortfall', JSON.stringify(shortfall));
}

main();
