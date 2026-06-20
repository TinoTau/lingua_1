# FW Repair V4 — Diagnostics Contract

**状态：** Diagnostics / Trace Completeness **V1.0.2** + Raw Log Delta fields **V1.0.0** · Framework Frozen · 2026-06-19  
**代码：** `main/src/fw-detector/types.ts` · `rerank-fw-sentences.ts` · `v4-diagnostics-*`

---

## 1. Sentence Rerank 字段 SSOT

| 字段 | 类型 | 语义 | pick 相关 |
|------|------|------|-----------|
| `scoreMode` | `'raw_log_delta'` | Score Contract 标识 | ✅ |
| `baselineRawScore` | number | raw 句 KenLM total log score | ✅ |
| `pickedRawScore` | number? | pick 成功时候选 raw score | ✅ |
| `maxDelta` | number | max(rawDelta) | ✅ Gate 观测 |
| `maxNormalizedDelta` | number? | max norm delta | ❌ 仅对照 |
| `minDeltaToReplace` | number | Gate 阈值（3.0） | ✅ |
| `pickedIsRaw` | boolean | true = 未 pick | ✅ |
| `topCandidates` | array | 句级候选 + raw delta | 观测 |
| `allCombinationDeltas` | number[]? | 每组合 raw delta | trace |

**Pick 规则（冻结）：** `pick iff bestRawDelta >= minDeltaToReplace`

---

## 2. 是否足够定位问题

| 问题类型 | 所需字段 | 覆盖 |
|----------|----------|------|
| Gate 未 pick | `pickedIsRaw` · `maxDelta` · `minDeltaToReplace` | ✅ |
| Raw vs normalized 混淆 | `scoreMode` · `maxNormalizedDelta` | ✅ |
| KenLM batch 失败 | `kenlmSubprocessErrorReason` · fail-open score=0 | ✅ |
| 候选池空 | `spanCount` · `combinationCount` · assembly 计数 | ✅ |
| Recall / Tone | `recallToneFallbackCount` · V2 job diagnostics · trace | ✅ |
| Apply 未发生 | `appliedCount` · `repairTarget` on candidate | ✅ |

**未来补词库：** 不需要新增 Framework diagnostics 版本；复用上述字段 + lexicon runtime status。

---

## 3. Sample — summary（Job extra 片段）

```json
{
  "pipelinePath": "v4",
  "summary": {
    "spanCount": 4,
    "candidateCount": 12,
    "appliedCount": 0,
    "kenlmQueryCount": 17,
    "pickedTopKWinCount": 1
  },
  "sentenceRerank": {
    "spanCount": 4,
    "perSpanLimit": 4,
    "combinationCount": 8,
    "kenlmQueryCount": 17,
    "pickedIsRaw": false,
    "maxDelta": 10.99011999999999,
    "minDeltaToReplace": 3,
    "scoreMode": "raw_log_delta",
    "baselineRawScore": -142.5,
    "pickedRawScore": -131.51,
    "maxNormalizedDelta": 0.0012,
    "topCandidates": [
      {
        "text": "你好,我想點一杯熱拿铁中杯少糖 身边溫 以下今天有蓝莓马芬吗?",
        "kenlmDelta": 10.99,
        "replacementCount": 4
      }
    ],
    "allCombinationDeltas": [10.99, 3.2, -1.1, 0.5, 2.59, -0.44, 0, -3.18],
    "kenlmSubprocessMs": 412,
    "kenlmSubprocessCount": 1
  }
}
```

*数值来自 Dialog200 Gate 3.0 批测结构（d001 类 case）。*

---

## 4. Sample — trace（spanAssemblyV4 + candidate）

```json
{
  "spanAssemblyV4": {
    "enabled": true,
    "coarseSpanCount": 7,
    "globalWindowGeneratedCount": 12,
    "windowCandidatePoolCount": 28,
    "activeCandidateCount": 18,
    "domainCandidateCount": 6,
    "baseCandidateCount": 12,
    "sameDomainCandidateCount": 4,
    "recallToneCompatibleCount": 9,
    "recallToneFallbackCount": 3,
    "toneExactHitCount": 5,
    "plainFallbackHitCount": 2,
    "mainDomainAwareSpanSetsTotal": 4,
    "shadowBeamSpanSetsTotal": 4,
    "domainVoteMs": 2,
    "assemblyMs": 18
  },
  "spans": [
    {
      "text": "鐘貝",
      "start": 12,
      "end": 14,
      "domain": "restaurant",
      "applied": false,
      "candidates": [
        {
          "candidateIndex": 0,
          "word": "中杯",
          "priorScore": 0.72,
          "candidateScore": 1.15,
          "source": "lexicon_pinyin_topk",
          "domains": ["restaurant"],
          "domainMatched": true,
          "repairTarget": true,
          "vetoed": false
        }
      ]
    }
  ]
}
```

启用：`spanAssemblyV4DiagnosticsEnabled=true` · level=`trace` · 可选 `spanAssemblyV4DiagnosticsTargetIds`

---

## 5. Sample — candidate lifecycle（trace 级）

```json
{
  "candidateLifecycle": [
    {
      "windowId": "w3",
      "word": "中杯",
      "stage": "recall_hit",
      "toneStage": "tone_exact",
      "priorScore": 0.72,
      "domainId": "restaurant",
      "repairTarget": true,
      "survivedCompatibility": true,
      "inMainSpanSet": true,
      "inSentenceCombination": true,
      "pickedInFinalSentence": true,
      "appliedAtSpan": false
    }
  ]
}
```

详约：[diagnostics/TRACE_FROZEN_V1_0_2.md](./diagnostics/TRACE_FROZEN_V1_0_2.md)

---

## 6. Flush 契约

- Assembly + KenLM 包裹在 `runWithRecallV2Diagnostics`
- **所有路径**（含 no_spans / no pick）执行 `flushRecallJobDiagnostics`
- 方案 A（2026-06-17 冻结）

---

## 7. 禁止项

- 删除 V1.0.0 / V1.0.2 已发布字段
- 将 `maxDelta` 改回 normalized 语义
- 用 diagnostics 字段反向驱动 pick 逻辑变更（须改代码 + 新合约）

---

## 8. 相关文档

- [INTERFACE_FREEZE.md](./INTERFACE_FREEZE.md)
- [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md)
