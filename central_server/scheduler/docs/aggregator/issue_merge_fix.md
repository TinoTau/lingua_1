# AggregatorMiddleware 未合并问题修复

**日期**: 2026-01-24  
**问题**: AggregatorMiddleware 已启用，但所有 job 都被判定为 `NEW_STREAM`，文本未被合并

---

## 一、问题确认

### 1.1 AggregatorMiddleware 已生效

✅ **日志确认**：
- `hasAggregatorManager: true`
- `"S1: AggregatorManager passed to InferenceService for prompt building"`
- `"AggregatorMiddleware passed to InferenceService for pre-NMT aggregation"`
- `AggregationStage: Processing completed with forward merge`

### 1.2 但所有 job 都被判定为 NEW_STREAM

❌ **日志显示**：
- `utterance_index=0`: `action: "NEW_STREAM"`（正常，第一个 utterance）
- `utterance_index=2`: `action: "NEW_STREAM"`, `reason: "Last utterance had manual cut, starting new stream"`
- `utterance_index=5`: `action: "NEW_STREAM"`, `reason: "Last utterance had manual cut, starting new stream"`
- `utterance_index=8`: `action: "NEW_STREAM"`, `reason: "Last utterance had manual cut, starting new stream"`

### 1.3 关键发现

**日志显示**：
- `gapMs: 0` - 所有 job 的 `gapMs` 都是 0（说明音频是连续的）
- `lastUtteranceIsManualCut: true` - 上一个 utterance 有手动截断标识
- **问题**：即使 `gapMs=0`（音频连续），因为 `isManualCut=true`，仍然被强制判定为 `NEW_STREAM`

---

## 二、根本原因

### 2.1 问题链条

```
客户端发送 is_final=true（静音检测或手动发送）
    ↓
调度器立即 finalize（reason="IsFinal"）
    ↓
调度器设置 is_manual_cut=true（因为 reason == "IsFinal"）
    ↓
节点端接收 job，is_manual_cut=true
    ↓
AggregatorStateActionDecider.decideAction()
    ↓
检查 lastUtterance.isManualCut === true
    ↓
强制返回 NEW_STREAM（不调用 decideStreamAction()）
    ↓
文本未被合并（即使 gapMs=0，文本不完整）
```

### 2.2 关键代码

**调度器**（`actor_finalize.rs:161`）：
```rust
let is_manual_cut = reason == "IsFinal";
```

**节点端**（`aggregator-state-action-decider.ts:29`，修复前）：
```typescript
if (lastUtterance && lastUtterance.isManualCut) {
  return 'NEW_STREAM';  // ❌ 强制返回，不调用 decideStreamAction()
}
```

**问题**：当 `lastUtterance.isManualCut === true` 时，`AggregatorStateActionDecider` 会**直接返回 `NEW_STREAM`**，不会调用 `decideStreamAction()` 进行正常决策（基于时间间隔、文本完整性等）。

---

## 三、修复方案

### 3.1 修复逻辑

**修改**：即使 `isManualCut=true`，也允许基于时间间隔的正常决策。只有在时间间隔很长（如 > 5秒）时，才强制 `NEW_STREAM`。

**修复后的代码**（`aggregator-state-action-decider.ts`）：
```typescript
if (lastUtterance && lastUtterance.isManualCut) {
  const gapMs = Math.max(0, currentUtterance.startMs - lastUtterance.endMs);
  const MANUAL_CUT_FORCE_NEW_STREAM_GAP_MS = 5000; // 5秒
  
  if (gapMs > MANUAL_CUT_FORCE_NEW_STREAM_GAP_MS) {
    // 时间间隔很长（> 5秒），强制 NEW_STREAM
    return 'NEW_STREAM';
  } else {
    // 时间间隔很短（< 5秒），允许正常决策（基于 gapMs、文本完整性等）
    // 这样可以合并被过早 finalize 的短音频片段
  }
}
// 正常决策（包括 isPauseTriggered 的情况，通过 gapMs 等正常判断）
return decideStreamAction(lastUtterance, currentUtterance, this.mode, this.tuning);
```

### 3.2 预期效果

修复后：
1. 即使 `isManualCut=true`，如果 `gapMs < 5秒`，也会调用 `decideStreamAction()` 进行正常决策
2. `decideStreamAction()` 会根据：
   - `gapMs`（时间间隔）
   - `textIncompletenessScore`（文本未完成度）
   - `strongMergeMs`（700-1000ms）
   - `softGapMs`（1000-1200ms）
   来决定是 `MERGE` 还是 `NEW_STREAM`
3. 如果 `gapMs <= strongMergeMs`（700-1000ms），会返回 `MERGE`
4. 如果 `gapMs <= softGapMs`（1000-1200ms）且文本不完整，也会返回 `MERGE`

---

## 四、修复完成

### 4.1 修复内容

**文件**: `electron_node/electron-node/main/src/aggregator/aggregator-state-action-decider.ts`

**修改**：
1. ✅ 即使 `isManualCut=true`，也允许基于时间间隔的正常决策
2. ✅ 只有在时间间隔很长（> 5秒）时，才强制 `NEW_STREAM`
3. ✅ 添加详细的日志记录（`logger.debug` 和 `logger.info`）

### 4.2 预期效果

修复后：
- 即使 `isManualCut=true`，如果 `gapMs < 5秒`，也会调用 `decideStreamAction()` 进行正常决策
- 如果 `gapMs <= strongMergeMs`（700-1000ms），会返回 `MERGE`
- 如果 `gapMs <= softGapMs`（1000-1200ms）且文本不完整，也会返回 `MERGE`
- 文本应该能够被合并

---

## 五、验证方法

修复后，检查日志：
1. 应该看到：`"AggregatorStateActionDecider: Allowing normal decision despite manual cut"`（当 `gapMs < 5秒` 时）
2. 应该看到：`"AggregatorDecision: MERGE"`（当 `gapMs <= strongMergeMs` 或文本不完整时）
3. 应该看到：多个 job 的文本被合并

---

## 六、总结

**根本原因**：
- `AggregatorStateActionDecider` 在 `isManualCut=true` 时强制返回 `NEW_STREAM`，不会调用 `decideStreamAction()` 进行正常决策
- 即使 `gapMs=0`（音频连续），文本不完整，也不会合并

**修复方案**：
- 即使 `isManualCut=true`，也允许基于时间间隔的正常决策
- 只有在时间间隔很长（> 5秒）时，才强制 `NEW_STREAM`
- 这样可以合并被过早 finalize 的短音频片段

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
