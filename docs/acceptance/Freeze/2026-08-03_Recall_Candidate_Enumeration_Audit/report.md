# FW Repair V4 — Recall Candidate Enumeration Audit (Pre-KenLM Final)

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **READ ONLY** · Final Pre-KenLM |
| Freeze | **FW_V4_FREEZE_2026_08_03** |
| Changed | **None** |
| Verdict | **ENUMERATOR_CORRECT** |

---

## 1. Scope

只审计：

```text
SQLite Result → Enumerator → Scoring → Merge/TopK → Recall Candidate
```

不重复：Window / Syllable / Query Builder / Tone Query Contract。

产物目录：`docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Enumeration_Audit/`

---

## 2. Call Chain（代码）

详见 `candidate_callgraph.md`。

```text
lookupBaseByPinyinAndToneKey / lookupDomainsByPinyinAndToneKeyMulti
  → collectTierCandidatesToneFirst
      → mergeSpanCandidatesCombined          // Domain>Alias>Base + perSpanLimit
  → scoreHotword (bestById)                  // length/prior/minScore/dedupe
  → sortRecallHitsByToneCompatibility        // RANK only — no DROP
  → hits.slice(0, perSpanLimit)              // final TopK
  → bindLexiconHitsToWindow                  // minPrior
```

---

## 3. TopK 发生在哪里？

| 位置 | Cap |
|------|-----|
| SQL `LIMIT` | `max(perSpanLimit, 8)` |
| `mergeSpanCandidatesCombined` | `perSpanLimit`（len≥2 时 = `exactTopK=2`） |
| `recallSpanTopKV2` 返回前 `slice` | 同上 |

**不是** Window 阶段；是 Enumerator 内。

---

## 4. Domain 顺序

```text
Base SQL ∥ Domain SQL → merge（有 active domain 时 domain 优先）→ score → TopK
```

**不是** TopK 之后再 Domain 过滤。

---

## 5. Tone（Enumerator 内）

Tone 已在 SQL `WHERE tone_pinyin_key=?` 约束 Result Set（前序审计）。  
Enumerator 内 `sortRecallHitsByToneCompatibility`：**只排序/乘 penalty，不删除**。

---

## 6. Trace 证据（失败 Case）

### snack-01 · Query `xiao|shi` ∧ `xiao1|shi1`

| SQLite surface | → |
|----------------|---|
| **消失** (prior=0.85) | SQL_RETURNED → KEEP_MERGE → KEEP_SCORE → KEEP_TONE_RANK → KEEP_TOPK → **KEEP_RECALL_CANDIDATE** |

小食 (`xiao3|shi2`)：**不在** SQLite Result（`TONE_KEY_MISMATCH_NOT_IN_SQL`）。

### trigger-01 · `chu|fa` ∧ `chu1|fa1`

| SQLite | → |
|--------|---|
| **出发** | 全链路 KEEP → Recall Candidate |

触发 (`chu4|fa1`)：不在 SQL Result。

### threshold-01 · `yu|zhi` ∧ `yu1|zhi1` / `yu|zhi|yi` ∧ …

SQLite **0 行** → Recall **0**。阈值 (`yu4|zhi2`) 不在 Result（tone / 3-gram plain）。

### nn-train-01 · `wo|men`∧`wo1|men1`，`zheng|zai`∧`zheng1|zai1`

SQLite 0 行（噪声调与词库 `wo3|men5` / `zheng4|zai4` 不等）。我们/正在 不在 Result。

### nn-train-01b · `men|zheng`∧`men1|zheng1`

SQLite：**闷蒸** → KEEP 为 Recall Candidate。正在 plain 不同 → 不在 Result。

### sync-01 · `yi|jing`∧`yi1|jing1`，`tong|bu`∧`tong1|bu1`

SQLite 0 行（tone 不匹配 `yi3|jing1` / `tong2|bu4`）。

**`correctInSqlButDropped = []`** —— 没有任何正确词“进了 SQL 又被 Enumerator 丢掉”。

---

## 7. Q1–Q5

### Q1 SQLite 真正返回哪些词？

见 `sqlite_result_set.csv`。焦点窗非空例：消失、出发、闷蒸（及闷蒸 domain 行）。多数焦点窗 **0 行**。

### Q2 哪些进入 Recall Candidate？

与非空 SQL 一致：消失、出发、闷蒸。空 SQL → 空 Recall。

### Q3 哪些被 DROP？

本批焦点窗：**无** SQL→Recall 的中途 DROP（单行全程 KEEP）。正确修复词在 SQL 前已排除。

### Q4 DROP 发生在哪里？

合同上可 DROP 的阶段：merge limit、scoreHotword、final TopK slice、minPrior。  
本批焦点：**未触发**对正确词的 DROP；正确词缺失点在 **SQL Result 为空/无该 surface**。

### Q5 还有隐藏过滤吗？

Trace 覆盖合同链。无 case 特判、无 Plain Fallback、无 SQL 后 Tone 硬删。  
有文档化过滤（merge/score/TopK/minPrior）；对本批失败 **不是** 隐藏杀手。

---

## 8. Final Verdict

```text
ENUMERATOR_CORRECT

SQLite Result 符合合同；Enumerator 过滤链已完整 Trace。
正确 Candidate 未进入 SQLite Result（噪声 Tone/Plain Query Key），
而非 Enumerator 中途 DROP。
Recall Enumerator 可按当前冻结合同理解；Pre-KenLM 阻塞点不在 Enumerator。
```
