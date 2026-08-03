<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_0B_Real_SQLite_Baseline_Test_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.0B Real SQLite Baseline Test Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Companion | Batch 1.0B Development Report |

---

## 1. Commands

```powershell
cd electron_node/electron-node
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --no-coverage `
  --testPathPattern="length1.*sqlite.integration|connectivity-path-vote-bind"

# Regression
.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --no-coverage `
  --testPathPattern="recall-span-topk-v2.test|recall-span-topkv3|lattice-hard-block|freeze-contract.test"

npm run build:main
```

系统 Node 下 `better-sqlite3` ABI 不匹配 → **必须用 Electron**。

---

## 2–4. Environment / SQLite / Runtime

| Item | Value |
|------|-------|
| SQLite mode | File-backed temp copy of `node_runtime/lexicon/v3` |
| Runtime | Formal `LexiconRuntimeV2` |
| Fake runtime | None |
| Helper in dist | **No** |

---

## 5. Suite Counts

| Suite | Tests | Result |
|-------|-------|--------|
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | 7 | PASS |
| `length1-recall-edge-path.sqlite.integration.test.ts` | 7 | PASS |
| `connectivity-path-vote-bind.unit.test.ts` | 3 | PASS |
| **Batch 1.0B total** | **17** | **PASS** |
| Regression (v2/v3/HB/freeze) | 98 | PASS |

---

## 6–11. By Layer

| Layer | Evidence |
|-------|----------|
| Unit | Path/Vote/bind unit file（非 E2E） |
| SQLite | Raw SELECT seeded rows |
| Runtime | load ok；length=1 lookup **[]**；length=2 lookup OK |
| Recall | length=1 hits=0（门禁）；length=2 甲乙 golden |
| Edge/Path | length=2 贯通；length=1 empty 已记录 |
| Vote | domain 高速 votes；base_term 键不存在 |
| Cache | uniqueKey=1；不宣称 physicalSql=1 |

---

## 12–14. Observations

| Artifact | Key facts |
|----------|-----------|
| `length1_runtime_termLength_gate_baseline.json` | SQLite has rows；Runtime length=1 returns 0 |
| `length1_limit8_real_sqlite_baseline.json` | DB=9；runtimeReturned=0；LIMIT 逻辑未跑到 |
| `length1_tone_unsupported_baseline.json` | override 后仍空（门禁优先） |

---

## 15. 2–5 Regression

PASS（98）。另：content golden `甲乙` / `exact_base`。

---

## 16. Production Build / dist

`build:main` PASS；`batch1_0b_dist_test_resource_inventory.json` → **CLEAN**。

---

## 17. Failures

无测试失败。功能目标「length=1 产出 Candidate」**未达成**（真实门禁），故 Functional Verdict = CONDITIONAL。

---

## 18. Known Defects

1. **P0** `lookupTier` termLength&lt;2  
2. **P0** LIMIT=8（待门禁修复后复测）  
3. **P1** tone unsupported / HB 省略号  

---

## 19. Functional Test Verdict

```text
BATCH 1.0B REAL SQLITE BASELINE:
CONDITIONAL

REAL RUNTIME PARTIALLY VERIFIED
BLOCKERS MUST BE RESOLVED BEFORE BATCH 1.1 COMPLETION / GATE
```

下一步：Batch 1.1 修复 `lookupTier` 门禁后重跑 length=1 全链；**禁止**进入 Batch 2。
