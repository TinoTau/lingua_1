<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Development_PreAudit_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Development Pre-Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **开发前架构审计（Read-only）** |
| Not | 开发 · 测试执行 · 修改方案 · 代码 |
| Authority (strict) | Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 · Development Plan Phase Gate · Phase 1 Acceptance Criteria（Pre-Dev Audit §18） |
| Explicitly unused | 历史讨论 · 猜测 · 未冻结设想 |

---

## 1. Executive Summary

依据 Architecture §20 / Implementation Contract §13，**Phase 1 允许的代码范围**为：

```text
Windows · Recall dedupe · LexicalEdge · harness
```

**禁止**：Orchestrator cutover · 删除 LTR · Vote / Assembly / KenLM 接线 · 双链。

对照现状：

| 项 | 状态 |
|----|------|
| Phase 1 允许范围内的 **功能实现** | **已落地**（harness + Window/Edge + B1/B2 SSOT） |
| 正式 Phase 1 Acceptance | 首轮 **FAIL**；B1/B2 Code Verification **PASS**；**Re-Acceptance 未执行** |
| Residual Cleanup | Pre-Dev **READY**，**尚未执行** |
| Production 接入 | Architecture **明确禁止**于 Phase 1 |

因此：Residual Cleanup 完成后，**不再存在** Architecture 意义上待开发的 Phase 1 功能模块；下一合法工序是 **Residual Cleanup → Phase 1 Re-Acceptance Audit**，不是再开一轮 Phase 1 Development。

```text
NOT READY FOR PHASE 1 DEVELOPMENT
```

---

## 2. Current Phase1 Status

| 里程碑 | 文档裁决 | 含义 |
|--------|----------|------|
| Phase 0.5 / Architecture Freeze | READY FOR PHASE 1 | 允许启动 Phase 1 harness 开发 |
| Phase 1 Window+Edge Development | PHASE 1 COMPLETE — READY FOR ACCEPTANCE | harness 目标清单宣称完成 |
| Phase 1 Acceptance | **FAIL**（B1/B2） | 未关闭验收 |
| B1/B2 SSOT Repair | READY FOR RE-ACCEPTANCE | blocker 代码修复完成 |
| B1/B2 Final Code Verification | **PASS** | 运行时 SSOT 已对齐冻结规则 |
| Residual Cleanup | READY FOR RESIDUAL CLEANUP（未做） | 文档/实验残留，非 Phase 1 功能 |
| Phase 1 Re-Acceptance | **未开** | 正式验收仍开放 |

**Phase 1 功能开发状态：** 允许范围内实现 **已完成**；验收门 **未关闭**。

---

## 3. Scope Audit

### 3.1 Phase 1 真正目标（SSOT）

| 来源 | Phase 1 内容 |
|------|----------------|
| Architecture §20 | Windows, Recall dedupe, LexicalEdge + harness |
| Implementation Contract §13 | 同上；via harness |
| Development Plan §十九 | 全句 1～5 窗、Recall 去重、LexicalEdge；**不接 Vote** |
| Phase 1 Pre-Dev Acceptance Criteria §18 | 窗完整性 · Edge 唯一 · domains[] · surfaceText · cache · **零** Path/Vote/Orchestrator |

### 3.2 已完成（不得重复开发）

| 能力 | 证据锚点（合同/代码存在性，非再验） |
|------|-------------------------------------|
| 全句连续 WindowQuery 1..5 | `buildLexicalWindowQueries` |
| Lattice hard-block（非 coarse hard-cut） | `latticeHardBlockFilter` |
| Recall 复用 + Key dedupe | `recallTopKForWindows` + utterance cache |
| LexicalEdge 每边界至多一 | `buildLexicalEdges` |
| Candidate = `WindowCandidate`；domains[] | bind + Edge |
| Evidence OR → identity first-wins | B2（Code Verification PASS） |
| Recall 全量遍历 recallable Window | B1（Code Verification PASS） |
| 独立 harness + 生产隔离测试 | `runPhase1WindowEdgeHarness`；orchestrator 不引用 |
| Phase 1 单测 / dialog_200 harness probe | 已有 |

**禁止再开：** B1 attempt gate、B2 Evidence 顺序、第二套 Window/Recall/Edge。

### 3.3 尚未完成（流程，非 Phase 1 新模块）

| 项 | 性质 |
|----|------|
| Residual Cleanup（实验脚本 / `DOMAIN_RECALL.md` / 失效探针归档） | **清理**，非 Architecture Phase 1 功能 |
| Phase 1 **Re-Acceptance Audit** | **验收**，非开发 |
| Acceptance Contract §19 条目 7–21（多 Path、Vote、KenLM、cutover…） | **Phase 2+** |

### 3.4 Architecture Acceptance Contract 与 Phase 1 的映射

| §19 # | 内容 | Phase 归属 |
|-------|------|------------|
| 1–6 | 窗 1..5、音节坐标、coarse 非硬切、单 Edge、多 Candidate、domains[] | **Phase 1**（实现已有；待 Re-Acceptance 盖章） |
| 7–15 | 多 boundaryKey / Path / Vote / Assembly / ≤16 / KenLM… | **Phase 2+** |
| 16–18 | 无新索引/临时表/双链 | 全程约束；Phase 1 已遵守 |
| 19–22 | cutover / 第二 SSOT / 文档冲突 | cutover = **Phase 2+** |

---

## 4. Runtime Ownership

| 对象 | Architecture Owner | 现状 | 冻结？ | 缺失？ |
|------|-------------------|------|--------|--------|
| Window | Window Generator | `buildLexicalWindowQueries` + shared core | **已冻结实现（harness）** | 无 Phase 1 缺口 |
| Recall | Recall | `recallTopKForWindows`（共享） | **已冻结内核**；B1 去 gate | 无 |
| Edge | Edge Builder | `buildLexicalEdges` | **已冻结（lexical only）** | fallback Edge = **later**（非 Phase 1） |
| Candidate | Lexicon → WindowCandidate | 既有 DTO + termId / recallCandidateKind | **已冻结** | 无 |
| Evidence | LexicalEdge.recallEvidence | B2 单 Owner | **已冻结** | 无 |
| Diagnostics | Trace facts only | harness / metrics `logicalWindowRecallCount` 等 | Phase 1 足够 | 全量 Utterance Path 级字段属后续 |
| Production Fine Span | 过渡 LTR；架构 SSOT=Lattice | orchestrator **未**切 Lattice | Phase 1 **禁止切** | 「未接入」= **合规缺口否**；属 Phase 2 |

**禁止本审计重新定义 SSOT。**

---

## 5. Remaining Gap

### 5.1 Implementation Gap（TODO / Stub / …）

对 Phase 1 模块检索：无业务 `TODO` / Stub / Placeholder / Mock 待实现项。

| 观察 | 判定 |
|------|------|
| `edgeKind: 'lexical'` only；无 fallback 注入 | **合规** — Architecture：gap fallback **later**；属 Path 阶段，**OUT OF SCOPE** |
| harness `productionCutover: false` | **合规** — Phase 1 要求 |
| LTR `fallback` 1-syllable option | **生产过渡**；非 Lattice Phase 1 待办 |
| 无第二套 Recall/Edge stub | **无** |

**结论：** 无「仍须开发」的 Phase 1 功能 stub；无可删的 Phase 1 假实现（除 Residual 文档/脚本，见依赖审计）。

### 5.2 与「再开 Phase 1 Development」的关系

若强行进入 Phase 1 Development，唯一风险是：

- 重复 B1/B2  
- 或把 Path / fallback / cutover 误标为 Phase 1  

二者均 **禁止**。

---

## 6. Production Audit

| 问题 | 依据 | 裁决 |
|------|------|------|
| Phase 1 哪些仍 offline only？ | Architecture §20；Pre-Dev §19；Acceptance Criteria §18.10 | **全部** Lattice Window/Edge/harness — **必须** offline / harness / tests |
| 是否需要真正接入生产？ | Architecture：cutover **forbidden in Phase 1**；属 Phase 2「remove LTR production ownership」 | **不应在 Phase 1 接入** |
| 本轮是否开发接入？ | — | **禁止**；本审计仅回答「应否」→ **否** |

---

## 7. Acceptance Gap

正式 Phase 1 Acceptance（相对 Pre-Dev §18 + Architecture §19.1–6）仍缺：

| 缺口 | 类型 | 说明 |
|------|------|------|
| **Re-Acceptance Audit** 文书与结论 | Acceptance | 首轮 FAIL 后未重跑正式验收 |
| 以修复后代码重证 dialog_200 完整性 / 五长句 Edge | Regression / Runtime evidence | Code Verification 与 probe 产物存在，**不等于**正式 Acceptance 盖章 |
| Residual 导致的 SSOT 文档漂移（`DOMAIN_RECALL.md` 仍写 maxSql） | Contract/Doc sync | 属 Residual Cleanup，验收前宜关闭 |
| 实验脚本假零指标 | Test tooling | Residual；非新接口设计 |
| Performance 正式门槛 | Performance | Architecture Phase 1 **未**另定硬 SLA；勿本轮新设计 |
| Path/Vote/KenLM 验收项 | — | **OUT OF SCOPE** |

**不要重新设计接口或验收合同。**

---

## 8. Dependency Audit

进入任何「Phase 1 后续工序」之前：

| 依赖 | 是否已满足 |
|------|------------|
| Residual Cleanup 执行完毕 | **否**（仅 Pre-Dev READY） |
| `DOMAIN_RECALL.md` 与 B1 SSOT 同步 | **否** |
| 实验脚本字段 → `logicalWindowRecallCount` | **否** |
| 失效 budget 探针归档/停用 | **否** |
| B1/B2 运行时代码 | **是**（Code Verification PASS） |
| Architecture / Implementation Contract 冻结 | **是** |
| Phase 1 Re-Acceptance | **否** |

**全部满足？否。**  
故不得宣布 `READY FOR PHASE 1 DEVELOPMENT`。

---

## 9. KEEP

- Phase 1 harness / Window / Edge / Recall 复用实现  
- B1/B2 修复结果与负向回归测试  
- 生产 LTR 主链（Phase 1 不删不切）  
- 历史 Acceptance FAIL 证据与修复后 probe JSON  
- Architecture / Implementation Contract 原文  

---

## 10. MODIFY

本审计 **不给出开发修改方案**。  
仅记录：Residual Cleanup Pre-Dev 已列出的文档/实验脚本对齐（属 Cleanup，**不是** Phase 1 功能 MODIFY 清单）。

Phase 1 功能模块：**无** Architecture 要求的待 MODIFY 项。

---

## 11. DELETE

Phase 1 功能范围：**无**待删实现。  

Residual 中「失效探针活跃职责」归档 ≠ 删除历史证据（见 Residual Cleanup 审计）。

---

## 12. OUT OF SCOPE

```text
B1 / B2 再开发
SegmentationPath / Path enum
fallback Edge 注入
Path Vote / Path Assembly
CompatibilityGraph 改造
Global ≤16 / KenLM 接线
Production Orchestrator cutover / 删除 LTR
Batch SQL / 新索引 / 临时表
feature flag / shadow 双链
Phase 2–6 任何内容
重新定义 SSOT / Acceptance Contract
```

---

## 13. Target List

### 若问「Phase 1 Development 目标」

```text
（空）— Architecture Phase 1 允许的功能开发目标已全部交付。
不得发明新的 Phase 1 开发 Target 以填充日程。
```

### 合法后续 Target（非本 Decision 的 Development）

| 顺序 | 工序 | Decision 标签（既有） |
|------|------|----------------------|
| 1 | Residual Cleanup | READY FOR RESIDUAL CLEANUP |
| 2 | Phase 1 Re-Acceptance Audit | （Cleanup 完成后开审计，非 Development） |
| 3 | 仅当 Re-Acceptance **PASS** | 方可讨论 Phase 2 Pre-Dev |

---

## 14. Check List

```text
[x] Phase 1 Scope 对照 Architecture / Contract（非猜测）
[x] B1/B2 标为已完成、禁止重复
[x] Production cutover 标为 Phase 1 禁止
[x] fallback / Path 标为 OUT OF SCOPE
[x] Residual Cleanup 依赖 = 未满足
[x] Re-Acceptance = 未执行
[ ] （未来）Residual Cleanup 完成
[ ] （未来）Phase 1 Re-Acceptance → PASS 或列新 blocker
[ ] （禁止）本轮输出开发代码或改造方案
```

---

## 15. Final Decision

```text
NOT READY FOR PHASE 1 DEVELOPMENT
```

**理由（仅架构边界）：**

1. **Residual Cleanup 未完成** — 依赖门未关。  
2. Architecture Phase 1 **功能开发已交付**；再开 Development 无合法 Target，只会重复 B1/B2 或滑入 Phase 2。  
3. 正式缺口是 **Re-Acceptance** 与 **Residual 文档/工具对齐**，不是新的 Phase 1 模块开发。

**Phase 1 开发边界：清晰，且无功能遗漏待开发。**  
下一动作不属于 `PHASE 1 DEVELOPMENT`。
