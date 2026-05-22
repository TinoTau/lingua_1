# Recover V5 Post-Implementation Alignment 开发报告

| 项 | 值 |
|----|-----|
| 日期 | 2026-05-22 |
| 范围 | P1 对齐 + P2 可观测性/契约（**未改 V5 主链**） |
| 批测 | `dialog_200` **200/200 PASS** |

---

## 1. 文件修改列表

| 模块 | 文件 |
|------|------|
| P1 配置 | `node-config-defaults.ts`, `recover-quality/quality-config.ts`, `node-config-types.ts` |
| P1 candidateScore | `lexicon/candidate-score.ts`, `lexicon/pinyin-topk-lookup.ts`, `lexicon/hotword-types.ts`, `lexicon/hotword-recall.ts` |
| P1 窗/组合语义 | `asr-repair/sentence-expansion/sentence-expansion.ts`, `asr-repair/sentence-expansion/types.ts`, `asr-repair/sentence-expansion/expansion-diagnostics.ts` |
| P1 near 关闭 | `lexicon/pinyin-topk-lookup.ts`, `window-recall-diagnostics.ts` |
| P1 门控 | `asr-repair/recover-safety-gates.ts` |
| P2 trace/metrics | `lexicon/window-recall.ts`, `pipeline/v5-metrics.ts`, `pipeline/steps/sentence-repair-step.ts`, `pipeline/result-builder.ts`, `pipeline/context/job-context.ts` |
| P2 manifest | `lexicon/lexicon-runtime.ts`, `lexicon/lexicon-types.ts`, `pipeline/steps/lexicon-recall-step.ts`, `scripts/build-lexicon-bundle.mjs` |
| 批测契约 | `tests/lib/recover-contract-assess.js`, `tests/run-dialog-200-batch.js` |
| 单测 | `candidate-score.test.ts`, `pinyin-topk-lookup.test.ts`, `quality-config.test.ts`, `recover-safety-gates.test.ts`, `sentence-expansion.test.ts` |

---

## 2. 配置修改列表

| 配置项 | 变更前 | 变更后 |
|--------|--------|--------|
| `maxSentenceCandidates` | 16 | **32**（默认 + `Math.max` 下限） |
| `nearPinyinEnabled` | 无字段（near 桶默认开） | **false**（默认，关闭 near 桶） |
| `crossSegmentRecallEnabled` | 无字段 | **false**（显式） |
| `maxActiveWindows` | 2 | 2（**仅**句级 windowSelector 组合） |
| `maxReplacements` | 2（默认）/ 用户可 4 | 2 默认；**仅** `evaluateReplacementCountExceeded` 写回门控 |

`result.extra.qualityConfig` 改为 `buildRecoverQualityConfigSnapshot()` 快照（非完整内部 config）。

---

## 3. runtime snapshot 示例（批测 `summary.qualityConfig`）

```json
{
  "allowedWindowLengths": [2, 3, 4, 5],
  "topKByTermLength": { "2": 5, "3": 5, "4": 3, "5": 2 },
  "maxActiveWindows": 2,
  "maxSentenceCandidates": 32,
  "maxReplacements": 4,
  "nearPinyinEnabled": false,
  "crossSegmentRecallEnabled": false,
  "kenlmBaselineTolerance": 0.15,
  "observedRecallEnabled": false
}
```

`v5_metrics.sentence_candidate_budget`: **32**

---

## 4. manifest 示例（重建后）

```json
{
  "version": "recover-v5-scored-lexicon",
  "scored_lexicon_version": "v5",
  "pinyin_index_count": 67,
  "same_pinyin_key_count": 67,
  "indexed_term_count": 67,
  "terms_without_prior_count": 0
}
```

Runtime load：`assertV5ManifestReady(manifest)` fail-fast；`extra.lexicon_manifest_ready.manifestReady: true`。

---

## 5. candidateScore breakdown 示例

```json
{
  "candidateScoreBreakdown": {
    "priorScore": 8.0,
    "phoneticSimilarity": 0.95,
    "exactLengthBonus": 0.5,
    "domainBoost": 0.2,
    "editDistancePenalty": 0.25
  }
}
```

批测聚合：`edit_distance_penalty_sum=14.75`，`samples=33`，单项 penalty ≤ 1。

---

## 6. skipReason distribution（对齐后）

| 来源 | 分布 |
|------|------|
| `skip_reason_distribution`（lifecycle） | `no_window_expansion_candidate`: 178, `none`: 22 |
| `v5_metrics.skip_reason_v5` | `no_window_expansion_candidate`: 178 |

`no_topk_candidate` 在「有窗无 TopK」场景仍由 lexicon 步设置；本批测主要为 expansion 空池 skip。

---

## 7. dialog_200 对比

| 指标 | 对齐前 (2026-05-22 AM) | 对齐后 |
|------|------------------------|--------|
| PASS | 200/200 | **200/200** |
| `sliding_window_count_total` | 0 | **0** |
| `windows_from_nbest_diff_ratio` | 1.0 | **1.0** |
| `out_of_bundle_total` | 0 | **0** |
| `picked_from_raw_ctc_nbest_count` | 0 | **0** |
| `recall_fuzzy_observed_attempt_total` | 0 | **0** |
| `near_pinyin_attempt_count` | N/A | **0** |
| `sentence_candidate_budget` | 16 | **32** |
| `phonetic_expanded_sentence_candidates` | 53 | 33 |
| `skip_reason_v5` | `no_topk_candidate`: 147 | `no_window_expansion_candidate`: 178 |

句级修复成功数仍为 22；TopK 命中总数 33（与 expansion 候选一致）。skip 分类更准确（expansion 空池纳入 V5 契约）。

---

## 8. P0 / P1 / P2 剩余问题

| 级别 | 项 |
|------|-----|
| **P0** | 无 |
| **P1** | 用户 `electron-node-config.json` 仍可写 `maxReplacements:4`（写回门控上限）；代码已用 `Math.max` 保证 `maxSentenceCandidates≥32` |
| **P2** | `fineLengths/coarseLengths` 仍在 `window-recall.ts` 硬编码 `[2,3]`/`[4,5]`（与 allowed 一致）；diff span **相邻合并** 未做；`lexicon_recall_trace` 未回填 `kenlmScore`（句级 trace 在 `sentence_candidate_trace`） |

---

## 9. 是否完全符合 V5 冻结设计

**主链与批测硬指标：符合。**  
**配置/公式/观测细项：已基本对齐**；剩余 P2 为增强项，不影响「TopK diff 主链 + 批测契约」。

---

*批测结果文件：`electron-node/tests/dialog-200-batch-result.json`*
