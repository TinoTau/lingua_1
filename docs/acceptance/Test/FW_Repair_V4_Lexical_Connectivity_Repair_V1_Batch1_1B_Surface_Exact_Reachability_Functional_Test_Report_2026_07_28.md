<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1B_Surface_Exact_Reachability_Functional_Test_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1B Surface Exact Reachability Functional Test Report
。
| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Companion | Batch 1.1B Development Report |
| ABI | Electron (`ELECTRON_RUN_AS_NODE=1`) |
| Runtime | Real temp SQLite + `LexiconRuntimeV2.loadFromBundleDir`（无 Mock Runtime） |

---

## 1. Final Verdict

```text
BATCH 1.1B

STAGE1 CONTRACT:
PASS

STAGE2 DEVELOPMENT:
PASS

STAGE3 FUNCTIONAL TEST:
PASS

SURFACE EXACT REACHABILITY
IMPLEMENTED

NO REGRESSION

READY FOR GENERALIZATION AUDIT
```

---

## 2. Commands

```powershell
cd electron_node/electron-node
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --forceExit --no-coverage `
  --testPathPattern="length1-surface-exact|length1-truncation|length1-recall-edge-path|lexicon-runtime-v2-length1-base.contract|recall-span-topk-v2-length1.sqlite|connectivity-path-vote-bind|batch1-1a-stage4|recall-span-topk-v2.test|recall-span-topkv3|lattice-hard-block|freeze-contract.test|lexicon-runtime-v2.test"

npm run build:main
```

---

## 3. Suite Counts

| Suite | Result |
|-------|--------|
| `recall-span-topk-v2-length1-surface-exact.sqlite.integration.test.ts`（NEW 1.1B） | PASS（14） |
| `recall-span-topk-v2-length1-truncation.sqlite.integration.test.ts`（1.1A） | PASS |
| `batch1-1a-stage4-generalization.audit.test.ts`（期望已按 1.1B identity 语义对齐） | PASS |
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | PASS |
| `length1-recall-edge-path.sqlite.integration.test.ts` | PASS |
| `lexicon-runtime-v2-length1-base.contract.test.ts` | PASS |
| `connectivity-path-vote-bind.unit.test.ts` | PASS |
| `recall-span-topk-v2.test.ts` | PASS |
| `recall-span-topkv3.test.ts` | PASS |
| `lattice-hard-block-filter.test.ts` | PASS |
| `freeze-contract.test.ts` + pinyin-ime freeze | PASS |
| `lexicon-runtime-v2.test.ts` | PASS |

**合计：13 suites / 175 PASS**

---

## 4. Batch 1.1B Functional Matrix

| Case | Expect | Result |
|------|--------|--------|
| rank1 | ambiguity page hit；kind=`exact_base` | PASS |
| rank8 | LIMIT 边界 surface 仍命中 | PASS |
| rank9 | ambiguity 页无 surface；exact + Recall 命中 玖 | PASS |
| rank20 | deep surface exact 可达；LIMIT 仍为 8 | PASS |
| absent | exact 0 + Recall empty | PASS |
| alias | exact 有行但 eligibility 拒绝 | PASS |
| disabled | SQL `enabled=1` → 0 行 | PASS |
| duplicate | PK 阻止真实 duplicate；exact ≤1 | PASS |
| plain | 无 tone pattern 的 exact 路径 | PASS |
| tone | tone composite exact 路径 | PASS |
| priority | ambiguity Candidate 不被覆盖 | PASS |
| LIMIT=2 | Runtime 无开放 sqlLimit | PASS |
| 1.1A compat | truncated + 无 identity → empty | PASS |
| residual identity | truncated + surface=residual → exact 接受 | PASS |

---

## 5. Architecture / Contract / API / Call Graph

与 Development Report §3–6 一致。要点：

- Ambiguity first；only-if-empty exact  
- Runtime rows-only；Recall 决策  
- CR **1.0.6**；1.1A CR **未改语义**  

---

## 6. SQL / Cache

| Item | Status |
|------|--------|
| Point lookup autoindex | PASS（Stage1 EXPLAIN） |
| No new index | PASS |
| Cache key isolation | PASS（编译 + 行为） |
| Ambiguity LIMIT=8 unchanged | PASS |

---

## 7. Regression

| Area | Status |
|------|--------|
| Batch 1.1A truncation / exact-limit（无 identity surface） | PASS |
| Batch 1.1B surface exact | PASS |
| Length1 Runtime contract | PASS |
| Recall v2/v3 | PASS |
| Connectivity / Edge / Vote bind | PASS |
| Freeze | PASS |
| Hard-block | PASS |
| TopKV3 | PASS |

说明：原 Stage4 / metamorphic 用例若 `windowText===residual`，在 1.1B 下应经 exact **接受**（identity，非 inferred uniqueness）。回归用例已改为「无 identity surface」继续锁定 1.1A truncation reject；rank9 用例改为期望命中。

---

## 8. Performance

- 有 Candidate：无 extra SQL  
- 无 Candidate：+1 点查（LIMIT 2）  
- 无 probe / COUNT(*) / scan  

---

## 9. Build / dist

| Item | Result |
|------|--------|
| `npm run build:main` | SUCCESS |
| dist 含 exact APIs | YES |
| test/audit/helpers 进入 dist | **CLEAN** |
| Inventory | `lattice_v1_batch1_1b/batch1_1b_stage3_dist_test_resource_inventory.json` → **CLEAN** |

生产未纳入：probe / audit scratch JSON（仅 `_audit_scratch`）。

---

## 10. KEEP / MODIFY / DELETE / NEW

| | |
|--|--|
| **KEEP** | 1.1A truncation Contract；LIMIT=8；Edge/Vote/Assembly/KenLM |
| **MODIFY** | Recall wiring；Stage4/1.1A 无 identity 断言窗口 |
| **DELETE** | 无 |
| **NEW** | Runtime exact APIs；1.1B SQLite suite；本报告 |

---

## 11. Target List

```text
[x] 冻结 Development Contract
[x] 冻结调用时机 / 优先级 / Runtime API / LIMIT=2
[x] 核实 duplicate schema + Tone EXPLAIN
[x] 复用 Candidate kind
[x] 开发 Runtime + Recall
[x] 新增 SQLite tests
[x] 回归 Batch1.1A + Batch1.1B
[x] build + dist clean
[x] 输出 Development Report
[x] 输出 Functional Test Report
```

---

## 12. Check List

```text
[x] 未修改 Batch1.1A Contract
[x] 未扩大 LIMIT
[x] 未新增 SQLite index
[x] 未新增 Runtime decision
[x] 未新增 Candidate kind
[x] 未新增 Shadow Path
[x] 未修改 Edge / Vote / Assembly / KenLM
[x] 未进入 Batch1.1C / Batch2
```

---

## 13. Evidence Paths

| Artifact | Path |
|----------|------|
| Stage1 schema/EXPLAIN | `_audit_scratch/lattice_v1_batch1_1b/stage1_schema_explain_surface_exact.json` |
| Rank9 after | `_audit_scratch/lattice_v1_batch1_1b/surface_rank9_after.json` |
| Dist inventory | `_audit_scratch/lattice_v1_batch1_1b/batch1_1b_stage3_dist_test_resource_inventory.json` |
| CR | Implementation Contract **1.0.6** |

---

## 14. Next

```text
READY FOR GENERALIZATION AUDIT
```

禁止在本轮进入 Batch 1.1C / Batch 2 / Production cutover。
