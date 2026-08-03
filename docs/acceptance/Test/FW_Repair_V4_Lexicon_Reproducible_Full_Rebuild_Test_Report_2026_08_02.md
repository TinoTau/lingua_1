<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexicon_Reproducible_Full_Rebuild_Test_Report_2026_08_02.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexicon Reproducible Full Rebuild Test Report

**Date:** 2026-08-02  
**Scope:** Source formalization + Full Rebuild reproducibility only  
**Verdict:** `REPRODUCIBLE_BUILD_PASS`

---

## 1. Test Environment

| Item | Value |
|------|-------|
| Repo | `D:/Programs/github/lingua_1` |
| Package cwd | `electron_node/electron-node` |
| Formal Source | `electron_node/docs/lexicon-assets/full_rebuild_v1/` |
| Production (read-only) | `node_runtime/lexicon/v3` (or configured v3 path) |
| Candidate A | `node_runtime/lexicon/_rebuild_candidate` |
| Candidate B | `node_runtime/lexicon/_rebuild_candidate_b` |
| ABI | Electron `ELECTRON_RUN_AS_NODE=1` for sqlite + runtime probes |

Artifacts:

- `docs/tone-v2/_audit_scratch/repro_rebuild_audit/reconcile.json`
- `docs/tone-v2/_audit_scratch/repro_rebuild_audit/runtime_compare.json`
- Probes: `repro-rebuild-reconcile.mjs`, `repro-rebuild-runtime-compare.mjs`

---

## 2. Build / Typecheck / Commands

| Step | Command | Result |
|------|---------|--------|
| Formalize sources | `npm run lexicon:formalize:full-rebuild-sources` | PASS — tmp byte match |
| Full Rebuild A | `npm run lexicon:full-rebuild -- --force` | PASS → `_rebuild_candidate` |
| Full Rebuild B | `npm run lexicon:full-rebuild -- --force --output .../_rebuild_candidate_b` | PASS |
| Gate candidate | `LEXICON_V3_BUNDLE_DIR=.../_rebuild_candidate npm run lexicon:gate:v3-runtime` | **PASS** |
| Reconcile | Electron + `repro-rebuild-reconcile.mjs` | PASS |
| Runtime compare | Electron + `repro-rebuild-runtime-compare.mjs` | PASS exit 0 |

本轮未改 TS runtime 算法；无单独 typecheck 回归需求。构建脚本为 `.mjs`，以命令退出码与内容对账为准。

---

## 3. Source Validation

| Check | Expected | Actual |
|-------|----------|--------|
| Files exist in `full_rebuild_v1/` | 4 CSV + sources.manifest | PASS |
| sha256 vs tmp extract | identical | PASS (`matchesTmpExtract: true`) |
| CSV schema / columns | per sources.manifest | PASS |
| Record counts | 10000 / 970 / 73 / 12 | PASS |
| Formal build refuses tmp | throw | PASS (guard in `full-rebuild-from-csv.mjs`) |
| Idiom JSONL | 22192 + hash | PASS |
| Hierarchy registry | hash declared | PASS |

Source 内容未修改；「上线计划」「接口文档」仍在 review/补充血统中。

---

## 4. Two Independent Rebuilds

| | Candidate A | Candidate B |
|--|-------------|-------------|
| Output dir | `_rebuild_candidate` | `_rebuild_candidate_b` |
| Mode | empty/force Full Rebuild | empty/force Full Rebuild |
| term | 10061 | 10061 |
| idiom | 22192 | 22192 |
| tags | 1033 | 1033 |
| hierarchy | 12 | 12 |
| bundleVersion | 11 | 11 |

---

## 5. Content Hash Comparison

业务表排序内容 hash（非 SQLite 文件字节）：

```text
CONTENT_HASH_A = 2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f
CONTENT_HASH_B = 2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f
CONTENT_HASH_PROD = 2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f
```

`aEqualsB = true`，`candEqualsProd = true`。

SQLite checksum（本轮）：`sha256:38c376c4af1a4da454c4f6543142b794ff3a90730b8fdd1c6543308885edd222`（A=B）。

---

## 6. Schema Gate / Manifest / Checksum

```text
[lexicon:gate:v3-runtime] PASS — FW v3 runtime bundle OK
  path: .../node_runtime/lexicon/_rebuild_candidate
```

Manifest 抽查：

- `schemaVersion`: `lexicon-v3-runtime-v3`
- `sourceInputs.mode`: `FULL_REBUILD`
- `sourceInputs.termSources[*].sha256` 与正式 Source 一致
- `historicalInputs` 标明 shadow/seed 非生产血统
- `lastPatchId`: `null`（非 patch 序列）
- `atomicity` note：清理未执行

---

## 7. Table Reconciliation (Production vs Candidate)

| Table | old | new | added | removed | field mismatch |
|-------|-----|-----|-------|----------|----------------|
| term | 10061 | 10061 | 0 | 0 | none (content hash) |
| base_lexicon | 10061 | 10061 | 0 | 0 | none |
| domain_lexicon | 1033 | 1033 | 0 | 0 | none |
| term_domain_tags | 1033 | 1033 | 0 | 0 | none |
| idiom_lexicon | 22192 | 22192 | 0 | 0 | none |
| industry_routing_lexicon | 1033 | 1033 | 0 | 0 | none |
| domain_hierarchy | 12 | 12 | 0 | 0 | none |

termId 对账：`idSame=10061`，`idChanged=0`。

关键 surface ID 一致：候选、计划、蓝莓马芬、医师、登机、上线计划、接口文档。

---

## 8. Exact Recall Probes

`exactEqual: true`（prod vs cand）

| Probe | found | top id (both) |
|-------|-------|---------------|
| 候选 | true | `exp-v1_1-alias-houxuan` |
| 计划 | true | `base-rebuild-exp-v1_1-alias-jihua` |
| 蓝莓 | true | `base-rebuild-term-e8939de88e937c6c` |
| 马芬 | true | `term-e9a9ace88aac7c6d` |
| 蓝莓马芬 | true | `term-e8939de88e93e9a9` |
| 医师 | true | `term-e58cbbe5b8887c79` |
| 登机 | true | `base-rebuild-term-e799bbe69cba7c64` |
| 上线计划 | true | `term-e4b88ae7babfe8ae` |
| 接口文档 | true | `term-e68ea5e58fa3e696` |

---

## 9. dialog_200 (200/200)

| | Production | Candidate |
|--|------------|-----------|
| completedCases | 200 | 200 |
| failed | 0 | 0 |
| latticeUncovered | 0 | 0 |
| KenLM inputs | 200 | 200 |
| assembly sentence diffs | 0 | 0 |
| businessEqual | — | **true** |

未改 dialog_200 fixture 或 runtime 算法。

---

## 10. Negative / Boundary Checks

| Check | Result |
|-------|--------|
| Full Rebuild 不读生产 SQLite 内容 | PASS（代码路径 + 对账） |
| Full Rebuild 不读 tmp | PASS |
| 无 Atomicity Validator 新增 | PASS |
| 组合词未删除 | PASS |
| shadow 标注 NOT PRODUCTION | PASS（header 注释） |
| retire 标注历史迁移 | PASS |

---

## 11. Test Matrix Summary

| Requirement | Status |
|-------------|--------|
| source file existence | PASS |
| source hash | PASS |
| CSV schema | PASS |
| duplicate surface / unique IDs | PASS (rebuild validate) |
| remove list effect | PASS (12 excluded → 9988+73 path) |
| term / tag / idiom / hierarchy counts | PASS |
| deterministic termId | PASS |
| manifest truth | PASS |
| candidate bundle gate | PASS |
| double build content equality | PASS |
| production vs candidate table diff | PASS |
| exact Recall probes | PASS |
| dialog_200 comparison | PASS |

---

## 12. Final Verdict

```text
REPRODUCIBLE_BUILD_PASS
```

证据同时满足：Source 正式、内容等价、血统真实、双构建确定、无旧库依赖、Runtime 行为一致。
