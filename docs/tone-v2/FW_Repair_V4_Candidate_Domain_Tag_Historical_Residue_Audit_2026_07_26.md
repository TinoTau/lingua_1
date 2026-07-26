# FW Repair V4 — Candidate Domain Tag Historical Residue Audit（SSOT）

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Type | **Read-only**（禁止改代码） |
| Scope | Recall → Domain Vote 完整链路 · `lookupTermDomainTags*` |
| Authority | 代码 + 已冻结 SSOT 文档 + Git 对比 HEAD |

---

## Executive Summary

| 结论项 | 判定 |
|--------|------|
| Vote 阶段是否再查 `term_domain_tags`？ | **否** |
| `exact_term` 是否需要 `lookupTermDomainTags*`？ | **否**（Recall JOIN 已写入 `Hotword.domains[]`） |
| `parent_fragment` 为何再查？ | ngram 行仅有单列 `domain_id`，不足以满足 Presence Vote 的完整 `domains[]` |
| `lookupTermDomainTags` / `…Multi` | **代码中不存在** |
| `lookupTermDomainTagsInScope` | **唯一存在**；唯一调用点在 `recall-span-topkv3` parent 路径（仍属 Recall，非 Vote） |

### 最终裁决（四选一）

# **B. lookupTermDomainTags* 属于历史实现 → 应并入 Recall**

含义（严格）：

- **不是** Vote 侧历史残留调用。
- **是** Presence Vote / 多域合同修复期，对 parent ngram「单 `domain_id`」缺口的 **Recall 内二次补全**。
- 目标形态仍是合同已写明的：`term_domain_tags → Hotword.domains[] → WindowCandidate.domains[]`；二次 API 应在正式开发时 **折叠进 Recall 事实装配**（而不是在 Vote 前再查一轮）。
- **当前不可无替代删除**（否则 parent 多域 Presence 回退到单 `domainId`）。

---

## Q1 — Recall 完成后 Candidate 已有什么？为何还查 tags？

### exact_term（主路径）

Recall 完成后 Hotword / 随后 WindowCandidate **已经拥有**：

| 字段 | 来源 |
|------|------|
| `hotword.id`（term id） | base / domain SQL 行 |
| `hotword.word` | 同上 |
| `candidateScore` / breakdown | V2 scoring |
| `hotword.domains[]` | **已在 domain multi SQL 中 JOIN `term_domain_tags` 后经 `mergeDomainTierRows` 聚合** |
| Base 无细域 | `domains` 为空 / 缺省 |

代码依据：

- `queryDomainMultiRowsAtomic`：`INNER JOIN term_domain_tags tdt ON tdt.term_id = t.id AND tdt.domain_id = d.domain_id`（`lexicon-runtime-v2.ts`）
- `mergeDomainTierRows`：多行 tag → `existing.domains` union + sort
- `recall-topk-for-windows`：`domains: Object.freeze([...hit.hotword.domains])`

**因此 exact_term 不需要、也未调用 `lookupTermDomainTags*`。**

### parent_fragment（唯一再查路径）

Recall 的 ngram 查询返回的是 `ParentTermNgramRow`，含：

- `parentTermId`
- `fragmentText`
- 单值 `domainId?`（表列 `domain_id`）
- 评分所需 pinyin / prior / …

`ngramRowToHotword` 默认只做：

```ts
domains = row.domainId ? [row.domainId] : []
```

这 **不足以** 表达 parent term 在 active recall scope 内的完整 `term_domain_tags`。

因此在 `lookupParentFragments` 循环内额外调用：

```ts
lookupTermDomainTagsInScope(row.parentTermId, domainIds)
→ 覆盖 hotword.domains = scope 内全部 tags
```

**原因不是「有了 term_id 却不知道自己是谁」**，而是：

```text
ngram 事实行只物化了单个 domain_id
Presence Vote 合同要求 Hotword/WindowCandidate.domains[] = scope 内完整 tags
```

文档依据：`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md` §11  
「非法状态：fragment 只带单 domain_id」→「合法状态 A：`lookupTermDomainTagsInScope(parentTermId, domainIds)`」。

---

## Q2 — 理论设计：Candidate 应直接带 domains[] 还是事后 lookup？

### 冻结合同（目标形态）

`Runtime_SSOT_Contract_Freeze.md` / `DOMAIN_RECALL.md` / `DOMAIN_SOURCE_UNIFICATION.md`：

```text
term_domain_tags
  → Hotword.domains[]
  → WindowCandidate.domains[]
  → FineSpanDomainSet
  → Domain Vote
```

即理论设计是：

```ts
Candidate { termId?, text, score, domains[] }  // domains 在 Recall 结束时已完整
```

**不是** Vote 阶段再 `lookupTermDomainTags()`。

### 当前代码为何出现「后一种」外表？

| 路径 | 实际 |
|------|------|
| exact_term | 第一种：Recall JOIN 已带 `domains[]` |
| parent_fragment | 外表像第二种：先有 ngram 行（含 `parentTermId` + 单 `domainId`），再二次 SQL 补全 `domains[]` |

采用二次查询的代码原因（非猜测）：

1. **Schema**：`term_pinyin_ngrams` 物化列是单 `domain_id`（`stmtNgram` SELECT 列表可见），不是完整 tags 数组。
2. **历史映射**：Git `72e28b9`（lexicon_V4 finish）中 `scoreFragmentHit` **无** `lookupTermDomainTagsInScope`，仅 `domains: [row.domainId]`。
3. **Presence Vote 修复**：工作区相对 HEAD 的 diff 新增 `lookupTermDomainTagsInScope` + `scopeDomains` 注入；验收报告将其标为 parent 语义修复。
4. **Vote 结构键**：`buildFineSpanDomainSet` 对 `parent_fragment` 使用 `parent:${parentTermId}`，**只采纳首次 domains**；若首次只有单域，同 parent 其它域会丢失（acceptance T7 注释写明）。

---

## Q3 — 调用链追踪

### 符号存在性

| 符号 | 是否存在 |
|------|----------|
| `lookupTermDomainTags` | **不存在** |
| `lookupTermDomainTagsInScope` | **存在**（`LexiconRuntimeV2`） |
| `lookupTermDomainTagsInScopeMulti` | **不存在**（仅 Phase 2 审计建议名） |

### `lookupTermDomainTagsInScope`

| 项 | 内容 |
|----|------|
| **定义** | `lexicon-runtime-v2.ts` · `LexiconRuntimeV2.lookupTermDomainTagsInScope` |
| **谁调用** | **仅** `recall-span-topkv3.ts` → `lookupParentFragments` |
| **为什么调用** | 将 parent term 的 **in-scope** `term_domain_tags` 写入 fragment Hotword.domains[]，满足 Presence Vote |
| **输入** | `termId = row.parentTermId`；`domainIds = recallDomainScope` |
| **SQL** | `SELECT domain_id FROM term_domain_tags WHERE term_id = ? AND domain_id IN (...) ORDER BY domain_id` |
| **输出** | `string[]`（scope 内 domain_id） |
| **最终给谁** | `scoreFragmentHit(..., scopeDomains)` → `hotword.domains` → V3 hit → `bindLexiconHitsToWindow` / `recallTopKForWindows` → `WindowCandidate.domains` → `buildFineSpanDomainSet` / `voteUtteranceDomainFromPool` |

### 完整链路（生产）

```text
runSpanAssemblyV4Orchestrator
  → runLtrFineSpanGeneration
    → recallTopKForWindows
      → recallSpanTopKV3
        → recallSpanTopKV2          // exact：domains 已在 Hotword
        → lookupParentFragments
            → lookupParentFragmentsByNgramKey   // ngram，单 domain_id
            → lookupTermDomainTagsInScope       // 仅 parent 补全
            → scoreFragmentHit                  // 写入 hotword.domains
      → WindowCandidate.domains[]
  → runDomainAwareAssembly
    → voteUtteranceDomainFromPool
      → buildFineSpanDomainSet(candidate.domains)   // 不再查 SQL
```

**Domain Vote 不调用任何 `lookupTermDomainTags*`。**

静态门禁：`freeze-contract.test.ts` `GATE-FREEZE-PRESENCE` / `GATE-DOC-DOMAIN-ATOMIC` 要求源码含 `lookupTermDomainTagsInScope`（把该补全视为 Presence 合同的一部分）。

---

## Q4 — 查询形态：是否只有 term_id 谓词？

### `lookupTermDomainTagsInScope`（唯一 tags 二次查询）

```sql
WHERE term_id = ?
  AND domain_id IN (scope…)
ORDER BY domain_id
```

- **无**拼音匹配  
- **无** tone 匹配  
- **无**模糊 Recall  
- **无**二次 Candidate Search  

纯 **term_id + scope 过滤** 的事实读取。

### 同文件相关但非 `lookupTermDomainTags*` 的查询（对照）

| 查询 | 谓词 | 是否二次 Candidate Search |
|------|------|---------------------------|
| base / domain / idiom exact | `pinyin_key`（+ tone） | 否（主 Recall） |
| `queryDomainMultiRowsAtomic` | pinyin + domain scope；**JOIN tags** | 否（主 Recall） |
| parent ngram | `ngram_pinyin_key` | 否（主 Recall） |
| fuzzy variants（V2） | 变体 pinyin | 主 Recall 内，不经 tags lookup |

---

## Q5 — Recall SQL 是否已 JOIN term_domain_tags？为何拆两步？

### 已 JOIN（exact domain 路径）

`queryDomainMultiRowsAtomic` **两段 SQL 均 JOIN** `term_domain_tags`：

1. 按 term 选 TopK（`GROUP BY d.id`，用 `MAX(tdt.weight)`）  
2. 再拉这些 term 的 **全部 in-scope tags**（防 LIMIT 切出 partial-domain term）

代码注释明确：「Never returns a term with only a partial subset of its in-scope tags。」  
验收文档称旧实现对 JOIN 行直接 LIMIT 会导致 partial-domain — 故拆成 **term 选择 → tags 装填** 两段（仍在同一次 domain multi helper 内，不是 Vote）。

### 未 JOIN（parent ngram 路径）

`stmtNgram`：

```sql
SELECT … parent_term_id … domain_id …
FROM term_pinyin_ngrams
WHERE ngram_pinyin_key = ? AND enabled = 1
…
```

**不 JOIN** `term_domain_tags`。

### 为何 parent 当初拆成「ngram + 事后 tags」？

有代码 / Git / 文档依据的原因：

| 原因 | 依据 |
|------|------|
| ngram 表物化单 `domain_id` | `stmtNgram` / `ParentTermNgramRow.domainId` |
| 早期 parent 映射只用单域 | Git `72e28b9`：`domains = row.domainId ? [row.domainId] : []`，无 tags lookup |
| 后加 Presence Vote 要求完整 `domains[]` | `Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md` §11；工作区 diff 新增 `lookupTermDomainTagsInScope` |
| exact 路径已用 atomic JOIN；parent 未同步改造 | exact 走 `queryDomainMultiRowsAtomic`；parent 仍走独立 ngram prepared statement |

**不是**「Domain Vote 模块自己去查库」；是 **Recall 内 parent 事实装配滞后于多域合同**。

---

## 历史演化审计（Git + 文档，不猜测）

```text
早期 Parent Recall（≤ lexicon_V4 / HEAD 提交树）
  ngram → Hotword.domains = [domainId] 或 []

exact Domain Recall
  JOIN term_domain_tags → 完整 Hotword.domains[]（后经 atomic 修复防 partial）

Presence Vote / Multi-domain SSOT（文档 2026-07 · 工作区相对 HEAD）
  发现 parent 单域破坏 FineSpanDomainSet / parent 结构键语义
  → 新增 lookupTermDomainTagsInScope(parentTermId, scope)
  → freeze GATE 锁定该符号存在
```

| 判断 | 结果 |
|------|------|
| 「先有 Recall，后加 Vote，于是 Vote 里加 lookup」 | **否** — Vote 不查 SQL |
| 「为 Vote 合同在 Recall parent 路径补全 domains」 | **是** — 文档 + diff 一致 |
| 是否「无调用的死代码残留」 | **否** — 唯一调用点活跃 |
| 是否「相对理想 SSOT 的历史实现形态」 | **是** — 二次查询本可并入 parent 事实 SQL/装配 |

`git blame` 对该函数显示 `Not Committed Yet`：相对当前 `HEAD`，该符号主要存在于工作区变更，与验收报告中的 parent 修复叙述一致。

---

## SSOT 审计

### 数据 SSOT

```text
term (id)
  → term_domain_tags (term_id, domain_id, weight)   ← 领域标签唯一事实源
  →（domain_lexicon / base_lexicon 等为检索投影）
```

合同：`Runtime_SSOT_Contract_Freeze.md` §5–7。

### Candidate 已有 term_id 时，能否 Recall 直接返回 domains[] 并删除 lookup？

| 路径 | 可行性 |
|------|--------|
| exact_term | **已是**；无 lookup 可删 |
| parent_fragment | **可行**：在 `lookupParentFragmentsByNgramKey` 或 `scoreFragmentHit` 事实装配时 JOIN/批量读 tags，使输出 Hotword 已含完整 `domains[]`，从而 **删除独立 `lookupTermDomainTagsInScope` 调用** |
| 无替代直接删除 | **不可行**：回退单 `domainId`，破坏 Presence Vote T7 / SSOT |

「可行」条件：保持 **scope 过滤**（不加载 scope 外 tags）、**一词多领域多行**、parent 结构键语义不变。

---

## KEEP / DELETE / MODIFY

### KEEP

| 项 | 理由 |
|----|------|
| `term_domain_tags` 作为领域事实 SSOT | 合同 |
| exact 路径 `queryDomainMultiRowsAtomic` JOIN tags | 已正确物化 `Hotword.domains[]` |
| Vote 只读 `WindowCandidate.domains[]` | 无 SQL |
| parent 必须携带 **完整 in-scope domains[]** 的语义 | Presence Vote |

### DELETE（指实现形态，非「立刻无替代删」）

| 项 | 性质 |
|----|------|
| 独立的 `lookupTermDomainTagsInScope` **作为第二跳公共 API / 循环内动态 prepare** | 历史补丁形态；应在并入 Recall 后删除调用 |
| 任何「Vote 前再查 tags」的设想 | 本就不存在；禁止新增 |
| 不存在的 `lookupTermDomainTags` / `…Multi` 命名扩张为新层 | 禁止 |

### MODIFY（影响面最小）

| 改动点 | 范围 |
|--------|------|
| `lexicon-runtime-v2` parent 事实装配（ngram 后批量 tags 或 JOIN） | Runtime 内私有 |
| `recall-span-topkv3` `lookupParentFragments` 去掉逐条 `lookupTermDomainTagsInScope` | 单文件 |
| **不改** LTR / Vote / Sentence / KenLM / Job DTO | — |

影响面最小的目标态：

```text
Recall(parent)
  → Hotword { id/parentTermId, word, score inputs, domains[]完整 }
  → WindowCandidate.domains[]
  → Vote（只读）
```

---

## 禁止事项核对

本审计 **未** 引入 Batch / Queue / Cache / Redis / Worker / Feature Flag / Shadow / 新 DTO / 新 Runtime Layer / 新 SQL Framework；**未修改任何代码**。

---

## 最终结论

# **B**

```text
lookupTermDomainTagsInScope
属于历史实现（Presence Vote / 多域合同下，对 parent ngram 单 domain_id 的 Recall 内补丁）

应并入 Recall 事实装配
（使 parent 与 exact 一样在 Recall 结束时已具备完整 domains[]）

从而删除独立二次查询形态

当前：不可无替代删除
Vote：从不调用该 API
exact_term：从不需要该 API
```

不选 A：单独保留二次 API **不是**长期目标 SSOT 形态。  
不选 C：「删除部分调用」易被理解成现在可删；唯一调用点删了会破坏合同。  
不选 D：调用链、SQL 形态、Git/文档演化已足以证明。

---

*证据锚点：`lexicon-runtime-v2.ts`（atomic JOIN / `lookupTermDomainTagsInScope` / `stmtNgram`）、`recall-span-topkv3.ts`（唯一调用）、`utterance-domain-vote.ts`（只读 domains）、`Runtime_SSOT_Contract_Freeze.md`、`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md` §11、Git `72e28b9` vs 工作区 diff、`freeze-contract.test.ts` GATE。*
