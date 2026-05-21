# Recover：ASR 后修复主链

契约版本：`historical-restore-v1`（`pipeline/recover-contract.ts`）。

## 数据流（segment-first）

```
ASR + n-best
  → AGGREGATION（segment 文本，保留 CTC n-best）
  → LEXICON_RECALL（segment 坐标窗 → WindowCandidate[]）
  → SENTENCE_REPAIR（扩展 → KenLM 重排 → applySentenceRepair 单次写回）
  → PHONETIC_CORRECTION / 后续步骤（不得覆盖 recover 已写回段）
```

主链原则：

- **segment-first**：窗坐标、写回均相对聚合段 `segmentForJobResult`
- **禁止** raw CTC 直接 final pick、`modifiedWithoutReplacement`
- **禁止** 在 recover 之后再改段文本（phonetic 步有 recover lock 测试保障）

## Pipeline 步骤

注册表：`pipeline/pipeline-step-registry.ts`。

| 步骤 | 模块 | 作用 |
|------|------|------|
| `LEXICON_RECALL` | `steps/lexicon-recall-step.ts` | 加载 bundle，`recallSegmentWindowCandidates` |
| `SENTENCE_REPAIR` | `steps/sentence-repair-step.ts` | `expandSentenceCandidates` → `rerank` → `applySentenceRepair` |

模式见 `pipeline/pipeline-mode-config.ts`（如 `PERSONAL_VOICE_TRANSLATION` 含上述两步）。

## 质量门限（quality-config）

`recover-quality/quality-config.ts`，快照写入 `result.extra.qualityConfig`：

| 字段 | 默认 | 用途 |
|------|------|------|
| `recallMinPhoneticScore` | 0.5 | 窗 recall |
| `expansionMinPhoneticScore` | 0.5 | Window → Sentence 扩展（**不得**用 selectionMin） |
| `selectionMinPhoneticScore` | 0.85 | 最终句修复选取 |
| `maxReplacements` | 4 | 多窗替换上限 |
| `maxSentenceCandidates` | 16 | 句候选池 |
| `multiWindowScoreEpsilon` | 0.005 | multi 窗 near-tie 护栏 |
| `recallFuzzyPinyinMaxSyllableDelta` | 2 | fuzzy pinyin 音节长度差 |

配置项：`electron-node-config.json` → `features.lexiconRecall`。

## 契约与可观测性

`result.extra` 主要字段（`result-builder.ts`）：

- `recover_contract_version`、`recover_lifecycle`
- `window_candidates`、`sentence_candidates`
- `window_recall_diagnostics`、`segment_alignment_diagnostics`
- `nbest_augment_diagnostics`、`recall_coverage_diagnostics`（无窗时）
- `expansion_funnel`、`sentence_repair`
- `restore_metrics`（`picked_from_raw_ctc_nbest_count` 等须为 0）

跳过原因示例：`no_window_expansion_candidate`、`feature_or_job_disabled`。

## 句修复来源

- `window_single` / `window_pair` / `window_multi` — 来自词库扩展
- 不得出现 `raw_ctc_baseline` 作为 picked source

实现要点：

- `lexicon/selector/buildLexiconBoundCandidates.ts` — 显式 span 优先
- `asr-repair/sentence-expansion/` — 扩展与 dedup
- `asr-repair/sentence-rerank/` — KenLM、`combinedScore`、写回

## 开关

- `features.lexiconRecall.enabled`、语言、`getLexiconRecallSkipReason`
- 环境：`LEXICON_BUNDLE_PATH`、`PROJECT_ROOT`

## 相关

- 词库与窗召回：[LEXICON.md](./LEXICON.md)
- 节点架构：[../electron-node/docs/ARCHITECTURE.md](../electron-node/docs/ARCHITECTURE.md)
