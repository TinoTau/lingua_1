/**
 * KenLM ranking only for A01/B01/C01 after multi-candidate restoration.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, 'same_domain_multi_candidate_restoration');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

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
} = require(path.join(dist, 'phonetic-correction/lm-scorer.js'));

const runtime = new LexiconRuntimeV2();
runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

const cases = [
  ['A01', '请确认地址'],
  ['B01', '请确认地址和医院'],
  ['C01', '请确认地址、医院和医师'],
];

async function runOne(caseId, rawText) {
  const orch = runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
  });
  const combos = orch.kenlmSentenceCandidates?.combinations || [];
  const modelPath = resolveCharLmModelPath();
  const queryPath = resolveKenlmQueryPath();
  const status = getSentenceKenlmRuntimeStatus();
  const runnable = isKenlmSubprocessRunnable(modelPath, queryPath);
  if (!runnable) {
    return {
      caseId,
      skipped: true,
      reason: 'KenLM environment/config blocker',
      status,
      modelPath,
      queryPath,
      inputTexts: combos.map((c) => c.text),
      prefilledCount: combos.length,
    };
  }
  const scorer = createKenlmBatchScorer();
  const t0 = performance.now();
  const result = await runFwSentenceRerankFromPrefilled({
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
  const totalMs = performance.now() - t0;
  const sr = result.sentenceRerank || {};
  const ranked = sr.rankedCandidates || sr.candidates || [];
  return {
    caseId,
    skipped: false,
    prefilledCount: combos.length,
    inputTexts: combos.map((c) => c.text),
    ranking: (Array.isArray(ranked) ? ranked : []).slice(0, 16).map((c, i) => ({
      rank: i + 1,
      text: c.text || c.sentence,
      score: c.kenlmScore ?? c.score ?? c.finalScore,
    })),
    top1: sr.bestSentence || ranked[0]?.text || null,
    totalMs,
    kenlmQueryCount: result.kenlmQueryCount,
    modelPath,
    queryPath,
  };
}

const out = [];
for (const [id, text] of cases) {
  try {
    out.push(await runOne(id, text));
  } catch (e) {
    out.push({ caseId: id, skipped: true, reason: 'KenLM runtime error', error: String(e?.stack || e) });
  }
}
fs.writeFileSync(path.join(outDir, 'kenlm_focus_ranking.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
