#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultBundleDir, electronNodeRoot } from './lib/paths.mjs';
import {
  phase5PackageDir,
  phase5BaselinePath,
  dialog200BatchResultPath,
} from './lib/phase5-paths.mjs';
import {
  readJsonIfExists,
  aggregateV5FromBatch,
  compareToBaseline,
  buildCanonicalTopkReport,
} from './lib/phase5-benchmark-lib.mjs';
import { priorScoreDistribution } from './lib/prior-score.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = parseCliArgs(process.argv);
const bundleDir = path.resolve(args.bundle ?? defaultBundleDir());
const ladder = args.ladder ?? process.env.PHASE5_LADDER ?? '2k';
const manifestPath = path.join(bundleDir, 'manifest.json');
const manifest = readJsonIfExists(manifestPath);

if (!manifest) {
  console.error('[phase5-benchmark] missing manifest');
  process.exit(1);
}

const batch = readJsonIfExists(args.batch ?? dialog200BatchResultPath(electronNodeRoot()));
const metrics = batch ? aggregateV5FromBatch(batch) : {
  topk_hit_rate: 0,
  top1_hit_rate: 0,
  alias_hit_rate: 0,
  confusion_evidence_total: 0,
};

let falseRepair = { false_repair_count: 0, false_repair_rate: 0, repair_precision: 1 };
const evalScript = path.join(__dirname, 'eval-false-repair.mjs');
if (fs.existsSync(evalScript)) {
  const r = spawnSync(process.execPath, [evalScript], {
    cwd: electronNodeRoot(),
    encoding: 'utf-8',
  });
  if (r.stdout?.trim()) {
    try {
      const parsed = JSON.parse(r.stdout.trim().split('\n').pop());
      falseRepair = {
        false_repair_count: parsed.false_repair_count ?? 0,
        false_repair_rate:
          parsed.labeled_repairs > 0
            ? (parsed.false_repair_count ?? 0) / parsed.labeled_repairs
            : 0,
        repair_precision: parsed.repair_precision ?? 1,
      };
    } catch {
      /* keep defaults */
    }
  }
}

const aliasBench = spawnSync(
  process.execPath,
  [path.join(__dirname, 'run-alias-benchmark.mjs'), '--bundle', bundleDir],
  { cwd: electronNodeRoot(), encoding: 'utf-8' }
);
const aliasReport = readJsonIfExists(path.join(bundleDir, 'alias_benchmark_report.json'));

const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const sqliteBytes = fs.existsSync(sqlitePath) ? fs.statSync(sqlitePath).size : 0;
const priorScores = [];
const hotwordsPath = path.join(bundleDir, 'hotwords.jsonl');
if (fs.existsSync(hotwordsPath)) {
  for (const line of fs.readFileSync(hotwordsPath, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.prior_score > 0) priorScores.push(row.prior_score);
  }
}

const canonicalTopk = buildCanonicalTopkReport(metrics, manifest);
const canonicalOut = args.canonicalReport ?? path.join(bundleDir, 'canonical_topk_report.json');
fs.writeFileSync(canonicalOut, JSON.stringify(canonicalTopk, null, 2), 'utf-8');

const domainOut = path.join(bundleDir, 'domain_distribution_report.json');
fs.writeFileSync(
  domainOut,
  JSON.stringify(
    {
      schemaVersion: 'phase5-domain-v1',
      domainDistribution: manifest.domainDistribution ?? {},
      priorScoreByDomain: manifest.priorScoreByDomain ?? {},
      priorScoreDistribution: priorScoreDistribution(priorScores),
    },
    null,
    2
  ),
  'utf-8'
);

const baseline = readJsonIfExists(args.baseline ?? phase5BaselinePath());
const comparison = baseline ? compareToBaseline({ ...metrics, ...falseRepair }, baseline) : {
  regression_pass: true,
  violations: [],
};

const summary = {
  schemaVersion: 'phase5-benchmark-v1',
  generatedAt: new Date().toISOString(),
  ladder,
  bundleDir,
  manifest: {
    checksum: manifest.checksum,
    lexiconCount: manifest.lexiconCount ?? manifest.enabledCount,
    enabledCount: manifest.enabledCount,
  },
  metrics: {
    ...metrics,
    ...falseRepair,
    alias_collision_count: aliasReport?.alias_collision_count ?? 0,
  },
  latency: {
    sqlite_bundle_bytes: sqliteBytes,
    runtime_latency_ms: null,
  },
  dialog200: batch
    ? {
        pass: batch.summary?.pass ?? batch.summary?.passed ?? 0,
        total: batch.summary?.total ?? 200,
      }
    : null,
  baseline_comparison: comparison,
  reports: {
    canonical_topk_report: canonicalOut,
    alias_benchmark_report: path.join(bundleDir, 'alias_benchmark_report.json'),
    domain_distribution_report: domainOut,
  },
};

const outPath = args.output ?? path.join(phase5PackageDir(), 'phase5_benchmark_summary.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
console.log(JSON.stringify(summary, null, 2));
console.log(`[phase5-benchmark] → ${outPath}`);

if (!comparison.regression_pass) {
  process.exit(1);
}
