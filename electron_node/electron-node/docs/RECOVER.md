# Recover：ASR 后修复主链（V5）

> **默认主链：** `asr.engine = fw_detector_v1` 时使用 [FW_DETECTOR.md](./FW_DETECTOR.md)，**不**走本文 Recover 步骤（`LEXICON_RECALL` / `SENTENCE_REPAIR` 已从 FW pipeline 移除）。  
> 本文适用于 CTC + Recover V5 路径或显式启用 `features.lexiconRecall.enabled` 的场景。

契约：`v5-scored-lexicon-topk`（`pipeline/recover-contract.ts`）。历史 `historical-restore-v1` 仅配置显式指定时生效。

## 1. 数据流

```
ASR + n-best
  → AGGREGATION（segment 文本，保留 CTC n-best）
  → LEXICON_RECALL（diff 窗 → WindowCandidate[]）
  → SENTENCE_REPAIR（扩展 → KenLM → applySentenceRepair 单次写回）
  → PHONETIC_CORRECTION（recover lock，不得覆盖已写回段）
```

原则：

- **segment-first**：窗与写回相对聚合段 `segmentForJobResult`
- **禁止** raw CTC 直接 final pick、`modifiedWithoutReplacement`
- **单路径**：无 V4 observed 主链并行

## 2. Pipeline 步骤

`pipeline/pipeline-step-registry.ts`：

| 步骤 | 模块 |
|------|------|
| `LEXICON_RECALL` | `steps/lexicon-recall-step.ts` |
| `SENTENCE_REPAIR` | `steps/sentence-repair-step.ts` |

模式：`pipeline/pipeline-mode-config.ts`（如 `PERSONAL_VOICE_TRANSLATION`）。

## 3. V5 冻结决策（摘要）

| ID | 决策 |
|----|------|
| D-01 | V5 **替换** V4 observed 主链 |
| D-02 | Near pinyin **限额**（非全表） |
| D-03 | Active windows **≤ 2** |
| D-04 | Runtime **禁止**学习/改库 |
| D-05 | 英文 token **仅 exact**（bundle 显式索引） |
| D-06 | `kenlmBaselineTolerance = 0.15` |
| D-07 | 窗 **不跨 chunk**；diff 内双尺度 2–3 / 4–5 |
| D-08 | 窗 TopK → 有限 SentenceCandidate → **仅 KenLM** 句级选优 |

## 4. 质量门限

`recover-quality/quality-config.ts` → `result.extra.qualityConfig`：

| 字段 | 默认 | 用途 |
|------|------|------|
| `recallMinPhoneticScore` | 0.5 | 窗 recall |
| `expansionMinPhoneticScore` | 0.5 | 窗→句扩展 |
| `selectionMinPhoneticScore` | 0.85 | 最终句选取 |
| `maxReplacements` | 2 | 多窗替换上限 |
| `maxSentenceCandidates` | 32 | 句候选池 |
| `maxActiveWindows` | 2 | 活跃窗数 |
| `kenlmBaselineTolerance` | 0.15 | KenLM 容差 |

配置：`features.lexiconRecall`（`electron-node-config.json`）。

## 5. 契约与 extra 字段

- `recover_contract_version`、`recover_lifecycle`
- `window_candidates`、`sentence_candidates`
- `window_recall_diagnostics`、`segment_alignment_diagnostics`
- `recall_coverage_diagnostics`（无窗）
- `expansion_funnel`、`sentence_repair`、`restore_metrics`、`v5_summary`

跳过示例：`no_window_expansion_candidate`、`feature_or_job_disabled`。

句修复来源：`window_single` / `window_pair` / `window_multi`（词库扩展）。不得 `raw_ctc_baseline` 作为 picked source。

## 6. 实现索引

| 能力 | 路径 |
|------|------|
| diff 窗 | `lexicon/nbest-diff-span.ts`、`diff-context-windows.ts` |
| TopK 召回 | `lexicon/pinyin-topk-lookup.ts`、`hotword-recall.ts` |
| 候选分 | `lexicon/candidate-score.ts` |
| 扩展 | `asr-repair/sentence-expansion/` |
| 重排 | `asr-repair/sentence-rerank/` |
| 安全门控 | `recover-safety-gates.ts` |
| 契约单测 | `npm run test:contract`（`recover-contract.test.ts`） |

## 7. 开关与环境

- `features.lexiconRecall.enabled`
- `features.lexiconRecall.contractVersion`：`v5-scored-lexicon-topk` | `historical-restore-v1`
- `PROJECT_ROOT`、`LEXICON_BUNDLE_PATH`

## 相关

- [FW_DETECTOR.md](./FW_DETECTOR.md) — FW span recall（`local-span-recall.ts`）
- [LEXICON.md](./LEXICON.md)
- [AGGREGATOR.md](./AGGREGATOR.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
