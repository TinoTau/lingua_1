# FW Detector / Lexicon Recall — Sentence-Level Domain-Constrained Recall 开发前审计

**日期**：2026-06-03  
**性质**：只读审计（禁止开发 / 调参 / 改词库 / 改 IME / 改 KenLM / 改 Apply）  
**冻结主链 SSOT**：[ARCHITECTURE.md](./ARCHITECTURE.md)  
**前置审计**：[Recall Candidate Dump Audit](./Recall_Candidate_Dump_Audit_2026_06_03.md) · [Recall Width Sensitivity Audit](./Recall_Width_Sensitivity_Audit_2026_06_03.md) · [FW Recall Tone Constraint Audit](./FW_Recall_Tone_Constraint_Audit_2026_06_03.md)

**SQLite 探针**：`node_runtime/lexicon/v3/lexicon.sqlite`（`schemaVersion = lexicon-v3-four-table-v1`）

---

## 0. Executive Summary

| 结论项 | 判定 |
|--------|------|
| 当前代码是否支持句内领域一致性 Recall？ | **否** — 无 `SentenceDomainProfile`；span 独立召回；Builder 丢弃 domain metadata |
| 当前 SQLite 是否支持 subdomain / cluster？ | **否** — 仅有 `domain_id`（domain 表）；无 subdomain / cluster / scenario 字段 |
| 当前 Recall 候选是否携带足够 metadata？ | **部分** — runtime `HotwordEntry` 有 `domain/domains/source/repairTarget`；下游 `SpanReplacementPick` / KenLM **未传递** |
| 最小开发范围 | 新增 **句级** `SentenceDomainProfile` 推断 + Recall 约束层（推荐方案 B/C 混合）+ diagnostics 字段；**不改** IME / KenLM / Apply 契约 |
| 是否需要改表？ | **P2 若要 subdomain/cluster/base_safe 语义：需要**（可用 `source` 过渡，非长期方案） |
| 是否需要重建词库？ | **是（内容层）** — domain 表仅 25 行 restaurant；目标修复词大量缺失；base 无 safe 分层 |
| 是否需要新增 base_safe 层？ | **是** — 当前 base 50k 全 `repair_target=1`，含大量跨领域同音实体 |
| 是否需要新增 SentenceDomainProfile？ | **是** |
| 是否进入 Domain-Constrained Recall P2 Development？ | **是** — 在冻结主链内插入句级约束层 |
| 是否继续推进 Tone Constraint 作为主方案？ | **否** — 仅作 diagnostics（见 [Tone Audit](./FW_Recall_Tone_Constraint_Audit_2026_06_03.md)） |

**一句话**：当前 Recall 是 **plain pinyin + per-span 独立 TopK + session/profile 级 domain boost（可选且默认弱）**；缺少 **整句共享的 sentenceDomainProfile**，导致同拼音跨领域候选（烧饼/哨兵、平身、筋斗）进入组合空间。句级领域约束 **可插入冻结主链**，但 **必须配合词库补齐与 base_safe 分层**，否则仅过滤无法召回正确词（如少冰、交吗）。

---

## 1. 第一部分 — 现有主链审计

### 1.1 主链调用关系（冻结路径）

```text
runFwDetectorOrchestrator
  → resolvePinyinImeV2Spans          (IME → HintGate → FwSpanDiagnostics)
  → runWithLexiconRecallContext       (注入 sessionIntent，非句级)
  → runFwSentenceRerankPipeline
       → recallSpanTopK (per span)   (local-span-recall → recallSpanTopKV2)
       → buildSentenceCandidates
       → rerankFwSentences (KenLM)
       → mapSentenceToApprovedReplacements
  → applyFwSpanReplacements
```

### 1.2 必答八问

| # | 问题 | 结论 |
|---|------|------|
| **1** | `enabledDomains` 从哪里来？ | **Job 级配置**：`ctx.fwDetectorEnabledDomainsOverride` 优先，否则 `loadFwDetectorRuntimeConfig().enabledDomains`，默认 `['tech_ai','travel','transport','restaurant']`（`fw-config.ts` / `fw-detector-orchestrator.ts`）。与测试 scenario（cafe/classroom/tech_deploy）**无直接映射**。 |
| **2** | profile 如何传入 Recall？ | **`ActiveLexiconProfileSnapshot`**：`getProfileSnapshotFromContext(ctx) ?? defaultGeneralProfile()`，经 `runFwSentenceRerankPipeline` → `recallSpanTopK(span, profile, …)` → `recallSpanTopKV2({ profile, domainIds })`。用于 **candidateScore 的 domainBoost**（`computeCandidateScoreBreakdown`），**不是**句级硬约束。另：`runWithLexiconRecallContext({ sessionIntent })` 供 industry routing 读取（**session 级**）。 |
| **3** | 每个 span 是否独立 recall？ | **是**。`runFwSentenceRerankPipeline` 对 `input.spans` 循环调用 `recallSpanTopK(span.text, …)`（`fw-sentence-rerank-pipeline.ts:117-126`）。 |
| **4** | 多个 span 是否共享领域约束？ | **否（句级）**。每次 recall 调用 `resolveRecallDomainIds(profile, enabledDomains)`，输入相同则 `domainIds` 相同，但 **无 sentenceDomainProfile**；各 span 仍独立查 pinyin 桶、独立排序截断。**无**「全句候选必须同领域」约束。 |
| **5** | Recall 是否知道整句上下文？ | **否**。`recallSpanTopKV2` 仅接收 `windowText = span.text` 用于 editDistance / scoring；**不传** `rawAsrText`。整句仅在 Builder / KenLM 阶段使用。 |
| **6** | Recall 是否只知道 span.text？ | **是（查询键）**。pinyin key 由 `textToSyllables(trimmed span)` 生成；domain tier SQL 按 `pinyin_key + length(word)` 查；**不看** approvedSpans 邻域、不看 IME TopK token。 |
| **7** | Candidate Builder 是否知道候选来源领域？ | **否**。`SpanReplacementPick` 仅 `{ span, word, source, priorScore, repairTarget, candidateScore }`；`hitToSpanCandidate` **硬编码** `domains: []`, `domainMatched: false`（`fw-sentence-rerank-pipeline.ts:51-72`）。 |
| **8** | KenLM 是否知道领域信息？ | **否**。`rerankFwSentences` 仅对 `[rawText, …candidateSentences]` 做 batch score；无 domain / cluster 输入。 |

### 1.3 各模块职责摘要

| 模块 | 领域相关行为 |
|------|----------------|
| `fw-detector-orchestrator.ts` | 解析 `enabledDomains`、绑定 `profile`、包 `sessionIntent` 进 recall context；**未**做句级 domain 推断 |
| `resolve-pinyin-ime-v2-spans.ts` | HintGate 用 `recallSpanTopK(..., 1, …)` 作 **near-neighbor 探测**；与 rerank 阶段 recall **同路径** |
| `pinyin-ime-v2-hint-gate.ts` | 仅输出 `ApprovedSpan(rawSpan)`；**无** domain / replacement |
| `local-span-recall.ts` | 解析 `domainIds`；`passesEnabledDomainFilter` 对 **无 domains 的 base 命中一律放行** |
| `recall-span-topk-v2.ts` | base + domain + idiom tier 合并；`domainIds` 控制 domain SQL；**无** subdomain |
| `fw-sentence-rerank-pipeline.ts` | per-span recall → 笛卡尔积 → KenLM；过滤 `word === span.text` |
| `build-sentence-candidates.ts` | 纯组合 + candidateScore 求和；**无** domain 一致性检查 |
| `rerank-fw-sentences.ts` | KenLM delta 选句；**无** domain |

### 1.4 当前 domainIds 解析（Recall 用）

| 条件 | 行为 |
|------|------|
| `useIndustryRouting === false`（**默认**） | `resolveDomainIdsForRecall(profile)`：`primaryDomain === 'general'` → **`[]`**（不查 domain 表） |
| `useIndustryRouting === true` | `resolveRecallDomains`：sessionIntent → industry_routing → domain_anchor(**session 文本**) → enabledDomains 并集 |

> **关键**：默认 profile 为 `general` 时 **domain_lexicon 完全不参与 recall**；样本中的 烧饼/哨兵/平身/筋斗 均来自 **base_lexicon**。

---

## 2. 第二部分 — SQLite 词库结构审计

**Bundle**：`node_runtime/lexicon/v3/` · manifest `lexicon-v3-four-table-v1`  
**构建/导入 SSOT**：`electron_node/electron-node/scripts/lexicon/lib/lexicon-v3-runtime.mjs` · seed 见 manifest `seedInputs`（p1_3 jsonl）· patch 见 `lexicon-patch-v3/`

### 2.1 表字段（PRAGMA table_info，实测）

#### base_lexicon（50,000 行）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT | |
| `pinyin_key` | TEXT | PK 复合键之一；**无声调** |
| `tone_pinyin_key` | TEXT | 列存在；base 层 **0% 含数字声调** |
| `word` | TEXT | PK 复合键之一 |
| `normalized` | TEXT | |
| `prior_score` | REAL | |
| `repair_target` | INTEGER | 当前 bundle **100% = 1** |
| `enabled` | INTEGER | |
| `aliases` | TEXT | JSON 数组 |
| `source` | TEXT | 当前 **100%** `jieba_dict_mit_highfreq_fw_domain_compat` |
| `canonical_word` | TEXT | alias 用 |
| `is_alias` | INTEGER | |

**不存在**：`domain_id`, `subdomain_id`, `scenario_id`, `cluster_id`, `term_group`, `semantic_group`, `intent_id`

#### domain_lexicon（25 行）

| 字段 | 类型 | 说明 |
|------|------|------|
| `domain_id` | TEXT | PK 复合键之一；**当前仅 `restaurant`** |
| 其余 | 同 base | 含 `tone_pinyin_key`（64% 含数字声调） |

#### idiom_lexicon（22,192 行）

| 字段 | 类型 | 说明 |
|------|------|------|
| 同 base 结构 | | 4 字成语；recall 默认 `maxIdiomCandidates=0` **不参与** FW 主路径 |

#### industry_routing_lexicon（9 行）

| 字段 | 类型 | 说明 |
|------|------|------|
| `pinyin_key` | TEXT | PK |
| `keyword` | TEXT | PK |
| `domain_id` | TEXT | PK；**当前仅 restaurant** |
| `weight` | REAL | |

### 2.2 索引（PRAGMA index_list）

| 表 | 索引 | 列 |
|----|------|-----|
| base_lexicon | `sqlite_autoindex_base_lexicon_1` UNIQUE | `pinyin_key`, `word` |
| base_lexicon | `idx_base_pinyin` | `pinyin_key` |
| base_lexicon | `idx_base_pinyin_tone` | `pinyin_key`, `tone_pinyin_key` |
| domain_lexicon | `sqlite_autoindex_domain_lexicon_1` UNIQUE | `domain_id`, `word` |
| domain_lexicon | `idx_domain_pinyin` | `domain_id`, `pinyin_key` |
| domain_lexicon | `idx_domain_pinyin_tone` | `domain_id`, `pinyin_key`, `tone_pinyin_key` |
| idiom_lexicon | 同 base 模式 | |
| industry_routing_lexicon | UNIQUE | `pinyin_key`, `keyword`, `domain_id` |

**无** subdomain / cluster 索引。

### 2.3 数据量与 domain 分布

| 表 | 行数 | canonical | alias | distinct pinyin_key |
|----|------|-----------|-------|-------------------|
| base_lexicon | 50,000 | 50,000 | 0 | （见 stats） |
| domain_lexicon | 25 | 25 | 0 | 9 |
| idiom_lexicon | 22,192 | — | — | — |
| industry_routing_lexicon | 9 | — | — | 9 |

**domain 分布**：`restaurant: 25`（**无** tech_ai / travel / transport / meeting 条目）

**repair_target**：base 50,000 / domain 25 **全部为 1**

### 2.4 目标字段存在性

| 字段 | base | domain | idiom | routing |
|------|------|--------|-------|---------|
| domain_id | ❌ | ✅ | ❌ | ✅ |
| subdomain_id | ❌ | ❌ | ❌ | ❌ |
| scenario_id | ❌ | ❌ | ❌ | ❌ |
| cluster_id | ❌ | ❌ | ❌ | ❌ |
| term_group / semantic_group | ❌ | ❌ | ❌ | ❌ |
| intent_id | ❌ | ❌ | ❌ | ❌ |
| source | ✅ | ✅ | ✅ | ❌ |
| repair_target | ✅ | ✅ | ✅ | ❌ |
| prior_score | ✅ | ✅ | ✅ | weight |
| aliases | ✅ | ✅ | ✅ | ❌ |

### 2.5 能力判定

| 能力 | 支持？ |
|------|--------|
| 细分领域（subdomain） | **否** |
| 词簇（cluster） | **否** |
| 基础安全词库（base_safe） | **否** — base 无分层标记 |
| 多 domain 行业词 | **schema 支持，内容未覆盖**（仅 restaurant 25 条） |

---

## 3. 第三部分 — 词库分层能力审计

### 3.1 当前分层

| 层级 | 存在？ | 运行时行为 |
|------|--------|------------|
| 1. base 高频基础词 | ✅ 50k | 主召回源；**无** safe/unsafe 区分 |
| 2. domain 行业词 | ✅ schema / ❌ 内容 | 仅 restaurant；默认 profile=general 时不查 |
| 3. target 修复词 | ✅ `repair_target` 字段 | 全表=1，**无 selective target** |
| 4. alias 同义词 | ✅ `aliases` + `is_alias` | materialize 到各行 |
| 5. single_char 连接词 | ❌ 无独立 tier | HintGate normalizer 丢弃单字 span |
| 6. idiom 成语 | ✅ 22k | FW 默认关闭 idiom tier |

### 3.2 能否扩展为 base_safe / domain / subdomain / cluster / target？

| 目标层 | 现有表能否承载？ | 说明 |
|--------|------------------|------|
| base_safe | **仅临时** | 可用 `source` 或 `repair_target=0` 标记，但 **无 schema 语义**；与当前「全 repair_target=1」冲突 |
| domain | ✅ | `domain_lexicon.domain_id` |
| subdomain | ❌ | 需新字段或新表 |
| cluster | ❌ | 需新字段或新表 |
| target | ✅ | `repair_target` + domain 表专词 |

**结论**：句级 subdomain/cluster **不能**仅靠现有字段表达；domain 级 **schema 可承载、内容严重不足**。

---

## 4. 第四部分 — SentenceDomainProfile 可行性

### 4.1 建议结构（审计确认可插入）

```ts
interface SentenceDomainProfile {
  primaryDomain?: string;
  subdomainCandidates?: Array<{
    id: string;
    score: number;
    matchedTerms: string[];
  }>;
  clusterCandidates?: Array<{
    id: string;
    score: number;
    matchedTerms: string[];
  }>;
  safeBaseAllowed: boolean;
  source: 'lexicon_routing' | 'context_agent' | 'fallback';
}
```

### 4.2 生成位置评估

| 候选位置 | 评估 | 推荐 |
|----------|------|------|
| `fw-detector-orchestrator`（`runFwSentenceRerankPipeline` 之前） | ✅ 有 `rawText`、`enabledDomains`、`profile`；可 **一次推断、全 span 共享**；不触碰 IME | **首选** |
| `runFwSentenceRerankPipeline` 入口 | ✅ 同上；封装更内聚 | **次选（等价）** |
| `local-span-recall` 内部 | ❌ 每 span 重复推断；且缺 `rawAsrText`  unless 额外传参 | 不推荐 |
| `buildSentenceCandidates` 之前 | ⚠️ 过晚 — recall 已完成，只能过滤组合不能约束召回 | 仅作组合级 fallback |

**推荐**：在 **`runFwSentenceRerankPipeline` 开头**（或 orchestrator 调用前）生成 `sentenceDomainProfile`，通过 **新 recall context**（类似 `runWithLexiconRecallContext`）传入 `recallSpanTopK` / `recallSpanTopKV2`，**不改** IME / ApprovedSpan / Apply。

### 4.3 与冻结主链兼容性

- ✅ 不修改 Pinyin-IME-V2 / HintGate / ApprovedSpan 定义  
- ✅ 不绕过 Recall / KenLM  
- ✅ 仅增加 recall 前 **句级** 约束与 diagnostics  
- ⚠️ `context_agent` source 若用 sessionIntent：**须限定为当前句信号或只读 snapshot**，不作 session 硬约束（见 §5）

---

## 5. 第五部分 — 领域推断来源审计

### 5.1 系统现有信号

| 信号 | 当前是否用于 Recall | 粒度 | 句内可用？ |
|------|---------------------|------|------------|
| `enabledDomains` | ✅ post-filter + domain SQL | job | ✅ |
| `industry_routing_lexicon` | ⚠️ 仅 `useIndustryRouting=true` | session keyword pinyin | ⚠️ 需改为 **rawAsrText 扫描** |
| rawAsrText 词库关键词 | ❌ 未实现 | — | ✅ **应新增** |
| ApprovedSpan 邻域上下文 | ❌ | — | ✅ 可选 |
| IME TopK tokens source | ❌ 未传入 Recall | — | ✅ 可选（diagnostics） |
| JobContext / user context | 部分（enabledDomains override） | job | ✅ |
| CPU LLM context agent | sessionIntent（confidence≥0.75） | **session** | ⚠️ 本阶段 **禁止作硬约束**；可作 profile 提示 |

### 5.2 本阶段允许的信号（审计约束）

**允许**：

1. 当前句 `rawAsrText` 全文  
2. 当前句 ApprovedSpan 列表（位置 + rawSpan）  
3. `enabledDomains`（job 配置）  
4. `industry_routing_lexicon` **对 rawAsrText 子串 / pinyin 命中**（非 session 累积 topic）  
5. `domain_anchor.json` **对 rawAsrText**（非 session summary）

**禁止**：

- Session rolling context 硬过滤  
- 跨 turn primaryDomain 锁定  
- CPU LLM 同步阻塞调用  

### 5.3 与 profile-registry 的映射 gap

`profile-registry.json` 含：`travel, restaurant, tech_ai, medical, meeting, transport`  
默认 `enabledDomains` **不含** `meeting, medical`  
测试 scenario（cafe, classroom, tech_deploy）**不是** lexicon `domain_id` — 需 P2 定义 **scenario → domain_id / subdomain** 映射表（runtime 配置，非 session 状态）。

---

## 6. 第六部分 — Recall 约束方式审计

### 方案 A — SQL 先 domain/subdomain，再 fallback base_safe

| 维度 | 评估 |
|------|------|
| 性能 | ✅ 最优 — 缩小 SQL 结果集 |
| 改动量 | 大 — 需 subdomain  schema + base_safe 分层 + domain 内容重建 |
| 风险 | domain 表空 / 推断错误 → **NOT_FOUND 扩大** |
| 误杀 | 高 — 若无 base_safe fallback |
| 冻结主链 | ✅ 兼容 — 仅改 recall SQL/merge |

### 方案 B — plain pinyin 查，后处理 filter

| 维度 | 评估 |
|------|------|
| 性能 | ✅ 可接受 — filter O(k) per span |
| 改动量 | **中** — profile 推断 + filter 逻辑 + diagnostics |
| 风险 | 中 — 正确词不在池内仍 NOT_FOUND |
| 误杀 | 中 — 可 `safeBaseAllowed` 放宽 |
| 冻结主链 | ✅ **最兼容** |

### 方案 C — plain pinyin + 加权（subdomain > domain > base_safe > unrelated）

| 维度 | 评估 |
|------|------|
| 性能 | ✅ 与现 scoring 合并 |
| 改动量 | 中 — 已有 `domainBoost`（profile 级），需改为 **sentenceDomainProfile 级** |
| 风险 | 低 — 少误杀 |
| 误杀 | 低 |
| 冻结主链 | ✅ 兼容 |

**现状**：已部分实现 **C 的弱化版**（`computeDomainBoost` + merge tier priority），但绑定 **session profile** 且 **general 时 domainBoost=0**；**无** base_safe / unrelated 降权。

### 推荐

**P2 推荐：B + C 混合（软约束优先，硬过滤可选）**

1. 生成 `sentenceDomainProfile`  
2. **加权**：same domain > enabledDomains > base_safe > unrelated base（方案 C）  
3. **硬过滤**（方案 B）：仅对 **unrelated 跨领域实体**（如 烧饼/哨兵在 cafe 句）drop；**保留** base_safe  
4. 当 domain tier 有命中时 **优先 merge**（方案 A 子集，不依赖 subdomain schema 的第一阶段）

**不推荐** 纯 A 作为 P2 第一步 — domain 表内容不足会导致 recall 空洞。

---

## 7. 第七部分 — 候选池一致性审计

### 7.1 当前问题

多 span 独立 recall → `buildSentenceCandidates` 笛卡尔积 → 可出现：

- span1: restaurant 候选  
- span2: military/通用 homophone 候选  
- span3: tech 候选  

KenLM 仅在 **句级** 选最优，**不保证** span 级领域一致。

### 7.2 Builder metadata 能力

| 结构 | domain/cluster | 说明 |
|------|----------------|------|
| `RecallSpanTopKV2Hit.hotword` | ✅ `domain/domains/source` | 在 recall 内部 |
| `LocalSpanRecallHit` | ✅ `domains` | 未传入 Builder |
| `SpanReplacementPick` | ❌ | 无 domain 字段 |
| `FwSpanCandidateDiag` | ⚠️ 字段存在但 **写死空** | diagnostics 丢失 |
| `SentenceCombination` | ❌ | 无句级 domain 一致性分 |

### 7.3 建议（P2，不改 Apply 契约）

在 `SpanReplacementPick` 或 parallel diagnostics 增加 **可选** 字段：

```ts
// diagnostics / ranking only — 不参与 Apply
recallDomainId?: string;
recallClusterId?: string;  // 未来
recallTier?: 'domain' | 'base' | 'idiom' | 'base_safe';
sentenceDomainMatchScore?: number;
```

`buildSentenceCandidates` 可增加 **组合级** penalty（仅影响 `candidateScore` 排序截断，不改 KenLM 输入结构）。

---

## 8. 第八部分 — base_safe fallback 审计

### 8.1 base_safe 必要性

| 应包含 | 应排除 |
|--------|--------|
| 常见口语词、动作词、连接词 | 跨领域实体（烧饼、哨兵、角马） |
| 低风险高频业务词 | 易误修同音专有名词 |
| 句内语法功能词 | 低频 domain 实体 |

### 8.2 当前 base_lexicon 能否区分 base_safe？

**不能。**

- 50,000 行统一 `source = jieba_dict_mit_highfreq_fw_domain_compat`  
- **100%** `repair_target = 1`  
- 无 `tier` / `safe` / `cluster` 标记  
- 同拼音桶 **烧饼/哨兵/评审/平身** 等混存  

### 8.3 后续开发风险标记

| 风险 | 级别 |
|------|------|
| 无 base_safe → 领域过滤只能「全 base」或「全删」 | **高** |
| 过滤过严 → NOT_FOUND 上升（已 76.5%） | **高** |
| 仅靠 prior_score 无法区分 safe vs entity homophone | **高** |

**P2 必须**：base_safe 分层（新字段或 `source` 约定 + 重建脚本），与 domain target 词 **分轨导入**。

---

## 9. 第九部分 — 典型样本审计

数据：**v3 SQLite 直查** + [Recall Candidate Dump Audit](./Recall_Candidate_Dump_Audit_2026_06_03.md)

### 9.1 样本总表

| 样本 | 当前 Recall Top | 目标 | 词库能否句级 domain 约束？ | 缺什么 |
|------|-----------------|------|---------------------------|--------|
| **少病** | 烧饼、哨兵 | cafe → 少冰 | **不能单独解决** | 少冰 **不在词库**；domain 无 cafe/restaurant 少冰；需 **domain target 导入** + base 过滤掉烧饼/哨兵 |
| **评审** | 平身（评审与 span 同文被滤） | meeting → 评审 | **不能** — 评审是 raw 正确形 | 问题非跨域 homophone，是 **span=正确词仍进 FW**；domain 约束 **无收益** |
| **进都** | 筋斗、斤斗 | meeting → 进度 | **不能** | `textToSyllables(进都)→jin\|dou`，进度在 **jin\|du** 桶；**拼音键错误** + 进度虽在 base 但 **未进入 jin\|dou 查询** |
| **叫吗** | 叫骂、角马、蕉麻 | classroom → 交吗 | **不能单独解决** | 交吗 **不在词库**；需 target 导入；domain 过滤可去掉角马类 **若** 有 cluster |
| **纹当** | 文档✅、稳当 | tech_deploy → 文档 | **部分** | 文档已在 base Top1；domain 约束可 **降权稳当** 但 KenLM 已能选文档；**非 NOT_FOUND 类** |

### 9.2 词库直查（v3 sqlite）

| 词 | base_lexicon | domain_lexicon |
|----|--------------|----------------|
| 少冰 | ❌ | ❌ |
| 烧饼 / 哨兵 | ✅ shao\|bing | ❌ |
| 评审 / 平身 | ✅ ping\|shen | ❌ |
| 进度 | ✅ jin\|du | ❌ |
| 筋斗 / 斤斗 | ✅ jin\|dou | ❌ |
| 交吗 | ❌ | ❌ |
| 叫骂 / 角马 | ✅ jiao\|ma | ❌ |
| 文档 / 稳当 | ✅ wen\|dang | ❌ |

### 9.3 样本结论

**句级 domain 约束能缓解**：少病类（过滤烧饼/哨兵）、纹当类（偏 tech 文档）— **前提是** domain/target 词库有正确候选。  

**句级 domain 约束不能解决**：

1. **NOT_FOUND**（少冰、交吗）— 需 **target 词库导入**  
2. **拼音键不一致**（进都 jin\|dou vs 进度 jin\|du）— 超出 domain recall 范围  
3. **span 已是正确词**（评审）— IME/HintGate 层问题  

---

## 10. 第十部分 — 性能风险审计

| 环节 | 增量 | 对 Recall ms | 对 Builder 组合 | 对 KenLM query |
|------|------|--------------|-----------------|----------------|
| SentenceDomainProfile 推断（rawAsrText 扫描 routing/anchor） | 1× O(n) / utterance | **+亚毫秒级** | — | — |
| domain filter / 加权 | per candidate 常数 | **可忽略** | — | — |
| 缩小 unrelated 候选 | 减少 hit 数 | **略降** | **组合空间下降** ✅ | 不变或略降 |
| diagnostics metadata | 每 pick +几个字段 | — | 内存 **可忽略** | **不变** |

**目标对齐**：减少噪音候选 → **应降低** 无效组合 → **不增加** KenLM query count（仍 ≤ `maxSentenceCandidates+1`）。

**风险**：若仅 hard filter 无 base_safe → 某 span recall 空 → Builder **整体失败**（`buildSentenceCandidates` 遇空 spanSet 返回 `[]`）。

---

## 11. 第十一部分 — 冻结边界检查

| 检查项 | 新方案是否触犯？ |
|--------|------------------|
| 修改 Pinyin-IME-V2 | **否** — profile 在 IME 之后 |
| 修改 ApprovedSpan 定义 | **否** |
| IME candidate word 直接进入 replacement | **否** |
| 绕过 Recall | **否** |
| 绕过 KenLM | **否** |
| 修改 Apply | **否** |
| 修改 segmentForJobResult 写点 | **否** |
| 恢复 legacy detector | **否** |
| 引入 session 硬约束 | **否**（若严格句内信号） |
| 引入 CPU LLM 同步阻塞 | **否** |

---

## 12. 第十二部分 — 最终结论

### 12.1 必答清单

| 问题 | 答案 |
|------|------|
| 当前代码是否支持句内领域一致性 Recall？ | **否** |
| 当前 SQLite 是否支持 subdomain / cluster？ | **否** |
| 当前 Recall 候选是否携带足够 metadata？ | **Recall 内部有，下游丢弃 — 不足** |
| 最小开发范围 | `SentenceDomainProfile` + recall context 传递 + filter/weight + diagnostics；**可选** domain SQL 优先 merge |
| 是否需要改表？ | **长期 yes**（subdomain/cluster/base_safe）；**短期可用 source + domain 内容扩展** |
| 是否需要重建词库？ | **是** — domain 仅 25 行；target 词缺失 |
| 是否需要新增 base_safe 层？ | **是** |
| 是否需要新增 SentenceDomainProfile？ | **是** |
| 是否进入 Domain-Constrained Recall P2 Development？ | **是** |
| 是否继续推进 Tone Constraint？ | **否**（仅 diagnostics） |

### 12.2 P2 最小路径建议（不偏离冻结主链）

```text
rawAsrText
  → [NEW] inferSentenceDomainProfile(rawAsrText, enabledDomains, approvedSpans?)
  → Pinyin-IME-V2 → HintGate → ApprovedSpans
  → Recall(per span, shared profile) — weight/filter + domain tier
  → Candidate Builder — optional combo domain penalty (diagnostics)
  → KenLM → Apply
```

**Phase 2 依赖顺序**：

1. **Runtime**：SentenceDomainProfile + recall 约束（B+C）  
2. **Lexicon 内容**：domain target 词（少冰、交吗…）+ industry_routing 扩面  
3. **Lexicon 结构**：base_safe 标记 + 跨域 homophone 出 base  
4. **Optional 表结构**：subdomain_id / cluster_id（若 scenario 细分成为硬需求）

### 12.3 与既有审计的关系

| 既有结论 | 本审计关系 |
|----------|------------|
| Recall Width 无收益 | 一致 — 加宽不能解决跨域 homophone |
| NOT_FOUND 76.5% 主因 | domain 约束 **补充** 语义一致性，**不替代** target 词库 |
| Tone Constraint 名存实亡 | **不作为主方案**；与 domain 约束正交 |

---

**审计完成。本轮未修改代码、词库、配置或数据库。**
