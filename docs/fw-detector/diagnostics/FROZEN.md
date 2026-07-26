# Diagnostics — 冻结合约 V1.0.2

**状态：** FROZEN · 2026-06-25  
**代码：** `types.ts` · `v4-diagnostics-*` · `fw-detector-v4-path.ts` · `recall-topk-for-windows.ts`  
**原则：** 可观测层 only — **禁止**用 diagnostics 改变 Recall/Assembly/KenLM/Apply 行为

---

## 1. selected · applied · approved

| 字段 | 层级 | 语义 | 影响 final？ |
|------|------|------|-------------|
| `assemblySelectionTraces` / `selectedBucket` | Assembly | select 结果 | **否** |
| `span.applied` | Writeback 后 | coarse span 与 approved 重叠 | **是**（指标） |
| `approved` | Apply | 可写回区间 | **是** |
| `summary.appliedCount` | Summary | = fw_applied 语义 | **是** |
| `pickedIsRaw` | Apply Gate | Δ 不足或未 pick | **是** |

```text
assemblySelected=少冰  ≠  fw_applied>0  ≠  finalText含少冰
```

典型 **d048**：Assembly 少冰 · `appliedCount=0`（Δ<3.0）。

---

## 2. 字段矩阵

### Assembly（`spanAssemblyV4`）

`domainCandidateCount` · `baseCandidateCount` · `sameDomainCandidateCount` · `mainDomainAwareSpanSetsTotal` · `assemblySelectionTraces` · Context Prior min/max multiplier

### KenLM（`sentenceRerank`）

| 字段 | 语义 |
|------|------|
| `scoreMode` | `raw_log_delta` |
| `baselineRawScore` / `pickedRawScore` | raw log scores |
| `maxDelta` | max rawDelta（Gate 观测） |
| `minDeltaToReplace` | **3.0** |
| `pickedIsRaw` | Apply Gate 结果 |
| `allCombinationDeltas` | 每组合 raw delta |
| `maxNormalizedDelta` | **仅对照，不参与 pick** |

### DSU Runtime（`FwDetectorRuntimeDiag`）

`enabledDomains`（配置输入）· `availableFineDomains` · `recallDomainScope`（**唯一 Recall Domain SSOT**）· `recallScopeSource` · `domainHierarchyVersion` — **仅观测**

Assembly metrics（追加观测，不改业务 ABI）：`domainLookupExecuted` · `domainLookupDomainCount` · `domainRecallHitCount` · `voteEligibleDomainCandidateCount` · `resolvedRecallDomainScope`

### Context Prior

`contextPriorDomain` · `contextPriorApplied` · `contextPriorSkippedReason`

---

## 3. 定位 playbook

| 症状 | 先看 | 再看 |
|------|------|------|
| 烧饼在 final | Recall `toneReason` / `tonePenalty` | Ranking 分数排序 |
| Assembly 少冰无写回 | `maxDelta` vs 3.0 | `pickedIsRaw` |
| fw_applied=0 全批 | `combinationCount` | ASR 表面 |

---

## 4. Trace 合约（V1.0.2）

### Flush（方案 A）

```text
runWithRecallV2Diagnostics
  → runSpanAssemblyV4Orchestrator → runFwSentenceRerankFromPrefilled
  → flushRecallJobDiagnostics（所有路径含 no_spans）
```

**禁止**修改 `recall-v2-diagnostics.ts`。

### V2/V3 Result 必传字段

`queryTonePinyinKey` · `toneExactHitCount` · `plainFallbackHitCount` — V3 须完整继承 V2。

### Tone Summary

`toneExactHitCount` / `plainFallbackHitCount` 与 `recallToneCompatibleCount` **不同语义**；`createEmptyToneDiagnostics()` 须初始化为 `0`。

### Trace 配置（生产 vs 批测）

| 键 | 生产默认 | 批测 patch |
|----|----------|------------|
| `spanAssemblyV4DiagnosticsEnabled` | false | true |
| `spanAssemblyV4DiagnosticsLevel` | summary | trace |
| `spanAssemblyV4DiagnosticsTargetIds` | [] | d001, d048 |

`ToneLookupStage` SSOT：`tone-first-tier-collector` — 禁止第四套 union。

### H3 类型同步

新增 diagnostics 字段须同时更新 `v4-types.ts` · `types.ts` · `fw-detector-v4-path.ts` · mappers/trace。

---

## 5. Sample — summary

```json
{
  "pipelinePath": "v4",
  "summary": { "spanCount": 4, "appliedCount": 0, "kenlmQueryCount": 17 },
  "sentenceRerank": {
    "pickedIsRaw": false,
    "maxDelta": 10.99,
    "minDeltaToReplace": 3,
    "scoreMode": "raw_log_delta",
    "baselineRawScore": -142.5,
    "pickedRawScore": -131.51,
    "allCombinationDeltas": [10.99, 3.2, -1.1]
  }
}
```

---

## 6. Sample — spanAssemblyV4

```json
{
  "spanAssemblyV4": {
    "domainCandidateCount": 6,
    "baseCandidateCount": 12,
    "mainDomainAwareSpanSetsTotal": 4,
    "toneExactHitCount": 5,
    "plainFallbackHitCount": 2
  },
  "spans": [{
    "text": "鐘貝",
    "applied": false,
    "candidates": [{ "word": "中杯", "repairTarget": true, "vetoed": false }]
  }]
}
```

---

## 7. 禁止项

- 删除 `pickedIsRaw` · `maxDelta` · `scoreMode` 等核心字段
- 将 `maxDelta` 改回 normalized 语义
- 借 diagnostics 驱动 pick 逻辑变更
- 生产默认开启全量 trace

---

## 8. SSOT 文件

| 文件 | 职责 |
|------|------|
| `fw-detector-v4-path.ts` | flush wrapper |
| `v4-diagnostics-types.ts` | trace 类型 |
| `recall-topk-for-windows.ts` | PreFilter/RecallHit trace |
| `span-assembly-shared/tone-diagnostics.ts` | tone summary |

接口类型见 [INTERFACE_FREEZE.md](../INTERFACE_FREEZE.md)。

---

## 9. HTTP `diagnostics.toneModule`（Tone V2 Phase 1 冻结）

**挂载点：** FW `/utterance` response `diagnostics.toneModule` — **仅观测**，不进 Recall/Ranking Decision。

| 字段 | 语义 |
|------|------|
| `backend` · `modelVersion` · `featureVersion` · `modelHash` · `formatVersion` | Loader metadata |
| `loadError` | Load 失败原因（`ready=false` 时） |
| `metadataWarning` | 如 `featureVersion_missing` · `featureVersion_legacy_*` |
| `tone_inference_ms` · `toneSliceCount` | 性能 / 切片计数 |
| `toneEnabled` · `skippedReason` · `toneConfidenceAvg` | Utterance 级 tone 状态 |

**SSOT：** [../../tone-v2/TONE_V2_CONTRACT_FREEZE.md](../../tone-v2/TONE_V2_CONTRACT_FREEZE.md) §4–§5

**禁止：** 用 `diagnostics.toneModule` 驱动 pick · 恢复 `toneGuardBlockedCount`

---

---

## 10. Metrics Layer Consumer（SSOT Alignment · 2026-07-14）

**原则不变：** Diagnostics 可观测 only — Metrics **不得**改变 Recall/Assembly/KenLM/Apply。

| 约束 | 说明 |
|------|------|
| Runtime = 唯一 SSOT | Metrics = Read→Map→Report |
| Generated vs Dump | `combinationCount` / `allCombinations` ≠ `topCandidates` |
| Trace Required | `allCombinations` · recallHits 全文依赖 `diagnosticsLevel=trace` |
| Unavailable ≠ Failure | 缺字段报 Unavailable，禁止推断 Failure |
| Consumer Reports | Success Funnel / Recall Funnel / E2E 摘要 **不是** Architecture |

**Binding：**  
`docs/tone-v2/Lingua_Runtime_Evolution_Rule.md`（**Permanent · Runtime 演进管线**） ·  
`docs/tone-v2/Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md` ·  
`docs/tone-v2/Lingua_Metrics_Layer_SSOT_Alignment_Supplement_2026_07_14.md` ·  
`docs/tone-v2/Lingua_Metrics_Layer_SSOT_Mapping.md`（Catalog 登记）

**实现入口（只读消费）：**  
`electron_node/electron-node/tests/experiments/analyze-metrics-ssot.mjs`

---

*Diagnostics FROZEN V1.0.2 · FW Detector 子模块 · Tone V2 Phase 1 同步 2026-06-29 · Metrics Consumer 附录 2026-07-14*
