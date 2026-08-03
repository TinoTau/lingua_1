<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_0C_Base_Length1_Runtime_Gate_Alignment_Test_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.0C Base Length-1 Runtime Gate Alignment Test Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Companion | Batch 1.0C Development Report |
| ABI | Electron (`ELECTRON_RUN_AS_NODE=1`) |

---

## 1. Commands

```powershell
cd electron_node/electron-node
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --no-coverage `
  --testPathPattern="lexicon-runtime-v2-length1-base.contract|recall-span-topk-v2-length1.sqlite.integration|length1-recall-edge-path.sqlite.integration|connectivity-path-vote-bind"

# 2–5 regression
.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --no-coverage `
  --testPathPattern="recall-span-topk-v2.test|recall-span-topkv3|lattice-hard-block|freeze-contract.test|lexicon-runtime-v2.test"

npm run build:main
```

---

## 2. Electron ABI Environment

| Item | Value |
|------|-------|
| Runner | `electron.exe` + Jest |
| SQLite | File-backed temp copy of `node_runtime/lexicon/v3` |
| Runtime | Formal `LexiconRuntimeV2.loadFromBundleDir` |
| Fake / mock Runtime | **None** |
| Helper | Reused `length1-real-sqlite.test.helpers.ts` |

---

## 3. Suite Counts

| Suite | Tests | Result |
|-------|------:|--------|
| `lexicon-runtime-v2-length1-base.contract.test.ts` | 9 | PASS |
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | 11 | PASS |
| `length1-recall-edge-path.sqlite.integration.test.ts` | 9 | PASS |
| `connectivity-path-vote-bind.unit.test.ts` | 3 | PASS |
| **Batch 1.0C functional total** | **32** | **PASS** |
| 2–5 regression (listed pattern) | 100 | PASS |

---

## 4. Runtime Contract Tests

| Assertion | Result |
|-----------|--------|
| base plain length=1 → 点 | PASS |
| base tone length=1 → dian3→点 | PASS |
| 变形：我 / 拿 / 哪 / 吗 | PASS |
| base length=2 甲乙 | PASS |
| domain length=1 → [] | PASS |
| idiom length=1 → [] | PASS |
| fuzzy builder length=1 → [] | PASS |
| disabled ce → [] | PASS |
| alias 惦 可出现在 raw Runtime（Recall 另滤） | PASS |

---

## 5. SQLite Integration Tests

Seed 行（含 `repair_target` / `is_alias` / tone）raw SQL 可读；checksum 重签后 Runtime `status=ok`。

---

## 6. Recall Integration Tests

| Case | Result |
|------|--------|
| plain 我 → 1 Candidate；domains=[]；repairTarget=false | PASS |
| tone 点 → tone_exact；source exact_base | PASS |
| alias 过滤；disabled 空 | PASS |
| DB repair_target=1 → Candidate repairTarget=false | PASS |
| domain spy 不可达 | PASS |
| fuzzy flag 忽略；无 fuzzy kind；无 惦 | PASS |
| length=2 甲乙 golden | PASS |

---

## 7. Other-Tier Non-Broadening Tests

命名覆盖：

- `does not broaden domain tier to length1`
- `does not enable fuzzy length1`
- `does not enable alias expansion length1`
- `does not enable idiom length1`
- `does not enable parent fragment length1`

全部 PASS。

---

## 8. Candidate→Edge→Path

| Scenario | Result |
|----------|--------|
| 「点」单音节 → lexical edge → retained path；singleCharLexicalEdgeUsed≥1 | PASS |
| 「甲乙丙丁戊」中「丙」length=1 + 两侧 bigram | PASS |

---

## 9. Vote

| Case | Result |
|------|--------|
| base 点 → domainScores 空 | PASS |
| domain 高速 → tourism_transport=1；无 base_term 键 | PASS |

---

## 10. LIMIT=8 Observation

| Field | Value |
|-------|------:|
| databaseCandidateCount | 9 |
| runtimeReturnedCount | 8 |
| visibleEligibleCount | 1 |
| finalCandidateCount | 1 |
| surfaceExactAtPosition9Reachable | false |
| observedFalseUnique | **true** |

Artifact: `docs/tone-v2/_audit_scratch/lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json`

---

## 11. Tone Unsupported Observation

| Field | Value |
|-------|-------|
| observedBehavior | plain_fallback_when_tone_unsupported |
| finalCandidateCount | 1 |
| finalWord | 我 |
| toneLookupStage | plain_only_no_pattern |

Artifact: `length1_tone_unsupported_baseline.json`

---

## 12. Diagnostics

Phase1 harness（Lattice window min=1）对「点」：

- `singleCharWindowCount/RecallCount/HitCount/CandidateCount/LexicalEdgeCount/CandidateCapHitCount` ≥ 1

语义见开发报告 §18。未手工 increment production counter。

---

## 13. 2–5 Regression

100 PASS（含 Runtime / Recall v2/v3 / Hard-block / freeze）。内容级：`甲乙`。

---

## 14. Production Build / dist

| Check | Result |
|-------|--------|
| `build:main` | SUCCESS |
| helper in dist | **False** |
| contract/integration tests in dist | **False** |
| baseline JSON in dist | **False** |
| inventory | `batch1_0c_dist_test_resource_inventory.json` → CLEAN |

---

## 15. Failures

无。

---

## 16. Known Defects

1. LIMIT=8 假唯一（捌）— 留给 Batch 1.1  
2. 第 9 名 surface 不可达 — 留给 Batch 1.1  
3. Tone unsupported plain fallback 策略未冻结决策 — 留给 Batch 1.1  

---

## 17. Functional Verdict

```text
BATCH 1.0C BASE LENGTH-1 RUNTIME GATE ALIGNMENT:
PASS

BASE EXACT/TONE LENGTH-1 CONTRACT ALIGNED
OTHER TIERS REMAIN FROZEN
READY FOR BATCH 1.1 REPAIR
```
