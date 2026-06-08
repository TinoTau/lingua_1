# Domain-Constrained Recall P2 — 补充信息与约束清单

**日期**：2026-06-03  
**对照文档**：[Domain-Constrained Recall P2 冻结开发方案](./Domain-Constrained%20Recall%20P2%20冻结开发方案.md)  
**代码审计依据**：[Domain_Constrained_Recall_PreDev_Audit_2026_06_03.md](./Domain_Constrained_Recall_PreDev_Audit_2026_06_03.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)  
**性质**：开发前补充清单（非实现）

---

## 0. 用途

本文档在 P2 冻结方案基础上，对照 **当前实际代码与词库**，列出：

1. 方案中 **未写清但实现时必须约定** 的信息  
2. 与现有 runtime 行为 **可能冲突** 的约束  
3. 建议 **写入 P2 方案或冻结合约** 的补充条目  

---

## 1. 方案歧义 — 需先冻结的定义

### 1.1 「禁止修改 FW」与允许改动范围

| 项 | 现状 | 建议补充约束 |
|----|------|--------------|
| P2 方案 §二 写「禁止修改 FW」 | 同时要求改 `runFwSentenceRerankPipeline`、`recallSpanTopK` | **明确白名单**：允许改 `fw-sentence-rerank-pipeline.ts`、`local-span-recall.ts`、`recall-span-topk-v2.ts`（仅 filter/weight/diagnostics）、新增 `infer-sentence-domain-profile.ts`、扩展 `lexicon-recall-context.ts` |
| 禁止范围 | — | **禁止**改 `fw-detector-orchestrator.ts` 主链顺序、`apply-span-replacements.ts`、`resolve-pinyin-ime-v2-spans.ts` 内 IME 逻辑、`pinyin-ime-v2-hint-gate.ts` 门控规则 |

> 若严格禁止「任何 FW 目录改动」，P2 **无法落地**；需在方案中改为「禁止改 Span Discovery / Apply / KenLM 路径」。

### 1.2 「禁止修改 Builder 组合逻辑」vs `candidateScore += sentenceDomainMatchScore`

| 项 | 代码现状 | 建议补充约束 |
|----|----------|--------------|
| `build-sentence-candidates.ts` | `combinationScore = sum(pick.candidateScore)`，无 domain 字段 | **禁止**改笛卡尔积、cap、`maxSentenceCandidates` 截断逻辑 |
| P2 允许 `candidateScore += …` | — | **必须写清注入点**：在 `fw-sentence-rerank-pipeline.ts` 映射 `recall.hits → SpanReplacementPick` 时写入 `candidateScore` / `sentenceDomainMatchScore`；**不要**改 `buildSentenceCandidates` 函数签名或组合算法 |
| 句级加分 | Builder 仅对已有 pick 求和 | 若需「组合级 domain 一致性 penalty」，**P2 不做**（与方案 §九 一致则 OK） |

### 1.3 `SentenceDomainProfile.source` 枚举

| P2 方案 | 审计建议 | 建议补充 |
|---------|----------|----------|
| `routing` \| `enabledDomains` \| `fallback` | 曾含 `lexicon_routing` / `context_agent` | **禁止** `context_agent` / sessionIntent 作为 P2 硬约束 source；若 routing 命中，统一为 `routing` |
| — | — | 新增 diagnostics 字段 `routingDetail?: 'industry_lexicon' \| 'domain_anchor' \| 'none'`（仅观测） |

---

## 2. 调用链 — 方案未覆盖的代码路径

### 2.1 HintGate 也调用 `recallSpanTopK`（关键缺口）

**代码**：`resolve-pinyin-ime-v2-spans.ts` → `createLexiconNearNeighborProbe` → `recallSpanTopK(rawSpan, profile, 1, …)`，发生在 **IME / HintGate 阶段**，早于 `runFwSentenceRerankPipeline`。

| 决策项 | 建议 |
|--------|------|
| HintGate 是否应用 SentenceDomainProfile？ | **P2 默认：否** — HintGate 仅探测「是否存在近音 neighbor」，保持现有行为；在方案中 **显式写入** |
| 若否 | domain 约束 **仅**作用于 rerank 阶段 recall，避免 span 发现阶段被误杀 |
| 若将来要对齐 | 需把 `inferSentenceDomainProfile` 前移到 orchestrator（在 `resolvePinyinImeV2Spans` 之前），**超出 P2 最小范围** |

### 2.2 Profile 推断时机与输入

| 项 | 代码事实 | P2 必须约定 |
|----|----------|-------------|
| 推断位置 | 方案：`runFwSentenceRerankPipeline` 入口 | ✅ 可行；此时已有 `rawText` + `spans` |
| 不可用输入 | `recallSpanTopKV2` 当前 **无** `rawAsrText` | 推断只用 `input.rawText`；**不要**在 `local-span-recall` 内再推断 |
| `sessionIntent` | `runWithLexiconRecallContext({ sessionIntent })` 已存在 | **禁止** P2 用 sessionIntent 覆盖 sentenceProfile；见 §3.2 |

### 2.3 排序链顺序（与 domain weight 冲突风险）

**当前** `fw-sentence-rerank-pipeline.ts` 在 recall 后对 picks 排序：

```text
toneDistance ↑ → priorScore ↓ → candidateScore ↓
```

| 约束 | 说明 |
|------|------|
| P2 domain weight 作用点 | 应进入 **`candidateScore`（或 recall 内 sort）**，并在 pipeline 排序 **之前** 完成 |
| 禁止 | 仅改 Builder 不改 pipeline 排序 → domain 加权可能被 toneDistance 覆盖 |
| Tone Constraint | **不作为主方案**；`toneDistance` 排序 **保留不动**（diagnostics only） |

---

## 3. 与现有 Domain 机制的关系 — 必须写清的约束

### 3.1 双轨 Domain：`ActiveLexiconProfileSnapshot` vs `SentenceDomainProfile`

| 机制 | 代码位置 | 当前行为 | P2 约束 |
|------|----------|----------|---------|
| Session profile domainBoost | `computeDomainBoost(profile, hotwordDomains)` | `primaryDomain=general` 时 boost=0 | **禁止** P2 依赖 session profile 作硬约束 |
| Recall domainIds | `resolveRecallDomainIds(profile, enabledDomains)` | general → `domainIds=[]`，**不查 domain 表** | sentenceProfile 应提供 **`recallDomainIds`**，与 session profile **解耦** |
| enabledDomains filter | `passesEnabledDomainFilter` | `hit.domains` 为空 → **一律放行** | base 命中不受 enabledDomains 限制；P2 filter **必须单独实现** |

**建议冻结规则**：

- `SentenceDomainProfile.primaryDomain` / `domainCandidates` → 驱动 **句级** filter/weight 与 **可选** domain SQL 的 `domainIds`  
- `ActiveLexiconProfileSnapshot` → P2 **不增强**；避免 `domainBoost` 与 `sentenceDomainMatchScore` **双重加分**（二选一或明确公式）

### 3.2 `useIndustryRouting` 与「禁止 Session Topic Lock」

| 项 | 代码 | P2 约束 |
|----|------|---------|
| 默认 | `useIndustryRouting: false`（`freeze-config-ssot.json`） | P2 **保持 false** |
| 为 true 时 | `resolveRecallDomains` 读 **sessionIntent**（summary + topicKeywords） | 与 P2「句内信号 only」冲突 |
| 句级 routing | `industry_routing_lexicon` 仅 9 条 restaurant | 推断应扫描 **`rawAsrText` 子串 / pinyin**，复用 `lookupIndustryRoutes`，**不读** sessionIntent |

### 3.3 `domain_anchor.json` 覆盖缺口

**路径**：`electron_node/electron-node/data/lexicon/domain_anchor.json`

| 已有 domain | 无 anchor |
|-------------|-----------|
| tech_ai, travel, transport, restaurant | **meeting, medical, classroom, cafe（scenario）** |

**约束**：

- P2 推断 fallback 到 `enabledDomains` 时，**不能**假设 anchor 覆盖测试 scenario  
- 批测 scenario（cafe/classroom/meeting）与 `profile-registry.json` domain_id **不一致** → 需 **runtime scenario→domain 映射表**（配置 JSON，非 session 状态），方案 **未提及**

---

## 4. Recall 实现 — 必须补充的技术约束

### 4.1 Filter / Weight 与 `perSpanLimit` 的空池风险

| 代码 | 风险 | 强制约束 |
|------|------|----------|
| `buildSentenceCandidates` | 任一 span 的 `spanCandidates.length === 0` → **返回 `[]`** | filter 后 **每 span 至少保留 1 个 pick**（fallback unrelated_base 或 raw 等价 noop） |
| `getPerSpanCandidateLimit` | 2~8 冻结（span 数越多 cap 越小） | filter **在 cap 之后** 还是之前？建议：**先 SQL merge+cap，再 filter+weight，再保证 min 1** |
| `minPrior: 0.5` 冻结 | 已在 recall 内过滤 | domain filter **不得**叠加提高 effective minPrior |

### 4.2 「禁止纯 SQL 强过滤」的操作化定义

| 允许 | 禁止 |
|------|------|
| 仍查 base + domain + idiom（现有 SQL 不变） | `WHERE domain_id = ?` 作为 **唯一** recall 源 |
| merge 后 memory 中 drop / 降权 | SQL 层去掉 base 行 |
| domain tier 优先 merge（现有 `mergeSpanCandidatesCombined`） | 缩小 SQL `LIMIT` 导致 base_safe 进不来 |

### 4.3 `recallTier` 判定规则（方案未定义）

需在 P2 冻结 **判定顺序**（建议）：

```text
1. hotword 来自 domain_lexicon 查询结果 → tier = domain, recallDomainId = domain_id
2. hotword.source 匹配 base_safe 约定 → tier = base_safe
3. hotword 来自 base_lexicon → tier = base
4. idiom（当前 maxIdiomCandidates=0）→ tier = idiom（FW 路径默认不出现）
```

### 4.4 `source` 字段临时约定（Phase 2 不改表）

| 当前 bundle | P2 需新增 |
|-------------|-----------|
| 100% `jieba_dict_mit_highfreq_fw_domain_compat` | 明确映射为 **`base`（unrelated_base）**，非 base_safe |
| domain 表 `manual_domain_homophone_patch_example` | 映射为 **`domain`** |
| — | 新导入 **`source=base_safe`** 的行（口语/连接/动作/低风险业务词） |
| — | 新导入 **`source=domain_target`** 或 domain 表 + `repair_target=1` 的目标修复词（少冰、交吗等） |

**Patch 路径**：`lexicon-patch-v3/row-materialize.ts` 已支持 `entry.source` → SQLite `source` 列；P2 词库任务应走 **patch-v3**，不是 legacy import-v3-5k。

### 4.5 跨域实体 filter 列表

方案 §六 列举 military/animal/food/tech/travel — **非代码枚举**。

| 建议 | 说明 |
|------|------|
| P2 **不要**硬编码 domain 名列表作 filter | 用 **tier + sentenceDomainProfile 匹配** 代替 |
| 「烧饼/哨兵/角马/筋斗」 | 通过 **unrelated_base 降权/过滤** + **非 base_safe** 实现，不维护 animal/food 标签 |

---

## 5. 词库 — 方案低估的约束

### 5.1 当前 v3 bundle 事实（实现前必读）

| 表 | 行数 | P2 影响 |
|----|------|---------|
| base_lexicon | 50,000 | 全 `repair_target=1`；无 base_safe |
| domain_lexicon | 25（**仅 restaurant**） | sameDomain 约束对 cafe/meeting/tech **几乎无效** |
| industry_routing_lexicon | 9（**仅 restaurant**） | rawAsrText routing 覆盖极窄 |
| 目标词 | 少冰/交吗/进度等 | **大量 NOT_IN_LEXICON**（见 PreDev Audit §9） |

**约束**：P2 **验收「降权烧饼」** 可仅 runtime 完成；**验收「召回少冰/交吗」** 必须 **并行词库 patch**，不应写进 P2 runtime Done 条件 unless 明确 scope。

### 5.2 `candidateRequireRepairTarget: true`（冻结）

- `mapSentenceToApprovedReplacements` 丢弃 `repairTarget=false` 的替换  
- base_safe 若 `repair_target=0` → **KenLM 选中也无法 Apply**  
- **约束**：base_safe 与 domain target 导入时 **`repair_target=1`**，或 P2 明确哪些 tier 必须 repair_target

### 5.3 `enabledDomains` 与测试 scenario

| 默认 enabledDomains | 不含 |
|---------------------|------|
| tech_ai, travel, transport, restaurant | meeting, medical |

**约束**：Dialog200 批测若 scenario=meeting 但 job 未 override enabledDomains，sentenceProfile 推断 **不得**假设 meeting 在 enabled 内；需在测试 harness 或方案中 **写清 job 级 enabledDomains 与 scenario 对齐规则**。

---

## 6. Diagnostics — 方案 Target List 需对齐现有结构

### 6.1 已有 diagnostics 扩展点

| 位置 | 现有字段 | P2 建议挂载 |
|------|----------|-------------|
| `RecallJobV2Diagnostics` | per-span tier counts, `active_domain` | + `sentence_domain_profile`, `domain_filtered_count`, `base_safe_hits` |
| `FwSpanCandidateDiag` | `domains`, `domainMatched`, `domainScore`（**当前恒空/0**） | 接线 `recallDomainId`, `recallTier`, `sentenceDomainMatchScore` |
| `FwDetectorResult` | `recallV2Diagnostics`, `sentenceRerank` | + `sentenceDomainProfile` 摘要 |
| `SpanReplacementPick` | 无 metadata | + optional diagnostics 字段（**禁止**进入 `FwApprovedReplacement`） |

### 6.2 冻结合约测试

`freeze-contract.test.ts` 当前 **无** domain-constrained recall 条目。

| 建议新增合约 | 内容 |
|--------------|------|
| IME 仍不读 SentenceDomainProfile | 静态检查 `resolve-pinyin-ime-v2-spans` 不 import infer 模块 |
| Apply 结构不变 | `FwApprovedReplacement` 仍仅 start/end/candidateText |
| KenLM 输入不变 | `rerankFwSentences` 仍仅 string[] |

---

## 7. 验收 — 方案 §十二 需补充的边界

### 7.1 P2 Runtime 验收 vs 词库验收（拆分）

| 类别 | 可验收项 | 不可单独验收项 |
|------|----------|----------------|
| **Runtime only** | 跨域 homophone 排名下降；`domainFilteredCount>0`；Recall/Builder/KenLM 计数不变 | 少冰/交吗 NOT_FOUND 消失 |
| **Lexicon + Runtime** | 目标词进入 Recall 且 domain 匹配 | 端到端 Apply 提升（KenLM 另议） |

### 7.2 方案功能用例的代码层限制

| 用例 | P2 runtime  alone | 原因 |
|------|-------------------|------|
| 烧饼/哨兵/角马/筋斗 降权 | ✅ | unrelated_base filter |
| 少病 → 少冰 | ❌ | 少冰 **不在词库** |
| 评审 → 保留评审 | ❌ | span=评审 被 `word!==span.text` 滤掉，只剩平身 — **HintGate/span 语义问题** |
| 进都 → 进度 | ❌ | `textToSyllables(进都)→jin\|dou`，进度在 **jin\|du** 桶 |
| 纹当 → 文档 | ⚠️ | 文档已在 Top1；domain 约束 **边际收益** |

**约束**：P2 Check List §功能 应标注 **「Runtime 降权验收」** 与 **「词库+端到端验收」** 分栏，避免误判 P2 失败。

### 7.3 性能验收基准

| 冻结参数 | SSOT 值 | 验收时必须固定 |
|----------|---------|----------------|
| perSpanLimit | 8/4/2 | ✅ |
| maxSentenceCandidates | 16 | ✅ |
| maxBaseCandidates / maxDomainCandidates | 2 / 3 | ✅ |
| minPrior | 0.5 | ✅ |
| useIndustryRouting | false | ✅ |

---

## 8. 建议写入 P2 方案的补充章节（提纲）

可直接合并进原方案：

1. **§2.1 允许修改文件白名单**（Recall 路径 + infer 模块）  
2. **§5.1 HintGate 不应用 SentenceDomainProfile**  
3. **§5.2 与 session profile / domainBoost 互斥规则**  
4. **§5.3 scenario → domain_id 映射（配置，非 session）**  
5. **§6.1 filter 后 min-1 pick 保证（防 Builder 空组合）**  
6. **§6.2 candidateScore 注入点 = pipeline 映射阶段**  
7. **§8.1 source 枚举冻结值**（base_safe / domain / legacy base）  
8. **§8.2 词库 patch 为 P2 并行轨，非 runtime 可选**  
9. **§12.1 验收拆分：Runtime vs Lexicon**  
10. **§12.2 明确 OUT_OF_SCOPE**：拼音键不一致、span=正确词、Tone 主路径  

---

## 9. 实施 Checklist（合并 P2 方案 §十、§十一）

### 9.1 方案冻结（文档）

- [ ] 澄清「禁止修改 FW」= 禁止 Span Discovery / Apply / KenLM，**允许** Recall 路径改动  
- [ ] 固定 HintGate **不**消费 SentenceDomainProfile  
- [ ] 固定 `candidateScore` 加权注入点（pipeline，非 Builder 组合算法）  
- [ ] 固定 `source` 字段语义（base_safe / domain / unrelated base）  
- [ ] 固定 filter 后 **每 span ≥1 pick**  
- [ ] 固定与 `computeDomainBoost(session profile)` **不双重加分**  
- [ ] 固定 P2 **不启用** `useIndustryRouting` / sessionIntent 硬约束  
- [ ] 补充 scenario → domain_id 映射策略  
- [ ] 拆分 Runtime / Lexicon 验收标准  

### 9.2 Runtime 实现

- [ ] `infer-sentence-domain-profile.ts`（rawAsrText + enabledDomains + domain_anchor + industry_routing）  
- [ ] 扩展 `lexicon-recall-context` 或 pipeline 入参传递 `SentenceDomainProfile`  
- [ ] `local-span-recall` / `recall-span-topk-v2`：tier 标注 + filter/weight  
- [ ] `SpanReplacementPick` / `FwSpanCandidateDiag` diagnostics 接线  
- [ ] `RecallJobV2Diagnostics` 扩展  
- [ ] `FwDetectorResult` 输出 sentenceDomainProfile 摘要  

### 9.3 词库（并行轨）

- [ ] base_safe 词条 patch（`source=base_safe`, `repair_target=1`）  
- [ ] domain target 词 patch（少冰、交吗、进度等，按 domain_id）  
- [ ] 扩展 industry_routing / domain_anchor（meeting、classroom、cafe→restaurant 等）  
- [ ] 不改表结构（P2 承诺）  

### 9.4 测试 / 合约

- [ ] `freeze-contract.test.ts` 增加 P2 边界用例  
- [ ] Dialog200：Recall Width / Builder count / KenLM query **不变**  
- [ ] 样本：烧饼/哨兵/角马/筋斗 排名或过滤 observability  
- [ ] 回归：Builder 空组合 = 0；Recall 空洞 = 0  

### 9.5 明确不做（补充）

- [ ] 不修改 `toneDistance` 主排序逻辑（Tone 非主方案）  
- [ ] 不解决 jin|dou vs jin|du 类 **拼音键不一致**  
- [ ] 不解决 span 已是正确词仍进 FW（如 评审）  
- [ ] 不引入 session topic lock / CPU LLM 同步阻塞  
- [ ] 不修改 `perSpanCandidateLimit` / `maxSentenceCandidates` / KenLM gate 参数  

---

## 10. 与 PreDev 审计的差异摘要

| PreDev 审计 | P2 方案 | 本清单建议 |
|-------------|---------|------------|
| 推荐 orchestrator 或 pipeline 入口推断 | pipeline 入口 | ✅ 一致；**补充** HintGate 不适用 |
| subdomain/cluster Phase 3 | Phase 3 | ✅ 一致 |
| base_safe 必须 | 有 | **补充** repair_target 与 Apply 关系 |
| 词库重建必须 | 仅 source 约定 | **补充** patch-v3 路径 + domain 表仅 25 行事实 |
| scenario 映射缺失 | 未写 | **必须补** |

---

**清单完成。本文档仅补充约束与信息，不代表 P2 方案已修订。**
