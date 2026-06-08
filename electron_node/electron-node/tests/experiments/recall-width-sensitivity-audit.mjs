#!/usr/bin/env node
/**
 * EXPERIMENT ONLY — Recall Width Sensitivity Audit
 * NOT production defaults. Do not import from main/src.
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
 *   $env:ELECTRON_RUN_AS_NODE = "1"
 *   npx electron tests/experiments/recall-width-sensitivity-audit.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

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
            ? path.join(PROJECT_ROOT, 'electron_node', 'electron-node', 'tmp-experiment')
            : PROJECT_ROOT,
      },
    },
  };
} catch (_) {}

const { recallSpanTopK } = require('../../dist/main/electron-node/main/src/lexicon/local-span-recall.js');
const { buildSentenceCandidates } = require('../../dist/main/electron-node/main/src/fw-detector/build-sentence-candidates.js');
const { rerankFwSentences } = require('../../dist/main/electron-node/main/src/fw-detector/rerank-fw-sentences.js');
const { mapSentenceToApprovedReplacements } = require('../../dist/main/electron-node/main/src/fw-detector/map-sentence-to-approved.js');
const { applyFwSpanReplacements } = require('../../dist/main/electron-node/main/src/fw-detector/apply-span-replacements.js');
const { createKenlmBatchScorer } = require('../../dist/main/electron-node/main/src/asr-repair/sentence-rerank/kenlm-scorer.js');
const { ensureLexiconRuntimeV2Loaded } = require('../../dist/main/electron-node/main/src/lexicon-v2/lexicon-runtime-v2-holder.js');
const { defaultGeneralProfile } = require('../../dist/main/electron-node/main/src/lexicon-v2/profile-registry.js');
const { toneDistance, textToToneSyllables, toneSyllablesKey } = require('../../dist/main/electron-node/main/src/lexicon/phonetic/tone-pinyin.js');

/** EXPERIMENT ONLY — not production getPerSpanCandidateLimit */
const GROUPS = {
  A_baseline: { label: 'Group A baseline', one: 8, two: 4, many: 2 },
  B_medium: { label: 'Group B medium', one: 12, two: 6, many: 3 },
  C_wide: { label: 'Group C wide', one: 16, two: 8, many: 4 },
  D_very_wide: { label: 'Group D very wide', one: 24, two: 12, many: 6 },
};

const MIN_PRIOR = 0.5;
const MIN_DELTA = 0.03;
const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];
const REQUIRE_REPAIR_TARGET = true;

function experimentPerSpanLimit(spanCount, groupKey) {
  const g = GROUPS[groupKey];
  if (spanCount <= 1) return g.one;
  if (spanCount === 2) return g.two;
  return g.many;
}

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

function preCapCount(spanSets) {
  if (!spanSets.length || spanSets.some((s) => !s.length)) return 0;
  return spanSets.reduce((p, s) => p * s.length, 1);
}

function isRefCorrectReplacement(spanText, word, ref) {
  const w = norm(word);
  const s = norm(spanText);
  const r = norm(ref);
  if (!w || w === s) return false;
  if (w.length !== s.length) return false;
  return r.includes(w);
}

function buildFixtures() {
  const fixturePath = path.join(__dirname, 'recall-width-fixtures.json');
  if (fs.existsSync(fixturePath)) {
    const cached = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (cached.fixtures?.length) {
      return cached.fixtures.filter((f) => f.raw && f.spans?.length);
    }
  }
  const perf = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../fw-detector-dialog-200-phase4e-quality-perf.json'), 'utf8')
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
  );
  const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
  const rawById = {};
  for (const lst of [perf.samples?.diffZeroBoundaryPositive, perf.samples?.approvedSpan]) {
    for (const row of lst || []) {
      if (row.raw) rawById[row.id] = row.raw;
    }
  }
  const cases = (perf.samples?.approvedSpan || []).filter((c) => (c.approvedSpanCount || 0) > 0);
  const fixtures = [];
  for (const c of cases) {
    const raw = rawById[c.id];
    const ref = refById[c.id] || '';
    if (!raw) continue;
    const spans = [];
    for (const s of c.spans || []) {
      const idx = raw.indexOf(s.text);
      if (idx < 0) continue;
      spans.push({ text: s.text, start: idx, end: idx + s.text.length });
    }
    if (!spans.length) continue;
    fixtures.push({ id: c.id, scenario: c.scenario, raw, ref, spans });
  }
  return fixtures;
}

function recallSpanSets(rawText, spans, groupKey, profile, ref) {
  const perSpanLimit = experimentPerSpanLimit(spans.length, groupKey);
  const spanSets = [];
  const spanRankRows = [];

  for (const span of spans) {
    const asrToneKey = toneSyllablesKey(textToToneSyllables(span.text));
    const recall = recallSpanTopK(span.text, profile, perSpanLimit, MIN_PRIOR, DOMAINS, {
      perSpanLimit,
    });
    const ranked = recall.hits
      .filter((h) => h.word !== span.text)
      .map((hit) => ({
        word: hit.word,
        source: hit.source,
        priorScore: hit.priorScore,
        repairTarget: hit.repairTarget,
        candidateScore: hit.candidateScore,
        toneDistance: hit.tonePinyinKey
          ? toneDistance(asrToneKey, hit.tonePinyinKey)
          : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => {
        if (a.toneDistance !== b.toneDistance) return a.toneDistance - b.toneDistance;
        if (a.priorScore !== b.priorScore) return b.priorScore - a.priorScore;
        return b.candidateScore - a.candidateScore;
      });

    const picks = ranked.map(({ toneDistance: _td, ...pick }) => ({
      span: { text: span.text, start: span.start, end: span.end },
      ...pick,
    }));
    spanSets.push(picks);

    let correctRank = null;
    const refTargets = [];
    for (let i = 0; i < ranked.length; i++) {
      if (isRefCorrectReplacement(span.text, ranked[i].word, ref)) {
        if (correctRank == null) correctRank = i + 1;
        refTargets.push(ranked[i].word);
      }
    }
    spanRankRows.push({
      spanText: span.text,
      candidates: ranked.map((r, i) => ({ rank: i + 1, word: r.word, source: r.source })),
      refCorrectRank: correctRank,
      refCorrectWords: refTargets,
    });
  }

  return { perSpanLimit, spanSets, spanRankRows };
}

async function runCase(fixture, groupKey, maxSentenceCandidates, kenlmScorer, profile) {
  const t0 = Date.now();
  const { perSpanLimit, spanSets, spanRankRows } = recallSpanSets(
    fixture.raw,
    fixture.spans,
    groupKey,
    profile,
    fixture.ref
  );
  const recallMs = Date.now() - t0;

  const preCap = preCapCount(spanSets);
  const combinations = buildSentenceCandidates(fixture.raw, spanSets, maxSentenceCandidates);
  const postCap = combinations.length;

  const t1 = Date.now();
  const rerank = await rerankFwSentences(
    fixture.raw,
    combinations,
    kenlmScorer,
    MIN_DELTA
  );
  const kenlmMs = Date.now() - t1;

  const approved =
    rerank.pickedIsRaw || !rerank.picked
      ? []
      : mapSentenceToApprovedReplacements(rerank.picked, REQUIRE_REPAIR_TARGET);

  const hypFinal =
    approved.length > 0
      ? applyFwSpanReplacements(fixture.raw, approved)
      : fixture.raw;

  const rawCer = cer(fixture.ref, fixture.raw);
  const finalCer = cer(fixture.ref, hypFinal);

  const top16 = combinations.map((c) => ({
    text: c.text,
    score: c.candidateScore,
    cer: cer(fixture.ref, c.text),
  }));
  const bestTopCer = top16.length
    ? Math.min(...top16.map((x) => x.cer))
    : rawCer;

  return {
    id: fixture.id,
    approvedSpanCount: fixture.spans.length,
    recallCandidateCount: spanSets.reduce((n, s) => n + s.length, 0),
    perSpanLimit,
    preCap,
    postCap,
    truncatedPreCap: preCap > maxSentenceCandidates,
    kenlmQueryCount: rerank.kenlmQueryCount,
    maxDelta: rerank.maxDelta,
    pickedIsRaw: rerank.pickedIsRaw,
    kenlmApproved: approved.length,
    applyCount: approved.length,
    rawCer,
    finalCer,
    cerImproved: finalCer < rawCer - 1e-6,
    cerWorsened: finalCer > rawCer + 1e-6,
    recallMs,
    kenlmMs,
    topCandidates: rerank.topCandidates,
    top16Preview: top16.slice(0, 5),
    spanRankRows,
    hasLocalBetter: bestTopCer < rawCer - 0.02,
    refExactInTop16: top16.some((x) => norm(x.text) === norm(fixture.ref)),
  };
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

function summarizeGroup(caseRows, groupKey, maxSentenceCandidates) {
  const spanTotal = caseRows.reduce((n, c) => n + c.approvedSpanCount, 0);
  const candTotal = caseRows.reduce((n, c) => n + c.recallCandidateCount, 0);
  const maxDeltas = caseRows.map((c) => c.maxDelta).filter((d) => Number.isFinite(d));
  return {
    experimentOnly: true,
    group: groupKey,
    label: GROUPS[groupKey].label,
    limits: GROUPS[groupKey],
    maxSentenceCandidates,
    caseCount: caseRows.length,
    approvedSpanCount: spanTotal,
    recallCandidateCount: candTotal,
    avgCandidatesPerSpan: spanTotal ? candTotal / spanTotal : 0,
    sentenceCandidatePreCapTotal: caseRows.reduce((n, c) => n + c.preCap, 0),
    sentenceCandidatePostCapTotal: caseRows.reduce((n, c) => n + c.postCap, 0),
    preCapGtPostCapCases: caseRows.filter((c) => c.truncatedPreCap).length,
    kenlmQueryCount: caseRows.reduce((n, c) => n + c.kenlmQueryCount, 0),
    maxDelta: {
      min: maxDeltas.length ? Math.min(...maxDeltas) : 0,
      p50: pct(maxDeltas, 50),
      p95: pct(maxDeltas, 95),
      max: maxDeltas.length ? Math.max(...maxDeltas) : 0,
      ge003: maxDeltas.filter((d) => d >= MIN_DELTA).length,
    },
    pickedIsRawCount: caseRows.filter((c) => c.pickedIsRaw).length,
    kenlmApprovedCount: caseRows.reduce((n, c) => n + c.kenlmApproved, 0),
    applyCount: caseRows.reduce((n, c) => n + c.applyCount, 0),
    avgRawCer: caseRows.length
      ? caseRows.reduce((n, c) => n + c.rawCer, 0) / caseRows.length
      : 0,
    avgFinalCer: caseRows.length
      ? caseRows.reduce((n, c) => n + c.finalCer, 0) / caseRows.length
      : 0,
    cerImprovedCount: caseRows.filter((c) => c.cerImproved).length,
    cerWorsenedCount: caseRows.filter((c) => c.cerWorsened).length,
    avgRecallMs: caseRows.length
      ? caseRows.reduce((n, c) => n + c.recallMs, 0) / caseRows.length
      : 0,
    avgKenlmMs: caseRows.length
      ? caseRows.reduce((n, c) => n + c.kenlmMs, 0) / caseRows.length
      : 0,
    refExactInTop16Cases: caseRows.filter((c) => c.refExactInTop16).length,
    localBetterTop16Cases: caseRows.filter((c) => c.hasLocalBetter).length,
  };
}

function rankStats(caseRows) {
  const ranks = [];
  for (const c of caseRows) {
    for (const row of c.spanRankRows || []) {
      if (row.refCorrectRank != null) ranks.push(row.refCorrectRank);
    }
  }
  const spansWithCorrect = caseRows.flatMap((c) =>
    (c.spanRankRows || []).filter((r) => r.refCorrectRank != null)
  );
  const totalSpans = caseRows.reduce((n, c) => n + (c.spanRankRows?.length || 0), 0);
  return {
    spansAnalyzed: totalSpans,
    spansWithRefCorrectInRecall: spansWithCorrect.length,
    inTop1: ranks.filter((r) => r <= 1).length,
    inTop2: ranks.filter((r) => r <= 2).length,
    inTop4: ranks.filter((r) => r <= 4).length,
    inTop8: ranks.filter((r) => r <= 8).length,
    notFound: totalSpans - spansWithCorrect.length,
  };
}

async function main() {
  console.log('[EXPERIMENT ONLY] Recall Width Sensitivity Audit');
  const v2 = ensureLexiconRuntimeV2Loaded();
  if (v2.status !== 'ok') {
    console.error('Lexicon V2 unavailable', v2);
    process.exit(1);
  }
  const profile = defaultGeneralProfile();
  const kenlmScorer = createKenlmBatchScorer();
  if (!kenlmScorer) {
    console.error('KenLM scorer unavailable');
    process.exit(1);
  }

  const fixtures = buildFixtures();
  console.log('[EXPERIMENT] fixtures', fixtures.length);

  const rounds = [
    { groups: ['A_baseline', 'B_medium', 'C_wide', 'D_very_wide'], maxSentenceCandidates: 16 },
    { groups: ['A_baseline', 'C_wide'], maxSentenceCandidates: 32, tag: 'round2_cap32' },
  ];

  const output = {
    experimentOnly: true,
    timestamp: new Date().toISOString(),
    fixtureCount: fixtures.length,
    note: '4E approvedSpan sample replay; not full 89-case batch',
    rounds: [],
  };

  for (const round of rounds) {
    const roundOut = { tag: round.tag || 'round1_cap16', maxSentenceCandidates: round.maxSentenceCandidates, groups: {} };
    for (const groupKey of round.groups) {
      console.log(`[EXPERIMENT] ${groupKey} cap=${round.maxSentenceCandidates}`);
      const caseRows = [];
      for (const fix of fixtures) {
        caseRows.push(await runCase(fix, groupKey, round.maxSentenceCandidates, kenlmScorer, profile));
      }
      roundOut.groups[groupKey] = {
        summary: summarizeGroup(caseRows, groupKey, round.maxSentenceCandidates),
        rankStats: rankStats(caseRows),
        cases: caseRows,
      };
    }
    output.rounds.push(roundOut);
  }

  const outPath = path.join(__dirname, 'recall-width-sensitivity-results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log('[EXPERIMENT] wrote', outPath);
  for (const round of output.rounds) {
    for (const [k, v] of Object.entries(round.groups)) {
      console.log(round.tag || 'r1', k, 'approved', v.summary.kenlmApprovedCount, 'maxDelta>=0.03', v.summary.maxDelta.ge003);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
