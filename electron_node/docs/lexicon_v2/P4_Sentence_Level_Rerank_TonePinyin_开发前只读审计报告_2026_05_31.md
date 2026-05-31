# P4 Sentence-Level Rerank + Tone Pinyin — 开发前只读审计报告

**审计类型**：只读（未修改任何代码）  
**审计日期**：2026-05-31  
**依据方案**：`P4_Sentence_Level_Rerank_TonePinyin_方案与审计提示词_2026_05_31.md` §15  
**背景**：P3.3 Metadata Span Gate 已冻结；剩余问题为候选质量 + per-span greedy pick（24 apply / 14 degrade）

---

## 1. 执行摘要

| 维度 | 判定 |
|------|------|
| **per-span greedy → sentence rerank** | ✅ **可行**；最小接入点为替换/扩展 `runFwTopKDecisionPipeline` |
| **保留 applyFwSpanReplacements** | ✅ 可保留；best sentence → `FwApprovedReplacement[]` 即可 |
| **KenLM scoreBatch 复用** | ✅ 已有 `createKenlmBatchScorer()` + `scoreBatch`；raw+candidates 一次 batch ≤17 可控 |
| **V2 base/domain 合计 limit** | ⚠️ **当前不支持**；现为 base LIMIT 2 **+** domain LIMIT 3 **叠加**（max 5），需改 recall 层 |
| **domain 优先** | ⚠️ **机制存在、数据为空**；`domain_lexicon` 当前 **0 行** |
| **tone_pinyin_key** | ❌ **全链路缺失**；schema/seed/runtime/recall 均无 |
| **声调生成能力** | ⚠️ **库可支持、代码未实现**；`pinyin-pro` 已依赖，仅 `toneType: 'none'` |
| **maxSpans=4** | ⚠️ 需改配置；当前 FW 默认 **maxSpans=2** |
| **Industry Routing** | 可 **Phase 4 后接**；第一版可用 `profile.primaryDomain` + `resolveDomainIdsForRecall` |

**总评**：方案与现有 FW 主链 **架构兼容**，Recover 主链 **不必恢复**。主要工作量在：**(1) recall 合并策略与 tone 字段/build；(2) 新 sentence combinator + rerank 模块替换 per-span pick；(3) domain 词库入库**。Legacy Recover 的 `sentence-expansion` + `rerankSentenceCandidates` 可作为 **只读参考实现**，不建议直接 import（位于 `legacy/recover/`）。

---

## 2. 现有代码改造点

### 2.1 当前 FW 决策链（将被替换部分）

```text
fw-detector-orchestrator.ts
  → runFwTopKDecisionPipeline (fw-topk-decision-pipeline.ts)
       recallSpanTopK → scoreRecallHits (per-span KenLM weak_veto)
       → pickBestCandidatePerSpan → pickApprovedReplacementsGreedy
  → applyFwSpanReplacements (apply-span-replacements.ts)
```

| 文件 | 现状 | P4 改造 |
|------|------|---------|
| `fw-topk-decision-pipeline.ts` | per-span KenLM + finalScore pick | **核心替换**：span 候选集 → 整句组合 → 句级 rerank |
| `pick-approved-replacements.ts` | greedy per-span | 降级为 helper 或删除；approved 由 rerank 输出 |
| `candidate-scorer.ts` | span 级 finalScore | 保留用于 span 内排序；句级 winner 由 KenLM 决定 |
| `candidate-sentence-builder.ts` | 单 span 换词造句 | **复用**为 combination 构建块 |
| `apply-span-replacements.ts` | 右向左 apply | **不变** |
| `kenlm-span-gate.ts` | per-candidate weak_veto | FW 句级 rerank 可 **不再调用** per-span veto（避免双 KenLM） |
| `recall-span-topk-v2.ts` | tier 叠加 merge | **必改**：domain>alias>base 优先级 + **合计** perSpanLimit |
| `lexicon-runtime-v2.ts` | SQL LIMIT 分 tier | 可选：新增 tone 字段 SELECT；limit 改由上层 merge 控制 |
| `runtime-v2-recall-adapter.ts` | 桥接 V2→local-span-recall | 扩展返回 tone / tier source |
| `fw-config.ts` | maxSpans=2, topK=3 | 增 maxSpans=4、maxSentenceCandidates=16、perSpanLimit 函数 |
| `fw-detector/types.ts` | span/candidate diagnostics | 增 SentenceRerank diagnostics |

### 2.2 可复用但不在 FW 主链的 Legacy 资产

| 模块 | 路径 | 复用方式 |
|------|------|----------|
| 句级 rerank | `legacy/recover/asr-repair/sentence-rerank/rerank.ts` | 参考 `scoreBatch` + sort；**勿直接依赖 Recover** |
| Near-tie / raw 保护 | `near-tie-coverage-guardrail.ts` | 参考 raw 轻微领先时不替换 |
| KenLM scorer | `asr-repair/sentence-rerank/kenlm-scorer.ts` | **已在 FW 使用** `createKenlmBatchScorer()` |
| 句候选扩展 | `legacy/recover/.../sentence-expansion.ts` | 参考笛卡尔积 + dedup；FW 需独立实现 |

---

## 3. 推荐接入方案

### 3.1 最小侵入路径（推荐）

```text
Metadata Gate (不变)
  → resolveFwSpans
  → 【新】recallSpanCandidateSets(rawText, spans, profile, perSpanLimit)
  → 【新】buildSentenceCandidates(rawText, spanSets, maxSentenceCandidates=16)
  → 【新】rerankFwSentenceCandidates(raw, candidates, kenlmScorer)
  → mapBestSentenceToApprovedReplacements()
  → applyFwSpanReplacements (不变)
```

**接入点**：在 `fw-detector-orchestrator.ts` L321–343，将 `runFwTopKDecisionPipeline` 换为 `runFwSentenceRerankPipeline`（新文件，可放在 `fw-detector/`）。

### 3.2 与现有 pipeline 的关系

| 问题 | 答案 |
|------|------|
| 是否必须改 `fw-topk-decision-pipeline.ts`？ | **是**（逻辑替换或拆出新 pipeline 后 orchestrator 改 import） |
| 是否保留 `applyFwSpanReplacements`？ | **是** |
| best sentence 能否转 diagnostics？ | **是** — `SentenceCandidate.replacements` → `FwDetectorReplacementDiag[]` + 新 `sentenceRerank` 块 |
| per-span KenLM weak_veto 是否保留？ | **建议移除**（句级 rerank 已含 raw）；避免 4 span × N candidate 重复 batch |

### 3.3 配置变更（相对 P3.3）

| 项 | P3.3 | P4 方案 |
|----|------|---------|
| `maxSpans` | 2 | **4**（metadata gate + fw-config） |
| per-span 候选 | topK=3 | 动态 8/4/2 **合计** |
| 句候选上限 | 无 | **16** + raw |
| KenLM 调用形态 | per-span batch | **1 次** sentence batch（≤17 句） |

---

## 4. 数据结构（建议落位 `fw-detector/types.ts` 或新 `sentence-rerank-types.ts`）

```ts
/** 每个 span 的候选集（recall 输出） */
export type SpanCandidateSet = {
  span: FwTextSpan;
  signals: FwDetectorSignal[];
  candidates: Array<{
    word: string;
    source: 'domain' | 'alias' | 'base';
    priorScore: number;
    candidateScore: number;
    pinyinKey: string;
    tonePinyinKey?: string;
    toneDistance?: number;
    repairTarget: boolean;
  }>;
};

/** 整句组合候选 */
export type SentenceCandidate = {
  text: string;
  replacements: ReplacementPatch[];
  candidateScore: number; // span 候选分聚合（prior/candidateScore/tone）
  kenlmScore?: number;
  kenlmNormalizedScore?: number;
  kenlmDelta?: number; // vs raw
};

export type ReplacementPatch = {
  spanText: string;
  start: number;
  end: number;
  replacement: string;
  source: 'domain' | 'alias' | 'base';
};

/** rerank 输出 */
export type SentenceRerankResult = {
  rawText: string;
  candidates: SentenceCandidate[];
  picked: SentenceCandidate | null; // null = keep raw
  pickedIsRaw: boolean;
  kenlmQueryCount: number;
  kenlmTiming?: KenlmTimingStats;
  combinationCount: number;
  truncated: boolean;
};
```

**映射到现有类型**：

```ts
function toApprovedReplacements(picked: SentenceCandidate): FwApprovedReplacement[] {
  return picked.replacements.map((r) => ({
    start: r.start,
    end: r.end,
    candidateText: r.replacement,
    span: { text: r.spanText, start: r.start, end: r.end },
  }));
}
```

---

## 5. SQLite / Build 修改清单

### 5.1 当前 schema（实测 `lexicon_v2.sqlite`）

**base_lexicon 列**：`id, pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias`

**缺失**：`tone_pinyin_key`、plain `pinyin` 列（运行时从 `pinyin_key` 解析）

**domain_lexicon**：表存在，**当前 0 行**

### 5.2 需修改的 build 脚本

| 文件 | 变更 |
|------|------|
| `scripts/lexicon/lib/build-v2-shadow-bundle.mjs` | `SCHEMA_SQL` 增 `tone_pinyin_key TEXT`；INSERT 绑定 |
| `scripts/lexicon/lib/v2-materialize-aliases.mjs` | alias 行继承 canonical `tone_pinyin_key` |
| `scripts/lexicon/lib/v2-pinyin-key.mjs` | 新增 `resolveTonePinyinKey()` → `mei3\|shi4` 规范 |
| `scripts/lexicon/lib/parse-rows.mjs` | 解析 `tonePinyin` / `tonePinyinKey` |
| `scripts/lexicon/lib/v2-shadow-stats.mjs` | 输出 `toneCoverage` 统计 |
| `scripts/lexicon/build-lexicon-v2-shadow.mjs` | 无逻辑变更（入口） |
| 新增 validate | tone_key 与 pinyin_key syllable 数一致 |

### 5.3 Runtime 读取

| 文件 | 变更 |
|------|------|
| `lexicon-v2/lexicon-runtime-v2.ts` | `TierRow` + SELECT + `HotwordEntry` 扩展 |
| `lexicon/hotword-types.ts` | 可选 `tonePinyin?: string[]` |

### 5.4 索引（按方案）

```sql
CREATE INDEX idx_base_pinyin_tone ON base_lexicon(pinyin_key, tone_pinyin_key);
CREATE INDEX idx_domain_pinyin_tone ON domain_lexicon(domain_id, pinyin_key, tone_pinyin_key);
```

---

## 6. Tone Pinyin 方案

### 6.1 当前能力

| 能力 | 状态 | 位置 |
|------|------|------|
| 无声调 recall key | ✅ | `syllablesKey()` / `pinyin_key` |
| 带声调 key | ❌ | 无 |
| ASR span → syllables | ✅ 无声调 | `textToSyllables()` — `pinyin-pro` **`toneType: 'none'`** |
| Build 无声调 key | ✅ | `v2-pinyin-key.mjs` — `toneType: 'none'` |
| 硬过滤声调 | ❌ 未实现 | — |

### 6.2 建议实现

```ts
// 新增 lexicon/phonetic/tone-pinyin.ts
import { pinyin } from 'pinyin-pro';

export function textToToneSyllables(text: string): string[] {
  const arr = pinyin(text.trim(), { toneType: 'num', type: 'array' }) as string[];
  return arr.map(normalizeToneSyllable); // e.g. mei3, shi4
}

export function tonePinyinKey(syllables: string[]): string {
  return syllables.join('|');
}

export function toneDistance(asrKey: string, candKey: string): number {
  const a = asrKey.split('|');
  const b = candKey.split('|');
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
```

### 6.3 多音字

- **Build 期**：seed 显式提供 `tonePinyin` / `tonePinyinKey`（方案 JSONL 示例）优先于自动推导  
- **Runtime 期**：span ASR 文本用 `pinyin-pro` 推导 `asrToneKey`（可能错，故 **禁止硬过滤**）  
- **排序**：`toneDistance` 升序 → `priorScore` → `domain priority` → 截断到 perSpanLimit  

### 6.4 与 P3.3 degrade 的关系

P3.3 中 `mei|shi` 桶混入 美式/美食/没事/以下 等同音词；tone distance **可压低** 美食 vs 美式混淆，但 **不能替代 domain 词入库**（当前 domain 表空）。

---

## 7. Sentence Rerank 方案

### 7.1 组合生成

```ts
function getPerSpanCandidateLimit(spanCount: number): number {
  if (spanCount <= 1) return 8;
  if (spanCount === 2) return 4;
  return 2;
}

function buildCombinations(
  rawText: string,
  spanSets: SpanCandidateSet[],
  maxSentenceCandidates: number
): SentenceCandidate[] {
  // 每 span 取 ordered candidates[0..limit)
  // 笛卡尔积 apply replacements 到 rawText
  // 截断至 maxSentenceCandidates（按 candidateScore 预排序）
}
```

**现有基础**：`buildCandidateSentencesForSpan` 仅单 span；多 span 需新 combinator（可参考 Recover `selectActiveUtteranceTextWindowBased` 的多窗组合思想，但 FW 应用笛卡尔积更简单）。

### 7.2 KenLM rerank

```ts
async function rerankFwSentences(
  rawText: string,
  candidates: SentenceCandidate[],
  scorer: KenLMScorer | null,
  opts: { minDeltaToReplace?: number }
): Promise<SentenceRerankResult> {
  const sentences = [rawText, ...candidates.map((c) => c.text)];
  const batch = await scorer.scoreBatch(sentences); // ≤17
  const baselineNorm = batch.scores[0].normalizedScore;
  // 对每个 candidate i: delta = scores[i+1].norm - baselineNorm
  // picked = argmax delta among candidates; if maxDelta < minDeltaToReplace → raw wins
}
```

| 项 | 说明 |
|----|------|
| **复用 scoreBatch** | ✅ `createKenlmBatchScorer()` 已 sequential score；17 句与 P3.3 单 span 2–4 query 同量级 |
| **delta** | `candidateNorm - rawNorm`（与现 `kenlm-span-gate` 一致） |
| **选 best** | 最大 delta；**必须** raw 参与竞争 |
| **threshold** | 建议 `minDeltaToReplace`（如 0.02–0.05）或移植 `near-tie-coverage-guardrail` 的 epsilon 思想，**避免 raw 被 0.001 差距替换**（P3.3 degrade 根因之一） |
| **pickedIsRaw** | `approved.length === 0` 或显式 flag |

### 7.3 Diagnostics

在 `FwDetectorResult` 增加：

```ts
sentenceRerank?: {
  spanCount: number;
  perSpanLimit: number;
  combinationCount: number;
  kenlmQueryCount: number;
  pickedIsRaw: boolean;
  topCandidates: Array<{ text: string; kenlmDelta: number; replacementCount: number }>;
};
```

`recall-v2-diagnostics.ts` 可增 `tone_distance_avg` 等字段。

---

## 8. 一～九题直接回答

### 一、per-span greedy → sentence rerank？

| 子问 | 答案 |
|------|------|
| 可替换？ | **可以** |
| 最小接入点 | `fw-detector-orchestrator.ts` 调用处；新建 `runFwSentenceRerankPipeline` |
| 改 fw-topk-decision-pipeline？ | **是**（替换或废弃 per-span pick 路径） |
| 保留 applyFwSpanReplacements？ | **是** |
| diagnostics 可转？ | **是** |

### 二、V2 Recall 能力？

| 能力 | 现状 |
|------|------|
| base/domain 分别查询 | ✅ `lookupBaseByPinyinKey` / `lookupDomainByPinyinKey` |
| 合并候选 | ✅ `mergeTierCandidates` — **但是 tier 叠加，非合计 limit** |
| base+domain 合计 limit | ❌ 需新 `mergeSpanCandidates(domain, alias, base, limit)` |
| domain priority | ⚠️ domain 行在前，但 **domain 表空** |
| source 标记 | ⚠️ 现为 `WindowCandidateSource`（lexicon_pinyin_topk 等），非三元 domain/alias/base |
| 每 span 多候选 | ✅ `topK` slice；limit 由 SQL tier cap 与 topK 共同约束 |

### 三、SQLite schema？

| 字段 | 有/无 |
|------|-------|
| pinyin_key | ✅ |
| tone_pinyin_key | ❌ |
| pinyin（列） | ❌（仅 key 解析） |
| tone_pinyin | ❌ |

Build 改动见 §5。

### 四、声调支持？

| 子问 | 答案 |
|------|------|
| 现支持？ | **否**（仅无声调） |
| 函数位置 | 可增 `lexicon/phonetic/tone-pinyin.ts`；build 用 `v2-pinyin-key.mjs` |
| 依赖 | **`pinyin-pro` 已安装**（`phonetic/pinyin.ts`、`v2-pinyin-key.mjs`） |
| 多音字 | seed 显式 tone + build 校验；runtime 软排序 |
| tone_pinyin_key 规范 | `{syllable}{tone}` 用 `\|` 连接，如 `mei3\|shi4` |

### 五、Sentence Combination 可行性？

**可行**。预算 2^4=16、4^2=16、8^1=8 与方案一致。需新模块；Recover 有参考实现但不在 FW 路径。

### 六、KenLM scoreBatch 复用？

**可以**。raw + ≤16 candidates = ≤17 batch；选 best + **minDelta threshold** 防 raw 误替换。

### 七、复杂度 / 性能？

| 场景 | 组合数 | KenLM queries | 评估 |
|------|--------|---------------|------|
| 4 span × 2 | 16 | 17 | ✅ 可控 |
| 2 span × 4 | 16 | 17 | ✅ |
| 1 span × 8 | 8 | 9 | ✅ |
| recall SQL | 4 span × 1 lookup | 4 queries | ✅ 低于 P3.2 |

相对 P3.3 pipeline P95≈4096ms：句级 **单次** batch 17 查询预计 +0.5–2s（与 span 数弱相关），**需 dialog_200 回归**；per-span KenLM veto **移除**可部分抵消。

### 八、Phase 4 关系？

| 项 | 现状 |
|----|------|
| activeDomain 传入 | `getProfileSnapshotFromContext` → `resolveDomainIdsForRecall(profile)`；Intent 经 `getLexiconRecallContext().sessionIntent` |
| domain 优先 | 代码可写；**数据需 domain_lexicon 入库** |
| 无 activeDomain | `domainIds=[]` → 仅 base（+ idiom if enabled） |
| Industry Routing | `useIndustryRouting=false`（P3.3 批测）；**不必首版接入**，profile 足够 |

### 九、测试建议

| 层级 | 用例 |
|------|------|
| 单元 | `getPerSpanCandidateLimit`；`toneDistance`；combinations 截断 16；raw wins；delta threshold |
| 集成 | dialog_200；指标：apply/improve/degrade/CER/pipeline P95/combinationCount |
| 回归 | span/job≤4；KenLM query≤17/job；不恢复 KenLM Span Gate |

---

## 9. Target List（开发顺序）

### P0 — 审计结论（本文）

- [x] pipeline 可替换性
- [x] rerank 接入点
- [x] V2 合计 limit 缺口
- [x] tone 能力缺口
- [x] KenLM batch 复用
- [x] diagnostics 扩展点

### P1 — Schema / Build

- [ ] `tone_pinyin_key` 字段 + 索引
- [ ] build 生成 tone key + stats coverage
- [ ] seed 样例字段 validate
- [ ] **domain_lexicon 灌入**（否则 domain 优先无效）

### P2 — Recall

- [ ] `mergeSpanCandidates` domain>alias>base + **合计 limit**
- [ ] `textToToneSyllables` + `toneDistance` 排序
- [ ] per-span 动态 limit 函数
- [ ] source 三元标记

### P3 — Sentence Combination + Rerank

- [ ] `buildSentenceCandidates` + 截断
- [ ] raw 必入 batch
- [ ] `rerankFwSentenceCandidates` + minDelta
- [ ] orchestrator 切新 pipeline
- [ ] diagnostics

### P4 — 回归

- [ ] dialog_200 15min
- [ ] degrade ≤ Phase2 水平；pipeline P95 不劣化 >10%

---

## 10. Check List（对照方案 §14）

### 架构

- [x] 不修改 CTC — 审计范围外，FW 主链未触 CTC
- [x] 不恢复 Recover 主链 — 仅参考 legacy 模块
- [x] Lexicon 不反推 Span — Metadata Gate 不变
- [x] 不启用 KenLM Span Gate — 句级 rerank 替代 per-span veto
- [x] Metadata Gate 找 span — 不变
- [x] Lexicon 只出候选 — 不变
- [x] KenLM 整句 rerank — **待实现**

### 复杂度

- [ ] maxSpans=4 — **配置待改**（现 2）
- [ ] maxSentenceCandidates=16 — **待实现**
- [ ] raw 必入 — **待实现**
- [ ] per-span 动态 limit — **待实现**
- [ ] base+domain 合计上限 — **待改 recall**

### 声调

- [ ] pinyin_key 无声调 recall — ✅ 已有
- [ ] tone_pinyin_key 排序 — **待 build+runtime**
- [ ] 不硬过滤 — 方案一致，实现需遵守
- [ ] tone_distance 参与排序 — **待实现**
- [ ] tone coverage stats — **待 build**

### 质量

- [ ] domain 优先 — **待数据+merge 逻辑**
- [ ] 正确 domain 词在 pool — **依赖 seed/domain 表**
- [ ] improve↑ degrade↓ — **待 P4 回归验证**

### 性能

- [ ] KenLM batch ≤17 — 设计满足
- [ ] pipeline P95 — **待实测**
- [ ] combination 不爆炸 — 硬 cap 16 满足

---

## 11. 风险与回滚

| 风险 | 等级 | 缓解 |
|------|------|------|
| domain_lexicon 空 → domain 优先无效 | **高** | P1 同步灌 domain seed |
| repair_target 仍 100%=1 | **高** | 与 P3.4-A RepairTarget 并行；否则 rerank 仍选错词 |
| KenLM 短句 delta≈0 → raw 仍被替换 | **中** | minDeltaToReplace + raw 优先 tie-break |
| maxSpans 2→4 性能 | **中** | 组合 cap 16 + 单 batch KenLM |
| tone 推导与 ASR 错字不一致 | **中** | 只排序不过滤 |
| build 迁移破坏 V2 bundle | **中** | schema 版本 bump + manifest |

**回滚**：

```json
"features.fwDetector": {
  "useSentenceLevelRerank": false  // 建议新增 flag
}
```

保留 `runFwTopKDecisionPipeline` 路径一份，开关切回 P3.3 per-span pick。

---

## 12. 与 P3.3 Degrade 审计的衔接

P3.3 审计结论：**14 degrade = 候选错 + repair_target 过宽**；KenLM per-span weak_veto 几乎全放行。

P4 方案直接针对：

| P3.3 问题 | P4 机制 |
|-----------|---------|
| per-span 局部最优 | **句级 rerank** |
| mei\|shi 同音桶 | **tone distance 排序** |
| raw 正确仍被改 | **raw 入 batch + delta threshold** |
| domain 词缺失 | **domain 优先 + 灌库** |
| 一下→以下 等 | **非黑名单**；靠 tone + domain + 句级 KenLM |

**注意**：P4 **不能单独**解决 repair_target=100% 问题；建议 **P3.4-A（RepairTarget）与 P4 recall/rerank 并行或先行**。

---

**审计完成。未修改任何源代码。**
