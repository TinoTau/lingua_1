<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1B_Surface_Exact_Reachability_Generalization_Audit_Report_2026_07_28.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1B Surface Exact Reachability Generalization Audit Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | **4 — Generalization Validation & Audit** |
| Dependency | Stage 1–3 PASS |
| Production code changes | **None**（仅审计测试 / 旧基线期望对齐 CR 1.0.6） |
| Next | Stage 5 Cleanup & Final Gate |

---

## 1. Executive Summary

对 Batch 1.1B independent exact-surface reachability 做全量泛化审计：参数化 rank、多 key/字符、决策矩阵、SQL 触发率量化、plain/tone EXPLAIN、cache 隔离与 metamorphic、bundle lifecycle、eligibility 复用、Unicode exact 语义、Candidate 对等、Candidate→Edge→Path、1.1A 兼容、过拟合搜索、failure injection。

结论：实现不依赖固定 rank/字符；exact 仅在 ambiguity 无 Candidate 时触发；query plan 为 autoindex SEARCH（无 SCAN）；cache / lifecycle 无污染；1.1A truncation（无 identity）仍拒绝；identity accept 为独立语义。

---

## 2. Final Verdict

```text
BATCH 1.1B STAGE 4:
PASS

SURFACE EXACT REACHABILITY
GENERALIZATION VERIFIED

NO OVERFITTING
NO CACHE CONTAMINATION
NO LIFECYCLE LEAK
NO DOWNSTREAM REGRESSION

READY FOR STAGE 5 CLEANUP & FINAL GATE
```

---

## 3. Audit Scope

| In | Out |
|----|-----|
| Rank / surface / decision / SQL / cache / lifecycle / plain-tone / eligibility / Unicode / Candidate / Edge-Path / 1.1A / overfit / failure | Batch 1.1C tone unsupported |
| Electron ABI + real SQLite | Batch 1.1D HB ellipsis |
| Evidence JSON under `_audit_scratch` | Batch 2 / cutover / 新 index / schema |

---

## 4. Frozen Contracts

| Item | Status |
|------|--------|
| Batch 1.1A CLOSED（CR 1.0.4 / 1.0.5） | 保持 |
| CR 1.0.6 surface exact | 保持 |
| ambiguity LIMIT=8 | 保持 |
| exact internal LIMIT=2 | 保持 |
| Runtime ≠ decision owner | 保持 |
| existing Candidate not overridden | 保持 |
| truncated residual without identity → reject | 保持 |
| truncated + valid exact identity → may accept | 保持 |

---

## 5. Current Call Graph

```text
collectBaseOnlySingleCharCandidate
  → ambiguity LIMIT=8
  → filterEligible + resolveLength1BaseCandidate(+truncation)
  → if Candidate: KEEP
  → else tryExactSurfaceBaseIdentity (LIMIT=2 rows)
       → filterEligibleBaseSingleChar (shared)
       → scoreLength1BaseHit (kind=exact_base)
→ Edge / Path / Vote（未改）
```

核对生产文件：`recall-span-topk-v2.ts`、`lexicon-runtime-v2.ts`。

---

## 6. Rank Generalization

参数化 ranks：`2,3,5,7,10,12,16,24,32`（动态 `N=max(rank,9)` rows，CJK codepoint 生成，非固定 玖）。

| 结论 | |
|------|--|
| rank≤8 | ambiguity page 可达 |
| rank>8 | independent exact 可达 |
| 生产代码 | 无 `rank9`/`rank20`/`玖`/`==9` 硬编码 |

证据：`batch1_1b_stage4_rank_matrix.json`

---

## 7. Surface Character Generalization

6 keys（`ka`–`kf`），每 key 10–28 rows；覆盖 alias / disabled / prior≤0 / 不同 tone / 深 rank surface。

exact 仅依赖：`pinyin` + optional `tone` + `surface` + `termLength` + `enabled`（SQL）+ eligibility。

---

## 8. Decision Matrix

| Ambiguity | Exact | Expected | Observed |
|-----------|-------|----------|----------|
| legal unique A | absent / exact A / exact B(alias) | A；sql=1（不触发 exact） | PASS |
| ambiguous | exact B (deep) | B；sql≥2 | PASS |
| ambiguous | absent | empty | PASS |
| trunc residual A | absent | empty | PASS |
| trunc residual A | exact A / exact B | A / B | PASS |
| alias-only page | legal exact B | B | PASS |
| disabled / prior≤0 | — | empty | PASS |
| duplicate | PK prevents | INSERT fail；exact ≤1 | PASS |

证据：`batch1_1b_stage4_decision_matrix.json`

---

## 9. SQL Trigger Statistics

| Metric | Value |
|--------|------:|
| totalLength1Windows | 36 |
| exactLookupTriggeredCount | 12 |
| exactTriggerRate | **0.333** |
| exactHitRate | **0.5** |
| physicalSqlStatementCount | 42 |

Corpus：参数化 6-key length1 matrix（cold-start per window）。

**dialog_200**：未重跑完整 LTR pipeline（超出 1.1B Stage4 范围 / 需全 lattice harness）。以参数化多 key corpus + 15-suite Electron 回归替代；已在 `batch1_1b_stage4_sql_trigger_stats.json` 记录原因。

Gate：

- 已有 Candidate → 不触发 exact（决策矩阵 sql=1）
- empty/deep → cold-start 最多 +1 exact
- 无 COUNT(*) / fetch-all / per-candidate 循环 SQL

---

## 10. Performance Analysis

不设绝对毫秒阈值。行为门禁全部满足：点查、有界 LIMIT、无条件 exact 不存在、无放大循环。

---

## 11–12. Plain / Tone Query Plan

| Path | Plan |
|------|------|
| Plain exact | `SEARCH ... sqlite_autoindex_base_lexicon_1 (pinyin_key=? AND word=?)` |
| Tone exact | 同上 autoindex（tone 附加过滤） |

**无 SCAN。** 证据：`batch1_1b_stage4_explain_{plain,tone}_exact.json`

---

## 13. Cache Key Audit

| Question | Answer |
|----------|--------|
| `:plain:` in tone exact key | `lookupTier` 内部格式常量，**非** plain-path 语义 |
| 与 plain exact 碰撞？ | **否** — plain tier=`base:exact_surface:${surface}`；tone tier 含 `tone:${toneKey}:` |
| 分类 | **naming debt / behavior safe**（Stage4 不重构） |

limit=8 ambiguity 与 limit=2 exact **不共用** cache key。

---

## 14. Cache Metamorphic Matrix

顺序 forward/reverse + 连续 3 次：plain hit/miss、tone hit/miss、surface A/B 结果稳定。

证据：`batch1_1b_stage4_cache_metamorphic_matrix.json`

---

## 15. Runtime Lifecycle Audit

```text
bundle A hit → close → bundle B miss(old)/hit(new)
absent → present restore
```

prepared statements 随 `closeDbOnly` 释放；`close()` 清空 `bucketCache`。无跨 bundle hit/miss 复用。

证据：`batch1_1b_stage4_runtime_lifecycle_matrix.json`

---

## 16. Plain/Tone Isolation

| Case | Result |
|------|--------|
| plain surface 评 | hit |
| tone1 + 评（pt1 无 评，且 ambiguity 非 unique） | empty — **不**静默 plain |
| tone2 + 评 | hit |
| tone unsupported outer fallback | 发生于 `collectBaseOnly…` 外层 plain 分支；**非** exact API；移交 **1.1C** |

---

## 17. Eligibility Parity

- 代码复用 `filterEligibleBaseSingleChar(exactRaw)`  
- 无 `filterEligibleExact` 副本 → **无 architecture drift**  
- enabled / alias / prior≤0 / pinyin mismatch 拒绝一致

---

## 18. String/Unicode Boundaries

Contract 确认：

```text
exact = JS/SQLite string equality
trim only；无 NFC/NFKC / 简繁折叠
```

| Case | Behavior |
|------|----------|
| empty / spaces / newline / tab | trim 空 → 不触发 exact；无假 Candidate |
| lead/trail space + 合法字 | trim 后可命中 |
| mid space / emoji / 繁简不同 / NFC≠NFD | 不误等 |

分类：Unicode 规范化 → **future batch**（非 1.1B blocker）。

证据：`batch1_1b_stage4_unicode_boundary_matrix.json`

---

## 19. Candidate Contract Parity

rank1（fetched-page）vs rank20（independent exact）：

| Field | Parity |
|-------|--------|
| recallCandidateKind | `exact_base` |
| source | 相同 |
| domains / repairTarget / isAlias | `[]` / false / false |
| score | 同公式 `scoreLength1BaseHit`；可因 prior 不同而不同（非 lookup origin） |

证据：`batch1_1b_stage4_candidate_parity.json`

---

## 20. Candidate→Edge→Path Audit

rank1 / rank9 / rank20 → WindowCandidate → LexicalEdge → Path：

- edgeCount=1；`candidates[0].replacement` = surface  
- path retained ≥1  
- 未改 Edge builder / Path / Vote / Assembly / KenLM  

证据：`batch1_1b_stage4_edge_path_matrix.json`

---

## 21. Batch 1.1A Compatibility

7 / 8 / 9 rows：

- **无 identity（▢）** → truncation reject 仍成立  
- **同一 DB + residual surface** → identity accept（1.1B）  

证明：inferred uniqueness reject ≠ identity verification。

证据：`batch1_1b_stage4_11a_compat.json` + 全量 1.1A suites PASS

---

## 22. Overfitting Search

| Location | Terms |
|----------|-------|
| Production `lexicon-runtime-v2.ts` / `recall-span-topk-v2.ts` | **无** rank9/rank20/玖/batch1_1b/audit paths |
| Tests / docs / scratch | 允许 |
| `JEST_WORKER_ID` / `__TEST__` in prod recall/runtime | **无** |

允许常量：`LENGTH1_AMBIGUITY_SQL_LIMIT = 8`

---

## 23. Failure Injection

| Injection | Result |
|-----------|--------|
| empty / invalid keys | `[]` rows；无半成品 Candidate |
| trim-empty window | empty（多 eligible 时） |
| closed runtime exact | `[]` |

证据：`batch1_1b_stage4_failure_injection.json`

---

## 24. Test Changes

| Change | Reason |
|--------|--------|
| **NEW** `batch1-1b-stage4-generalization.audit.test.ts` | Stage4 全矩阵 |
| **MODIFY** `batch1-1b-surface-reachability.audit.test.ts` | 旧 pre-dev 期望与 CR 1.0.6 冲突：rank9/20→hit；B6/B7 改为 alias-only / disabled-only 以免 unique 误接受 |

未删除旧测试、未 skip、未 Mock Runtime。

---

## 25. Production Code Changes

```text
NONE
```

---

## 26. Regression Commands

```powershell
cd electron_node/electron-node
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\electron\dist\electron.exe .\node_modules\jest\bin\jest.js `
  --runInBand --forceExit --no-coverage `
  --testPathPattern="batch1-1b-stage4-generalization|batch1-1b-surface-reachability|length1-surface-exact|length1-truncation|length1-recall-edge-path|lexicon-runtime-v2-length1-base.contract|recall-span-topk-v2-length1.sqlite|connectivity-path-vote-bind|batch1-1a-stage4|recall-span-topk-v2.test|recall-span-topkv3|lattice-hard-block|freeze-contract.test|lexicon-runtime-v2.test"

npm run build:main
```

---

## 27. Regression Results

| | |
|--|--|
| Suites | **15 PASS** |
| Tests | **192 PASS** |
| Mock Runtime | 无 |

覆盖：Stage4 audit、1.1B functional、1.1A truncation/stage4、length1 Runtime、Recall v2/v3、Connectivity/Edge/Vote、HB、Freeze。

---

## 28. Build Result

`npm run build:main` → **SUCCESS**

---

## 29. Dist Inventory

`batch1_1b_stage4_dist_test_resource_inventory.json` → **CLEAN**

未打入：audit JSON、test helpers、scratch、probe。

---

## 30. Known Defects

| Defect | Owner |
|--------|-------|
| Tone unsupported → plain fallback | **1.1C** |
| HB ellipsis | **1.1D** |
| Cache key `:plain:` naming debt | Stage5 可选文档清理（行为安全） |
| Unicode NFC/NFKC | future batch |

---

## 31. Excluded Scope

未进入 1.1C/1.1D/Batch2；未改 Edge/Path/Vote/Assembly/KenLM；未扩 LIMIT；未加 index；未改 schema；未改 scoring。

---

## 32–35. KEEP / MODIFY / DELETE / NEW

| | |
|--|--|
| **KEEP** | CR 1.0.4–1.0.6；LIMIT=8/2；Runtime rows-only；shared eligibility；Edge/Path/Vote |
| **MODIFY** | 旧 pre-dev 基线期望（测试 only） |
| **DELETE** | 无 |
| **NEW** | Stage4 audit suite + evidence JSON + 本报告 |

---

## 36. Target List

```text
[x] 读取 1.1A / 1.1B 报告与 CR
[x] 核对当前代码
[x] 参数化 rank 测试
[x] 多字符 / 多 key 泛化
[x] 完整决策矩阵
[x] 统计 exact 触发率
[x] plain / tone EXPLAIN
[x] cache key 隔离 + metamorphic
[x] Runtime lifecycle
[x] plain/tone 隔离
[x] eligibility parity
[x] Unicode/string 边界
[x] Candidate parity
[x] Candidate→Edge→Path
[x] 1.1A compatibility
[x] 过拟合搜索
[x] failure injection
[x] 全量回归
[x] build
[x] dist inventory
[x] 输出 Stage 4 报告
```

---

## 37. Check List

```text
[x] 未进入 Batch 1.1C / 1.1D / Batch 2
[x] 未新增 index / 未改 schema
[x] 未扩大 ambiguity LIMIT / 未改 exact LIMIT
[x] 未改变 Candidate 优先级 / Runtime ownership
[x] 未修改 Edge / Path / Vote / Assembly / KenLM
[x] 未新增 Candidate kind / shadow path
[x] 未使用 Mock Runtime / 测试特判
[x] 未将 audit resource 打入 dist
```

---

## 38. Stage 5 Readiness

```text
READY FOR STAGE 5 CLEANUP & FINAL GATE
```

建议 Stage5：归档 evidence、可选 naming-debt 文档注释、最终 Gate 清单；**不得**借机改 tone fallback / HB / 扩 LIMIT。
