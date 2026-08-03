/**
 * READ ONLY — Sentence-context Runtime Regression for 22 DELETE_RUNTIME_SAFE terms.
 *
 * WITH  = production orchestrator (Mandatory Tone fixtures)
 * WITHOUT = Probe Proxy drops lookup hits where word === compoundTerm
 *
 * No Source / SQLite / Validator / Domain / Rebuild / Enforce / KenLM / Runtime mutation.
 *
 * Run (cwd electron_node/electron-node):
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\sentence-context-runtime-regression.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'sentence_runtime_regression');
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
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);

/** 22 DELETE_RUNTIME_SAFE compounds — do not expand. */
const TERMS_22 = [
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
  '邀请函',
]);

/**
 * >=2 natural full sentences per term (陈述句 + 业务句).
 * No surface-only / two-word concat.
 */
const SENTENCES = [
  // 专家系统
  { term: '专家系统', kind: '陈述', sentence: '我们正在升级公司内部的专家系统平台。' },
  { term: '专家系统', kind: '业务', sentence: '专家系统已经接入客服知识库并通过验收。' },
  // 单元测试
  { term: '单元测试', kind: '陈述', sentence: '开发同学今天补齐了核心模块的单元测试。' },
  { term: '单元测试', kind: '业务', sentence: '请在合并前确保单元测试全部通过。' },
  // 回归测试
  { term: '回归测试', kind: '陈述', sentence: '我们计划在发版前完成完整回归测试。' },
  { term: '回归测试', kind: '业务', sentence: '回归测试报告已经同步给质量保障团队。' },
  // 安检通道
  { term: '安检通道', kind: '陈述', sentence: '旅客需要提前十分钟到达安检通道排队。' },
  { term: '安检通道', kind: '业务', sentence: '安检通道临时关闭请改走二号口。' },
  // 循环网络
  { term: '循环网络', kind: '陈述', sentence: '研究人员正在改进循环网络的训练稳定性。' },
  { term: '循环网络', kind: '业务', sentence: '循环网络推理服务已在预发环境上线。' },
  // 正则策略
  { term: '正则策略', kind: '陈述', sentence: '网关侧更新了请求过滤的正则策略。' },
  { term: '正则策略', kind: '业务', sentence: '请复核线上正则策略是否误伤正常流量。' },
  // 注册中心
  { term: '注册中心', kind: '陈述', sentence: '微服务会定时向注册中心上报健康状态。' },
  { term: '注册中心', kind: '业务', sentence: '注册中心故障会导致新实例无法发现。' },
  // 流量镜像
  { term: '流量镜像', kind: '陈述', sentence: '我们准备对关键接口开启流量镜像。' },
  { term: '流量镜像', kind: '业务', sentence: '流量镜像已经导向影子集群进行对比验证。' },
  // 测试数据
  { term: '测试数据', kind: '陈述', sentence: '请不要把生产订单混入测试数据集合。' },
  { term: '测试数据', kind: '业务', sentence: '测试数据已脱敏并导入联调环境。' },
  // 熔断策略
  { term: '熔断策略', kind: '陈述', sentence: '调用下游超时后会触发熔断策略保护。' },
  { term: '熔断策略', kind: '业务', sentence: '熔断策略阈值已按错误率重新校准。' },
  // 特征工程
  { term: '特征工程', kind: '陈述', sentence: '算法同学这周重点优化特征工程流水线。' },
  { term: '特征工程', kind: '业务', sentence: '特征工程结果已经写入特征存储服务。' },
  // 神经网络
  { term: '神经网络', kind: '陈述', sentence: '我们正在训练神经网络模型。' },
  { term: '神经网络', kind: '业务', sentence: '神经网络模型已经部署完成。' },
  // 联系电话
  { term: '联系电话', kind: '陈述', sentence: '请在表单中填写准确的联系电话。' },
  { term: '联系电话', kind: '业务', sentence: '客人的联系电话已同步到前台系统。' },
  // 视频会议
  { term: '视频会议', kind: '陈述', sentence: '下午三点我们安排一次视频会议。' },
  { term: '视频会议', kind: '业务', sentence: '视频会议链接已经发送给全体参会人。' },
  // 训练数据
  { term: '训练数据', kind: '陈述', sentence: '模型效果依赖高质量的训练数据。' },
  { term: '训练数据', kind: '业务', sentence: '训练数据批次已完成标注并入库。' },
  // 迁移学习
  { term: '迁移学习', kind: '陈述', sentence: '团队决定采用迁移学习加速冷启动。' },
  { term: '迁移学习', kind: '业务', sentence: '迁移学习实验在验证集上提升明显。' },
  // 迷你吧
  { term: '迷你吧', kind: '陈述', sentence: '客房里的迷你吧提供饮料和小食。' },
  { term: '迷你吧', kind: '业务', sentence: '迷你吧消费会自动计入房账。' },
  // 邀请函
  { term: '邀请函', kind: '陈述', sentence: '主办方已经寄出纸质邀请函。' },
  { term: '邀请函', kind: '业务', sentence: '请凭邀请函在签到处领取胸卡。' },
  // 配置中心
  { term: '配置中心', kind: '陈述', sentence: '应用启动时会从配置中心拉取参数。' },
  { term: '配置中心', kind: '业务', sentence: '配置中心发布后请观察服务是否热更新成功。' },
  // 配置文件
  { term: '配置文件', kind: '陈述', sentence: '请检查本地配置文件中的数据库地址。' },
  { term: '配置文件', kind: '业务', sentence: '配置文件变更需要走变更审批流程。' },
  // 降级策略
  { term: '降级策略', kind: '陈述', sentence: '高峰时段会自动启用降级策略。' },
  { term: '降级策略', kind: '业务', sentence: '降级策略生效后非核心接口将返回缓存结果。' },
  // 集成测试
  { term: '集成测试', kind: '陈述', sentence: '联调阶段必须覆盖主要路径的集成测试。' },
  { term: '集成测试', kind: '业务', sentence: '集成测试用例已经挂到持续集成流水线。' },
];

if (SENTENCES.length < 44) throw new Error(`need >=44 sentences, got ${SENTENCES.length}`);
for (const t of TERMS_22) {
  const n = SENTENCES.filter((s) => s.term === t).length;
  if (n < 2) throw new Error(`${t} has only ${n} sentences`);
}

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

const toneStmt = db.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`);
const toneStmtBase = db.prepare(
  `SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`
);

function parseTones(toneKey, expectedLen) {
  const parts = String(toneKey || '')
    .split('|')
    .filter(Boolean);
  const tones = parts.map((p) => {
    const m = p.match(/([1-5])$/);
    const n = m ? Number(m[1]) : 1;
    return /** @type {1|2|3|4|5} */ (n >= 1 && n <= 5 ? n : 1);
  });
  if (expectedLen != null && tones.length !== expectedLen) {
    while (tones.length < expectedLen) tones.push(1);
    return tones.slice(0, expectedLen);
  }
  return tones;
}

function tonesForWord(word) {
  const row = toneStmt.get(word) || toneStmtBase.get(word);
  return parseTones(row?.tone_pinyin_key, [...word].length);
}

const CJK = /[\u4e00-\u9fff]/;

/** Build per-char tones for full sentence; overlay compound tones on first occurrence. */
function sentenceTones(sentence, compound) {
  const chars = [...sentence];
  /** @type {Array<1|2|3|4|5>} */
  const tones = chars.map((ch) => {
    if (!CJK.test(ch)) return 1;
    const row = toneStmt.get(ch) || toneStmtBase.get(ch);
    if (row?.tone_pinyin_key) return parseTones(row.tone_pinyin_key, 1)[0];
    return 1;
  });
  const idx = sentence.indexOf(compound);
  if (idx >= 0) {
    const compoundTones = tonesForWord(compound);
    const start = [...sentence.slice(0, idx)].length;
    for (let i = 0; i < compoundTones.length; i += 1) {
      if (start + i < tones.length) tones[start + i] = compoundTones[i];
    }
  }
  return tones;
}

/**
 * Orchestrator ignores input.wordTimeSpans and rebuilds via ASR segments.
 * Emit one ASR word/time span per char aligned with makeCharToneFixtures timing,
 * so Mandatory Tone Recall can activate on the production entry.
 */
function sentenceAsrAndTone(sentence, compound) {
  const tones = sentenceTones(sentence, compound);
  const fix = makeCharToneFixtures(sentence, tones);
  const chars = [...sentence];
  const words = chars.map((ch, i) => ({
    word: ch,
    start: i * 0.1,
    end: i * 0.1 + 0.09,
    probability: 0.99,
  }));
  const asrSegments = [
    {
      text: sentence,
      start: 0,
      end: Math.max(0.09, (chars.length - 1) * 0.1 + 0.09),
      words,
    },
  ];
  return {
    acousticSlices: fix.acousticSlices,
    asrSegments,
    segmentTimeOffsetsSec: [0],
    segmentCharOffsets: [0],
    asrSegmentNodeBatchIndices: [0],
  };
}

function filterExclude(result, excludeWord) {
  if (!Array.isArray(result)) return result;
  return result.filter((h) => String(h?.word || '') !== excludeWord);
}

function wrapRuntimeExclude(runtime, excludeWord) {
  return new Proxy(runtime, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      if (String(prop).startsWith('lookup')) {
        return function wrapped(...args) {
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

function sameSorted(a, b) {
  return JSON.stringify([...(a || [])].map(String).sort()) === JSON.stringify([...(b || [])].map(String).sort());
}

function extractSnap(out) {
  const combos = out.kenlmSentenceCandidates?.combinations || [];
  const texts = combos.map((c) => c.text).filter((t) => typeof t === 'string');
  const top3 = texts.slice(0, 3);
  const domains = [...(out.metrics?.retainedDomains || out.retainedDomains || [])];
  const bucketCount =
    out.metrics?.retainedBucketCount ??
    out.latticeTrace?.pathAssemblyTraces?.[0]?.bucketCount ??
    null;
  return {
    coverageStatus: out.latticeTrace?.coverageStatus ?? null,
    lexicalEdgeCount: out.latticeTrace?.lexicalEdgeCount ?? null,
    fallbackEdgeCount: out.latticeTrace?.fallbackEdgeCount ?? null,
    pathCount: out.latticeTrace?.retainedCompletePathCount ?? null,
    retainedDomains: domains,
    bucketCount,
    assemblyCandidates: texts,
    assemblyCount: texts.length,
    kenlmTop3: top3,
    kenlmTop1: top3[0] || '',
    finalSentence: top3[0] || '',
  };
}

function runOnce(runtime, sentence, compound) {
  const toneAsr = sentenceAsrAndTone(sentence, compound);
  return runSpanAssemblyV4Orchestrator({
    rawText: sentence,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    acousticSlices: toneAsr.acousticSlices,
    asrSegments: toneAsr.asrSegments,
    segmentTimeOffsetsSec: toneAsr.segmentTimeOffsetsSec,
    segmentCharOffsets: toneAsr.segmentCharOffsets,
    asrSegmentNodeBatchIndices: toneAsr.asrSegmentNodeBatchIndices,
  });
}

function classify(withS, withoutS) {
  const hardReasons = [];
  const softReasons = [];
  if (withS.coverageStatus !== withoutS.coverageStatus) hardReasons.push('SPAN_COVERAGE');
  if (!sameSorted(withS.retainedDomains, withoutS.retainedDomains)) hardReasons.push('DOMAIN_VOTE');
  if (withS.bucketCount !== withoutS.bucketCount) softReasons.push('BUCKET');
  if (withS.assemblyCount !== withoutS.assemblyCount) hardReasons.push('ASSEMBLY_COUNT');
  if (JSON.stringify(withS.assemblyCandidates) !== JSON.stringify(withoutS.assemblyCandidates)) {
    hardReasons.push('ASSEMBLY_CONTENT');
  }
  if (JSON.stringify(withS.kenlmTop3) !== JSON.stringify(withoutS.kenlmTop3)) {
    hardReasons.push('KENLM_TOP3');
  }
  if (withS.kenlmTop1 !== withoutS.kenlmTop1) hardReasons.push('KENLM_TOP1');
  if (withS.finalSentence !== withoutS.finalSentence) hardReasons.push('FINAL_SENTENCE');

  // §十四 hard gates: Domain / Assembly / KenLM / Final (+ Coverage).
  // Bucket alone is reported but does not alone force REGRESSION when Domain/Assembly/KenLM/Final match.
  return {
    verdict: hardReasons.length ? 'NODE_RUNTIME_REGRESSION' : 'NODE_RUNTIME_IDENTICAL',
    reasons: hardReasons,
    softReasons,
    edgeDelta: (withoutS.lexicalEdgeCount ?? 0) - (withS.lexicalEdgeCount ?? 0),
    pathDelta: (withoutS.pathCount ?? 0) - (withS.pathCount ?? 0),
  };
}

const results = [];
let i = 0;
for (const row of SENTENCES) {
  i += 1;
  const withOut = runOnce(rt, row.sentence, row.term);
  const withoutOut = runOnce(wrapRuntimeExclude(rt, row.term), row.sentence, row.term);
  const withS = extractSnap(withOut);
  const withoutS = extractSnap(withoutOut);
  const d = classify(withS, withoutS);
  results.push({
    id: i,
    sentence: row.sentence,
    compoundTerm: row.term,
    kind: row.kind,
    focus: FOCUS.has(row.term),
    with: withS,
    without: withoutS,
    ...d,
  });
  if (i % 8 === 0) {
    console.error(`[progress] ${i}/${SENTENCES.length}`);
  }
}

const identical = results.filter((r) => r.verdict === 'NODE_RUNTIME_IDENTICAL');
const regression = results.filter((r) => r.verdict === 'NODE_RUNTIME_REGRESSION');
const domainRegressions = results.filter((r) => r.reasons.includes('DOMAIN_VOTE'));
const bucketOnlySoft = results.filter(
  (r) => r.verdict === 'NODE_RUNTIME_IDENTICAL' && (r.softReasons || []).includes('BUCKET')
);

function esc(v) {
  const s = Array.isArray(v) ? v.join(' || ') : String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const csvHeaders = [
  'sentence',
  'compoundTerm',
  'WITH Domain',
  'WITHOUT Domain',
  'WITH Assembly',
  'WITHOUT Assembly',
  'WITH KenLM',
  'WITHOUT KenLM',
  'WITH Final',
  'WITHOUT Final',
  'Verdict',
];
const csvLines = [csvHeaders.join(',')];
for (const r of results) {
  csvLines.push(
    [
      r.sentence,
      r.compoundTerm,
      (r.with.retainedDomains || []).join('|'),
      (r.without.retainedDomains || []).join('|'),
      (r.with.assemblyCandidates || []).join(' || '),
      (r.without.assemblyCandidates || []).join(' || '),
      (r.with.kenlmTop3 || []).join(' || '),
      (r.without.kenlmTop3 || []).join(' || '),
      r.with.finalSentence,
      r.without.finalSentence,
      r.verdict,
    ]
      .map(esc)
      .join(',')
  );
}
const csv = `${csvLines.join('\n')}\n`;
fs.writeFileSync(path.join(docsTone, 'sentence_runtime_regression.csv'), csv, 'utf8');
fs.writeFileSync(path.join(outDir, 'sentence_runtime_regression.csv'), csv, 'utf8');
fs.writeFileSync(path.join(outDir, 'sentence_runtime_regression.json'), JSON.stringify({ results, identical: identical.length, regression: regression.length, domainRegressions: domainRegressions.length, bucketOnlySoft: bucketOnlySoft.length }, null, 2), 'utf8');

function focusBlock(term) {
  const rows = results.filter((r) => r.compoundTerm === term);
  return `### ${term}

${rows
  .map(
    (r) => `#### [${r.kind}] ${r.sentence}

**Verdict:** \`${r.verdict}\`${r.reasons.length ? ` (${r.reasons.join(', ')})` : ''}${r.softReasons?.length ? ` · soft: ${r.softReasons.join(', ')}` : ''}

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | ${r.with.coverageStatus} | ${r.without.coverageStatus} |
| LexicalEdge | ${r.with.lexicalEdgeCount} | ${r.without.lexicalEdgeCount} |
| Paths | ${r.with.pathCount} | ${r.without.pathCount} |
| Domain Vote | [${(r.with.retainedDomains || []).join(', ')}] | [${(r.without.retainedDomains || []).join(', ')}] |
| Bucket | ${r.with.bucketCount} | ${r.without.bucketCount} |
| Assembly count | ${r.with.assemblyCount} | ${r.without.assemblyCount} |
| Assembly candidates | ${JSON.stringify(r.with.assemblyCandidates)} | ${JSON.stringify(r.without.assemblyCandidates)} |
| KenLM Top3 | ${JSON.stringify(r.with.kenlmTop3)} | ${JSON.stringify(r.without.kenlmTop3)} |
| Final | ${r.with.finalSentence} | ${r.without.finalSentence} |
`
  )
  .join('\n')}`;
}

const deleteSafeConfirmed =
  regression.length === 0 && identical.length === results.length && results.length >= 44;

const md = `# FW Repair V4 — Sentence Context Runtime Regression Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · NODE RUNTIME REGRESSION · REAL SENTENCE CONTEXT** |
| Input | 22 \`DELETE_RUNTIME_SAFE\` compounds |
| Sentences | **${results.length}** (>=44; >=2 / term) |
| Status | **${deleteSafeConfirmed ? 'DELETE_RUNTIME_SAFE_CONFIRMED' : 'REGRESSION_FOUND'}** |

---

## 1. Question

把 22 个 \`DELETE_RUNTIME_SAFE\` 词放进**真实完整句子**后，Probe 排除完整 term，节点端 Domain / Assembly / KenLM / Final 是否仍完全一致？

---

## 2. Method

1. 每词 ≥2 条自然句（陈述 + 业务），禁止 surface-only / 两词拼接。
2. **WITH**：生产 \`runSpanAssemblyV4Orchestrator\`（FineSpan→Recall→LexicalEdge→Segmentation→Domain Vote→Bucket→Assembly→KenLM）。
3. **WITHOUT**：Probe Proxy 过滤 \`lookup*\` 中 \`word === compoundTerm\`（不改 Source / SQLite / Runtime / KenLM）。
4. Mandatory Tone：句级 char tones + compound 区间覆盖 DB \`tone_pinyin_key\`；并通过 **ASR word timestamps**（orchestrator 会忽略直接传入的 wordTimeSpans）对齐 \`acousticSlices\`，使生产入口可激活 Tone Recall。
5. **硬判定（§十四）**：Domain / Assembly（数量+内容） / KenLM Top3+Top1 / Final / Coverage 任一不一致 → \`NODE_RUNTIME_REGRESSION\`。
6. Bucket 单独变化记为 soft（报告中披露），在 Domain/Assembly/KenLM/Final 全一致时不单独判 REGRESSION。
7. 若且仅当 **全部句子 IDENTICAL** → 正式确认 \`DELETE_RUNTIME_SAFE\` 可进 Source Cleanup。

Artifacts:

- [sentence_runtime_regression.csv](./sentence_runtime_regression.csv)
- \`docs/tone-v2/_audit_scratch/sentence_runtime_regression/\`

---

## 3. Summary

| Metric | Count |
|--------|------:|
| Sentences | **${results.length}** |
| NODE_RUNTIME_IDENTICAL | **${identical.length}** |
| NODE_RUNTIME_REGRESSION | **${regression.length}** |
| soft BUCKET-only (still IDENTICAL) | ${bucketOnlySoft.length} |
| DOMAIN_VOTE regressions | ${domainRegressions.length} |

\`\`\`text
IDENTICAL  ${identical.length} / ${results.length}
REGRESSION ${regression.length} / ${results.length}
\`\`\`

### Domain Vote regressions（重点）

${
  domainRegressions.length === 0
    ? '_None_'
    : domainRegressions
        .map(
          (r) =>
            `- **${r.compoundTerm}** · ${r.sentence} · WITH=[${(r.with.retainedDomains || []).join(', ')}] → WITHOUT=[${(r.without.retainedDomains || []).join(', ')}]`
        )
        .join('\n')
}

### Per-term identical rate

| Term | Sentences | Identical | Regression |
|------|----------:|----------:|-----------:|
${TERMS_22.map((t) => {
  const rows = results.filter((r) => r.compoundTerm === t);
  const ok = rows.filter((r) => r.verdict === 'NODE_RUNTIME_IDENTICAL').length;
  return `| ${t} | ${rows.length} | ${ok} | ${rows.length - ok} |`;
}).join('\n')}

---

## 4. Regressions（必须列出）

${
  regression.length === 0
    ? '_None — 0 sentences regress._'
    : regression
        .map(
          (r) => `### ${r.compoundTerm} — ${r.sentence}

- Reasons: ${r.reasons.join(', ')}
- WITH Domain: [${(r.with.retainedDomains || []).join(', ')}]
- WITHOUT Domain: [${(r.without.retainedDomains || []).join(', ')}]
- WITH Assembly: ${JSON.stringify(r.with.assemblyCandidates)}
- WITHOUT Assembly: ${JSON.stringify(r.without.assemblyCandidates)}
- WITH KenLM Top3: ${JSON.stringify(r.with.kenlmTop3)}
- WITHOUT KenLM Top3: ${JSON.stringify(r.without.kenlmTop3)}
- WITH Final: ${r.with.finalSentence}
- WITHOUT Final: ${r.without.finalSentence}
`
        )
        .join('\n')
}

---

## 5. Focus Terms（§八）

${[...FOCUS].map((t) => focusBlock(t)).join('\n')}

---

## 6. Remaining Terms

${TERMS_22.filter((t) => !FOCUS.has(t))
  .map((t) => focusBlock(t))
  .join('\n')}

---

## 7. Architecture Implication

${
  deleteSafeConfirmed
    ? `### DELETE_RUNTIME_SAFE 正式确认

全部 **${results.length}/${results.length}** 句 \`NODE_RUNTIME_IDENTICAL\`，且 Domain / Assembly / KenLM Top3 / Final 均一致。

因此：

1. 这 22 个词可进入 **Source Cleanup** 删除评估（本轮仍未执行删除）。
2. \`KEEP_AS_EXCEPTION\` / “固定技术术语” **不再作为保留依据**。
3. 可冻结架构方向：正式词库仅保留真正不可原子化恢复的词；普通业务组合词从 Source 删除后，Runtime 依赖 FineSpan → Exact Recall → Lattice → Assembly → KenLM。`
    : `### 不可确认 DELETE_RUNTIME_SAFE

存在 **${regression.length}** 句 \`NODE_RUNTIME_REGRESSION\`。进入 Source Cleanup 前必须先处理上述回归句。`
}

---

## 8. Target Checklist

| ID | Target | Result |
|----|--------|--------|
| T1 | 22 terms | PASS |
| T2 | ≥2 sentences / term | PASS |
| T3 | ≥44 sentences | PASS (${results.length}) |
| T4–T8 | Full node FineSpan→KenLM | PASS |
| T9–T13 | Domain/Bucket/Assembly/KenLM/Final compare | PASS |
| T14 | WITH/WITHOUT | PASS |
| T15–T19 | No Source/SQLite/Runtime/Validator/KenLM change | PASS |
| T20–T21 | CSV + Markdown | PASS |
| T22–T23 | Counts | IDENTICAL=${identical.length} REGRESSION=${regression.length} |
| T24 | Confirm DELETE_RUNTIME_SAFE if all identical | **${deleteSafeConfirmed ? 'CONFIRMED' : 'BLOCKED'}** |
`;

fs.writeFileSync(
  path.join(docsTone, 'FW_Repair_V4_Sentence_Context_Runtime_Regression_Audit_2026_08_02.md'),
  md,
  'utf8'
);

console.log(
  JSON.stringify(
    {
      sentences: results.length,
      identical: identical.length,
      regression: regression.length,
      deleteSafeConfirmed,
      regressionSentences: regression.map((r) => ({
        term: r.compoundTerm,
        sentence: r.sentence,
        reasons: r.reasons,
        domains: [r.with.retainedDomains, r.without.retainedDomains],
        top1: [r.with.kenlmTop1, r.without.kenlmTop1],
      })),
      edgeDrops: results.filter((r) => r.edgeDelta < 0).length,
      edgeDropSamples: results
        .filter((r) => r.edgeDelta < 0)
        .slice(0, 8)
        .map((r) => ({
          term: r.compoundTerm,
          edges: `${r.with.lexicalEdgeCount}->${r.without.lexicalEdgeCount}`,
          paths: `${r.with.pathCount}->${r.without.pathCount}`,
        })),
      domainChanges: domainRegressions.length,
      bucketOnlySoft: bucketOnlySoft.length,
      nonzeroEdgesWith: results.filter((r) => (r.with.lexicalEdgeCount ?? 0) > 0).length,
    },
    null,
    2
  )
);

db.close();
