#!/usr/bin/env node
/**
 * Read-only audit: KenLM delta + domain metrics across batch; d001 layer summary from batch extra.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BATCH = path.join(__dirname, '../same-domain-per-span-dialog200-batch-result.json');
const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const valid = batch.cases.filter((c) => !c.skip);

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

// Part 3: KenLM delta
const maxDeltas = [];
let applyAt003 = 0;
let applyAt002 = 0;
let applyAt001 = 0;

for (const c of valid) {
  const sr = c.extra?.fw_detector?.sentenceRerank;
  const md = sr?.maxDelta;
  if (typeof md === 'number') {
    maxDeltas.push(md);
    if (md >= 0.03) applyAt003++;
    if (md >= 0.02) applyAt002++;
    if (md >= 0.01) applyAt001++;
  }
}

// Part 2: domain metrics across 81
const domainCand = [];
const baseCand = [];
const activeCount = [];
const poolCount = [];
const utteranceDomains = { restaurant: 0, general: 0, other: 0 };
let zeroDomainCount = 0;

for (const c of valid) {
  const v4 = c.extra?.fw_detector?.spanAssemblyV4;
  if (!v4) continue;
  domainCand.push(v4.domainCandidateCount ?? 0);
  baseCand.push(v4.baseCandidateCount ?? 0);
  activeCount.push(v4.activeCandidateCount ?? 0);
  poolCount.push(v4.windowCandidatePoolCount ?? 0);
  const d = v4.utteranceDomain || 'other';
  if (d === 'restaurant') utteranceDomains.restaurant++;
  else if (d === 'general') utteranceDomains.general++;
  else utteranceDomains.other++;
  if ((v4.domainCandidateCount ?? 0) === 0) zeroDomainCount++;
}

// d001 deep dive from batch
const d001 = valid.find((c) => c.id === 'd001');
const d001fw = d001.extra.fw_detector;
const d001v4 = d001fw.spanAssemblyV4;
const d001sr = d001fw.sentenceRerank;

const d001Spans = d001fw.spans.map((s) => ({
  text: s.text,
  candidates: s.candidates.map((c) => ({
    word: c.word,
    source: c.source,
    repairTarget: c.repairTarget,
    kenlmDelta: c.kenlmDelta,
    selected: c.selected,
  })),
}));

const targetWords = ['中杯', '蓝莓马芬', '少糖', '问一下', '顺便', '钟贝', '蓝美马分', '深便溫', '身边', '申辩'];
const wordInSpans = {};
for (const w of targetWords) {
  wordInSpans[w] = d001Spans
    .filter((s) => s.candidates.some((c) => c.word.includes(w) || w.includes(c.word)))
    .map((s) => ({ span: s.text, words: s.candidates.map((c) => c.word) }));
}

const allSentences = d001sr.topCandidates?.map((t) => t.text) ?? [];
const comboCount = d001sr.combinationCount ?? 0;

const report = {
  part2: {
    n: valid.length,
    domainCandidateCount: { avg: Number(avg(domainCand).toFixed(3)), p50: pct(domainCand, 50), p95: pct(domainCand, 95), zero_cases: zeroDomainCount },
    baseCandidateCount: { avg: Number(avg(baseCand).toFixed(3)), p50: pct(baseCand, 50), p95: pct(baseCand, 95) },
    activeCandidateCount: { avg: Number(avg(activeCount).toFixed(2)), p50: pct(activeCount, 50) },
    utteranceDomain_dist: utteranceDomains,
    zero_domain_pct: Number(((zeroDomainCount / valid.length) * 100).toFixed(1)),
  },
  part3: {
    maxDelta: {
      avg: Number(avg(maxDeltas).toFixed(6)),
      p50: Number(pct(maxDeltas, 50).toFixed(6)),
      p95: Number(pct(maxDeltas, 95).toFixed(6)),
      max: Number(Math.max(...maxDeltas).toFixed(6)),
      min: Number(Math.min(...maxDeltas).toFixed(6)),
      n: maxDeltas.length,
    },
    threshold_003_apply: applyAt003,
    threshold_002_apply: applyAt002,
    threshold_001_apply: applyAt001,
    minDeltaToReplace: d001sr?.minDeltaToReplace,
  },
  d001: {
    raw: d001.raw_asr_preview,
    final: d001.text_asr_preview,
    v4_metrics: {
      activeCandidateCount: d001v4.activeCandidateCount,
      domainCandidateCount: d001v4.domainCandidateCount,
      baseCandidateCount: d001v4.baseCandidateCount,
      sameDomainCandidateCount: d001v4.sameDomainCandidateCount,
      utteranceDomain: d001v4.utteranceDomain,
      mainDomainAwareSpanSetsTotal: d001v4.mainDomainAwareSpanSetsTotal,
      shadowBeamSpanSetsTotal: d001v4.shadowBeamSpanSetsTotal,
      perSpanLimit: d001sr.perSpanLimit,
    },
    spans: d001Spans,
    wordInSpans,
    sentenceRerank: {
      combinationCount: comboCount,
      kenlmQueryCount: d001sr.kenlmQueryCount,
      pickedIsRaw: d001sr.pickedIsRaw,
      maxDelta: d001sr.maxDelta,
      topCandidates: d001sr.topCandidates,
      allCombinationDeltas: d001sr.allCombinationDeltas,
    },
    sentences_containing: {
      中杯: allSentences.filter((t) => t.includes('中杯')),
      蓝莓马芬: allSentences.filter((t) => t.includes('蓝莓马芬')),
      顺便: allSentences.filter((t) => t.includes('顺便')),
      问一下: allSentences.filter((t) => t.includes('问一下')),
    },
  },
};

const outPath = path.join(__dirname, 'domain-recall-candidate-flow-audit.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
