<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1A_Truncation_Aware_Uniqueness_Test_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1A Truncation-aware Uniqueness Test Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Companion | Batch 1.1A Development Report |
| ABI | Electron (`ELECTRON_RUN_AS_NODE=1`) |

---

## 1. Commands

```powershell
cd electron_node/electron-node
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --no-coverage `
  --testPathPattern="length1-truncation.sqlite.integration|recall-span-topk-v2-length1.sqlite.integration|length1-recall-edge-path.sqlite.integration|lexicon-runtime-v2-length1-base.contract|connectivity-path-vote-bind"

.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --no-coverage `
  --testPathPattern="recall-span-topk-v2.test|recall-span-topkv3|lattice-hard-block|freeze-contract.test|lexicon-runtime-v2.test"

npm run build:main
```

---

## 2. Electron ABI

正式 v3 temp bundle + `LexiconRuntimeV2.loadFromBundleDir`；无 Fake Runtime。

---

## 3. Suite Counts

| Suite | Tests | Result |
|-------|------:|--------|
| `recall-span-topk-v2-length1-truncation.sqlite.integration.test.ts` | 12 | PASS |
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | 11 | PASS |
| `length1-recall-edge-path.sqlite.integration.test.ts` | 10 | PASS |
| `lexicon-runtime-v2-length1-base.contract.test.ts` | 9 | PASS |
| `connectivity-path-vote-bind.unit.test.ts` | 3 | PASS |
| **Functional total** | **45** | **PASS** |
| 2–5 regression pattern | 100 | PASS |

---

## 4. Real SQLite Setup

`createLength1TempSqliteBundle` + `buildSameKeyLength1Rows` / `batch10bLimit8Rows` / standard seeds。

---

## 5. Repair-Before Baseline

`lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json` **保留未覆盖**：

| Field | Value |
|-------|------:|
| databaseCandidateCount | 9 |
| runtimeReturnedCount | 8 |
| visibleEligibleCount | 1 |
| finalCandidateCount | 1 |
| observedFalseUnique | true |

---

## 6–7. Plain / Tone False Unique

| Case | Key | Result |
|------|-----|--------|
| Plain | fu（9 rows / 7 alias） | final=0 |
| Tone | shi4 | final=0 |
| Legacy lim1 | lim | final=0；`falseUniqueRejected=true` |

---

## 8–9. Plain / Tone True Unique

| Case | Result |
|------|--------|
| ke / 可 | Candidate=1 |
| xu1 / 需 | Candidate=1；tone_exact |

---

## 10. Non-Truncated Filtered Unique

mu：3 rows &lt; 8，2 alias → eligible=1 → Candidate=**牧** PASS。

---

## 11–12. Truncated Zero / Multiple Eligible

| Case | Result |
|------|--------|
| All-alias top8 (ze) | empty |
| 8 eligible, surface miss (hao) | empty（非 Top1） |

---

## 13. Metamorphic

bi：eligible 位于 top8 末位；surface=俾 仍因 truncation 拒绝。另：fu/shi/hao/标准种子多 key。

---

## 14. Surface Behavior Frozen

na3：fetched-set 内「哪」消歧 PASS。Rank9 玖仍 unreachable（Known Defect）。

---

## 15–16. Edge / Vote

| Case | Result |
|------|--------|
| 点 true unique | Edge + retained Path |
| lim false unique | candidates=0；edges=0；vote=0 |

---

## 17. Diagnostics

False unique 不增加 lexical Candidate/Edge；真唯一 singleChar* 仍可非零（既有 harness）。

---

## 18. 2–5 Regression

100 PASS（Runtime / Recall v2·v3 / HB / freeze）。

---

## 19. Production Build / dist

| Check | Result |
|-------|--------|
| build:main | SUCCESS |
| helper / truncation test in dist | False |
| inventory | `batch1_1a_dist_test_resource_inventory.json` CLEAN |

---

## 20. Failures

无。

---

## 21. Known Defects

1. Rank9 surface unreachable → Batch 1.1B  
2. Tone unsupported policy → Batch 1.1C  
3. HB ellipsis → Batch 1.1D  

---

## 22. Functional Verdict

```text
BATCH 1.1A TRUNCATION-AWARE UNIQUENESS:
PASS

FALSE UNIQUE REJECTED
TRUE UNIQUE PRESERVED
READY FOR STAGE 4 GENERALIZATION AUDIT
```
