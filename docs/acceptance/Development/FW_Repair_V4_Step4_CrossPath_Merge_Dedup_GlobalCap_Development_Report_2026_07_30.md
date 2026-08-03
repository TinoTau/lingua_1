<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Step4_CrossPath_Merge_Dedup_GlobalCap_Development_Report_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Step 4 Cross-Path Merge, Dedup and Global Cap Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-30 |
| Step | 4 / 7 |
| Scope | PathAssemblyResult[] → Cross-Path Merge → Dedup → Global ≤16 → 唯一 KenLM Input |
| Verdict | **STEP4_PASS** |
| Not | 删除 LTR 文件 · 改 Vote/Assembly/Recall/KenLM 评分 · Path Rank |

---

## 1. Executive Summary

正式唯一函数 `mergeCrossPathSentenceCandidates` 已取代 `STEP3_TEMPORARY_PRE_STEP4_COLLECTION`。全 Path / Bucket 句子候选按稳定顺序收集，按 `text` 首次保留去重，再全局截断 ≤16，作为 KenLM 唯一输入。dialog_200：**200/200** 成功；KenLM input 均 ≤16 且无重复；**LTR call = 0**。

```text
STEP4_PASS
```

---

## 2. Before Candidate Flow

```text
PathAssemblyResult[]
→ temporaryAllPathBuckets (flat path-order bucket lists)
→ mergeCrossBucketSentenceCandidates
   (dedup by text, keep HIGHER score, then score-sort, then slice 16)
→ kenlmSentenceCandidates
→ temporaryPreStep4Collection: true
```

---

## 3. After Candidate Flow

```text
PathAssemblyResult[]
→ mergeCrossPathSentenceCandidates(pathResults, globalCap)
   collect Path→bucket→candidate (stable)
   dedup text first-wins (no score merge / re-rank)
   slice(0, ≤16)
→ kenlmSentenceCandidates.combinations
→ fw-detector-v4-path prefilledCombinations
→ runFwSentenceRerankFromPrefilled (once)
```

---

## 4. Temporary Collection Audit

| Question | Answer | Class |
|----------|--------|-------|
| 收集顺序 | Path enum → bucket → Assembly order | KEEP 顺序 / DELETE 临时变量 |
| 先 Path 还是 Bucket | 先 Path，再 Path 内 Bucket | KEEP |
| 是否去重 | 是（经 mergeCrossBucket） | MODIFY → first-wins |
| 去重 key | `combo.text` | KEEP |
| 是否截断 | 是，global 16 | KEEP 位置改到 dedup 后稳定序 |
| 截断相对去重 | 去重后截断；但旧实现按分数重排 | MODIFY |
| per-path/bucket final cap | 无；仅 Path-local `buildSentenceCandidates(..., 16)` 生成预算 | KEEP（上游既有） |
| 是否改分数 | 旧 merge 选更高分 | DELETE 该行为 |
| 丢失 pathId | 临时 flat 丢失；正式 merge 不写 DTO，trace 可扩 | KEEP 最小 |
| KenLM 收到多少 | ≤16 | KEEP |

---

## 5. Cross-Path Merge Ownership

```text
merge-cross-path-sentence-candidates.ts
  export function mergeCrossPathSentenceCandidates(...)
```

唯一正式 KenLM 句子池 Owner。

---

## 6. Collection Order

```text
SegmentationPath enumeration order
→ Path.perBucketGenerated bucket order
→ bucket Assembly candidate order
```

确定性；无 Set 遍历依赖。

---

## 7. Dedup Contract

```text
key = candidate.text (exact)
无额外归一化
```

---

## 8. Duplicate Retention Rule

```text
稳定收集顺序中第一次出现的候选保留。
不合并分数 / 不累加票 / 不选更高分来源。
```

---

## 9. Global Cap Contract

```text
collect → dedup → uniqueBeforeCap.slice(0, maxSentenceCandidates)
maxSentenceCandidates = 16（整句总池）
无 per-path / per-bucket / 平均预算
```

不足 16：全部送入；0：空池（现有 fail-open raw 合同），不 fallback LTR。

---

## 10. KenLM Input Ownership

```text
orchestrator.kenlmSentenceCandidates.combinations
  = mergeCrossPathSentenceCandidates(...).combinations

fw-detector-v4-path
  → prefilledCombinations: assemblyResult.kenlmSentenceCandidates?.combinations
  → runFwSentenceRerankFromPrefilled（唯一）
```

无 Path/Bucket/LTR 直连 KenLM。

---

## 11. Cross-Bucket vs Cross-Path Boundary

| Layer | Owner |
|-------|-------|
| Path 内生成 | `buildSentenceCandidates`（既有局部 cap） |
| Path 间 KenLM 池 | `mergeCrossPathSentenceCandidates` |
| Legacy helper | `mergeCrossBucketSentenceCandidates`（测试 / 旧 helper；生产 orchestrator **不再**调用） |

---

## 12. Trace and Compliance

新增 metrics / compliance：

```text
crossPathInputCandidateCount
crossPathDuplicateCount
crossPathUniqueCandidateCount
crossPathOutputCandidateCount
crossPathTruncatedCount
globalCandidateCap
kenlmInputSource: cross_path_merge

crossPathMergeOwner: orchestrator
candidateCapScope: global
candidateCap: 16
dedupBeforeCap: true
kenlmInputOwner: cross_path_merge
```

删除：`temporaryPreStep4Collection`。

---

## 13. Removed Temporary Logic

生产代码中已清零：

```text
STEP3_TEMPORARY_PRE_STEP4_COLLECTION
temporaryPreStep4Collection
temporaryAllPathBuckets
```

---

## 14. Modified Files

| File | Change |
|------|--------|
| `merge-cross-path-sentence-candidates.ts` | **新增** |
| `merge-cross-path-sentence-candidates.test.ts` | **新增** |
| `span-assembly-v4-orchestrator.ts` | 正式 Cross-Path Merge |
| `v4-types.ts` | compliance / metrics |
| `fw-detector-v4-path.ts` | probe 字段对齐 uniqueBeforeCap |
| `run-fw-sentence-rerank-from-prefilled.ts` | 注释 Ownership |
| `freeze-contract.test.ts` | 静态门更新 |
| `Runtime_SSOT_Contract_Freeze.md` | §Formal path / §17 |
| Step4 dialog_200 probe | **新增** |

---

## 15. Static Scan

```text
rg STEP3_TEMPORARY|temporaryPreStep4Collection main/src
→ 仅测试中的 not.toContain 断言（生产实现 = 0）

rg mergeCrossPathSentenceCandidates
→ 唯一实现 + orchestrator 调用 + 测试
```

---

## 16. Tests Executed

| Suite | Result |
|-------|--------|
| `npm run build:main` | PASS |
| `merge-cross-path-sentence-candidates.test.ts` | PASS（A–H + 稳定性） |
| freeze-contract / orchestrator.step3 / lattice / phase2 / recall-scope | PASS（120 tests batch） |

---

## 17. dialog_200 Results

`docs/tone-v2/_audit_scratch/step4_cross_path_merge/dialog_200_summary.json`

| Metric | Value |
|--------|-------|
| casesTotal | 200 |
| orchestratorSuccess | **200** |
| orchestratorFailure | **0** |
| maxKenlmInputCount | **1** |
| casesTruncatedTo16 | 0 |
| maxInputCandidateCount | 6 |
| maxUniqueCandidateCount | 1 |
| ltrRuntimeCallCount | **0** |
| failCases | [] |
| latency p50/p95/max (ms) | 46 / 83 / 148 |

说明：多 Path 时常生成相同最终句子文本，去重后 unique 常为 1；仍满足 ≤16 无重复硬门槛。

---

## 18. Candidate Count Distribution

- Input：1→128，2→44，…，max 6  
- Duplicate：与多 Path 同文重合一致  
- Unique / KenLM input：全部 case = 1  

---

## 19. KenLM Call Verification

生产路径仅 `fw-detector-v4-path` → `runFwSentenceRerankFromPrefilled(prefilledCombinations)` 一次；输入来自 Cross-Path Merge 输出。

---

## 20. LTR Runtime Verification

Probe patch 计数：`ltrRuntimeCallCount = 0`。Orchestrator 无 LTR import。

---

## 21. Remaining Work for Step 5

```text
（按总体计划）后续清理 / 删除 LTR 文件本体 / 残余 harness 收敛
```

本轮未删除 `ltr-fine-span-generator.ts`。

---

## 22. Target List Completion

| ID | Status |
|----|--------|
| T1–T8 Merge / Dedup / Cap / Trace | Done |
| T9 单测 | Done |
| T10 dialog_200 | Done |

---

## 23. Check List Completion

- [x] 临时收集删除
- [x] 唯一 Cross-Path Merge
- [x] 全 Path 候选收集；first-wins 去重；dedup-before-cap；≤16
- [x] 无 per-path/bucket final cap / Path Score
- [x] KenLM 唯一输入 Owner
- [x] 编译 / 单测 / dialog_200 / LTR=0
- [x] 无 flag / shadow / adapter

---

## 24. Final Verdict

```text
STEP4_PASS
```
