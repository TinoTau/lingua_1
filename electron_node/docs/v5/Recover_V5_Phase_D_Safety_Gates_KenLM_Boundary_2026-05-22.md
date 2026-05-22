# Recover V5 Phase D 技术方案：Safety Gates + KenLM Boundary

版本：V5-Phase-D  
日期：2026-05-22  
目标：实现 V5 safety gates，明确 KenLM 只做句级过滤。

---

## 1. Phase D 目标

Phase D 不调权重，不优化 KenLM 性能。

目标是加边界：

```text
没有高质量候选时不修
候选句明显差于 baseline 时不修
预算爆炸时不 silent fail
```

---

## 2. V5 SkipReason 冻结

必须支持：

```text
no_diff_span
no_topk_candidate
low_candidate_score
kenlm_worse_than_baseline
replacement_count_exceeded
candidate_budget_exceeded
```

---

## 3. Baseline 约束

raw CTC hypothesis 允许：

```text
baseline reference
```

禁止：

```text
final picked
```

必须保持：

```text
picked_from_raw_ctc_nbest_count = 0
modified_without_replacement_count = 0
```

---

## 4. KenLM 约束

KenLM 只接收：

```text
SentenceCandidate
```

不得用于：

- TopK recall
- raw hypothesis selection
- free candidate search

新增 gate：

```text
kenlm_worse_than_baseline
```

当候选句 KenLM 分数明显差于 baseline 时 skip。

---

## 5. Replacement 上限

冻结第一版：

```text
maxActiveWindows = 2
maxSentenceCandidates = 32
```

如 replacement 超限：

```text
skipReason = replacement_count_exceeded
```

如候选预算超限：

```text
skipReason = candidate_budget_exceeded
```

不得 silent truncation。

---

## 6. Target List

### D-01 新增 recover-safety-gates.ts

集中管理 V5 gates。

### D-02 接入 sentence-repair-step

在 final pick 前执行 safety gates。

### D-03 接入 rerank

KenLM 分数与 baseline 对比。

### D-04 输出 skipReason_v5_distribution

批测统计六项 skipReason。

### D-05 保持 raw baseline 隔离

raw_ctc_baseline 不得 final picked。

---

## 7. Check List

- [ ] no_diff_span 已实现
- [ ] no_topk_candidate 已实现
- [ ] low_candidate_score 已实现
- [ ] kenlm_worse_than_baseline 已实现
- [ ] replacement_count_exceeded 已实现
- [ ] candidate_budget_exceeded 已实现
- [ ] skipReason 全部进入 result JSON
- [ ] 无 silent skip
- [ ] KenLM 不参与 TopK recall
- [ ] raw_ctc_baseline 不可 final picked
- [ ] modified_without_replacement_count = 0

---

## 8. 测试计划

新增测试：

- no diff span skip
- no topk candidate skip
- low candidate score skip
- KenLM worse baseline skip
- replacement count exceeded skip
- candidate budget exceeded skip
- raw baseline cannot final pick

---

## 9. 验收指标

```text
skip_reason_v5_distribution 可统计
picked_from_raw_ctc_nbest_count = 0
modified_without_replacement_count = 0
candidate_budget_exceeded 非 silent
```
