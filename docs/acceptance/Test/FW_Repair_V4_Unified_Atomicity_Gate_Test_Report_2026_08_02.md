<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Unified_Atomicity_Gate_Test_Report_2026_08_02.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Unified Formal-Term Atomicity Gate Test Report

**Date:** 2026-08-02  
**Verdict:** `ATOMICITY_GATE_PASS`

---

## 1. Environment

| Item | Value |
|------|-------|
| Package cwd | `electron_node/electron-node` |
| Validator SSOT | `scripts/lexicon/lib/atomicity-validator.cjs` |
| Candidate A/B | `node_runtime/lexicon/_rebuild_candidate[_b]` |
| Mode under test (rebuild) | audit |

---

## 2. Typecheck / Build

| Step | Result |
|------|--------|
| `npm run build:main` | PASS（patch validators compile） |
| `npm run lexicon:test:atomicity` | PASS |
| `npm run test:lexicon -- --testPathPattern=atomicity-multipath` | PASS (4) |
| `jest --testPathPattern=GATE-ATOMICITY\|freeze-contract` | PASS（含 GATE-ATOMICITY-1） |

---

## 3. Unit Tests (General Rules)

| Case | Expected | Actual |
|------|----------|--------|
| 上线计划 | REJECT composite (action-object) | PASS ACTION_OBJECT_PHRASE |
| 接口文档 | REJECT composite (noun-noun business) | PASS NOUN_NOUN_BUSINESS_PHRASE |
| 蓝莓马芬 | UNRESOLVED needs exception | PASS |
| 国家博物馆 | UNRESOLVED | PASS |
| 焦糖玛奇朵 | UNRESOLVED | PASS |
| 内科医生 | UNRESOLVED | PASS |
| 大床房 | ACCEPT | PASS |
| 候选 / 计划 | ACCEPT | PASS |
| fixed_product + reason | ACCEPT_EXCEPTION | PASS |
| termType without reason | MISSING_EXCEPTION_METADATA | PASS |
| no surface blacklist in source | PASS | PASS |

---

## 4. Write-Path Integration

| Path | Hook | Result |
|------|------|--------|
| Full Rebuild | before term INSERT | PASS + reports |
| Patch V3 | term add in validator | PASS (compile + bridge) |
| Patch V4 | addTerm in validator | PASS (compile + bridge) |
| Industry Import | validateIndustryEntry | PASS (multipath + build-patch wires atoms) |
| Supplemental | same Full Rebuild path | PASS (不可绕过) |

同一 TermDraft 经 core / patch bridge / industry 得相同 decision。

---

## 5. Audit / Enforce Mode Tests

| Mode | REJECT_COMPOSITE write | Result |
|------|------------------------|--------|
| audit | allowWrite=true | PASS |
| enforce | blocked=true | PASS (unit + smoke) |

Audit Full Rebuild：term 仍 10061，无 silent drop。

---

## 6. Source Schema Validation

- Optional `term_type` / `exception_reason` documented on review + supplemental  
- tags / remove：无需  
- 现有 CSV 未改内容；缺列可解析  

---

## 7. Atomicity Report Validation

| Check | Result |
|-------|--------|
| JSON exists | PASS |
| CSV exists | PASS |
| total == 10061 | PASS |
| 上线计划 REJECT | PASS |
| 接口文档 REJECT | PASS |
| 蓝莓马芬 UNRESOLVED | PASS |
| 大床房 ACCEPT | PASS |

Summary：ACCEPT 9247 · REJECT 74 · UNRESOLVED 740 · EXCEPTION 0。

---

## 8. Two Full Rebuilds + Content Hash

```text
CONTENT_HASH_A = CONTENT_HASH_B = production
= 2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f
```

SQLite checksum A=B：`38c376c4af1a4da454c4f6543142b794ff3a90730b8fdd1c6543308885edd222`

---

## 9. Exact Recall / dialog_200

| Check | Result |
|-------|--------|
| schema gate candidate | PASS |
| exactEqual | true |
| dialog completed | 200/200 |
| businessEqual | true |
| 上线计划/接口文档 present | true |

---

## 10. Freeze Contract

| Gate | Result |
|------|--------|
| GATE-ATOMICITY-1 | PASS |
| Lexicon_Domain_Contract_Freeze_V1 §8 | documented |

---

## 11. Final Verdict

```text
ATOMICITY_GATE_PASS
```
