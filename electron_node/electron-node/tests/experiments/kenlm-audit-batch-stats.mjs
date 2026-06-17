#!/usr/bin/env node
/** Read-only KenLM audit stats from dialog200 batch */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.join(__dirname, '../same-domain-per-span-dialog200-batch-result.json');
const MANIFEST = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');

const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

const valid = batch.cases.filter((c) => !c.skip);

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

const stats = {
  n: valid.length,
  kenlmQueryCount: [],
  combinationCount: [],
  maxDelta: [],
  pickedIsRaw: 0,
  applied: 0,
  gate: { delta: 0, pickedIsRaw: 0, noCombinations: 0, noScorer: 0, other: 0 },
  deltaBuckets: { negative: 0, zero: 0, '0-0.001': 0, '0.001-0.01': 0, '0.01-0.03': 0, '>=0.03': 0 },
  samples: [],
};

for (const c of valid) {
  const sr = c.extra?.fw_detector?.sentenceRerank ?? {};
  const md = sr.maxDelta ?? 0;
  stats.maxDelta.push(md);
  stats.kenlmQueryCount.push(sr.kenlmQueryCount ?? 0);
  stats.combinationCount.push(sr.combinationCount ?? 0);
  if (sr.pickedIsRaw) stats.pickedIsRaw += 1;
  const applied = c.extra?.fw_detector?.summary?.appliedCount ?? 0;
  if (applied > 0) stats.applied += 1;

  if ((sr.combinationCount ?? 0) === 0) stats.gate.noCombinations += 1;
  else if (md < 0.03) stats.gate.delta += 1;
  else if (sr.pickedIsRaw) stats.gate.pickedIsRaw += 1;
  else stats.gate.other += 1;

  if (md < 0) stats.deltaBuckets.negative += 1;
  else if (md === 0) stats.deltaBuckets.zero += 1;
  else if (md < 0.001) stats.deltaBuckets['0-0.001'] += 1;
  else if (md < 0.01) stats.deltaBuckets['0.001-0.01'] += 1;
  else if (md < 0.03) stats.deltaBuckets['0.01-0.03'] += 1;
  else stats.deltaBuckets['>=0.03'] += 1;
}

// d001 + 20 samples by maxDelta desc (apply=0 all)
const sorted = [...valid].sort((a, b) => (b.extra?.fw_detector?.sentenceRerank?.maxDelta ?? 0) - (a.extra?.fw_detector?.sentenceRerank?.maxDelta ?? 0));
const pickIds = ['d001', ...sorted.filter((c) => c.id !== 'd001').slice(0, 20).map((c) => c.id)];

for (const id of pickIds) {
  const c = valid.find((x) => x.id === id);
  if (!c) continue;
  const raw = (c.raw_asr_preview || '').trim();
  const sr = c.extra?.fw_detector?.sentenceRerank ?? {};
  const top = sr.topCandidates?.[0];
  stats.samples.push({
    id,
    raw: raw.slice(0, 100),
    ref: (refById[id] || '').slice(0, 100),
    maxDelta: sr.maxDelta,
    pickedIsRaw: sr.pickedIsRaw,
    combinationCount: sr.combinationCount,
    kenlmQueryCount: sr.kenlmQueryCount,
    best: top?.text?.slice(0, 100),
    replacementCount: top?.replacementCount,
    allDeltas: sr.allCombinationDeltas,
  });
}

const out = {
  summary: {
    n: stats.n,
    pickedIsRaw_count: stats.pickedIsRaw,
    applied_count: stats.applied,
    kenlmQueryCount_avg: Math.round(avg(stats.kenlmQueryCount)),
    combinationCount_avg: Number(avg(stats.combinationCount).toFixed(2)),
    maxDelta_avg: Number(avg(stats.maxDelta).toFixed(6)),
    maxDelta_p50: Number(pct(stats.maxDelta, 50).toFixed(6)),
    maxDelta_p95: Number(pct(stats.maxDelta, 95).toFixed(6)),
    maxDelta_max: Number(Math.max(...stats.maxDelta).toFixed(6)),
    gate: stats.gate,
    deltaBuckets: stats.deltaBuckets,
    avg_queries_per_case: Number(avg(stats.kenlmQueryCount).toFixed(2)),
    avg_combinations_plus_raw: Number((avg(stats.combinationCount) + 1).toFixed(2)),
  },
  samples: stats.samples,
};

const outPath = path.join(__dirname, 'kenlm-audit-batch-stats.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
