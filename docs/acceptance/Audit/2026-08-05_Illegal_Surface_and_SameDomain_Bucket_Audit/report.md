# FW Repair V4 — Illegal Surface Provenance and SameDomain Bucket Missing Candidate Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | `FW_V4_FREEZE_2026_08_03` |
| Nature | READ ONLY / ROOT CAUSE AUDIT |
| KenLM blamed? | **No** |
| Verdict | **ILLEGAL_SURFACE_AND_BUCKET_ROOT_CAUSE_CONFIRMED** |

## Scope

- Focus repeats: `KLM000015/d043`, `KLM000033/d088`, `KLM000049/d133`, `KLM000067/d178`
- Runtime pattern: **identical** across the four (`_focus_trace_identity.json`)
- dialog_200 fragment inventory: **22** cases containing `生城|声城|生成|后选|候选` (`case_inventory.csv`)

Evidence sources (frozen traces, not re-run production):

- `docs/tone-v2/_audit_scratch/dialog200_sentence_assembly_trace/`
- `docs/tone-v2/_audit_scratch/dialog200_span_assembly_acceptance/cases/`
- `node_runtime/lexicon/v3/lexicon.sqlite`

---

## Q1 — 「生城 / 声城」是否正式词库 term？

**否。**

| surface | formal term? | SQLite |
|---------|--------------|--------|
| 生城 | **No** | 0 rows |
| 声城 | **No** | 0 rows |
| 生成 | **Yes** | `exp-v1_1-alias-shengcheng` + `base-rebuild-exp-v1_1-alias-shengcheng` |
| 候选 | **Yes** | `exp-v1_1-alias-houxuan` / domains=`tech_ai` |
| 后选 / 生 / 城 | **No** as standalone formal terms in v3 | 0 rows |

→ 不是词库污染；不是正式完整 term。

---

## Q2 — 若不是，由什么拼成？

以 d043 / d019 句级 Assembly Trace 为准：

```text
DOMAIN_CANDIDATE: 后选 → 候选   (sameDomain / tech_ai)
+ RAW_PRESERVED:  声 或 生      (single-char fallback budgeted)
+ RAW_PRESERVED:  城            (single-char fallback budgeted)
= assembled substring: 候选声城 / 候选生城
```

| 字符 | sourceType | 是否同一 termId | 是否同一 Edge |
|------|------------|-----------------|---------------|
| 候/选（替换后） | `DOMAIN_CANDIDATE` | `exp-v1_1-alias-houxuan` | domain edge on `后选` span |
| 生 或 声 | `RAW_PRESERVED` | 无 | fallback single-char edge |
| 城 | `RAW_PRESERVED` | 无 | fallback single-char edge |

**结论：** `生城`/`声城` 是 **非法句子片段组合**，不是 Lexicon Candidate。

Primary cause: **`RAW_FRAGMENT_PRESERVED`**（邻接于合法 Domain 替换之后）。

---

## Q3 — 「生成」是否在正式词库与 Runtime Bundle？

**是。**

- `base_lexicon`: `base-rebuild-exp-v1_1-alias-shengcheng`
- `term`: `exp-v1_1-alias-shengcheng`（tier=`domain`）
- `pinyin_key`: `sheng|cheng`
- `tone_pinyin_key`: `sheng1|cheng2`
- `enabled`: 1
- `term_domain_tags`: **空** → 召回后 `resolveGraphSource` 会落为 **`base_term`**
- 同 plain key 还有 `声称`(sheng1\|cheng1)、`省城`(sheng3\|cheng2)，本轮 window 亦无命中

---

## Q4 — 「生成」第一次在哪个生产阶段缺失？

**`EXACT_RECALL` / `FIRST_MISSING_STAGE_FOR_生成 = EXACT_RECALL`**

漏斗（d043 代表）：

| Stage | Present? |
|-------|----------|
| Lexicon / SQLite | Yes |
| Window `sheng\|cheng`（文本可为 声城/生城/生成） | Yes，已生成且 query 记录存在 |
| Tone-exact SQL hit → Recall Candidate | **No（candidateCount=0）** |
| LexicalEdge / Path / Bucket / Assembly | 未到达 |

对照：相邻 window `hou|xuan` **能**召回 `候选`。冻结合约 Recall 为 **Tone Exact only**（无 plain fallback）。因此归类：

- Primary: **`TONE_QUERY_MISS`**
- 标注：`ACCEPTED_TONE_MODEL_LIMITATION`（声学调型未命中 `sheng1|cheng2`；本轮未改 Tone）
- **不得**用 Tone 同时解释非法 `生城` 的出现——非法片段来自 Raw 保留 + 邻接组装，与 Tone 是两条问题。

---

## Q5 — 「候选」与「生成」能否进同一 sameDomain bucket？

| | Actual | Theoretical if 生成 recalled |
|--|--------|------------------------------|
| 候选 | 进入 `tech_ai` sameDomain | — |
| 生成 | **从未进入任何 bucket** | 作为 **base_term** 可进入 retained `tech_ai` bucket 的 `baseCandidates` |

代码证据：`filterDomainCandidatesPerSpan`（`assemble-domain-aware-span-sets.ts`）对 retained domain：

- sameDomain ← domain_term 且 domains 含 bucketDomain
- **else if base_term → baseCandidates（允许）**

→ 实际不能同桶，是因为 **生成未召回**，不是同桶互斥。

---

## Q6 — Base Candidate 是否被错误阻止参与 Domain bucket？

**否。** 未发现 `BASE_CANDIDATE_BUCKET_BINDING_DEFECT`。

本案例中 `生成` 甚至还没进入 Vote / Bucket 输入集（`BEFORE_VOTE` / `NEVER_RECALLED`）。

---

## Q7 — 二者 Edge 能否进入同一 SegmentationPath？

**实际：否**（`生成` LexicalEdge 不存在）。

**理论：是**（范围不重叠：`后选` span vs `生|城` span；无 `EDGE_RANGE_OVERLAP`）。

未触发独立的 `MULTI_EDGE_PATH_ENUMERATION_DEFECT`——缺陷停在更早的 Recall。

---

## Q8 — 「候选生成」是否被 Assembly 构造过？

对 **损坏区**（`后选声城` / `后选生城`）：

- **从未**枚举出把该区修成 `候选生成` 的组合
- 分类：`ASSEMBLY_COMBINATION_NOT_ENUMERATED`
- 原因链：无 `生成` edge → 无法替换 `生+城`/`声+城` fallback

注：d043 后半句 Raw 已含正确 `候选生成`，那是 **原文保留**，不是对前半损坏区的修复。

---

## Q9 — 是否系统性偏向单 replacement 局部修复？

**是（对本模式）。**

典型非 Raw 候选：只做 `后选→候选`（有时再加 `计化→计划`），留下 `生城`/`声城`。

`replacement_quality_distribution.csv`：Single Replacement + `ILLEGAL_SURFACE_COMBINATION` 大量出现；完整 `候选生成` 修复未进入 KenLM 池。

---

## Q10 — 真正需要改什么？

| 层 | 需要改？ |
|----|----------|
| KenLM | **否** |
| 仅诊断字段 | **否**（虽有历史 `parent_fragment` 误标，但非法片段本身是真组装结果） |
| 词库新增「生城」/短语「候选生成」 | **本轮禁止；也非根因** |
| Domain tag 改「生成」 | **本轮禁止；空 tag 不是 FIRST_MISSING** |
| **Tone / Exact Recall 可达性（生成）** | **是 — 主修复面** |
| 召回到达后的多 Edge Assembly | 次要，待 Recall 恢复后再验 |
| Bucket 绑定 | 非本轮主因 |

---

## Legacy fragment

见 `legacy_fragment_callgraph.md`：

- 生产 `parent_fragment`：**NON_PRODUCTION**（冻结合约禁止）
- 非法 bigram：**非** legacy fragment path；是 **fallback raw chars + domain replacement 邻接**

---

## Primary Causes（每问题唯一）

| Problem | Primary Cause |
|---------|---------------|
| 非法 Surface `生城`/`声城` | `RAW_FRAGMENT_PRESERVED` |
| `生成` 缺失 | `TONE_QUERY_MISS` |

---

## Final Verdict

```text
ILLEGAL_SURFACE_AND_BUCKET_ROOT_CAUSE_CONFIRMED

“生城”的真实 provenance 已确定；
“生成”的 FIRST_MISSING_STAGE 已确定；
sameDomain bucket、Path 和 Assembly 的责任边界已完成对账。

可以基于唯一根因制定最小修复方案。
```

---

## Legacy Fragment Callgraph

## Production freeze (`FW_V4_FREEZE_2026_08_03`)

| Mechanism | Status | Evidence |
|-----------|--------|----------|
| `parent_fragment` in `recallSpanTopKV2` | **NON_PRODUCTION** | `freeze-contract.test.ts` asserts source must NOT contain `parent_fragment` / `term_pinyin_ngrams` |
| `parentFragmentHitCount` | always 0 in production recall wiring | `recall-topk-for-windows.ts` comment: parent-fragment recall retired |
| Historical `hitKind: parent_fragment` in `dialog200_span_assembly_acceptance` | **DIAGNOSTIC / STALE EXPORT** | Uses `termId: ngram:*` not current `exp-v1_1-alias-*` |
| Single-char fallback edges | **PRODUCTION ACTIVE** | `fallback:{i}:{i+1}` edges in span acceptance; budgeted raw chars in sentence assembly trace |
| SameDomain + Base co-budget | **PRODUCTION ACTIVE** | `assemble-domain-aware-span-sets.ts` `filterDomainCandidatesPerSpan`: sameDomain OR baseCandidates |

## Illegal bigram formation (active, not legacy fragment path)

```text
DOMAIN replacement: 后选 → 候选
+ RAW_PRESERVED char: 生 or 声
+ RAW_PRESERVED char: 城
= assembled substring 候选生城 / 候选声城
```

This is **not** a lexicon term projection and **not** a parent_fragment hit.
Mark: **not LEGACY_FRAGMENT_PATH_ACTIVE** for 生城/声城; mechanism is assembly adjacency of legal replacement + raw fragments.
