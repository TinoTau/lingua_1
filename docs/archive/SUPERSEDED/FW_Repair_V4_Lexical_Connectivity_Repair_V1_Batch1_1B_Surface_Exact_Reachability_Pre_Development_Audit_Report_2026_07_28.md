<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1B_Surface_Exact_Reachability_Pre_Development_Audit_Report_2026_07_28.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1B Surface Exact Reachability Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | Pre-Development Design Audit only |
| Dependency | Batch 1.1A Final Gate = **PASS** |
| Code changes | **None**（生产未改；仅只读 EXPLAIN / 基线归档） |

---

## 1. Executive Summary

Rank≥9 surface exact 不可达的根因不是「LIMIT 数字太小」，而是：

```text
Surface verification incorrectly depends on
the prior-ranked bounded ambiguity candidate page.
```

职责应拆分：

| Concern | Owner |
|---------|-------|
| Ambiguity fetch（有界 prior 页） | Recall 决策 + Runtime 机械 lookup |
| Explicit surface identity verification | **Recall 决策** + Runtime **机械 exact lookup**（待新增，本轮不实现） |

推荐方案：**Option A — Independent exact-surface existence lookup**（+0/+1 SQL；复用现有 `(pinyin_key, word)` autoindex；**无需新 index**）。

与 1.1A truncation Contract **可兼容**：surface exact 是 identity verification，不是 residual-singleton uniqueness 推断。

---

## 2. Final Verdict

```text
BATCH 1.1B PRE-DEVELOPMENT AUDIT:
PASS

SURFACE REACHABILITY ROOT CAUSE CONFIRMED
OWNERSHIP AND CONTRACT DEFINED
READY FOR BATCH 1.1B DEVELOPMENT
```

---

## 3. Audit Scope

仅：surface reachability 设计。不含 tone unsupported（1.1C）、HB ellipsis（1.1D）、alias SQL 下推、新 index。

---

## 4. Batch 1.1A Gate Dependency

```text
BATCH 1.1A FINAL GATE: PASS
→ Part B authorized
```

1.1B 不得破坏：truncation-aware uniqueness、exact-limit conservative reject、Runtime≠uniqueness owner。

---

## 5. Current Call Graph

```text
LexicalWindowQuery / recallTopKForWindows
  → recallSpanTopKV3 / recallSpanTopKV2
    → collectBaseOnlySingleCharCandidate
        → lookupBaseByPinyinKey | lookupBaseByPinyinAndToneKey  (LIMIT=8)
        → filterEligibleBaseSingleChar
        → resolveLength1BaseCandidate
            → unique (!truncated) | pickUniqueSurfaceExact(fetched eligible only)
        → scoreLength1BaseHit → WindowCandidate
  → buildLexicalEdges → Path
```

| Step | File | Owner |
|------|------|-------|
| LIMIT fetch | `lexicon-runtime-v2.ts` | Runtime（机械） |
| eligibility | `recall-span-topk-v2.ts` | Recall |
| surface exact | `pickUniqueSurfaceExact` | Recall |
| Candidate | scoreLength1 | Recall |

**Surface 来源：** `windowText`（trim）；与 FW raw window slice 对齐；当前 **JS string `===`**，无 NFC/NFKC 规范化。

---

## 6. Current SQL and LIMIT Behavior

```sql
WHERE pinyin_key=? AND enabled=1 AND length(word)=?
ORDER BY prior_score DESC LIMIT 8
```

Surface 仅在返回页内匹配 → rank9+ **unreachable**（已复现）。

---

## 7. Root Cause

```text
Surface verification incorrectly depends on
the prior-ranked bounded ambiguity candidate page.
```

- `LIMIT=8` 作为 **ambiguity fetch** 仍合法（1.1A）  
- Surface exact 是 **另一查询语义**，不应寄生在 prior 页上  

---

## 8. Ownership

```text
Recall owns: whether explicit surface exact may accept a Candidate
Runtime owns: mechanical “does exact (key, surface) row exist?”
SQLite: data only
Edge/Path: consumers only
```

禁止：`lookupBestSurface` / `resolveUniqueSurface` / SQL 直接出最终 Candidate。

---

## 9–10. Current vs Expected Contract

| Current | Expected (for 1.1B Dev) |
|---------|-------------------------|
| Surface ⊆ ambiguity LIMIT page | Ambiguity fetch **unchanged** |
| rank9+ → empty | Independent exact-surface verify may accept when legal |
| Truncation residual singleton reject | **Keep** |
| Surface under truncation risk | **Allowed if** identity row proven by exact lookup（非 inferred unique） |

拟定（开发时写入 CR，本轮不定稿实现）：

```text
Explicit valid surface exact is identity verification,
not inferred uniqueness from a truncated ambiguity page.
```

前置：key 匹配、enabled、!alias、length=1、无重复冲突。

---

## 11. Surface Semantics

| Case | Rule |
|------|------|
| S1 key+surface 合法 base | 允许 exact Candidate |
| S2 pinyin mismatch | **拒绝**（不跨 key） |
| S3 alias/disabled | **拒绝** |
| S4 duplicate surface | **拒绝**（非唯一） |
| S5 tone path vs plain surface | **不**在 1.1B 改变 tone fallback；tone 路径仅在 tone key 下 exact |

---

## 12–13. Plain / Tone Behavior

- Plain：`lookupBaseByPinyinKey`  
- Tone：`lookupBaseByPinyinAndToneKey`  
- 1.1B 应为两条路径各提供机械 exact lookup（或带 optional tone 参数）  
- **不**修改 `supportsToneFirstRecall=false` 政策（1.1C）

---

## 14. Truncation Interaction

```text
ambiguity fetch 满 LIMIT
+ independent surface exact hit
→ 可接受 Candidate（identity）
```

仍禁止：无 surface 时把 residual singleton 当 unique（1.1A）。

---

## 15. Eligibility Rules

Exact lookup 结果仍须过：enabled、!alias、length=1、prior>0、唯一 surface。与现 filter 对齐。

---

## 16. Unicode Exactness

当前与建议默认：

```text
exact = JS/SQLite string equality on word
（无 NFC/NFKC / 简繁折叠）
```

异体字/规范化若需要 → 独立后续 Batch，不混入 1.1B。

---

## 17–18. Existing / Proposed Runtime API

**现有：** 仅 `lookupBaseByPinyinKey` / `lookupBaseByPinyinAndToneKey`。  
**无** `lookupBaseBySurface` / `lookupExactTerm`。

建议机械 API（开发阶段实现）：

```text
lookupBaseByExactSurfaceAndPinyin(pinyinKey, word, termLength=1, sqlLimit?)
lookupBaseByExactSurfacePinyinAndTone(..., tonePinyinKey, ...)
```

禁止命名：`resolveSurfaceCandidate` / `pickBestSurface` / `getUniqueSurface`。

---

## 19. SQL Query Plan

证据：`lattice_v1_batch1_1b/explain_query_plan_surface_vs_ambiguity.json`

| Query | Plan |
|-------|------|
| Ambiguity LIMIT | `SEARCH ... INDEX idx_base_pinyin (pinyin_key=?)` + TEMP B-TREE ORDER BY |
| Hypothetical exact surface | `SEARCH ... INDEX sqlite_autoindex_base_lexicon_1 (pinyin_key=? AND word=?)` |

```text
No new SQLite index required
No temp tables
```

性能风险：**低**（点查）；标注：若未来去掉 autoindex 需重审（架构禁新 index）。

---

## 20. Cache Design

Exact lookup cache key 须含：

```text
lookupType=exact_surface | exact_surface_tone
surface, pinyinKey, toneKey?, termLength, limit, tier=base
```

禁止与 ambiguity `base:plain:...` 共用。

---

## 21. Candidate Contract

复用：`source=base_term`、`recallCandidateKind=exact_base`、`domains=[]`、`repairTarget=false`、cap=1。  
不新增 kind。

---

## 22. Edge/Path/Vote Impact

仅改变 Candidate **可达性**。不改 Edge/Path/Vote/Assembly/KenLM 算法。Vote 仍为 0。

---

## 23. Real SQLite Baselines

| ID | Current behavior |
|----|------------------|
| B1 rank1 | reachable（fetched-set surface） |
| B2 rank8 | reachable |
| B3 rank9 | **unreachable**（Stage4 RANK9） |
| B4 rank20 | unreachable |
| B5 absent | empty |
| B6 alias | empty |
| B7 disabled | empty |
| B8 mismatch | empty |
| B9 duplicate | empty |
| B10 plain/tone | tone key 约束；不在 1.1B 改 unsupported |

归档：`surface_reachability_current_baselines.json`；探针测试文件已就位供开发前复跑。

---

## 24. Performance Baseline

| Metric | Current length=1 |
|--------|------------------|
| physical SQL | **1**（ambiguity only） |
| Extra probe today | 0 |

| Option | Extra SQL |
|--------|-----------|
| A independent exact | **+0 or +1**（仅当需要 surface verify） |
| B enlarge LIMIT | 0 extra but **不根治** |
| C fetch all | 高风险热点 key |
| D ORDER BY CASE surface | 0 extra but **污染 ambiguity 页** |

---

## 25–28. Options

### Option A — Independent exact-surface lookup — **RECOMMENDED**

- 语义清晰；不受 prior LIMIT  
- 可用现有 autoindex  
- +1 SQL 可接受  
- 与 1.1A 兼容  

### Option B — LIMIT+1 / 增大 LIMIT — **REJECTED as root fix**

- 只移动边界；rank20 仍失败  
- 与 truncation existence 问题不同  

### Option C — Fetch all same-key — **REJECTED**

- 热点同音膨胀；内存/缓存风险  

### Option D — SQL prioritize surface in LIMIT page — **REJECTED**

- 污染 ambiguity ranking  
- 可能干扰 1.1A truncation 语义  
- 混合 verification 与 ranking  

---

## 29. Recommended Repair

```text
Batch 1.1B Development (future):
1. Contract CR: surface identity vs ambiguity fetch
2. Runtime mechanical exact-surface lookup (plain+tone)
3. Recall: after ambiguity path, if no chosen OR when surface present,
   call exact lookup; apply eligibility; accept if unique legal identity
4. Tests: B1–B10 after behavior; keep 1.1A truncation suite green
5. No new indexes / no alias SQL pushdown / no tone-unsupported change
```

最小拆分：Runtime API → Recall wiring → tests（可两 PR）。

---

## 30. Rejected Alternatives

B / C / D（见上）。禁止 Runtime uniqueness 命名。

---

## 31. Risks

| Risk | Mitigation |
|------|------------|
| Exact lookup 绕过 truncation | Contract：仅 identity；仍拒 inferred unique |
| Tone 政策漂移 | 冻结至 1.1C |
| Duplicate surface | 非唯一 → empty |
| Autoindex 假设 | EXPLAIN 已证；schema 变更需重审 |

---

## 32. Regression Scope（开发时）

1.1A truncation 全套；length1 contract；Edge/Path/Vote；2–5 Recall；HB；freeze；B1–B10。

---

## 33. Documentation Changes（开发时）

Implementation Contract 新 CR；不改 Architecture FROZEN（无新 index）。

---

## 34–37. KEEP / MODIFY / DELETE / NEW

| | |
|--|--|
| KEEP | LIMIT=8 ambiguity fetch；1.1A truncation；cap=1 |
| MODIFY（未来 Dev） | Recall surface path；+Runtime exact lookup |
| DELETE | 无 |
| NEW（未来） | exact-surface API + tests；本审计报告已 NEW |

---

## 38–39. Target / Check

审计项完成；未开发；未新 index；未破坏 1.1A；未进 Batch 2。

---

## 40. Development Readiness

```text
READY FOR BATCH 1.1B DEVELOPMENT
（需独立 Stage 1→5 提示词启动；本文件仅为 Pre-Dev Audit）
```
