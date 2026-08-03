<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1B_Surface_Exact_Reachability_Development_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1B Surface Exact Reachability Development Report
。
| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Batch | 1.1B |
| Scope | Stage 1 Contract Freeze + Stage 2 Development |
| Companion | Functional Test Report |
| Next | Generalization Audit（本轮不进入） |
| Not | Batch 1.1C · Batch 1.1D · Batch 2 · Batch 1 overall PASS |

---

## 1. Executive Summary

在 **不扩大 ambiguity LIMIT=8**、不改动 1.1A truncation / exact-limit Contract 的前提下，为 length=1 增加 **Independent Exact Surface Lookup**：仅当 ambiguity 路径未产生合法 Candidate 时，用点查证明 `(pinyin_key[, tone], word)` 身份，从而修复 **surface rank9+ unreachable**。

---

## 2. Final Verdict

```text
BATCH 1.1B

STAGE1 CONTRACT:
PASS

STAGE2 DEVELOPMENT:
PASS

SURFACE EXACT REACHABILITY
IMPLEMENTED

READY FOR STAGE 3 / GENERALIZATION AUDIT
```

---

## 3. Architecture

```text
LexicalWindowQuery / recallTopKForWindows
  → recallSpanTopKV3 / recallSpanTopKV2
    → collectBaseOnlySingleCharCandidate
        Step1  ambiguity lookup LIMIT=8
        Step2  filterEligible + resolveLength1BaseCandidate(+truncation)
        Step3  if Candidate → KEEP（不覆盖）
        Step4  if no Candidate → Independent Exact Lookup LIMIT=2
               → filterEligible + unique identity → scoreLength1BaseHit
  → buildLexicalEdges → Path / Vote（本轮未改）
```

职责：

| Concern | Owner |
|---------|-------|
| Ambiguity fetch LIMIT=8 | Runtime 机械 + Recall 决策（1.1A） |
| Exact surface point lookup | Runtime 机械 rows only |
| Accept / reject Candidate | **Recall only** |
| Uniqueness / pick / best | **禁止进入 Runtime API** |

---

## 4. Contract（Stage 1 Freeze）

写入 Implementation Contract **CR 1.0.6**。**未修改** CR 1.0.4 / 1.0.5（Batch 1.1A）。

### 4.1 调用时机

```text
ambiguity first
→ if legal Candidate: keep
→ else if windowText.trim(): exact lookup
→ else: empty
```

禁止：所有 length1 无条件 extra SQL。

### 4.2 Candidate 优先级

已有 ambiguity Candidate → **不得**被 surface exact 覆盖。

### 4.3 Runtime API

```text
lookupBaseByExactSurfaceAndPinyin(pinyinKey, word, termLength=1)
lookupBaseByExactSurfacePinyinAndTone(pinyinKey, tonePinyinKey, word, termLength=1)
```

- 只返回 rows  
- **禁止**开放 `sqlLimit`；内部固定 `LIMIT 2`  
- 命名禁止 resolve/pick/best/unique/candidate  

### 4.4 SQL / Index

点查复用 `PRIMARY KEY (pinyin_key, word)` → `sqlite_autoindex_base_lexicon_1`。

Stage1 证据：`docs/tone-v2/_audit_scratch/lattice_v1_batch1_1b/stage1_schema_explain_surface_exact.json`

| Plan | Detail |
|------|--------|
| Plain exact | `SEARCH ... sqlite_autoindex_base_lexicon_1 (pinyin_key=? AND word=?)` |
| Tone exact | 同上 autoindex（tone 为附加过滤） |

**未新增 SQLite index。**

### 4.5 Duplicate schema

`PRIMARY KEY (pinyin_key, word)` → 真实 duplicate `(key, word)` 不可能。测试验证 INSERT 冲突失败；LIMIT 2 为防御性 0/1/≥2 检测。

### 4.6 Tone

单独 EXPLAIN；不假设 plain=tone。不修改 tone-unsupported → plain 政策（1.1C）。

### 4.7 Candidate kind

复用 `exact_base`。未新增 `exact_base2` / `surface_exact`。

---

## 5. Call Graph（After）

```text
collectBaseOnlySingleCharCandidate
  ambiguity: lookupBaseByPinyin[AndTone]Key(..., LIMIT=8)
  resolveLength1BaseCandidate(eligible, windowText, truncated?)
  if !chosen:
    tryExactSurfaceBaseIdentity
      lookupBaseByExactSurface[AndPinyin|PinyinAndTone](..., LIMIT=2)
      filterEligibleBaseSingleChar
      eligible.length===1 && word===surface → chosen
  scoreLength1BaseHit(..., kind=exact_base)
```

---

## 6. API

| API | File | Notes |
|-----|------|-------|
| `lookupBaseByExactSurfaceAndPinyin` | `lexicon-runtime-v2.ts` | prepared + bucketCache |
| `lookupBaseByExactSurfacePinyinAndTone` | same | tone composite stmt |
| `tryExactSurfaceBaseIdentity` | `recall-span-topk-v2.ts` | private Recall helper |

---

## 7. SQL

```sql
-- plain exact
SELECT ... FROM base_lexicon
WHERE pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = ?
LIMIT 2;

-- tone exact
SELECT ... FROM base_lexicon
WHERE pinyin_key = ? AND tone_pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = ?
LIMIT 2;
```

Ambiguity SQL / LIMIT=8：**未改**。

---

## 8. Cache

复用 `lookupTier` / `bucketCache`：

```text
base:exact_surface:${surface}:plain:${key}:${termLength}:2
base:exact_surface:tone:${toneKey}:${surface}:plain:${key}:${termLength}:2
```

与 ambiguity cache key 隔离。`closeDbOnly` 释放新 statements。

---

## 9. KEEP / MODIFY / DELETE / NEW

| | |
|--|--|
| **KEEP** | LIMIT=8 ambiguity；1.1A truncation / exact-limit；Runtime≠uniqueness owner；Edge/Path/Vote/Assembly/KenLM；kind=`exact_base`；eligibility/score helpers |
| **MODIFY** | `collectBaseOnlySingleCharCandidate`（仅无 Candidate 时接线 exact）；Stage4/1.1A 用例 windowText 改为「无 identity」以继续验证 truncation reject |
| **DELETE** | 无生产代码删除 |
| **NEW** | Runtime exact APIs + stmts；`tryExactSurfaceBaseIdentity`；CR 1.0.6；1.1B SQLite suite |

---

## 10. Target List

```text
[x] 冻结 Development Contract
[x] 冻结调用时机
[x] 冻结 Candidate 优先级
[x] 冻结 Runtime API
[x] 冻结 LIMIT=2
[x] 核实 duplicate schema
[x] Tone EXPLAIN
[x] 复用 Candidate kind
[x] 开发 Runtime
[x] 开发 Recall
[x] 新增 SQLite tests（见 Functional Test Report）
[x] 回归 Batch1.1A
[x] 回归 Batch1.1B
[x] build
[x] dist clean
[x] 输出 Development Report
[x] 输出 Functional Test Report
```

---

## 11. Check List

```text
[x] 未修改 Batch1.1A Contract（CR 1.0.4/1.0.5 文本与语义保留；1.0.6 仅授权 surface exact）
[x] 未扩大 LIMIT
[x] 未新增 SQLite index
[x] 未新增 Runtime decision
[x] 未新增 Candidate kind
[x] 未新增 Shadow Path
[x] 未修改 Edge
[x] 未修改 Vote
[x] 未修改 Assembly
[x] 未修改 KenLM
[x] 未进入 Batch1.1C
[x] 未进入 Batch2
```

---

## 12. Performance

- Exact 路径：最多 **+1 SQL**（仅 ambiguity 无 Candidate 时）  
- 点查 autoindex；无 scan / fetch-all / COUNT(*)  
- Ambiguity 已命中时：**0** extra SQL  

---

## 13. Regression（摘要）

Electron ABI：`13 suites / 175 PASS`（含 1.1A + 1.1B + Length1/Runtime/Recall/Connectivity/Edge/Vote/Freeze/HB/TopKV3）。详情见 Functional Test Report。

---

## 14. Known Defects（仍移交）

1. Tone unsupported silent plain → **1.1C**  
2. HB ellipsis → **1.1D**  

---

## 15. Excluded Scope

未做：扩大 ambiguity page、扩大 LIMIT、新 index、第二条 Repair 链、Runtime uniqueness、Edge/Vote/Assembly/KenLM、Patch、词库、cutover。
