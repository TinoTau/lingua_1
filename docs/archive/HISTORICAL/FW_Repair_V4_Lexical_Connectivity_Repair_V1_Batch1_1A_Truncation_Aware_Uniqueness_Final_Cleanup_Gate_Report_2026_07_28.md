<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1A_Truncation_Aware_Uniqueness_Final_Cleanup_Gate_Report_2026_07_28.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1A Truncation-aware Uniqueness Final Cleanup & Gate

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | **5 — Cleanup & Final Gate** |
| Production behavior change | **None**（仅 Contract CR 1.0.5 文档澄清） |

---

## 1. Executive Summary

Stage 1–4 结论与当前代码一致。核心疑点已关闭：

- **alias 占用 SQL LIMIT 槽**（SQL 不含 `is_alias`）；过滤在 Recall `filterEligibleBaseSingleChar`
- plain / tone SQL predicate 与 truncation 路径 **同构**
- cache key 含 `limit`；LIMIT 1↔8 安全（Stage 4 已证）
- `returnedCount < limit` 完整性仅对当前 SQL predicate 成立
- exact-limit reject 维持 **ACCEPTED CONTRACT**
- CR **1.0.5** 文档澄清 alias ownership / predicate 边界（无行为变更）

Final Gate 回归 **12 suites / 161 PASS**；dist **CLEAN**。

---

## 2. Final Verdict

```text
BATCH 1.1A FINAL GATE:
PASS

TRUNCATION-AWARE UNIQUENESS CLOSED
CONTRACT AND IMPLEMENTATION ALIGNED
AUTHORIZED TO BEGIN BATCH 1.1B PRE-DEVELOPMENT AUDIT
```

---

## 3. Five-Stage Status

| Stage | Status |
|-------|--------|
| 1 Design Audit | PASS |
| 2 Development | PASS |
| 3 Functional Test | PASS |
| 4 Generalization | PASS |
| 5 Cleanup & Gate | **PASS** |

---

## 4. Input Documents

- Batch 1.1 Design Audit  
- Batch 1.1A Dev / Test / Generalization reports  
- Implementation Contract CR 1.0.4 → **+1.0.5**  
- 当前 `lexicon-runtime-v2.ts` / `recall-span-topk-v2.ts`  

---

## 5. Code Re-verification

与 Stage 2–4 一致：`length1FetchMayBeTruncated`、`resolveLength1BaseCandidate(..., fetchMayBeTruncated)`、plain/tone 共用决议。

---

## 6. Alias Filter Ownership

| Question | Answer | Evidence |
|----------|--------|----------|
| alias 是否占 LIMIT 槽？ | **是** | SQL 无 `is_alias` 条件 |
| 字段 | `is_alias` → `HotwordEntry.isAlias` | `mapTierRowToHotword` |
| 过滤函数 | `filterEligibleBaseSingleChar` | `recall-span-topk-v2.ts` |
| 过滤顺序 | SQL fetch → map → **Recall eligibility** → uniqueness | collect 调用链 |
| plain/tone 一致？ | **是** | 两 stmt 均无 alias 排除 |
| SQL 内过滤 alias 的路径？ | **无**（base length=1） | stmtBase / stmtBaseToneComposite |

调用链：

```text
lookupBase*(..., LIMIT 8)
  SQL: pinyin[/tone] AND enabled=1 AND length(word)=?
  → rows may include is_alias=1
filterEligibleBaseSingleChar  // drops isAlias===true
resolveLength1BaseCandidate(+truncation)
```

---

## 7. SQL Predicate and Filter Order

```sql
WHERE pinyin_key = ? [AND tone_pinyin_key = ?]
  AND enabled = 1 AND length(word) = ?
ORDER BY prior_score DESC
LIMIT ?
```

| Filter | Where |
|--------|-------|
| enabled | **SQL** |
| length(word) | **SQL** |
| is_alias | **Recall** |
| priorScore≤0 | **Recall** |

---

## 8. Plain/Tone Parity

| Aspect | Parity |
|--------|--------|
| LIMIT / truncation fact / eligibility / surface-in-set / cap | **Identical** |
| Intentional difference | tone stage label only（tone_exact vs plain_only） |

无 Unintended Divergence。

---

## 9. Cache Contract

| Path | Key includes limit? |
|------|---------------------|
| plain | `base:plain:{key}:{termLength}:{limit}` |
| tone | tier 串含 tone keys + limit；lookupTier 再拼 limit |

Stage 4 CACHE case：1→8 / 8→1 / tone 1&8 **SAFE**。本轮无 cache 修复。

---

## 10. returnedCount Completeness Assumption

成立范围：**当前 SQL predicate 下的 enabled 行**。  
非 `COUNT(*)` 全域证明。CR 1.0.5 已写明。

---

## 11. Exact-limit Contract

```text
exact-limit reject: ACCEPTED CONTRACT
（Stage 4 产品决定维持；本轮不推翻）
```

---

## 12. Contract Clarifications

新增 **CR 1.0.5**（documentation-only）：

1. `< limit` = 当前 predicate 未截断证据  
2. alias 在 SQL 外过滤、占 LIMIT 槽  
3. predicate/alias ownership 变更 → **必须重审** truncation Contract  
4. Runtime 不拥有 uniqueness  
5. 仍不授权 surface probe / tone / HB  

修正 CR 1.0.4 中 “complete visible page” 的潜在误读。

---

## 13. Diagnostics Decision

```text
KEEP AS-IS
```

truncation reject 与 empty 在 hit 计数上同为 0 Candidate；现有 raw/eligible/candidate 计数足够排障。不新增 `rejectedDueToTruncation`。

---

## 14. Cleanup Inventory

| Item | Action |
|------|--------|
| Stage 4 audit test | **KEEP**（7/8/9 防回归） |
| before/after/matrix JSON | **KEEP** under `lattice_v1_batch1_1a/` |
| production TODO/FIXME/console | **无** |
| Fake runtime | **无** |
| Stage 4 matrix overwrite of 1.0C before | **未发生**（before 仍在 `batch1_0c`） |

---

## 15–17. Files Modified / Deleted / Retained

| Class | Paths |
|-------|-------|
| MODIFY | Implementation Contract（+CR 1.0.5） |
| DELETE | （无生产删除） |
| RETAIN | truncation integration、stage4 audit、baselines、helper |

---

## 18. Baseline Archive

| Artifact | Location |
|----------|----------|
| Repair-before | `lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json` |
| Repair-after | `lattice_v1_batch1_1a/length1_limit8_real_sqlite_baseline_after.json` |
| Stage 4 matrix | `lattice_v1_batch1_1a/stage4_boundary_matrix.json` |

---

## 19–20. Regression

```powershell
ELECTRON_RUN_AS_NODE=1 electron jest --runInBand --forceExit \
  --testPathPattern="batch1-1a-stage4-generalization.audit|length1-truncation|...|lexicon-runtime-v2.test"
```

**12 suites / 161 PASS**

---

## 21. Build / dist

`build:main` SUCCESS；`batch1_1a_final_gate_dist_test_resource_inventory.json` → **CLEAN**

---

## 22. Known Defects（移交后续 Batch）

1. Surface rank9 unreachable → **1.1B**  
2. Tone unsupported silent plain → **1.1C**  
3. HB ellipsis → **1.1D**  

---

## 23. Excluded Scope

未做：surface probe、LIMIT 增大、alias SQL 下推、tone/HB、Edge/Path/Vote、Patch、词库、cutover。

---

## 24–27. KEEP / MODIFY / DELETE / NEW

| | |
|--|--|
| KEEP | truncation 实现；exact-limit 政策；Stage 4 测试 |
| MODIFY | CR 1.0.5 文档 |
| DELETE | 无 |
| NEW | 本 Gate 报告；final dist inventory |

---

## 28–29. Target / Check

全部完成；未下推 alias；未新增 probe；未进 Batch 2。

---

## 30. Closure Decision

```text
Batch 1.1A CLOSED at Final Gate PASS
```

---

## 31. Authorization for Part B

```text
AUTHORIZED TO BEGIN BATCH 1.1B PRE-DEVELOPMENT AUDIT
（仅 Design Audit；禁止开发实现）
```
