# Weak Domain Priority + Fuzzy Span Recall — 开发方案补充清单

**日期：** 2026-06-07  
**对照方案：** [Weak Domain Priority + Fuzzy Span Recall 开发方案（冻结版 V1.0）.md](./Weak%20Domain%20Priority%20+%20Fuzzy%20Span%20Recall%20开发方案（冻结版%20V1.0）.md)（正文标注 **V1.1**）  
**对照审计：** [Weak_Domain_Priority_Fuzzy_Recall_Audit_2026_06_07.md](./Weak_Domain_Priority_Fuzzy_Recall_Audit_2026_06_07.md)  
**性质：** 只读对照清单（非开发、非补丁）

---

## 使用说明

本清单用于开发启动前 **查漏补缺**：方案 V1.1 已明确「**Fuzzy 作用对象是 pinyin/tone key，不是中文字裁剪**」，但代码现状、索引能力、打分门控与批测环境存在多处 **方案未写清或需额外约束** 的点。开发时应逐条勾选。

---

## 一、文档版本与术语对齐（必须先读）

| # | 项 | 方案说法 | 代码/审计事实 | 补充要求 |
|---|-----|----------|---------------|----------|
| D1 | 文件名 vs 版本 | 文件名 **V1.0**，正文 **V1.1** | 内容以 V1.1 为准 | 开发 SSOT 以 **V1.1 正文** 为准；V1.0 仅文件名 |
| D2 | Fuzzy 对象 | **Fuzzy Pinyin Key**（音节 trim） | 当前 Recall 仅 `pinyin_key` + `length(word)=termLength` 精确查桶 | **禁止** 在 Recall 做中文字符裁剪（V1.1 §一已修正） |
| D3 | 开发前审计 sim | 审计脚本 `_weak-domain-fuzzy-recall-audit-sim.py` 曾用 **汉字 variant** | 与 V1.1 **不一致** | 验收模拟须改为 **音节级 variant**；汉字 sim 仅作历史参考 |
| D4 | `lookupTonePinyinKey()` | 方案 §七、§十 第一层 tone 精确查 | **代码不存在**；runtime 仅有 `lookupBaseByPinyinKey` / `lookupDomainByPinyinKey`（均按 **`pinyin_key` 索引**） | P0 需明确：先 **plain key variant**，或同步新增 tone 索引 API（见 C1） |

---

## 二、代码现状快照（方案隐含前提）

| # | 模块 | 当前行为 | 方案目标 | 差距 |
|---|------|----------|----------|------|
| C1 | `domain-recall-merge.ts` | `general` → `domainIds=[]` | all enabled weak | **需新建** weak 分支 |
| C2 | `lexicon-fw-recall-config.ts` | 仅有 `useIndustryRouting` | `weakDomainRecallEnabled` | **flag 未定义** |
| C3 | `domain-boost-calculator.ts` | `GENERAL_WEIGHT=0`；无 `WEAK_DOMAIN_WEIGHT` | `WEAK_DOMAIN_WEIGHT=0.2` | **需新增** |
| C4 | `recall-span-topk-v2.ts` | 单次 `syllablesKey(span)` 查桶 | 多 variant 查桶 + merge | **需 orchestration** |
| C5 | `scoreHotword()` | `hotword.word.length !== syllables.length` → 丢弃 | fuzzy trim 后 syllable 数变化 | variant 查询须用 **variant 音节数** 作 `termLength`（见 C6） |
| C6 | SQL 查桶 | `(pinyin_key, length(word))` 联合索引 | variant 2 音节查 2 字词 | trim 后 **termLength = variantSyllables.length**，非原 span 字数 |
| C7 | `CandidateScoreBreakdown` | 无 `fuzzyPenalty` | 有 fuzzy 惩罚项 | 需扩展 `candidate-score.ts`（方案未列入允许修改文件，见 §四） |
| C8 | `WindowCandidateSource` | 冻结 4 值；**禁止** `fuzzy_observed` | 6 类 `candidateSource` | 对外仍用 V3 source；**内部分 breakdown**（见 C9） |
| C9 | `fw-sentence-rerank-pipeline` | `hitToSpanCandidate` 写死 `domains:[]`, `domainMatched:false` | 可选增强 | P0 可不改；diagnostics 以 Recall 层为准 |
| C10 | 物化 alias | domain 表 16 条 `is_alias=1`（如 钟贝→中杯） | P0 不新表 | weak domain 开启后 **同桶可命中**；无需 alias 表 |

---

## 三、需补充的信息（方案应写清的事实）

### 3.1 Weak Domain

| # | 补充信息 | 来源 |
|---|----------|------|
| I1 | **`enabledDomains` 默认仅 4 域**：`tech_ai, travel, transport, restaurant`（`fw-config.ts`），**不含** `medical` / `meeting` | 方案矩阵中的 `medical strong` 需 profile+registry+enabledDomains 三处同时成立 |
| I2 | **`useIndustryRouting` 默认 false**；若 true 且 general，会 fallback 到 **全 enabledDomains 强并集**（非 weak） | 与 weak 模式 **语义冲突**，需互斥策略（见 R1） |
| I3 | **`candidateRequireRepairTarget=true`**（freeze-contract） | weak/fuzzy 候选须仍满足 `repair_target=1`（餐饮 domain 词已满足） |
| I4 | **`minPrior=0.5`** | domain 餐饮词 prior 0.95+ 无问题；base 美式 prior 0.6 边界通过 |
| I5 | **`minCandidateScore`**（quality-config，默认约 0.5 级） | fuzzy 候选扣分后须仍 ≥ minCandidateScore，否则 silent drop |
| I6 | **`maxIdiomCandidates=0`**（默认） | 方案写「base+idiom+all domains weak」；当前 **idiom tier 默认关闭** |
| I7 | dialog_200 批测 **`primaryDomain=general` 200/200**，无 restaurant profile 注入 | weak domain 的价值是 **不改批测 payload 也能 domain_hits>0** |
| I8 | domain_lexicon 仅 **25 行**（9 canonical + 16 alias），全 restaurant | weak all-domain 主要释放这 25 行 + base 同键词 |

### 3.2 Fuzzy Pinyin

| # | 补充信息 | 来源 |
|---|----------|------|
| I9 | **`recallSpanTopK` 入口门控**：span 音节数须在 **2–5**（`local-span-recall.ts`） | 超长 span 在 fuzzy 之前即 `syllable_out_of_range` |
| I10 | **`exactLengthBonus=0.5`** 仅当 `windowText.length === hotword.word.length` | fuzzy 命中（如 钟贝少→中杯）**天然无** exactLengthBonus；依赖 fuzzyPenalty 设计 |
| I11 | **`editDistancePenalty`** 按 **整段 span 文本** vs candidate 计算 | trim 后 candidate 与 span 字长不同，penalty 可能偏大；应用 **variant 子串** 或 skip penalty for fuzzy（方案未写） |
| I12 | **Tone 排序**用整段 `acousticTonePattern`（`sortRecallHitsByToneCompatibility`） | variant 音节变短时，应 **`acousticTonePattern.slice(0, variantSyllableLen)`** 对齐（方案未写） |
| I13 | 已有 **`recallFuzzyPinyinMaxSyllableDelta`**（`quality-config`，默认 2） | 属 **legacy ASR repair** 路径，**非** FW `recallSpanTopK`；勿混用 |
| I14 | **`tone_pinyin_key` 列存在于 DB**，但 **无 tone_key 索引查询 API** | 方案「第一层 tone 精确」不能原样落地，除非扩展 runtime（见 C1） |

### 3.3 词库与验收

| # | 补充信息 | 来源 |
|---|----------|------|
| I15 | **`少冰` 不在 v3 SQLite** | d003「少病→少冰」**无法**靠 Recall 单独解决；验收须单列 **lexicon coverage** |
| I16 | d002「悲就行谢谢→大杯」需 **音节 trim 得到 `da|bei`（2 音节）** | 不是汉字「大悲」子串；V1.1 应用 pinyin trim |
| I17 | d002「做一杯美食→美式」需 trim 到 **`mei|shi`（2 音节）** | 功能音节剥离在 **音节层**（zuo/yi/bei/mei/shi），非删「做一杯」汉字 |
| I18 | KenLM **仍 apply=0** 不阻塞本阶段验收 | 方案 §十九：下一阶段才验证真实替换；本阶段 **Recall TopK + domain_hits** 为主 |

---

## 四、需补充的约束（开发时必须遵守）

### 4.1 架构冻结（方案 §三 增补）

| # | 约束 | 说明 |
|---|------|------|
| R1 | **weakDomain 与 useIndustryRouting 互斥** | 建议：`weakDomainRecallEnabled=true` 时 **忽略** industry routing，或 routing 仅负责 strong primary、weak 单独路径；**禁止** general 下双路径叠加导致 domain 查 8 次且无降权 |
| R2 | **禁止修改** | Proposal / LocalRawImeDiff / Normalizer / SpanSelector / ToneModule / KenLM / Apply（方案已列，含 LocalRawImeDiff） |
| R3 | **禁止** SQL LIKE / 全表扫描 | 方案 §八 已列；variant 仅离散 key 列表 |
| R4 | **禁止** 使用 `fuzzy_observed` 等 FORBIDDEN source | `window-candidate-source.ts` 冻结；新 fuzzy 走 internal breakdown + 现有 `lexicon_pinyin_topk` / `alias_pinyin` |
| R5 | **`maxSentenceCandidates=16` 不变** | fuzzy 只增 per-span 候选，句级组合仍硬顶 |
| R6 | **`perSpanLimit` 8/4/2 不变** | variant 命中 merge 后仍受 combined cap |
| R7 | variant 数 **≤4**；每 variant SQL limit **≤2–4** | 防止候选/SQL 爆炸（方案 §十、审计 §六） |
| R8 | **仅首尾音节 trim / 功能音节剥离** | 禁止中间删音节、禁止重排（方案 §九） |
| R9 | fuzzy 候选 **不得 bypass** Tone → KenLM → Apply | 方案 §四 已列 |
| R10 | **repair_target=true** 过滤保持 | 与 freeze-contract 一致 |

### 4.2 实现约束（方案未写，代码强制）

| # | 约束 | 代码依据 |
|---|------|----------|
| R11 | 每个 variant 独立调用查桶：`key=syllablesKey(variantSyllables)`，`termLength=variantSyllables.length` | `scoreHotword` 字数=音节数；SQL `length(word)=termLength` |
| R12 | variant 音节数仍须在 **2–5** | `recall-span-topk-v2` / `local-span-recall` 门控 |
| R13 | weak domain 时 `hasActiveDomain=true`（`domainIds.length>0`） | `merge-span-candidates` 顺序变为 **domain>alias>base** |
| R14 | weak 候选 domainBoost 用 **`WEAK_DOMAIN_WEIGHT * DOMAIN_BASE`**，不得 ≥ primary strong | 防止 weak 压制 base（方案 §六 原则） |
| R15 | dedupe 按 **word** 去重，保留 **最高 candidateScore** 来源标记 | `mergeSpanCandidatesCombined` 已有 dedupeByWord |
| R16 | 功能音节表须 **冻结为常量文件**（如 `fuzzy-function-syllables.ts`） | 方案 §九 仅举例，无 SSOT 列表 |
| R17 | 功能音节识别在 **normalize 后音节** 上匹配（与 `textToSyllables` 一致） | 避免 you3 vs you 不一致 |

### 4.3 配置与灰度

| # | 约束 | 建议 |
|---|------|------|
| R18 | 新增 `features.fwDetector.weakDomainRecallEnabled`（默认 **false**） | 与 `useIndustryRouting` 并列写进 `node-config-types.ts` + defaults |
| R19 | 新增 `features.fwDetector.fuzzyPinyinRecallEnabled`（默认 **false**） | 可与 weak 独立灰度 |
| R20 | freeze-contract 测试须覆盖 **flag off → 行为与现网一致** | 现有 146+ fw-detector 测试 |

---

## 五、允许修改文件清单（方案 §三 补充）

方案允许列表 **不完整**，建议冻结为：

| 类别 | 文件 | 变更 |
|------|------|------|
| **方案已列** | `local-span-recall.ts` | weak domainIds + fuzzy orchestration |
| | `recall-span-topk-v2.ts` | 多 variant collect + fuzzyPenalty 输入 |
| | `domain-boost-calculator.ts` | `WEAK_DOMAIN_WEIGHT` + weak profileWeight |
| | `recall-v2-diagnostics.ts` | 扩展 diagnostics 字段 |
| | `lexicon-fw-recall-config.ts` | feature flags |
| | `fuzzy-pinyin-key-builder.ts`（新增） | variant 生成 |
| **建议补充** | `candidate-score.ts` | `fuzzyPenalty` + breakdown 字段 |
| | `domain-recall-merge.ts` 或新 `weak-domain-recall-resolver.ts` | weak domainIds 解析（避免全堆在 local-span-recall） |
| | `node-config-types.ts` / `node-config-defaults.ts` | 新 flag 类型与默认值 |
| | `recall-span-topk-v2.test.ts` / 新单测 | variant + weak 契约 |
| **P0 不改** | `merge-span-candidates.ts` | 若 R13 成立可不改逻辑 |
| | `fw-sentence-rerank-pipeline.ts` | KenLM 路径不变 |
| | `lexicon-runtime-v2.ts` | **除非**做 tone_key 索引（P1） |

---

## 六、方案策略 vs 代码能力对照

### 6.1 Weak Domain 矩阵（补充后）

| primaryDomain | 当前 domainIds | 当前查 domain | 目标（V1.1） | 代码注意 |
|---------------|------------------|---------------|--------------|----------|
| general | `[]` | 否 | all **enabledDomains** weak | 仅 4 域，非 registry 全 7 域 |
| null/invalid | `[]` | 否 | 同 general weak | 同 `resolveDomainIdsForRecall` 入口 |
| restaurant | `[restaurant]` | 是 | restaurant strong + others weak | secondary 已有 SECONDARY_WEIGHT |
| medical | `[]`（未 enabled） | 否 | medical strong + others weak | 需 **enabledDomains 含 medical** + profile |

### 6.2 Fuzzy 三层查询（方案 §十 vs 代码）

| 层级 | 方案 | P0 可行？ | 说明 |
|------|------|-----------|------|
| L1 tone exact | `tone_pinyin_key` 精确 | ⚠ **需新 API+索引** | 当前无 `lookupByTonePinyinKey` |
| L2 tone fuzzy | trim tone key | ⚠ 同 L1 或退化为 plain trim | 可先对 **plain syllables trim** 再查 |
| L3 plain pinyin | `zhong\|bei` | ✅ **直接复用** 现有 lookup | 与 V1.1 音节 trim 一致 |

**建议 P0 冻结：** 仅实现 **L3 plain key variant + optional L2 同步 plain**；L1 tone index 列为 **P1**。

### 6.3 候选 source 与 penalty（方案 §十一–§十二 补充）

| 内部 breakdown | 映射到 V3 `source` | fuzzyPenalty | domainBoost |
|----------------|-------------------|--------------|---------------|
| exact_base | `lexicon_pinyin_topk` | 0 | 0 |
| exact_domain_strong | `lexicon_pinyin_topk` | 0 | 0.12×1.0 |
| exact_domain_weak | `lexicon_pinyin_topk` | 0 | 0.12×0.2 |
| fuzzy_plain | `lexicon_pinyin_topk` | −0.08 | 0 |
| fuzzy_plain_domain_weak | `lexicon_pinyin_topk` | −0.10 | 0.12×0.2 |
| alias（物化行） | `alias_pinyin` | 0 | 按 domain |

---

## 七、d001 / d002 / d003 验收补充（V1.1 音节视角）

| 案例 | batch span | 目标 | P0 variant（音节） | 预期查桶 | 方案 checklist 补充 |
|------|------------|------|-------------------|----------|---------------------|
| d001 | 钟贝少 | 中杯 | trim_tail → `zhong\|bei` | domain weak → 中杯 | ✅ 方案已列 |
| d001 | 有蓝美马分 | 蓝莓马芬 | strip 功能音节 you + trim → `lan\|mei\|ma\|fen` | domain weak | ✅ |
| d001 | 深便 | 顺便 | plain 2 音节 **无同键** | base 身边/申辩 | ⚠ **应标为 non-goal** 或词库/ASR 问题，非 weak+fuzzy 范围 |
| d002 | 做一杯美食 | 美式 | trim 到 `mei\|shi`（2 音节） | weak domain 美式 #1 | 方案应写 **音节 trim** 非「美食」二字 |
| d002 | 悲就行谢谢 | 大杯 | trim 到 `da\|bei` | weak 大杯 #1 | 同上 |
| d003 | 赶时间小背 | 小杯 | trim 到 `xiao\|bei` | weak 小杯 #1 | ✅ |
| d003 | 少病 | 少冰 | 无 | **词库缺失** | ❌ 方案 checklist **须增**「少冰 coverage 例外」 |

---

## 八、性能与 cap 补充

| 指标 | 方案目标 | 补充约束 |
|------|----------|----------|
| Recall avg | < 5 ms | 4 variant × 4 domain × 2 tier ≈ **32 SQL/span** 上限；依赖 bucket LRU cache |
| Recall p95 | < 15 ms | KenLM 长尾不变（仅 recall 命中增才增 combination） |
| SQL | — | `sqlLimit = max(perSpanLimit, 8)` 现有逻辑会放大 prefetch；fuzzy 应用 **更小 per-variant limit（≤2）** |
| Cache | — | cache key 含 tier:key:termLength:limit；variant 倍增 miss，**可接受** |

---

## 九、Diagnostics 补充（方案 §十五 + 代码缺口）

方案字段均 **未存在于** `RecallSpanV2Diagnostics` / batch JSON，开发时需：

| 字段 | 挂载位置建议 |
|------|--------------|
| `weakDomainEnabled` / `weakDomainIds` | `recall-v2-diagnostics` per-span + fw_detector summary |
| `fuzzyRecallEnabled` / `fuzzyVariantCount` | 同上 |
| `fuzzyToneHitCount` / `fuzzyPlainHitCount` | 同上 |
| `candidateSourceBreakdown` | 同上（JSON object） |
| `recallEmptyBeforeFuzzy` / `AfterFuzzy` | 同上 |
| `domainHitsBeforeWeak` / `AfterWeak` | job-level 或 per-span |

**批测可读性：** 当前 `recallV2Diagnostics.spans[].active_domain=base_only`；验收 **general 时须变为非 base_only 或 weak 标记**。

---

## 十、与开发前审计文档的差异（须统一）

| 审计文档（06-07 只读） | V1.1 冻结方案 | 本清单结论 |
|------------------------|---------------|------------|
| Fuzzy = 汉字首尾裁剪 | Fuzzy = **音节 key** variant | **以 V1.1 为准**；重写 sim |
| 方式 A：variant 后复用 recallSpanTopK | 同 | ✅ 一致 |
| `lookupTonePinyinKey` 未审计 | 方案假设存在 | **P0 降级为 plain key** |
| ROI：B PrimaryDomain + span 边界 | Weak 在 Recall 内解决边界 | **不矛盾**：Proposal 边界仍不准，Recall fuzzy 补偿 |

---

## 十一、最小开发方案补充（在方案 §十四 之上）

### P0（必须）

- [ ] `weakDomainRecallEnabled` + general → enabledDomains weak boost  
- [ ] `fuzzyPinyinRecallEnabled` + `buildFuzzyToneKeyVariants()`（**plain key 实现即可**）  
- [ ] `fuzzyPenalty` in `candidate-score.ts`  
- [ ] variant 查桶：`termLength = variantSyllables.length`（**R11**）  
- [ ] `acousticTonePattern` 按 variant 长度 slice（**R12/I12**）  
- [ ] diagnostics 全套  
- [ ] freeze-contract：flag off 回归  
- [ ] dialog_200：`domain_hits>0`、cafe Recall TopK>0  

### P1（可选）

- [ ] `lookupByTonePinyinKey` + DB 索引  
- [ ] `useIndustryRouting` 与 weak 共存策略文档化  
- [ ] `editDistancePenalty` fuzzy 豁免或 variant windowText  

### P2（方案已列）

- [ ] alias 表 / 简称 phrase  
- [ ] 词库补 **少冰**  

### 明确不做

- [ ] 改 Proposal / Normalizer / SpanSelector / Tone / KenLM / Apply  
- [ ] LLM domain  
- [ ] 中文字 fuzzy  

---

## 十二、开发前 Checklist（汇总）

### 文档

- [ ] 确认 SSOT 为 V1.1 正文（非 V1.0 文件名）  
- [ ] 更新 sim 脚本为 **音节 variant**  
- [ ] 标注 d001 深便→顺便 **非 P0 目标**  
- [ ] 标注 d003 少冰 **lexicon gap**  

### 代码/design

- [ ] 互斥：`weakDomainRecallEnabled` vs `useIndustryRouting`（R1）  
- [ ] 扩展允许修改文件含 `candidate-score.ts`（§五）  
- [ ] P0 不做 tone_key SQL，仅 plain variant（§6.2）  
- [ ] 功能音节冻结表（R16）  
- [ ] variant scoring：termLength / tone slice / penalty（R11–R12, I11–I12）  
- [ ] 内部 source breakdown，对外 V3 source（R4, C8）  

### 测试

- [ ] contract 200/200  
- [ ] general `domain_hits > 0`  
- [ ] d001 钟贝少/有蓝美马分、d002、d003 小背（音节 sim）  
- [ ] 少冰 **预期失败** 记录在案  
- [ ] Recall avg/p95 方案阈值  
- [ ] flag off 零回归  

---

## 十三、结论

冻结方案 V1.1 **方向正确**（Recall-only、weak domain、fuzzy pinyin），但与当前代码相比仍需补充：

1. **无 `lookupTonePinyinKey`** → P0 应冻结为 **plain pinyin variant**  
2. **查桶 termLength 必须跟 variant 音节走** → 方案应显式写入  
3. **打分**：`exactLengthBonus` / `editDistancePenalty` / tone 对齐对 fuzzy 的影响未写  
4. **配置互斥**：weak vs industry routing  
5. **允许修改文件** 缺 `candidate-score.ts`、config types  
6. **验收**：少冰词库缺口、d001 深便 non-goal、批测无需改 profile  

完成本清单后再进入 vibe coding，可避免重复开发前审计中 **汉字 fuzzy** 的偏差，并防止 variant 查桶 **termLength 用错** 导致「方案通过、运行仍 recallEmpty」。

---

**约束确认：** 本文档为只读对照清单，未修改产品代码。
