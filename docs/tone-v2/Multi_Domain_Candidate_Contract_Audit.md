# Multi-Domain Candidate Contract Audit

```text
STATUS: HISTORICAL AUDIT

Historical evidence only. Architecture authority is Runtime_SSOT_Contract_Freeze.md.
Do not treat findings here as a license to implement /domains.length Vote or Assembly domains[].
```

| 字段 | 值 |
|------|-----|
| Document Status | **HISTORICAL AUDIT** |
| 任务 | Multi-Domain Candidate Contract Audit |
| 性质 | **只读代码审计**（未改代码 / 配置 / SQLite / Bundle / DTO / 测试） |
| 基线 Bundle | `node_runtime/lexicon/v3` · bundleVersion **10** · PatchId `lexicon-domain-hierarchy-completion-v1` |
| Lexicon 合同 | `term` → `term_domain_tags` → `domain_lexicon` |
| 已知债务入口 | `Candidate domains[0] compression remains` |
| 审计日期 | 2026-07-19 |
| 状态 | **AUDIT COMPLETE — STOP** |

---

## 1. Executive Summary

主链在 **Recall Hotword** 层仍可保留 `HotwordEntry.domains: string[]`（SQL 多行 JOIN 后按 `word|pinyin_key` merge 为单条），但在进入 V4 **WindowCandidate** 时立即压缩为单值 `domainId = hotword.domain ?? hotword.domains?.[0]`。此后 **Domain Vote / sameDomain bucket / Domain-Aware Assembly / SpanReplacementPick / KenLM 上游句候选** 全部只认该单值，**不再读取 `domains[]`**。

因此：

* **不是**「多领域词被展开成 N 个 Candidate」的膨胀问题（exact_term 路径膨胀倍数 ≈ **1×**）。
* **是**「多领域集合在 Candidate 边界被压成首项」的 **信息丢失 + 错域过滤** 问题。
* Vote **不会**因 `domains.length` 多计票；相反，非首项 domain **完全得不到 evidence**。
* 当 winner fine domain ≠ 压缩后的 `domainId` 时，即使 DB 标签含 winner，候选也会被 sameDomain 排除。

**结论标签（可多选，见 §22）：`B` + `C`（主链）+ `D`（Shadow 并行）。必须分阶段修复，不可一次性无风险修完。**

---

## 2. 当前完整调用链

```text
term_domain_tags (SQLite, 1 term × N fine domains)
        ↓
domain_lexicon JOIN term_domain_tags
  lookupDomainsByPinyinKeyMulti / ToneMulti
  → SQL: 多行（每 domain_id 一行），ORDER BY weight DESC, prior DESC
  → mergeDomainTierRows: 合并为 1× HotwordEntry
        domains[] = union(domain_id)
        domain   = 首行 domain_id（高 weight 优先；并列时无 domain_id 稳定排序）
        ↓
tone-first-tier-collector / recallSpanTopKV2|V3
  HotwordEntry 携带 domain + domains[]
  classifyRecallCandidateKind 用 domains[0]（仅 kind，非 DTO 丢弃）
        ↓
recallTopKForWindows  ★ 主压缩点
  domainId = hotword.domain ?? hotword.domains?.[0]
  WindowCandidate { domainId?: string }  ← 无 domains[]
        ↓
compatibility / activeCandidates
        ↓
runDomainAwareAssembly
  buildFineSpanCandidatePool
  voteUtteranceDomainFromPool  ← 只读 candidate.domainId
  filterDomainCandidatesPerSpan
    sameDomain: domainId === winningDomain
    base: graphSource === base_term
  selectPerSpanCandidates (8/6/4)
  assembleDomainAwareSpanSets → SpanReplacementPick[][] (仍可带 domainId)
        ↓
buildSentenceCandidates → ≤16 句文本
        ↓
KenLM scoreBatch（纯文本；无 domain metadata）
        ↓
rerank / apply gate / diagnostics
```

**并行 Shadow（不进 KenLM 主链）：**

```text
emitParentEvidenceAndExactEdges (单值 domainId)
→ voteUtteranceDomain (shadow)
→ assembleParentTermSpanCandidatesV4 / applyDomainVoteToEdges
→ buildCandidateGraph → assembleCoarsePaths → runCoarseSentenceBeamV4
```

---

## 3. 所有 domain 相关 DTO

| 层 | 类型 | 文件 | domain 字段 | 数组？ | 正式/遗留 |
|----|------|------|-------------|--------|-----------|
| DB | `term_domain_tags` | SQLite | `domain_id` + `weight` | 多行 | **正式 SSOT** |
| DB | `domain_lexicon` | SQLite | `domain_id` PK 部分 | 多行/term | 正式物化 |
| Recall row | `TierRow` → `HotwordEntry` | `lexicon-runtime-v2.ts` / `hotword-types.ts` | `domain?` + `domains?` + `domainWeights?` | 是 | **domains[] 正式；domain 遗留单值镜像** |
| Recall hit | `RecallSpanTopKV2/V3Hit` | `recall-span-topk-*.ts` | via `hotword.*` | 是（在 hotword 内） | 正式 |
| Parent ngram | `ParentTermNgramRow` | `lexicon-types-v2.ts` | `domainId?` | **否** | 单值 |
| V4 Candidate | `WindowCandidate` | `v4-types.ts` | `domainId?` | **否** | **主链正式（已压缩）** |
| Vote pool | `PoolVoteCandidate` | `utterance-domain-vote.ts` | `domainId?` | 否 | 正式 |
| Assembly pick | `DomainAwareSpanReplacementPick` | `domain-assembly-types.ts` | `domainId?` | 否 | 正式 |
| Sentence pick | `SpanReplacementPick` | `build-sentence-candidates.ts` | `domainId?` | 否 | 诊断用单值 |
| Profile / LLM | `ActiveLexiconProfileSnapshot` | `session-runtime/types.ts` | `primaryDomain` + `secondaryDomains` | primary 单值 | 会话粗域 |
| Industry route | `IndustryRouteHit` | runtime | `domainId` | 否 | 路由 |

**并存读法：**

* Scoring / `hotwordDomains()`：**优先 `domains[]`，否则 `[domain]`**。
* V4 Candidate 生成：**优先 `domain`，否则 `domains[0]`** → 写入 `domainId`。
* Vote / sameDomain / Assembly：**只读 `domainId`**，**从不读 `domains[]`**。

---

## 4. `domains[0]` 精确位置

| # | 文件 | 函数/行（约） | 行为 |
|---|------|---------------|------|
| 1 | `fw-detector/span-assembly-v4/recall-topk-for-windows.ts` | ~234 | **`domainId = hit.hotword.domain ?? hit.hotword.domains?.[0]`** → WindowCandidate。**主债务点** |
| 2 | `lexicon-v2/recall-span-topk-v2.ts` | ~94 | `classifyRecallCandidateKind`: `domains[0] ?? 'general'`（影响 kind 标签，不删数组） |
| 3 | `lexicon/lexicon-runtime.ts` | ~93 | 遗留 V1：`domain: domains[0]` |
| 4 | `lexicon-v2/lexicon-runtime-v2.ts` | `mergeDomainTierRows` ~87–88 | 首行写入 `mapped.domain = domainId` 且 `domains=[domainId]`；后续只 union `domains`，**不更新 `domain`** → 与 `domains[0]` 语义等价 |

仓库内 **无** `domainIds[0]` / `fineDomains[0]` / `domainTags[0]` 主链用法；等价压缩见下节。

---

## 5. 其他等价压缩位置

| 模式 | 位置 | 效果 |
|------|------|------|
| `domain: row.domainId` | `recall-span-topkv3.ts` `ngramRowToHotword` | parent_fragment 仅单 domain |
| `candidate.domainId === winningDomain` | `assemble-domain-aware-span-sets.ts` `isSameDomainCandidate` | 非 includes |
| Vote `addDomainScore(..., candidate.domainId, ...)` | `utterance-domain-vote.ts` | 只给单域加分 |
| `edge.domainId === vote.utteranceDomain` | `applyDomainVoteToEdges` | Shadow 边惩罚 |
| Graph merge 保留较高分边的 `domainId` | `coarse-candidate-graph.ts` | 单值胜出 |
| Profile `primaryDomain` | session / weak plan | 粗域会话，非 Candidate 数组 |
| Industry test `domainIds[0]` | `industry-routing-domain-resolver.test.ts` | 测试断言，非生产 Candidate |

**未发现：** 按 domain 复制 N 个 WindowCandidate；`Map<text,candidate>` 覆盖导致丢 domain（V4 以 `candidateId`/`window` 为主）；SQL `GROUP BY term` / `MIN(domain)` 丢域。

---

## 6. SQL 层是否丢失多领域

**结论：不丢失（在 recall scope 内）。**

`lookupDomainsByPinyinKeyMulti` SQL：

```sql
SELECT d.*, tdt.weight AS tag_weight
FROM domain_lexicon d
INNER JOIN term t ON t.id = d.id
INNER JOIN term_domain_tags tdt
  ON tdt.term_id = t.id AND tdt.domain_id = d.domain_id
WHERE d.domain_id IN (...) AND d.pinyin_key = ? AND ...
ORDER BY tdt.weight DESC, d.prior_score DESC
LIMIT ?
```

* 同一 term 多 domain → **多行**。
* **无** `GROUP BY term_id` / `MIN(domain_id)` / `MAX(domain_id)` 聚合丢域。
* `LIMIT` 按 `max(limit, limit * |domains|)` 放宽后再 `mergeDomainTierRows`，再 `slice(0, limit)` —— 限制的是 **合并后 Hotword 条数**，不是域标签数。
* **Scope 外**的 tag 不会出现在结果中（例如只开 `restaurant` fine 集时，`预订` 的 `tourism_hotel` 行不会被 JOIN 进来）→ 这是 **召回范围裁剪**，不是 SQL 聚合 bug。

实测（正式库，`预订`）：4 行 `food_order / tourism_hotel / tourism_route / transport`，weight 均为 1.0。

---

## 7. Recall 层是否丢失

**结论：数组保留；单值镜像 + kind 分类使用首项。**

| 字段 | 状态 |
|------|------|
| `HotwordEntry.domains[]` | merge 后保留 union；**正式多域载体** |
| `HotwordEntry.domain` | = 首行 domain；**遗留** |
| `domainWeights` | 按 domain 保留 |
| `classifyRecallCandidateKind` | 读 `domains[0]` |
| `computeDomainBoost`（可用全数组 max） | **当前 `domainBoost` 在 score 中硬编码为 0**，未接入主分 |

**不存在**「每个 domain 复制一条 Hotword」；merge 后 **1 term × 1 HotwordEntry**。

---

## 8. Candidate 层是否丢失

**结论：是。主链在此丢失多域集合。**

```ts
// recall-topk-for-windows.ts
const domainId = hit.hotword.domain ?? hit.hotword.domains?.[0];
candidates.push({ ..., domainId, ... }); // WindowCandidate 无 domains[]
```

* **不**保留全部 `domains[]`。
* **不**为每个 domain 复制 Candidate。
* **不**按 text Map 覆盖丢域（本步是 list push）。
* 压缩后唯一身份：`domainId`。

---

## 9. merge / dedupe 是否丢失

| 阶段 | 规则 | 多域影响 |
|------|------|----------|
| `mergeDomainTierRows` | key=`word\|pinyin_key`；union domains；**保留先到 `domain`** | 数组完整；单值=首行 |
| `mergeSpanCandidatesCombined` | domain > alias > base；`dedupeByWordAndPinyin` 保先到 | 同词不同 domain 已在上游 merge，通常 1 条 |
| V4 `dedupePicks` | key=`candidateId` 或 span+word | 不合并 domains |
| Base + Domain 同窗 | 可并存不同 `source`；Vote 对 base 跳过（无有效 domainId / general） | 正常 |

**provenance：** WindowCandidate 保留 `recallSource` / `source`；**domains 并集的 provenance 在 Candidate 层不可见**。

**termId：** Hotword `id` 为 term id；merge 后一致。text 相同但不同 termId 会成不同 Hotword（不同 id），可并存。

**domains 排序：** Set 插入序 = SQL 行序；**无稳定 `localeCompare` 排序**。weight 全 1.0 时首项 **不稳定**（无 `domain_id` 二级排序）。

---

## 10. Vote 是否完整使用所有 domain

**结论：否。只用压缩后的 `candidate.domainId`。**

| 维度 | 实现 |
|------|------|
| 投票单位 | 每个 **未 covered** 的 exact_term Candidate 一次；parent_fragment **每次都加分**，但 `parentTermVoteCount` 按 `parentTermId` 去重计数 |
| 证据域 | **仅 `domainId` 一票目标** |
| 加权 | `score × SOURCE_WEIGHT × coverageWeight` |
| 多域 term | **只给首项 domain evidence**；**不**按数组长度加权；**不**展开复制计票 |
| 输出 | `utteranceDomain` 单 fine（或 evidence 不足 → `general`） |

**风险形态：** 少计（漏投非首域），而非多计。

---

## 11. Coarse validation 顺序

**当前实现顺序（报告事实，非建议）：**

```text
1) Session / CPU LLM → primaryDomain（多为 coarse：restaurant / travel / …）
2) expandPolicyToFineDomains / resolveRecallScope → recallDomainScope: fine[]
3) Domain / Weak SQL recall（仅 scope 内 fine）
4) fine Domain Vote（candidate.domainId）
5) sameDomain filter（domainId === winner）
6) Sentence Assembly → KenLM
```

等价于：**粗域先裁剪召回范围，再 fine Vote，再过滤** —— 不是「Vote 后再做 coarse validation 裁剪 domains[]」（Candidate 已无数组可裁）。

跨 coarse 多标签例（`预订` → food_order + tourism_hotel + …）：

* 若 profile/scope 仅为 `restaurant` 子域：SQL 可能只带回 `food_order` → `domains=['food_order']` → 压缩后只能投/进 restaurant 侧。
* 若 scope 含两侧 fine：merge 得多域数组，但 Candidate 仍只留 **首项**；Vote/sameDomain **看不到**另一侧。

**LLM coarse 不直接作为 Vote 输入数组**；Weak plan 用 `primaryDomain` 区分 strong/weak **query** 列表。

---

## 12. sameDomain 当前行为

输入：**Vote 选出的 `winningDomain`（单 fine）** + 每个 Candidate 的 **`domainId`（单值）**。

```ts
isSameDomainCandidate:
  (domain_term | passive_domain_weak) && candidate.domainId === winningDomain
```

| 问题 | 行为 |
|------|------|
| Candidate 属两域 | **不可能**在同对象上表示；只认压缩域 |
| 进两个 bucket？ | **否** |
| 只进首个？ | 若 `domainId===winner` 进 sameDomain；否则可能进 base / fallback / **丢弃** |
| Vote 后唯一 bucket？ | 是（per-span 三类列表） |
| 复制对象？ | pick 转换时浅拷贝字段；非按域复制 |
| 数量膨胀？ | **否**；风险是 **误排除** |

---

## 13. Assembly 当前行为

* **假定：** 一候选一 `domainId`（单领域假设）。
* Bucket key：per coarseSpan + sameDomain/base/fallback 列表；非 `domains.includes`。
* `selectPerSpanCandidates`：sameDomain → base → fallback，截断 **8 / 6 / 4**。
* `buildSentenceCandidates`：文本笛卡尔积，cap **`maxSentenceCandidates=16`**；pick 可带诊断 `domainId`。
* **不会**因多标签生成重复句（无 N 展开）。
* **会**因 `domainId !== winner` 排除本应 `domains.includes(winner)` 的候选。
* selected domain 决定后：**不再携带**原始 `domains[]`（早已丢失）。

---

## 14. KenLM 输入

KenLM 接收 **纯文本句子组合**（及分数/替换诊断），**不含** domain metadata。

→ domain filtering **必须在 KenLM 前完成**（当前由 Vote + sameDomain 完成）。  
→ **不得**把 multi-domain 修复扩大为 KenLM 修改。

---

## 15. Final Decision 与日志

可观测字段现状：

| 概念 | 现状字段 | 能否区分 |
|------|----------|----------|
| candidateDomains | **无**（仅 `domainId`） | ❌ |
| votedFineDomain | `utteranceDomain` / `winningFineDomain` | ✅ 单值 |
| validatedCoarseDomain | profile `primaryDomain`（会话侧） | 部分（非 Candidate 级） |
| selectedSentenceDomain | 同 vote / span `domain` | 易与 candidate 混淆 |

诊断难以追溯「该词曾有哪些 tag / 哪一项被丢掉」。存在误导：日志里的 `domain`/`domainId` 看似「该词领域」，实为 **压缩首项**。

---

## 16. Candidate 数量膨胀风险

| 检查项 | 结果 |
|--------|------|
| N domains → N Candidates？ | **否**（exact_term：SQL N 行 → merge 1 Hotword → 1 WindowCandidate） |
| 10 词展开倍数 | 均为 **1×**（见 §17） |
| Vote 双计因数组长度？ | **否**；问题是 **漏计** |
| TopK 被重复占坑？ | **非因多域复制**；仍受 exactTopK / per-span 8/6/4 约束 |
| 违反句候选 ≤16？ | **不因此违反**；≤16 由 `buildSentenceCandidates` slice 保证 |

**parent_fragment：** ngram 行本身单 `domainId`；若同一 parent 多 fragment 边，可能多次 `addDomainScore`（计数去重、分数可累加）——与 term 多标签展开无关，属 Shadow/证据链细节。

---

## 17. 10 个真实 multi-domain term trace

**数据源：** `node_runtime/lexicon/v3/lexicon.sqlite`（只读）。  
全库 multi-tag terms：**54**。

用户优先词实测：

| 词 | 是否 multi | 实际 tags |
|----|------------|-----------|
| 订单 | 否 | `food_order` |
| 预订 | **是** | 4 tags |
| 前台 | 否 | `tourism_hotel` |
| 接口 | 否 | `tech_ai` |
| 计划 | Base（0 tags） | — |
| 上线 | 否 | `tech_ai` |
| 文档 | Base | — |
| 接送 | **是** | 2 |
| 路线 | **是** | 2 |
| 咖啡 | 否 | `coffee` |

以下 **10 个真实 multi-domain**（含优先命中 + 补齐）：

### Trace 约定（主链，假定相关 fine 均在 `recallDomainScope` 内）

```text
DB tags → SQL 多行 → Hotword.domains[] 完整
→ Candidate.domainId = domains 首项（weight 优先；并列看 SQL 行序）
→ Vote 只给 domainId
→ sameDomain 仅当 domainId === winner
→ Assembly / KenLM 见单值或无域元数据
展开倍数 = 1
```

| # | word | term_id | DB tags (n) | SQL rows | Recall `domains[]` | Candidate `domainId`（典型） | Vote evidence | sameDomain | Assembly | 膨胀 |
|---|------|---------|-------------|----------|--------------------|------------------------------|---------------|------------|----------|------|
| 1 | 预订 | term-e9a284e8aea27c79 | food_order, tourism_hotel, tourism_route, transport (4) | 4 | 4 项 union | ≈首项（常见 food_order*） | 仅首项 | 仅 winner=首项时入桶 | 单域假设 | 1× |
| 2 | 接送 | term-e68ea5e980817c6a | tourism_pickup, tourism_transport (2) | 2 | 2 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 3 | 路线 | term-e8b7afe7babf7c6c | tourism_route, tourism_transport (2) | 2 | 2 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 4 | 少糖 | term-e5b091e7b3967c73 | coffee, food_order, milk_tea (3) | 3 | 3 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 5 | 中杯 | term-e4b8ade69daf7c7a | coffee, food_order, milk_tea (3) | 3 | 3 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 6 | 机场 | term-e69cbae59cba7c6a | tourism_transport, transport (2) | 2 | 2 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 7 | 预定 | term-e9a284e5ae9a7c79 | food_order, tourism_hotel, tourism_route (3) | 3 | 3 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 8 | 菜单 | term-e88f9ce58d957c63 | bakery, coffee, food_order, milk_tea (4) | 4 | 4 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 9 | 打包 | term-e68993e58c857c64 | bakery, coffee, food_order, milk_tea (4) | 4 | 4 | 首项 | 仅首项 | 同上 | 同上 | 1× |
| 10 | 堂食 | term-e5a082e9a39f7c74 | bakery, coffee, food_order, milk_tea (4) | 4 | 4 | 首项 | 仅首项 | 同上 | 同上 | 1× |

\*实测 weight 全为 **1.0**；SQL 无 `domain_id` 二级排序时，**首项可能随存储顺序变化**，审计不得把它当成稳定「主域」。

**Scope 裁剪示例：** 若 `recallDomainScope = {food_order}` only，则 `预订` 的 Recall `domains[]` 可能仅 `[food_order]`，tourism_* / transport **在 SQL 层已不可见**——与 Candidate 压缩是不同机制，需在修复时分别对待。

---

## 18. 受影响文件清单

| 文件 | 角色 |
|------|------|
| `lexicon-v2/lexicon-runtime-v2.ts` | SQL + mergeDomainTierRows |
| `lexicon/hotword-types.ts` | HotwordEntry 双字段 |
| `lexicon-v2/recall-span-topk-v2.ts` | domains[0] kind |
| `lexicon-v2/recall-span-topkv3.ts` | ngram 单 domain |
| `lexicon-v2/tone-first-tier-collector.ts` | 多域查询入口 |
| `lexicon-v2/merge-span-candidates.ts` | tier merge |
| `fw-detector/span-assembly-v4/recall-topk-for-windows.ts` | **主压缩** |
| `fw-detector/span-assembly-v4/v4-types.ts` | WindowCandidate 单值 |
| `fw-detector/span-assembly-shared/utterance-domain-vote.ts` | Vote |
| `fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts` | sameDomain + assembly |
| `fw-detector/span-assembly-v4/window-candidate-to-pick.ts` | pick 传 domainId |
| `fw-detector/span-assembly-v4/emit-v4-evidence.ts` | Shadow 单值 |
| `fw-detector/build-sentence-candidates.ts` | 句组合 / 诊断 domainId |
| `fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts` | KenLM 纯文本 |
| `lexicon/lexicon-runtime.ts` | 遗留 V1 domains[0] |
| `lexicon-v2/resolve-recall-enabled-fine-domains.ts` | coarse→fine scope |
| `lexicon-v2/weak-domain-recall-resolver.ts` | primaryDomain strong/weak |

---

## 19. 可删除的遗留单值字段（建议，不开发）

| 字段 | 说明 |
|------|------|
| `HotwordEntry.domain` | 与 `domains[0]` 镜像；迁移读者到 `domains[]` 后可删 |
| V1 `lexicon-runtime.ts` 的 `domain: domains[0]` | 遗留路径 |

**注意：** 在 Vote/Assembly 合同修好前，**不能**只删 `domain` 而不改 `WindowCandidate`。

---

## 20. 必须保留的字段

| 字段 | 原因 |
|------|------|
| `term_domain_tags` / `domains[]`（Recall） | SSOT 多域 |
| `domainWeights` | 权重 |
| Vote 后的 **单一** `utteranceDomain` / 建议新增 `selectedDomain` | 句级决策 |
| `recallDomainScope` / hierarchy | 召回范围 |
| Base 用 `source: base_term` 或空 `domains` | 禁止伪造 `general` 为 fine |

---

## 21. 最小修复范围（建议边界，本轮不实施）

1. **WindowCandidate / picks：** 增加并贯穿 `domains: string[]`；压缩点改为保留全集。
2. **Vote：** 对每个 domain 提供 evidence，但 **单 Candidate 总权重归一化**（如 `/ domains.length`）——仅建议，本轮不采用。
3. **sameDomain：** `domains.includes(winningDomain)`。
4. **Vote 后：** 可写 `selectedDomain`，**不覆盖** `domains[]`。
5. **日志：** 区分 `candidateDomains` / `votedFineDomain` / `validatedCoarseDomain` / `selectedSentenceDomain`。
6. **不改** KenLM、SQLite schema、hierarchy、展开 N 候选。

---

## 22. 风险矩阵

| 风险 | 严重度 | 机制 |
|------|--------|------|
| 错域 Vote（只投首项） | 高 | domains[0] |
| sameDomain 误杀 | 高 | `===` 非 `includes` |
| weight 并列首项不稳定 | 中 | SQL 无 domain_id tie-break |
| Scope 裁剪伪装成「单域词」 | 中 | recallDomainScope |
| parent_fragment 单域 | 中 | ngram 合同 |
| Candidate 数量膨胀 | **低** | 未展开 |
| 突破句候选 16 | **低** | 与本债无关 |
| Shadow / 主链双 Vote 不一致 | 中 | 并行合同 |

---

## 23. Target List

1. Candidate 在 Domain Vote 前保留完整 `domains[]`。
2. Vote 证据覆盖全部关联 fine（带归一化策略决策）。
3. sameDomain / Assembly 使用 `includes(selectedDomain)`。
4. 诊断可区分 candidateDomains vs voted/selected。
5. 禁止默认 N 复制候选。
6. Base 明确 `domains: []` 或 `scope: "base"`。
7. 不改 KenLM 合同。

---

## 24. Check List

- [x] SQL 多行 vs 聚合确认  
- [x] Hotword `domains[]` vs `domain`  
- [x] `domains[0]` 主压缩点定位  
- [x] Vote 单位与多域计票形态  
- [x] coarse → fine → vote → filter 顺序  
- [x] sameDomain 单值假设  
- [x] Assembly / KenLM 边界  
- [x] 10 真实 multi-domain trace  
- [x] 膨胀 vs 信息丢失  
- [x] 结论 A/B/C/D  
- [ ] （禁止）自动进入开发  

---

## 25. 推荐开发拆分

| Phase | 内容 | 依赖 |
|-------|------|------|
| **P0 合同** | WindowCandidate + pick DTO 增加 `domains[]`；recall-topk 停止丢弃；trace 字段 | 无运行策略变更亦可先 shadow 对比 |
| **P1 Vote** | 全 domain evidence + 归一化决策 + 单测（预订跨 restaurant/travel） | P0 |
| **P2 Filter/Assembly** | `includes` sameDomain；selectedDomain 写入；禁止覆盖 domains | P1 |
| **P3 诊断** | 四字段日志对齐；冻结测试更新 | P2 |
| **P4 清理** | 弃用 `HotwordEntry.domain` / V1 路径 | P3 稳定后 |

**不可一次合并为单 PR 无风险上线：** Vote 计票语义与 sameDomain 过滤同时变更会影响句域分布与 apply 率，需分阶段对照实验。

---

## 26. 最终结论

### 选择的结论标签（多选）

```text
B. Recall 与 Candidate 均存在单领域压缩
```

证据：Recall 保留 `domains[]` 但同时写遗留 `domain`=首项，且 kind 用 `domains[0]`；Candidate 层 `domainId = domain ?? domains[0]` **丢弃数组**。

```text
C. Candidate、Vote、sameDomain、Assembly 均存在单领域假设
```

证据：`WindowCandidate.domainId` → Vote 只读该字段 → `domainId === winningDomain` → picks/句组合仅单值。

```text
D. 存在多条并行合同或 shadow 链路
```

证据：主链 `runDomainAwareAssembly` vs Shadow `voteUtteranceDomain` + parent span + coarse beam（不进 KenLM）。

```text
A. 仅 Candidate DTO 存在 domains[0] 压缩
```

**不单独成立**（压缩点在 Candidate 生成，但 Vote/sameDomain/Assembly 均依赖该单值假设；Recall 亦有遗留单值）。

### 修复策略

```text
必须分阶段修复
```

不得一次性无门禁改 Vote+Filter+DTO。

### 停止条件

```text
AUDIT COMPLETE — STOP
```

本轮未修改代码、配置、SQLite、Lexicon Bundle、DTO、测试或日志；未进入开发。
)