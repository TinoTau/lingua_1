<!-- Documentation Hierarchy Metadata
Status: **RETIRED**
Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0
Archive Path: docs/archive/RETIRED/FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md
-->

> **RETIRED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0

﻿> **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** (Step 6, 2026-07-30). SoftBoundary LTR Fine Span is deleted from runtime; see Runtime SSOT V1.2 + Lattice Architecture V1.0.0.
# FW Repair V4 — LTR Production vs Multi-Path Lattice Necessity Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-29 |
| Nature | **开发前只读审计**（未改生产代码 / 配置 / 词库 / 测试数据） |
| Evidence | 生产源码 + dialog_200 GT 真链探针 + 既有 Phase2 Lattice harness |
| Probe | `_audit_scratch/ltr_vs_lattice_necessity_probe_2026_07_29.mjs` → `ltr_vs_lattice_necessity_2026_07_29.json` |
| Cases probed | **22** dialog_200（≥20）：d001,d007,d015,d022,d031,d041,d049,d055,d061,d067,d073,d079,d085,d091,d097,d103,d109,d115,d132,d150,d168,d186 |
| Verdict | **LTR_SUFFICIENT** |

---

## 1. Executive Summary

**当前生产 Fine Span = LTR（`runLtrFineSpanGeneration`）。**  
在 22 条 dialog_200 + 真实 SQLite lexicon 回放中：

| Metric | Value |
|--------|------:|
| LTR steps | 304 |
| Options generated | 1094 |
| Options recalled | 697 |
| Recall hits（exact+fragment） | 72 |
| Hits committed into FormalSpan | 68 |
| Hits permanently dropped after Commit | **4** |
| **exact_term permanently dropped** | **0** |
| Cases with any permanent drop | **2 / 22**（d001, d109） |
| Cases with longer **exact** permanently dropped | **0 / 22** |

两条永久丢弃均为 **跨界 `parent_fragment` 因 commit 规则 `ineligible`**，随后 cursor+1 仍在界内收回相关片段（d001「马芬」、d109「计划」）。**不是**「短 exact 抢先 Commit 导致正确 exact 永不可达」。

既有 Lattice Phase2 harness（dialog_200 × 200，真实 SQLite）：

```text
utterancesWithNoLexicalCompletePathCount = 200 / 200
zeroLexicalOnlyCompletePaths = 200
```

**在 dialog_200 上，Lattice 当前并未证明能新增可交付的完整词路径质量收益。**

结论：不得以架构文档存在为由强制迁移。  
**LTR 可作长期生产 Fine Span 方案冻结**；主链质量瓶颈不在 LTR→Lattice，而在既有审计指出的 Assembly / KenLM 选句等下游（本轮不开发）。

```text
LTR_SUFFICIENT
```

---

## 2. Current LTR Production

### 2.1 生产入口（真实调用链）

```text
runFwDetectorOrchestrator
→ runFwDetectorV4Path
→ runSpanAssemblyV4Orchestrator
→ runLtrFineSpanGeneration          ← PRODUCTION Fine Span SSOT（代码）
    generateLocalOptionsAtCursor    ← 每 cursor 临时 Window
    recallForWindows (injected)     ← recallTopKForWindows → SQLite
    commitBestFormalFineSpan        ← 唯一 Commit
→ allCandidates = formalSpans.flatMap(s => s.candidates)
→ vote / SameDomain / Assembly / KenLM
```

源码：`ltr-fine-span-generator.ts` 文件头与 `span-assembly-v4-orchestrator.ts` L189–L308。

### 2.2 Cursor → Local Windows → Recall → Commit → Next Cursor

```text
cursor = 0
while cursor < n:
  Local Windows = lengths 2..min(5, n-cursor) anchored at cursor
  (+ commit 时强制 1-syllable fallback marker)
  Recall = non-blocked windows → SQLite
  Commit = exactly one FormalFineSpan starting at cursor
  cursor = formalSpan.syllableEnd   // 不可回退
```

| # | 问题 | 答案（代码） |
|---|------|--------------|
| 1 | Cursor 如何移动？ | 严格 LTR；每次前进到 `committed.syllableEnd`（≥1） |
| 2 | 一个 Cursor 几个 Window？ | 最多 **4**（len 2..5）+ Commit 内 **1** fallback |
| 3 | 何时 Commit？ | 每 cursor 一步必 Commit 恰好一个 FormalFineSpan |
| 4 | Commit 后能回退吗？ | **否**（无 backtrack / Beam / DP） |
| 5 | 哪些 Window 永久放弃？ | 同 cursor 未胜出的 option；其 candidates **不**进入 `formalSpans.flatMap` |

---

## 3. Commit Strategy

决策序（`compareOptions`）：**K1 词完整度 > K2 边界类 > K3 prior 平局 > K4 更短优先 > K5 稳定键**。

| 规则 | 代码事实 |
|------|----------|
| 跨界 option | 仅 `complete_single_term` 可胜；`parent_fragment` + cross≥1 → `ineligible` |
| 无命中 | 强制 1-syl fallback，`candidates=[]`，`windowSource='fallback'` |
| 短词优先 | 同 K1/K2 时 K4 选更短（`shorter_exact_tiebreak`）— 历史性能审计标为 **KEEP** |
| 下游候选池 | **仅** committed FormalSpan.candidates（orchestrator L308） |

---

## 4. Window Coverage（真实 Trace）

### 4.1 Case d001（cafe GT）

文本：`你好，我想点一杯热拿铁，中杯，少糖。…蓝莓马芬吗？`

| Cursor | Options（节选） | Recall | Commit |
|-------:|-----------------|--------|--------|
| 8 | `拿铁` hit=3；含标点更长窗 blocked | 进入 Recall | **拿铁**（hits 保留） |
| 10 | `中杯` | 进入 | **中杯** |
| 23 | `莓马` hit=1，`莓马芬` hit=1（cross=1） | 进入 Recall | **莓** 1-syl fallback；跨界 fragment **ineligible** → drop |
| 24 | `马芬` | 进入 | **马芬**（bakery/food_order 仍进入 Vote） |

→ 重叠窗会生成；blocked / ineligible 的不进 Commit；**后续 cursor 可收回界内片段**。

### 4.2 Case d007（机场高速）

| Cursor | Options | 进入 Recall？ | Commit |
|-------:|---------|---------------|--------|
| 10 | `机场` hit=3 | **是** | **机场** |
| 10 | `机场高` hit=0 | 是（无命中） | 未胜出 |
| 10 | `机场高速` | **blocked**（filter/punct/cross） | 未 Recall 命中 |
| 9 | `走机场高速` | **blocked**（cross=2） | 放弃 |

→ 「机场高速」作为整词窗在本 Case **未形成可 Commit 命中**；生产保留「机场」短窗。这与既有 LTR 性能审计「机场+高速拆分 = KEEP」一致，**不是本轮新发现的质量事故**。

### 4.3 「订单 / 已经 / 提交」类重叠

探针在含相关字样的窗上记录 `overlapTrace`：生成 2..5 锚定窗 → `blockedFilter` 后仅非 blocked 进 Recall → Commit 只留一窗。  
**真正进 Vote 的只有 committed FormalSpan 上的 hits。**

---

## 5. Candidate Loss Analysis（Part B — 审计重点）

### 5.1 机制（代码级，真实）

```text
同 cursor 多窗 Recall
→ commit 唯一 FormalSpan
→ orchestrator: allCandidates = formalSpans.flatMap(s => s.candidates)
→ 未胜出窗的 hits 不进入 Vote/Assembly
→ cursor 前进后，起点已越过的窗无法再生
```

因此「过早 Commit → 候选永久不可用」在机制上**可能**发生。

### 5.2 dialog_200 实证（22 Case）

| 断言 | 结果 |
|------|------|
| 是否找到 ≥1 个 **exact_term** 因提前 Commit 永久消失？ | **否 → exactHitsPermanentlyDropped = 0** |
| 是否有 Case 因提前 Commit 导致后续 Recall「根本没有机会」碰到同 range exact？ | **NO EVIDENCE** |
| 实际永久 drop | 4 条，全为 **parent_fragment**，集中在 **2** Case |

**d001 丢弃：** `莓马` / `莓马芬`（parent_fragment, cross=1 → commit ineligible）  
**随后：** cursor=24 Commit `马芬`（同领域 bakery/food_order）  
**d109 丢弃：** `线计` / `线计划`（同上）  
**随后：** Commit `计化`→候选「计划」（tech_ai）

### 5.3 判定语句

```text
NO EVIDENCE that early LTR Commit permanently eliminates correct exact_term
candidates on the 22 dialog_200 cases audited with real SQLite Recall.
```

不得将「机制上可能丢失」写成「dialog_200 已被 LTR 拖成质量瓶颈」。

---

## 6. Recall Sufficiency

| 观察 | 证据 |
|------|------|
| 22 Case 中 16 Case 有 ≥1 Recall hit | `casesWithAnyRecallHit=16` |
| Hit→Commit 比率 | 68/72 ≈ **94.4%** 进入 FormalSpan |
| 未进 Commit 的 4 hit | 跨界 fragment 策略性拒绝，非整句 Recall 失败 |
| Vote 空域 Case | 部分 Case（如 d085/d115/d132）**Recall hit=0** — 属词表/文本匹配问题，**非** LTR 提前截断已命中 exact |

**区分：**

- Recall 已找到正确词，但 Vote/Assembly/KenLM 未采用 → **下游问题**（非本轮「必须 Lattice」证据）  
- LTR 使正确 exact 从未进入池 → **本 22 Case 无 exact 实证**

LTR 导致「Recall 不完整」的实证：**不足**；主要缺口是词表命中率与 blocked 窗，不是多路径缺失。

---

## 7. Vote Dependency

| 问题 | 答案 |
|------|------|
| Vote 依赖唯一 FormalSpan **边界**吗？ | **输入池依赖**：`buildFineSpanCandidatePool(..., formalSpans)` 按 Formal 槽聚合 |
| Vote 公式依赖「单路径算法」吗？ | **否**：`voteUtteranceDomainFromPool` = FineSpan presence；base 不计票 |
| 投票对象 | 各 Formal 槽内 **全部** vote-eligible candidates 的 DomainSet union |
| 换成 Multi-Path | **公式可不变**（Presence Vote Independent）；**调用方**需改为 Path-local pool（架构 V1.2） |

```text
Vote Independent（公式）
Vote Input Depends on Formal Segmentation（池边界）
```

---

## 8. Assembly Dependency

| 问题 | 答案 |
|------|------|
| Assembly 依赖 FormalSpan？ | **强依赖**：`runDomainAwareAssembly` **硬要求** `FormalFineSpan[]`；禁止 coarse fallback |
| 组句替换依赖？ | `buildSentenceCandidates` 消费 **bucket spanSets**（来自 Formal 槽上的 picks） |
| 与 Span「几乎无关」？ | **否** — 槽位数量、非重叠约束、canonical pick 均来自 Formal |
| 换 Multi-Path 改动量 | Orchestrator 替换 LTR→Path 视图；Assembly API 签名可保留但 **输入物化必须改**；`assertFormalFineSpansNonOverlapping` 按 Path 重绑 |

Assembly **不是**「只吃 Bucket、与 Span 无关」。

---

## 9. Real Benefits of Multi-Path

### 9.1 Lattice 理论上能新增什么（对照代码能力）

| # | 宣称收益 | dialog_200 实证 |
|---|----------|-----------------|
| ① LTR 永远不生成的 Candidate | 并行保留未 Commit 窗的 exact | **本 22 Case：无 exact 因 Commit 永久丢失** |
| ② LTR 永远投不出的 Domain | 依赖 ① 的丢失域票 | **无对应 Case 统计** |
| ③ LTR 永远进不了 KenLM 的句 | 依赖不同 Path 组句 | **无对照实验证明比例** |
| ④ 占 dialog_200 比例 | — | **无真实统计 → 不得猜测** |

### 9.2 Phase2 Lattice harness（200 Case，真实 SQLite）

证据：`_audit_scratch/lattice_v1_phase2/dialog_200_phase2_summary.json`  
及 `lattice_v1_phase2_node_runtime/dialog_200_phase2_node_summary.json`：

```text
completed = 200
utterancesWithNoLexicalCompletePathCount = 200
zeroLexicalOnlyCompletePaths = 200
utterancesNeedingFallback = 200
```

**在当前词表与 Phase2 实现下，Lattice 未能在 dialog_200 上产出「无 fallback 的完整词路径」优势。**  
因此不能声称 Lattice 已是质量必需。

---

## 10. Migration Cost

若生产切换 LTR → Multi-Path Lattice：

| 模块 | 改动性质 | 规模（基于现码） |
|------|----------|------------------|
| Fine Span | 替换 `runLtrFineSpanGeneration`；实现 Path 枚举 + 物化 | **大**：新模块 + orchestrator 换根 |
| Recall | 多可复用 `recallTopKForWindows`；Window 生成侧改 | **中**：调用次数/缓存键可能上升 |
| Vote | 公式可保留；改为 Path-scoped 调用 | **小–中** |
| Assembly | Path-local buckets + 全局 ≤16 分配 | **中** |
| Trace / Diagnostics | PathId / boundaryKey / 多路径字段 | **中** |
| Regression / Acceptance | 重写 LTR 门禁；新增 Path 门禁；dialog_200 基线重跑 | **大** |
| KenLM | 输入仍 ≤16；来源改为跨 Path | **小** |
| Tone | 已冻结；不应重开 | **禁止** |

不得用「影响较大」一笔带过：以上为按模块的真实接线面。

---

## 11. LTR Long-term Viability

若 **不**开发 Lattice，保持 LTR，仍需修的问题（来自既有主链审计，非本轮臆测）：

| 问题 | 是否只有 Lattice 能解？ |
|------|------------------------|
| Sentence Assembly（fragment 与组句、budget） | **否** |
| KenLM 选句 / Apply Gate 质量 | **否** |
| 词表覆盖 / parent_fragment 质量 | **否** |
| 跨界完整词弱于界内短词（设计 KEEP） | Lattice 可并行保留，但 **dialog 未证必需** |
| 金标起点落在已 Commit 区间（历史皇后镇类结构缺口） | Lattice/lookahead **可能**缓解；**本 22 Case 未复现为质量瓶颈实证** |

```text
LTR SUFFICIENT
（相对「必须迁移 Multi-Path 才能达最终产品目标」）
```

最终产品目标仍依赖 Assembly/KenLM/词表等工作；**不依赖**先上 Lattice。

---

## 12. Option Comparison

### Option A — 继续 LTR（推荐）

| | |
|--|--|
| 优点 | 生产已通；O(n) 步；dialog 探针无 exact 丢失瓶颈；维护面小 |
| 缺点 | 无回退；同 cursor 只留一窗；跨界 fragment 不 Commit |
| 风险 | 未来若出现「整词 exact 被短 exact 系统性杀死」的可复现 dialog 集，需重开评估 |
| 维护成本 | **低**（现有 freeze-contract + LTR 测试） |

### Option B — 迁移 Lattice

| | |
|--|--|
| 优点 | 架构文档一致；可并行多 SegmentationPath |
| 缺点 | Phase2 在 dialog_200 **尚无完整词路径收益**；迁移面大 |
| 新增复杂度 | Path 枚举、fallback 注入、跨 Path ≤16、双路径风险 |
| 维护成本 | **高** |
| 预计收益 | **当前 dialog_200：无量化正收益证据** |

### Option C — 折中（LTR + 局部有限多路径）

| | |
|--|--|
| 内容 | 仅在 commit 平局或特定歧义点保留 2 路径 |
| 是否值得 | **当前不值得** — 无失败 Case 集合驱动；易滑向未冻结双链 |

---

## 13. Target List

| ID | Action | Priority |
|----|--------|----------|
| T1 | 正式将 **生产 Fine Span = LTR** 记为长期方案（文档对齐，非改算法） | Docs |
| T2 | Lattice 文档保留为 **可选未来架构**，不得默认排期 | Docs |
| T3 | 继续主链：**Sentence Assembly**（既有 MAINCHAIN 审计） | Dev（他轮） |
| T4 | 若未来宣称 LATTICE_REQUIRED，必须提交可复现 exact 丢失 Case 集 | Gate |

---

## 14. Check List

- [x] Part A LTR 行为与双 Case Trace  
- [x] Part B ≥20 Case 候选丢失统计  
- [x] Part C 重叠窗真实 Trace  
- [x] Part D Recall→Vote 区分  
- [x] Part E Vote 依赖  
- [x] Part F Assembly 依赖  
- [x] Part G Lattice 收益（无臆测比例）  
- [x] Part H 迁移成本分模块  
- [x] Part I LTR 可行性  
- [x] Part J 三方案  

---

## 15. Final Verdict

### 必须回答

1. LTR 是否真正丢失正确 Candidate？ → **机制上可丢未胜出窗 hits；22 Case 中 exact_term 永久丢失 = 0**  
2. 有无真实 dialog Case 证明？ → **无 exact 证明；仅 2 Case parent_fragment 跨界 ineligible（随后有片段回收）**  
3. Recall 是否已足够？ → **对已命中 hits：94%+ 进入 Commit；空命中 Case 是词表/匹配问题**  
4. Vote 是否依赖单路径？ → **公式独立；输入池依赖 Formal 分割**  
5. Assembly 是否依赖单路径？ → **是（强依赖 FormalFineSpan[]）**  
6. Lattice 真正能提升哪些 Case？ → **dialog_200 无已证实提升清单**  
7. 提升比例？ → **无统计，不猜测**  
8. 引入多少复杂度？ → 见 §10（Fine Span/验收大；Vote 公式小）  
9. 是否值得迁移？ → **当前不值得**  
10. 是否可直接冻结 LTR？ → **可以（作为长期生产 Fine Span）**  

```text
LTR_SUFFICIENT
```

**判定说明：** 不得以「未来扩展性 / 理论更优 / 架构文档已写 Lattice」作为 `LATTICE_REQUIRED` 唯一依据。本轮 **未发现** LTR 已成为 dialog_200 主链质量瓶颈的生产 Case 数据证明。

