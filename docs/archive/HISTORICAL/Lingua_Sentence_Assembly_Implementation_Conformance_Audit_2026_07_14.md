<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lingua_Sentence_Assembly_Implementation_Conformance_Audit_2026_07_14.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lingua Sentence Assembly Implementation Conformance Audit

**Date:** 2026-07-14  
**Audit Type:** Read-only · Implementation Conformance · 禁止改代码 / 禁止新设计  
**冻结 SSOT：** [`docs/fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) · [`docs/fw-detector/ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md) · [`docs/fw-detector/freeze/FROZEN.md`](../fw-detector/freeze/FROZEN.md)  
**代码根：** `electron_node/electron-node/main/src/fw-detector/`  
**上游漏斗：** [`Lingua_Recall_Lookup_Funnel_Audit_2026_07_14.md`](./Lingua_Recall_Lookup_Funnel_Audit_2026_07_14.md) · Success Funnel 2026-07-14  
**Evidence Run：** `asr_e2e_20260714_crnn_v3`（200/200）

---

## Final Verdict

# **A**

Implementation **符合**冻结 Sentence Assembly 设计。  
上一轮 Funnel 将 39 + 56 统称为「Ranking」的 **统计口径需要调整**；**不得**据此重开 Assembly 架构。

---

## 0. 冻结流水线（唯一标准）

```text
FW
 ↓
Span
 ↓
Recall
 ↓
所有 Span Candidate 收集
 ↓
一次 Domain Vote
 ↓
保留 Winner Domain + Base Candidate
 ↓
跨 Span 组合 Sentence Candidate
 ↓
KenLM Ranking
 ↓
Final Output
```

代码主链对照（`FROZEN_V1_2.md` §2）：

```text
activeCandidates
  → buildFineSpanCandidatePool
  → voteUtteranceDomainFromPool          # Global Vote（Main）
  → filterDomainCandidatesPerSpan        # Winner Domain + Base（+ fallback@general）
  → selectPerSpanCandidates
  → assembleDomainAwareSpanSets
  → buildSentenceCandidates              # 跨 Span interval DFS
  → KenLM → Apply
```

Shadow（允许存在，**禁止**进 KenLM/Apply）：`Emit → Graph → Beam → shadowBeamSpanSets`。

---

## 1. Assembly Pipeline 审计

### Stage 1 — 统一 Candidate Pool？

**YES**

| 步骤 | 位置 |
|------|------|
| Recall 后 Compatibility 保留全集为 `activeCandidates` | `span-assembly-v4-orchestrator.ts`（`resolveCompatibilityRelations` → `activeCandidates`） |
| 装入统一按 coarseSpan 分组的 pool | `assemble-domain-aware-span-sets.ts` · `buildFineSpanCandidatePool`（约 L49–74） |

说明：Compatibility **不硬删**冲突候选（`hardDropCount=0` 路径）；`isCovered` 子片仍在 pool 中，Filter 阶段跳过 `isCovered`。收集阶段仍是「全部进入 unified pool → 再按 span 分桶」，符合 B01。

---

### Stage 2 — Domain Vote：Global 还是 Per Span？

**Global Vote**

| 链 | 函数 | 位置 |
|----|------|------|
| **Main（生产决策）** | `voteUtteranceDomainFromPool` | `span-assembly-shared/utterance-domain-vote.ts`；由 `runDomainAwareAssembly` L199 调用一次 |
| Shadow（diagnostics only） | `voteUtteranceDomain` | orchestrator 另调，**不**决定 Main `spanSets`（FROZEN H5） |

Filter / Select 在 Vote **之后**按每个 span 分桶，**不是**「每个 Span 单独 Domain Vote」。

---

### Stage 3 — Winner Domain + Base？

**YES — 真正执行 Winner Domain + Base 组合（非保留全部 Domain）。**

| 桶 | 条件 | 代码 |
|----|------|------|
| `sameDomainCandidates` | `domain_term` / `passive_domain_weak` 且 `domainId === winningDomain` | `filterDomainCandidatesPerSpan` L98–99 |
| `baseCandidates` | `graphSource === 'base_term'` | L100–101 |
| `fallbackCandidates` | 仅 `insufficientEvidence` 或 `winningDomain==='general'` | L102–104 |

其后 `selectPerSpanCandidates` 优先级：`sameDomain > base > fallback`（L128–132），截断至 `getPerSpanCandidateLimit`。

**非 Winner 的 domain 候选在非 general 路径下被丢弃** — 符合冻结，而非「多 Domain 并存进 Assembly」。

---

### Stage 4 — Sentence Candidate 如何生成？

**跨 Span 组合（interval path DFS）——不是每个 Span 独立 Top1。**

| 机制 | 位置 |
|------|------|
| `enumerateIntervalPaths` 按 slot（coarse span）递推 | `build-sentence-candidates.ts` L202–254 |
| 槽内 = repairTarget 的非重叠子集；槽间拼接 | L226–246 |
| 缺口用 canonical / gap 填满 | `buildPathFromRepairs` |
| 禁止传 beam spanSets | FROZEN H8；KenLM 路径用 `domainAwareSpanSets` |

不是朴素笛卡尔积 `Span1×Span2×Span3`（含全量候选），但是 **明确的跨 Span 组合**，符合冻结 `buildSentenceCandidates` 合约。

---

### Stage 5 — 剪枝 / 提前停止

| 机制 | 常量 / 位置 | 是否历史遗留 |
|------|-------------|--------------|
| DFS 节点上限 | `V4_LIMITS.maxIntervalEnumNodes = 1024` · L214–217 | **冻结预算**，非遗留失控 |
| 每路径 repair picks 上限 | `maxIntervalRepairPicksPerPath = 16` | 冻结 |
| 重叠拒绝 | `pickOverlapsAny` | 冻结 |
| 句候选硬 cap | `maxSentenceCandidates = 16` · `.slice(0, max)` L295 | 冻结 |
| Per-span Select TopK | `getPerSpanCandidateLimit`：1 span→8 · 2→4 · 3+→**2** | 冻结 Select，**不是** Local Top1-only |
| Shadow Beam | `runCoarseSentenceBeamV4` · `maxSentenceBeam=16` | **允许的 Shadow**；不进 KenLM |

存在提前停止（DFS `capped`），属冻结预算而非未声明的「本地 Beam 主链」。

---

### Stage 6 — 真正保留多少 Sentence Candidate？

| 层 | 典型值（E2E `asr_e2e_20260714_crnn_v3`） | 含义 |
|----|------------------------------------------|------|
| Generated / KenLM 入口 | `combinationCount` 众数 **16**（104/200 cases） | `buildSentenceCandidates` 产出 ≤16；**KenLM `scoreBatch` 对全部 combinations 打分** |
| Diagnostics `topCandidates` | **硬截断 5** | `rerank-fw-sentences.ts` L27–29：`candidates.slice(0, 5)` |
| E2E 存储 `kenlm.candidates` | **164/200 cases 恰好长度为 5** | `run-asr-e2e-quality-validation.mjs`：`trace.sentenceCandidates \|\| kenlm.topCandidates` |

**结论：** 实现侧真正生成并送 KenLM 的可达 **16**；诊断/E2E 漏斗常只 **看见 5**。  
→ 不是「只生成了 5 句」，而是 **Diagnostics Dump 截断**。误判 Assembly Failure 的风险真实存在。

Trace 上限另有 `maxTraceSentenceCandidates=32`（若开 trace，可接近完整 generation）。

---

## 2. TopK 审计 — Recall vs Sentence

| 概念 | 值 | 位置 | 是否同一概念 |
|------|-----|------|--------------|
| Recall window `exactTopK` | **2** | `V4_LIMITS` / recall | **否** |
| Recall `parentFragmentTopK` | **3** | 同上 | **否** |
| Per-span Assembly Select | 8 / 4 / **2** | `per-span-candidate-limit.ts` | **否**（装配前置） |
| Sentence `maxSentenceCandidates` | **16** | fw-config / freeze test | **否** |
| Diagnostics `topCandidates` | **5** | `rerank-fw-sentences.ts` | **否**（观测窗口） |

上一轮 Funnel「Ranking」混用了 **Recall 窗 TopK**、**Sentence 生成 Top16**、**诊断 Top5** —— 三者必须拆开。

---

## 3. Ranking 审计 — 39 / 56 真正落在哪一层？

上一轮定义（Recall Lookup Funnel）：

| 桶 | n | 粗标签曾用 |
|----|--:|------------|
| repair-grade 词 **从未**出现在存储句候选文本 | 39 | Ranking |
| 词 **已在**存储候选文本，但 Stage2 keyword\|exact sentence 仍失败 | 56 | Ranking |

成功 Funnel Stage2 定义：`fixture keyword ∈ cand` **或** `exact expected sentence ∈ cand`。

### 3.1 对 39（term never in stored cand）

| 可能真层 | 是否可能 | 说明 |
|----------|:--------:|------|
| Recall | **是** | 窗召回未出词 / exactTopK 截断 / 拼音未命中（例 d001 少糖） |
| Domain Filter / Select | **是** | 非 Winner domain 丢弃；per-span limit=2 截断 |
| Assembly DFS | **是** | 该 repair 未进入任一 interval path |
| Diagnostics | **是** | 词在第 6–16 句，但 E2E 只读 Top5 dump |
| KenLM | **否（选句）** | KenLM 对已生成句打分；不会「开除」未生成的词形。若只看 Top5 dump 会 **伪造成** Assembly/Recall miss |

**不得**将 39 全部记为 Assembly Failure。在 Diagnostics 截断未清洗前，39 是 **混合桶**（Recall ∪ Select ∪ Assembly ∪ Dump）。

### 3.2 对 56（term in cand, Stage2 still fail）

| 可能真层 | 是否可能 | 说明 |
|----------|:--------:|------|
| Assembly Failure | **弱** | 目标 domain 词已出现在某句候选文本 → 词级组装路径 **已成功至少一次** |
| Expected Sentence / Funnel 口径 | **强** | Stage2 要求 **整句 exact** 或 **fixture keyword**；150/200 cases `domainKeywords` 为空 → 只能靠 exact sentence |
| KenLM | **否** | Stage2 看的是 candidate **集合**是否含 expected，不是 Final pick |
| Diagnostics | 次要 | 本桶已在可见 cand 中找到 term |

**56 的主因是 Success / Stage2 统计口径（Exact Sentence ± fixture keyword），不是「Assembly 没把正确词编进任何候选」。**

---

## 4. Expected Sentence 成功定义

| 度量 | 定义 | 影响 |
|------|------|------|
| Stage2 Recall Hit（Success Funnel） | keyword **或** exact expected sentence ∈ 存储 cand | 无 keyword 时等同 **整句 exact** |
| Final Correct | `exactMatch`（normalized final == expected） | FW 其它错误字也会导致失败 |
| 「Target Domain Term Correct」 | **不是** Stage2 主定义 | Funnel 会把「词对、句未全对」算 Recall/Assembly 失败 |

若 expected 含 FW 其它错误区，即便 Domain Term 正确装配，仍记 **Sentence / Stage2 Failure** —— **会抬高 Assembly 表象失败率**。这是口径问题，不是实现偏离冻结流水线。

---

## 5. Diagnostics 完整性

| 项 | 完整？ |
|----|:------:|
| KenLM 对全部 ≤16 combinations 打分 | **YES** |
| `combinationCount` 反映生成规模 | **YES**（常为 16） |
| `topCandidates` / E2E `candidates` 默认完整 dump | **NO** → **截断为 5** |
| Trace `sentenceCandidates`（若启用） | 上限 32，可接近完整 |

**必须指出：Diagnostics / E2E 观测窗被截断。** 用 Top5 文本集判断「Assembly 从未生成某句」会系统误判。

---

## 6. 历史遗留清单

| 组件 | 仍执行？ | 进 KenLM / Apply？ | 判定 |
|------|:--------:|:------------------:|------|
| `runCoarseSentenceBeamV4` · Shadow Beam | **YES** | **NO** | 冻结允许的 Shadow（H7） |
| Graph / `assembleCoarsePaths` / Shadow Vote | **YES** | **NO** | Shadow |
| `candidate-sentence-builder`（单 span 展示句） | YES（diags） | NO | 非组句主链 |
| Legacy `legacy/fw-detector` TopK pipeline | `pipelinePath:'v4'` 时不走 | — | 非现役主链 |
| Context Prior / `domain-rerank` 改分 | 代码存在，**assemble 未接线**；v4-path 硬编码 `applied:false` | NO | 文档漂移；不影响本轮流水线符合性 |
| Assembly Tone Guard | 文件已删除 | — | 已退役 |

**不存在**「主链 Legacy Beam 组句」。存在 **Shadow Beam 仍执行仅 diagnostics**。

---

## 7. Frozen Design vs Current Implementation

| Frozen Design | Current | PASS/FAIL |
|---------------|---------|:---------:|
| Global Domain Vote | `voteUtteranceDomainFromPool` 一次 utterance 投票 | **PASS** |
| Winner Domain + Base | Filter 三桶 + Select `sameDomain>base>fallback`；非 Winner domain 丢弃 | **PASS** |
| Cross Span Assembly | `buildSentenceCandidates` / `enumerateIntervalPaths` 跨 slot | **PASS** |
| Single Assembly Stage（Main） | Main `spanSets` 唯一来自 `assembleDomainAwareSpanSets`（H1/H6） | **PASS** |
| KenLM After Assembly | `runFwSentenceRerankFromPrefilled` ← `buildSentenceCandidates` | **PASS** |
| No Legacy Beam（主链） | Beam 仅 `shadowBeamSpanSets`；禁止作 KenLM 输入（H7/H8） | **PASS** |
| No Local Top1 Assembly | Select 每 span limit ≥2（多 span 时 =2），非「每 span 只取 Top1 拼句」 | **PASS** |

旁注（不改变上表 PASS）：Diagnostics Top5 截断 · Shadow Beam 仍跑 · `buildSentenceCandidates` 调用两次（orchestrator 诊断 + KenLM 正式）——均未改冻结主链语义。

---

## 8. 最终回答（七问）

1. **当前 Sentence Assembly 是否符合冻结设计？** → **YES（Main Chain）。**  
2. **若不符合，偏离哪几处？** → 主链无强制 FAIL。观测层：`topCandidates` 截断 5；Shadow Beam 仍执行（冻结允许）。  
3. **39 Case 是否真正 Assembly Failure？** → **不能全部算。** 混合 Recall / Domain Select / Assembly / Diagnostics Top5。  
4. **56 Case 是否真正 Assembly Failure？** → **多数否。** 主因是 **Expected Sentence / fixture keyword 口径**；词已在 cand。  
5. **Diagnostics 是否完整？** → **生成完整（≤16 进 KenLM）；Dump 不完整（默认 Top5）。**  
6. **是否存在 Legacy Beam 或提前剪枝？** → Shadow Beam **存在且执行但不进主链**；DFS/ per-span / maxSentence=16 **有冻结剪枝**。  
7. **是否需要重新设计 Sentence Assembly？** → **NO**

---

## 9. Final Verdict（唯一）

## A

**Implementation 完全符合冻结设计。**  
当前 Funnel（Success / Recall Lookup）把 39+56 并进「Ranking」、并用 **≤5 dump / exact sentence** 代理 Assembly 成败 —— **统计口径需要调整**。  

下一步若动刀：优先校正观测与漏斗分层（Recall vs Select vs Assembly vs Dump vs Exact-Sentence），**不是**新 Candidate Builder / 新 Beam / 新 DFS 架构。
