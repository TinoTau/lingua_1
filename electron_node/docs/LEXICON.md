# Lexicon：词库运行时与窗召回

## 运行时

- 入口：`lexicon/lexicon-runtime-holder.ts`、`lexicon-runtime.ts`
- 数据：SQLite bundle（`LEXICON_BUNDLE_PATH`），confusion observed + hotword + pinyin 索引
- 状态：`ctx.lexiconRuntimeStatus`（`ok` / `disabled` / `error`）

## Segment-first 窗召回

`lexicon/window-recall.ts` → `recallSegmentWindowCandidates(segmentText, hypotheses, runtime)`：

1. **滑动窗**：`enumerate-asr-windows.ts`（标点 chunk 内 2–8 字）
2. **精确 observed 子串**：`findConfusionObservedSpans`
3. **Fuzzy observed**（edit≤1）+ **拼音对齐**：`findFuzzyConfusionObservedSpans`、`findChunkPinyinAlignedObservedSpans`
4. **n-best 映射窗**（rank≠0 且等长）：`buildSegmentWindows` / `augmentFromNbestSlices`
5. 每窗：`hotword-recall.ts`（observed / fuzzy_observed / pinyin / fuzzy pinyin）

坐标恒为 **rank0 段内** `SEGMENT_HYPOTHESIS_INDEX = 0`。

## 热词召回路径

| recallPath | 说明 |
|------------|------|
| `confusion_evidence` | bundle observed 表 |
| `exact` | hotword 与窗文本一致 |
| `fuzzy_observed` | 窗文本 fuzzy 命中 observed |
| `pinyin` | 拼音索引或 fuzzy pinyin |

门限：`recallMinPhoneticScore`（默认 0.5）。

## 无窗分类

`no-window-bucket.ts` → `noWindowBucket`：

- `no_observed_substring`
- `pinyin_no_hit`
- `normalization_mismatch`
- `segment_alignment_risk`（segment ≠ rank0）
- `bundle_missing_observed`
- `window_budget_exceeded`

## 诊断（result.extra）

**对齐（Q1.8）**

- `segment_alignment_diagnostics`：`alignmentStatus`、`mismatchType`（仅 mismatched）
- `nbest_augment_diagnostics`、`window_recall_diagnostics.nbestAugmentDropEvents`
- `cross_boundary_risk`（只报告）

**覆盖（Q1.7）**

- `recall_coverage_diagnostics`：`closestObserved`、`whyRejected`、`bundleMissingObservedCandidates`
- `window_recall_diagnostics`：fuzzy/pinyin attempt/hit 计数

## 句扩展（与 Recover 衔接）

有 `WindowCandidate` 后由 `sentence-expansion` 生成 `SentenceCandidate`：

- 使用 `expansionMinPhoneticScore`（非 selectionMin）
- `expansion_funnel`、`expansion_selector_reject` 写入 extra

Selector：`lexicon/selector/windowSelector.ts`、`buildLexiconBoundCandidates.ts`。

## 批测

```powershell
cd electron_node\electron-node
npm run build:main
# 启动节点 PROJECT_ROOT + CHAR_LM_PATH
node tests/run-dialog-200-batch.js
```

关注 summary：`window_candidates_nonempty_count`、`with_window_sentence_candidate_rate`。

## 相关

- Recover 主链：[RECOVER.md](./RECOVER.md)
- 配置：[../electron-node/docs/CONFIGURATION.md](../electron-node/docs/CONFIGURATION.md)
