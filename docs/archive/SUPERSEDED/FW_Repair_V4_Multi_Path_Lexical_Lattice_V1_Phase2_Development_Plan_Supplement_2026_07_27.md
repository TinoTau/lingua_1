<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase2_Development_Plan_Supplement_2026_07_27.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 2 Development Plan Supplement

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **P2 Supplement Review**（缺口与契约补充） |
| Reviewed | Phase 2 SegmentationPath Development Plan |
| Authority | Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 |
| Status | Supplements applied via Contract Change Record **1.0.1** + Phase 2 implementation notes |

---

## 1. Purpose

对照实际代码、Phase 2 Pre-Development Audit 与 Development Plan，补充可执行契约，**不改变**冻结 Architecture 主方向。

---

## 2. KEEP

| Item | Source |
|------|--------|
| Phase 2 交付止于 `PathFineSpanView[]` | Design Gap（Plan §3） |
| Phase 1 Window / Recall / Evidence 冻结 | Code Implementation |
| 禁止 Domain/KenLM/LLM 参与 Path prune | Architecture §8 |
| 禁止无条件每音节 fallback | Contract §6.2 |
| 禁止 feature flag / shadow dual chain | Contract §1 / §11 |
| `enumerateIntervalPaths` 不复用为 Path 枚举 | Code Implementation / Architecture Drift risk |

---

## 3. MODIFY（仅补充契约，非改 Architecture）

### 3.1 Phase boundary cutover 原子性 — Design Gap

**来源：** Design Gap（Plan §1）+ Code Implementation（下游仅消费单一 `FormalFineSpan[]`）

**补充（已写入 Contract Change Record 1.0.1）：**

```text
Phase 2 owns Path modules acceptance (harness/offline).
Production LTR → SegmentationPath cutover MUST be atomic with
first Path-aware downstream consumer (Phase 3).
Before that: no shadow / flag / dual output.
```

### 3.2 Prune comparator 方向 — Interface Contract

**来源：** Design Gap（Plan §4.11）+ Architecture Drift risk

**补充：**

```text
Comparator MUST document best-first vs drop-first.
Phase 2 code uses best-first:
  compare(a,b) < 0 ⇒ a retained preferentially.
Tests MUST assert retained boundaryKeys, not only comparator integers.
```

### 3.3 Active partial path 定义 — Data Contract

**来源：** Design Gap（Plan §4.12）

```text
active path @ position P = complete contiguous edge prefix ending at syllable P
per-position cap applies to that set — NOT to outgoing edge fan-out alone
```

### 3.4 Fallback candidates — Data Contract

**来源：** Design Gap（Plan §4.8）+ Code Implementation

```text
fallback Edge: candidates = [] (shared empty array)
no fake WindowCandidate / termId / domains
raw coverage via materializer + syllable→raw coordinate mapping
```

### 3.5 FormalFineSpan.selectionReason — Interface Contract

**来源：** Code Implementation（必填字段）+ Plan §2E

```text
Add FineSpanSelectionReason = 'lattice_path_edge'
PathFineSpanView MUST NOT use LTR commit reasons
(best / selected / committed / prior_tiebreak as decision semantics)
```

### 3.6 Minimal-gap injection algorithm — Decision Constraint

**来源：** Design Gap（Plan §4.9）+ Test Finding

```text
Algorithm: lexical reachability check;
if unreachable, min-cost DP (lexical=0, fallback length-1=1)
with deterministic parent tie-break.
Inject only fallbacks on that min-cost reconstruction.
Same-cost alternate gap sets MAY be omitted (deterministic single set).
```

### 3.7 dialog_200 expectation — Acceptance / Regression

**来源：** Test Finding（dialog_200：200/200 need fallback）

```text
Acceptance MUST NOT require zero-fallback on dialog_200.
PASS criteria:
  completed=200, failed=0, zeroCompletePaths=0,
  unique/stable/ref-share violations=0,
  caps optional (PROBE may not fire on sparse graphs).
Archive ALL fallback / cap / zero-path / high-path sentences — not averages only.
```

---

## 4. RESTORE

无。不恢复历史 LTR / SoftBoundary / 旧 Fine Span Proposal 为开发依据。

---

## 5. DELETE

| Item | When |
|------|------|
| 计划中“Phase 2 立即切换生产入口且下游仍单 FormalFineSpan[]”的不可执行顺序 | 由 1.0.1 澄清替代（非删 Architecture） |
| 物理删除 LTR | **仍禁止于本轮**；Phase 6 |

---

## 6. Design Constraints（汇总）

1. Path 模块生产可用但 **harness-only**，直至 Phase 3 原子 cutover  
2. Prune / cap 仅结构 + Recall evidence  
3. Fallback length=1；无 domain；无假 lexicon candidate  
4. `boundaryKey`/`pathId` 全确定性  
5. Candidate 引用共享；禁止 deep-copy  
6. Diagnostics 只记录事实  

---

## 7. Interface / Data / Decision / Regression / Acceptance

| Class | Supplement |
|-------|------------|
| Interface Contract | `enumerateCompleteSegmentationPaths` / `injectFallbackEdges` / `materializeFormalFineSpans` / `runPhase2PathHarness*` 签名以代码为准 |
| Data Contract | DTO in `lattice-path-types.ts`；fallback `candidates=[]` |
| Decision Constraint | best-first prune；min-cost deterministic fallback set |
| Regression | Phase 1 语义不变；orchestrator 仍 LTR |
| Acceptance | Unit + dialog_200 harness metrics（见 Development Report §15） |

---

## 8. Residual Risks（未来易偏离点）

1. 提前半接入 orchestrator → 双链路  
2. 用 Domain/KenLM 做 Path prune  
3. 无条件 fallback 或伪造 lexical length-1  
4. 把 `PathFineSpanView` 当 utterance SSOT  
5. 复用 `enumerateIntervalPaths` 当 Path 枚举  

---

## 9. Relation to Implementation

本 Supplement 的关键澄清项已落地为：

- Contract Change Record **1.0.1**  
- Phase 2 代码实现 + `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase2_Development_Report_2026_07_27.md`  

---

*P2 Supplement Review complete. Frozen Architecture direction unchanged.*
