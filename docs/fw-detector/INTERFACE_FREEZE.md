# FW Repair V4 — Interface Freeze Contract

**状态：** Framework Frozen · 2026-06-19  
**原则：** 核心 pick/apply 语义不可变；Diagnostics **仅允许追加 optional 字段**

---

## 1. ToneResult

**实现类型：** `TimestampToneState` · `CoarseAssemblyToneDiagnostics` · `FwToneModuleDiagnostics`  
**代码：** `span-assembly-shared/tone-recall.ts` · `span-assembly-shared/types.ts`

| 字段 | 类型 | 语义 |
|------|------|------|
| `tonePayloadAvailable` | boolean | 声学 slice 是否存在 |
| `toneEnabled` | boolean | `toneTimestampOnlyEnabled` 且 payload 可用 |
| `toneSkippedReason` | string? | `tone_timestamp_disabled` · `no_acoustic_slices` |
| `recallToneCompatibleCount` | number | tone 兼容命中次数 |
| `recallToneFallbackCount` | number | tone penalty 应用次数 |
| `toneExactHitCount` | number | SQL tone_exact 阶段命中 |
| `plainFallbackHitCount` | number | plain_fallback 命中 |

| 允许 | 禁止 |
|------|------|
| 追加 optional 观测字段 | 改 tone 为 hard drop；改 tier SQL 语义 |
| 扩展 `exampleToneWindows` trace | 删除 `toneEnabled` 语义 |

---

## 2. SpanCandidate

**实现类型：** `CoarseSpan` · `FineSpanCandidatePool` · `ParentSpanCandidate` · `SpanReplacementPick`  
**代码：** `span-assembly-shared/types.ts` · `build-sentence-candidates.ts`

| 字段（SpanReplacementPick） | 类型 | 语义 |
|----------------------------|------|------|
| `span` | FwTextSpan | start/end/text |
| `word` | string | 替换目标词 |
| `source` | WindowCandidateSource | 候选来源 |
| `priorScore` | number | 词库 prior |
| `repairTarget` | boolean | apply 资格 |
| `candidateScore` | number | recall 排序分 |

| 允许 | 禁止 |
|------|------|
| diagnostics trace 中追加 span 元数据 | 改 `repairTarget` 对 apply 的语义 |
| Shadow beam 候选扩展 | Main path 改 compatibility 入池规则 |

---

## 3. RecallCandidate

**实现类型：** `HotwordEntry` · `RecallSpanTopKV3Hit` · `FwSpanCandidateDiag`  
**代码：** `lexicon-v2/recall-span-topkv3.ts` · `types.ts`

| 字段（FwSpanCandidateDiag） | 类型 | 语义 |
|----------------------------|------|------|
| `word` | string | surface |
| `priorScore` | number | prior |
| `candidateScore` | number | 含 tone penalty 的最终 recall 分 |
| `source` | WindowCandidateSource | e.g. lexicon_pinyin_topk |
| `domains` | string[] | domain 标签 |
| `domainMatched` | boolean | session domain 匹配 |
| `repairTarget` | boolean? | 来自 sqlite |
| `vetoed` | boolean | KenLM span gate（若启用） |

| 允许 | 禁止 |
|------|------|
| 追加 breakdown 字段 | 改 TopK SQL tier 顺序 |
| 新 `WindowCandidateSource` 枚举值（仅 diagnostics） | 恢复 V1 recall API |

---

## 4. SentenceCombination

**代码：** `build-sentence-candidates.ts`

```typescript
type SentenceCombination = {
  text: string;
  replacements: SpanReplacementPick[];
  candidateScore: number;
};
```

| 字段 | 语义 |
|------|------|
| `text` | 应用 replacements 后的整句 |
| `replacements` | 有序 span 替换列表 |
| `candidateScore` | 组合 recall 分之和 |

| 允许 | 禁止 |
|------|------|
| diagnostics 镜像组合 | 改笛卡尔积 cap 语义（`maxSentenceCandidates` 属 config） |
| | 删除 `replacements` 结构 |

---

## 5. KenLMScore

**代码：** `asr-repair/kenlm-batch-types.ts`

```typescript
type KenLMScore = {
  sentence: string;
  score: number;           // raw total log score — pick 用
  normalizedScore: number; // diagnostics only
};
```

| 允许 | 禁止 |
|------|------|
| 追加 diagnostics 元数据 | 改 `score` 为 normalized 参与 pick |
| | 删除 `score` 字段 |

---

## 6. SentenceRerankPick

**代码：** `rerank-fw-sentences.ts`

```typescript
type SentenceRerankPick = {
  pickedIsRaw: boolean;
  picked: SentenceCombination | null;
  maxDelta: number;              // max raw delta
  kenlmQueryCount: number;
  scoreMode?: 'raw_log_delta';
  baselineRawScore?: number;
  pickedRawScore?: number;
  maxNormalizedDelta?: number;   // observation only
  topCandidates: Array<{ text; kenlmDelta; replacementCount }>;
  allCombinationDeltas?: number[];
  kenlmTiming?: KenlmTimingStats;
  kenlmRuntime?: KenlmSubprocessRuntimeDiag;
};
```

| 禁止修改 |
|----------|
| `pickedIsRaw` 判定逻辑（rawDelta vs minDeltaToReplace） |
| `maxDelta` 必须为 raw delta |
| `topCandidates[].kenlmDelta` 必须为 raw delta |
| `FW_RERANK_SCORE_MODE` 常量 |

| 允许新增 |
|----------|
| optional diagnostics 字段（不影响 pick） |

---

## 7. FwSentenceRerankDiagnostics

**代码：** `types.ts` — Job 级 `extra.fw_detector.sentenceRerank`

| 字段 | 语义 |
|------|------|
| `spanCount` · `combinationCount` | 输入规模 |
| `perSpanLimit` | per-span 候选上限 |
| `pickedIsRaw` | 同 SentenceRerankPick |
| `maxDelta` · `minDeltaToReplace` | Gate 观测 |
| `scoreMode` | `raw_log_delta` |
| `baselineRawScore` · `pickedRawScore` | raw score 分解 |
| `maxNormalizedDelta` | 对照观测 |
| `topCandidates` | Top-N 句级候选 |
| `allCombinationDeltas` · `allCombinations` | 组合级 trace |
| `kenlmSubprocessMs` · `kenlmSubprocessCount` · `kenlmSubprocessErrorReason` | batch runtime |

| 允许 | 禁止 |
|------|------|
| 追加 optional trace 块 | 删除或改义上述 Gate 字段 |
| `allCombinations` 扩展 CombinationTrace | 用 normalized delta 填充 `maxDelta` |

---

## 8. 变更流程

1. 框架接口语义变更 → 新合约版本 + `freeze-contract.test.ts` + 文档 bump  
2. 仅 diagnostics 追加 → V1.0.2 patch 级别，optional 字段，向后兼容  
3. 词库字段变更 → [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md)，**不** bump 框架版本

---

## 9. 静态守卫

`freeze-contract.test.ts` GATE-2 · `rerank-fw-sentences.test.ts` · `kenlm-scorer.test.ts`
