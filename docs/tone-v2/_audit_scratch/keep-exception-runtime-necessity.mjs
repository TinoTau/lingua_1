/**
 * READ ONLY — Runtime necessity audit for 22 KEEP_AS_EXCEPTION terms.
 *
 * Counterfactual:
 *   WITH  = production Lattice + Orchestrator (Mandatory Tone fixtures from DB)
 *   WITHOUT = same, but Probe runtime wrapper drops lookup hits whose word === full surface
 *
 * No Source / SQLite / Validator / Domain / Rebuild / Enforce mutation.
 *
 * Run:
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe docs/tone-v2/_audit_scratch/keep-exception-runtime-necessity.mjs
 * (cwd: electron_node/electron-node)
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'keep_runtime_necessity');
const docsTone = path.join(repo, 'docs/tone-v2');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runLatticeFineSpanGeneration } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);

const KEEP22 = [
  '专家系统',
  '单元测试',
  '回归测试',
  '安检通道',
  '循环网络',
  '正则策略',
  '注册中心',
  '流量镜像',
  '测试数据',
  '熔断策略',
  '特征工程',
  '神经网络',
  '联系电话',
  '视频会议',
  '训练数据',
  '迁移学习',
  '迷你吧',
  '邀请函',
  '配置中心',
  '配置文件',
  '降级策略',
  '集成测试',
];

const FOCUS = new Set([
  '神经网络',
  '迁移学习',
  '特征工程',
  '单元测试',
  '回归测试',
  '集成测试',
  '配置文件',
  '训练数据',
  '测试数据',
  '流量镜像',
  '熔断策略',
  '降级策略',
  '正则策略',
  '视频会议',
  '联系电话',
  '迷你吧',
]);

const candidateDir = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate');
const db = new Database(path.join(candidateDir, 'lexicon.sqlite'), { readonly: true });
const profile = defaultGeneralProfile();
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const rt = new LexiconRuntimeV2();
const st = rt.loadFromBundleDir(candidateDir);
if (st.status !== 'ok') throw new Error(`load fail: ${st.status}`);
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

function tonesOf(word) {
  const row =
    db.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`).get(word) ||
    db.prepare(`SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`).get(word);
  if (!row?.tone_pinyin_key) {
    throw new Error(`missing tone_pinyin_key for ${word}`);
  }
  return String(row.tone_pinyin_key)
    .split('|')
    .map((p) => {
      const m = p.match(/([1-5])$/);
      const n = m ? Number(m[1]) : 1;
      return /** @type {1|2|3|4|5} */ (n >= 1 && n <= 5 ? n : 1);
    });
}

function entryWord(h) {
  return String(h?.word || '').trim();
}

function filterExclude(result, excludeWord) {
  if (!Array.isArray(result)) return result;
  return result.filter((h) => entryWord(h) !== excludeWord);
}

/** Probe-only: drop full-surface hits from every lookup* array return. */
function wrapRuntimeExclude(runtime, excludeWord) {
  return new Proxy(runtime, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      const name = String(prop);
      if (name.startsWith('lookup')) {
        return function wrappedLookup(...args) {
          const out = val.apply(target, args);
          if (Array.isArray(out)) return filterExclude(out, excludeWord);
          if (out && typeof out === 'object' && Array.isArray(out.hits)) {
            return { ...out, hits: filterExclude(out.hits, excludeWord) };
          }
          return out;
        };
      }
      return function bound(...args) {
        return val.apply(target, args);
      };
    },
  });
}

function edgeReplacements(edges) {
  const out = [];
  for (const e of edges || []) {
    for (const c of e.candidates || []) {
      out.push({
        edgeId: e.edgeId,
        syllableStart: e.syllableStart,
        syllableEnd: e.syllableEnd,
        replacement: c.replacement,
        domains: c.domains || [],
        candidateScore: c.candidateScore,
        repairTarget: c.repairTarget === true,
      });
    }
  }
  return out;
}

function pathBoundaryKeys(paths) {
  return (paths || []).map((p) => p.boundaryKey || p.pathId).filter(Boolean);
}

function sameSorted(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

function extractOrch(out) {
  const combos = out.kenlmSentenceCandidates?.combinations || [];
  const texts = combos.map((c) => c.text).filter(Boolean);
  const retained = out.metrics?.retainedDomains || out.retainedDomains || [];
  const bucketCount =
    out.metrics?.retainedBucketCount ??
    out.latticeTrace?.pathAssemblyTraces?.[0]?.bucketCount ??
    null;
  return {
    coverageStatus: out.latticeTrace?.coverageStatus ?? null,
    lexicalEdgeCount: out.latticeTrace?.lexicalEdgeCount ?? null,
    fallbackEdgeCount: out.latticeTrace?.fallbackEdgeCount ?? null,
    pathCount: out.latticeTrace?.retainedCompletePathCount ?? null,
    retainedDomains: [...retained],
    bucketCount,
    assemblyCandidateCount: texts.length,
    kenlmInputCount: texts.length,
    kenlmTop1: texts[0] || '',
    sentenceCandidates: texts,
    finalSentence: texts[0] || '',
  };
}

function runCounterfactual(surface) {
  const tones = tonesOf(surface);
  const fix = makeCharToneFixtures(surface, tones);
  const term = db.prepare(`SELECT pinyin_key, tone_pinyin_key FROM term WHERE word=?`).get(surface);
  const syllables = String(term.pinyin_key).split('|').filter(Boolean);
  const rtEx = wrapRuntimeExclude(rt, surface);

  const exactW = recallSpanTopKV2(rt, {
    syllables,
    windowText: surface,
    termLength: syllables.length,
    topK: 5,
    perSpanLimit: 5,
    profile,
    domainIds,
    acousticTonePattern: tones,
    toneCallerEnabled: true,
  });
  const exactX = recallSpanTopKV2(rtEx, {
    syllables,
    windowText: surface,
    termLength: syllables.length,
    topK: 5,
    perSpanLimit: 5,
    profile,
    domainIds,
    acousticTonePattern: tones,
    toneCallerEnabled: true,
  });

  const common = {
    rawText: surface,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    toneTimestampOnlyEnabled: true,
    acousticSlices: fix.acousticSlices,
    wordTimeSpans: fix.wordTimeSpans,
  };

  const latticeW = runLatticeFineSpanGeneration({ ...common, runtime: rt });
  const latticeX = runLatticeFineSpanGeneration({ ...common, runtime: rtEx });
  if (!latticeW.ok || !latticeX.ok) {
    throw new Error(
      `lattice fail ${surface}: W=${latticeW.ok ? 'ok' : latticeW.code} X=${latticeX.ok ? 'ok' : latticeX.code}`
    );
  }

  const orchW = runSpanAssemblyV4Orchestrator({
    ...common,
    runtime: rt,
    recallDomainScope: domainIds,
    domainPriors: [],
  });
  const orchX = runSpanAssemblyV4Orchestrator({
    ...common,
    runtime: rtEx,
    recallDomainScope: domainIds,
    domainPriors: [],
  });

  const replW = edgeReplacements(latticeW.lexicalEdges);
  const replX = edgeReplacements(latticeX.lexicalEdges);
  const snapW = {
    ...extractOrch(orchW),
    coverageStatus: latticeW.trace.coverageStatus,
    lexicalEdgeCount: latticeW.trace.lexicalEdgeCount,
    fallbackEdgeCount: latticeW.trace.fallbackEdgeCount,
    pathCount: latticeW.trace.retainedCompletePathCount,
    pathBoundaryKeys: pathBoundaryKeys(latticeW.segmentationPaths),
    edgeReplacements: replW.map((r) => `${r.edgeId}:${r.replacement}`),
    compoundInEdges: replW.some((r) => r.replacement === surface),
    exactRecallHit: exactW.hits.some((h) => h.hotword.word === surface),
    exactRecallTop: exactW.hits.slice(0, 5).map((h) => h.hotword.word),
  };
  const snapX = {
    ...extractOrch(orchX),
    coverageStatus: latticeX.trace.coverageStatus,
    lexicalEdgeCount: latticeX.trace.lexicalEdgeCount,
    fallbackEdgeCount: latticeX.trace.fallbackEdgeCount,
    pathCount: latticeX.trace.retainedCompletePathCount,
    pathBoundaryKeys: pathBoundaryKeys(latticeX.segmentationPaths),
    edgeReplacements: replX.map((r) => `${r.edgeId}:${r.replacement}`),
    compoundInEdges: replX.some((r) => r.replacement === surface),
    exactRecallHit: exactX.hits.some((h) => h.hotword.word === surface),
    exactRecallTop: exactX.hits.slice(0, 5).map((h) => h.hotword.word),
  };

  const exclusionOk = !snapX.compoundInEdges && !snapX.exactRecallHit;

  const spanCoverageChanged = snapW.coverageStatus !== snapX.coverageStatus;
  const domainChanged = !sameSorted(snapW.retainedDomains, snapX.retainedDomains);
  const assemblyDropped = snapX.assemblyCandidateCount < snapW.assemblyCandidateCount;
  const kenlmDropped = snapX.kenlmInputCount < snapW.kenlmInputCount;
  const top1Changed = snapW.kenlmTop1 !== snapX.kenlmTop1;
  const finalChanged = snapW.finalSentence !== snapX.finalSentence;
  const sentencesChanged =
    JSON.stringify(snapW.sentenceCandidates) !== JSON.stringify(snapX.sentenceCandidates);
  const bucketChanged = snapW.bucketCount !== snapX.bucketCount;
  const edgeDelta = (snapX.lexicalEdgeCount ?? 0) - (snapW.lexicalEdgeCount ?? 0);
  const pathDelta = (snapX.pathCount ?? 0) - (snapW.pathCount ?? 0);

  const reasons = [];
  if (spanCoverageChanged) reasons.push('SPAN_COVERAGE_CHANGED');
  if (domainChanged) reasons.push('DOMAIN_VOTE_CHANGED');
  if (assemblyDropped) reasons.push('ASSEMBLY_CANDIDATES_DROPPED');
  if (kenlmDropped) reasons.push('KENLM_INPUT_DROPPED');
  if (top1Changed) reasons.push('KENLM_TOP1_CHANGED');
  if (finalChanged) reasons.push('FINAL_SENTENCE_CHANGED');

  // §六 / §七 — only hard Assembly/Domain/KenLM/Coverage/final criteria decide KEEP.
  const hardDegradation =
    spanCoverageChanged ||
    domainChanged ||
    assemblyDropped ||
    kenlmDropped ||
    top1Changed ||
    finalChanged;

  const identicalHard =
    !spanCoverageChanged &&
    !domainChanged &&
    !assemblyDropped &&
    !kenlmDropped &&
    !top1Changed &&
    !finalChanged &&
    !sentencesChanged &&
    snapW.assemblyCandidateCount === snapX.assemblyCandidateCount &&
    snapW.kenlmInputCount === snapX.kenlmInputCount;

  const verdict = hardDegradation ? 'KEEP_RUNTIME_REQUIRED' : 'DELETE_RUNTIME_SAFE';

  return {
    surface,
    focus: FOCUS.has(surface),
    verdict,
    exclusionOk,
    compoundParticipatedWith: snapW.compoundInEdges || snapW.exactRecallHit,
    with: snapW,
    without: snapX,
    diff: {
      spanCoverageChanged,
      domainChanged,
      bucketChanged,
      assemblyDropped,
      kenlmDropped,
      top1Changed,
      finalChanged,
      sentencesChanged,
      edgeDelta,
      pathDelta,
      reasons,
      identicalHard,
      note:
        edgeDelta < 0 || pathDelta < 0
          ? 'Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七'
          : null,
    },
  };
}

const results = KEEP22.map((s) => runCounterfactual(s));
const required = results.filter((r) => r.verdict === 'KEEP_RUNTIME_REQUIRED');
const safe = results.filter((r) => r.verdict === 'DELETE_RUNTIME_SAFE');
const noParticipation = results.filter((r) => !r.compoundParticipatedWith);

function toCsv(rows) {
  const headers = [
    'surface',
    'verdict',
    'exclusionOk',
    'compoundParticipatedWith',
    'withExactRecall',
    'withoutExactRecall',
    'withCoverage',
    'withoutCoverage',
    'withLexicalEdges',
    'withoutLexicalEdges',
    'withPaths',
    'withoutPaths',
    'withAssembly',
    'withoutAssembly',
    'withKenlmTop1',
    'withoutKenlmTop1',
    'withDomains',
    'withoutDomains',
    'withBuckets',
    'withoutBuckets',
    'withEdgeRepls',
    'withoutEdgeRepls',
    'reasons',
    'identicalHard',
  ];
  const esc = (v) => {
    const s = Array.isArray(v) ? v.join('|') : String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.surface,
        r.verdict,
        r.exclusionOk,
        r.compoundParticipatedWith,
        r.with.exactRecallHit,
        r.without.exactRecallHit,
        r.with.coverageStatus,
        r.without.coverageStatus,
        r.with.lexicalEdgeCount,
        r.without.lexicalEdgeCount,
        r.with.pathCount,
        r.without.pathCount,
        r.with.assemblyCandidateCount,
        r.without.assemblyCandidateCount,
        r.with.kenlmTop1,
        r.without.kenlmTop1,
        (r.with.retainedDomains || []).join('|'),
        (r.without.retainedDomains || []).join('|'),
        r.with.bucketCount,
        r.without.bucketCount,
        (r.with.edgeReplacements || []).join(';'),
        (r.without.edgeReplacements || []).join(';'),
        r.diff.reasons.join('|'),
        r.diff.identicalHard,
      ]
        .map(esc)
        .join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

function block(r) {
  return `### ${r.surface}

**Verdict:** \`${r.verdict}\`  
**Probe exclusion OK:** ${r.exclusionOk}  
**Compound in WITH Probe/Edges:** ${r.compoundParticipatedWith} (exact=${r.with.exactRecallHit}, edges=${r.with.compoundInEdges})

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | ${r.with.exactRecallHit} | ${r.without.exactRecallHit} |
| Span coverage | ${r.with.coverageStatus} | ${r.without.coverageStatus} |
| LexicalEdge count | ${r.with.lexicalEdgeCount} | ${r.without.lexicalEdgeCount} |
| Segmentation path count | ${r.with.pathCount} | ${r.without.pathCount} |
| Assembly / KenLM inputs | ${r.with.assemblyCandidateCount} | ${r.without.assemblyCandidateCount} |
| Domain Vote | [${(r.with.retainedDomains || []).join(', ')}] | [${(r.without.retainedDomains || []).join(', ')}] |
| Bucket | ${r.with.bucketCount} | ${r.without.bucketCount} |
| KenLM Top1 / final | ${r.with.kenlmTop1 || '(empty)'} | ${r.without.kenlmTop1 || '(empty)'} |

- WITH edge replacements: ${(r.with.edgeReplacements || []).join(', ') || '(none)'}
- WITHOUT edge replacements: ${(r.without.edgeReplacements || []).join(', ') || '(none)'}
- Diff reasons (hard): ${r.diff.reasons.length ? r.diff.reasons.join(', ') : '(none)'}
- Lattice note: ${r.diff.note || '(none)'}
`;
}

const csv = toCsv(results);
fs.writeFileSync(path.join(docsTone, 'keep_exception_runtime_necessity.csv'), csv, 'utf8');
fs.writeFileSync(path.join(outDir, 'keep_exception_runtime_necessity.csv'), csv, 'utf8');
fs.writeFileSync(
  path.join(outDir, 'keep_exception_runtime_necessity.json'),
  JSON.stringify(
    {
      method: {
        with: 'Lattice FineSpan + Orchestrator with DB-derived Mandatory Tone fixtures',
        without:
          'same + Probe Proxy excluding lookup hits where word === full surface (no Source write)',
        verdictRules:
          'KEEP_RUNTIME_REQUIRED only if Coverage/Domain/Assembly/KenLM Top1/final degrade; else DELETE_RUNTIME_SAFE',
      },
      required: required.map((r) => r.surface),
      safe: safe.map((r) => r.surface),
      noParticipation: noParticipation.map((r) => r.surface),
      results,
    },
    null,
    2
  ),
  'utf8'
);

const md = `# FW Repair V4 — Runtime Necessity Audit for KEEP_AS_EXCEPTION

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · RUNTIME NECESSITY ONLY** |
| Input | 22 \`KEEP_AS_EXCEPTION\` (Batch-1 revalidation) |
| Status | **NECESSITY_AUDIT_READY** |
| Final labels | \`KEEP_RUNTIME_REQUIRED\` / \`DELETE_RUNTIME_SAFE\` only |

---

## 1. Question

删掉完整 term 后，Lattice / Assembly / Domain Vote / KenLM / 最终句子是否退化？

不是语言学“是不是术语”，而是 Runtime 反事实。

---

## 2. Method

1. Utterance = surface 本身（最短反事实）。
2. **Mandatory Tone fixtures**：从 candidate SQLite \`tone_pinyin_key\` 生成 \`acousticSlices\` + \`wordTimeSpans\`（\`makeCharToneFixtures\`），否则 Batch 1.1C Fail-Closed 下复合词 **不会进入 Probe**。
3. **WITH**：生产 \`runLatticeFineSpanGeneration\` + \`runSpanAssemblyV4Orchestrator\`。
4. **WITHOUT**：Probe Proxy 过滤所有 \`lookup*\` 命中中 \`word === surface\` 的完整 term（不改 Source / 不写 SQLite）。
5. 额外核对：\`recallSpanTopKV2\` Exact Recall WITH/WITHOUT。
6. **判定（§六 / §七）**：仅当 Span coverage / Domain Vote / Assembly 候选 / KenLM Top1 / 最终句子出现硬退化 → \`KEEP_RUNTIME_REQUIRED\`；若 Assembly·KenLM·最终句·Domain 完全一致 → \`DELETE_RUNTIME_SAFE\`（即使 LexicalEdge / Path 数量下降，也不因“固定技术术语”保留）。

Artifacts:

- [keep_exception_runtime_necessity.csv](./keep_exception_runtime_necessity.csv)
- \`docs/tone-v2/_audit_scratch/keep_runtime_necessity/keep_exception_runtime_necessity.json\`

---

## 3. Summary

| Verdict | Count |
|---------|------:|
| KEEP_RUNTIME_REQUIRED | **${required.length}** |
| DELETE_RUNTIME_SAFE | **${safe.length}** |
| Total | 22 |

**KEEP_RUNTIME_REQUIRED:**  
${required.length ? required.map((r) => `- ${r.surface} (${r.diff.reasons.join('|')})`).join('\n') : '_None_'}

**DELETE_RUNTIME_SAFE:**  
${safe.map((r) => `- ${r.surface}`).join('\n')}

**WITH 中复合词未进入 Probe/Edges（排除完整 term 对 Lattice 无增量参与）:**  
${noParticipation.length ? noParticipation.map((r) => `- ${r.surface}`).join('\n') : '_None_'}

Exclusion failures: ${results.filter((r) => !r.exclusionOk).map((r) => r.surface).join(', ') || '_none_'}

---

## 4. Focus Item Detail（§八）

${results.filter((r) => r.focus).map(block).join('\n')}

---

## 5. Remaining Items

${results.filter((r) => !r.focus).map(block).join('\n')}

---

## 6. Development Implication

### KEEP_RUNTIME_REQUIRED（Runtime 必需保留）
${required.map((r) => `- ${r.surface}`).join('\n') || '_none_'}

### DELETE_RUNTIME_SAFE（可与 DELETE_CONFIRMED 合并评估删除）
${safe.map((r) => `- ${r.surface}`).join('\n')}

\`KEEP_AS_EXCEPTION\` / \`fixed_technical_term\` **不再作为最终开发依据**。本轮证据表明：多数项在排除完整 term 后，原子 LexicalEdge（或 fallback）仍拼出相同 Assembly / KenLM Top1 / 最终句。

---

## 7. Final Answer

\`\`\`text
KEEP_RUNTIME_REQUIRED: ${required.length} / 22
DELETE_RUNTIME_SAFE:   ${safe.length} / 22

结论：这 22 个词中，${required.length === 0 ? '没有' : '仅 ' + required.length + ' 个'}因删除后 Coverage/Domain/Assembly/KenLM/最终句退化而必须保留；
其余 ${safe.length} 个在 Runtime 反事实上可依赖原子路径（或 fallback 字符路径）恢复等价结果，不应再因“术语例外”拦删除。
\`\`\`
`;

fs.writeFileSync(
  path.join(docsTone, 'FW_Repair_V4_KEEP_AS_EXCEPTION_Runtime_Necessity_Audit_2026_08_02.md'),
  md,
  'utf8'
);

console.log(
  JSON.stringify(
    {
      required: required.map((r) => r.surface),
      safe: safe.map((r) => r.surface),
      noParticipation: noParticipation.map((r) => r.surface),
      exclusionFails: results.filter((r) => !r.exclusionOk).map((r) => r.surface),
      edgeDrops: results
        .filter((r) => r.diff.edgeDelta < 0)
        .map((r) => `${r.surface}:${r.with.lexicalEdgeCount}->${r.without.lexicalEdgeCount}`),
    },
    null,
    2
  )
);

db.close();
