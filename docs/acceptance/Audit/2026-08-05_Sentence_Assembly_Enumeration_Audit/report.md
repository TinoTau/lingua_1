# FW Repair V4 — Sentence Assembly Enumeration & Diversity Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | `FW_V4_FREEZE_2026_08_03` |
| Nature | **READ ONLY** |
| Scope | `buildSentenceCandidates` · Combination enumeration · CrossPath input · Diversity / Top16 |
| Out of scope | Tone · Recall quality · KenLM score · Interactive Repair |
| Evidence | dialog_200 Pre-KenLM Assembly Traces (200) + KENLM_BENCHMARK_V1 competition (75) |
| Verdict | **ASSEMBLY_CONTRACT_INCOMPLETE** |

---

## Q1 — Exact Enumeration Algorithm

**算法名：Interval Non-Overlap Repair-Subset DFS（按 slot 递归）+ gap canonical fill**

不是 beam，不是 BFS，不是跨 slot 全笛卡尔积（对 repair picks），而是：

1. 对每个 `spanSets[slot]`，取 `repairTarget === true` 的 picks。
2. 对该 slot 内 repair picks，枚举**全部非重叠子集**（含空集 `[]`）—— `allNonOverlapSubsets`。
3. DFS：`visitSlot(i, chosen)` → 对每个子集，若与 `chosen` 无 raw-overlap，则 `visitSlot(i+1, chosen∪subset)`。
4. 叶子：`buildPathFromRepairs` = 所选 repair picks + 各 coarse range 未覆盖间隙的 **canonical gap fill**。
5. 对每个 path：右到左 apply → `text`；`candidateScore = Σ pick.candidateScore`；附加 Formula A metadata。
6. 按 `candidateScore` 降序排序。
7. **exact-text** `Map` first-wins 去重。
8. `slice(0, maxSentenceCandidates)`（通常 16）。

空组合 `[]` 始终可到达 → 产生 RAW 句（仅 gap/canonical）。

详见 `enumeration_algorithm.md`。

---

## Q2 — Enumeration Contract（生成条件）

Combination 被生成当且仅当满足：

| # | Rule |
|---|------|
| R1 | `spanSets.length > 0` 且 `maxSentenceCandidates > 0` |
| R2 | 路径来自 slot-wise 非重叠 repair 子集 DFS |
| R3 | `chosen.length ≤ maxIntervalRepairPicksPerPath`（**16**） |
| R4 | 枚举节点 `enumNodes ≤ maxIntervalEnumNodes`（**1024**）；超限则 **截断继续扩展**（`capped=true`） |
| R5 | Slot 内 / 跨 slot：`rawOverlap` 的 picks 不得同处一条 path |
| R6 | 每条 path 经 gap canonical 补全 coarse ranges |
| R7 | 排序后 exact-text 去重，再按 cap 截断 |

**上游输入约束（进入 `buildSentenceCandidates` 之前，仍属 Assembly 管线）：**

| # | Rule |
|---|------|
| U1 | Path-local SameDomain + Base spanSets（`assembleDomainAwareSpanSets`） |
| U2 | Per-span budget：`getPerSpanCandidateLimit`（1→8 / 2→6 / else→4）+ surface dedupe |
| U3 | Canonical/raw 始终保留为 preservation candidate |
| U4 | 每 retained domain bucket **独立**调用 `buildSentenceCandidates(..., kenlmCap)` |
| U5 | `allocateDomainBucketSentenceBudget`：**仅作 bucket 数 ≤ cap 的硬失败守卫**；返回的 per-bucket 配额 **未被 orchestrator 使用**（每桶仍传全局 16） |

---

## Q3 — Duplication Sources

| Source | Exact text dup? | Near-dup (1–2 char)? |
|--------|-----------------|----------------------|
| Repair subset enumeration（不同子集 → 同表面句） | Yes | Yes |
| Multi-bucket（同 Path 多 domain）独立生成 | Yes | Yes |
| Multi-Path CrossPath 收集 | Yes | Yes |
| Gap-fill provenance 不同但 apply 后同文 | Yes | — |
| 不同 repair pick 差 1–2 字 | No（各占一槽） | **Yes — 主问题** |

KenLM **不**产生候选，也不去重。

---

## Q4 — Duplication Owner

| Layer | Dedup key | Retention |
|-------|-----------|-----------|
| **Assembly** `buildSentenceCandidates` | exact `text` | first-wins（按 score 排序后首次） |
| **CrossPath** `mergeCrossPathSentenceCandidates` | exact `text` | first-wins（path→bucket→candidate 序） |
| Before Assembly | per-span surface dedupe only | N/A for sentences |
| KenLM | none | consume |

**没有** sentence-similarity / semantic / domain-quota dedup。

---

## Q5 — Replacement Diversity vs Sentence Diversity

**Assembly 最大化的是 Replacement-Subset Diversity（可组合的非重叠 repair 路径），不是 Sentence Diversity。**

例：`候选生成` / `候选生城` / `候选声称` 若均由不同 repair 子集产生且 exact text 不同 → **各占 1 个候选槽**。  
当前合同 **允许且会保留** 这类近重复；无「一 token 差应合并」规则。

观测（75 competition）：edit≤1 近重复簇占用池内份额均值 **≈41.8%**。

---

## Q6 — Semantic / Domain Path Retention

**不保证**「AI / Travel / Medical 各留语义路径」。

- Domain 多样性来自 Vote retained buckets + CrossPath 收集顺序，**不是** Assembly 内语义多样性目标。
- 75 competition 中：**57** 单 retained domain，**18** 多 domain；均值 retainedDomains **1.4**。
- 同域内可出现大量 1–2 字近重复；跨域语义对照 **无强制配额**。

---

## Q7 — Top16 Utilization

dialog_200 Assembly KenLM-input 池（cap=16）：

| Metric | All 200 | Competition 75 |
|--------|--------:|---------------:|
| Mean pool size | 1.69 | 2.83 |
| Median | 1 | 2 |
| Max | 8 | 8 |
| Mean fill rate | **10.5%** | ~17.7% |
| Cases filling 16 | **0** | 0 |
| Mean unused slots | **14.3** | ~13.2 |

**Top16 严重空置**；瓶颈在枚举产出的 **distinct exact-text 过少**，而非 cap 截断。

Competition 中 edit≤1 近重复：36/75 case 存在 size≥2 簇；最大近重复簇均值 ≈2.0。

---

## Q8 — Candidate Similarity Statistics

Competition pairwise（仅 pool≥2）：

| Diff bucket | Pair count |
|-------------|----------:|
| 1_char | 103 |
| 2_char | 145 |
| 3plus_char | 34 |
| identical (edit0) | 0（KenLM 池已 exact-dedup） |

1–2 字差合计 **248/282 ≈ 87.9%** 的竞争对为近重复。  
详见 `candidate_similarity_analysis.csv` · `candidate_cluster_statistics.csv`。

---

## Q9 — Combination Explosion Contract

**有确定性上限，但是「硬 cap + 枚举节点 cap」，不是多样性合同。**

| Limit | Value | Effect |
|-------|------:|--------|
| `maxIntervalEnumNodes` | 1024 | DFS 节点超限停止扩展 |
| `maxIntervalRepairPicksPerPath` | 16 | 单 path repair 数上限 |
| Per-span candidate limit | 8/6/4 | 上游减少每个 slot 的 repair 选项 |
| `maxSentenceCandidates` | 16 | Assembly 输出与 CrossPath 全局 cap |
| Overlap reject | — | 剪掉非法重叠子集 |

**没有** beam width、semantic cluster cap、或 per-domain sentence quota（尽管 `allocateDomainBucketSentenceBudget` 计算出 perBucket 却未接入生成）。

---

## Q10 — Owner Matrix

| Concern | Current de-facto owner | Formal Sole Owner? |
|---------|------------------------|--------------------|
| Combination enumeration | **Assembly** `buildSentenceCandidates` | **Yes** |
| Exact-text dedup (path-local) | Assembly | Yes |
| Exact-text dedup (global) | CrossPath | Yes（merge only） |
| Sentence / near-dup diversity | **Nobody** | **No** |
| Domain semantic path diversity | Vote buckets + merge order | Partial / not Assembly goal |
| Final ranking | KenLM（out of scope） | N/A |

**Candidate Diversity 目前没有 ONE Sole Owner。**  
枚举 Owner 明确是 Assembly；**多样性策略未冻结**。

---

## Q11 — Current Weakness（仅 Assembly）

1. **Replacement diversity ≠ sentence diversity** — 近重复句占满竞争池。
2. **Top16 利用率极低**（全量均值 fill ≈10.5%；无 case 用满 16）。
3. **`allocateDomainBucketSentenceBudget` 死信** — 计算 per-bucket 配额但不使用；每桶仍用全局 16。
4. **无 sentence-similarity / cluster 合同** — exact-text 之外全部保留。
5. **无跨域句级配额** — 不保证多语义路径进入 KenLM 池。
6. **枚举截断不透明** — `maxIntervalEnumNodes` 触发时静默 `capped`，多样性不可预测。

禁止归因到 Tone / Recall / KenLM / LLM（本轮不做）。

---

## Q12 — Can Assembly be frozen?

**否 — 不能在本轮冻结「Combination Enumeration + Diversity」完整合同。**

可冻结的部分：**枚举算法本身**（DFS + overlap + gap fill + exact dedup + score sort + cap）已完全可文档化，且与代码一致。

不可冻结的缺口：

- Candidate Diversity 无 Sole Owner / 无策略
- Per-bucket budget 合同与实现不一致
- Top16 utilization / near-dup 政策未定义

故最终结论：

```text
ASSEMBLY_CONTRACT_INCOMPLETE
```

下一步（本轮不实施）：独立 **Assembly Diversity Contract Audit / Freeze**（定义 Sole Owner、near-dup 策略、是否启用 per-bucket 配额），再谈 `ASSEMBLY_READY_FOR_FREEZE`。

---

## Final Verdict

```text
ASSEMBLY_CONTRACT_INCOMPLETE

Enumeration algorithm is fully inspectable and deterministic,
but Candidate Diversity has no Sole Owner,
per-bucket budget is computed but unused,
and Top16 is chronically under-filled by near-duplicate replacement paths.

Do not freeze Assembly enumeration+diversity as complete.
```
