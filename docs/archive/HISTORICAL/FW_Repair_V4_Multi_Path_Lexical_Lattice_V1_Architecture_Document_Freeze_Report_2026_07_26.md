<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Architecture_Document_Freeze_Report_2026_07_26.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Architecture Document Freeze Report

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Scope | Documentation only — **no production code changes** |
| Architecture | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Status | **FROZEN FOR IMPLEMENTATION** |

---

## 1. Executive Summary

| Question | Answer |
|----------|--------|
| 是否完成架构冻结？ | **YES** — Architecture V1.0.0 **FROZEN FOR IMPLEMENTATION** |
| 是否消除旧新文档冲突（有效层）？ | **YES** — active freeze docs rewritten; SoftBoundary/LTR reports bannered HISTORICAL |
| 是否可以进入 Phase 1？ | **YES** |
| 本轮是否改生产代码？ | **NO** |

### Final Decision

```text
READY FOR PHASE 1
```

---

## 2. Frozen Architecture

```text
FW 整句结果
→ UtteranceSyllableCoordinate
→ 连续 1～5 音节 WindowQuery
→ SQLite Lexicon Recall
→ LexicalEdge[]
→ SegmentationPath[]
→ Path-specific Domain Vote
→ Path-specific SameDomain Assembly
→ Global Candidate Allocation <=16
→ KenLM Cross-Path Scoring
→ Top-K / Final Result
```

Ownership summary: Window Generator / Recall / Edge Builder / Path Enumerator / Path Vote caller / Path Assembly / Global Allocator / KenLM Adapter / Diagnostics — see Architecture §15.  
Vote **formula** remains Runtime SSOT; **caller** is per Path.

---

## 3. Updated Documents

| 文件 | 原状态 | 修改内容 | 新状态 |
|------|--------|----------|--------|
| `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md` | 不存在 | 新建 Architecture+Interface+Data+Ownership+Diagnostics+Trace+Regression+Acceptance+Freeze Declaration | **FROZEN FOR IMPLEMENTATION** |
| `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md` | 不存在 | 新建替代索引 | ACTIVE |
| `docs/fw-detector/ARCHITECTURE.md` | Overview / Vote-centric pipeline | Lattice 唯一主链 + 权威指针 | CURRENT overview |
| `docs/fw-detector/freeze/FROZEN.md` | LTR-era Fine Span 隐含 | Lattice 主链 + 子合约表 | FROZEN registry |
| `docs/fw-detector/INTERFACE_FREEZE.md` | 无 Lattice DTO | 增加 Lattice DTO 权威指针 | FROZEN + Lattice cite |
| `docs/fw-detector/assembly/FROZEN_V1_2.md` | 单 Formal 序列 Assembly | Path-scoped Assembly 流程 | CURRENT Path-scoped |
| `docs/fw-detector/kenlm/KENLM_RUNTIME.md` | 跨桶池 | 跨 Path ≤16 + metadata 回绑 + 禁止清单 | FROZEN + Lattice note |
| `docs/fw-detector/diagnostics/FROZEN.md` | 无 Path Trace | Path-aware Trace 指针 | FROZEN + pointer |
| `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` | V1.1 sole main chain | **V1.2** Path caller + Fine Span SSOT 分层 | FROZEN V1.2 |
| `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | Runtime-only sole authority | Lattice + Runtime 双权威分层 | CURRENT |
| `docs/tone-v2/Lingua_Runtime_Evolution_Rule.md` | 无 Lattice | 引用 Architecture；Path 字段演进约束 | Frozen + cite |
| Implementation Contract V1.0.0 | APPROVED | 标注 Architecture peer FROZEN | APPROVED + peer |
| Development Plan | 实施方案 | 标注 Architecture 冻结 | CURRENT plan |

---

## 4. Superseded Documents

| 历史文档 | 被替代内容 | 替代版本 | 保留历史 |
|----------|------------|----------|----------|
| SoftBoundary Plan/Report/Supplement/Addendum/PreDev/P5 audits | LTR 唯一 Formal · cursor · 2..5 SSOT | Architecture V1.0.0 | YES + banner |
| CoarseSpan/FineSpan SlidingWindow Audit | LTR = FineSpan SSOT | Architecture V1.0.0 | YES + banner |
| LTR FineSpan Performance Audit | LTR 作为冻结设计 | Architecture V1.0.0 | YES + banner |
| FW_Raw_Left_To_Right FineSpan Audit | 旧滑窗/LTR 设计 | Architecture V1.0.0 | YES + banner |
| Utterance Cache / Phase0 Coordinate reports（Fine Span SSOT 表述） | LTR 生产 SSOT 表述 | Architecture V1.0.0（坐标 SSOT 仍有效） | YES + banner |
| Lattice Pre-Development Audit | 开发前 blocker 状态 | Architecture + Phase0.5 Seal | YES + banner |
| Interface/Data Contract Draft | Draft DTOs | Implementation Contract + Architecture | YES + banner |

完整表：Document Supersession Index。

---

## 5. Conflict Search Result

全仓 `docs/**/*.md` 搜索关键词：`LTR` · `commitBestFormalFineSpan` · `generateLocalOptionsAtCursor` · `2..5` / `2～5` · `唯一 Fine Span` · `cursor` · `no beam` 等。

| Disposition | 处理 |
|-------------|------|
| **UPDATE** | Active freeze docs（上表 §3）— 主链改为 Lattice；明确 LTR 非有效架构 |
| **SUPERSEDE** | SoftBoundary / LTR / 旧滑窗审计与报告 — 顶部 HISTORICAL banner（14 个文件） |
| **KEEP** | Runtime Vote 公式、KenLM Gate、坐标 Phase0、lexicon `term_domain_tags`、≤16、fail-open |
| **HISTORICAL ONLY** | Development Plan 中对「当前生产 = LTR」的**问题描述**段落（作为迁移动机保留；权威以 Architecture 为准） |
| **DELETE DOCUMENT** | 本轮不删文件 |

Active freeze 抽检：ARCHITECTURE / freeze/FROZEN / Runtime_SSOT / Assembly / KenLM / Lattice Architecture — 无「LTR 唯一 FineSpan 主链仍为有效冻结」表述。

---

## 6. Interface and Data Contract Result

DTO 与 invariant 已进入：

- Architecture V1.0.0 §14（完整 Responsibility/Input/Output/Invariants/Owner/Restrictions/Trace/Error）
- Implementation Contract V1.0.0（实施细节 peer）
- INTERFACE_FREEZE.md 指针（防平行漂移）

确认覆盖：`LexicalWindowQuery` · `LexicalEdge` · `SegmentationPath` · `PathFineSpanView` · `PathDomainVoteResult` · `PathSentenceCandidate` · `GlobalSentenceCandidate` · `PrunedSegmentationPathTrace` · KenLM metadata mapping。

---

## 7. Ownership Result

Architecture §15 Ownership Matrix 保证决策唯一所有者。  
Runtime SSOT 与 Lattice Architecture 分层：公式 vs Fine Span/Path — **无双 SSOT**。

---

## 8. Trace / Regression / Acceptance Result

已写入 Architecture §16–§19：

- Path-aware Trace（utterance + per-path + prune）
- Regression（旧不得破坏 + Lattice 新不变量）
- Acceptance（22 条正式标准）

---

## 9. Provisional Items

```text
Path probe caps (maxActivePathsPerPosition=8, maxCompleteSegmentationPaths=8) — PROBE / NOT FINAL
CompatibilityGraph per-function KEEP/DELETE — PENDING PHASE 3 CODE AUDIT
Post-acceptance latency/memory thresholds
```

**Not provisional:** SegmentationPath SSOT · 1..5 windows · per-Path Vote/Assembly · global ≤16 · KenLM cross-Path scoring · no dual chain.

---

## 10. Remaining Old-Code Items（本轮不删代码）

| Symbol | Disposition | Phase |
|--------|-------------|-------|
| `runLtrFineSpanGeneration` | REPLACED (pending code) | 2 |
| `commitBestFormalFineSpan` | DELETED (pending code) | 2 |
| `generateLocalOptionsAtCursor` | REPLACED | 1–2 |
| cursor `= syllableEnd` | DELETED | 2 |
| utterance-once Vote caller | REPLACED | 3 |
| `lookupTermDomainTagsInScope` N+1 | DELETED | 5 |
| LTR-only freeze-contract asserts | REPLACED | 6 |

详见 Delete/Replace Matrix。

---

## 11. Documentation Compliance Checklist

```text
[x] 无 LTR-only 当前有效架构
[x] 无唯一 FormalFineSpan SSOT（有效层）
[x] 无全路径统一 Vote（有效层合同）
[x] 无单一 Formal Assembly 当前合同
[x] 无两套领域来源
[x] 无两个 Fine Span SSOT（有效层）
[x] 新主链完整
[x] 接口合同完整
[x] 数据合同完整
[x] Ownership 唯一
[x] Trace 完整
[x] Regression 完整
[x] Acceptance 完整
[x] 历史报告已正确标记
```

---

## 12. Final Decision

```text
READY FOR PHASE 1
```

Phase 1 仍禁止：切换生产 orchestrator、删除 LTR 入口、接 Vote/Assembly/KenLM、shadow 双链。  
Phase 1 允许：全句 1～5 WindowQuery → Recall key 去重 → LexicalEdge[] → 独立 test harness。
