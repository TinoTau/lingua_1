/**
 * KenLM Capability Baseline — READ ONLY audit probe.
 * FW_V4_FREEZE_2026_08_03 · real scoreBatch subprocess · no model/threshold/mainchain change.
 *
 * expectedText is used ONLY for offline A/B/C attribution in this script/report.
 * It is never passed into Recall / Assembly / KenLM pick / Runtime APIs.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'kenlm_capability_baseline_2026_08_03');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { runFwSentenceRerankFromPrefilled } = require(
  path.join(dist, 'fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.js')
);
const { createKenlmBatchScorer } = require(
  path.join(dist, 'asr-repair/sentence-rerank/kenlm-scorer.js')
);
const {
  resolveCharLmModelPath,
  resolveKenlmQueryPath,
  isKenlmSubprocessRunnable,
  getSentenceKenlmRuntimeStatus,
  runKenlmQueryBatch,
} = require(path.join(dist, 'phonetic-correction/lm-scorer.js'));
const { tokenizeForLm } = require(path.join(dist, 'phonetic-correction/char-tokenize.js'));

function esc(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cols) {
  return cols.map(esc).join(',');
}
function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}
function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}
function approxEq(a, b, eps = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

/** Offline eval only — never fed to runtime. */
function classifyAbc({ expectedAvailable, expectedRank, selectedText, expectedText }) {
  if (!expectedAvailable) return 'A';
  if (Number(expectedRank) === 1 && selectedText === expectedText) return 'PASS';
  if (Number(expectedRank) === 1 && selectedText !== expectedText) return 'C';
  if (expectedAvailable && Number(expectedRank) !== 1) return 'B';
  return 'A';
}

function competitionTags({ rawText, expectedText, candidateCount, candidates, selectedText }) {
  const tags = [];
  if (rawText === expectedText) tags.push('RAW_ALREADY_CORRECT');
  else if (candidates.some((c) => (c.text || c.candidateText) === expectedText)) {
    tags.push('RAW_WRONG_CORRECT_CANDIDATE_EXISTS');
  }
  if (candidateCount >= 3) tags.push('MULTIPLE_PLAUSIBLE_SENTENCES');
  const domains = new Set(candidates.map((c) => c.bucketDomain).filter(Boolean));
  if (domains.size >= 2) tags.push('DOMAIN_COMPETITION');
  if (rawText.length <= 12) tags.push('SHORT_UTTERANCE');
  if (rawText.length >= 40) tags.push('LONG_UTTERANCE');
  const multiRep = candidates.some((c) => Number(c.replacementCount) >= 2);
  if (multiRep) tags.push('MULTI_REPLACEMENT');
  const noiseHints = [
    ['闷蒸', '正在', 'NEAR_HOMOPHONE'],
    ['忠心', '中心', 'HOMOPHONE'],
    ['消失', '小食', 'HOMOPHONE'],
    ['精通步', '经同步', 'NEAR_HOMOPHONE'],
    ['出发', '触发', 'HOMOPHONE'],
    ['阈之一', '阈值', 'NEAR_HOMOPHONE'],
  ];
  for (const [a, b, tag] of noiseHints) {
    const hit = (t) => typeof t === 'string' && (t.includes(a) || t.includes(b));
    if (
      hit(rawText) ||
      hit(expectedText) ||
      candidates.some((c) => hit(c.text) || hit(c.candidateText))
    ) {
      tags.push(tag);
    }
  }
  if (selectedText && selectedText !== rawText && selectedText !== expectedText) {
    tags.push('TONE_CONFUSION');
  }
  return [...new Set(tags)];
}

const bundleDir = path.resolve(repo, process.env.LEXICON_BUNDLE || 'node_runtime/lexicon/v3');
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
if (loadState.status !== 'ok') {
  console.error(JSON.stringify({ error: 'lexicon_load_failed', loadState }, null, 2));
  process.exit(1);
}

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

const modelPath = resolveCharLmModelPath();
const queryPath = resolveKenlmQueryPath();
const kenlmStatus = getSentenceKenlmRuntimeStatus();
const runnable = modelPath ? isKenlmSubprocessRunnable(modelPath, queryPath) : false;

const modelIdentity = {
  modelPath: modelPath || 'UNAVAILABLE',
  modelExists: !!modelPath && fs.existsSync(modelPath),
  modelSizeBytes: modelPath && fs.existsSync(modelPath) ? fs.statSync(modelPath).size : null,
  modelSha256: modelPath && fs.existsSync(modelPath) ? sha256File(modelPath) : 'UNAVAILABLE',
  queryPath,
  queryExists: fs.existsSync(queryPath),
  runnable,
  kenlmStatus,
  ngramOrder: 3,
  scoreMode: 'raw_log_delta',
  minDeltaToReplace: fwConfig.minDeltaToReplace,
  maxSentenceCandidates: fwConfig.maxSentenceCandidates,
  kenlmSubprocessTimeoutMs: fwConfig.kenlmSubprocessTimeoutMs,
  kenlmSubprocessMaxLines: fwConfig.kenlmSubprocessMaxLines,
  freezeBaseline: 'FW_V4_FREEZE_2026_08_03',
};

if (!runnable || !modelPath) {
  fs.writeFileSync(
    path.join(outDir, 'BLOCKED.json'),
    JSON.stringify(
      {
        verdict: 'KENLM_BASELINE_BLOCKED_REAL_SCORER_NOT_PROVEN',
        modelIdentity,
      },
      null,
      2
    )
  );
  console.error('KENLM_BASELINE_BLOCKED_REAL_SCORER_NOT_PROVEN');
  process.exit(2);
}

const scorer = createKenlmBatchScorer();
if (!scorer) {
  console.error('createKenlmBatchScorer returned null');
  process.exit(2);
}

// Warmup + proof of real subprocess (audit-only longer timeout for cold WSL; production gate unchanged)
const proofToken = tokenizeForLm('你好世界');
let proof = await runKenlmQueryBatch(modelPath, queryPath, [proofToken], 120000);
if (!proof.ok) {
  // one retry after WSL/model page-in
  proof = await runKenlmQueryBatch(modelPath, queryPath, [proofToken], 120000);
}
const invocationProof = {
  ok: proof.ok === true,
  reason: proof.ok ? 'ok' : proof.reason,
  wallMs: proof.ok ? proof.wallMs : null,
  sampleScore: proof.ok ? proof.results[0]?.score : null,
  sampleOov: proof.ok ? proof.results[0]?.oovCount : null,
  tokenizedSample: proofToken,
  warmupTimeoutMsUsed: 120000,
  productionTimeoutMs: fwConfig.kenlmSubprocessTimeoutMs,
  commandPlan: {
    note: 'spawn via planKenlmSpawn(queryPath, modelPath); stdin = tokenized lines; Windows uses WSL when query.exe missing',
    modelPath,
    queryPath,
  },
};
if (!proof.ok) {
  fs.writeFileSync(
    path.join(outDir, 'BLOCKED.json'),
    JSON.stringify(
      {
        verdict: 'KENLM_BASELINE_BLOCKED_REAL_SCORER_NOT_PROVEN',
        modelIdentity,
        invocationProof,
      },
      null,
      2
    )
  );
  console.error('KENLM_BASELINE_BLOCKED_REAL_SCORER_NOT_PROVEN', proof);
  process.exit(2);
}

async function runCase({ caseId, rawText, expectedText, suite }) {
  const tPre0 = performance.now();
  let orch;
  try {
    orch = runSpanAssemblyV4Orchestrator({
      rawText,
      runtime,
      profile,
      recallDomainScope: domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      domainPriors: [],
    });
  } catch (e) {
    return {
      failed: true,
      caseId,
      suite,
      error: String(e && e.message ? e.message : e),
      preKenlmMs: performance.now() - tPre0,
    };
  }
  const preKenlmMs = performance.now() - tPre0;
  const combos = (orch.kenlmSentenceCandidates?.combinations || []).slice(
    0,
    fwConfig.maxSentenceCandidates
  );

  const sentences = [rawText, ...combos.map((c) => c.text)];
  const tKen0 = performance.now();
  const batch = await scorer.scoreBatch(sentences);
  const kenlmOnlyMs = performance.now() - tKen0;

  const baselineRawScore = batch.scores[0]?.score ?? 0;
  const scored = sentences.map((text, i) => ({
    text,
    kenlmScore: batch.scores[i]?.score ?? 0,
    normalizedScore: batch.scores[i]?.normalizedScore ?? 0,
    isRawSlot: i === 0,
    comboIndex: i === 0 ? -1 : i - 1,
  }));

  // Full rank among raw + candidates (higher score better)
  const ranked = [...scored]
    .map((row, idx) => ({ ...row, origIndex: idx }))
    .sort((a, b) => b.kenlmScore - a.kenlmScore || a.origIndex - b.origIndex);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  const rankByOrig = new Map(ranked.map((r) => [r.origIndex, r.rank]));

  const tPick0 = performance.now();
  const rerank = await runFwSentenceRerankFromPrefilled({
    rawText,
    spans: orch.fwSpans || [],
    spanSets: orch.spanSets || [],
    config: {
      minPrior: fwConfig.minPrior,
      maxSentenceCandidates: fwConfig.maxSentenceCandidates,
      minDeltaToReplace: fwConfig.minDeltaToReplace,
      candidateRequireRepairTarget: fwConfig.candidateRequireRepairTarget,
    },
    kenlmScorer: scorer,
    prefilledCombinations: combos,
  });
  const pickMs = performance.now() - tPick0;
  const sr = rerank.sentenceRerank || {};
  const selectedText = sr.pickedIsRaw || !sr.picked ? rawText : sr.picked.text;
  const selectedCandidateId = sr.pickedIsRaw || !sr.picked ? 'raw' : `candidate:${combos.indexOf(sr.picked)}`;
  const selectionReason = sr.pickedIsRaw
    ? `keep_raw:maxDelta=${sr.maxDelta}<minDeltaToReplace=${fwConfig.minDeltaToReplace}||no_pick`
    : `replace:maxDelta=${sr.maxDelta}>=minDeltaToReplace=${fwConfig.minDeltaToReplace}`;

  // Raw identity among export universe: synthetic raw row + any combo equal to raw
  const comboRawMatches = combos
    .map((c, i) => ({ i, text: c.text }))
    .filter((x) => x.text === rawText);

  const expectedInPool = [rawText, ...combos.map((c) => c.text)].includes(expectedText);
  let expectedRank = 'UNAVAILABLE';
  if (expectedInPool) {
    if (expectedText === rawText) expectedRank = rankByOrig.get(0);
    else {
      const idx = combos.findIndex((c) => c.text === expectedText);
      expectedRank = idx >= 0 ? rankByOrig.get(idx + 1) : 'UNAVAILABLE';
    }
  }

  const problemClass = classifyAbc({
    expectedAvailable: expectedInPool,
    expectedRank,
    selectedText,
    expectedText,
  });

  const candidateRows = [];
  // Raw synthetic row (SSOT baseline)
  candidateRows.push({
    caseId,
    suite,
    rawText,
    candidateId: 'raw',
    candidateText: rawText,
    candidateCount: 1 + combos.length,
    isRaw: true,
    isCanonical: false,
    replacementCount: 0,
    replacementProvenance: 'baseline_raw_slot',
    sourcePath: 'UNAVAILABLE',
    bucketDomain: 'UNAVAILABLE',
    preKenLMScore: 'UNAVAILABLE',
    kenlmScore: baselineRawScore,
    baselineRawScore,
    deltaVsRaw: 0,
    rank: rankByOrig.get(0),
    isTop1: rankByOrig.get(0) === 1,
    isTop3: rankByOrig.get(0) <= 3,
    selectedText,
    selectedCandidateId,
    selectionReason,
    minDeltaToReplace: fwConfig.minDeltaToReplace,
    expectedText,
    isExpectedCandidate: expectedText === rawText,
    expectedCandidateAvailable: expectedInPool,
    expectedRank,
    problemClass,
    kenlmSubprocessMs: batch.runtime?.kenlmSubprocessMs ?? 'UNAVAILABLE',
    kenlmSubprocessErrorReason: batch.runtime?.kenlmSubprocessErrorReason || '',
    normalizedScore: scored[0].normalizedScore,
  });

  for (let i = 0; i < combos.length; i += 1) {
    const c = combos[i];
    const score = scored[i + 1].kenlmScore;
    const delta = score - baselineRawScore;
    const rank = rankByOrig.get(i + 1);
    candidateRows.push({
      caseId,
      suite,
      rawText,
      candidateId: c.candidateId || `candidate:${i}`,
      candidateText: c.text,
      candidateCount: 1 + combos.length,
      isRaw: c.text === rawText,
      isCanonical: c.isCanonical === true,
      replacementCount: Array.isArray(c.replacements) ? c.replacements.length : 0,
      replacementProvenance: Array.isArray(c.replacements)
        ? c.replacements.map((r) => `${r.span?.start ?? '?'}:${r.span?.end ?? '?'}:${r.word}`).join('|')
        : 'UNAVAILABLE',
      sourcePath: c.sourcePath || c.pathId || 'UNAVAILABLE',
      bucketDomain: c.bucketDomain || c.domain || 'UNAVAILABLE',
      preKenLMScore: c.candidateScore ?? c.preKenLMScore ?? 'UNAVAILABLE',
      kenlmScore: score,
      baselineRawScore,
      deltaVsRaw: delta,
      rank,
      isTop1: rank === 1,
      isTop3: rank <= 3,
      selectedText,
      selectedCandidateId,
      selectionReason,
      minDeltaToReplace: fwConfig.minDeltaToReplace,
      expectedText,
      isExpectedCandidate: c.text === expectedText,
      expectedCandidateAvailable: expectedInPool,
      expectedRank,
      problemClass,
      kenlmSubprocessMs: batch.runtime?.kenlmSubprocessMs ?? 'UNAVAILABLE',
      kenlmSubprocessErrorReason: batch.runtime?.kenlmSubprocessErrorReason || '',
      normalizedScore: scored[i + 1].normalizedScore,
    });
  }

  const top1 = ranked[0];
  const top1Margin =
    ranked.length >= 2 ? ranked[0].kenlmScore - ranked[1].kenlmScore : 0;
  const correctVsRawDelta =
    expectedInPool && expectedText !== rawText
      ? (scored.find((s) => s.text === expectedText)?.kenlmScore ?? baselineRawScore) - baselineRawScore
      : expectedText === rawText
        ? 0
        : 'UNAVAILABLE';

  const tags = competitionTags({
    rawText,
    expectedText,
    candidateCount: 1 + combos.length,
    candidates: candidateRows,
    selectedText,
  });

  // Raw identity blockers
  const rawIdentity = {
    syntheticRawCount: 1,
    comboTextEqualsRawCount: comboRawMatches.length,
    rawDeltaStrictZero: candidateRows.filter((r) => r.isRaw && r.candidateId === 'raw').every((r) => r.deltaVsRaw === 0),
    baselineMatchesRawScore: approxEq(baselineRawScore, scored[0].kenlmScore),
    blocker:
      comboRawMatches.length > 1
        ? 'RAW_DUPLICATE_IN_COMBOS'
        : !approxEq(baselineRawScore, scored[0].kenlmScore)
          ? 'RAW_SCORE_INCONSISTENT'
          : null,
  };

  return {
    failed: false,
    caseId,
    suite,
    rawText,
    expectedText,
    candidateCount: 1 + combos.length,
    comboCount: combos.length,
    rawOnly: combos.length === 0,
    expectedCandidateAvailable: expectedInPool,
    expectedRank,
    problemClass,
    selectedText,
    selectedCandidateId,
    selectionReason,
    pickedIsRaw: !!sr.pickedIsRaw,
    maxDelta: sr.maxDelta,
    minDeltaToReplace: fwConfig.minDeltaToReplace,
    baselineRawScore,
    top1Text: top1?.text,
    top1Score: top1?.kenlmScore,
    top1Margin,
    correctVsRawDelta,
    top3: ranked.slice(0, 3).map((r) => ({ text: r.text, score: r.kenlmScore, rank: r.rank })),
    tags,
    rawIdentity,
    preKenlmMs,
    kenlmOnlyMs,
    pickMs,
    totalPostMs: preKenlmMs + kenlmOnlyMs,
    kenlmRuntime: batch.runtime || null,
    kenlmTiming: batch.timing || null,
    subprocessError: batch.runtime?.kenlmSubprocessErrorReason || null,
    latticeCoverage: orch.latticeTrace?.coverageStatus || 'UNAVAILABLE',
    candidateRows,
    // second scoreBatch inside pick — note double-call cost in pickMs
  };
}

const dialogCases = JSON.parse(
  fs.readFileSync(path.resolve(repo, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
).cases.filter((c) => typeof c.text === 'string' && c.text.length > 0);

const noiseSeeds = [
  {
    caseId: 'nn-train-01',
    rawText: '我闷蒸在升级公司内部的专家系统平台。',
    expectedText: '我们正在升级公司内部的专家系统平台。',
    noiseSurface: '我闷蒸在',
    correctSurface: '我们正在',
  },
  {
    caseId: 'nn-train-01b',
    rawText: '我闷蒸在训练神经网络模型。',
    expectedText: '我们正在训练神经网络模型。',
    noiseSurface: '闷蒸',
    correctSurface: '正在',
  },
  {
    caseId: 'center-01',
    rawText: '微服务会定时向注册忠心上报健康状态。',
    expectedText: '微服务会定时向注册中心上报健康状态。',
    noiseSurface: '忠心',
    correctSurface: '中心',
  },
  {
    caseId: 'snack-01',
    rawText: '客房里的迷你吧提供饮料和消失。',
    expectedText: '客房里的迷你吧提供饮料和小食。',
    noiseSurface: '消失',
    correctSurface: '小食',
  },
  {
    caseId: 'sync-01',
    rawText: '回归测试报告已精通步给质量保障团队。',
    expectedText: '回归测试报告已经同步给质量保障团队。',
    noiseSurface: '已精通步',
    correctSurface: '已经同步',
  },
  {
    caseId: 'trigger-01',
    rawText: '调用下游超时后会出发熔断策略保护。',
    expectedText: '调用下游超时后会触发熔断策略保护。',
    noiseSurface: '出发',
    correctSurface: '触发',
  },
  {
    caseId: 'threshold-01',
    rawText: '熔断策略阈之一按错误率重新校准。',
    expectedText: '熔断策略阈值已按错误率重新校准。',
    noiseSurface: '阈之一',
    correctSurface: '阈值',
  },
];

const allCaseResults = [];
const allCandidateRows = [];

console.log(
  JSON.stringify(
    {
      phase: 'start',
      dialogCases: dialogCases.length,
      noiseCases: noiseSeeds.length,
      modelIdentity,
      invocationProof,
    },
    null,
    2
  )
);

for (const c of dialogCases) {
  const caseId = c.id || c.caseId;
  const rawText = c.text;
  const expectedText = c.expectedText || c.text;
  const r = await runCase({ caseId, rawText, expectedText, suite: 'dialog_200' });
  allCaseResults.push(r);
  if (!r.failed) allCandidateRows.push(...r.candidateRows);
  if (allCaseResults.filter((x) => x.suite === 'dialog_200').length % 20 === 0) {
    console.log(
      JSON.stringify({
        progress: allCaseResults.filter((x) => x.suite === 'dialog_200').length,
        last: caseId,
        class: r.problemClass,
        candidates: r.candidateCount,
        kenlmMs: r.kenlmOnlyMs,
      })
    );
  }
}

const noiseResolved = [];
for (const n of noiseSeeds) {
  const r = await runCase({
    caseId: n.caseId,
    rawText: n.rawText,
    expectedText: n.expectedText,
    suite: 'noise_inventory',
  });
  allCaseResults.push(r);
  if (!r.failed) allCandidateRows.push(...r.candidateRows);
  noiseResolved.push({
    caseId: n.caseId,
    noiseSurface: n.noiseSurface,
    correctSurface: n.correctSurface,
    rawText: n.rawText,
    expectedText: n.expectedText,
    status: r.failed
      ? 'TRACE_NOT_REPRODUCIBLE'
      : r.subprocessError
        ? 'TRACE_NOT_REPRODUCIBLE'
        : 'RESOLVED',
    reason: r.failed ? r.error : r.subprocessError || '',
    candidateCount: r.candidateCount,
    expectedCandidateAvailable: r.expectedCandidateAvailable,
    expectedRank: r.expectedRank,
    top1Text: r.top1Text,
    top3: r.top3,
    selectedText: r.selectedText,
    maxDelta: r.maxDelta,
    baselineRawScore: r.baselineRawScore,
    problemClass: r.problemClass,
    allCandidates: (r.candidateRows || []).map((row) => ({
      id: row.candidateId,
      text: row.candidateText,
      score: row.kenlmScore,
      delta: row.deltaVsRaw,
      rank: row.rank,
      isRaw: row.isRaw,
    })),
  });
}

// Metrics
const dialog = allCaseResults.filter((r) => r.suite === 'dialog_200');
const completed = dialog.filter((r) => !r.failed);
const failed = dialog.filter((r) => r.failed);
const with1 = completed.filter((r) => r.candidateCount === 1);
const with2p = completed.filter((r) => r.candidateCount >= 2);
const rawOnly = completed.filter((r) => r.rawOnly);
const expectedAvail = completed.filter((r) => r.expectedCandidateAvailable);
const avail = expectedAvail;
const classCount = { A: 0, B: 0, C: 0, PASS: 0 };
for (const r of completed) classCount[r.problemClass] = (classCount[r.problemClass] || 0) + 1;

const availPass = avail.filter((r) => r.problemClass === 'PASS');
const availTop1 = avail.filter((r) => Number(r.expectedRank) === 1);
const availTop3 = avail.filter((r) => Number(r.expectedRank) >= 1 && Number(r.expectedRank) <= 3);
const availFinalOk = avail.filter((r) => r.selectedText === r.expectedText);

const rawCorrectCases = completed.filter((r) => r.rawText === r.expectedText);
const rawPreservation = rawCorrectCases.filter((r) => r.selectedText === r.rawText);
const wrongReplacement = completed.filter(
  (r) => r.selectedText !== r.rawText && r.selectedText !== r.expectedText
);
const missedCorrection = completed.filter(
  (r) => r.rawText !== r.expectedText && r.selectedText !== r.expectedText
);

const top1Margins = completed.map((r) => Number(r.top1Margin)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
const correctDeltas = completed
  .map((r) => r.correctVsRawDelta)
  .filter((x) => typeof x === 'number' && Number.isFinite(x))
  .sort((a, b) => a - b);

// Score ties: adjacent equal scores in candidate rows per case
let tieCases = 0;
for (const r of completed) {
  const scores = (r.candidateRows || []).map((x) => x.kenlmScore);
  const uniq = new Set(scores.map((s) => Number(s).toFixed(8)));
  if (uniq.size < scores.length) tieCases += 1;
}

const kenlmMs = completed.map((r) => r.kenlmOnlyMs).sort((a, b) => a - b);
const preMs = completed.map((r) => r.preKenlmMs).sort((a, b) => a - b);
const totalMs = completed.map((r) => r.totalPostMs).sort((a, b) => a - b);
const candCounts = completed.map((r) => r.candidateCount);
const avgCand = candCounts.reduce((a, b) => a + b, 0) / (candCounts.length || 1);

const metrics = {
  totalCases: dialog.length,
  completedCases: completed.length,
  failedCases: failed.length,
  casesWith1Candidate: with1.length,
  casesWith2PlusCandidates: with2p.length,
  averageCandidateCount: avgCand,
  maxCandidateCount: Math.max(0, ...candCounts),
  rawOnlyCases: rawOnly.length,
  expectedCandidateAvailableCases: expectedAvail.length,
  expectedCandidateAvailabilityRate: expectedAvail.length / (completed.length || 1),
  A: classCount.A,
  B: classCount.B,
  C: classCount.C,
  PASS: classCount.PASS,
  correctTop1RateAmongAvailable: availTop1.length / (avail.length || 1),
  correctTop3RateAmongAvailable: availTop3.length / (avail.length || 1),
  finalSelectionAccuracyAmongAvailable: availFinalOk.length / (avail.length || 1),
  rawPreservationAccuracy: rawPreservation.length / (rawCorrectCases.length || 1),
  wrongReplacementRate: wrongReplacement.length / (completed.length || 1),
  missedCorrectionRate: missedCorrection.length / (completed.length || 1),
  averageTop1Margin: top1Margins.reduce((a, b) => a + b, 0) / (top1Margins.length || 1),
  averageCorrectVsRawDelta: correctDeltas.reduce((a, b) => a + b, 0) / (correctDeltas.length || 1),
  scoreTieRate: tieCases / (completed.length || 1),
  note_dialog200_raw_equals_expected:
    'dialog_200 restored corpus: text===expectedText for all cases → RAW_ALREADY_CORRECT dominates; ranking competition still measured among candidates.',
};

const performanceBaseline = {
  preKenlm_p50: pct(preMs, 0.5),
  preKenlm_p95: pct(preMs, 0.95),
  preKenlm_max: pct(preMs, 1),
  kenlmOnly_p50: pct(kenlmMs, 0.5),
  kenlmOnly_p95: pct(kenlmMs, 0.95),
  kenlmOnly_max: pct(kenlmMs, 1),
  totalPost_p50: pct(totalMs, 0.5),
  totalPost_p95: pct(totalMs, 0.95),
  totalPost_max: pct(totalMs, 1),
  warmupProofWallMs: invocationProof.wallMs,
  note: 'Each case calls scoreBatch twice (export + production pick); kenlmOnlyMs is first batch only. pickMs includes second batch.',
};

// Write CSVs
const candHeader = [
  'caseId',
  'suite',
  'rawText',
  'candidateId',
  'candidateText',
  'candidateCount',
  'isRaw',
  'isCanonical',
  'replacementCount',
  'replacementProvenance',
  'sourcePath',
  'bucketDomain',
  'preKenLMScore',
  'kenlmScore',
  'baselineRawScore',
  'deltaVsRaw',
  'rank',
  'isTop1',
  'isTop3',
  'selectedText',
  'selectedCandidateId',
  'selectionReason',
  'minDeltaToReplace',
  'expectedText',
  'isExpectedCandidate',
  'expectedCandidateAvailable',
  'expectedRank',
  'problemClass',
  'normalizedScore',
  'kenlmSubprocessMs',
  'kenlmSubprocessErrorReason',
];
fs.writeFileSync(
  path.join(outDir, 'kenlm_capability_baseline_candidates.csv'),
  [csvRow(candHeader), ...allCandidateRows.map((r) => csvRow(candHeader.map((h) => r[h])))].join('\n'),
  'utf8'
);

const caseHeader = [
  'caseId',
  'suite',
  'rawText',
  'expectedText',
  'candidateCount',
  'comboCount',
  'rawOnly',
  'expectedCandidateAvailable',
  'expectedRank',
  'problemClass',
  'selectedText',
  'pickedIsRaw',
  'maxDelta',
  'minDeltaToReplace',
  'baselineRawScore',
  'top1Text',
  'top1Score',
  'top1Margin',
  'correctVsRawDelta',
  'tags',
  'preKenlmMs',
  'kenlmOnlyMs',
  'pickMs',
  'totalPostMs',
  'subprocessError',
  'latticeCoverage',
  'rawIdentityBlocker',
];
fs.writeFileSync(
  path.join(outDir, 'kenlm_capability_case_summary.csv'),
  [
    csvRow(caseHeader),
    ...allCaseResults
      .filter((r) => !r.failed)
      .map((r) =>
        csvRow([
          r.caseId,
          r.suite,
          r.rawText,
          r.expectedText,
          r.candidateCount,
          r.comboCount,
          r.rawOnly,
          r.expectedCandidateAvailable,
          r.expectedRank,
          r.problemClass,
          r.selectedText,
          r.pickedIsRaw,
          r.maxDelta,
          r.minDeltaToReplace,
          r.baselineRawScore,
          r.top1Text,
          r.top1Score,
          r.top1Margin,
          r.correctVsRawDelta,
          (r.tags || []).join('|'),
          r.preKenlmMs,
          r.kenlmOnlyMs,
          r.pickMs,
          r.totalPostMs,
          r.subprocessError || '',
          r.latticeCoverage,
          r.rawIdentity?.blocker || '',
        ])
      ),
  ].join('\n'),
  'utf8'
);

fs.writeFileSync(
  path.join(outDir, 'kenlm_abc_classification.csv'),
  [
    csvRow(['caseId', 'suite', 'problemClass', 'expectedAvailable', 'expectedRank', 'selectedText', 'expectedText', 'candidateCount', 'maxDelta']),
    ...allCaseResults
      .filter((r) => !r.failed)
      .map((r) =>
        csvRow([
          r.caseId,
          r.suite,
          r.problemClass,
          r.expectedCandidateAvailable,
          r.expectedRank,
          r.selectedText,
          r.expectedText,
          r.candidateCount,
          r.maxDelta,
        ])
      ),
  ].join('\n'),
  'utf8'
);

const scoreDistRows = allCandidateRows.map((r) =>
  csvRow([r.caseId, r.suite, r.candidateId, r.isRaw, r.kenlmScore, r.deltaVsRaw, r.rank, r.normalizedScore])
);
fs.writeFileSync(
  path.join(outDir, 'kenlm_score_distribution.csv'),
  [csvRow(['caseId', 'suite', 'candidateId', 'isRaw', 'kenlmScore', 'deltaVsRaw', 'rank', 'normalizedScore']), ...scoreDistRows].join(
    '\n'
  ),
  'utf8'
);

fs.writeFileSync(
  path.join(outDir, 'kenlm_performance_baseline.csv'),
  [
    csvRow(['metric', 'value']),
    ...Object.entries(performanceBaseline).map(([k, v]) => csvRow([k, v])),
    csvRow(['dialog_completed', completed.length]),
    csvRow(['avg_candidate_count', avgCand]),
  ].join('\n'),
  'utf8'
);

const inventoryResolvedPath = path.join(outDir, 'kenlm_validation_case_inventory_resolved.csv');
fs.writeFileSync(
  inventoryResolvedPath,
  [
    csvRow([
      'caseId',
      'noiseSurface',
      'correctSurface',
      'status',
      'problemClass',
      'expectedCandidateAvailable',
      'expectedRank',
      'selectedText',
      'top1Text',
      'candidateCount',
      'maxDelta',
      'reason',
    ]),
    ...noiseResolved.map((n) =>
      csvRow([
        n.caseId,
        n.noiseSurface,
        n.correctSurface,
        n.status,
        n.problemClass,
        n.expectedCandidateAvailable,
        n.expectedRank,
        n.selectedText,
        n.top1Text,
        n.candidateCount,
        n.maxDelta,
        n.reason,
      ])
    ),
  ].join('\n'),
  'utf8'
);

// Also copy resolved next to original inventory (do not overwrite original)
fs.copyFileSync(
  inventoryResolvedPath,
  path.join(repo, 'docs/tone-v2/kenlm_validation_case_inventory_resolved.csv')
);

const competitionCases = completed.filter((r) => r.candidateCount >= 2);
const tagHist = {};
for (const r of competitionCases) {
  for (const t of r.tags || []) tagHist[t] = (tagHist[t] || 0) + 1;
}

const summary = {
  freezeBaseline: 'FW_V4_FREEZE_2026_08_03',
  modelIdentity,
  invocationProof,
  metrics,
  performanceBaseline,
  classCount,
  tagHist,
  noiseResolved,
  rawIdentityBlockers: completed.filter((r) => r.rawIdentity?.blocker).map((r) => ({
    caseId: r.caseId,
    blocker: r.rawIdentity.blocker,
  })),
  unavailableFields: [
    {
      field: 'sourcePath / bucketDomain on many candidates',
      valueWritten: 'UNAVAILABLE when SentenceCombination lacks fields',
      owner: 'CrossPath merge / SentenceCombination DTO',
    },
    {
      field: 'isCanonical',
      valueWritten: 'false unless combo.isCanonical===true',
      owner: 'Assembly combination marker',
    },
    {
      field: 'model vocabulary size / pruning params',
      valueWritten: 'MODEL_PROVENANCE_INCOMPLETE',
      owner: 'kenLM training logs / missing checksums.txt',
    },
  ],
  outDir,
};

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify({ done: true, metrics, classCount, noise: noiseResolved.map((n) => ({ id: n.caseId, cls: n.problemClass, avail: n.expectedCandidateAvailable })) }, null, 2));
