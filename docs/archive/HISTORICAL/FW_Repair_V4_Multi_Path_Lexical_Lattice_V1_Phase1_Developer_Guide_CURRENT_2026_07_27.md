<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Developer_Guide_CURRENT_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Developer Guide (CURRENT)

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Status | **CURRENT** |
| Phase 1 | **CLOSED** |

---

## 1. What Phase 1 delivered

```text
Coordinate → buildLexicalWindowQueries (1..5)
  → latticeHardBlockFilter
  → recallTopKForWindows (+ utterance cache)
  → buildLexicalEdges
```

Entry: `runPhase1WindowEdgeHarness` — **tests / offline probes only**.

---

## 2. Code map

| Concern | File |
|---------|------|
| Window construction core | `window-construction-core.ts` |
| Lattice windows | `build-lexical-window-queries.ts` |
| Hard-block | `lattice-hard-block-filter.ts` |
| Recall | `recall-topk-for-windows.ts` |
| Edges + Evidence | `build-lexical-edges.ts` |
| Harness | `phase1-window-edge-harness.ts` |
| Recall SSOT doc | `docs/fw-detector/recall/DOMAIN_RECALL.md` |

---

## 3. Frozen rules (do not regress)

1. Full traversal of recallable Windows — no attempt budget gate  
2. `logicalWindowRecallCount` / `physicalSqlStatementCount` are diagnostics only  
3. Evidence OR → then identity first-wins  
4. Production stays on LTR until Phase 2 cutover  

---

## 4. How to verify

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="residual-cleanup|b1-recall-full-traversal|phase1-window-edge-harness\.test|freeze-contract"
```

Offline probe (optional): `docs/tone-v2/_audit_scratch/phase1-window-edge-dialog200-probe.mjs`

---

## 5. Do not

- Wire harness into `span-assembly-v4-orchestrator`  
- Reintroduce `ngramQueryCount` / `maxSqlPerUtterance` gates  
- Implement Path / Vote / KenLM under a “Phase 1” label  
- Overwrite files under `_audit_scratch/historical/`  

---

## 6. Next

Phase 2 Pre-Development Audit only after reading Phase 1 Final Closure Report.
