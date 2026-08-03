<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Pre_KenLM_Candidate_Ownership_Residual_Logic_Audit_2026_07_30.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Pre-KenLM Candidate Ownership Residual Logic Audit

**Date:** 2026-07-30  
**Nature:** CODE AUDIT / OWNERSHIP AUDIT / TRACE AUDIT（只读）  
**Probe:** `docs/tone-v2/_audit_scratch/pre-kenlm-candidate-ownership-audit-probe.mjs`  
**Trace:** `docs/tone-v2/_audit_scratch/pre_kenlm_candidate_ownership_audit/ownership_trace.json`  
**Cases:** B01 `请确认地址和医院` · C01 `请确认地址、医院和医师` · A01 `请确认地址`

---

## 1. Executive Summary

生产链路上，**进入 `buildSentenceCandidates` 之前，每个 SameDomain Bucket 的 Assembly Grid 已经是每 Span 恰好 1 个表面**。Assembly / CrossPath / KenLM **没有组合空间**，KenLM 恒为 1 个输入是结果而非原因。

B01/C01/A01 真实 Trace 显示：

1. Recall / LexicalEdge **保留了多个不同表面**（例如 Span「地址」：`低脂`/`地质`；Span「医院」：`医院`/`议员`）。
2. 这些候选的 `hitKind` **全部是 `parent_fragment`**（`termId` 形如 `ngram:*`）。
3. `filterDomainCandidatesPerSpan` 调用 `windowCandidateToDomainAwarePick`：**仅接受 `hitKind === 'exact_term'`** → 全部返回 `null` → 桶内 afterFilter = 0。
4. `selectPerSpanCandidates` 在空列表时 **canonical fill** 注入 ASR 原文（`candidateId: canonical:<spanId>`）→ afterSelect = 1（原文）。
5. Assembly 收到已坍塌 Grid → 理论组合数 = 1 → KenLM prefilled = 1。

**真正写入「每个 FineSpan 最终 `selectedCandidates`」的 Owner 是 `selectPerSpanCandidates`。**  
本轮多表面首次删除层是其上游的 **`windowCandidateToDomainAwarePick`（exact_term 门闩）**。

### Final Verdict

```text
ASSEMBLY_INPUT_ALREADY_COLLAPSED
```

一句话：

```text
真正拥有每个 FineSpan 最终候选选择权的是 selectPerSpanCandidates（写入 selectedCandidates）；本轮多表面在进入 Select 前已被 windowCandidateToDomainAwarePick 的 exact_term 门闩清空，再由 canonical fill 填回单一 ASR 表面。
```

---

## 2. Candidate Lifecycle

### 2.1 Diagram（B01 真实 Trace）

```text
Recall
5 候选 / 4 不同表面
（含 低脂·地质·医院·议员；hitKind 全为 parent_fragment）

↓  buildLexicalEdges（identity first-wins，不按 surface 删）

Edge
2 lexical edges / 5 候选合计
（3:5 → 低脂,地质；6:8 → 医院,议员,医院）

↓  Path materialize（PathFineSpan.candidates = Edge.candidates）

PathFineSpan / activeCandidates
未覆盖表面仍为多表面（地址槽：低脂+地质；医院槽：医院+议员）

↓  Vote（parent_fragment 可计票）

Vote
不删 per-span 候选；retainedDomains = coffee, medical, meeting, tourism_route

↓  filterDomainCandidatesPerSpan + windowCandidateToDomainAwarePick

Bucket Filter（每个 retained domain）
同域多表面 → 0
原因：hitKind!==exact_term → pick=null（首次删除层）

↓  selectPerSpanCandidates

Select
0 → canonical fill → 每 Span 1（ASR 原文）
Owner：selectPerSpanCandidates

↓  assembleDomainAwareSpanSets → buildSentenceCandidates

Assembly Grid
每槽 1 表面；theo=1；无组合空间

↓  mergeCrossPathSentenceCandidates

CrossPath / Prefilled
多桶生成相同原文 → text dedup → 1

↓  KenLM

KenLM Input
1（因 prefilled≤1 跳过真实排序也无意义）
```

### 2.2 每层 Owner / 输入输出（B01）

| 层 | 输入 | 输出 | 删除 | 删除原因 | Owner |
|----|------|------|------|----------|-------|
| Recall | windows | 5 cands / 4 surfaces | minPrior 等（本例保留多表面） | Recall TopK / prior | `recallTopKForWindows` |
| LexicalEdge | per-window cands | 2 edges / 5 kept | 同 termId 后到者 | identity first-wins | `buildLexicalEdges` |
| PathFineSpan | edges | 同 edge candidates + fallback 空槽 | 未选入 Path 的 window | Path enum | `materializePathFineSpans` |
| Compatibility | path cands | active；本例无关键 covered 删表面 | isCovered | `resolveCompatibilityRelations` | |
| Vote | FineSpan pool | retainedDomains；**不改候选列表** | 无 per-span winner | Presence 计票 | `voteUtteranceDomainFromPool` |
| Bucket Filter | pool + bucketDomain | sameDomain/base/fallback | **全部 parent_fragment** | `hitKind !== 'exact_term'` | `filterDomainCandidatesPerSpan` → `windowCandidateToDomainAwarePick` |
| Select | filtered lists | `selectedCandidates` | 空→填 1；非空则 `slice(0, perSpanLimit)` | canonical / P4 cap | **`selectPerSpanCandidates`** |
| Assembly | spanSets grid | sentences | 本例无组合 | grid 已 1/槽 | `buildSentenceCandidates` |
| CrossPath | 各桶句 | ≤16 | 同 text first-wins | dedup+cap | `mergeCrossPathSentenceCandidates` |
| KenLM | prefilled | rank | 本例未进入多句 | 输入已 1 | KenLM（非 Owner） |

代码位置：

- `windowCandidateToDomainAwarePick`：`window-candidate-to-pick.ts` L10–12  
- `filterDomainCandidatesPerSpan`：`assemble-domain-aware-span-sets.ts` L155–162  
- `selectPerSpanCandidates`：同文件 L187–224（`ordered.slice(0, perSpanLimit)` L210；canonical L211–220）  
- `runDomainAwareAssembly`：同文件 L293–359  
- Orchestrator 消费：`span-assembly-v4-orchestrator.ts` L322–349  

---

## 3. Candidate Ownership

| 角色 | 是否 Owner？ | 说明 |
|------|--------------|------|
| Recall | 否 | 产出多候选；本例未坍塌到 1 |
| Edge | 否 | 保留多候选 |
| FineSpan | 否 | 继承 Edge 候选列表 |
| Vote | 否 | 只产 retainedDomains；**禁止 per-span Top1**（Runtime SSOT §9） |
| SameDomain Bucket / filter | **删除权（合法性门闩）** | 本例用 exact_term 门闩清空桶 |
| **`selectPerSpanCandidates`** | **是（最终 per-span 选择权）** | 唯一写入 `selectedCandidates`；Assembly 只读该字段 |
| Assembly | 否 | 只组合已选 Grid |
| CrossPath | 否 | 句级 dedup/cap |
| KenLM | 否 | 句级排序 |

冻结原则对照：

```text
Per-Span 不决定 winner     → 实现违背：selectPerSpanCandidates 决定 selectedCandidates
Sentence Candidate 决定句  → Assembly 在 grid=1 时无法行使
KenLM 最终排序             → 输入恒 1，无法行使
```

---

## 4. FineSpan Candidate Audit

### B01 · Span「地址」（raw 对应 ASR「地址」）

```text
FineSpan / Pool (uncovered)
低脂 (domain_term, coffee, parent_fragment, ngram:413)
地质 (domain_term, tourism_route, parent_fragment, ngram:1430)

↓ Vote
仍保留上述候选（Vote 不删）

↓ Bucket Filter（任意 retained domain，含 coffee）
afterFilter = []
Reason:
  低脂 → windowCandidateToDomainAwarePick_null (hitKind=parent_fragment)
  地质 → window

↓ Select
afterSelect = [地址]
Reason: selected.length===0 → domainAwarePickFromPathFineSpan → canonical:fine:…
canonicalFill = true

↓ Assembly
Grid 槽 = [地址]
```

### B01 · Span「医院」

```text
Before: 医院, 议员（及重复 医院；皆 parent_fragment）
↓ Filter: 全部 null
↓ Select: canonical → [医院]
```

### Fallback 单字槽（请/确/认/和）

```text
Before: []（fallback edge 无 lexicon 候选）
↓ Select: canonical → 原文单字
```

---

## 5. Vote Audit

| 问题 | 结论 |
|------|------|
| 是否删除 Candidate？ | **否**（不改 pool） |
| 是否决定 per-span winner？ | **否** |
| B01 retainedDomains | `coffee, medical, meeting, tourism_route`（各 score=1，并列 max） |
| 计票来源 | **parent_fragment 可计票**（`utterance-domain-vote.ts`） |

→ Vote 符合冻结「Presence Vote / 不决定 Winner」。  
→ 但 Vote 消费的 parent_fragment **无法进入 Assembly pick**，造成「能投票、不能组句」语义缝（此前 Mainchain Audit 已标 MODIFY）。

---

## 6. SameDomain Bucket Audit

冻结：`same-domain candidates: domains.includes(bucketDomain) plus Base`。

| 问题 | 结论 |
|------|------|
| 是否实现同域保留？ | 代码路径有（`isSameDomainCandidate`） |
| 本 Trace 是否保留同域多表面？ | **否** — 因 pick 在分类前已 null |
| coffee 桶 · 地址 · 低脂 | domains 含 coffee，**本应** KEEP_sameDomain；实际因 parent_fragment 被拒 |
| medical 桶 · 医院 | 同理本应保留；实际被拒后 canonical「医院」 |

**不是**「桶内按 score Top1」删掉奶铁类同域表面；而是 **桶过滤入口门闩清空后，Select 用 ASR 回填**。

先前 acceptance 把 `firstCollapseLayer=BUCKET` 标在 `bucketSpanSets`（已含 Select）上，精确分层应为：

```text
FILTER(exact_term gate) → SELECT(canonical fill) → ASSEMBLY_INPUT_ALREADY_COLLAPSED
```

---

## 7. PerSpan Select Audit

函数：`selectPerSpanCandidates`（`assemble-domain-aware-span-sets.ts` L187–224）

| 检查项 | 结果 |
|--------|------|
| 是否删除 Candidate？ | **是**（cap + 空则替换） |
| 为什么删除？ | `getPerSpanCandidateLimit`：≤1→8，2→6，≥3→4；`ordered.slice(0, perSpanLimit)` |
| 是否排序？ | **是** `stableSortPicks`（score desc, candidateId） |
| 是否 Top1？ | **不是硬编码 Top1**；limit∈{4,6,8} |
| 是否 `slice(0,1)`？ | **否**（slice(0, perSpanLimit)） |
| 是否 `find()` winner？ | **否** |
| 空列表行为 | **canonical ASR fill（等价强制 1 个 winner）** |
| 本 Trace 坍塌到 1 的原因 | **afterFilter 已 0 → canonical**；不是 slice 砍到 1 |

### 历史残留

- `getPerSpanCandidateLimit`：commit `9488f5f`（2026-06-01，`lexicon v2 p4 finish`）引入；注释写明 **「P4 frozen per-span candidate limit」**；当时 span≥3 曾为 **2**（现为 4）。
- `windowCandidateToDomainAwarePick` exact_term 门闩：commit `de2838e`（2026-06-17，`freeze recall finish`）引入，延续至 Lattice 基线。
- 名称/职责上，这是 **P4/旧 Assembly 时代的 per-span 预算与 pick 门闩**，不是 Lattice 冻结文档里的「Sentence Candidate 才决定最终候选」。

→ **Residual Logic：YES**（P4 per-span cap + exact_term-only pick + canonical winner fill）。

---

## 8. Assembly Input Audit

进入 `buildSentenceCandidates` 前的 Grid（B01 任一桶）：

```text
Span1 请
Span2 确
Span3 认
Span4 地址
Span5 和
Span6 医院
```

C01 同理每槽 1 个。

```text
→ Assembly 无需继续深挖组合失败原因：根本没有组合空间。
```

---

## 9. Assembly Combination Audit

仅在 Grid 多候选时才审计。本轮 Grid 全 1 → **终止组合审计**。

静态代码结论（供对照）：

| 检查项 | `buildSentenceCandidates` |
|--------|---------------------------|
| 组合还是取第一？ | **区间路径枚举组合**（`enumerateIntervalPaths`） |
| `slice(0,1)` | 无 per-span；仅最终 `slice(0, maxSentenceCandidates)` |
| winner/find/best | 无 per-span winner；`find` 仅用于 canonical 查找等辅助 |

Orchestrator：`buildSentenceCandidates(rawText, bucketSets, kenlmCap)` — 消费的是 **已 Select 的 grid**。

---

## 10. Candidate Removal Timeline

| # | 时刻 | 函数 | 行号要点 | 删什么 | 依据 | 符合冻结？ |
|---|------|------|----------|--------|------|------------|
| 1 | Edge merge | `buildEdgeCandidatesAndEvidence` | `build-lexical-edges.ts` L82–89 | 同 identity 后到 | termId/candidateId | YES（Edge SSOT） |
| 2 | Covered | `resolveCompatibilityRelations` | compatibility graph | covered 子候选 | isCovered | YES（本例非主因） |
| **3** | **Bucket pick** | **`windowCandidateToDomainAwarePick`** | **L10–12** | **全部 parent_fragment** | **仅 exact_term** | **偏离「同域合法候选继续保留」；属历史门闩残留** |
| 4 | Bucket domain | `filterDomainCandidatesPerSpan` | L164–170 | 跨桶 domain_term | 非 bucketDomain 且非 base | YES（桶语义）；本例未执行到（已 null） |
| 5 | Select cap | `selectPerSpanCandidates` | L210 | 超出 perSpanLimit | P4 limit | 部分偏离（per-span 预算先于句级） |
| **6** | **Select fill** | **`selectPerSpanCandidates`** | **L211–220** | **空→强制 1 ASR** | **canonical** | **偏离「Per-Span 不决定 winner」** |
| 7 | CrossPath | `mergeCrossPathSentenceCandidates` | slice(0,cap) | 同文去重 | 冻结 ≤16 | YES |
| 8 | KenLM | — | — | 无（输入已 1） | — | N/A |

**首次导致「多表面→每槽 0→每槽 1」的删除层 = #3；最终把 0 写成唯一表面的 Owner = #6。**

---

## 11. Residual Logic Audit

| 项 | 判定 |
|----|------|
| `selectPerSpanCandidates` 是否旧 Beam Winner 遗留？ | **是残留族**：P4 per-span cap + score 排序截断 + canonical 单槽回填；**不是**字面 `slice(0,1)` Beam winner，但 **行使了 per-span 最终选择权** |
| exact_term-only pick | **残留 / 未随 Lattice 语义缝闭合**；Mainchain Audit（2026-07-29）已记 MODIFY |
| parent_fragment 可投票不可组句 | **已知语义缝**；本轮 Trace 证明它直接导致 Pre-KenLM 池坍塌 |
| Lattice Edge 多候选 | **KEEP**；未在 Edge 层坍塌 |

---

## 12. Frozen Architecture Compliance

| 冻结项 | YES/NO | 证据 |
|--------|--------|------|
| Recall 保留全部合法候选 | **YES*** | *在 TopK/prior 内；B01 多表面在 | 
| FineSpan 保留全部候选 | **YES** | PathFineSpan 继承 Edge 多表面 |
| Vote 不决定 Winner | **YES** | 只出 retainedDomains |
| Bucket 保留同域候选 | **NO** | exact_term 门闩清空同域 parent_fragment（含本应同域的「低脂」） |
| Assembly 才负责组合 | **NO（被架空）** | 输入 Grid 已 1/槽 |
| KenLM 才负责最终排序 | **NO（被架空）** | prefilled=1 |

偏离位置：

1. `window-candidate-to-pick.ts` L10–12（首次）  
2. `assemble-domain-aware-span-sets.ts` L211–220 canonical fill（写出唯一 selected）  
3. `selectPerSpanCandidates` L208–210 P4 per-span cap（次要；本 Trace 非坍塌主因）

---

## 13. KEEP / MODIFY / DELETE / RESTORE

### KEEP

```text
Recall（多表面产出）
LexicalEdge（多候选保序）
PathFineSpan materialize
Vote Presence（不写 per-span winner）
buildSentenceCandidates（区间组合机制）
mergeCrossPathSentenceCandidates（句级 dedup≤16）
KenLM 边界（只排序完整句）
```

### MODIFY

```text
windowCandidateToDomainAwarePick
  — 明确 parent_fragment / exact_term 与组句合法性契约
  — 或：同域可组句表面不得因 hitKind=parent_fragment 被静默丢弃后靠 ASR 回填假「保留」

filterDomainCandidatesPerSpan
  — 与 Vote 可计票集合对齐（避免「能投票不能组句」）

selectPerSpanCandidates
  — 与冻结「Per-Span 不决定 winner」对齐：不得在空桶时用 canonical 伪装成唯一同域候选而不留 Trace 缺口
```

### DELETE（概念上；本轮不改代码）

```text
Per-Span Winner Selection 语义
  — 即：把 selectedCandidates 当作「句前最终胜者」的职责
P4 风格「先 per-span 截断再组句」若与「同域多候选进 Assembly」冲突的部分
```

### RESTORE

```text
SameDomain Multi-Candidate Bucket
  — 桶内应能看到同域多表面（在合法组句定义下）

Sentence Candidate Generation 空间
  — Assembly Grid 每槽可 >1，使 ≤16 句池与 KenLM 排序有输入
```

---

## 14. Final Verdict

```text
ASSEMBLY_INPUT_ALREADY_COLLAPSED
```

**真正拥有 Candidate 最终选择权的是谁？**

```text
selectPerSpanCandidates
```

（上游首次清空多表面的是 `windowCandidateToDomainAwarePick` 的 `exact_term` 门闩；Assembly / KenLM 不是 Owner。）

### 为何不是其他判定

| 判定 | 为何不选为主判定 |
|------|------------------|
| `FROZEN_ARCHITECTURE_COMPLIANT` | Bucket/Assembly/KenLM 职责被架空 |
| `RESIDUAL_WINNER_SELECTION_DETECTED` | **伴随成立**（P4 select + canonical），但是坍塌的**写出层**；首次删除是 exact_term 门闩 |
| `BUCKET_IMPLEMENTATION_MISMATCH` | 同域过滤公式本身存在，但被 pick 门闩短路；可作次要标签 |

### Target List

| ID | 状态 |
|----|------|
| T1 Candidate 生命周期 | Done |
| T2 首次删除层 | Done → `windowCandidateToDomainAwarePick` |
| T3 真正 Owner | Done → `selectPerSpanCandidates` |
| T4 全部 Filter | Done |
| T5 Bucket 是否提前 Winner | Done → 本例否；清空后 Select 填 Winner |
| T6 Assembly Grid | Done → 已坍塌 |
| T7 Assembly 组合 | N/A（grid=1） |
| T8 slice(0,1) | Done → 无硬编码；有 slice(0,limit) + canonical=1 |
| T9 find/winner | Done → Select 无 find winner；canonical 回填 |
| T10 Git 残留 | Done → P4 limit / 2026-06-17 exact_term pick |
| T11 冻结符合性 | Done |
| T12 Residual Logic | Done → YES |

### Check List

* [x] 未修改任何生产代码 / 词库 / 配置 / 阈值 / 测试集  
* [x] Candidate 生命周期完整  
* [x] 每层输入输出数量（B01/C01/A01 Trace）  
* [x] 每层删除原因  
* [x] 每层 Owner  
* [x] Bucket Trace  
* [x] Assembly Grid  
* [x] Winner Selection Trace（canonicalFill）  
* [x] slice/find/top1 检查  
* [x] Git 残留检查  
* [x] 冻结设计符合性  
* [x] KEEP / MODIFY / DELETE / RESTORE  

### Artifacts

| 文件 | 用途 |
|------|------|
| `docs/tone-v2/_audit_scratch/pre-kenlm-candidate-ownership-audit-probe.mjs` | 只读 Probe |
| `docs/tone-v2/_audit_scratch/pre_kenlm_candidate_ownership_audit/ownership_trace.json` | 真实 Trace |

---

*本轮禁止开发修复。下一轮若开工，应先闭合 Vote↔Assembly 对 `parent_fragment` 的合法性契约，再讨论是否削弱/删除 per-span Select 的 winner 语义。*
