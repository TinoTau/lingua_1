# Lingua1 — Context / Domain Guided Path Space Control  
## Architecture Decision Pre-Audit

```text
DATE   = 2026-09-19
MODE   = READ_ONLY · NO_PRODUCT_CHANGE · NO_CONFIG_CHANGE · NO_IMPLEMENTATION_PLAN
METHOD = SSOT / Contract → Trace → Root Cause → Architecture Decision
```

**本轮不提高 pass rate；不修改 production / test / config / model / cap。**

---

## 0. 一句话结论

```text
RESULT = C — ARCHITECTURE GAP
```

当前 **Architecture A（Late Domain Vote）** 与 Lattice 冻结主链 **一致**，path prune **不是** Domain Vote 实现违约。  
系统性缺口是：冻结 SSOT **没有**定义 Domain/Context 是否、以及如何在 Domain Vote **之前**参与 **path-space** 控制；同时 8/8 仍为 **PROBE / NOT_FINAL**，cap 触发时仅有 structural Top-N，**无** representative diversity 契约。  

因此：**不得**因失败 case 直接改 production；须先由用户做 Architecture Decision。

证据来源（只读复用，本轮未重跑实验）：

- Lattice Architecture V1.0.0 + Implementation Contract（2026-07-26）
- Runtime_SSOT_Contract_Freeze / CONTEXT_PRIOR.md
- `LINGUA_CONTEXT_DOMAIN_GUIDED_PATH_SPACE_CONTROL_SSOT_AUDIT_V1`
- `LINGUA_SEGMENTATION_HYPOTHESIS_DIVERSITY_*`
- `LINGUA_PRE_DOMAINVOTE_DOMAIN_EVIDENCE_GATING_*`
- `LINGUA_PATH_BUDGET_CAPACITY_BOTTLENECK_REMEASURE_V1`
- 代码：`enumerate-complete-segmentation-paths.ts` · `lattice-fine-span-runtime.ts` · `span-assembly-v4-orchestrator.ts` · `run-model3-path-step.ts` · `utterance-domain-vote.ts`

---

## 1. Frozen Architecture vs Current Implementation

### 1.1 Frozen main chain（Lattice Architecture §1）

```text
FW 整句
→ UtteranceSyllableCoordinate
→ 连续 1..5 音节 WindowQuery
→ SQLite Lexicon Recall
→ LexicalEdge[]
→ SegmentationPath[]                    ← Fine Span SSOT
→ Path-specific Domain Vote
→ Path-specific SameDomain Assembly
→ Global Sentence Candidates ≤16
→ KenLM Cross-Path Scoring
→ Top-K / Final
```

冻结原则：

```text
路径限宽 = 资源保护，≠ 语言决策
Must not prune using Domain Vote, SameDomain, Assembly, KenLM, LLM, or final fluency
for each SegmentationPath: independent Domain Vote
Path-level independent domain buckets（不得为简化而合并）
```

### 1.2 Current implementation（与 brief 中示意链的差异）

| Stage | Frozen / SSOT owner | Current code reality |
|-------|---------------------|----------------------|
| FineSpan / windows | Lattice：全句 1..5 窗 | `runLatticeFineSpanGeneration*` |
| Recall | Lexicon + `recallDomainScope` | Base Recall → **Model2 PRE_LEXICAL_EDGE** → `buildLexicalEdges` |
| Model2 | Lattice 主链未列；Aug-12 契约 = **pre-edge expansion** | **在 LexicalEdge 之前**，不是 SameDomain 之后 |
| Path enum + 8/8 | Bounded Complete Path Enumeration；PROBE | `enumerateCompleteSegmentationPaths` + `V4_LIMITS` 8/8 |
| Domain Vote | 每 Path 一次；公式 Runtime_SSOT | `prepareModel3PathUpstream` → `voteUtteranceDomainFromPool` |
| Model3 | 后插；非 Lattice 初版主链 | Vote/Anchor 后 KEEP/RETRY；Retry 不二次 Vote |
| SameDomain / Assembly | Vote 后 per retainedDomains | `completeDomainAwareAssemblyFromVote` |
| KenLM | 跨 Path 句级打分；≤16 | Orchestrator merge 后 KenLM |
| NMT | 下游 | 本审计不展开 |

**禁止用当前实现反向改写 SSOT。** Brief 中 “SameDomain → Model2” **不是**冻结主链。

### 1.3 Ownership map（path-space 相关）

| Concern | Owner | 非 Owner |
|---------|-------|----------|
| Window / Edge / Path 几何 | Lattice Arch + Contract | Domain Vote |
| Path 数量 cap（PROBE） | `V4_LIMITS` + structural comparator | Domain / Context / KenLM |
| Domain 公式 | Runtime_SSOT | Segmentation prune |
| Domain 调用粒度 | Lattice：per Path | Utterance-wide 单 Vote |
| Unreasonable domain bucket | Vote `retainedDomains` + SameDomain | Path cap |
| Context Prior | Diagnostics only `applied=false` | 一切正式决策 |
| SoftBoundary SessionDomainPrior | **RETIRED** | 不得当作当前 path 控制权威 |

```text
DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN  (原意 H1：正式 Vote/SameDomain/语言分不得回流 segmentation)
CANDIDATE_CAP_AND_PATH_CAP_ARE_SAME_CONTRACT = NO
```

---

## 2. Path space 如何形成

### 2.A 路径数量主要来自什么？

| 来源 | 作用 | 是否等于 “path 数” |
|------|------|-------------------|
| Span / window 数量 | 1..5 重叠窗 → 多 LexicalEdge | 间接：边集合变大 |
| Candidate-per-span | Recall / Model2 / exactTopK 等 | **否**（同 edge 多 candidate **不**扩 Path） |
| Segmentation / boundaryKey | 完整覆盖 [0,N) 的边序列 | **是**：一条 Path = 一个 boundaryKey |
| Overlapping edges | 同起点不同 end → 局部歧义 | **是**：组合爆炸主因之一 |
| Domain buckets | Vote **之后** | **否**（不在 path enum） |
| Model2 | 增加/物化 candidates → 可能新 edge | 间接 |
| Cartesian sentence | Assembly / ≤16 | **下游**，非 path cap |

**不得**笼统写成 “候选太多”。Path 爆炸主因是 **合法 LexicalEdge 图上的完整分界枚举**，不是 candidate 扇出成 Path。

### 2.B 当前 8/8 cap 限制什么？

| 项 | 事实 |
|----|------|
| 位置 | `enumerate-complete-segmentation-paths.ts`：`per_position_cap`（active）+ `complete_path_cap` |
| 输入 | 该 position 上全部 partial / 全部 complete PartialPath |
| 输出 | structural best-first Top-N |
| 规则 | fallback↑ fuzzy↑ toneRelaxed↑ exact↓ lexical↓ boundaryKey↑ |
| Deterministic | YES |
| 设计目的 | **RESOURCE_SAFETY / PROBE**，非语言 beam |
| 可否删正确 path | **YES**（evaluable 7/17；G2 4/4） |
| 删后可否恢复 | 仅当提高 cap 或改 prune 契约；Vote **不能**复活已删 Path |

```text
CURRENT_ACTIVE_PATH_CAP = 8
CURRENT_COMPLETE_PATH_CAP = 8
CURRENT_CAP_AUTHORITY = PROBE / NOT_FINAL
```

---

## 3. 失败 case 的 FIRST LOSS（证据，非规范）

代表性 known Pre-DomainVote 损失（过拟合/城门/水道/提示符/护士长/行程图/黄包车）：

| 观测 | 典型值 |
|------|--------|
| Target LexicalEdge 存在 | YES（evaluable 子集） |
| 进入枚举 | YES |
| Cap 前可有 target path | 部分 YES（complete 阶段损失）或仅 partial |
| Cap 后存活 | 常 NO @8/8 |
| **FIRST LOSS POINT** | **PATH_CAP**（active 或 complete） |
| Domain Vote 是否“已知道正确领域” | Vote **尚未运行**；谈不上 Vote 来不及，而是 **从未看见该 Path** |

容量实验补充：提高 cap 可使部分几何到达 Vote（known-7 @32 → 4/7），但 **FINAL_CORRECT 仍 0/7** → 恢复 path 可见性 ≠ 修好终句；下游另有瓶颈。

**分类（§4）：**

| Case 现象 | Class |
|-----------|--------|
| Cap 按 structural Top-N 删除合法几何 | **1 EXPECTED FAILURE**（相对“cap 触发时的书面 prune 规则”）+ 同时暴露 **6 ARCHITECTURE GAP**（PROBE 未终裁；无 diversity 契约；是否要 domain 调度未定义） |
| Cap 实现与 Lattice §8 不一致 | **未成立** → 非 **5 IMPLEMENTATION DEFECT** |
| 用 domain 元数据门控减压 known-7 | **0/7 actionable** → 不支持“缺 domain gate 实现” |
| SoftBoundary 仍应控制 path | **RETIRED** → 非现行 SSOT violation |

---

## 4. Architecture A–D（仅语义，不选型）

### A — Current Late Domain Vote（现状 = 冻结）

```text
Edges → Path Expansion → Structural Cap → Domain Vote → SameDomain
```

| | |
|--|--|
| 优点 | 与 Lattice 一致；Path-level 独立 Vote；不把领域当分界器 |
| 缺点 | PROBE 8/8 紧时，正确几何可在 Vote 前消失；resource≠language 张力 |
| Correct path 可否在 Vote 前被删 | **YES** |
| Vote “知道领域但来不及” | **不准确**：Vote 对已删 Path **无输入** |
| 当前是否该模式 | **YES** |

### B — Domain-Guided Ranking（只调优先级，不硬删）

| 风险/问题 | |
|-----------|--|
| 与 Vote ownership | 若只用 tags 做 resource 排序，可不替代 Vote；若用 “胜出域” 则冲突 |
| SameDomain 提前 | 有变成隐式 SameDomain 的风险 |
| Circular | 用正式 `retainedDomains` 回流 → 违 H1 |
| 语义 | 更接近 **resource scheduling**，仍需 ACP 改 “structural-only prune” |

### C — Domain-Guided Hard Pruning

| 风险 | |
|------|--|
| coarse 错 / 多域 / 歧义句 | 高召回损失 |
| Path-level independent buckets | **直接冲突**（硬删他域 Path） |
| Vote 架空 | 高 |
| 结论 | 与冻结 multi-path 原则 **强烈冲突**；本预审 **不推荐作为默认选项**，若坚持须显式 CONFLICT 决策 |

### D — Hybrid Soft Budget Allocation

| | |
|--|--|
| 意图 | 每几何/歧义类最低存活预算；context 只分配 **超额** slot |
| 可保留 path independence | 可能 |
| 防单族占满 cap | 可能 |
| 复杂度 | 中高；仍属 **新契约**（此前 diversity ACP 简化后仍未授权实现） |

---

## 5. 是否其实只是更简单的 root cause？

| 候选 | 结论 |
|------|------|
| candidate-per-span 失控伪装成 path 爆炸 | **部分相关但不同层**；同 boundary 多 candidate 不扩 Path |
| duplicate path 未去重 | boundaryKey 身份已去重；问题是 **多不同 key 同构细切** |
| Domain Vote 输入含非法路径 | Vote 只见 retained paths；问题在 **更早 prune** |
| Path cap ownership 写错 | **否** — 与 §8 一致 |
| 为掩盖 defect 上 domain architecture | **禁止** |

**更简单、已证实的杠杆：** 提高 PROBE 数值可改善 **可见性**（10→14/17），但 **不是** domain-guided 架构，且 known-7 **终句不修**。

---

## 6. Correctness vs Performance（勿混）

| | Evidence |
|--|----------|
| **Correctness** | 7/17 target 几何 @8/8 到不了 Vote；提高 cap 部分恢复 |
| **Performance** | completeBefore mean 16.8→54.7（8→32）；Model3 retry 决策量近似随 path 线性升；全量 Pilot 延迟未在本预审重测 |
| Cap 存在 ≠ 已证明生产 1.5s 违约 | Replay 延迟 **不得**直接等同生产 SLA |

---

## 7. Domain Vote 前已有 context（仅实际存在）

| Signal | Source | Reliability | Stage | Consumer | Ownership |
|--------|--------|-------------|-------|----------|-----------|
| `domains[]` | term_domain_tags → Recall | Lexicon 事实 | pre-edge | Vote（后） | Lexicon + Runtime_SSOT |
| `source` base/domain_term | Recall | 结构性 | pre-edge | Vote 资格 | Runtime_SSOT |
| `recallDomainScope` | CFG / profile | 配置域 | Recall | Recall | Orchestrator |
| Context Prior | stub | N/A | anytime | **无决策** | CONTEXT_PRIOR `applied=false` |
| SoftBoundary prior | 历史 | — | — | **RETIRED** | — |
| 正式 `retainedDomains` | Vote | 公式输出 | **post-path** | SameDomain / Retry | Runtime_SSOT |
| UserProfile / Model2 | profile retrieval | 模型 | pre-edge | candidates | Model2 契约 |

**禁止**本轮提出新模型/新 context 源。

`REASONABLE_DOMAIN_DEFINITION = NOT_FOUND` → “删不合理域假说” **无**冻结谓词。

---

## 8. 若未来允许 Domain 参与 path-space：角色边界

证据 **不足以**由审计员代选。可选角色：

| Code | 含义 |
|------|------|
| A | correctness gate |
| B | ranking signal |
| C | resource allocation signal |
| D | pruning authority |
| E | 完全不应提前参与（保持 A + 仅终裁数字 cap / 另议 diversity） |

与冻结最不冲突的候选方向若要探索：偏 **C（或弱 B）** 且 **禁止 D**；但须用户 ACP，**本轮不选**。

---

## 9. Patch-Risk 扫描（只记录）

| 发现 | 分类 |
|------|------|
| Structural-only path prune | LEGITIMATE CONTRACT |
| Per-path Vote + SameDomain | LEGITIMATE CONTRACT |
| Context Prior `applied=false` | LEGITIMATE（diagnostics） |
| SoftBoundary / SessionDomainPrior 残留文档 | SUSPECTED LEGACY（已 RETIRED，勿当权威） |
| `LINGUA_EXPERIMENT_MAX_*` env override | 实验钩子；unset=8/8；**非**生产终裁 |
| Domain-specific if/else 做 path prune | **未发现**生产 path prune 使用 domains |

---

## 10. Architecture Decision Matrix

| Option | Correctness semantics | Recall risk | Domain Vote impact | SameDomain impact | Complexity | Performance | SSOT change |
|--------|----------------------|-------------|--------------------|-------------------|------------|-------------|-------------|
| **A Current late Vote** | 分界与领域分离；cap 可误伤几何 | 低（对域） | 符合 | 符合 | 低 | 依赖 PROBE 数值 | 无（现状） |
| **B Domain ranking** | 调度优先，不硬删 | 中 | 需防替代 Vote | 需防提前过滤 | 中 | 或改善 slot 使用 | **需 ACP** 改 prune 契约 |
| **C Hard domain prune** | 领域正确时利；错则灾难 | **高** | **架空风险** | **违独立 bucket** | 中 | 强收缩 | **重大 / 近 CONFLICT** |
| **D Soft budget** | 保独立 + 控占满 | 中低 | 可并存 | 可并存 | 高 | 可控 | **需 ACP**（diversity/budget） |
| **Numeric cap ↑ only** | 多可见性；不保证终句 | 低 | 输入变多 | 工作量↑ | 低 | 成本↑（16→24 本队列零增益） | 仅 PROBE 终裁，非新架构 |

**不给出“最佳方案”。**

---

## 11. 最终审计结论

```text
RESULT C — ARCHITECTURE GAP
```

**不是 RESULT B：** path prune 实现与 Lattice §8 **一致**（非 “该用 domain 却没用” 的违约）。  
**不是 RESULT D：** SoftBoundary 已 RETIRED，不构成双 SSOT 对立争 path 控制权。  
**不是单纯 RESULT A：** 若产品要 “Context/Domain 指导 path expansion”，现有 SSOT **无法回答正确行为**；PROBE 终裁与 cap-time diversity 亦未闭合。

---

## USER DECISIONS REQUIRED

### Decision 1 — Path-space 控制要不要引入 Domain/Context？

**Question:**  
在 Domain Vote 之前，是否允许任何 Domain/Context 信号参与 SegmentationPath 的资源调度？

**Existing evidence:**  
- 冻结：path 限宽 = 资源保护；禁止 Vote/SameDomain/KenLM 剪 path（H1）。  
- `domains[]` 在 prune 前 **已存在但未授权使用**。  
- 廉价 hasDomainEvidence 对 known-7：**0/7** 减压。  
- SoftBoundary path 控制权威：**NOT_FOUND / RETIRED**。

| Option | Meaning |
|--------|---------|
| **E** | 保持 Architecture A；Domain 只在 Vote/SameDomain | 不改 path 契约；正确性问题交给 PROBE 数值 / 下游 |
| **Open ACP for B or D** | 允许 ranking 或 soft budget | 须新契约；禁止用正式 Vote 结果回流 |
| **C Hard prune** | Vote 前按域硬删 Path | 与独立 domain bucket 原则冲突风险最高 |

**Trade-off:** E 最忠于现状 SSOT；B/D 需设计且 known-7 显示 “有域证据” 并不稀缺；C 召回风险最大。

**Do NOT choose automatically.**

---

### Decision 2 — 8/8 PROBE 如何终裁？

**Question:**  
在 **不**引入 domain-guided path 架构的前提下，是否将 path cap 终裁为纯资源天花板（例如基于 12/16/32 测量），并接受 structural Top-N 损失？

**Existing evidence:**  
- 10/17 → 14/17 @32；16→24 **零**额外 Vote 生存。  
- known-7 几何恢复后 **FINAL_CORRECT 仍 0/7**。  
- `PATH_BUDGET_FINALIZATION_READY` 在未做 Decision 1 前曾判 **NO**（避免把测量当所有权）。

| Option | Meaning |
|--------|---------|
| **Finalize numeric only** | 保持 structural prune；选一 PROBE→FINAL 数字 | 不解决 diversity gap；可能改善可见性 |
| **Defer numeric** | 先 Decision 1 / diversity ACP | 避免冻错所有权 |
| **Raise now for ops** | 临时提高默认 cap | 须显式接受成本与下游 Model3 工作量 |

**Trade-off:** 只加 cap ≠ 修终句；但可不碰 Domain 架构。

**Do NOT choose automatically.**

---

### Decision 3 — Cap 触发时要不要 “代表性分界保留”？

**Question:**  
当 cap 必须有损时，是否要求保留 lattice-native 分界歧义代表（非 domain quota）？

**Existing evidence:**  
- Diversity contract：**ARCHITECTURE_GAP**；历史无 representative 定义。  
- Minimal boundary preservation：**PAUSED / NOT_AUTHORIZED**（复杂度门通过但 known-loss 触达有限）。

| Option | Meaning |
|--------|---------|
| **Keep STRUCTURAL_TOPN_ONLY** | 接受细切家族占满 | 实现零改；可见性靠 cap 数值 |
| **ACP minimal geometry preservation** | 无新 AmbiguityClass 子系统前提下的确定性约束 | 需批准后再设计实现 |
| **Full diversity subsystem** | 已明确不希望 | 本预审保持反对默认 |

**Trade-off:** 与 Decision 1 正交（可不碰 Domain）。

**Do NOT choose automatically.**

---

## 12. 本轮明确未做

- 未改代码 / config / cap / 模型 / 数据集  
- 未写 Implementation Plan  
- 未重跑 Pilot200  

---

## 13. 产物路径

```text
docs/user_correction/model3/LINGUA_CONTEXT_DOMAIN_PATH_SPACE_ARCHITECTURE_DECISION_PREAUDIT_2026_09_19.md
```

相关既有审计（只读引用，非本轮新产物）：

```text
docs/user_correction/model3/LINGUA_CONTEXT_DOMAIN_GUIDED_PATH_SPACE_CONTROL_SSOT_AUDIT_V1.md
docs/user_correction/model3/LINGUA_SEGMENTATION_HYPOTHESIS_DIVERSITY_RESOURCE_PRESERVATION_CONTRACT_AUDIT_V1.md
docs/user_correction/model3/LINGUA_PRE_DOMAINVOTE_DOMAIN_EVIDENCE_GATING_CODE_AUDIT_V1.md
docs/user_correction/model3/LINGUA_PATH_BUDGET_CAPACITY_BOTTLENECK_REMEASURE_V1.md
```
