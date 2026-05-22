# Recover V5 Phase B 技术方案：N-best Diff Window Pipeline

版本：V5-Phase-B  
日期：2026-05-22  
目标：用 n-best diff 触发窗口，替换 segment 全段滑窗主路径。

---

## 1. Phase B 目标

当前代码仍是：

```text
segment 滑窗 2–8
```

V5 要求：

```text
top1 vs n-best diff span
→ 左右 1–2 字 context
→ 2/3/4/5 字切片
```

Phase B 只改“窗从哪里来”。

不做：

- TopK lookup
- candidateScore
- KenLM gate
- priorScore 调整

---

## 2. 目标链路

```text
ctx.asrHypotheses
→ detectNbestDiffSpans(top1, hypotheses)
→ expandDiffSpanContext(span, left=2, right=2)
→ enumerateWindowsFromDiffContext(length=2..5)
→ WindowInput[]
```

---

## 3. Diff Span 规则

输入：

```text
top1 hypothesis
other n-best hypotheses
```

输出：

```json
{
  "hypothesisRank": 2,
  "top1Span": [4, 6],
  "altSpan": [4, 6],
  "top1Text": "生层",
  "altText": "生成",
  "diffType": "substitution"
}
```

支持：

- substitution
- insertion
- deletion
- mixed

禁止：

```text
只按等长字符位置硬切
```

因为 n-best 可能长度不一致。

---

## 4. Context Expansion

冻结配置：

```json
{
  "diffContextLeft": 2,
  "diffContextRight": 2
}
```

context 不得越过 segment 边界。

跨 segment 风险只报告，不在 Phase B 修复。

---

## 5. Window Lengths

冻结：

```json
{
  "allowedWindowLengths": [2, 3, 4, 5]
}
```

禁止：

- 1 字窗口
- 6+ 字窗口
- 全句窗口
- 全段滑窗作为主路径
- **整 chunk 双尺度**（无 diff 也在 chunk 上扫 2–3 / 4–5）

---

## 5.1 双尺度：仅在 diff context 内（冻结）

见 [Recover_V5_Frozen_Decisions_2026-05-22.md](./Recover_V5_Frozen_Decisions_2026-05-22.md) D-07。

```text
diff span → context（±2，与 chunk 求交）= region
在 region 内：fine [2,3] + coarse [4,5] 滑窗枚举
无 diff → no_diff_span，不枚举 region
```

**不得**因 chunk 字多而在无 diff 区域补扫窗。

---

## 6. Window Source

每个 window 必须输出：

```json
{
  "windowText": "...",
  "windowStart": 0,
  "windowEnd": 0,
  "windowLength": 3,
  "windowTrigger": "nbest_diff",
  "diffSpanId": "...",
  "hypothesisRank": 2
}
```

---

## 7. Skip 规则

若无 diff span：

```json
{
  "recoverSkipped": true,
  "skipReason": "no_diff_span"
}
```

不得 fallback 到全句滑窗。

---

## 8. Target List

### B-01 新增 diff span detector

建议文件：

```text
asr-repair/windowing/nbest-diff-span.ts
```

### B-02 新增 context expansion

建议文件：

```text
asr-repair/windowing/diff-context.ts
```

### B-03 新增 diff context window enumeration

只生成 2/3/4/5 字 windows。

### B-04 替换 window-recall 主入口

当前 segment sliding window 降级为 legacy/debug，不再主路径。

### B-05 result-builder 输出新指标

新增：

- windows_from_nbest_diff_count
- sliding_window_count
- no_diff_span_count
- window_length_distribution

---

## 9. Check List

- [ ] detectNbestDiffSpans 已实现
- [ ] 支持不等长 diff
- [ ] context 左右扩 2 字
- [ ] 窗长只含 2/3/4/5
- [ ] no diff 时 skipReason=no_diff_span
- [ ] sliding_window_count = 0
- [ ] windowTrigger=nbest_diff
- [ ] 每个 window 可追溯 diffSpanId
- [ ] 不改变 applySentenceRepair
- [ ] 不恢复 full sentence sliding window

---

## 10. 测试计划

新增测试：

- top1 与 top2 单字替换 diff
- 不等长 diff
- insertion/deletion diff
- context expansion 不越界
- window length 只生成 2/3/4/5
- no_diff_span skip

---

## 11. 验收指标

```text
windows_from_nbest_diff / windows_enumerated ≥ 95%
sliding_window_count = 0
window_length_distribution keys ⊆ {2,3,4,5}
no_diff_span 可统计
```
