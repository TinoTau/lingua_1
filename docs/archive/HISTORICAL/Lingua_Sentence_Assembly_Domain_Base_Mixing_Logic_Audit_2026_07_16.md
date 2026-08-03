<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lingua_Sentence_Assembly_Domain_Base_Mixing_Logic_Audit_2026_07_16.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lingua Sentence Assembly Domain–Base Mixing Logic Audit

**Date:** 2026-07-16  
**Audit Type:** Read-only · Mixing Logic · 禁止改代码 / 禁止改冻结预算 / 禁止改 ABI  
**冻结 SSOT：** [`docs/fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) · [`RANKING_V1_2.md`](../fw-detector/assembly/RANKING_V1_2.md) · [`ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md)  
**代码根：** `electron_node/electron-node/main/src/fw-detector/`  
**Evidence：** `tmp/budget_expansion_20260715/C1`（dialog_200 · per-span **8/6/4** · `maxSentenceCandidates=16`）  
**Offline analyzer：** `electron_node/electron-node/tests/experiments/analyze-domain-base-mixing-audit.py`  
**Artifact：** `tmp/budget_expansion_20260715/domain_base_mixing_audit.json`

---

## Final Verdict

# **C — Current Assembly Does Not Intentionally Generate Source-diverse Candidates**

当前实现允许跨 Span 组合 Domain / Base / Raw（机制上“可混合”），但：

1. **没有** Domain/Base mixing 或 source diversity contract；
2. per-span 选择是 **同桶优先级拼接后统一截断**，无分桶配额；
3. 路径按 **局部分数之和** 排序后截断至 16，系统性偏向高分词堆叠；
4. dialog_200（C1）上 **90.5%** case 的 Top16 **不含** Domain+Base mixed；混合句仅占生成句 **~7.7%**。

下一步（不得直接改冻结架构）：

```text
Sentence Assembly Domain–Base Mixing RFC
```

---

## 0. 证据边界与分类口径

### 0.1 Runtime Trace 缺口（先声明）

| 字段 | 生产是否保留 | 本轮处理 |
|------|:------------:|----------|
| `poolAfterDrop.graphSource` / `domainId` | ❌ 未写入 | 用词表 domain 标签作 **离线代理** |
| `filteredSets` / `selectedCandidates` 分桶 | ❌ 未写入 | 按 `filter`+`select` 代码 **离线复现** |
| `sameDomainCandidateCount` | ✅ | C1：**200/200 = 0** |
| `utteranceDomain` | ✅ | C1：**200/200 = `general`** |
| `sentenceCandidates[].replacements` | ✅ 仅 word 列表 | 用于路径构成；**无** per-replacement graphSource |
| Cap 前全部路径 | ❌ 仅 `intervalAssemblyCandidateCount` 计数偶见 | 用 D1（cap=32）对照多样性，不作生产改动 |

因此：

- **机制结论**（调用链 / 选择策略 / 枚举 / 排序）以代码为准，可信度高。
- **Domain vs Base 句面统计** 以词表 domain 标签代理；在 `utteranceDomain≡general` 时，runtime `sameDomain` 桶恒空，代理 Domain ≈ 本应进入 **fallback** 的领域词。
- 标记：**Historical Intent Not Fully Contracted** — 最终 16 句的 source mix 多样性从未写入冻结合约。

### 0.2 候选类型定义（基于来源代理 + 实际替换）

| 标签 | 含义 |
|------|------|
| D | 该 Span 实际采用了词表带 domain 的替换 |
| B | 该 Span 实际采用了无 domain 标签的替换 |
| R | 该 Span 无 repair 替换 / 保留 Raw gap |

句类型由整句是否同时出现 D/B/R 归类（见 §七）。

---

## 一、冻结背景（本轮未改动）

主链保持：

```text
Fine Span Recall
  → Unified Candidate Pool
  → Utterance Global Domain Vote
  → Winner Domain + Base Filtering
  → post-vote per-span retention = 8/6/4
  → Controlled Sentence Assembly
  → ≤16 Generated Sentences
  → KenLM Ranking
```

本轮未修改 Span / Recall / Vote / `8/6/4` / score / `maxSentenceCandidates=16` / `maxIntervalEnumNodes=1024` / KenLM / Gate / Apply / Lexicon / ABI / Metrics Mapping。

---

## 二、设计意图对照（不预设代码正确）

**用户陈述的目标：**  
在合法 Span 区间内，从 Winner Domain、Base、Raw gap 产生有差异的完整句；应含合理 Domain/Base 混合，而非全 Domain / 全 Base 堆叠后再逼 KenLM 选择。

| 来源 | 是否合同化 |
|------|------------|
| `FROZEN_V1_2.md`：Filter 三桶 + Select `sameDomain > base > fallback` | ✅ 合同化（**pool / select 优先级**） |
| `RANKING_V1_2.md`：同上；禁止 Tone Guard 进 Assembly | ✅ |
| 最终 16 句须含 Domain+Base mix / diversity quota | ❌ **Historical Intent Not Fully Contracted** |
| 禁止全 Domain / 全 Base 偏置 | ❌ 未合同化 |
| 路径排序须考虑 source mix | ❌ 未合同化 |

**历史“Winner Domain + Base”真实含义（代码 + 冻结）：**  
指 **进入 per-span pool 的过滤保留策略**（胜出域 + base；general 时另开 fallback），**不是**要求最终 16 句具备 Domain/Base 混合多样性。

---

## 三、完整组句调用链（Vote 结束后）

唯一主链（Shadow Beam **不**进 KenLM）：

```text
runDomainAwareAssembly(activeCandidates, coarseSpans, rawText)
  ├─ buildFineSpanCandidatePool          → FineSpanCandidatePool[]
  ├─ voteUtteranceDomainFromPool(pool)   → UtteranceDomainVoteResult
  ├─ filterDomainCandidatesPerSpan(...)  → DomainFilteredSpanSet[]
  │     buckets: sameDomain / base / fallback
  ├─ selectPerSpanCandidates(...)        → selectedCandidates[]  per span
  │     budget: getPerSpanCandidateLimit(spanCount) = 8 | 6 | 4
  └─ assembleDomainAwareSpanSets(...)    → SpanReplacementPick[][]  (= domainAwareSpanSets)

orchestrator:
  buildSentenceCandidates(rawText, domainAwareSpanSets, maxSentenceCandidates=16)
    ├─ enumerateIntervalPaths (DFS, maxIntervalEnumNodes=1024)
    ├─ score = Σ candidateScore
    ├─ sort desc by score
    ├─ dedupe by text
    └─ slice(0, 16)

kenlm/run-fw-sentence-rerank-from-prefilled.ts
  → scoreBatch(combinations) → Gate / Apply
```

| 步骤 | 文件 · 函数 | 输入 → 输出 | 是否改集合/排序 |
|------|-------------|-------------|-----------------|
| Vote | `utterance-domain-vote.ts` · `voteUtteranceDomainFromPool` | pool → `{utteranceDomain, insufficientEvidence, domainScores…}` | 定域；不改候选分 |
| Filter | `assemble-domain-aware-span-sets.ts` · `filterDomainCandidatesPerSpan` | pool+vote → 三桶 | **丢弃** non-winner domain（非 general）；covered 跳过 |
| Select | `selectPerSpanCandidates` | 三桶 → `selected` ≤8/6/4 | **改集合**：拼接后统一截断；tie-break `score desc, candidateId asc` |
| Assemble pick map | `assembleDomainAwareSpanSets` / `domainAwarePickToSpanReplacementPick` | DomainAwarePick → `SpanReplacementPick` | **丢失 graphSource**（`source:=recallSource`） |
| Interval enum | `build-sentence-candidates.ts` · `enumerateIntervalPaths` | spanSets → paths | 可产生空子集（=Raw）；节点 cap 1024 |
| Materialize | `applyReplacementsRightToLeft` + gap canonical | path → sentence text | gap 注入 Raw |
| Score/sort | `combinationScore` + sort | paths → scored | **改排序**：Σ 局部分 |
| Dedup | `uniqueByText` | scored → unique | 可能删近义不同 path（同 text） |
| Truncate | `.slice(0, maxSentenceCandidates)` | → ≤16 | **截断** |
| KenLM | `run-fw-sentence-rerank-from-prefilled` | ≤16 句 | 只打分排序；不归因本轮质量构造 |

---

## 四、Post-vote Candidate Pool 构成

### 4.1 分桶规则（代码）

```text
if !isCovered && exact_term pick:
  if !isGeneral && (domain_term|passive_domain_weak) && domainId==winner → sameDomain
  else if base_term → base
  else if isGeneral → fallback
  else → 丢弃（non-winner domain）
```

`isGeneral = insufficientEvidence || utteranceDomain==='general'`。

### 4.2 对必须确认项的回答

| # | 问题 | 结论 | 依据 |
|---|------|------|------|
| 1 | Base 与 Winner Domain 进同一 per-span pool？ | **是（分桶后在同一 span 的 selected 列表中合并）** | `selectPerSpanCandidates` 拼接三桶 |
| 2 | 每 Span 都有 Raw / keep-original？ | **路径层有**（空 repair 子集）；**非**显式 Raw candidate（空 selected 时才注入 canonical） | `allNonOverlapSubsets` 含 `[]`；`select` 空则 `canonical` |
| 3 | Raw 是显式 candidate 还是 gap/skip？ | **skip 子集 + gap canonical 填缝** | `buildPathFromRepairs` |
| 4 | 可能只有 Domain？ | **是**（base 空且 sameDomain/fallback 非空） | filter 逻辑 |
| 5 | 可能只有 Base？ | **是** | C1 离线：605 span only-base |
| 6 | non-winner domain 完全过滤？ | **非 general 时是**；general 时进 fallback | filter L98–104 |
| 7 | 多领域词如何归桶？ | 仅 winner 进 sameDomain；其余非 general 丢弃 | 同上 |
| 8 | general fallback 条件？ | `insufficientEvidence` 或 `utteranceDomain==='general'` | 同上 |
| 9 | `8/6/4` 统一截断还是分桶配额？ | **统一截断，无分桶配额** | `ordered.slice(0, perSpanLimit)` |
| 10 | Base 可被 Domain 挤出？ | **非 general 时是**（sameDomain 在前） | Select 顺序 |
| 11 | Domain 可被 Base 挤出？ | **general 时是**（base 在 fallback 前） | Select 顺序；C1 全部 general |

### 4.3 C1 dialog_200 实测（runtime metrics）

| 指标 | 值 |
|------|---:|
| `utteranceDomain == general` | **200 / 200** |
| `sameDomainCandidateCount == 0` | **200 / 200** |
| `baseCandidateCount > 0` | **200 / 200** |

含义：本批证据上 **Winner Domain 桶从未形成**；所谓“Winner Domain + Base”在运行态退化为 **Base（+ 可能的 fallback）**。

---

## 五、Per-span Selection 策略

`selectPerSpanCandidates()` 真实行为：

```text
ordered = sort(sameDomain) ++ sort(base) ++ sort(fallback)
selected = ordered.slice(0, perSpanLimit)   // 8 / 6 / 4
if empty → [canonical(span)]
```

| 问题 | 答案 |
|------|------|
| 统一按 score 取前 N？ | **桶内**按 score；**桶间**固定优先级后拼接再截断 |
| Domain/Base 分桶配额？ | **否** |
| 保证 ≥1 Winner Domain？ | **否** |
| 保证 ≥1 Base？ | **否** |
| 保证 Raw/unchanged？ | **否**（路径层才有空子集） |
| source / term / span-length / parent-child diversity？ | **均无** |
| tie-break | `score desc` → `candidateId asc` |

### 离线复现表（词表代理 · C1 汇总）

| 指标 | 值 |
|------|---:|
| Span 同时有 Domain+Base（select 前） | 107 |
| Span 同时有 Domain+Base（select 后） | **24** |
| 仅 Base（select 前） | 605 |
| 仅 Domain（select 前） | 7 |
| Select 截断丢掉的 Domain 标记候选 | 108 |
| Select 截断丢掉的 Base 标记候选 | 1268 |

**示例（概念表）：**

| Span | Before (D/B) | Winner Domain | Base | Raw | Selected | Drop Reason |
|------|-------------:|--------------:|-----:|----:|---------:|-------------|
| 多候选 general | D∈fallback, B 多 | 0（sameDomain） | 高 | 路径层 | ≤4/6/8 | **统一 slice：fallback Domain 排在 Base 后被挤出** |
| 仅 Base | 0 / N | 0 | N | 路径层 | ≤limit | 无 Domain 可留 |

---

## 六、Assembly 枚举策略

`buildSentenceCandidates` / `enumerateIntervalPaths`：

1. **允许** 某些 Span 用 Domain、某些用 Base（只要二者都在各 span 的 `repairTarget` 集合中）——笛卡尔式子集扩展，**无禁止混合**。
2. **允许** 跳过 Span（空子集）→ Raw/gap。
3. **不会** 优先“所有 Span 都替换”作为显式策略；但 **Σscore 排序** 使更多高分替换路径排前。
4. **无** “全 Domain / 全 Base” 特殊路径；偏置来自 pool + select + Σscore。
5. 按 **候选局部分数之和** 优先（不是替换数量显式权重，但二者正相关）。
6. **先枚举（受 1024 节点 cap）→ 再排序 → dedup → 截 16**；边枚举边截断仅在 enumNodes>1024 时停止扩展。
7. 达到 16 后：排序靠后的低分 / 少替换 / 混合路径可能未进入最终集。
8. DFS 按 span slot 顺序；**无** source-mix policy。
9. `maxIntervalEnumNodes=1024` 可截断搜索树，影响多样性（预算冻结）。
10. 文本 dedup 可合并不同 replacement 集合若最终字符串相同。
11. **无** explicit diversity / source-mix policy。

---

## 七、候选类型分类（dialog_200 · C1 · 生成句）

| Candidate Type | Count | Rate | Case Coverage |
|----------------|------:|-----:|--------------:|
| Raw-only | 59 | 2.0% | 59 |
| Domain-only | **0** | **0%** | **0** |
| Base-only | 716 | 24.6% | 65 |
| Domain + Base Mixed | 37 | 1.3% | 3 |
| Domain + Raw Mixed | 0 | 0% | 0 |
| Base + Raw Mixed | **1909** | **65.6%** | **153** |
| Domain + Base + Raw Mixed | 187 | 6.4% | 16 |

**混合（Domain+Base 或 Domain+Base+Raw）句占比 ≈ 7.7%；有混合的 case 仅 9.5%。**

---

## 八、每 Case Top16 构成多样性

| 指标 | 值 |
|------|-----|
| 平均 `unique_source_mix_patterns` | **1.71** |
| P50 / P95 patterns | **2 / 3** |
| 只有单一 pattern 的 case | **47.5%** |
| Top16 被单一来源类型占满 | **11.5%** |
| Top16 完全没有 Domain+Base mixed | **90.5%** |
| 近重复候选 >50% 的 case | **16.5%** |
| 平均 generated_count | 14.54 |
| 平均 unique_replacement_sets | 14.49 |

**解读：** 替换集合数量不低，但 **source mix pattern 高度同质**（多为 `B-*-R-*` 变体）；“有很多句”≠“有来源多样性”。

D1（cap=32）对照：平均 pattern 升至 2.75，但 **mixed case rate 未升反降（9.5%→6.5%）** → **扩大 16→32 不能当作混合多样性修复。**

---

## 九、截断前后对照

| 问题 | 结论 |
|------|------|
| Domain+Base mixed 路径是否存在？ | **机制允许**；实证稀少（~7.7% 句） |
| 若存在是否被 16-cap 系统性丢掉？ | **非主因**（D1 未提升 mixed rate） |
| 若不存在主因？ | **(1) sameDomain 恒空 / Domain 稀缺；(2) select 挤出；(3) 无 mix 策略 + Σscore 偏置** |
| 全 Domain / 全 Base 是否排前？ | **Domain-only=0**；高分堆叠多为 **Base（+Raw）** |
| 截断是否降低 source diversity？ | 有限；主损在 select + 排序同质 |
| Dedup 误删混合？ | 可能（同 text）；非主因 |
| 排序偏向更多替换 / 同一来源？ | **是（Σscore）**；score↔repl_count 相关：mean corr≈0.27，**44%** case corr>0.5 |
| 高分词堆叠 → 整句别扭？ | **是**（见 §十一 d001/d005/d010） |

Runtime **不保留** cap 前全路径列表 → 本轮用代码语义 + C1/D1 对照，未新增生产持久化。

---

## 十、自然语言可用性与来源混合关系

不得用 exact expected 作为唯一质量指标。基于 C1 句面与既有 acceptance 观察：

| Candidate Type | Domain Correct | Base Natural | Business Usable | Better than Raw |
|----------------|:--------------:|:------------:|:---------------:|:---------------:|
| Domain-only | n/a（样本=0） | — | — | — |
| Base-only | 低（缺领域词） | 不稳定 | 低–中 | 偶发 |
| Domain + Base | 样本极少 | 视路径 | **假设未获充分支持**（样本不足） | 未证实 |
| Domain + Raw | 样本=0 | — | — | — |
| Domain + Base + Raw | 偶见关键词 | 仍常别扭 | 低（见 d005） | 未系统优于 Raw |
| Base + Raw（主导） | 常丢业务词 | 常别扭（堆叠） | 低 | KenLM 常仍回 Raw |

**用户假设“Domain+Base mixed 更容易自然且关键词正确”：**  
本轮 **不能证实**——混合样本过少，且现有混合句仍出现高分错词堆叠（如 d005「腺瘤」）。不得据此批准新设计；也不得据此把责任推给 KenLM。

---

## 十一、代表性 Case（≥30 覆盖意图；下列为完整路径实例）

### 11.1 完整实例 A — d001（Winner=general · 无 Domain+Base · 高分堆叠别扭）

```text
Case ID: d001
Raw: 你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?
Expected: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Winner Domain: general（sameDomain=0, baseN=8）
Per-span: 多为 Base-only；无 Domain 标记进入 selected
Enumeration: interval DFS；空子集保留部分 Raw（如「中」）
Final Top 形态: Base + Raw Mixed（16/16）
Source Mix Pattern 例: B-R-B-R-B
```

Top 生成（assembly score 序）：

1. `你好,我想點以北熱拿鐵中焙烧烫金 今天游览没马分吗?`（score≈10.78）— 「以北/焙烧/烫金/游览」堆叠  
2. 近重复变体（以备/幽兰…）占满前列  

KenLM Top3（仅观察）：仍偏这些堆叠句；`pickedIsRaw=True`（Gate 未采用）。

**归因：** 候选构造阶段已输出“局部高分但整句别扭”；非 KenLM 发明别扭。

### 11.2 完整实例 B — d005（少见 Domain+Base+Raw · 仍不可用）

```text
Case ID: d005
Winner Domain: general
has_mixed: yes（16/16 标为 Domain+Base+Raw Mixed，pattern 近似 B-B-R-R-D-…）
```

GEN[0]：`...内存占用高这块需要腺瘤保护大家看以下风险`  
— 含「这块/风险」等可用片段，但「腺瘤」等错误高分词同句出现。

KenLM：delta 多为负；`pickedIsRaw=True`。

**含义：** “可混合”≠“混合质量健康”。

### 11.3 完整实例 C — d010（Base-only / Base+Raw · 丢业务关键词）

```text
Case ID: d010
Raw: 醫生您好,我這兩天頭痛想開點,要並做個些常規
Expected: …头痛…开点药…血常规
类型: Base-only 8 + Base+Raw 8
```

高分句把「头痛」修成「通向/同乡」，「开点」→「开店」——通顺度局部上升但业务词错误。KenLM 仍可能选中错误堆叠（本例 `pickedIsRaw=False`）。

### 11.4 覆盖清单（30+ 意图映射）

| 覆盖意图 | 代表 Case（C1） |
|----------|-----------------|
| mixed 成功出现 | d005, d019, d020, d024…（共 19 个 has_mixed） |
| 仅 Domain-only | **无**（0 case） |
| 仅 Base-only 主导 | d010, d011, d023… |
| mixed 被 16-cap 丢掉 | **未证实为主因**（D1 mixed rate↓） |
| mixed 在 select 前不可能 | d001, d003, d006, d008, d009（both_before=0） |
| select 前可混合但被挤出 | d002, d007（both 1–2 → 0） |
| 全 Domain 堆叠别扭 | 本批未观测（Domain-only=0）；逻辑上非 general 时 sameDomain 优先会偏向 |
| 全 Base 通顺丢关键词 | d010, d002 |
| Domain+Base 优于 Raw | **样本不足，未证实** |
| Domain+Raw 更自然 | 样本=0 |
| 多目标词 | d001（中杯/少糖/蓝莓马芬） |
| overlap/parent-child | interval `pickOverlapsAny` 拒绝重叠子集 |
| 应保留部分 Raw | d001「中」保留；空子集机制存在 |

其余 fill 代表：d003–d009 等见 `domain_base_mixing_audit.json` · `representatives`。

---

## 十二、“全 Domain / 全 Base”现象根因

本批实证主现象是 **Base（+Raw）同质化**，不是全 Domain。

| 归因项 | 是否发生 | 说明 |
|--------|:--------:|------|
| Candidate Pool Composition | **是** | 200/200 general；sameDomain=0；大量 span 仅 Base |
| Per-span Unified Ranking | **是** | 无配额；general 下 Base 优先于 fallback Domain |
| Missing Bucket Quota | **是** | 合同未要求；实现也无 |
| Path Enumeration Order | 次要 | DFS 顺序存在，但最终由 Σscore 重排 |
| Path Score Formula | **是** | Σ 局部分 → 堆叠 |
| Replacement-count Bias | **是**（经由 Σscore） | |
| Early 16-cap | 次要 | D1 未修复 mixed |
| Deduplication | 次要 | |
| Overlap / Compatibility | 局部 | 限制可组合子集 |
| Lexicon Candidate Quality | **是** | 高分错词进入 selected |
| Observation Error | 部分 | graphSource 未入 trace；分类用词表代理 |

**Primary Owner（本轮）：**  
`Per-span Unified Ranking` + **缺失的 source-mix / diversity contract**（装配排序层），并与 **Candidate Pool Composition（Winner Domain 未形成）** 强耦合。

不得笼统写 “Assembly Failure”。

---

## 十三、Historical Design 对照

| Historical Principle | Current Code | PASS / GAP / NOT CONTRACTED |
|----------------------|--------------|-----------------------------|
| Global Domain Vote | `voteUtteranceDomainFromPool` | PASS |
| Filter：Winner Domain + Base（+fallback@general） | `filterDomainCandidatesPerSpan` | PASS |
| Select：`sameDomain > base > fallback` | `selectPerSpanCandidates` | PASS |
| Cross-span interval assembly | `buildSentenceCandidates` | PASS |
| maxSentenceCandidates=16 | config + slice | PASS |
| Shadow Beam 不进 KenLM | orchestrator | PASS |
| 最终 16 句须 Domain/Base 混合多样 | **无合同** | **NOT CONTRACTED** |
| 禁止全 Domain / 全 Base 偏置 | **无合同** | **NOT CONTRACTED** |
| 分桶配额保证 D 与 B 共存 | **无** | **NOT CONTRACTED / GAP vs 用户意图** |

**关键回答：**  
历史上 “Winner Domain + Base” **只保证两类候选可进入 pool 并按优先级参与 select**，**并未**要求最终 16 句具有 Domain/Base 混合多样性。

---

## 十四、Shadow / Legacy / Hidden Logic

| 项 | 判定 | 动作建议（本轮不执行） |
|----|------|------------------------|
| Shadow Beam | 仍执行，仅 diagnostics | **KEEP** |
| Legacy Beam 影响主链顺序 | 否 | **KEEP**（隔离） |
| 全 Domain / 全 Base 特殊路径 | 无 | — |
| Raw-only 特殊注入 | 仅空 selected → canonical；路径空子集 | **KEEP** |
| Hidden source quota / diversity | **不存在** | 若 RFC 需要再 **MODIFY**（新合同） |
| Dead diversity logic | 未发现 | — |
| `SpanReplacementPick.source = recallSource` | 丢失 graphSource | **MODIFY**（未来 diagnostics；非本轮） |
| poolAfterDrop 缺 graphSource/domainId | 观测缺口 | **MODIFY**（trace consumer；非 ABI 业务） |
| 测试专属注入 | 未发现进生产主链 | — |

搜索关键词（beam/dfs/path/diversity/mix/quota…）：**无**生产态 diversity/mix/quota 实现。

---

## 十五、Diagnostics / Trace 充分性

| 需要表达的信息 | 现状 | 缺口 Owner |
|----------------|------|------------|
| per-span candidate source | ❌ pool 无 graphSource | Diagnostics |
| selected source | ❌ | Diagnostics |
| replacement set | 部分（word only） | Diagnostics |
| path order / score | score 有；enum index 无 | Diagnostics |
| cap drop / dedup drop | 无明细 | Diagnostics / Analyzer |
| final source mix pattern | 无 | Analyzer / Report |

本轮用 **测试态离线分析脚本** 补齐；**未改生产 ABI**。

---

## 十六、性能与预算

在 `maxSentenceCandidates=16` 下：

| 项 | 观察 |
|----|------|
| emitted / KenLM input | ≤16（C1 众数 16） |
| 平均 generated | 14.54 |
| source diversity | **低**（avg patterns 1.71） |
| 扩大到 32（D1） | gen↑、pattern↑，**mixed rate 不升** |

判断：

```text
候选数没有增加（或增加）但 16 句内部构成质量较低
```

**成立。** 不得建议简单扩到 32/64 作为修复。

---

## 十七、必须回答（18 问）

1. Domain 与 Base 是否进同一 per-span pool？ → **是（分桶后合并进 selected）**  
2. 是否保证每 Span ≥1 Domain 且 ≥1 Base？ → **否**  
3. 是否允许 Raw/unchanged？ → **是（路径空子集 + gap）；非强制**  
4. 组句器是否真实生成 Domain+Base mixed？ → **机制允许；实证稀少（~7.7% 句）**  
5. mixed 在 16 句中比例？ → **≈7.7%；有混合的 case ≈9.5%**  
6. 是否大量 Domain-only / Base-only？ → **Domain-only≈0；Base-only + Base+Raw 主导（~90%）**  
7. 是否存在全 Domain / 全 Base 优先偏置？ → **全 Domain 未观测；Base/高分堆叠偏置是；非 general 时逻辑上 Domain-first**  
8. mixed 是否被 per-span selection 淘汰？ → **是（both 107→24；Domain 被挤出）**  
9. mixed 是否被枚举顺序或 16-cap 截断？ → **16-cap 非主因；Σscore 同质化是**  
10. 16 句是否高度同质化？ → **是（单一 pattern 47.5%；无 mixed 90.5%）**  
11. 局部分是否导致高分词堆叠？ → **是**  
12. Domain+Base 是否更 business-usable？ → **样本不足，假设未获支持**  
13. 主要瓶颈？ → **Candidate construction：Select 无配额 + 无 mix 策略 + Σscore 排序**；并与 **Pool/Vote（Winner Domain 未形成）** 耦合  
14. 是否符合历史 “Winner Domain + Base”？ → **符合其 pool/select 合同；不符合用户期望的最终多样性（该期望未冻结）**  
15. 是否有历史意图未写成 Contract？ → **是（最终 16 句 source mix）**  
16. 是否需在 KenLM 前先修 candidate construction？ → **是（构造质量瓶颈在 KenLM 前）**；但须先走 RFC，不得静默改冻结  
17. RFC 还是恢复冻结设计？ → **正式 RFC**（非简单恢复——冻结从未合同化 mix diversity）  
18. 下一步唯一优先事项？ → **`Sentence Assembly Domain–Base Mixing RFC`**

---

## 十八、Final Verdict（唯一）

## C — Current Assembly Does Not Intentionally Generate Source-diverse Candidates

当前只是按局部 score / interval path 枚举，**没有** Domain/Base mixing 或 diversity contract，导致 16 句同质化（本批以 Base+Raw 堆叠为主）。

下一步：

```text
Sentence Assembly Domain–Base Mixing RFC
```

不得直接修改冻结架构。

---

### 附：与相邻 Verdict 的边界（说明性，非第二结论）

- **不是 A：** 多样性不足。  
- **不是纯 B：** mixed 稀少主因不只是 16-cap。  
- **与 D 强相关：** Winner Domain 桶在本批证据上未形成；RFC 须同时审视 Vote/Pool 观测与 Select 配额，但 **Primary 归类仍为“无 intentional mix 合同/实现”**。  
- **不是 E：** 未证明 mixed 不优于其他；样本不足。  
- **不是 F：** 机制链与 dialog_200 统计已足够给出 C。

---

## 附录 A — 三个完整路径生成实例（摘要）

详见 §十一；原始 dump：`tmp/budget_expansion_20260715/mixing_case_dump.txt`。

## 附录 B — 分析产物

- `tmp/budget_expansion_20260715/domain_base_mixing_audit.json`  
- `electron_node/electron-node/tests/experiments/analyze-domain-base-mixing-audit.py`
