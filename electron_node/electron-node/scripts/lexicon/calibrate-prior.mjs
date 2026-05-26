#!/usr/bin/env node
/**
 * Offline priorScore calibration report (no runtime mutation).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultBundleDir } from './lib/paths.mjs';
import { priorScoreDistribution, priorHistogram } from './lib/prior-score.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = parseCliArgs(process.argv);
const bundleDir = args.bundle ?? defaultBundleDir();
const manifestPath = path.join(bundleDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('[lexicon:calibrate] missing manifest');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const byDomain = manifest.priorScoreByDomain ?? {};
const outliers = [];
for (const [domain, stats] of Object.entries(byDomain)) {
  if ((stats.maxPriorScore ?? 0) > 0.95) {
    outliers.push({ domain, reason: 'max_prior_above_0.95', max: stats.maxPriorScore });
  }
  if ((stats.avgPriorScore ?? 0) < 0.3) {
    outliers.push({ domain, reason: 'avg_prior_below_0.3', avg: stats.avgPriorScore });
  }
}

const priorScores = [];
const hotwordsPath = path.join(bundleDir, 'hotwords.jsonl');
if (fs.existsSync(hotwordsPath)) {
  for (const line of fs.readFileSync(hotwordsPath, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.prior_score > 0) priorScores.push(row.prior_score);
  }
}
const priorDist = priorScores.length
  ? priorScoreDistribution(priorScores)
  : manifest.priorScoreDistribution ?? priorScoreDistribution([]);
const histogram = priorHistogram(priorScores);

const domainDistribution = manifest.domainDistribution ?? {};
const domainReport = Object.entries(byDomain).map(([domain, stats]) => ({
  domain,
  termCount: domainDistribution[domain] ?? stats.count ?? 0,
  avgPriorScore: stats.avgPriorScore,
  maxPriorScore: stats.maxPriorScore,
}));

const report = {
  ok: outliers.length === 0,
  bundleDir: path.resolve(bundleDir),
  prior_score_scale: manifest.prior_score_scale ?? '0-1',
  priorScoreDistribution: priorDist,
  priorHistogram: histogram,
  priorScoreByDomain: byDomain,
  domainDistributionReport: domainReport,
  topPriorTerms: manifest.topPriorTerms ?? [],
  outliers,
  note: 'Calibration is observational only; rebuild seed to change priorScore.',
};

const domainOutPath = args.domainReport ?? path.join(bundleDir, 'domain_distribution_report.json');
fs.writeFileSync(
  domainOutPath,
  JSON.stringify({ domainDistribution, domainReport, generatedAt: new Date().toISOString() }, null, 2),
  'utf-8'
);

const outPath = args.output ?? path.join(bundleDir, 'calibration-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(JSON.stringify(report, null, 2));
console.log(`[lexicon:calibrate] → ${outPath}`);
