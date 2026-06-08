# Weak Domain Priority + Fuzzy Span Recall 开发前审计报告

**日期：** 2026-06-07  
**类型：** 只读开发前代码审计（无代码变更、无补丁、无开发）  
**依据文档：** [Weak Domain Priority + Fuzzy Span Recall 开发前审计（只读）.md](./Weak%20Domain%20Priority%20+%20Fuzzy%20Span%20Recall%20开发前审计（只读）.md)

**关联：** [FW_Quality_Post_LocalRawImeDiff_Audit_2026_06_07.md](./FW_Quality_Post_LocalRawImeDiff_Audit_2026_06_07.md) · [Lexicon_Tone_Apply0_Root_Cause_Audit_2026_06_07.md](./Lexicon_Tone_Apply0_Root_Cause_Audit_2026_06_07.md)

**原始数据：**
- `tests/experiments/_weak-domain-fuzzy-recall-audit-sim.json`
- `tests/experiments/_cafe_sqlite_probe.json`
- `tests/experiments/_fw-quality-post-local-raw-ime-diff-audit-data.json`

---

## 执行摘要（十问十答）

| # | 问题 | 结论 |
|---|------|------|
| 1 | weak domain priority 是否已存在？ | **否**。代码库无 `weakDomain*` 实现；仅有 **strong** domain routing（profile primary / industry routing） |
| 2 | 为何 general 时 domain_hits=0？ | `resolveDomainIdsForRecall()` 对 `general` 返回 `[]`；`useIndustryRouting=false`（默认）→ 不查 `domain_lexicon` |
| 3 | 是否应恢复 all-domain weak recall？ | **应新建**（非恢复）。最小切入点：`local-span-recall.ts` → `resolveRecallDomainIds()` + `domain-boost-calculator.ts` 增加 weak weight |
| 4 | fuzzy span recall 是否适合 Recall 层？ | **是**。Proposal/Normalizer 已冻结；边界偏移应在 Recall 入口做 **有限 variant**，不回到 Proposal |
| 5 | d001/d002/d003 能否 weak+fuzzy 召回？ | **d001 部分可以**；**d002/d003 部分可以**；**少冰为词库缺口** |
| 6 | 简称/alias 当前是否支持？ | **部分支持**：domain 表 16 条物化 alias；无 `shortName`/`abbr` 字段 |
| 7 | 是否需要新增 alias 数据结构？ | **P1 不必**；现有 `aliases`+物化行可覆盖同音 ASR；**简称（蓝莓→蓝莓马芬）需 P2 phrase 扩展或 n-gram variant** |
| 8 | 风险与性能？ | 跨域污染 **可控**（repair_target + KenLM）；Recall SQL 约 **×5–×20** 查询量，需 cap |
| 9 | 最小开发方案？ | 见 §十四；**仅改 Recall 层 + diagnostics**，不动 Proposal/Tone/KenLM/Apply |
| 10 | 验收 checklist？ | 见 §十六 |

---

## 一、调用链（当前实现）

```
selected span (fw_detector.spans[].text)
  → fw-sentence-rerank-pipeline.ts :: recallSpanTopK(span, profile, perSpanLimit, ...)
      → local-span-recall.ts :: resolveRecallDomainIds(profile, enabledDomains)
          → [default] domain-recall-merge.ts :: resolveDomainIdsForRecall()
          → [optional] industry-routing-domain-resolver.ts :: resolveRecallDomains()
      → recall-span-topk-v2.ts :: collectTierCandidates()
          → lexicon-runtime-v2.ts :: lookupBaseByPinyinKey(key, termLength)
          → lookupDomainByPinyinKey(domainId, key, termLength)  // domainIds=[] 时跳过
          → merge-span-candidates.ts :: mergeSpanCandidatesCombined(limit, hasActiveDomain)
      → candidate-score + domain-boost-calculator.ts :: computeDomainBoost()
      → tone-recall-sort.ts :: sortRecallHitsByToneCompatibility()
  → build-sentence-candidates.ts :: buildSentenceCandidates(maxSentenceCandidates=16)
  → rerank-fw-sentences.ts :: rerankFwSentences(minDeltaToReplace=0.03)
  → apply-span-replacements.ts :: applyFwSpanReplacements()
```

**关键事实：** Recall **仅按 whole-span 的 `pinyin_key` + `length(word)=span.length` 精确查桶**；无 fuzzy variant；general profile 下 **domain tier 为空**。

---

## 二、Weak Domain Priority 审计

### 2.1 为何 `primaryDomain=general` → `domainIds=[]`？

```16:20:electron_node/electron-node/main/src/lexicon-v2/domain-recall-merge.ts
export function resolveDomainIdsForRecall(profile: ActiveLexiconProfileSnapshot): string[] {
  const primary = profile.primaryDomain?.trim();
  if (!primary || primary === 'general' || !isValidLLMDomain(primary)) {
    return [];
  }
```

- `general`、空、非法 domain → **显式返回空数组**
- 单测/设计意图：**general = base_only**
- `recall-span-topk-v2.ts` 诊断：`active_domain: domainIds.length ? join : 'base_only'`

### 2.2 历史 weak domain / all-domain weak recall 是否存在？

| 搜索项 | 结果 |
|--------|------|
| `weakDomain` / `weak_domain` / `allDomain` | **仅存在于审计/方案文档**，无 TS 实现 |
| `useIndustryRouting` | **存在**，默认 `false` |

```4:8:electron_node/electron-node/main/src/lexicon-v2/lexicon-fw-recall-config.ts
export function isIndustryRoutingEnabled(): boolean {
  if (!isLexiconRuntimeV2Enabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.fwDetector?.useIndustryRouting === true;
}
```

**Industry routing 开启时**（非 weak）：`primaryDomain=general` 可 fallback 到 **全部 `enabledDomains` 并集**（strong union，非降权 weak）。

**dialog_200 未启用原因：** 批测 payload 无 profile 注入 + `useIndustryRouting=false` → 永远走 `resolveDomainIdsForRecall` → `[]`。

### 2.3 最小恢复点

| 函数 | 职责 |
|------|------|
| `local-span-recall.ts` :: `resolveRecallDomainIds()` | 在 general 时返回 `enabledDomains`（weak 模式） |
| `domain-boost-calculator.ts` :: `profileWeight()` | 新增 `WEAK_DOMAIN_WEIGHT`（如 0.15–0.25 × PRIMARY） |
| `merge-span-candidates.ts` | weak domain 候选仍走 domain tier，靠 **domainBoost 降权** 排序 |
| `recall-span-topk-v2.ts` | diagnostics：`weakDomainEnabled`、`domainHitsAfterWeak` |

### 2.4 `enabledDomains` 来源

- 默认：`fw-config.ts` → `['tech_ai','travel','transport','restaurant']`
- 运行时：orchestrator 可 `fwDetectorEnabledDomainsOverride`
- 合法性：`profile-registry.json` whitelist + `isValidLLMDomain()`

**可安全获得全部合法 domain：** 是，通过 registry + enabledDomains 并集；无需 LLM。

### 2.5 当前 domain boost / 降权

```7:11:electron_node/electron-node/main/src/lexicon/domain-boost-calculator.ts
export const DOMAIN_BASE = 0.12;
export const DOMAIN_BOOST_MAX = 0.2;
export const PRIMARY_WEIGHT = 1.0;
export const SECONDARY_WEIGHT = 0.5;
export const GENERAL_WEIGHT = 0.0;
```

- primary domain hotword：`boost ≈ 0.12`
- secondary：`≈ 0.06`
- 其他 / general profile 下带 domain 标签的词：`GENERAL_WEIGHT=0` → **boost=0**（但当前 general 根本不查 domain）
- **无 weak domain penalty 字段**；无 fuzzy penalty

### 2.6 行为矩阵

| primaryDomain | 当前 domainIds（routing **off**） | 当前查 domain | 当前 boost | 目标 domainIds | 目标权重 |
|---------------|-----------------------------------|---------------|------------|----------------|----------|
| **general** | `[]` | **否** | 0 | all enabled domains | **weak (low)** |
| **null/unknown** | `[]` | **否** | 0 | all enabled domains | **weak** |
| **restaurant** | `[restaurant, …secondary]` | **是** | primary 0.12 | restaurant **strong** + others **weak** | mixed |
| **medical**（若启用） | `[medical, …]` 或 `[]` | 视 registry | — | medical strong + others weak | mixed |

| primaryDomain | routing **on**，general，无 session intent | 当前行为 |
|---------------|------------------------------------------|----------|
| general | fallback `enabled_domains` 全并集 | **strong union**（非 weak，与目标 A 不同） |

---

## 三、Weak Domain 策略评估

| 策略 | 命中收益 | 误召回风险 | 性能风险 | 是否推荐 |
|------|----------|------------|----------|----------|
| **1. general 查 all enabled domains + 统一降权** | **高**（餐饮 d001 等 domain 词进池） | 中（跨域词入候选） | 中（×4 domain SQL/span） | **✅ 推荐（P0）** |
| **2. primary 明确时 strong + weak** | 高（场景精确） | 低–中 | 中 | **✅ 推荐（与 1 组合）** |
| **3. 仅 repair_target=true 参与 weak** | 中（降噪） | **低** | 低 | **✅ 推荐（过滤条件）** |

**组合建议：** 策略 **1+2+3**：general → all enabled weak；restaurant → restaurant strong + others weak；SQL 过滤 `repair_target=1 AND enabled=1`。

---

## 四、Fuzzy Span Recall 审计

### 4.1 当前查询方式

- **仅 whole-span 精确 `pinyin_key`**
- `termLength = span.text.length`；`syllables.length` 必须在 2–5
- **无**首尾裁剪、无功能词剥离、无 n-gram variant
- `FORBIDDEN_WINDOW_CANDIDATE_SOURCES` 含 `fuzzy_observed` → 产品层 **禁止 fuzzy source 但未实现合法 fuzzy 路径**

### 4.2 实际边界偏移（批测）

| span | 期望修复 | 当前 batch recall |
|------|----------|-------------------|
| 钟贝少 | 中杯 | **[]**（3 字桶无 domain 行） |
| 有蓝美马分 | 蓝莓马芬 | **[]**（5 字桶无匹配） |
| 做一杯美食 | 美式 | **[]** |
| 悲就行谢谢 | 大杯 | **[]** |
| 赶时间小背 | 小杯 | **[]** |

### 4.3 Fuzzy variant 原则评估

| 机制 | 可行性 | 备注 |
|------|--------|------|
| **7.1 首尾裁剪 ≤4 variants** | ✅ | `钟贝少→钟贝` 可命中 `zhong\|bei` |
| **7.2 首尾功能词剥离** | ✅ 谨慎 | `有蓝美马分→蓝美马分`；`悲就行谢谢` 不宜剥到单字 `悲` |
| **7.3 n-gram 实义片段** | ⚠ 限长 span | `做一杯美食→美食`（需功能词表含 做/一/杯） |
| **7.4 alias** | ✅ 已有 | 物化 alias 进同拼音桶；不替代 fuzzy |

**功能词表建议（首尾剥离）：**  
适合：`有/做/一/杯/请/帮/我/就/行/谢谢/赶/时间`  
不适合入表作剥离：`深/温/少/糖`（易误删实义）

### 4.4 查询方式选型

| 方式 | 评估 | 推荐 |
|------|------|------|
| **A. variant 后复用 recallSpanTopK** | 最少改动；可控 cap；复用 merge/tone/KenLM | **✅ 首选** |
| **B. SQL LIKE / edit distance** | 性能不可控 | **❌ 禁止** |
| **C. precomputed alias / search key** | 适合固定简称 | **P2 可选**（非 P0） |

---

## 五、候选 source 与权重

### 5.1 当前 source 类型

```5:10:electron_node/electron-node/main/src/lexicon/window-candidate-source.ts
export const V3_WINDOW_CANDIDATE_SOURCES = [
  'lexicon_pinyin_topk',
  'canonical_exact',
  'alias_exact',
  'alias_pinyin',
] as const;
```

**不支持：** `exact_domain_strong` / `exact_domain_weak` / `fuzzy_*` / `alias_domain` 细分。

**最小扩展建议（Recall diagnostics + internal tag，不必改 V3 冻结 enum 可先走 breakdown JSON）：**

| candidate source | 建议 priority/penalty | 理由 |
|------------------|----------------------|------|
| exact_base | 0 | 现状 |
| exact_domain_strong | +domainBoost (0.12) | primary domain |
| exact_domain_weak | +weakBoost (0.03–0.06) | general 下 all-domain |
| fuzzy_base | −0.05~−0.10 | 边界偏移惩罚 |
| fuzzy_domain_weak | −0.08~−0.12 | fuzzy + weak 叠加 |
| alias_domain | alias 物化行 prior 已高 | 钟贝→中杯 alias 行 |

当前 `computeCandidateScoreBreakdown` **可表达 domainBoost**；**不能表达 fuzzy penalty** → 建议 `fuzzyPenalty` 字段入 breakdown（仅 Recall 层）。

---

## 六、候选数量控制

| Cap | 当前值 | 位置 |
|-----|--------|------|
| perSpanLimit | 1 span→**8**, 2→**4**, 3+→**2** | `per-span-candidate-limit.ts` |
| SQL prefetch | `max(perSpanLimit, 8)` | `recall-span-topk-v2.ts` |
| maxDomainCandidates（legacy） | **3** | `lexicon-runtime-v2-config` |
| maxSentenceCandidates | **16** | `fw-config.ts` |
| maxFuzzyVariantsPerSpan | **不存在** | 建议 **≤4** |
| maxWeakDomainCandidatesPerSpan | **不存在** | 建议 **≤4** |

**Fuzzy + weak 后 cap 建议（冻结架构内）：**

```text
maxFuzzyVariantsPerSpan <= 4
maxFuzzyCandidatesPerVariant <= 2   // merge 后再 dedupe
maxWeakDomainCandidatesPerSpan <= 4
perSpanLimit 不变（8/4/2）
maxSentenceCandidates 不变（16）
```

**KenLM 长尾：** 仅当 recall 命中增加时 combination 才增；`buildSentenceCandidates` 已有 16 硬顶。

---

## 七、d001 / d002 / d003 专项模拟

> 模拟方法：SQLite 桶查询 + §7 有限 fuzzy variant + weak all-domain；对照 general（base_only）。

### 7.1 d001

| span | fuzzy variants | general recall | weak domain recall | expected hit |
|------|----------------|----------------|--------------------|--------------|
| 钟贝少 | 钟贝少, 贝少, **钟贝** | [] / 焙烧 / [] | [] / 焙烧 / **中杯,终杯,钟贝,忠贝** | **钟贝→中杯 ✅** |
| 深便 | 深便 | 身边, 申辩 | 同左 | **顺便 ❌**（同音不同键） |
| 有蓝美马分 | 有蓝美马分, **蓝美马分**, 有蓝美马, 蓝美马 | [] | **蓝美马分→蓝莓马芬,兰梅马芬** | **蓝美马分→蓝莓马芬 ✅** |

### 7.2 d002

| span | fuzzy variants（建议） | general | weak domain | expected hit |
|------|------------------------|---------|-------------|--------------|
| 做一杯美食 | 做一杯美食, **一杯美食**, **美食** | 美食桶: 美食,没事,**美式**(#3) | weak: **美式 #1** | **美食→美式 ✅**（需剥 做/一/杯） |
| 悲就行谢谢 | 悲就行谢谢, 就行谢谢, **大悲**（谨慎 n-gram） | 大悲在 base | weak: **大杯 #1** | **大悲→大杯 ✅**（需 2 字片段 大悲） |

> 自动化 sim 对 d002 未预置 `美食`/`大悲` 拼音键，故 JSON 中显示 miss；**手工桶查询**（`_cafe_sqlite_probe.json`）确认命中。

### 7.3 d003

| span | fuzzy variants | general | weak domain | expected hit |
|------|----------------|---------|-------------|--------------|
| 燕麦 | 燕麦 | 掩埋 | 掩埋 | N/A（非 repair 目标） |
| 少病 | 少病 | 烧饼, 哨兵 | 同左 | **少冰 ❌ 词库缺失** |
| 赶时间小背 | 赶时间小背, 时间小背, **小背** | 小背桶: 小辈,**小杯**,… | weak: **小杯 #1** | **小背→小杯 ✅**（需剥 赶时间） |

**§十六 验收对照：**

| 验收项 | 模拟结论 |
|--------|----------|
| 钟贝少→中杯 | ✅ 通过 variant **钟贝** + weak domain |
| 有蓝美马分→蓝莓马芬 | ✅ 通过 variant **蓝美马分** + weak domain |
| 做一杯美食→美式 | ✅ 通过 variant **美食** + weak domain |
| 悲就行谢谢→大杯 | ✅ 通过 variant **大悲** + weak domain |
| 赶时间小背→小杯 | ✅ 通过 variant **小背** + weak domain |
| 少病→少冰 | ❌ **lexicon coverage issue**（DB 无少冰） |

---

## 八、跨场景风险模拟

| 场景 | 原 span | weak+fuzzy 可能候选 | 风险等级 | KenLM 大概率拒绝？ |
|------|---------|----------------------|----------|-------------------|
| hospital | 歇常規 | base 医疗词 | low | 是（句级 delta） |
| hospital | 请家休息 | base 同音 | low | 是 |
| bank | 传中 | base 同音 | low | 是 |
| tech_deploy | 后选生 | base/tech 词 | low | 是 |
| friend | 义气 | base 同音 | low | 是 |
| cafe | 钟贝 | restaurant 中杯 | low（场景匹配） | 视句级上下文 |

**餐饮词污染医院：** weak recall 开启后，**仅当 span 拼音桶与餐饮词同键** 时才共桶（如 `zhong|bei`）；污染面 **可控**。`repair_target=1` + **KenLM minDelta=0.03** 仍为第二道闸。

---

## 九、性能审计

| 指标 | 当前（dialog_200 批测） | 预计 weak+fuzzy 后 | 风险 |
|------|-------------------------|-------------------|------|
| Recall avg | **1.4 ms** | **2–4 ms** | 低 |
| Recall p95 | **4 ms** | **8–12 ms** | 低–中 |
| SQL queries/span | 1 base + 0 domain | 1 base + **≤4 domains × ≤4 variants** | 中（需 cap） |
| KenLM combination | 52 案查询；max 16 | 仅 recall 命中增加时上升；**cap 不变** | 中 |
| KenLM batch p95 | **10766 ms**（52 案） | 略增 | 中 |

**不能让候选爆炸：** 必须 **variant≤4 × weak domain SQL limit≤4 × perSpanLimit 不变**。

---

## 十、简称 / alias 审计

### 10.1 词库结构

| 项 | 状态 |
|----|------|
| 独立 alias / abbreviation / phrase 表 | **无** |
| `aliases` JSON 列 + `is_alias=1` 物化行 | **有**（domain 16 条） |
| `shortName` / `abbr` / `alias_pinyin_key` | **无** |
| 餐饮 canonical | 中杯/大杯/小杯/美式/蓝莓马芬 等 + 同音 alias |

**物化 alias 示例：** `钟贝` → canonical `中杯`（同 `zhong|bei` 桶）

### 10.2 简称场景

| 用户说法 | 词库 | fuzzy/alias 路径 |
|----------|------|------------------|
| 蓝莓（指蓝莓马芬） | 有 `蓝莓` canonical + alias `兰梅` | weak domain 可召回 **蓝莓**；整句替换需 phrase 级 KenLM |
| 卡布→卡布奇诺 | 未审计到 domain 行 | **P2 词库或 phrase alias** |
| 短信→短信提醒 | base 可能有 | base weak recall 即可 |

**是否需要新增 alias 数据结构？**  
- **P0：否** — 同音 ASR 用现有物化 alias + fuzzy trim  
- **P2：可选** — phrase 简称表（`alias_text → canonical_word`）  

---

## 十一、最小开发方案建议（不实施，仅建议）

### 11.1 Weak Domain Priority — **新建**（非恢复历史 flag）

1. 在 `resolveRecallDomainIds()` 增加模式：
   - `general` → `enabledDomains`（filtered by registry）
   - `restaurant` → `[restaurant, …others as weak]`
2. 在 `domain-boost-calculator.ts` 增加 `WEAK_DOMAIN_WEIGHT`（如 0.2 × PRIMARY）
3. `merge-span-candidates.ts`：weak 候选仍进 domain tier，靠 **低 domainBoost** 排序
4. Feature flag：`features.fwDetector.weakDomainRecallEnabled`（默认 false → 灰度）

### 11.2 Fuzzy Span Recall — **放在 Recall 层**

1. 新模块 `fuzzy-span-variants.ts`（或 `local-span-recall.ts` 内联）
2. 生成 ≤4 variants：首尾裁剪 + 首尾功能词剥离 + 长 span 2–4 字 n-gram
3. 对每个 variant 调用现有 `recallSpanTopKV2`；merge dedupe；施加 `fuzzyPenalty`
4. **禁止** SQL LIKE；**禁止** 改 Proposal/Normalizer

### 11.3 alias — **P0 不新建表**

- 继续用物化 alias 行
- diagnostics 记录 `alias_pinyin` 命中

### 11.4 需修改文件（最小集）

| 文件 | 变更 |
|------|------|
| `local-span-recall.ts` | weak domainIds + fuzzy orchestration |
| `domain-boost-calculator.ts` | weak weight |
| `recall-span-topk-v2.ts` | fuzzy penalty in score; diagnostics |
| `recall-v2-diagnostics.ts` | 新字段 |
| `lexicon-fw-recall-config.ts` | feature flags |
| （可选）`candidate-score.ts` | `fuzzyPenalty` in breakdown |

**不改：** Proposal / Normalizer / SpanSelector / ToneModule / KenLM / Apply

### 11.5 建议 diagnostics

```typescript
weakDomainEnabled: boolean
weakDomainIds: string[]
weakDomainCandidateCount: number
fuzzyRecallEnabled: boolean
fuzzyVariantCount: number
fuzzyCandidateCount: number
fuzzyVariantExamples: string[]
candidateSourceBreakdown: Record<string, number>
recallEmptyBeforeFuzzy: boolean
recallEmptyAfterFuzzy: boolean
domainHitsBeforeWeak: number
domainHitsAfterWeak: number
```

### 11.6 冻结架构保证

- 所有新候选仍走 **Tone sort → buildSentenceCandidates → KenLM → Apply**
- 无 LLM；无 bypass
- `maxSentenceCandidates=16` 不变

### 11.7 验收标准（开发后）

1. contract PASS 200/200  
2. general 时 `domain_hits > 0`  
3. cafe Recall TopK 命中 > 0  
4. d001：`钟贝` variant → 中杯；`蓝美马分` → 蓝莓马芬  
5. d002：`美食` → 美式；`大悲` → 大杯  
6. d003：`小背` → 小杯  
7. **少冰** 报告 lexicon gap（补词库或接受 miss）  
8. candidate 数不爆炸  
9. KenLM / Apply 逻辑不改  
10. Apply 不要求立即 >0，但 KenLM 句级候选应增加  

---

## 十二、Target List & Checklist

### P0 开发 target list

- [ ] `weakDomainRecallEnabled` flag + general → all enabled weak  
- [ ] `WEAK_DOMAIN_WEIGHT` in domain boost  
- [ ] `generateFuzzySpanVariants()` ≤4 variants  
- [ ] Recall merge + fuzzy penalty  
- [ ] diagnostics 字段落地  
- [ ] dialog_200 餐饮子集复测  

### P1

- [ ] `restaurant` strong + others weak 混合权重  
- [ ] `repair_target=1` 过滤 weak 候选  

### P2（可选）

- [ ] phrase 简称 alias 表 / seed  
- [ ] 词库补 **少冰**  

### 明确不做

- [ ] 改 Proposal / Normalizer / SpanSelector  
- [ ] 改 ToneModule / KenLM / Apply  
- [ ] SQL LIKE 全库扫描  
- [ ] LLM domain 选择  

---

## 十三、结论

Local Raw-IME Diff 已把 FW 触达提升到 158/200，但 **Recall 层在 general profile 下刻意关闭 domain_lexicon**，且 **仅 whole-span 精确查桶**，导致餐饮等高 prior domain 词 **离线路径存在、运行路径为空**。

**Weak Domain Priority** 与 **Fuzzy Span Recall** 是下一阶段的 **最小、可冻结、Recall-only** 补齐方案：  
- 前者解决 **domain_hits=0**  
- 后者解决 **span 边界偏移**  
- 二者均 **不绕过 Tone/KenLM/Apply**

**建议优先级：** 先 **Weak Domain + fuzzy trim（P0）**，再 **词库补少冰 + 简称（P2）**，KenLM 阈值调整 **仅在 Recall 打通后** 再评估。

---

**审计约束确认：** 只读；未修改产品代码；未提交补丁；未开发。
