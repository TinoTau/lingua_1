# SameDomain + Base Per-Span Assembly — Internal Detail Contract V1.2

**状态**：CURRENT（Assembly Internal Detail · 2026-07-26 Path-scoped）  
**Runtime Domain Presence Vote formula:** **ACCEPTED AND FROZEN** — [`Runtime_SSOT_Contract_Freeze.md`](../../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**Fine Span / Path SSOT:** [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](../../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md)  
**代码根**：`electron_node/electron-node/main/src/fw-detector/`

```text
Fine Span SSOT: SegmentationPath[] (Lattice Architecture V1.0.0)
Vote formula authority: Runtime_SSOT_Contract_Freeze.md
Assembly caller: one SameDomain assembly per SegmentationPath

This document only defines Assembly internal details.
```

**Sole Runtime Authority (formula):** [`Runtime_SSOT_Contract_Freeze.md`](../../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**Index:** [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md)

本文件 **不是**完整 Runtime 主链合同，也 **不是** Fine Span 分界 SSOT。

---

## 1. 定位

Assembly Internal Detail Contract：

- Path-local Span assembly 输入与 per-span 选择
- Base + domain candidate 组装（Path 内）
- Sentence candidate construction
- candidateScore 在 Assembly 内的作用
- 每桶 bounded generation
- Cross-bucket text dedup（Path 内）后进入 Global Allocator
- Global candidate cap **≤16**（跨 Path）
- Assembly diagnostics（含 pathId / boundaryKey）

---

## 2. Assembly 输入与流程（内部 · Path-scoped）

```text
for each SegmentationPath:
  materializeFormalFineSpans(path)   // ephemeral adapter only
  → buildFineSpanCandidatePool
  → voteUtteranceDomainFromPool      (formula owned by Runtime SSOT; pool = this Path only)
  → per retainedDomain: same-domain + Base
  → selectPerSpanCandidates
  → assembleDomainAwareSpanSets
  → per-bucket buildSentenceCandidates
→ mergeCrossPathSentenceCandidates
→ global slice <=16 (retain multi-source Trace on identical text)
→ kenlmSentenceCandidates / prefilledCombinations
```

**Forbidden:** Path A prefix + Path B suffix; shared ReplacementPick across Paths; FormalFineSpan as utterance SSOT.

Shadow Beam / Graph Domain Vote / Domain Rerank / Parent Domain Vote：**REMOVED**，不得恢复为正式路径。

语义 Beam / KenLM Beam：**禁止**；有限完整 SegmentationPath 并行保留 **允许**（Lattice Architecture）。

---

## 3. 核心接口

| 函数 | 输入 | 输出 |
|------|------|------|
| `buildFineSpanCandidatePool` | `WindowCandidate[]` | `FineSpanCandidatePool[]` |
| `voteUtteranceDomainFromPool` | pools | `UtteranceDomainVoteResult`（规则见 Runtime SSOT） |
| `filterDomainCandidatesPerSpan`（内联） | vote + pools | sameDomain + Base |
| `selectPerSpanCandidates` | filtered sets | 按优先级选 per-span |
| `assembleDomainAwareSpanSets` | selections | `SpanReplacementPick[][]` |
| `buildSentenceCandidates` | spanSets + cap | sentence candidates（含 Formula A metadata） |
| `mergeCrossBucketSentenceCandidates` | per-bucket lists | text-deduped pool（透传 metadata，不重算） |
| `runSpanAssemblyV4Orchestrator` | `recallDomainScope` + raw/runtime/… | metrics + spanSets + kenlm pool |

**Per-span 选择优先级**：`sameDomain > base > fallback > canonical`

**Recall Domain SSOT：** orchestrator **只**接收 `recallDomainScope`（DSU）。

---

## 4. 数据结构

```ts
// FineSpanCandidatePool
{ coarseSpanId, candidates }

// DomainFilteredSpanSet
{ sameDomainCandidates, baseCandidates, fallbackCandidates, selectedCandidates }

// DomainAwareSpanReplacementPick
{ word, span, score, recallSource, repairTarget, domains? }

// SentenceCombination（Assembly Sole Owner；metadata-only）
{
  text, replacements[], candidateScore,
  repairSelectionCompleteness, // RAW | PARTIAL_SELECTION | COMPLETE_SELECTION
  repairPickCount,
  unrepairedRepairableSlotCount
}
// repairSelectionCompleteness = Formula A Slot Coverage（replacement selection completeness）
// 不表示 semantic correctness；raw-only slot 不计入 unrepairedRepairableSlotCount
```

KenLM / `SpanReplacementPick` 路径不得携带 domains 元数据。
KenLM **不得**读取 `repairSelectionCompleteness` 三字段。
CrossPath **仅**透传，不得重算 / 过滤 / 排序。

---

## 5. candidateScore（Assembly 内）

- 用于 per-span 选择排序与跨桶 text dedup 时保留更高分候选。
- **不得**决定 domainScores / Vote 票数。

---

## 6. Per-Bucket Bounded Generation

- 每桶 `buildSentenceCandidates(cap = MAX_SENTENCE_CANDIDATES)`。
- 不得用 `floor(16 / bucketCount)` 作为最终配额再合并。
- `retainedDomains.length > 16` 时 `allocateDomainBucketSentenceBudget` 须显式失败。

### Known Non-Blocking Inconsistency（2026-08-05 登记）

`allocateDomainBucketSentenceBudget` **被调用**且返回 per-bucket budget，但返回值**未**传入 `buildSentenceCandidates`；每桶仍使用全局 cap **16**。当前仅利用 `floor(16/bucketCount) < 1` 作为 guard。

```text
Classification: KNOWN_NON_BLOCKING_INCONSISTENCY
Reason: dialog_200 pools << 16；无现阶段输出影响证据
本轮不得修改。Reopen when multi-bucket cap pressure is observed.
```

---

## 6A. Combination Enumeration Algorithm（归档 · 2026-08-05）

```text
Interval Non-Overlap Repair-Subset DFS
+ Canonical Gap Fill
+ candidateScore Sort
+ Exact-Text Dedup
+ Output Cap
```

| Limit | Value |
|-------|------:|
| `maxIntervalEnumNodes` | 1024 |
| `maxIntervalRepairPicksPerPath` | 16 |
| `maxSentenceCandidates` | 16 |
| per-span candidate limit | 8 / 6 / 4 |

Assembly 枚举的是**合法 Replacement Subset**，不是语义候选聚类；不判断 Semantic Correctness / Sentence Similarity / Near-Duplicate Meaning。

**Top16 利用率（Enumeration Audit）：** dialog_200 mean pool ≈1.685；competition mean ≈2.827；max=8；full-16=0 → **非容量瓶颈**。

**Candidate Diversity：** 暂无 Sole Owner；暂停开发（见 Snapshot Known Limitations）。

Code: `build-sentence-candidates.ts` · Evidence: Assembly Enumeration Audit 2026-08-05

---

## 7. Cross-Bucket Dedup + Global Cap

```text
mergeCrossBucketSentenceCandidates
  → identical text keeps higher candidateScore
  → global Sentence Candidates <=16
```

权威上限与 KenLM 边界：Runtime SSOT。

---

## 8. Orchestrator 合约（精简）

| ID | 约束 |
|----|------|
| H1 | `spanSets` 必须来自 domain-aware assembly |
| H2 | emptyResult metrics 显式初始化为 0 |
| H3 | diagnostics 字段类型同步 |
| H5 | 生产 Vote 唯一入口：`voteUtteranceDomainFromPool` |
| H8 | `buildSentenceCandidates` 仅接受 domainAware spanSets |

**禁止：** `shadowBeamSpanSets`、Beam→KenLM、双 Vote。

---

## 9. 行为合约（B01–B06）

| ID | 约束 |
|----|------|
| B01 | Pool 按 coarseSpanId 分组，不跨 span 混排 |
| B02 | Vote 基于 pool 内 domain presence（见 Runtime SSOT） |
| B03 | Filter 保留 sameDomain + Base（+ fallback 诊断） |
| B04 | Select 同 span 内按 priority + score 排序 |
| B05 | Assemble 输出与 coarse span 顺序对齐 |
| B06 | 空 pool / 无 vote 时返回合法 empty spanSets + 完整 metrics |

---

## 10. Metrics（有效字段）

| 字段 | 含义 |
|------|------|
| `domainCandidateCount` | filter 后 domain 桶总量 |
| `baseCandidateCount` | base 桶总量 |
| `sameDomainCandidateCount` | sameDomain 桶总量 |
| `domainFilteredSpanCount` | 有过滤结果的 span 数 |
| `selectedCandidatesPerSpanAvg` | 每 span 选中候选均值 |
| `domainAssemblyMs` | assembly 耗时 |
| `mainDomainAwareSpanSetsTotal` | Main span 条目总数 |

`shadowBeamSpanSetsTotal`：**REMOVED**（禁止恢复为生产路径字段）。

---

## 11. SSOT 文件

| 类别 | 路径 |
|------|------|
| Assembly | `assemble-domain-aware-span-sets.ts` · `domain-assembly-types.ts` · `window-candidate-to-pick.ts` |
| Merge | `build-sentence-candidates.ts`（`mergeCrossBucketSentenceCandidates`） |
| Vote | `utterance-domain-vote.ts`（规则 owner = Runtime SSOT） |
| Orchestrator | `span-assembly-v4-orchestrator.ts` |
| Tests | `freeze-contract.test.ts` · `assemble-domain-aware-span-sets.test.ts` |

---

## 12. 禁止项

- 恢复 Shadow Beam / Graph Domain Vote / Domain Rerank / Parent Domain Vote
- 将 Beam spanSets 接入 KenLM / Apply
- 在本文件重新定义完整 Presence Vote / retainedDomains 公式
- 静默修改 per-span priority 顺序
- 单领域 Assembly fallback 作为正式路径

---

## 13. 相关文档

- Runtime SSOT：[`Runtime_SSOT_Contract_Freeze.md`](../../tone-v2/Runtime_SSOT_Contract_Freeze.md)
- KenLM：[`kenlm/KENLM_RUNTIME.md`](../kenlm/KENLM_RUNTIME.md)
- Ranking：[`RANKING_V1_2.md`](./RANKING_V1_2.md)
