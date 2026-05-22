# Recover V5 Phase E 技术方案：Observability + Tests + Batch Contract

版本：V5-Phase-E  
日期：2026-05-22  
目标：完成 V5 result-builder、批测、报告和测试契约。

---

## 1. Phase E 目标

Phase E 不改召回主逻辑，只做：

- observability
- result json
- batch metrics
- unit/integration tests
- docs alignment

---

## 2. result.extra 必须新增

```json
{
  "recover_contract_version": "v5-scored-lexicon-topk",
  "qualityConfig": {
    "allowedWindowLengths": [2, 3, 4, 5],
    "diffContextLeft": 2,
    "diffContextRight": 2,
    "topKByTermLength": {
      "2": 5,
      "3": 5,
      "4": 3,
      "5": 2
    },
    "maxActiveWindows": 2,
    "maxSentenceCandidates": 32
  },
  "v5_metrics": {
    "windows_from_nbest_diff_count": 0,
    "sliding_window_count": 0,
    "lexicon_pinyin_topk_candidate_count": 0,
    "out_of_bundle_candidate_count": 0,
    "picked_from_raw_ctc_nbest_count": 0,
    "modified_without_replacement_count": 0
  }
}
```

---

## 3. Per-candidate trace

每个候选输出：

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
  "source": "lexicon_pinyin_topk",
  "kenlmScore": -12.3,
  "picked": true
}
```

不得只 console 输出。

---

## 4. 批测新增指标

必须输出：

- windows_from_nbest_diff_ratio
- sliding_window_count
- skip_reason_v5_distribution
- topk_hit_rate_by_term_length
- lexicon_pinyin_topk_candidate_count
- lexicon_pinyin_topk_picked_ratio
- out_of_bundle_candidate_count
- no_diff_span_count
- no_topk_candidate_count

---

## 5. 测试补齐

新增测试层级：

### E-01 Diff tests

- diff span detection
- context expansion
- no_diff_span

### E-02 Window tests

- allowedWindowLengths
- no 1 字
- no 6+ 字
- no full sentence sliding

### E-03 TopK tests

- lookupTopKByPinyin
- TopK by term length
- candidateScore
- no prior exclusion
- mixed token

### E-04 Gate tests

- six skipReasons
- baseline gate
- budget gate

### E-05 Batch tests

- dialog_200
- contract assess
- metrics present

---

## 6. Target List

### E-01 修改 result-builder

导出 V5 contract。

### E-02 修改 recover-contract-assess

新增 V5 pass 条件。

### E-03 修改 run-dialog-200-batch

统计 V5 metrics。

### E-04 新增 unit tests

覆盖 Phase B/C/D。

### E-05 更新 docs/RECOVER.md

从 historical-restore-v1 更新为 V5 主链。

---

## 7. Check List

- [ ] recover_contract_version = v5-scored-lexicon-topk
- [ ] qualityConfig 输出 V5 全字段
- [ ] per-candidate trace 完整
- [ ] windows_from_nbest_diff_ratio 可统计
- [ ] sliding_window_count 可统计且为 0
- [ ] skip_reason_v5_distribution 可统计
- [ ] topk_hit_rate_by_term_length 可统计
- [ ] out_of_bundle_candidate_count = 0
- [ ] 单测覆盖 diff/topK/gates
- [ ] dialog_200 contract PASS
- [ ] docs/RECOVER.md 与 V5 一致

---

## 8. V5 最终 Pass 条件

```text
recover_contract_version === 'v5-scored-lexicon-topk'
ctc_nbest_preserved === true
picked_from_raw_ctc_nbest_count === 0
modified_without_replacement_count === 0
out_of_bundle_candidate_count === 0
sliding_window_count === 0
window_length_distribution ⊆ {2,3,4,5}
```

---

## 9. 最终输出

Phase E 完成后，应可用一份 batch report 直接回答：

1. 窗是否来自 n-best diff？
2. 是否还有滑窗？
3. TopK 是否按词长工作？
4. 候选是否来自合法词库？
5. KenLM 是否只过滤有限句候选？
6. skip 是否可解释？
7. raw CTC 是否被彻底隔离？
