# Recover V5 Phase C 技术方案：TopK Pinyin Recall + CandidateScore

版本：V5-Phase-C  
日期：2026-05-22  
目标：实现 scored legal lexicon TopK recall，替换 observed/confusion 主召回。

---

## 1. Phase C 目标

V5 的核心是：

```text
window pinyin
→ scored legal lexicon lookup
→ TopK by term length
→ WindowCandidate
```

Phase C 是 V5 的主质量阶段。

---

## 2. TopK Lookup API

新增 API：

```ts
lookupTopKByPinyin(input: {
  pinyin: string;
  termLength: 2 | 3 | 4 | 5;
  domain?: string;
  topK: number;
}): LexiconCandidate[]
```

返回：

```ts
{
  word: string;
  pinyin: string;
  priorScore: number;
  phoneticScore: number;
  candidateScore: number;
  termLength: number;
  rankInTopK: number;
  source: "lexicon_pinyin_topk";
}
```

---

## 3. TopK 分级

冻结：

```json
{
  "topKByTermLength": {
    "2": 5,
    "3": 5,
    "4": 3,
    "5": 2
  }
}
```

---

## 4. CandidateScore

冻结公式：

```text
candidateScore =
priorScore
+ phoneticSimilarity
+ exactLengthBonus
+ domainBoost
- editDistancePenalty
```

约束：

- KenLM 不参与 candidateScore
- combinedScore 不参与 TopK recall
- candidateScore 只用于 window-level TopK 排序

---

## 5. Recall Source

V5 新 source：

```text
lexicon_pinyin_topk
```

observed/confusion 可以保留为辅助 source，但不得再作为主召回路径。

---

## 6. Out-of-bundle 约束

禁止：

- 动态造词
- 自由拼音生成
- 表外 candidate

验收：

```text
out_of_bundle_candidate_count = 0
```

---

## 7. Target List

### C-01 新增 pinyin-topk-lookup.ts

实现 TopK lookup。

### C-02 新增 candidate-score.ts

实现 candidateScore。

### C-03 修改 hotword-recall/window-recall

接入 lexicon_pinyin_topk recallPath。

### C-04 TopK by term length

按 5/5/3/2 限制输出。

### C-05 保留 observed/confusion 为辅助

但主指标应显示 lexicon_pinyin_topk。

### C-06 diagnostics

每个 candidate 输出：

```json
{
  "windowText": "...",
  "windowPinyin": "...",
  "candidate": "...",
  "candidatePinyin": "...",
  "candidateScore": 8.5,
  "priorScore": 8.0,
  "phoneticScore": 0.96,
  "termLength": 3,
  "rankInTopK": 1,
  "source": "lexicon_pinyin_topk"
}
```

---

## 8. Check List

- [ ] lookupTopKByPinyin 已实现
- [ ] candidateScore 已实现
- [ ] TopK by length = 5/5/3/2
- [ ] candidate source = lexicon_pinyin_topk
- [ ] 无 priorScore 不进入 TopK
- [ ] out_of_bundle_candidate_count = 0
- [ ] KenLM 不参与 TopK recall
- [ ] observed/confusion 不再是唯一主召回
- [ ] 每个 candidate 有 rankInTopK
- [ ] 每个 candidate 有 candidateScore
- [ ] mixed token 不被破坏

---

## 9. 测试计划

新增测试：

- same pinyin lookup
- near pinyin lookup
- TopK by term length
- priorScore 排序
- candidateScore 排序
- no prior exclusion
- mixed token lookup
- out-of-bundle=0

---

## 10. 验收指标

```text
lexicon_pinyin_topk_candidate_count > 0
topk_hit_rate_by_term_length 可统计
out_of_bundle_candidate_count = 0
rankInTopK 全量存在
candidateScore 全量存在
```
