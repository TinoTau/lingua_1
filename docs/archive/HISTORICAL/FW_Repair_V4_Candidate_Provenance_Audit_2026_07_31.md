<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Candidate_Provenance_Audit_2026_07_31.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Candidate Provenance Audit

**Date:** 2026-07-31  
**Nature:** READ ONLY · FULL TRACE · NO CODE CHANGE · NO FIX · NO HEURISTIC JUDGMENT  

**Corpus:** `dialog_200`（200 cases）  
**Artifacts:**

- 逐 Case：`docs/tone-v2/_audit_scratch/candidate_provenance_audit/cases/NNN.md`（+ `.json`）
- 聚合：`docs/tone-v2/_audit_scratch/candidate_provenance_audit/aggregate.json`
- 全量列表：`docs/tone-v2/_audit_scratch/candidate_provenance_audit/global_lists.json`
- Probe：`docs/tone-v2/_audit_scratch/candidate-provenance-audit-probe.mjs`

**本轮唯一问题：**

```text
Candidate 为什么进入 Assembly，
为什么没有进入 Assembly。
```

不做句子合理性评价；不输出 Human Judgment / LooksOdd / Conform。

---

## 1. Architecture Trace

生产链路（与冻结设计一致）：

```text
Raw ASR
  → FineSpan（Path materialize；candidates = LexicalEdge.candidates）
  → Compatibility（resolveCompatibilityRelations；isCovered）
  → Domain Vote（retainedDomains only；不删 per-span 候选列表）
  → SameDomain Bucket × filterDomainCandidatesPerSpan
       ├ eligibility: isCandidateEligibleForSpanAssembly / windowCandidateToDomainAwarePickResult
       └ membership: sameDomain | base | (base-only fallback) | cross-domain exclude
  → budgetPerSpanCandidates（per-span limit + surface dedup + canonical 共存）
  → Assembly Grid = selectedCandidates
  → buildSentenceCandidates（句级组合）
  → mergeCrossPathSentenceCandidates（exact-text first-wins → global cap≤16）
  → KenLM Input = combinations
```

**计数单位（重要）：**

本审计对每个 **(Case × Path × retainedDomain Bucket × FineSpan × Recall Candidate)** 记一次观察。  
同一 Recall Candidate 会在多个 Bucket 中分别判定 KEEP/DROP（SameDomain 语义要求）。  
因此 Stage 数字是 **bucket-scoped evaluations**，不是「去重后的全局唯一 term 数」。

Canonical/raw preservation 在 Budget 层并入，记在各 Span 的 Candidate 列表末尾（`isCanonical`），不计入 Recall 基数。

---

## 2. Candidate Lifecycle

| 阶段 | Owner 模块 | 对 Candidate 的动作 |
|------|------------|---------------------|
| Recall | PathFineSpan ← LexicalEdge | 产出候选；本审计起点 |
| Compatibility | `resolveCompatibilityRelations` | `isCovered=true` → 后续不可组句 |
| Domain Vote | `voteUtteranceDomainFromPool` | **不删除**候选；只产出 retainedDomains |
| Domain Filter | `filterDomainCandidatesPerSpan` + eligibility | eligibility DROP 或跨桶 domain membership DROP |
| Budget | `budgetPerSpanCandidates` | perSpanLimit + surface dedup；canonical 合并 |
| Assembly | Grid = `selectedCandidates` | YES = 进入该桶 Grid |
| CrossPath | `mergeCrossPathSentenceCandidates` | 句级 exact-text dedup + cap；映射回「使用该 surface 的句」 |
| KenLM Input | orchestrator `kenlmSentenceCandidates.combinations` | YES = 至少一句 KenLM 输入的 replacement 使用该 surface@span |

---

## 3. Per-Span Candidate Provenance

完整展开见：

```text
docs/tone-v2/_audit_scratch/candidate_provenance_audit/cases/*.md
```

每个 Candidate 字段：

```text
word / surface / source / recallSource / hitKind /
priority(candidateRank) / score / toneScore(tonePenalty) / domainTags /
compatibility PASS|FAIL /
domainFilter KEEP|DROP + dropReason /
budget KEEP|DROP + budgetReason /
assembly YES|NO + assemblyReason /
crossPath KEEP|DROP + crossPathReason /
kenlm YES|NO
```

### 示例（结构示意，取自真实 drop 记录）

**Candidate：热拿铁（domains=["coffee"]）× Bucket food_order（d001）**

```text
Compatibility: PASS
Domain: DROP
  reason: DROP_CROSS_DOMAIN_FOR_BUCKET(bucket=food_order, candidateDomains=["coffee"])
  module: filterDomainCandidatesPerSpan SameDomain membership
Budget: DROP（upstream Domain DROP — Budget 未接收）
Assembly: NO
CrossPath: DROP（upstream 未进入 Grid）
KenLM: NO
```

**同 Candidate × Bucket coffee**

```text
Compatibility: PASS
Domain: KEEP（domains includes coffee）
Budget: KEEP
Assembly: YES
→ 可参与 coffee 桶组句；是否 KenLM 取决于该桶句是否在 CrossPath 后存活
```

---

## 4. Drop Ownership

| 删除/拦截点 | 模块 | 本轮观察到的依据 |
|-------------|------|------------------|
| Compatibility | `resolveCompatibilityRelations` | **0** 次 `isCovered` FAIL（dialog_200 本跑次） |
| Domain eligibility | `isCandidateEligibleForSpanAssembly` | **0** 次（无 RANGE/INCOMPLETE/UNSUPPORTED 等） |
| Domain membership | `filterDomainCandidatesPerSpan` | **492** 次 `DROP_CROSS_DOMAIN_FOR_BUCKET` |
| Budget | `budgetPerSpanCandidates` | **0** 次 TopK / surface-dedup 淘汰 |
| Assembly | — | 未进 Grid 即 NO（= Domain membership DROP 492） |
| CrossPath（进过 Grid 后） | `mergeCrossPathSentenceCandidates` | **69** 次；理由均为 exact-text first-wins dedup |
| Global cap | 同模块 slice(0,16) | 本跑次 **未** 观察到「uniqueBeforeCap 有、KenLM 无」的 Candidate 归因 |

**唯一 Domain dropReason 类：**

```text
DROP_CROSS_DOMAIN_FOR_BUCKET
```

**唯一 CrossPath（Grid 后）reason 类：**

```text
EXACT_TEXT_DEDUP first-wins: sentence(s) using this surface removed as duplicate text of an earlier combo
```

---

## 5. Stage Statistics

dialog_200 · bucket-scoped evaluations：

```text
Recall                         1432
  Compatibility PASS           1432
  Compatibility FAIL              0
        ↓
Domain KEEP                     940
Domain eligibility DROP           0
Domain membership DROP          492
        ↓
Budget KEEP                     940
Budget DROP                       0
        ↓
Assembly YES                    940
Assembly NO                     492
        ↓
CrossPath KEEP（映射到句）       871
CrossPath DROP                  561
  其中 upstream 未进 Grid        492
  其中 Grid 后 exact-text dedup   69
        ↓
KenLM YES                       871
KenLM NO                        561
```

### 数量变化简图

```text
Recall        1432
     │
Compatibility 1432 pass / 0 fail
     │
Domain Filter 940 keep / 492 drop（全部 cross-domain-for-bucket）
     │
Budget        940 keep / 0 drop
     │
Assembly      940 yes / 492 no
     │
CrossPath*    871 keep / 69 drop（仅计曾进 Grid 者）
     │
KenLM         871 yes
```

\* CrossPath 总 DROP 计数 561 = 492（从未进 Grid）+ 69（进 Grid 后句被 dedup）。

---

## 6. Candidate Flow Diagram

```text
                    Recall Candidate
                           │
              ┌────────────┴────────────┐
              │ Compatibility           │
              │ FAIL(isCovered) → STOP  │  （本跑次 0）
              └────────────┬────────────┘
                           │ PASS
              ┌────────────┴────────────┐
              │ Eligibility             │
              │ structural DROP → STOP  │  （本跑次 0）
              └────────────┬────────────┘
                           │ eligible pick
         ┌─────────────────┼─────────────────┐
         │ sameDomain/base │ cross-domain    │
         │ for this bucket │ for this bucket │
         │ KEEP            │ DROP            │  （492）
         └────────┬────────┴─────────────────┘
                  │
         ┌────────┴────────┐
         │ Budget          │
         │ TopK/dedup DROP │  （本跑次 0）
         └────────┬────────┘
                  │ KEEP → Assembly Grid YES
                  │
         ┌────────┴────────┐
         │ Sentence enum   │
         │ + CrossPath     │
         │ exact-text dedup│  （69 surface@span 无幸存句）
         └────────┬────────┘
                  │
              KenLM Input
```

---

## 7. Ownership Matrix

| 问题 | Owner | 本跑次结论 |
|------|-------|------------|
| 谁产出多表面 | Recall / Edge / FineSpan | 保留在 Span.candidates |
| 谁按覆盖作废 | Compatibility | 0 次 |
| 谁决定领域桶 | Vote（retainedDomains） | 不删候选行 |
| 谁按领域丢掉 | SameDomain membership | **唯一大规模删除点（492）** |
| 谁按配额丢掉 | Budget | **0** |
| 谁进入组句槽 | Assembly Grid | = Budget KEEP |
| 谁删句（非直接删候选） | CrossPath exact-text | 69 次「进 Grid 的 surface 无幸存句」 |
| 谁排序 | KenLM | 本审计不跑打分；只标 Input 是否包含 |

---

## 8. Target List

| ID | 问题 | 结论 |
|----|------|------|
| T1 | 哪些从未进入 Assembly？为什么？ | **492** 次观察：全部为当前 Bucket 的 `DROP_CROSS_DOMAIN_FOR_BUCKET`。模块：`filterDomainCandidatesPerSpan`。 |
| T2 | 哪些被 Budget 淘汰？为什么？ | **0**。Domain KEEP 的候选全部进入 Grid（本跑次 perSpanLimit 未截断）。 |
| T3 | 哪些被 Domain Filter 淘汰？为什么？ | **492**，且 **仅** membership 跨域排除；eligibility 结构性 DROP = **0**。 |
| T4 | 哪些被 CrossPath 删除？为什么？ | 进 Grid 后 **69**；理由均为 **exact-text first-wins**（句重复，不是 span Top1）。涉及 Case 见下。 |
| T5 | 是否存在「符合设计却提前删除」？ | **未发现**（`designPremature` 列表为空）。跨域排除与 exact-text dedup 均属冻结合同允许行为。Budget/eligibility 无异常提前清空。 |

### T1 — 从未进入 Assembly

- **机制：** 候选 `domains` 不含当前 `bucketDomain`，且非 `base_term` → membership DROP。  
- **不是** hitKind 门闩（parent_fragment 可 KEEP，只要同域）。  
- **完整行级列表：** `global_lists.json` → `domainDropped` / `neverAssembly`。  
- **涉及 Case 数：** 87（部分列出见 aggregate samples）。

### T2 — Budget 淘汰

- **空集。**

### T3 — Domain Filter 淘汰

- **仅** `DROP_CROSS_DOMAIN_FOR_BUCKET`。  
- 示例：d001 · Bucket `food_order` · surface `热拿铁` · domains `["coffee"]`。

### T4 — CrossPath（进 Grid 后）

Case 列表：

```text
d001, d019, d020, d021, d043, d044, d045, d046,
d064, d065, d066, d088, d089, d090, d109, d110, d111,
d133, d134, d135, d154, d155, d156, d178, d179, d180,
d181, d182, d199, d200
```

**依据：** 使用该 surface@span 的桶内句子在 CrossPath 因 **全文与更早句子相同** 被 first-wins 去掉；该 surface 不再出现在任何 KenLM Input 句的 replacement 中。

### T5 — 提前删除（相对冻结设计）

```text
未列出 Case：designPremature = []
```

---

## 9. Check List

* [x] 未修改代码 / 词库 / 配置 / dialog_200  
* [x] 未输出 Human Judgment / LooksOdd / Recommended Sentence / Conform  
* [x] 展开 Compatibility → Domain → Budget → Assembly → CrossPath → KenLM  
* [x] 包含被过滤 / Budget / Compatibility / Domain / CrossPath 删除项（有则列出；Budget/Compatibility 本跑次为空）  
* [x] 每项删除有模块名 + 依据字符串  
* [x] Stage 数量变化完整  
* [x] 回答 T1–T5  
* [x] 逐 Case 明细在 `candidate_provenance_audit/cases/`  

---

## 10. Final Audit Conclusion

```text
进入 Assembly 的充分条件（本实现）：
  Compatibility PASS
  ∧ eligibility PASS
  ∧（SameDomain(bucket) ∨ base_term ∨ base-only fallback）
  ∧ Budget KEEP（含 surface dedup / perSpanLimit）

本跑次 dialog_200：
  唯一让 Recall Candidate 进不了 Assembly 的删除 Owner
  = SameDomain Bucket membership（跨域排除）。

Budget 不是瓶颈。
Compatibility / eligibility 结构性拒绝本跑次未出现。

进 Assembly 后仍可能不上 KenLM：
  Owner = CrossPath exact-text first-wins（句级），
  不是 per-span winner。
```

**一句话：**

Candidate 能否进入 Assembly，由 **当前 SameDomain Bucket 的领域归组** 决定；本跑次没有发现 Budget / exact_term 残留门闩造成的提前删除。

---

*Probe 只读；完整 per-candidate 表以 `cases/*.md` 为准。* 
