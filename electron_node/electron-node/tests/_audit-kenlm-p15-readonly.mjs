#!/usr/bin/env node
/** KenLM P1.5 readonly replay: Recall + Builder vs Dialog200 ref. No product changes. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

// Offline audit: mock Electron app for node-config (no GUI).
try {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: {
        getPath: (name) =>
          name === 'userData'
            ? path.join(PROJECT_ROOT, 'electron_node', 'electron-node', 'tmp-audit')
            : PROJECT_ROOT,
      },
    },
  };
} catch (_) {
  /* electron optional */
}

const { buildSentenceCandidates } = require('../dist/main/electron-node/main/src/fw-detector/build-sentence-candidates.js');
const { getPerSpanCandidateLimit } = require('../dist/main/electron-node/main/src/fw-detector/per-span-candidate-limit.js');
const { LexiconRuntimeV2 } = require('../dist/main/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.js');
const { recallSpanTopKV2 } = require('../dist/main/electron-node/main/src/lexicon-v2/recall-span-topk-v2.js');
const { defaultGeneralProfile } = require('../dist/main/electron-node/main/src/lexicon-v2/profile-registry.js');
const { textToSyllables } = require('../dist/main/electron-node/main/src/lexicon/phonetic/pinyin.js');

const MANIFEST = path.resolve(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json');
const PERF = path.join(__dirname, 'fw-detector-dialog-200-phase4e-quality-perf.json');
const MAX_SENT = 16;
const MIN_PRIOR = 0.5;
const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  const m = r.length;
  const n = h.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        r[i - 1] === h[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n] / r.length;
}

function bucketSource(hit) {
  if (hit.hotword.repairTarget === true) return 'target';
  const domains = hit.hotword.domains?.length ? hit.hotword.domains : hit.hotword.domain ? [hit.hotword.domain] : [];
  if (domains.length) return 'domain';
  return 'base';
}

function findSpanInRaw(raw, spanText) {
  const idx = raw.indexOf(spanText);
  if (idx < 0) return null;
  return { text: spanText, start: idx, end: idx + spanText.length };
}

function classifySpanHit(spanText, word, ref) {
  const r = norm(ref);
  const w = norm(word);
  const s = norm(spanText);
  if (!w || w === s) return 'skip';
  if (r.includes(w) && !r.includes(s)) return 'A';
  if (r.includes(w)) return 'B';
  return 'C';
}

function classifySentence(raw, text, ref) {
  const c = cer(ref, text);
  const r = norm(ref);
  const h = norm(text);
  if (h === norm(raw)) return { class: 'raw', cer: cer(ref, raw) };
  if (c <= 0.05 || r === h) return { class: 'A', cer: c };
  if (c < cer(ref, raw) - 0.02) return { class: 'B', cer: c };
  if (c > cer(ref, raw) + 0.05) return { class: 'C', cer: c };
  return { class: 'B', cer: c };
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
const perf = JSON.parse(fs.readFileSync(PERF, 'utf8'));

const rawById = {};
for (const list of [perf.samples?.diffZeroBoundaryPositive, perf.samples?.approvedSpan]) {
  for (const row of list || []) {
    if (row.raw) rawById[row.id] = row.raw;
  }
}

const cases = (perf.samples?.approvedSpan || []).filter((c) => (c.approvedSpanCount || 0) > 0);
const runtimeV2 = new LexiconRuntimeV2();
const v2 = runtimeV2.load();
if (v2.status !== 'ok') {
  console.error('lexicon v2 unavailable', v2);
  process.exit(1);
}
const profile = defaultGeneralProfile();

const recallStats = { spans: 0, candidates: 0, byTier: { base: 0, domain: 0, target: 0 }, byCount: {} };
const builderStats = { cases: 0, preCapTotal: 0, postCapTotal: 0, truncatedCases: 0 };
const coverage = { refInTop16: 0, refBetterThanRawInTop16: 0, refInPreCap: 0, triggered: 0 };
const quality = { A: 0, B: 0, C: 0, spanTotal: 0 };
const kenlmInput = { semanticOk: 0, noise: 0, hasCorrectFix: 0, totalSentences: 0 };
const samples = [];

for (const c of cases.slice(0, 20)) {
  const raw = rawById[c.id];
  const ref = refById[c.id] || '';
  if (!raw) continue;
  const spans = [];
  for (const s of c.spans || []) {
    const loc = findSpanInRaw(raw, s.text);
    if (!loc) continue;
    spans.push(loc);
  }
  if (!spans.length) continue;

  builderStats.cases += 1;
  coverage.triggered += 1;
  const perSpanLimit = getPerSpanCandidateLimit(spans.length);
  const spanSets = [];

  for (const span of spans) {
    recallStats.spans += 1;
    const syllables = textToSyllables(span.text);
    const { hits } = recallSpanTopKV2(runtimeV2, {
      syllables,
      windowText: span.text,
      termLength: span.text.length,
      topK: perSpanLimit,
      profile,
      domainIds: DOMAINS,
      perSpanLimit,
    });
    const picks = hits
      .filter((h) => h.hotword.word !== span.text && h.hotword.priorScore >= MIN_PRIOR)
      .map((hit) => ({
        span,
        word: hit.hotword.word,
        source: hit.source,
        priorScore: hit.hotword.priorScore,
        repairTarget: hit.hotword.repairTarget === true,
        candidateScore: hit.candidateScore,
        bucket: bucketSource(hit),
      }));
    recallStats.candidates += picks.length;
    recallStats.byCount[picks.length] = (recallStats.byCount[picks.length] || 0) + 1;
    for (const p of picks) {
      recallStats.byTier[p.bucket] = (recallStats.byTier[p.bucket] || 0) + 1;
      const cls = classifySpanHit(span.text, p.word, ref);
      if (cls !== 'skip') {
        quality[cls] += 1;
        quality.spanTotal += 1;
      }
    }
    spanSets.push(picks);
  }

  let preCap = 1;
  for (const set of spanSets) preCap *= Math.max(1, set.length);
  builderStats.preCapTotal += preCap;

  const top16 = buildSentenceCandidates(raw, spanSets, MAX_SENT);
  builderStats.postCapTotal += top16.length;
  if (preCap > MAX_SENT) builderStats.truncatedCases += 1;

  const allCombos = buildSentenceCandidates(raw, spanSets, preCap + 100);
  const refNorm = norm(ref);
  const inPre = allCombos.some((x) => norm(x.text) === refNorm);
  const inTop = top16.some((x) => norm(x.text) === refNorm);
  if (inPre) coverage.refInPreCap += 1;
  if (inTop) coverage.refInTop16 += 1;

  const rawCer = cer(ref, raw);
  const bestTop = top16.reduce(
    (best, x) => (cer(ref, x.text) < best.cer ? { cer: cer(ref, x.text), text: x.text } : best),
    { cer: 1, text: raw }
  );
  if (bestTop.cer < rawCer - 0.001) coverage.refBetterThanRawInTop16 += 1;

  const kenlmSents = [raw, ...top16.map((x) => x.text)];
  for (const sent of kenlmSents) {
    kenlmInput.totalSentences += 1;
    const cl = classifySentence(raw, sent, ref);
    if (cl.class === 'A' || (cl.class === 'B' && cl.cer < rawCer)) kenlmInput.semanticOk += 1;
    if (cl.class === 'C') kenlmInput.noise += 1;
    if (cl.class === 'A' || (cl.class === 'B' && cl.cer <= rawCer)) kenlmInput.hasCorrectFix += 1;
  }

  samples.push({
    id: c.id,
    scenario: c.scenario,
    raw,
    ref,
    spanCount: spans.length,
    preCap,
    top16Count: top16.length,
    truncated: preCap > MAX_SENT,
    refInTop16: inTop,
    refInPreCap: inPre,
    rawCer: +rawCer.toFixed(4),
    bestTop16Cer: +bestTop.cer.toFixed(4),
    spans: spans.map((sp) => ({
      text: sp.text,
      picks: (spanSets.find((set) => set[0]?.span.text === sp.text) || []).map((p) => ({
        word: p.word,
        source: p.source,
        bucket: p.bucket,
        repairTarget: p.repairTarget,
        candidateScore: +p.candidateScore.toFixed(3),
      })),
    })),
    top16: top16.map((x) => ({
      text: x.text,
      score: +x.candidateScore.toFixed(3),
      cer: +cer(ref, x.text).toFixed(4),
    })),
  });
}

const out = {
  lexiconV2: v2.status,
  replayCases: samples.length,
  recallStats,
  builderStats,
  coverage,
  quality,
  kenlmInput,
  samples,
};
const outPath = path.join(__dirname, 'audit-kenlm-p15-readonly-data.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ outPath, ...recallStats, builderStats, coverage, quality, kenlmInput }, null, 2));
