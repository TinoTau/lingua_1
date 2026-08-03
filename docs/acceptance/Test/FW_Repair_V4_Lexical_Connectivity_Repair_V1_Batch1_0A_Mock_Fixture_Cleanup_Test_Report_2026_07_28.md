<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_0A_Mock_Fixture_Cleanup_Test_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.0A Mock / Fixture Cleanup Test Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Companion | Batch 1.0A Development Report |

---

## 1. Commands

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="lattice-hard-block-filter|connectivity-batch1-length1|lexicon-v2/recall-span-topk|span-assembly-v4/(phase1-window|phase2-path|freeze)|freeze-contract" --no-coverage
npx jest --testPathPattern="span-assembly-v4/" --no-coverage
```

Dist scan: `rg` / `Test-Path` for `createBatch1FixtureRuntime`, `connectivity-batch1-fixture`, `BATCH1_BASE_TERMS` under `dist/main`.

---

## 2. Counts

| Stage | Suites | Tests |
|-------|--------|-------|
| Before Batch1 fake suite (approx) | 3 Batch1 files | 26 |
| After 1.0A retained Batch1-related | 2 files | **9**（HB 6 + unit chain 3） |
| Removed | — | **17** |
| Regression (targeted) | 10 | 136 PASS |
| Regression (`span-assembly-v4/`) | 29 | 185 PASS |

---

## 3. PASS / FAIL

| Check | Result |
|-------|--------|
| `build:main` | PASS |
| dist inventory | **CLEAN** |
| Hard-block tests | PASS (6) |
| unit chain (Path/Vote/bind) | PASS (3) |
| recall V2/V3 + phase harness + freeze | PASS |
| full span-assembly-v4 | PASS |
| Fake runtime remaining in src | **NONE** |

---

## 4. Deleted tests → 1.0B replacement

| Removed | Replacement in Batch 1.0B |
|---------|---------------------------|
| length=1 tone/plain/ambiguity/cap/alias/domain/fuzzy | temp SQLite `base_lexicon` + real `LexiconRuntimeV2` |
| call-site exactTopK/domainIds | same + spy on V3 args |
| cache logical vs physical | real utterance cache + SQL counters |
| Candidate→Edge via Recall | real Recall hits → `buildLexicalEdges` |
| HB + Recall「吗」 | HB unit already kept；Recall 段用真实 runtime 重建 |

---

## 5. Retained test scope

- **Hard-block**：独立 D 类，未改业务。  
- **Path/Vote/bind**：明确 **unit only / not E2E Recall**。

---

## 6. Dist inventory

见 [`batch1_mock_cleanup_dist_inventory.json`](./_audit_scratch/lattice_v1_batch1_generalization/batch1_mock_cleanup_dist_inventory.json)：

```text
overall: CLEAN
connectivity-batch1-fixture.js: absent
```

---

## 7. Final Test Verdict

```text
BATCH 1.0A MOCK / FIXTURE CLEANUP TESTS: PASS
READY FOR BATCH 1.0B REAL SQLITE BASELINE
```
