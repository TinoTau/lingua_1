# FW_V4 Documentation Consolidation Report — 2026-08-03

| Field | Value |
|-------|-------|
| Nature | **DOCUMENT CONSOLIDATION ONLY** |
| Code / Runtime / SQLite | **UNCHANGED** |
| Freeze Identity | **UNCHANGED**（tag / checksum / Lexicon identity 未改） |
| Recovery Baseline | **FW_V4_FREEZE_2026_08_03** |
| Verdict | **DOCUMENTATION_CONSOLIDATED** |

---

## 1. Current SSOT Inventory

唯一 CURRENT 入口：[`docs/current/INDEX.md`](../../current/INDEX.md)

| 主题 | 权威路径 | 备注 |
|------|----------|------|
| Document Index | `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | 已重写为层级导航 |
| Framework Snapshot | `docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/` | Recovery Baseline |
| Lattice Architecture | `docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md` | Fine Span SSOT |
| Runtime SSOT | `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` | Vote / Cap / KenLM boundary |
| Evolution Rule | `docs/tone-v2/Lingua_Runtime_Evolution_Rule.md` | |
| Atomicity | `docs/tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md` | |
| Tone Mapping | `docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md` | |
| Tone Contract | `docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md` | |
| Implementation Contract | `docs/tone-v2/..._Implementation_Contract_V1.0.0_....md` | |
| Lexicon Domain | `docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md` | |
| Framework Freeze Registry | `docs/fw-detector/freeze/FROZEN.md` | |
| Architecture / Domain / Assembly / KenLM / Validator / Diagnostics | `docs/fw-detector/**` | 边界合同，见 current INDEX |

**统一规则：** 无 `CURRENT_V2` / `LATEST` / `FINAL` / `NEW` 平行权威。Sole Authorities 正文保留原路径（避免破坏 Snapshot / 代码引用）；语义权威由 `docs/current/` + Runtime Index 唯一指向。

---

## 2. Supporting Contracts Inventory

入口：[`docs/supporting/INDEX.md`](../../supporting/INDEX.md)

覆盖：Ownership / Domain / Assembly / KenLM Runtime / Context Prior / Diagnostics / Interface Freeze / Implementation Contract / Recovery Guide / Snapshot Summary。

**规则：** Supporting 只解释 CURRENT，不得重新定义 Vote / Path / Cap / Tone Mapping / Atomicity。

---

## 3. Acceptance Inventory

入口：[`docs/acceptance/README.md`](../README.md)

| Bucket | Count | Path |
|--------|------:|------|
| Development | 32 | `docs/acceptance/Development/` |
| Test | 16 | `docs/acceptance/Test/` |
| Freeze | 2* | `docs/acceptance/Freeze/` |
| Regression | 20 | `docs/acceptance/Regression/` |
| **Total migrated** | **69** | （脚本首轮）+ 本报告 |

\* 含 `FW_V4_FREEZE_2026_08_03_Code_and_Documentation_Freeze_Report.md` 与本 Consolidation Report。

**角色：** Evidence only — 不得作为 CURRENT。

---

## 4. Historical Inventory

入口：[`docs/archive/README.md`](../../archive/README.md)

| Status | Count | Path |
|--------|------:|------|
| RETIRED | 10 | `docs/archive/RETIRED/` |
| SUPERSEDED | 17 | `docs/archive/SUPERSEDED/` |
| EXPERIMENT | 0 | `docs/archive/EXPERIMENT/` |
| HISTORICAL | 203 | `docs/archive/HISTORICAL/` |
| **Total** | **230** | |

每份归档文首 Metadata：`Status` · `Superseded By`。**禁止删除。**

迁移清单机读：`docs/tone-v2/_doc_consolidation_migration.json`

---

## 5. Duplicate Cleanup

| 主题 | CURRENT | 历史重复处置 |
|------|---------|--------------|
| Architecture | Lattice V1.0.0 + `fw-detector/ARCHITECTURE.md` | SoftBoundary / LTR Architecture audits → Archive RETIRED/HISTORICAL |
| Atomicity | Atomicity Closure SSOT Freeze | Development/Test reports → Acceptance |
| Runtime SSOT | `Runtime_SSOT_Contract_Freeze.md` | Recovery / readiness / presence audits → Acceptance 或 Archive |
| Assembly | `assembly/FROZEN_V1_2.md` | 旧 Assembly 设计/审计 → Archive |
| Domain | Lexicon Domain Contract + DSU + Domain Recall | Multi_Domain_* 旧方案 → Archive |
| Validator | `INTERFACE_FREEZE.md` + Atomicity Gate | Gate reports → Acceptance |

结果：每个主题 **一个** CURRENT 指针；历史副本全部进 Archive/Acceptance，旧路径留 stub。

---

## 6. Index Update

| 文件 | 变更 |
|------|------|
| `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | 重写：Reading Order · CURRENT · Supporting · Acceptance · Archive |
| `docs/current/INDEX.md` | **新建** CURRENT 入口 |
| `docs/supporting/INDEX.md` | **新建** Supporting 入口 |
| `docs/acceptance/README.md` | **新建** |
| `docs/archive/README.md` | **新建** |
| `docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md` | 增加 Documentation Hierarchy 指针 |

---

## 7. Directory Structure

```text
docs/
  framework_snapshots/
    FW_V4_FREEZE_2026_08_03/     # Recovery Baseline（身份未改）
  current/
    INDEX.md                     # CURRENT 最小入口
  supporting/
    INDEX.md                     # Supporting 入口
  acceptance/
    Development/
    Test/
    Freeze/
    Regression/
    README.md
  archive/
    RETIRED/
    SUPERSEDED/
    EXPERIMENT/
    HISTORICAL/
    README.md
  tone-v2/
    <Sole Authorities>           # 正文保留
    <MOVED stubs>                # 旧链跳转
  fw-detector/
    <boundary contracts>         # CURRENT 边界合同正文
```

---

## 8. Migration Summary

| Action | Count |
|--------|------:|
| Acceptance `git mv` / rename | 69 |
| Archive `git mv` / rename | 230 |
| CURRENT stay in `tone-v2/` | 10 |
| Old-path stubs left | 299 |
| Deleted documents | **0** |

脚本：`docs/tone-v2/_audit_scratch/consolidate-asr-docs.mjs`

---

## 9. Future Reading Order

```text
1. Framework Snapshot (FW_V4_FREEZE_2026_08_03)
2. CURRENT (docs/current/INDEX.md → Sole Authorities)
3. Supporting (docs/supporting/)
4. Acceptance (docs/acceptance/) — verify only
5. Archive (docs/archive/) — trace only
```

禁止：从历史报告重新设计已冻结 Framework。

---

## 10. Target List

| ID | Target | Status |
|----|--------|--------|
| T1 | CURRENT Inventory | **DONE** |
| T2 | Supporting Inventory | **DONE** |
| T3 | Acceptance Inventory | **DONE** |
| T4 | Archive Inventory | **DONE** |
| T5 | Duplicate Cleanup | **DONE** |
| T6 | Index Update | **DONE** |
| T7 | Snapshot Update（Recovery Guide 文档体系） | **DONE**（仅导航；身份未改） |
| T8 | Directory Cleanup | **DONE** |
| T9 | Naming Cleanup（禁 FINAL/LATEST 平行权威） | **DONE** |
| T10 | Migration Report（本文件） | **DONE** |

---

## 11. Check List

```text
[x] 未修改代码
[x] 未修改 Runtime
[x] 未修改 Snapshot 身份（checksum / tag / Lexicon / 业务合同正文未改）
[x] CURRENT 唯一（docs/current + Runtime Index）
[x] Supporting 完整（docs/supporting/INDEX.md）
[x] Acceptance 独立（docs/acceptance/）
[x] Archive 完整（230 + metadata；未删除）
[x] Index 更新
[x] Recovery Guide / Freeze Summary 文档体系说明已更新
[x] 生成整理报告
```

注：Checklist 原文「未修改 Snapshot」指 **不改 Freeze 身份与业务合同**；按任务 §十一，仅在 Recovery Guide / 入口 Summary 增加文档阅读顺序。

---

## 12. Final Verdict

```text
DOCUMENTATION_CONSOLIDATED
```

后续所有 ASR 后处理开发（KenLM / Lexicon Expansion / Context Prior / LLM）必须建立在：

```text
FW_V4_FREEZE_2026_08_03
↓
CURRENT SSOT (docs/current/INDEX.md)
```

之上。不得新增平行 CURRENT；不得以 Archive / Acceptance 重新设计已冻结 Framework。
