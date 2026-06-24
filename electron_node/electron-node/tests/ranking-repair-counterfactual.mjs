#!/usr/bin/env node
/**
 * Counterfactual verification — isolated assembly modules (no lexicon runtime).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/main/electron-node/main/src');
const { filterDomainCandidatesPerSpan } = require(path.join(
  DIST,
  'fw-detector/span-assembly-v4/filter-domain-candidates-per-span.js'
));
const { applyToneAssemblyGuard } = require(path.join(
  DIST,
  'fw-detector/span-assembly-v4/apply-tone-assembly-guard.js'
));
const { selectPerSpanCandidates } = require(path.join(
  DIST,
  'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'
));
const { compareRecallHitsPrimaryScore } = require(path.join(DIST, 'lexicon/candidate-score.js'));

function pick(word, graphSource, toneReason, score = 1, edPenalty = 0) {
  return {
    span: { text: '烧病', start: 2, end: 4 },
    word,
    candidateId: `${word}-${graphSource}`,
    graphSource,
    hitKind: 'exact_term',
    score,
    repairTarget: true,
    recallSource: 'lexicon_pinyin_topk',
    domainId: graphSource === 'domain_term' ? 'coffee' : undefined,
    matchedDomain: graphSource === 'domain_term' ? 'coffee' : undefined,
    toneReason,
    candidateScoreBreakdown: {
      priorScore: score,
      phoneticSimilarity: 0,
      exactLengthBonus: 0,
      domainBoost: 0,
      editDistancePenalty: edPenalty,
      fuzzyPenalty: 0,
      recallCandidateKind: 'exact_base',
    },
  };
}

const vote = {
  utteranceDomain: 'coffee',
  insufficientEvidence: false,
  domainScores: { coffee: 2 },
  domainVoteMs: 0,
  parentTermVoteCount: 0,
};

const coarseSpans = [{ id: 'c1', text: '烧病', rawStart: 2, rawEnd: 4, syllableStart: 2, syllableEnd: 4 }];

function wordsFromPipeline(filteredSets) {
  const { sets } = selectPerSpanCandidates(filteredSets, 1, coarseSpans, vote.utteranceDomain);
  return sets[0]?.selectedCandidates.map((p) => p.word) ?? [];
}

// --- CF-A: Tone Guard + bucket priority (GATE-RANK-04) ---
const rankedA = [
  {
    coarseSpanId: 'c1',
    rawRange: [2, 4],
    syllableRange: [2, 4],
    rankedCandidates: [
      pick('烧饼', 'base_term', 'mismatch', 1.2),
      pick('少冰', 'domain_term', 'match', 0.9),
    ],
  },
];
const filteredA = filterDomainCandidatesPerSpan(rankedA, vote);
const guardedA = applyToneAssemblyGuard(filteredA);
const wordsFrozen = wordsFromPipeline(guardedA.filteredSets);
const wordsGlobalScore = [...rankedA[0].rankedCandidates]
  .sort((a, b) => b.score - a.score)
  .map((p) => p.word);

// --- CF-B: ED tie-breaker (GATE-RANK-03) ---
const tieA = {
  candidateScore: 1.0,
  recallCandidateKind: 'exact_base',
  candidateScoreBreakdown: { editDistancePenalty: 0.5, recallCandidateKind: 'exact_base' },
  word: '烧饼',
};
const tieB = {
  candidateScore: 1.0,
  recallCandidateKind: 'exact_base',
  candidateScoreBreakdown: { editDistancePenalty: 0.25, recallCandidateKind: 'exact_base' },
  word: '少冰',
};
const edOrder = compareRecallHitsPrimaryScore(tieB, tieA);

const report = {
  timestamp: new Date().toISOString(),
  counterfactuals: [
    {
      id: 'CF-01-frozen-pipeline',
      feature: 'filter + toneGuard + select(sameDomain>base)',
      input: 'coffee vote; 烧饼 base 1.2 mismatch; 少冰 domain 0.9 match',
      output_words: wordsFrozen,
      tone_guard_blocked: guardedA.blockedCount,
      exists: true,
      effective: wordsFrozen.includes('少冰') && !wordsFrozen.includes('烧饼'),
      decision_position: 'selectPerSpanCandidates after applyToneAssemblyGuard',
      downstream: 'spanSets → KenLM pool',
    },
    {
      id: 'CF-02-global-score-bypass',
      feature: '反事实：绕过桶优先级，仅按 recall score 降序',
      input: '同上',
      output_words: wordsGlobalScore,
      degraded: wordsGlobalScore[0] === '烧饼' && wordsFrozen[0] === '少冰',
      explanation: '漂移行为：高分 base 烧饼覆盖 domain 少冰 — 即修复前 Contract Drift 根因',
      effective_proof: '禁用桶+guard 后首选词从少冰退化为烧饼',
    },
    {
      id: 'CF-03-ed-tie-breaker',
      feature: 'compareRecallHitsPrimaryScore — ED asc on tie',
      input: '同分 1.0；烧饼 ED=0.5；少冰 ED=0.25',
      output: edOrder < 0 ? '少冰优先' : '烧饼优先',
      degraded_if_removed: '同分时错误候选排前',
      effective: edOrder < 0,
      decision_position: 'Recall sort within pinyin_key bucket',
    },
    {
      id: 'CF-04-bucket-partition',
      feature: 'filterDomainCandidatesPerSpan (GATE-RANK-01)',
      sameDomain: filteredA[0]?.sameDomainCandidates.map((p) => p.word),
      base: filteredA[0]?.baseCandidates.map((p) => p.word),
      effective: filteredA[0]?.baseCandidates[0]?.word === '烧饼',
    },
  ],
  verdict:
    wordsFrozen.includes('少冰') &&
    !wordsFrozen.includes('烧饼') &&
    wordsGlobalScore[0] === '烧饼' &&
    guardedA.blockedCount >= 1 &&
    edOrder < 0
      ? 'PASS — 反事实验证：绕过冻结链路出现可解释退化（烧饼优先）'
      : 'PARTIAL',
};

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ranking-repair-v1_2-counterfactual.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
