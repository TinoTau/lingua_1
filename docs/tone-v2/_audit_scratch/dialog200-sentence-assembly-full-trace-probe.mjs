/**
 * dialog_200 Pre-KenLM Sentence Assembly Full Trace Audit (READ-ONLY)
 * Writes 001.md..200.md + summary of cases worth human review.
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   $env:PROJECT_ROOT=<repo>
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\dialog200-sentence-assembly-full-trace-probe.mjs
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
const outDir = path.resolve(__dirname, 'dialog200_sentence_assembly_trace');
const summaryPath = path.resolve(__dirname, 'dialog200_sentence_assembly_trace_summary.md');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[trace200] ${m}`);
}

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
const {
  filterDomainCandidatesPerSpan,
  budgetPerSpanCandidates,
  buildFineSpanCandidatePool,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
const { resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
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
} = require(path.join(dist, 'phonetic-correction/lm-scorer.js'));

const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
log(`lexicon=${loadState.status}`);
if (loadState.status !== 'ok') process.exit(1);

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

fs.mkdirSync(outDir, { recursive: true });

const dialogManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const dialogCases = dialogManifest.cases.filter((c) => typeof c.text === 'string');

function caseFileNum(id) {
  const m = String(id).match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)).padStart(3, '0') : String(id);
}

function uniq(arr) {
  return [...new Set(arr)];
}

function looksOddSentence(text, raw) {
  if (!text || text === raw) return false;
  const oddPairs = [
    [/低脂/, /地址|医院|确认|酒店|会议/],
    [/地质/, /确认|医院|拿铁|咖啡/],
    [/议员/, /咖啡|拿铁|马芬|酒店|旅游/],
    [/议室/, /咖啡|拿铁|马芬|医院/],
    [/医师/, /咖啡|拿铁|会议|旅游/],
    [/拿铁|美式|马芬/, /医院|医师|议员|旅游|酒店前台/],
    [/酒店|前台|接机/, /拿铁|美式|少糖/],
  ];
  for (const [a, b] of oddPairs) {
    if (a.test(text) && b.test(text)) return true;
  }
  // heavy rewrite vs raw length
  if (text.length >= 4 && raw.length >= 4) {
    let same = 0;
    const n = Math.min(text.length, raw.length);
    for (let i = 0; i < n; i++) if (text[i] === raw[i]) same++;
    if (same / n < 0.5 && text !== raw) return true;
  }
  return false;
}

function reasonSingleAssembly(trace) {
  const reasons = [];
  if ((trace.retainedDomains || []).length <= 1) reasons.push('只有一个 retainedDomain / base-only 桶');
  const grids = trace.buckets || [];
  const allSingle = grids.every((b) => (b.grid || []).every((slot) => slot.length <= 1));
  if (allSingle) reasons.push('每个 Span 槽位仅 1 个 surface（含 canonical）');
  const hasRecallMulti = (trace.buckets || []).some((b) =>
    (b.grid || []).some((slot) => slot.length > 1)
  );
  if (!hasRecallMulti) reasons.push('无多表面 Recall 进入 Assembly Grid');
  const onlyRaw =
    (trace.assemblyTexts || []).length === 1 && trace.assemblyTexts[0] === trace.rawText;
  if (onlyRaw) reasons.push('Assembly 结果仅 ASR Raw');
  if (!reasons.length) reasons.push('组合去重后仅剩一句');
  return reasons;
}

async function maybeKenlm(rawText, orch, combos) {
  // Pre-KenLM audit default: do not block on KenLM subprocess.
  // Set DIALOG200_TRACE_KENLM=1 to rank multi-sentence inputs.
  if (process.env.DIALOG200_TRACE_KENLM !== '1') {
    if (!combos.length) {
      return { ran: false, reason: 'empty_prefilled', ranking: [] };
    }
    if (combos.length <= 1) {
      return {
        ran: false,
        reason: 'prefilledCount<=1（无需排序）',
        ranking: [{ rank: 1, text: combos[0].text, score: null, note: 'single_input' }],
      };
    }
    return {
      ran: false,
      reason: '本轮 Pre-KenLM Trace 默认不跑 KenLM（设 DIALOG200_TRACE_KENLM=1 可启用）',
      ranking: [],
      inputOnly: combos.map((c) => c.text),
    };
  }
  if (!combos.length) {
    return { ran: false, reason: 'empty_prefilled', ranking: [] };
  }
  if (combos.length <= 1) {
    return {
      ran: false,
      reason: 'prefilledCount<=1（无需排序）',
      ranking: [{ rank: 1, text: combos[0].text, score: null, note: 'single_input' }],
    };
  }
  let modelPath;
  let queryPath;
  try {
    modelPath = resolveCharLmModelPath();
    queryPath = resolveKenlmQueryPath();
  } catch (e) {
    return { ran: false, reason: `KenLM env: ${e.message || e}`, ranking: [] };
  }
  if (!modelPath || !isKenlmSubprocessRunnable(modelPath, queryPath)) {
    return { ran: false, reason: 'KenLM environment/config blocker', ranking: [] };
  }
  try {
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
    const sr = result.sentenceRerank || {};
    const ranking = (sr.topCandidates || []).map((c) => ({
      rank: c.rank,
      text: c.text,
      score: c.kenlmScore,
      deltaVsRaw: c.deltaVsRaw,
      isRaw: c.isRaw,
    }));
    return {
      ran: true,
      reason: null,
      ranking,
      top1: ranking[0]?.text || sr.picked?.text || null,
      totalMs: performance.now() - t0,
      kenlmSubprocessErrorReason: sr.kenlmSubprocessErrorReason || null,
      pickedIsRaw: sr.pickedIsRaw,
    };
  } catch (e) {
    return { ran: false, reason: `KenLM runtime: ${e.message || e}`, ranking: [] };
  }
}

function enrichBuckets(rawText, orch) {
  const buckets = [];
  for (const pr of orch.pathAssemblyResults || []) {
    const pathFineSpans = pr.pathFineSpans || [];
    const vote = pr.assemblyResult?.vote;
    const retained =
      vote?.retainedDomains?.length > 0 ? [...vote.retainedDomains] : [null];
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
    const compatibility = resolveCompatibilityRelations(pathCandidates);
    const grids = pr.assemblyResult?.bucketSpanSets || [];
    const gens = pr.perBucketGenerated || [];

    for (let bi = 0; bi < retained.length; bi++) {
      const domainId = retained[bi];
      let filtered = [];
      let budgeted = [];
      try {
        const syntheticCoarse = pathFineSpans.map((s) => ({
          id: s.coarseSpanIds?.[0] || s.spanId,
          text: rawText.slice(s.rawStart, s.rawEnd),
          rawStart: s.rawStart,
          rawEnd: s.rawEnd,
          syllableStart: s.syllableStart,
          syllableEnd: s.syllableEnd,
          source: 'ime_token_boundary',
          boundaryConfidence: 1,
        }));
        const pool2 = buildFineSpanCandidatePool(
          compatibility.activeCandidates,
          syntheticCoarse,
          pathFineSpans
        );
        filtered = filterDomainCandidatesPerSpan(pool2, vote, rawText, domainId);
        budgeted = budgetPerSpanCandidates(
          filtered,
          pathFineSpans.length,
          syntheticCoarse,
          pathFineSpans,
          rawText,
          []
        );
      } catch (e) {
        filtered = [];
        budgeted = [];
      }

      const gridFromOrch = (grids[bi] || []).map((slot) => uniq(slot.map((p) => p.word)));
      const spanDetail = (budgeted.length ? budgeted : filtered).map((set, i) => {
        const spanText = rawText.slice(set.rawRange[0], set.rawRange[1]);
        return {
          spanIndex: i + 1,
          spanText,
          fineSpanId: set.fineSpanId,
          sameDomain: (set.sameDomainCandidates || []).map((p) => p.word),
          base: (set.baseCandidates || []).map((p) => p.word),
          fallback: (set.fallbackCandidates || []).map((p) => p.word),
          budgeted: (set.selectedCandidates || []).map((p) => p.word),
          dropReasons: uniq((set.assemblyDropTraces || []).map((d) => d.dropReason)),
        };
      });

      buckets.push({
        pathId: pr.pathId,
        domainId,
        spans: spanDetail,
        grid: gridFromOrch.length
          ? gridFromOrch
          : spanDetail.map((s) => uniq(s.budgeted.length ? s.budgeted : [s.spanText])),
        assemblyTexts: (gens[bi] || []).map((c) => c.text),
      });
    }
  }
  return buckets;
}

function humanJudgment(trace) {
  const raw = trace.rawText;
  const kenlmIn = trace.kenlmInputTexts || [];
  const assembly = uniq(trace.assemblyTexts || []);
  const odd = (trace.assemblyTexts || []).filter((t) => looksOddSentence(t, raw));

  // Suggested: keep raw always; keep domain-coherent non-odd alternatives that share most chars with raw
  const suggested = [];
  const push = (t) => {
    if (t && !suggested.includes(t)) suggested.push(t);
  };
  push(raw);
  for (const t of kenlmIn) {
    if (!looksOddSentence(t, raw)) push(t);
  }
  for (const t of assembly) {
    if (!looksOddSentence(t, raw) && suggested.length < 8) push(t);
  }
  // If multi-domain replacements look like genuine alternatives (same length slots), keep them if not odd
  if (suggested.length === 1 && kenlmIn.length > 1) {
    for (const t of kenlmIn) push(t);
  }

  const actual = kenlmIn;
  let conform = 'YES';
  let reason = 'KenLM 输入与合理候选集合一致（含 Raw 保留与同域替换）。';

  if (actual.length === 0) {
    conform = 'NO';
    reason = 'KenLM 输入为空。';
  } else if (odd.length && actual.some((t) => odd.includes(t))) {
    conform = 'NO';
    reason = `KenLM 输入含看起来离谱的组合：${odd.join('；')}`;
  } else if (actual.length === 1 && assembly.length > 1) {
    // check if dropped were only exact-text dupes
    const dropped = assembly.filter((t) => !actual.includes(t));
    if (dropped.length && !dropped.every((t) => actual.includes(t))) {
      // assembly more than kenlm due to crosspath - if uniqueBefore equals kenlm, OK
      if ((trace.uniqueBeforeCap || []).length > actual.length) {
        conform = 'NO';
        reason = `Assembly/去重后仍有多句，但 KenLM 输入被 cap 截断。去掉：${(trace.uniqueBeforeCap || [])
          .map((c) => c.text)
          .filter((t) => !actual.includes(t))
          .join('；')}`;
      } else if (assembly.length > actual.length) {
        conform = 'YES';
        reason = `CrossPath exact-text dedup 合并同文；设计允许。去掉同文重复：${uniq(
          (trace.allAssemblyBeforeDedup || []).filter((t) => {
            const first = actual.includes(t) || assembly.indexOf(t) !== (trace.allAssemblyBeforeDedup || []).indexOf(t);
            return !actual.includes(t) ? true : false;
          })
        ).join('；') || '同文重复'}`;
      }
    }
  } else if (
    suggested.some((s) => !actual.includes(s)) &&
    suggested.filter((s) => s !== raw).length > 0 &&
    actual.length === 1 &&
    actual[0] === raw &&
    assembly.some((t) => t !== raw && !looksOddSentence(t, raw))
  ) {
    conform = 'NO';
    reason = `存在看起来合理的非 Raw 替换句未进入 KenLM：${assembly
      .filter((t) => t !== raw && !looksOddSentence(t, raw))
      .join('；')}`;
  }

  // Design conformance for single raw-only when no multi grid
  if (
    actual.length === 1 &&
    actual[0] === raw &&
    (trace.buckets || []).every((b) => (b.grid || []).every((s) => s.length <= 1))
  ) {
    conform = 'YES';
    reason = '无多表面组合空间；仅 Raw/单候选进入 KenLM，符合冻结设计。';
  }

  return { suggested, actual, conform, reason, odd };
}

function renderMd(trace) {
  const lines = [];
  const num = trace.fileNum;
  lines.push(`# Case ${num}`);
  lines.push('');
  lines.push(`Case ID: \`${trace.caseId}\``);
  lines.push('');
  lines.push('## 1 Raw');
  lines.push('');
  lines.push('```text');
  lines.push(trace.rawText);
  lines.push('```');
  lines.push('');
  lines.push('## 2 Domain Vote');
  lines.push('');
  lines.push('retainedDomains:');
  lines.push('');
  if ((trace.retainedDomains || []).length) {
    for (const d of trace.retainedDomains) lines.push(`- ${d}`);
  } else {
    lines.push('- （base-only / insufficientEvidence）');
  }
  lines.push('');
  lines.push('domainScores:');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(trace.domainScores || {}, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## 3 SameDomain Bucket');
  lines.push('');
  for (const b of trace.buckets || []) {
    lines.push(`### Bucket \`${b.domainId ?? 'base-only'}\``);
    lines.push('');
    for (const s of b.spans || []) {
      lines.push(`Span${s.spanIndex}（\`${s.spanText}\`）`);
      lines.push('');
      lines.push(`- sameDomain: ${(s.sameDomain || []).join('、') || '（无）'}`);
      lines.push(`- base: ${(s.base || []).join('、') || '（无）'}`);
      lines.push(`- budgeted（进 Assembly）: ${(s.budgeted || []).join('、') || '（无）'}`);
      if ((s.dropReasons || []).length) {
        lines.push(`- dropReasons: ${s.dropReasons.join(', ')}`);
      }
      lines.push('');
    }
  }
  if (!(trace.buckets || []).length) {
    lines.push('（无 Bucket）');
    lines.push('');
  }
  lines.push('## 4 Assembly Grid');
  lines.push('');
  for (const b of trace.buckets || []) {
    lines.push(`### Bucket \`${b.domainId ?? 'base-only'}\``);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(b.grid || [], null, 2));
    lines.push('```');
    lines.push('');
  }
  lines.push('## 5 Assembly Result');
  lines.push('');
  const allAsm = uniq(trace.assemblyTexts || []);
  if (!allAsm.length) {
    lines.push('（无）');
  } else {
    for (const t of allAsm) {
      lines.push(`- ${t}`);
    }
  }
  lines.push('');
  lines.push('## 6 CrossPath Merge');
  lines.push('');
  const unique = (trace.uniqueBeforeCap || []).map((c) => c.text);
  const kenlmIn = trace.kenlmInputTexts || [];
  const mergeDropped = unique.filter((t) => !kenlmIn.includes(t));
  const asmBefore = trace.allAssemblyBeforeDedup || [];
  const dedupDropped = [];
  const seen = new Set();
  for (const t of asmBefore) {
    if (seen.has(t)) dedupDropped.push(t);
    else seen.add(t);
  }
  lines.push('Merge 后（dedup 后、cap 前）:');
  lines.push('');
  unique.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  if (!unique.length) lines.push('（无）');
  lines.push('');
  if (dedupDropped.length) {
    lines.push('exact-text dedup 去掉的同文重复:');
    lines.push('');
    for (const t of uniq(dedupDropped)) lines.push(`- ${t}`);
    lines.push('');
  }
  if (mergeDropped.length) {
    lines.push('global cap 截断去掉:');
    lines.push('');
    for (const t of mergeDropped) lines.push(`- ${t}`);
    lines.push('');
  }
  lines.push('## 7 KenLM Input');
  lines.push('');
  kenlmIn.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  if (!kenlmIn.length) lines.push('（无）');
  lines.push('');
  const same =
    unique.length === kenlmIn.length && unique.every((t, i) => t === kenlmIn[i]);
  if (same) {
    lines.push('**No further filtering**（CrossPath uniqueBeforeCap == KenLM Input）');
  } else if (mergeDropped.length) {
    lines.push('相对 CrossPath uniqueBeforeCap：存在 global cap 截断。');
  } else {
    lines.push('相对 Assembly 原文列表：仅 exact-text dedup / 顺序整理。');
  }
  lines.push('');
  lines.push('## 8 KenLM Ranking');
  lines.push('');
  if (trace.kenlm?.ran) {
    if (trace.kenlm.kenlmSubprocessErrorReason) {
      lines.push(`subprocess: \`${trace.kenlm.kenlmSubprocessErrorReason}\``);
      lines.push('');
    }
    for (const r of trace.kenlm.ranking || []) {
      lines.push(`${r.rank}.`);
      lines.push('');
      lines.push(`${r.text}`);
      lines.push('');
      lines.push(`${r.score}`);
      lines.push('');
    }
    if (!(trace.kenlm.ranking || []).length) {
      lines.push('（ran 但无 topCandidates）');
      lines.push('');
    }
  } else {
    lines.push(`未运行完整排序：${trace.kenlm?.reason || 'n/a'}`);
    lines.push('');
    if ((trace.kenlm?.ranking || []).length === 1) {
      lines.push(`1.`);
      lines.push('');
      lines.push(trace.kenlm.ranking[0].text);
      lines.push('');
      lines.push('（单句输入，无排序）');
      lines.push('');
    }
  }
  lines.push('## 9 Final Output');
  lines.push('');
  const finalText =
    trace.kenlm?.top1 ||
    (trace.kenlm?.ranking || [])[0]?.text ||
    kenlmIn[0] ||
    trace.rawText;
  lines.push(`最终采用：`);
  lines.push('');
  lines.push('```text');
  lines.push(finalText);
  lines.push('```');
  lines.push('');
  if (trace.kenlm?.ran && kenlmIn.length > 1) {
    lines.push('为什么：KenLM Top1');
  } else if (kenlmIn.length === 1) {
    lines.push('为什么：仅有一句 KenLM 输入（无多句排序）');
  } else if (!trace.kenlm?.ran && kenlmIn.length > 1) {
    lines.push('为什么：本轮未跑 KenLM 排序；以下展示 KenLM Input 首句作为观察用占位（非生产 Top1）');
  } else {
    lines.push('为什么：KenLM 未完整排序时取输入序首句 / Raw');
  }
  lines.push('');
  lines.push('## 【人工判断】');
  lines.push('');
  const hj = trace.humanJudgment;
  lines.push('我认为应该送入 KenLM 的句子：');
  lines.push('');
  for (const t of hj.suggested || []) lines.push(`- ${t}`);
  lines.push('');
  lines.push('当前实际送入 KenLM 的句子：');
  lines.push('');
  for (const t of hj.actual || []) lines.push(`- ${t}`);
  lines.push('');
  lines.push(`是否符合设计：`);
  lines.push('');
  lines.push(`**${hj.conform}**`);
  lines.push('');
  lines.push('原因：');
  lines.push('');
  lines.push(hj.reason);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### 观察标签（供 summary）');
  lines.push('');
  lines.push(`- singleAssemblyOnly: ${trace.flags.singleAssemblyOnly}`);
  lines.push(`- assemblyGt1_kenlmEq1: ${trace.flags.assemblyGt1_kenlmEq1}`);
  lines.push(`- crossPathDroppedMany: ${trace.flags.crossPathDroppedMany}`);
  lines.push(`- oddLooking: ${trace.flags.oddLooking}`);
  lines.push(`- kenlmTop1Questionable: ${trace.flags.kenlmTop1Questionable}`);
  lines.push(`- singleReasons: ${(trace.flags.singleReasons || []).join('；')}`);
  if ((trace.flags.oddTexts || []).length) {
    lines.push(`- oddTexts: ${trace.flags.oddTexts.join('｜')}`);
  }
  if ((trace.flags.droppedByDedupOrCap || []).length) {
    lines.push(`- dropped: ${trace.flags.droppedByDedupOrCap.join('｜')}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function processCase(c) {
  const rawText = c.text;
  const orch = runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    traceCaseId: c.id,
  });

  const primary = (orch.pathAssemblyResults || [])[0];
  const vote = primary?.assemblyResult?.vote || {};
  const buckets = enrichBuckets(rawText, orch);

  const allAssemblyBeforeDedup = [];
  for (const pr of orch.pathAssemblyResults || []) {
    for (const list of pr.perBucketGenerated || []) {
      for (const combo of list) allAssemblyBeforeDedup.push(combo.text);
    }
  }
  const assemblyTexts = uniq(allAssemblyBeforeDedup);
  const uniqueBeforeCap = orch.kenlmSentenceCandidates?.uniqueBeforeCap || [];
  const kenlmCombos = orch.kenlmSentenceCandidates?.combinations || [];
  const kenlmInputTexts = kenlmCombos.map((x) => x.text);

  const kenlm = await maybeKenlm(rawText, orch, kenlmCombos);

  const oddTexts = assemblyTexts.filter((t) => looksOddSentence(t, rawText));
  const dedupDropped = [];
  {
    const seen = new Set();
    for (const t of allAssemblyBeforeDedup) {
      if (seen.has(t)) dedupDropped.push(t);
      else seen.add(t);
    }
  }
  const capDropped = uniqueBeforeCap.map((c) => c.text).filter((t) => !kenlmInputTexts.includes(t));

  const singleAssemblyOnly = assemblyTexts.length <= 1;
  const assemblyGt1_kenlmEq1 = assemblyTexts.length > 1 && kenlmInputTexts.length === 1;
  const crossPathDroppedMany =
    uniq(dedupDropped).length + capDropped.length >= 2 ||
    allAssemblyBeforeDedup.length >= kenlmInputTexts.length + 2;

  let kenlmTop1Questionable = false;
  if (kenlm.ran && kenlm.top1 && kenlmInputTexts.length > 1) {
    // questionable if top1 is odd while a less-odd alternative exists
    if (looksOddSentence(kenlm.top1, rawText)) kenlmTop1Questionable = true;
    if (
      kenlm.top1 !== rawText &&
      looksOddSentence(kenlm.top1, rawText) &&
      kenlmInputTexts.includes(rawText)
    ) {
      kenlmTop1Questionable = true;
    }
    // or top1 changes raw into clearly cross-domain mash when score error/timeout
    if (kenlm.kenlmSubprocessErrorReason && kenlm.top1 !== rawText) {
      kenlmTop1Questionable = true;
    }
  }

  const trace = {
    caseId: c.id,
    fileNum: caseFileNum(c.id),
    rawText,
    scenario: c.scenario,
    retainedDomains: [...(vote.retainedDomains || [])],
    domainScores: { ...(vote.domainScores || {}) },
    insufficientEvidence: !!vote.insufficientEvidence,
    buckets,
    assemblyTexts,
    allAssemblyBeforeDedup,
    uniqueBeforeCap,
    kenlmInputTexts,
    kenlm,
    flags: {
      singleAssemblyOnly,
      assemblyGt1_kenlmEq1,
      crossPathDroppedMany,
      oddLooking: oddTexts.length > 0,
      kenlmTop1Questionable,
      singleReasons: singleAssemblyOnly ? reasonSingleAssembly({
        retainedDomains: vote.retainedDomains,
        buckets,
        assemblyTexts,
        rawText,
      }) : [],
      oddTexts,
      droppedByDedupOrCap: uniq([...dedupDropped, ...capDropped]),
    },
  };
  trace.humanJudgment = humanJudgment(trace);
  return trace;
}

async function main() {
  const progressPath = path.join(outDir, '_progress.json');
  let startAt = 0;
  if (process.env.DIALOG200_TRACE_RESUME === '1' && fs.existsSync(progressPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
      startAt = Number(prev.completed) || 0;
    } catch (_) {}
  }
  log(`cases=${dialogCases.length} startAt=${startAt} kenlm=${process.env.DIALOG200_TRACE_KENLM === '1'}`);
  const index = [];
  const review = {
    A_single: [],
    B_asmGt1_kenlm1: [],
    C_crossPathDropped: [],
    D_oddLooking: [],
    E_kenlmTop1Questionable: [],
    humanNo: [],
  };

  // reload prior review/index if resuming
  if (startAt > 0) {
    for (let k = 1; k <= startAt; k++) {
      const fn = String(k).padStart(3, '0');
      const jp = path.join(outDir, `${fn}.json`);
      if (!fs.existsSync(jp)) continue;
      try {
        const trace = JSON.parse(fs.readFileSync(jp, 'utf8'));
        index.push({
          file: `${trace.fileNum}.md`,
          caseId: trace.caseId,
          raw: trace.rawText,
          kenlmN: (trace.kenlmInputTexts || []).length,
          conform: trace.humanJudgment?.conform,
        });
        accumulateReview(review, trace);
      } catch (_) {}
    }
  }

  let i = startAt;
  for (const c of dialogCases.slice(startAt)) {
    i += 1;
    const t0 = performance.now();
    let trace;
    try {
      trace = await processCase(c);
    } catch (e) {
      trace = {
        caseId: c.id,
        fileNum: caseFileNum(c.id),
        rawText: c.text,
        error: String(e && e.stack ? e.stack : e),
        retainedDomains: [],
        domainScores: {},
        buckets: [],
        assemblyTexts: [],
        kenlmInputTexts: [],
        kenlm: { ran: false, reason: 'orchestrator_error', ranking: [] },
        flags: {
          singleAssemblyOnly: true,
          assemblyGt1_kenlmEq1: false,
          crossPathDroppedMany: false,
          oddLooking: false,
          kenlmTop1Questionable: false,
          singleReasons: ['orchestrator_error'],
          oddTexts: [],
          droppedByDedupOrCap: [],
        },
        humanJudgment: {
          suggested: [c.text],
          actual: [],
          conform: 'NO',
          reason: `运行失败：${e && e.message ? e.message : e}`,
        },
      };
    }
    const md = trace.error
      ? `# Case ${trace.fileNum}\n\nCase ID: \`${trace.caseId}\`\n\n## ERROR\n\n\`\`\`\n${trace.error}\n\`\`\`\n`
      : renderMd(trace);
    fs.writeFileSync(path.join(outDir, `${trace.fileNum}.md`), md, 'utf8');
    fs.writeFileSync(path.join(outDir, `${trace.fileNum}.json`), JSON.stringify(trace, null, 2), 'utf8');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ completed: i, lastCaseId: c.id, at: new Date().toISOString() }, null, 2),
      'utf8'
    );
    index.push({
      file: `${trace.fileNum}.md`,
      caseId: trace.caseId,
      raw: trace.rawText,
      kenlmN: (trace.kenlmInputTexts || []).length,
      conform: trace.humanJudgment?.conform,
    });
    accumulateReview(review, trace);
    log(`${i}/${dialogCases.length} ${c.id} kenlmIn=${(trace.kenlmInputTexts || []).length} ${Math.round(performance.now() - t0)}ms`);
  }

  fs.writeFileSync(path.join(outDir, '_index.json'), JSON.stringify(index, null, 2), 'utf8');
  writeSummary(review);
  log(`wrote ${outDir}`);
  log(`wrote ${summaryPath}`);
}

function accumulateReview(review, trace) {
  if (trace.flags?.singleAssemblyOnly) {
    review.A_single.push({
      caseId: trace.caseId,
      file: `${trace.fileNum}.md`,
      raw: trace.rawText,
      reasons: trace.flags.singleReasons,
      kenlm: trace.kenlmInputTexts,
    });
  }
  if (trace.flags?.assemblyGt1_kenlmEq1) {
    review.B_asmGt1_kenlm1.push({
      caseId: trace.caseId,
      file: `${trace.fileNum}.md`,
      raw: trace.rawText,
      assembly: trace.assemblyTexts,
      kenlm: trace.kenlmInputTexts,
      note: 'Assembly 多句但 KenLM 仅 1：通常为 CrossPath exact-text dedup 后同文合并',
    });
  }
  if (trace.flags?.crossPathDroppedMany) {
    review.C_crossPathDropped.push({
      caseId: trace.caseId,
      file: `${trace.fileNum}.md`,
      raw: trace.rawText,
      dropped: trace.flags.droppedByDedupOrCap,
      kenlm: trace.kenlmInputTexts,
    });
  }
  if (trace.flags?.oddLooking) {
    review.D_oddLooking.push({
      caseId: trace.caseId,
      file: `${trace.fileNum}.md`,
      raw: trace.rawText,
      oddTexts: trace.flags.oddTexts,
    });
  }
  if (trace.flags?.kenlmTop1Questionable) {
    review.E_kenlmTop1Questionable.push({
      caseId: trace.caseId,
      file: `${trace.fileNum}.md`,
      raw: trace.rawText,
      top1: trace.kenlm?.top1,
      inputs: trace.kenlmInputTexts,
    });
  }
  if (trace.humanJudgment?.conform === 'NO') {
    review.humanNo.push({
      caseId: trace.caseId,
      file: `${trace.fileNum}.md`,
      raw: trace.rawText,
      reason: trace.humanJudgment.reason,
    });
  }
}

function writeSummary(review) {
  const sum = [];
  sum.push('# dialog_200 Sentence Assembly Full Trace — 人工审阅清单');
  sum.push('');
  sum.push('本文件只列出值得人工看的 Case。逐 Case 全文见 `dialog200_sentence_assembly_trace/NNN.md`。');
  sum.push('');
  sum.push('本轮只观察，不修复。');
  sum.push('');
  sum.push('---');
  sum.push('');
  sum.push('## A. 只有一条 Assembly');
  sum.push('');
  sum.push('这些 Case 的 Assembly 最终只有一句。原因写在条目里（不是 prefilled=1 口号）。');
  sum.push('');
  for (const x of review.A_single) {
    sum.push(`### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`);
    sum.push('');
    sum.push('Raw:');
    sum.push('');
    sum.push('```text');
    sum.push(x.raw);
    sum.push('```');
    sum.push('');
    sum.push('为什么只有一句:');
    sum.push('');
    for (const r of x.reasons || []) sum.push(`- ${r}`);
    sum.push('');
    sum.push('KenLM Input:');
    sum.push('');
    for (const t of x.kenlm || []) sum.push(`- ${t}`);
    sum.push('');
  }
  if (!review.A_single.length) {
    sum.push('（无）');
    sum.push('');
  }

  sum.push('## B. Assembly>1 但 KenLM=1');
  sum.push('');
  for (const x of review.B_asmGt1_kenlm1) {
    sum.push(`### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`);
    sum.push('');
    sum.push('Raw:');
    sum.push('');
    sum.push('```text');
    sum.push(x.raw);
    sum.push('```');
    sum.push('');
    sum.push('Assembly:');
    sum.push('');
    for (const t of x.assembly || []) sum.push(`- ${t}`);
    sum.push('');
    sum.push('KenLM Input:');
    sum.push('');
    for (const t of x.kenlm || []) sum.push(`- ${t}`);
    sum.push('');
    sum.push(`为什么：${x.note}`);
    sum.push('');
  }
  if (!review.B_asmGt1_kenlm1.length) {
    sum.push('（无）');
    sum.push('');
  }

  sum.push('## C. Assembly 很多，CrossPath 去掉很多');
  sum.push('');
  for (const x of review.C_crossPathDropped) {
    sum.push(`### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`);
    sum.push('');
    sum.push('Raw:');
    sum.push('');
    sum.push('```text');
    sum.push(x.raw);
    sum.push('```');
    sum.push('');
    sum.push('去掉哪些:');
    sum.push('');
    for (const t of x.dropped || []) sum.push(`- ${t}`);
    sum.push('');
    sum.push('为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。');
    sum.push('');
    sum.push('KenLM 剩余:');
    sum.push('');
    for (const t of x.kenlm || []) sum.push(`- ${t}`);
    sum.push('');
  }
  if (!review.C_crossPathDropped.length) {
    sum.push('（无）');
    sum.push('');
  }

  sum.push('## D. Assembly 看起来离谱');
  sum.push('');
  sum.push('启发式列出（低脂/地址、议员/咖啡等跨域混搭或大幅改写）。不修改，只列。');
  sum.push('');
  for (const x of review.D_oddLooking) {
    sum.push(`### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`);
    sum.push('');
    sum.push('Raw:');
    sum.push('');
    sum.push('```text');
    sum.push(x.raw);
    sum.push('```');
    sum.push('');
    sum.push('离谱句:');
    sum.push('');
    for (const t of x.oddTexts || []) sum.push(`- ${t}`);
    sum.push('');
  }
  if (!review.D_oddLooking.length) {
    sum.push('（无）');
    sum.push('');
  }

  sum.push('## E. KenLM Top1 明显可疑');
  sum.push('');
  for (const x of review.E_kenlmTop1Questionable) {
    sum.push(`### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`);
    sum.push('');
    sum.push('Raw:');
    sum.push('');
    sum.push('```text');
    sum.push(x.raw);
    sum.push('```');
    sum.push('');
    sum.push(`Top1: ${x.top1}`);
    sum.push('');
    sum.push('Inputs:');
    sum.push('');
    for (const t of x.inputs || []) sum.push(`- ${t}`);
    sum.push('');
  }
  if (!review.E_kenlmTop1Questionable.length) {
    sum.push('（无 — 本轮默认未跑 KenLM 排序；见各 Case 第 7 节 KenLM Input）');
    sum.push('');
  }

  sum.push('## 人工判断 = NO');
  sum.push('');
  for (const x of review.humanNo) {
    sum.push(`### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`);
    sum.push('');
    sum.push('```text');
    sum.push(x.raw);
    sum.push('```');
    sum.push('');
    sum.push(`原因：${x.reason}`);
    sum.push('');
  }
  if (!review.humanNo.length) {
    sum.push('（无）');
    sum.push('');
  }

  fs.writeFileSync(summaryPath, sum.join('\n'), 'utf8');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
