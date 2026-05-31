# P4 / P3.4 Sentence-Level Candidate Rerank + Tone Pinyin 方案

版本：V1.0  
日期：2026-05-31  
适用范围：Lingua_1 / electron-node / FW Metadata Span Gate / Lexicon Runtime V2  

---

## 1. 核心目标

当前 P3.3 已解决：

```text
Span Explosion
KenLM Span Gate 性能问题
FW Metadata Span Gate 入口
```

剩余问题：

```text
候选质量不足
base/domain 权重未形成主次关系
per-span greedy pick 容易局部选错
```

新的方向：

```text
FW raw text
↓
Metadata Gate 找 span，最多 4 个
↓
每个 span 查询 base + domain 候选
↓
根据 span 数动态限制每个 span 的候选数量
↓
生成整句候选组合
↓
加入 raw sentence
↓
KenLM sentence-level rerank
↓
选择整句
```

---

## 2. 设计原则

### Base 与 Domain 的职责

```text
Base Lexicon：
合法中文 fallback 候选

Domain Lexicon：
专业词 / 行业词 / 场景词候选

KenLM：
整句级 rerank / veto
```

### 禁止黑名单

不做：

```text
不要 → 补药
可以 → 可疑
一下 → 以下
```

这种逐项黑名单维护。

应通过：

```text
Domain 权重
候选数量控制
Tone pinyin penalty
Sentence-level KenLM
```

解决候选竞争问题。

---

## 3. 动态 Span / Candidate 预算

全局上限：

```text
maxSpans = 4
maxSentenceCandidates = 16
rawSentence 必须加入 rerank
```

动态 per-span candidate limit：

| span 数 | 每个 span 最大候选数 | 最大组合数 |
|--------|----------------------|-----------|
| 1 | 8 | 8 |
| 2 | 4 | 16 |
| 3 | 2 | 8 |
| 4 | 2 | 16 |

建议函数：

```ts
function getPerSpanCandidateLimit(spanCount: number): number {
  if (spanCount <= 1) return 8;
  if (spanCount === 2) return 4;
  return 2;
}
```

注意：

```text
这里的候选数是 base + domain 合计上限
不是 base 2 + domain 2 叠加上限
```

---

## 4. 每个 span 的候选来源优先级

候选来源优先级：

```text
domain candidates
>
alias candidates
>
base candidates
```

规则：

```text
有 activeDomain：
  domain 优先填充
  base 作为 fallback

无 activeDomain：
  base 作为保守候选
```

示例：

```ts
function mergeSpanCandidates({
  domainCandidates,
  aliasCandidates,
  baseCandidates,
  limit
}: Input): Candidate[] {
  return dedupeByWord([
    ...domainCandidates,
    ...aliasCandidates,
    ...baseCandidates
  ]).slice(0, limit);
}
```

---

## 5. Sentence-Level Candidate Combination

### 输入

```ts
type SpanCandidateSet = {
  span: {
    text: string;
    start: number;
    end: number;
  };

  candidates: Array<{
    word: string;
    source: 'domain' | 'alias' | 'base';
    priorScore: number;
    pinyinKey: string;
    tonePinyinKey?: string;
    tonePenalty?: number;
  }>;
};
```

### 输出

```ts
type SentenceCandidate = {
  text: string;

  replacements: Array<{
    spanText: string;
    start: number;
    end: number;
    replacement: string;
    source: 'domain' | 'alias' | 'base';
  }>;

  candidateScore: number;

  kenlmScore?: number;
  kenlmDelta?: number;
};
```

### 组合生成

```text
每个 span 从候选列表中选择 1 个 replacement
对所有 span 做笛卡尔积
组合数不得超过 maxSentenceCandidates
```

示例：

```text
span1:
  大杯
  大悲

span2:
  美式
  美食

组合：
  大杯美式咖啡
  大悲美食咖啡
  大杯美食咖啡
  大悲美式咖啡
```

复杂度：

```text
候选数 ^ span数
```

在当前预算下最多：

```text
2^4 = 16
```

或：

```text
span=2 时 4^2 = 16
```

---

## 6. Raw Sentence 必须加入

最终 KenLM rerank 输入：

```text
raw sentence
+
candidate sentence combinations
```

目的：

```text
如果 ASR 原句本来正确，raw 可以获胜
避免强制替换
```

---

## 7. Tone Pinyin 机制

### 为什么引入声调

当前无声调 pinyin_key：

```text
mei|shi
```

会混入：

```text
美式 mei3 shi4
美食 mei3 shi2
没事 mei2 shi4
美饰 mei3 shi4
```

引入声调后，可以降低同音陷阱：

```text
美式 → mei3|shi4
美食 → mei3|shi2
没事 → mei2|shi4
```

### 不做声调硬过滤

禁止：

```text
tone_pinyin_key 必须完全一致才召回
```

原因：

```text
ASR 错字本身可能声调也错
```

推荐：

```text
pinyin_key：
无声调，用于召回

tone_pinyin_key：
带声调，用于排序 / 降权 / 截断
```

---

## 8. Tone Distance

```ts
function toneDistance(asrToneKey: string, candidateToneKey: string): number {
  // syllable 数相同
  // 每个 syllable tone 不同 +1
  // 声母韵母不同不在这里处理，已由 pinyin_key 约束
}
```

示例：

```text
ASR: 美食 mei3|shi2

候选：
美式 mei3|shi4 → distance 1
美饰 mei3|shi4 → distance 1
没事 mei2|shi4 → distance 2
```

排序综合：

```text
domainPriority
priorScore
toneDistance
KenLM sentence score
```

---

## 9. SQLite / Build Schema 建议

### base_lexicon

新增字段：

```sql
tone_pinyin_key TEXT
```

索引：

```sql
CREATE INDEX idx_base_pinyin_tone
ON base_lexicon(pinyin_key, tone_pinyin_key);
```

### domain_lexicon

新增字段：

```sql
tone_pinyin_key TEXT
```

索引：

```sql
CREATE INDEX idx_domain_pinyin_tone
ON domain_lexicon(domain_id, pinyin_key, tone_pinyin_key);
```

### Seed JSONL 示例

```json
{
  "type": "canonical_term",
  "termId": "restaurant_0001",
  "word": "美式",
  "pinyin": "mei shi",
  "pinyinKey": "mei|shi",
  "tonePinyin": "mei3 shi4",
  "tonePinyinKey": "mei3|shi4",
  "priorScore": 0.95,
  "domains": ["restaurant"],
  "source": "domain_restaurant",
  "repairTarget": true,
  "enabled": true
}
```

---

## 10. Candidate Query 规则

查询输入：

```ts
type RecallQuery = {
  spanText: string;
  pinyinKey: string;
  tonePinyinKey?: string;
  activeDomain?: string;
  limit: number;
};
```

查询策略：

```text
1. 按 pinyin_key 查
2. 不用 tone_pinyin_key 硬过滤
3. 用 tone_distance 排序
4. domain candidate 优先
5. base candidate fallback
6. base + domain 合计不超过 perSpanLimit
```

---

## 11. KenLM Sentence-Level Rerank

当前问题：

```text
每个 span 独立 pick
再 greedy apply
```

局部最优不等于整句最优。

新逻辑：

```text
生成完整候选句
KenLM 对完整句打分
选择整句
```

输入：

```text
raw
candidate_1
candidate_2
...
candidate_N
```

输出：

```text
best sentence
```

如果 best sentence 是 raw：

```text
不 apply
```

如果 best sentence 是 candidate：

```text
从 SentenceCandidate.replacements 写回 approved replacements
并调用 applyFwSpanReplacements
```

---

## 12. 与 Phase 4 的关系

Phase 4 本质：

```text
Session Intent
→ activeDomain
→ domain_lexicon
→ domain candidates priority
```

本方案是 Phase 4 的候选组合与 rerank 机制。

第一版只需要：

```text
activeDomain 已存在时
优先 domain candidates
```

没有 activeDomain 时：

```text
base fallback
```

---

## 13. Target List

### P0：开发前审计

- 确认当前 pipeline 是否可替换 per-span greedy pick
- 确认 sentence-level rerank 最小接入点
- 确认当前 LexiconRuntimeV2 是否支持 domain/base 合计 limit
- 确认是否已有 tone pinyin 生成能力
- 确认 build pipeline 是否可新增 tone_pinyin_key
- 确认 KenLM batch score 是否可复用
- 确认 diagnostics 是否可输出 sentence candidates

### P1：Schema / Build

- 增加 tone_pinyin_key
- build 阶段生成 tone pinyin
- base/domain 表增加字段和索引
- validate tone field
- stats 输出 tone coverage

### P2：Recall

- 每个 span 查询 base/domain
- 动态 per-span limit
- 合并 domain/base 候选
- tone distance 排序
- domain priority 排序

### P3：Sentence Combination

- 生成笛卡尔积组合
- 限制 maxSentenceCandidates=16
- raw sentence 加入候选
- KenLM sentence-level rerank
- 选择 best sentence
- 转回 replacements diagnostics

### P4：回归

- dialog_200
- span/job
- candidate combinations
- apply/improve/degrade
- CER
- pipeline p95

---

## 14. Check List

### 架构

- [ ] 不修改 CTC
- [ ] 不恢复 Recover
- [ ] 不让 Lexicon 反推 Span
- [ ] 不重新启用 KenLM Span Gate
- [ ] Metadata Gate 仍负责找 span
- [ ] Lexicon 只负责候选
- [ ] KenLM 负责整句 rerank

### 复杂度

- [ ] maxSpans = 4
- [ ] maxSentenceCandidates = 16
- [ ] raw sentence 必须加入
- [ ] 每个 span 候选数动态控制
- [ ] base + domain 合计上限生效

### 声调

- [ ] pinyin_key 无声调用于 recall
- [ ] tone_pinyin_key 带声调用于排序
- [ ] 不做声调硬过滤
- [ ] tone_distance 参与排序
- [ ] tone coverage 有 stats

### 质量

- [ ] domain candidate 优先于 base
- [ ] base fallback 不压过 domain
- [ ] candidate pool 中包含正确 domain 词
- [ ] improve 增加
- [ ] degrade 降低

### 性能

- [ ] KenLM batch 输入 ≤17
- [ ] pipeline P95 不劣化
- [ ] recall 查询数可控
- [ ] sentence combination 不爆炸

---

## 15. Cursor 开发前只读审计提示词

```text
请基于当前仓库做一次只读代码审计，不要修改代码。

审计目标：
评估是否可以将当前 FW per-span greedy pick 改造为 sentence-level candidate combination rerank，并引入 tone_pinyin_key 作为候选排序信号。

背景：
当前 P3.3 FW Metadata Span Gate 已经成功：
- span/job ≤ 2
- recall 调用下降 98%+
- pipeline P95 ≈ 4096ms
- KenLM Span Gate 已否决
- 剩余问题是候选质量与 per-span greedy pick 导致 24 apply 中 14 degrade

新的目标：
Metadata Gate 找 span
→ 每个 span 查询 base + domain 候选
→ 根据 span 数动态限制每个 span 候选数量
→ 生成整句候选组合
→ 加入 raw sentence
→ KenLM sentence-level rerank
→ 选择 best sentence

核心约束：
1. maxSpans = 4
2. maxSentenceCandidates = 16
3. raw sentence 必须加入候选
4. 每个 span 的候选数量根据 spanCount 动态决定：
   - span=1: perSpanLimit=8
   - span=2: perSpanLimit=4
   - span>=3: perSpanLimit=2
5. base + domain 合计不得超过 perSpanLimit
6. domain candidate 优先于 base candidate
7. pinyin_key 无声调用于 recall
8. tone_pinyin_key 带声调用于排序
9. 声调不能硬过滤，只能作为 tonePenalty / toneDistance
10. 不使用黑名单
11. 不恢复 KenLM Span Gate
12. 不修改 CTC
13. 不恢复 Recover

请重点审计：
- fw-detector/fw-topk-decision-pipeline.ts
- fw-detector/pick-approved-replacements.ts
- fw-detector/candidate-scorer.ts
- fw-detector/apply-span-replacements.ts
- lexicon-v2/recall-span-topk-v2.ts
- lexicon-v2/lexicon-runtime-v2.ts
- scripts/lexicon/*
- lexicon/pinyin-index.ts
- asr-repair/kenlm-span-gate.ts
- sentence-rerank/kenlm-scorer.ts

请回答：

一、当前 per-span greedy pick 是否可以替换为 sentence-level rerank？
- 最小接入点在哪里？
- 是否需要改 fw-topk-decision-pipeline？
- 是否可以保留 applyFwSpanReplacements？
- 是否能把 best sentence 转回 replacements diagnostics？

二、当前 V2 Recall 是否支持：
- base/domain 分别查询
- 合并候选
- base + domain 合计 limit
- domain priority
- source 标记
- 每个 span 返回多个候选

三、当前 SQLite schema 是否已有：
- pinyin_key
- tone_pinyin_key
- pinyin
- tone_pinyin
如果没有，新增字段和索引需要改哪些 build 脚本？

四、当前 pinyin 生成是否支持声调？
- 如果支持，函数在哪里？
- 如果不支持，需要引入什么库或新增什么函数？
- 多音字如何处理？
- tone_pinyin_key 如何规范化？

五、Sentence Combination 设计是否可行？
请给出数据结构：
- SpanCandidateSet
- SentenceCandidate
- ReplacementPatch
- SentenceRerankResult

六、KenLM sentence-level rerank 是否可以复用现有 scoreBatch？
- raw + candidate sentences 一次 batch
- 最多 17 句
- 如何计算 delta
- 如何选 best
- 是否需要 threshold，避免 raw 被轻微差距替换

七、复杂度和性能评估：
- 4 spans × 2 candidates = 16
- 2 spans × 4 candidates = 16
- 1 span × 8 candidates = 8
是否可控？

八、与 Phase 4 的关系：
- activeDomain 如何传入 recall
- domain candidate 如何优先
- 无 activeDomain 时如何 fallback
- Industry Routing 是否必须立即接入，还是可先使用 existing activeDomain

九、测试建议：
- 单元测试：candidate limit
- 单元测试：tone distance
- 单元测试：sentence combinations
- 单元测试：raw wins
- 集成测试：dialog_200
- 指标：FW apply / improve / degrade / CER / pipeline P95

输出：
1. 执行摘要
2. 现有代码改造点
3. 推荐接入方案
4. 数据结构
5. SQLite / Build 修改清单
6. Tone pinyin 方案
7. Sentence rerank 方案
8. Target List
9. Check List
10. 风险与回滚

只读审计，不要修改代码。
```
