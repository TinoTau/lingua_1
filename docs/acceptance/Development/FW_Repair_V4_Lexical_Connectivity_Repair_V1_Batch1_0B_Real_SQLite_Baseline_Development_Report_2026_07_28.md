<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_0B_Real_SQLite_Baseline_Development_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.0B Real SQLite Baseline Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stages | Stage 2 Development + Stage 3 Functional Test |
| Prerequisite | Batch 1.0A = PASS |

---

## 1. Executive Summary

已建立 **真实临时 SQLite（正式 v3 schema 副本）+ 正式 `LexiconRuntimeV2.loadFromBundleDir`** 的测试基建，并在真实链路上复现当前行为。

关键发现（本轮只记录、不修复）：

```text
LexiconRuntimeV2.lookupTier：
  if (termLength < 2) return [];
→ length=1 的 lookupBaseByPinyinKey / Tone 在真实 Runtime 上恒为空
→ Batch 1 fake runtime 曾绕过此门禁，造成“假通过”
```

因此 length=1 **尚不能**从真实 Runtime 产生 Candidate；LIMIT=8 假唯一亦无法在 Recall 层观测，直至该门禁在 Batch 1.1 修复。

length=2 真实召回、call-site 参数、cache key 去重、Hard-block allow、domain Vote（多字）、生产构建隔离均已验证。

---

## 2. Final Verdict

```text
BATCH 1.0B REAL SQLITE BASELINE:
CONDITIONAL

REAL RUNTIME PARTIALLY VERIFIED
BLOCKERS MUST BE RESOLVED
```

**阻塞 Batch 1.1 前必须先修：** `lookupTier` 的 `termLength < 2` 门禁（否则 length=1 Recall 无真实候选）。  
**不得**进入 Batch 2。

---

## 3. Five-Stage Workflow Status

```text
Batch 1.0B
Stage 1 — Design Audit          PASS（本报告 §4）
Stage 2 — Development           PASS（测试基建）
Stage 3 — Functional Test       CONDITIONAL（门禁阻断 length=1 Candidate）
Stage 4 — Generalization Audit  PENDING
Stage 5 — Cleanup & Gate        PENDING
```

---

## 4. Design Audit Inputs

| 项 | 结论 |
|----|------|
| 构造 | `new LexiconRuntimeV2()` → `loadFromBundleDir(bundleDir)` |
| Bundle | `manifest.json` + `lexicon.sqlite` + checksum；schema `lexicon-v3-five-table-v2` |
| Temp | 复用 `copyV3BundleToTemp`；**不支持** Runtime `:memory:`（仅文件路径） |
| base schema | id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias；PK (pinyin_key, word) |
| lookup SQL | `WHERE pinyin_key=? AND enabled=1 AND length(word)=? ORDER BY prior_score DESC LIMIT ?` |
| **门禁** | `lookupTier` **额外** `termLength < 2 → []`（在 SQL 之前） |
| ABI | better-sqlite3 需 **Electron**（NODE_MODULE_VERSION 119）；系统 Node Jest 会 ABI fail |

---

## 5–8. Real SQLite Setup / Schema / Runtime / Isolation

- Helper：`length1-real-sqlite.test.helpers.ts`（`*.test.helpers.ts` → **tsconfig.main exclude**）
- 流程：copy v3 → INSERT base_lexicon → 重写 sha256 checksum → `loadFromBundleDir`
- Seed 仅写 `base_lexicon`（+ 可选 domain 污染守卫行）
- dist 检查：helper **未**进入 `dist/main`（见 inventory）

---

## 9–11. Files Changed / Tests Added / Renamed

| Path | Action |
|------|--------|
| `length1-real-sqlite.test.helpers.ts` | NEW（test-only） |
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | NEW |
| `length1-recall-edge-path.sqlite.integration.test.ts` | NEW |
| `connectivity-path-vote-bind.unit.test.ts` | RENAMED from chain.test.ts |
| audit JSON under `_audit_scratch/lattice_v1_batch1_0b/` | NEW |

---

## 12. No-Mock Evidence

- 无 Fake/Stub/Map runtime
- `new LexiconRuntimeV2()` + 真实 SQLite 文件
- spy 仅用于 call-site 参数与 domain lookup 不可达（在能调用时）；length=1 结果来自真实空返回

---

## 13. Runtime Field Mapping

Raw SQL 验证 `修`：`repair_target=1`, `is_alias=0`, `source=batch1_0b_test`, `tone_pinyin_key=xiu1`。  
Runtime length=1 lookup 无法返回该行（门禁）。

---

## 14–16. Recall / LIMIT=8 / Tone Unsupported Baselines

见：

- `length1_runtime_termLength_gate_baseline.json`
- `length1_limit8_real_sqlite_baseline.json`（DB=9；Runtime return=0；LIMIT 逻辑未执行）
- `length1_tone_unsupported_baseline.json`（override 后仍因门禁为空）

---

## 17–20. Edge / Path / Vote / Cache

| 项 | 结果 |
|----|------|
| length=1 → Edge | 0 candidates（门禁）— 已记录 |
| length=2 → Edge → Path | PASS（甲乙/丁戊 + fallback） |
| Vote | length=1 空池 + 真实 domain「高速」→ tourism_transport=1；无 base_term |
| Cache | length=1 uniqueKey=1 / hit≥1；不宣称 physicalSql=1（无 length=1 SQL） |

---

## 21. 2–5 Regression

Electron 下：`recall-span-topk-v2.test` / `topkv3` / HB / freeze：**98 PASS**。  
新增 length=2 内容断言：`甲乙` exact_base。

---

## 22. Production Build Inspection

`build:main` PASS；`HELPER_IN_DIST=no`；inventory **CLEAN**。

---

## 23. Known Defects（→ Batch 1.1）

| ID | Defect | Priority |
|----|--------|----------|
| P0 | `lookupTier` termLength&lt;2 阻断 length=1 | **P0** |
| P0 | LIMIT=8 假唯一（门禁解除后复测） | P0 |
| P1 | tone unsupported → plain fallback 策略 | P1 |
| P1 | HB 省略号 | P1 |

---

## 24. Excluded Modules

未改：`recall-span-topk-v2` 算法、LIMIT 常量、HB、cap、Edge/Path/Vote、Patch、Full Build、operational SQLite。

---

## 25–28. KEEP / MODIFY / DELETE / NEW

- **KEEP**：1.0A 清洁状态；正式 Runtime API；copyV3BundleToTemp  
- **MODIFY（下轮）**：`lookupTier` 允许 length=1  
- **DELETE**：无业务删除  
- **NEW**：上述 helper + integration tests + baselines  

---

## 29. Target List

```text
[x] 确认 Runtime 构造 / schema / checksum
[x] 临时 SQLite + 禁止 fake
[x] 字段 mapping（raw SQL）
[x] 记录 length=1 当前空结果与门禁
[x] length=2 golden
[x] call-site / cache key / HB allow / Vote domain
[x] LIMIT=8 / tone baseline JSON
[x] 2–5 回归 / build / dist CLEAN
[ ] length=1 真实 Candidate（阻塞 → 1.1）
[ ] length=1 Edge/Path 真实贯通（阻塞 → 1.1）
```

---

## 30. Check List

```text
[x] 未改 Recall 算法 / LIMIT / tone fallback / HB / cap / Patch / 词库
[x] 未新增 fake runtime
[x] 未用 skip/todo
[x] 未把门禁空结果宣称为功能 PASS
[x] 未准备 Batch 2
```

---

## 31. Next Stage Recommendation

**Batch 1.1 — Generalization Repair** 最小首项：

```text
LexiconRuntimeV2.lookupTier：允许 termLength === 1
（仅 base/tone 路径所需；保持其它约束）
```

然后复跑 length=1 Candidate→Edge→Path 与 LIMIT=8 观测，再进入 Stage 4 Generalization Audit。
