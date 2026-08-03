<!-- Documentation Hierarchy Metadata
Status: **RETIRED**
Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0
Archive Path: docs/archive/RETIRED/FW_Repair_V4_Legacy_Parent_Fragment_Recall_Retirement_Audit_2026_08_01.md
-->

> **RETIRED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0

# FW Repair V4 — Legacy Parent Fragment Recall Retirement Audit

**Date:** 2026-08-01  
**Nature:** READ ONLY · PRE-DEVELOPMENT · LEGACY LTR MECHANISM RETIREMENT · PRODUCTION PATH ONLY  
**禁止已遵守:** 未改代码 / SQLite / rebuild / 配置 / dialog_200；未加黑白名单；未保留双链路建议。

**Artifacts:**

| Artifact | Path |
|----------|------|
| Probe | `docs/tone-v2/_audit_scratch/parent-fragment-retirement-probe.mjs` |
| Probe result | `docs/tone-v2/_audit_scratch/parent_fragment_retirement/_probe_result.json` |
| Tight CF | `docs/tone-v2/_audit_scratch/parent_fragment_retirement/_tight_cf.json` |
| Upstream pollution audit | `docs/tone-v2/FW_Repair_V4_Lexicon_Pollution_and_Abnormal_Candidate_Origin_Audit_2026_08_01.md` |

---

## 1. Executive Conclusion

**Verdict: FULL_RETIREMENT_READY**

```text
FULL_RETIREMENT_READY

parent_fragment / term_pinyin_ngrams
属于已过时的 LTR 模糊父词召回机制。

当前 Lattice 不依赖该机制；
移除后正式 term、canonical coverage、
Domain Vote、Assembly 均可保持有效。

可以彻底删除生产查询、类型、配置、派生表和旧文档，
不保留兼容或 fallback。
```

核心证据：

1. **退化已证实：** `ngramRowToHotword` 将 `fragment_text` 设为 `HotwordEntry.word` → `WindowCandidate.replacement`，**不是** `parent_word`。
2. **完整父词校验不存在：** 无左右边界 / 全窗覆盖父词拼音校验；eligibility 仅要求 fragment 音节宽度覆盖 FineSpan。
3. **Lattice 不依赖：** Path 由 LexicalEdge（exact term）+ fallback edge 连通；d001 已同时存在「蓝莓+马芬」与「蓝莓马芬」路径。
4. **生产危害：** dialog_200 中 **27 cases / 38 KenLM 命中事件**含噪声 fragment（科医/议室/低脂等）；Vote 池 **26 cases / 78 行「科医」**带 medical。

---

## 2. Audit Scope and Exclusions

- 生产：`recallSpanTopKV3` → Lattice → Domain Vote → Assembly
- Counterfactual：既有 `domain_vote_trace` + `sentence_assembly_trace`（只读）
- 不建议：黑名单、降权、fallback、双链路、LTR/Beam 回归

---

## 3. Legacy LTR Fragment Design Reconstruction

### 3.1 可证实的设计意图

| 来源 | 内容 |
|------|------|
| `materialize-term-ngrams.mjs` | 对父词生成连续 2–5 音节子串索引 |
| `compatibility/FROZEN.md` Step-4 | 「同 parentTerm + matched fragment 一致 → COMPATIBLE」 |
| `classify-overlap-relation.ts` | `parentTermCompletenessScore`：若 `replacement === parentTerm` 视为完整 |
| `TONE_FIRST_RECALL_FROZEN` | V3 = exact + `lookupParentFragments` 混排 |

**合理旧意图（文档/兼容层暗示）：**

```text
fragment = Index Key → 关联 parentTerm →（本应）完整父词成立后写回 parent
```

### 3.2 当前实现与旧意图的断裂

```text
LEGACY_DESIGN_PARTIALLY_RECOVERED
```

- **未找到**生产代码：fragment 命中后验证左侧/右侧上下文、要求整段 Raw 覆盖父词后再写回 `parent_word`。
- `parentTermCompletenessScore` 仅用于 **overlap coverage 择优**，且因 `replacement` 几乎永为 fragment，完整分几乎到不了 2（除非 window 恰好等于整父词子串）。
- LTR FineSpan 生成器已在 Step6 删除（`ltr-fine-span-generator` absent）；**本机制是遗留在 Recall 层的 LTR 旁路**。

**结论：旧设计若曾要求完整父词，该校验代码已不在生产路径；现仅剩 fragment 生成 + 直接写回。**

---

## 4. Current Lattice Architecture Baseline

```text
Raw → WindowQuery → Recall(exact + parent_fragment) → LexicalEdge
  → fallback 补洞 → SegmentationPath → PathFineSpan
  → Domain Vote → SameDomain Bucket → Assembly → CrossPath → KenLM
```

- Edge 绑定 **window 上的 WindowCandidate**（含 exact / parent_fragment）。
- 无 lexical 命中时注入 **fallback edge**（不造词库 surface），保证音节全覆盖。
- Assembly 保证 **canonical/raw** 保底。

---

## 5. Production Recall Call Chain

| 步骤 | 文件 | 函数 | 读 ngram？ | 生成 parent_fragment？ | 独立 surface？ | 校验完整父词？ | 可达性 |
|------|------|------|------------|------------------------|----------------|----------------|--------|
| Orchestrator | `span-assembly-v4-orchestrator.ts` | lattice entry | — | — | — | — | PRODUCTION_ACTIVE |
| Lattice runtime | `lattice-fine-span-runtime.ts` | `recallTopKForWindows` | via recall | 计数 | — | NO | PRODUCTION_ACTIVE |
| Window recall | `recall-topk-for-windows.ts` | `recallSpanTopKV3` / `bindLexiconHitsToWindow` | YES | YES | **YES** `replacement=hit.hotword.word` | NO | PRODUCTION_ACTIVE |
| V3 recall | `recall-span-topkv3.ts` | `lookupParentFragments` / `ngramRowToHotword` | YES | YES | **YES** `word=fragmentText` | NO | PRODUCTION_ACTIVE |
| SQL | `lexicon-runtime-v2.ts` | `lookupParentFragmentsByNgramKey` | YES | rows | fragment_text | NO | PRODUCTION_ACTIVE |
| Edge build | `build-lexical-edges.ts` | `orCandidateEvidence` | NO | 标记 `hasParent` | 透传 | NO | PRODUCTION_ACTIVE |
| Eligibility | `candidate-span-assembly-eligibility.ts` | `isCandidateEligibleForSpanAssembly` | NO | 不拒 hitKind | 写回 fragment | **仅 matched 宽度** | PRODUCTION_ACTIVE |
| Vote | `utterance-domain-vote.ts` | structural dedupe by parentTermId | NO | 可投票 | — | NO | PRODUCTION_ACTIVE |
| Compatibility | `classify-overlap-relation.ts` | parentTerm overlap | NO | 消费字段 | — | 非写回门禁 | PRODUCTION_ACTIVE |

`recallSpanTopKV2`：**明确禁止**引用 ngram（freeze-contract）——fragment 仅 V3 附加。

---

## 6. `term_pinyin_ngrams` Schema and Generation

### 6.1 Schema（生产 SQLite）

- **行数：** 4200（956 distinct parents）
- **PK：** `id`
- **索引：** `ngram_pinyin_key(+enabled)` / `+domain_id` / `parent_term_id` / `parent_term_id+start+end`
- **关键列：** `parent_term_id`, `parent_word`, `parent_pinyin_key`, `ngram_pinyin_key`, `ngram_start/end`, `fragment_text`, `tier`, `domain_id`, `prior`, `source`, `enabled`

### 6.2 生成规则（`materialize-term-ngrams.mjs`）

| 问题 | 答案 |
|------|------|
| fragment 如何截取？ | `sliceFragmentText`：按音节比例切父词汉字 |
| ngram 长度？ | **2–5** 音节（`MIN_NGRAM`/`MAX_NGRAM`） |
| 是否全部连续子串？ | **是** |
| 跨语义边界？ | **是**（无词素边界） |
| 过滤首尾不完整？ | **否** |
| fragment 须为正式 term？ | **否** |
| 须有独立语义？ | **否** |
| 保留 parent？ | **是**（列上有，运行时不用作 replacement） |
| 可恢复 parent？ | SQL 行可；Candidate.word **不恢复** |
| 为何选 fragment_text？ | `ngramRowToHotword` **硬编码** `word: row.fragmentText` |

调用链：`build-v2-shadow-bundle.mjs` / `term-materialize.mjs::rematerializeTerm` → `materializeTermNgrams` → `INSERT INTO term_pinyin_ngrams`。

---

## 7. `parent_fragment` Runtime Semantics

```text
Index Key (ngram_pinyin_key)
  → SQL rows
  → Hotword.word = fragment_text
  → hitKind = parent_fragment
  → WindowCandidate.replacement = fragment_text
  → Domain Vote / Assembly 写回
```

**合同违反：** `Index Key ≠ Replacement Surface` 在生产中被打破。

`termId` 形态：`ngram:{row.id}` —— **不是**正式 `term`/`base_lexicon` id。

---

## 8. Parent Completeness Validation Audit

| 检查点 | 存在？ |
|--------|--------|
| 校验左侧父词前缀 | **NO** |
| 校验右侧父词后缀 | **NO** |
| 校验整父词拼音覆盖 Raw | **NO** |
| 失败后丢弃 fragment | **NO**（无此阶段） |
| matchedWidth ≥ FineSpan 宽度 | YES（仅此） |

对「可以」(2 音节) +「科医」(ngram 宽 2)：matchedWidth=2 ≥ spanWidth=2 → **放行**。

---

## 9. 蓝莓马芬 Fragment Trace

**正式 term：** YES（base/domain，`lan|mei|ma|fen`，source `domain_seed_v1`）

**ngram 样例（每 domain 扇出）：**

| fragment | pinyin | start-end | 可独立写回？ |
|----------|--------|-----------|--------------|
| 蓝莓 | lan\|mei | 0-2 | YES（若召回） |
| 莓马 | mei\|ma | 1-3 | **YES — 无左右校验** |
| 马芬 | ma\|fen | 2-4 | YES |
| 蓝莓马 | … | 0-3 | YES |
| 蓝莓马芬 | full | 0-4 | YES（冗余于 exact） |

对「莓马」：

1. **可直接** `Candidate.word=莓马`（代码路径允许）。
2. **不会**自动返回仅 `parent_word`。
3–4. **不**检查左「蓝」/右「芬」。
5. 「草莓马芬」可共享「莓马」索引键（同拼音）。
6. **不**按 Raw 区分强制完整父词。
7. 完整匹配失败概念不存在 → fragment 仍可保留。

**Lattice 现实（d001）：** Path0 = 蓝莓+马芬；Path1 = 蓝莓马芬 exact —— **不需要**莓马。

---

## 10. 内科医生 / 科医 Fragment Trace

| fragment | 在 DB？ | 生产 Candidate？ |
|----------|---------|------------------|
| 内科 | YES（亦可为 term） | 可 |
| **科医** | YES ngram only | **YES** |
| 医生 | YES | 可 |
| 内科医 | YES ngram | YES（dialog_200 有写回） |
| 科医生 | YES ngram | 可能 |

**可以 → 科医 放行条件（证据链）：**

```text
window syllables ≈ ke|yi
→ lookupParentFragmentsByNgramKey('ke|yi')
→ rows: 儿科/内科/外科/妇科医生 · fragment_text=科医 · domain_id=medical
→ ngramRowToHotword.word='科医'
→ hitKind=parent_fragment
→ FineSpan 宽=2 = ngram 宽 → eligibility PASS
→ Domain Vote 计入 medical
→ Assembly 写回「科医」
```

---

## 11. Current Lattice Dependency Analysis

| # | 问题 | 答案 |
|---|------|------|
| 1 | Edge 绑定正式 term？ | **优先 exact**；亦绑 fragment Candidate |
| 2 | raw/syllable range？ | 来自 WindowQuery，非 fragment offset |
| 3 | 2–3 字原子是否够组 Path？ | **是**（d001） |
| 4 | 4–5 专名如何召回？ | **exact_term**（蓝莓马芬在库） |
| 5 | 长词必须 fragment？ | **否** |
| 6 | fragment 补洞？ | **否**；fallback edge 补洞 |
| 7 | 移除后 uncovered？ | 由 fallback + canonical 覆盖 |
| 8 | canonical/fallback 已有？ | **YES** |
| 9 | 仅 fragment 能生成的合法 Path？ | **未发现**必要路径 |
| 10 | 多 Edge 组句？ | **YES**（SegmentationPath） |

**parent_fragment 真实贡献：** 噪声 Candidate 槽位 + 错误域票 + 冗余（与 exact 同 surface 时）；**非**连通性必需。

---

## 12. Legal Long-Term Recall Strategy

```text
合法完整长词 → 存为正式 term → exact / full pinyin(+tone) Recall
应拆组合 → 多个原子 term Edge 由 Lattice 组合
中间 fragment 索引 → 不再需要
```

禁止因删 fragment 而回灌大量组合短语（原子化合同仍有效；「上线计划」等正式短语属另一轮词库清理）。

---

## 13. Recall SQL Dependency Map

**删除目标 branch：**

```sql
-- lexicon-runtime-v2.ts stmtNgram
SELECT ... FROM term_pinyin_ngrams
WHERE ngram_pinyin_key = ? AND enabled = 1
ORDER BY prior DESC LIMIT ?
```

**删除方法：** `lookupParentFragmentsByNgramKey` · `lookupParentFragments` · `ngramRowToHotword` · `scoreFragmentHit` · `mergeExactAndFragmentHits` 的 fragment 半支。

| 影响 | 说明 |
|------|------|
| batch / utterance cache | cache key 含 `parentFragmentTopK` → 删除该维 |
| TopK | 仅保留 `exactTopK`（现 2） |
| source enum | 无需为 fragment 保留 |
| 索引 | 随表删除 |
| schema version | **建议 bump**（五表→去 ngram） |

目标链：

```text
FineSpan Pinyin+Tone → base/domain(/idiom) exact → term surface + domains[] → Edge
```

---

## 14. Candidate and HitKind Contract

| 问题 | 答案 |
|------|------|
| 仅 diagnostics？ | **否** — 驱动 eligibility 放行、Vote、Assembly |
| 驱动 score？ | YES（fragment 有独立 score/tone） |
| 驱动 Domain Vote？ | **YES** |
| 驱动 Budget？ | 间接（占 Candidate 槽） |
| 驱动 Assembly？ | **YES**（可写回） |
| 删除 enum？ | **内部类型可删** |
| 外部消费者？ | Diagnostics `parentFragmentHitCount`；pick 含 `hitKind`。**JobResult 句子合同不依赖 fragment 语义** → 诊断字段删除属内部；若有外部读 `parentFragmentHitCount` 标 **REQUIRES_SEPARATE_JOBRESULT_CONSUMER_AUDIT**（仅该字段） |

目标：`candidate.word` = 正式 term surface，且 `termId` ∈ base/domain/idiom，**禁止** `ngram:*`。

---

## 15. Configuration Inventory

| 符号 | 默认/生产 | 位置 | 建议 |
|------|-----------|------|------|
| `V4_LIMITS.parentFragmentTopK` | **3** | `v4-limits.ts` / shared limits | **DELETE** |
| `perParentTermPerWindow` | 1 | limits + recall input | **DELETE** |
| `DEFAULT_NGRAM_SQL_LIMIT` | 12 | recall-span-topkv3 | **DELETE** |
| `exactTopK` | 2 | KEEP | KEEP |
| `enableParentFragment` | **不存在**（无总开关；靠 TopK>0） | — | 勿新增 false 开关 |

单字窗：`parentFragmentTopK=0`（已局部禁用）——证明可关；目标是 **删代码** 而非常驻 0。

---

## 16. Database Derived Table Ownership

**判定：A. 整体删除**

| 消费者 | 角色 |
|--------|------|
| 生产 Recall | **唯一生产 Candidate 读者** |
| build/rematerialize | 写入 |
| patch stats / manifest `ngrams` | 计数 |
| cleanup/audit scripts | 维护 |
| 测试 / probe | 依赖 |

**无**「非 Candidate 合法检索」生产消费者。  
禁止「先保留以后可能有用」。

同步：删生成脚本步骤、索引、manifest ngrams 字段（或恒 0 过渡一轮后删）、`schemaVersion` bump + clean rebuild。

---

## 17. Domain Vote Counterfactual（只读）

来源：`domain_vote_trace/*.md` + `_tight_cf.json`

| 指标 | 值 |
|------|-----|
| Cases 含 parent_fragment | **166 / ~200** |
| PF 候选行 | **1143** |
| Cases 含「科医」 | **26** |
| 「科医」且 medical | **78 行** |
| 噪声 PF（科医/议室/低脂/记员/机员/内科医） | 78+5+4+2+4+5 |

去掉 **全部** parent_fragment 后：

- 噪声域票（medical from 科医等）**归零**
- 与 exact 同 surface 的 PF 冗余票消失；**正式 term 的 exact 票仍在**（若 Recall exact 命中）
- retainedDomains 可能收窄（减少假 medical/tech 等）——属预期收益

未重跑生产 Vote 引擎；此为 **trace 级 counterfactual**。

---

## 18. Assembly Counterfactual（只读）

噪声集（排除「线计⊂上线计划」「莓马⊂蓝莓马芬」子串误报）：

| 指标 | 值 |
|------|-----|
| Cases KenLM 文本含噪声 | **27** |
| KenLM 命中事件 | **38** |
| USED_IN_SENTENCE：科医 | **24** |
| 内科医 / 低脂 / 议室 / 机员 / 记员 | 5 / 4 / 4 / 4 / 2 |

去除 fragment 后预期：

- 上述噪声写回 **归零**
- Raw/canonical 保底仍在
- 「候选」「计划」等 **exact term 修复应保留**
- KenLM 输入数下降或更干净（噪声句减少）

---

## 19. Performance Impact

| 项 | WITH | WITHOUT（估） |
|----|------|----------------|
| ngram 行 | 4200 | 0 |
| 每窗额外 SQL | `stmtNgram` + bucketCache | 删除整支 |
| 每窗 PF TopK | +0–3 | 0 |
| Candidate / Vote / Bucket 噪声 | 高（166 cases） | 降 |
| Recall p50/p95 | 未新测墙钟；**静态上少 1 SQL/窗** | 应不差或更好 |

---

## 20. Residual LTR Mechanism Search

| 机制 | 分类 |
|------|------|
| `term_pinyin_ngrams` / `parent_fragment` | **DELETE** |
| LTR FineSpan generator | **DEAD**（已删） |
| `fallbackToLtr` / `shadowLtr` | **DEAD / DOC** |
| `phraseCandidates` as V4 候选 | **无生产**（既有审计） |
| `phoneticGroups` | **无 V4 主链** |
| `confusionMap` | **KEEP**（phonetic-correction 他链，非 fragment 写回） |
| `parent_span_candidate`（diagnostics union） | **DELETE / 清理类型** |
| Compatibility parentTerm Step-4 | **MODIFY→删除依赖**（随 PF 字段消失） |
| Pinyin IME beam | **KEEP**（非 lexicon fragment Candidate） |

---

## 21. DELETE / MODIFY / KEEP Matrix

### DELETE

- `recall-span-topkv3` fragment 半支 / 或整文件收敛为 V2-only 包装
- `lookupParentFragmentsByNgramKey` + `stmtNgram` + ngram cache 计数
- `ngramRowToHotword` / `scoreFragmentHit` / `lookupParentFragments`
- `hitKind: 'parent_fragment'`（内部）
- `parentFragmentTopK` / `perParentTermPerWindow` / ngram SQL limit
- `parentFragmentHitCount` / `parentTermVoteCount` 生产语义（或恒 0 后删）
- `term_pinyin_ngrams` 表 + `materializeTermNgrams` + build INSERT
- `parent-term-slice.ts`（若仅服务 PF）
- 相关单测中「必须产生 PF」断言；改为「PF=0」
- 过时文档：`TONE_FIRST` 中 fragment 混排段落等

### MODIFY

- `recallTopKForWindows`：只调 exact
- `utterance-recall-cache` key：去掉 PF 维
- `build-lexical-edges`：去掉 `hasParent`
- `classify-overlap-relation`：去掉 parentTerm fragment 兼容支
- `utterance-domain-vote`：去掉 parent structural key
- bundle `schemaVersion` + manifest
- dialog_200 回归基线
- patch e2e：不再 assert ngram 物化

### KEEP

- exact term Recall（tone-first）
- FineSpan / Lattice / fallback edge / canonical
- Domain Vote / Bucket / Assembly / CrossPath / KenLM
- JobResult **句子**合同（不改跨服务字段语义）
- confusionMap 他链（不接入 V4 fragment）

### REQUIRES_SEPARATE_CONTRACT_AUDIT

- 若外部消费 `SpanAssemblyV4Diagnostics.parentFragmentHitCount` / pick.`hitKind` 枚举字面量

---

## 22. Development Target List

见 §25 T1–T30（开发验收对齐）。

---

## 23. Regression Test List

开发完成后至少：

1. DB 不再物化无语义 fragment（表删除或 0 行）
2. 生产 Recall **零** `term_pinyin_ngrams` 查询
3. `parent_fragment` Candidate = 0
4. 可以→科医 = 0；衣室→议室 = 0；地址→低脂(fragment) = 0
5. Raw/canonical 仍在；候选→候选、计化→计划（exact）仍在
6. Lattice 全覆盖；Vote/Assembly 无空链
7. dialog_200 候选导出完整
8. Pre-KenLM 性能不退化
9. 无 shadow/fallback fragment 链路（静态 grep + runtime 计数）
10. freeze-contract：全生产树不得再出现 `parent_fragment` 写回路径

---

## 24. Check List

```text
[x] 未修改代码/数据库/rebuild
[x] 已追踪生产 Recall 调用链
[x] 已审计 schema / 生成规则 / mapper
[x] 已还原旧 LTR 设计（部分可恢复）
[x] 已确认无完整父词校验
[x] 已追踪蓝莓马芬/莓马、内科医生/科医
[x] 已确认 Lattice / canonical / 长词策略
[x] 已列出 SQL/类型/配置依赖
[x] 已审计 hitKind / 表消费者
[x] 已做 Vote / Assembly 只读 CF
[x] 已评估性能与残留 LTR
[x] 已输出 DELETE/MODIFY/KEEP
[x] 未建议黑白名单/降权/fallback/双链路
[x] 未修改 JobResult
```

---

## 25. Target List

| ID | 答案 |
|----|------|
| T1 | 父词拼音子串索引，供快速命中长词（LTR 时代设计） |
| T2 | 文档/兼容层暗示需要；**生产完整校验未恢复** |
| T3 | **否** |
| T4 | **是**（`fragment_text` → `word`） |
| T5 | **代码允许**；非必要路径 |
| T6 | ke\|yi ngram → 科医 fragment 直接写回 + 宽匹配放行 |
| T7 | **否**（不依赖） |
| T8 | **是**（fallback + canonical） |
| T9 | **是**（exact 保留） |
| T10 | 正式 term exact/full pinyin |
| T11 | **是**（多 Edge） |
| T12 | **无**其它生产 Candidate 消费者 |
| T13 | **能整体删除** |
| T14 | `stmtNgram` / `lookupParentFragments*` |
| T15 | `ngramRowToHotword` / fragment score/merge / bind 中 PF 支 |
| T16 | **能**（内部）；诊断字段另审 |
| T17 | `parentFragmentTopK`、`perParentTermPerWindow`、ngram SQL limit |
| T18 | utterance cache key；manifest `ngrams` |
| T19 | **建议是** |
| T20 | 至少 26 cases / 78 行 medical「科医」；166 cases 含 PF |
| T21 | 27 cases / 38 噪声 KenLM 事件（紧口径） |
| T22 | **不应丢失正式 term**；仅丢 fragment-only 噪声 |
| T23 | 预期降噪、少 SQL；需开发后测墙钟 |
| T24 | confusionMap 他链 KEEP；V4 无第二套 substring Candidate |
| T25 | **能一次性删除，不保留兼容** |
| T26 | JobResult 句子/替换合同；勿顺手改跨服务字段 |
| T27 | freeze grep + dialog_200 PF=0 + 无 ngram SQL |
| T28 | **是**（删表/去物化需 clean rebuild） |
| T29 | Tone-First fragment 段落、PF 单测、patch ngram assert、分析脚本 |
| T30 | **FULL_RETIREMENT_READY** |

---

## 26. Final Recommendation

```text
FULL_RETIREMENT_READY

parent_fragment / term_pinyin_ngrams
属于已过时的 LTR 模糊父词召回机制。

当前 Lattice 不依赖该机制；
移除后正式 term、canonical coverage、
Domain Vote、Assembly 均可保持有效。

可以彻底删除生产查询、类型、配置、派生表和旧文档，
不保留兼容或 fallback。
```

**建议开发顺序（下轮，非本轮）：**

1. 删生产 Recall fragment 支（先让 PF=0，即使表仍在）  
2. 删 build 物化 + DROP 表 + schema bump + clean rebuild  
3. 清类型/配置/测试/文档  
4. dialog_200 复验：科医/议室/低脂等 = 0；候选/计划 exact 仍在  

**不在本轮：** 词库原子化删「上线计划」等正式短语（见污染审计；可并行但合同独立）。
