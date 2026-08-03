<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Document Supersession Index

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Architecture | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Status | **ACTIVE** |

---

## 1. Current Sole Authorities

| Topic | Authority |
|-------|-----------|
| Fine Span / Window / Edge / Path / Path callers | Architecture V1.0.0 FROZEN + Implementation Contract V1.0.0 |
| **Phase 1 (Window/Edge/harness)** | **CLOSED** — [`Phase1_Final_Closure_Report_2026_07_27`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Final_Closure_Report_2026_07_27.md) · Acceptance Contract CURRENT · Developer Guide CURRENT |
| Domain Vote **formula** / Multi-Bucket SameDomain rules | Runtime_SSOT_Contract_Freeze (V1.2 Lattice caller note) |
| Framework freeze registry | `docs/fw-detector/freeze/FROZEN.md` |
| Document index | This file + RUNTIME_DOMAIN_DOCUMENT_INDEX |

---

## 2. Active docs UPDATED to Lattice (not historical)

| File | Action |
|------|--------|
| `docs/fw-detector/ARCHITECTURE.md` | UPDATE — Lattice main chain |
| `docs/fw-detector/freeze/FROZEN.md` | UPDATE — registry + main chain |
| `docs/fw-detector/INTERFACE_FREEZE.md` | UPDATE — Lattice DTO pointer |
| `docs/fw-detector/assembly/FROZEN_V1_2.md` | UPDATE — Path-scoped Assembly |
| `docs/fw-detector/kenlm/KENLM_RUNTIME.md` | UPDATE — cross-Path scoring boundary |
| `docs/fw-detector/diagnostics/FROZEN.md` | UPDATE — Path-aware Trace pointer |
| `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` | UPDATE — V1.2 Path caller + Fine Span SSOT cite |
| `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | UPDATE — Lattice Architecture entry |
| `docs/tone-v2/Lingua_Runtime_Evolution_Rule.md` | UPDATE — cite Lattice Architecture |
| Implementation Contract V1.0.0 | KEEP — normative peer |
| Delete/Replace Matrix | KEEP — code Phase tracking |

---

## 3. Historical / SUPERSEDED (preserve text; banner only)

These remain as evidence. **LTR-only Fine Span claims are not current architecture.**

| Document | Superseded claim | Replaced by | Retain |
|----------|------------------|-------------|--------|
| SoftBoundary Development Plan / Report / Supplement / Constraint Addendum / PreDev Audit (2026-07-22) | LTR unique Formal; cursor commit; windows 2..5 | Architecture V1.0.0 | YES HISTORICAL |
| SoftBoundary P5 Blocking / Final Compliance / P5 E2E reports | LTR unique production FineSpan entry | Architecture V1.0.0 | YES HISTORICAL |
| `FW_Repair_V4_CoarseSpan_FineSpan_SlidingWindow_Audit_2026_07_25.md` | LTR Generator = FineSpan SSOT | Architecture V1.0.0 | YES HISTORICAL |
| `FW_Repair_V4_LTR_FineSpan_Performance_Audit_2026_07_25.md` | LTR performance as frozen design | Architecture V1.0.0 (design); metrics still useful | YES HISTORICAL |
| `FW_Raw_Left_To_Right_FineSpan_Compatibility_Audit.md` | Pre-LTR global 2..5 overlap design notes | Architecture V1.0.0 | YES HISTORICAL |
| `FW_Repair_V4_Utterance_Recall_Cache_*` / Phase0 Coordinate reports | Describe LTR as production SSOT | Architecture V1.0.0 for Fine Span; coordinate SSOT KEEP | YES HISTORICAL |
| Lattice Pre-Development Audit / Phase0 Baseline | Pre-freeze readiness | Architecture V1.0.0 + Phase0.5 Seal | YES HISTORICAL |
| Interface_Data_Contract_Draft | Draft | Implementation Contract V1.0.0 + Architecture V1.0.0 | YES SUPERSEDED |
| Any doc asserting “no Beam ⇒ no multi-path” as freeze | Equating resource Beam ban with path ban | Architecture §1 | YES HISTORICAL |

Banner template for historical files:

```markdown
> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
```

---

## 4. Keyword disposition legend

| Disposition | Meaning |
|-------------|---------|
| KEEP | Still valid under Lattice |
| UPDATE | Active freeze doc rewritten |
| SUPERSEDE | Historical; bannered |
| DELETE DOCUMENT | Not used this round (prefer SUPERSEDE) |
| HISTORICAL ONLY | Evidence only |

---

## 5. Code symbols (not deleted this round)

See Delete/Replace Matrix — all production LTR symbols remain **PENDING** until Phase 2+.
