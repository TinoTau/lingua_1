# Pinyin IME v2 SpanSelector 开发方案（V1.1补充章节）

---

# 十三、代码事实校正

## 13.1 Proposal 与 Normalizer 职责

### Proposal

实际负责：

```text
diffSpans
instabilityRegions
boundaryCompatibleTopKSpans
```

边界发现：

```text
applyBoundaryDiscovery()
```

属于 Proposal 阶段。

---

### Normalizer

实际负责：

```text
interval merge
single-char filter
syllable range filter
maxSpanChars filter
```

不负责：

```text
boundary discovery
```

---

## 13.2 SpanSelector 与 Normalizer 调用关系

当前结构：

```text
resolvePinyinImeV2Spans
↓
runPinyinImeV2HintGate
    ↓
    normalizePinyinImeV2Spans
```

改造后：

```text
resolvePinyinImeV2Spans
↓
selectPinyinImeV2Spans
    ↓
    normalizePinyinImeV2Spans
```

保持现有调用层级。

禁止将 Normalizer 提升到 Resolve 层。

---

## 13.3 SelectedSpan 输出结构

排序字段：

```text
neighborHit
supportCount
score
```

仅允许存在于：

```text
SpanSelector 内部
```

禁止进入：

```text
FwSpan
Apply
KenLM
```

输出结构继续保持：

```typescript
{
  rawSpan,
  start,
  end,
  confidence,
  reason
}
```

避免影响下游。

---

# 十四、冻结约束

## 14.1 禁止修改范围

本阶段禁止修改：

```text
local-span-recall.ts
fw-sentence-rerank-pipeline.ts
rerank-fw-sentences.ts
apply-span-replacements.ts
ToneModule
KenLM
```

---

## 14.2 DirectRepair

必须保持：

```typescript
directRepair = false
```

不得恢复。

---

## 14.3 Neighbor Probe

允许保留：

```typescript
lexiconNearNeighbor()
```

但用途修改为：

```text
ranking signal
```

禁止作为：

```text
veto condition
```

---

# 十五、排序冻结

## 15.1 排序权重

冻结：

```text
neighborHit      +1000
supportCount     +10 * supportCount
boundaryTopK     +100
instability      +50
```

---

## 15.2 Tie Break

固定：

```text
start asc
```

与现 HintGate 保持一致。

---

## 15.3 MinSupportCount

调整为：

```text
ranking feature
```

不再承担：

```text
hard veto
```

---

# 十六、兼容层策略

## 16.1 Diagnostics Alias

保留一轮：

```text
approvedSpanCount
gateDroppedNoNeighbor
gateDroppedMaxSpans
no_approved_spans
```

---

映射：

```text
selectedSpanCount
legacyGateDroppedNoNeighbor
cappedByMaxSpansCount
no_selected_spans
```

---

## 16.2 API Alias

保留：

```typescript
runPinyinImeV2HintGate
```

作为：

```typescript
selectPinyinImeV2Spans
```

包装器。

周期：

```text
至少一轮版本
```

---

# 十七、双层 Diagnostics

## 内层

SpanSelectorDiagnostics

新增：

```typescript
selectionMode
normalizedSpanCount
neighborHitCount
neighborMissCount
cappedByMaxSpansCount
```

---

## 外层

PinyinImeV2ActiveDiagnostics

新增：

```typescript
selectedSpanCount
selectionMode
cappedByMaxSpansCount
```

---

要求：

```text
gateDroppedMaxSpans
```

首次透传到外层。

---

# 十八、冻结冲突处理

以下历史文档必须新增例外说明：

```text
Domain_Constrained_Recall_P2
ToneModule_P0
KenLM_Blocking_Audit
ARCHITECTURE.md
```

统一说明：

```text
HintGate 已降级为 SpanSelector

neighbor 保留

但不再承担 veto 职责
```

---

# 十九、验收补充

新增验收：

```text
selectionMode=all_passed ≥ 105
```

```text
selectionMode=ranked_capped ≥ 1
```

```text
legacyGateDroppedNoNeighbor > 0
且 selectedSpanCount > 0
```

证明：

```text
neighbor veto 已移除
```

---

新增：

```text
false positive span report
```

以及：

```text
fw_detector_step_ms P95
```

监控。

---

# 二十、预期管理

本阶段目标：

```text
d002进入span
```

不是：

```text
d002成功apply
```

---

d001：

```text
仍然失败
```

属于：

```text
proposal
normalizer
```

问题。

---

预计剩余：

```text
no_spans ≈ 94
```

属于：

```text
normalizer
proposal
non-CJK
```

范围。

不属于 SpanSelector 任务。
