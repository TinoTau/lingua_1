#!/usr/bin/env node
/** Recall simulation from FW scan output (Electron node for ABI). */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;
const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');

try {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => PROJECT_ROOT } },
  };
} catch (_) {}

const FW_SCAN = path.join(__dirname, 'tone-module-p1-dialog-fw-scan.json');
const P05 = path.join(__dirname, 'tone-module-p05-runtime-validation.json');
const LEX = path.join(__dirname, 'tone-module-p1-lexicon-scan.json');
const OUT = path.join(__dirname, 'tone-module-p1-benefit-audit.json');

const {
  extractAcousticTonePattern,
  isCandidateToneCompatible,
  isToneAlignmentValid,
  resolveCandidateToneKey,
} = require(path.join(DIST, 'fw-detector/tone-match-score.js'));
const { sortRecallHitsByToneCompatibility } = require(path.join(DIST, 'lexicon/tone-recall-sort.js'));
const { recallSpanTopK } = require(path.join(DIST, 'lexicon/local-span-recall.js'));
const { ensureLexiconRuntimeV2Loaded } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2-holder.js'));
const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));

const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];
const MIN_PRIOR = 0.5;

function makeToken(ch, toneNum, start) {
  const posterior = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  posterior[`t${toneNum}`] = 0.88;
  return { token: ch, start, end: start + 0.1, tonePosterior: posterior, confidence: 0.88 };
}

function buildToneFromFw(raw, tokens) {
  return {
    toneEnabled: true,
    alignmentText: raw,
    toneTokens: tokens,
    toneTokenCount: tokens.length,
  };
}

function analyzeSpan(raw, span, tone, golden, caseId) {
  if (!isToneAlignmentValid(raw, tone)) return null;
  const pattern = extractAcousticTonePattern(raw, span.start, span.end, tone);
  if (!pattern?.length) return null;
  const recall = recallSpanTopK(span.text, profile, 8, MIN_PRIOR, DOMAINS, { perSpanLimit: 8 });
  const hits = recall.hits.map((h) => ({
    hotword: { word: h.word, priorScore: h.priorScore, tonePinyinKey: h.tonePinyinKey || resolveCandidateToneKey(h.word) },
    candidateScore: h.candidateScore,
  }));
  const off = sortRecallHitsByToneCompatibility(hits, null);
  const on = sortRecallHitsByToneCompatibility(hits, pattern);
  const goldenSpan = golden?.utterance ? [...golden.utterance].slice(span.start, span.end).join('').replace(/[，。！？、]/g, '') : '';
  const rows = [];
  for (const h of on.hits) {
    const key = h.hotword.tonePinyinKey;
    if (!isCandidateToneCompatible(pattern, key, h.hotword.word)) continue;
    rows.push({
      caseId,
      原词: goldenSpan || span.text,
      ASR词: span.text,
      Recall候选: h.hotword.word,
      acousticTonePattern: pattern,
      candidateTonePattern: key,
      toneCompatible: true,
      offRank: off.hits.findIndex((x) => x.hotword.word === h.hotword.word) + 1,
      onRank: on.hits.findIndex((x) => x.hotword.word === h.hotword.word) + 1,
    });
  }
  return {
    hits: rows,
    diff:
      off.hits[0]?.hotword.word !== on.hits[0]?.hotword.word
        ? {
            caseId,
            span: span.text,
            offTop1: off.hits[0]?.hotword.word,
            onTop1: on.hits[0]?.hotword.word,
            offTop3: off.hits.slice(0, 3).map((h) => h.hotword.word),
            onTop3: on.hits.slice(0, 3).map((h) => h.hotword.word),
            pattern,
          }
        : null,
  };
}

ensureLexiconRuntimeV2Loaded();
const profile = defaultGeneralProfile();
const fwScan = JSON.parse(fs.readFileSync(FW_SCAN, 'utf8'));
const lex = JSON.parse(fs.readFileSync(LEX, 'utf8'));
const p05 = fs.existsSync(P05) ? JSON.parse(fs.readFileSync(P05, 'utf8')) : null;
const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json'), 'utf8'));
const goldenMap = Object.fromEntries(manifest.map((m) => [m.id, m]));

const trueHits = [];
const onOffDiffs = [];

for (const c of fwScan.cases) {
  if (!c.raw || !c.toneEnabled || !c.alignmentMatched) continue;
  if (!c.toneTokens?.length) continue;
  const tone = buildToneFromFw(c.raw, c.toneTokens);
  // Re-fetch tokens from stored case if we add them — use fw scan file
  for (const span of c.homophoneSpans || []) {
    const r = analyzeSpan(c.raw, span, tone, goldenMap[c.id], c.id);
    if (!r) continue;
    trueHits.push(...r.hits.map((h) => ({ ...h, rankChanged: h.offRank !== h.onRank })));
    if (r.diff) onOffDiffs.push(r.diff);
  }
}

trueHits.sort((a, b) => (b.rankChanged - a.rankChanged) || (a.onRank - b.onRank));

const report = {
  audit: 'ToneModule P1 Benefit Audit',
  timestamp: new Date().toISOString(),
  part2_toneDistinguishableTop100: lex.top100Distinguishable,
  part2_stats: lex,
  part3_toneIndistinguishable: {
    count: lex.indistinguishablePairCount,
    top50: lex.top50Indistinguishable,
    theoreticalMaxToneCoverage: lex.distinguishablePairCount,
  },
  part1_trueHitsTop20: trueHits.slice(0, 20),
  part1_trueHitsTotal: trueHits.length,
  part1_rankChangedHits: trueHits.filter((h) => h.rankChanged).length,
  part4_onOffDiffs,
  part4_summary: {
    totalDiffCases: onOffDiffs.length,
    top1Changes: onOffDiffs.filter((d) => d.offTop1 !== d.onTop1).length,
    top3Changes: onOffDiffs.filter((d) => d.offTop3.join('|') !== d.onTop3.join('|')).length,
  },
  part4_p05_e2e: p05?.part3_4_10_dialog200?.e2e || null,
  part5_cnnQuality: {
    toneEnabledCases: fwScan.toneEnabledCount,
    perToneAccuracy: fwScan.cnnPerTone,
    confusionPairs: fwScan.confusion,
  },
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
  trueHits: trueHits.length,
  rankChanged: report.part1_rankChangedHits,
  onOffDiffs: onOffDiffs.length,
  out: OUT,
}, null, 2));
