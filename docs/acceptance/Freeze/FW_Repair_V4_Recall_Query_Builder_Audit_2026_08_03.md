# FW Repair V4 — Recall Query Builder Audit (Tone Key Contract)

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **READ ONLY** · Recall Query Builder Audit |
| Freeze | **FW_V4_FREEZE_2026_08_03** |
| Changed | **None** (Framework / Tone / Recall / Lexicon / KenLM 未改) |
| Verdict | **QUERY_BUILDER_CORRECT** |

---

## 1. Scope

只审计：

```text
Window → Tone Pattern → Query Builder → SQLite → Candidate
```

不审计 CrossPath / KenLM / Candidate Generation 成败归因以外的内容。

---

## 2. Call Graph

见：`recall_query_builder_callgraph.md`

摘要：

```text
recallTopKForWindows
  → extractAcousticTonePatternForRecall
  → recallSpanTopKV2
  → collectTierCandidatesToneFirst
  → resolveToneRecallReadiness
  → lookupBaseByPinyinAndToneKey(plain, tone, len, limit)
  → SQLite stmtBaseToneComposite
```

---

## 3. Tone Mode

**Mode C — Plain + Tone 联合 Query**

真实 SQL（`lexicon-runtime-v2.ts` `stmtBaseToneComposite`）：

```sql
SELECT id, pinyin_key, tone_pinyin_key, word, ...
FROM base_lexicon
WHERE pinyin_key = ?
  AND tone_pinyin_key = ?
  AND enabled = 1
  AND length(word) = ?
ORDER BY prior_score DESC
LIMIT ?
```

Domain / Idiom 同构（额外 `domain_id` / idiom 表）。

| Mode | 本轮结论 |
|------|----------|
| A Tone-only | **否** |
| B Plain then Tone filter | **否**（Tone 在 WHERE，不是事后过滤主路径） |
| C Plain ∧ Tone | **是** |
| D Plain Fallback | **否**（1.1C 已移除；探针 `plainLookupCallsDuringFailCases=0`） |

Tone 合同细节：`tone_query_contract.md`。

---

## 4. Tone 来源（代码）

```text
acousticSlices.tonePosterior + wordTimeSpans
  → extractAcousticTonePatternForRecall
  → acousticTonePattern: number[]
  → buildTonePinyinKeyFromSyllablesAndPattern(syllables, pattern)
  → queryTonePinyinKey
  → SQLite bind tone_pinyin_key=?
```

文件：

- `span-assembly-shared/tone-recall.ts`
- `lexicon-v2/tone-recall-readiness.ts`
- `lexicon/phonetic/tone-pinyin.ts`
- `lexicon-v2/tone-first-tier-collector.ts`
- `lexicon-v2/lexicon-runtime-v2.ts`

---

## 5. Fallback 证明

| 证据 | 结果 |
|------|------|
| `collectTierCandidates` → 仅 `collectTierCandidatesToneFirst` | 无 Plain 分支 |
| `tone-first-tier-collector.ts` 注释 / `plainFallbackHitCount=0` | Plain fill 已删 |
| Mandatory 路径调用 `lookupBaseByPinyinKey` | **0 次**（本轮 6 失败 Case Runtime Trace） |
| readiness ≠ ready | **不发 SQLite**（Fail Closed） |

---

## 6. 失败 Case — 真实 Runtime Query

探针拦截 `lookup*`，导出 `recall_query_trace.csv` / `recall_sql_trace.csv`（413 query / 826 SQL）。

### snack-01 · 消失 → 小食

| 字段 | Noise Window「消失」 | Correct Self Key「小食」 |
|------|----------------------|---------------------------|
| plainKey | `xiao\|shi` | `xiao\|shi` |
| toneKey | **`xiao1\|shi1`** | **`xiao3\|shi2`** |
| Bind | pinyin=`xiao\|shi`, tone=`xiao1\|shi1`, len=2 | pinyin=`xiao\|shi`, tone=`xiao3\|shi2`, len=2 |
| Result | **消失** | **小食\|小时** |

Plain 相同；Tone 不同 → 联合 Query 命中噪声词，不命中正确词。

### trigger-01 · 出发 → 触发

| 字段 | Noise「出发」 | Correct「触发」 |
|------|---------------|-----------------|
| plainKey | `chu\|fa` | `chu\|fa` |
| toneKey | **`chu1\|fa1`** | **`chu4\|fa1`** |
| Result | **出发** | **触发** |

### threshold-01 · 阈之一 → 阈值

| 字段 | Noise「阈之一」 | Correct「阈值」 |
|------|-----------------|-----------------|
| plainKey | **`yu\|zhi\|yi`** | **`yu\|zhi`** |
| toneKey | `yu1\|zhi1\|yi1` | `yu4\|zhi2` |
| length | **3** | **2** |

窗长 / plain 不同 → SQL `length(word)=3` 不可能命中 2 字「阈值」。

### nn-train-01b · 闷蒸 → 正在

| 字段 | Noise「闷蒸」 | Correct「正在」 |
|------|---------------|-----------------|
| plainKey | **`men\|zheng`** | **`zheng\|zai`** |
| toneKey | `men1\|zheng1` | `zheng4\|zai4` |
| Result | **闷蒸** | **正在** |

Plain 已不同 → Tone 再严也回不到「正在」。

### nn-train-01 · 我闷蒸在 → 我们正在

窗 `wo|men|zheng|zai` + tone `wo1|men1|zheng1|zai1`（len=4）。  
「我们正在」非单一 lexicon term；需多原子 Assembly。本轮 Query 发的是 4-gram 联合键，不是「我们」+「正在」各自 Self Key。

### sync-01 · 已精通步 → 已经同步

窗 `yi|jing|tong|bu` + `yi1|jing1|tong1|bu1`（len=4）。  
正确路径需要「已经」(`yi3|jing1`) +「同步」(`tong2|bu4`) 等分窗命中；噪声 4-gram 联合键 ≠ 任一正确原子 Self Key。

---

## 7. Query Trace（调试用）

本轮新增只读探针（**不改生产代码**）：

`docs/tone-v2/_audit_scratch/recall-query-builder-audit.mjs`

每个 Window 记录：

```text
Window → Plain → Tone → QueryType → SQL → Bind → Candidate
```

产物目录：`docs/acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/`

- `recall_query_trace.csv`
- `recall_sql_trace.csv`
- `noise_window_focus.csv`
- `summary.json`
- `recall_query_builder_callgraph.md`
- `tone_query_contract.md`

---

## 8. Q1–Q5

### Q1 Runtime 真正使用什么 Query Key？

**联合键**：`pinyin_key` + `tone_pinyin_key`（+ `length(word)` + LIMIT）。  
`queryTonePinyinKey` = plain syllables ⊕ acoustic tone digits。

### Q2 Tone 是否真正参与 SQLite Query？

**是。** `WHERE ... AND tone_pinyin_key = ?`，Bind 已在 `recall_sql_trace.csv` 证明。

### Q3 Tone 参与 Query 还是 Filter？

**参与 Query（Mode C 联合 WHERE）。**  
另有 hit 集内 `sortRecallHitsByToneCompatibility`，不替代 SQL 门闸。

### Q4 失败 Case 真正查什么 Key？

| Case | 实际 Query（噪声焦点窗） |
|------|--------------------------|
| snack-01 | `xiao\|shi` ∧ `xiao1\|shi1` |
| trigger-01 | `chu\|fa` ∧ `chu1\|fa1` |
| threshold-01 | `yu\|zhi\|yi` ∧ `yu1\|zhi1\|yi1` (len=3) |
| nn-train-01b | `men\|zheng` ∧ `men1\|zheng1` |
| nn-train-01 | `wo\|men\|zheng\|zai` ∧ `wo1\|men1\|zheng1\|zai1` |
| sync-01 | `yi\|jing\|tong\|bu` ∧ `yi1\|jing1\|tong1\|bu1` |

### Q5 为何 Self Recall 8/8，但 Case Candidate 没有正确词？

**Query Key 不同（有证明，非猜测）：**

- Self：用正确词自己的 `tone_pinyin_key` 作 acoustic → Bind 与词库行一致 → HIT  
  例：小食 → `xiao|shi` ∧ `xiao3|shi2` → 小食  
- Case 噪声窗：用噪声窗 plain + 噪声声学调 → Bind 命中噪声词或空  
  例：消失 → `xiao|shi` ∧ `xiao1|shi1` → **消失**（不是小食）

Query Builder 按合同正确地发出了「噪声联合键」；正确词从未作为该窗的 SQL Bind。

---

## 9. Final Verdict

```text
QUERY_BUILDER_CORRECT

Tone Key 正确参与 Recall（Mode C：pinyin_key ∧ tone_pinyin_key）。
Plain Fallback 在 Mandatory 路径不存在。

失败 Case 的 SQL 已证明发出的是噪声窗联合键；
问题不在「Tone 没进 Query」，而在 Query 之后的候选集合
（键与正确词库行不一致 → 正确 Candidate 从未被该窗查出）。
```
