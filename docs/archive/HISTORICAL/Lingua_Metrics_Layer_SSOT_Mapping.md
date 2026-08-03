<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lingua_Metrics_Layer_SSOT_Mapping.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lingua Metrics Layer — Runtime Field Mapping（SSOT）

**Status:** Frozen Consumer Mapping · 2026-07-14  
**Binding:** [Runtime Evolution Rule](./Lingua_Runtime_Evolution_Rule.md) · [Constraint Addendum](./Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md) · [Supplement](./Lingua_Metrics_Layer_SSOT_Alignment_Supplement_2026_07_14.md)  
**Script:** `electron_node/electron-node/tests/experiments/analyze-metrics-ssot.mjs`

**登记义务：** 任何拟被 Metrics 消费的 Runtime 新字段 **必须先在本 Catalog 增行**，否则 Metrics **必须忽略**（见 Runtime Evolution Rule RE-2）。

```text
Runtime Diagnostics → Metrics Mapping → Consumer Report
```

---

## Field Catalog

| Metrics Field | Runtime Source | Mapping Rule | Diagnostic Level | Consumer |
|---------------|----------------|--------------|------------------|----------|
| `span_count` | `summary.spanCount` | count only（≠ Success） | summary | report |
| `appliedCount` | `summary.appliedCount` | passthrough | summary | report |
| `triggered` | `fw.triggered` | passthrough | summary | report |
| `combinationCount` | `sentenceRerank.combinationCount` | Generated count | summary | report |
| `dump_candidate_count` | `topCandidates.length` | Dump subset | summary | report |
| `topCandidates` | `sentenceRerank.topCandidates` | Dump texts | summary | report |
| `allCombinationDeltas` | `sentenceRerank.allCombinationDeltas` | Generated scores | summary | report |
| `allCombinations` | `sentenceRerank.allCombinations` | Generated texts | **trace** | report |
| `pickedIsRaw` | `sentenceRerank.pickedIsRaw` | **禁止**改名为 KenLM Success | summary | report |
| `maxDelta` | `sentenceRerank.maxDelta` | passthrough | summary | report |
| `minDeltaToReplace` | `sentenceRerank.minDeltaToReplace` | passthrough | summary | report |
| `picked_text` | `sentenceRerank.picked.text` | passthrough | summary | report |
| `recallHits*` | `spanAssemblyV4.trace.recallHits` | Trace Required | **trace** | report |

## Overlay Metrics（非 Runtime）

| Overlay | Rule | Tag |
|---------|------|-----|
| `exactMatch` | fixture expected vs final/raw text | `Overlay Metric` |
| `fixtureTerms` / `domainKeywords` | fixture heuristic list | `Overlay Metric` |

## TopK（三套禁止混用）

| Name | Truth |
|------|-------|
| Recall TopK | `exactTopK=2` · `parentFragmentTopK=3` |
| Sentence TopK | `maxSentenceCandidates=16` · `combinationCount` |
| Dump TopK | `topCandidates` ≤5 |

## Counterfactual

Missing Trace / Generated texts → **`Unavailable`** · never **`Failure`**.
