# AggregatorMiddleware 功能说明

**日期**: 2026-01-24  
**最后更新**: 2026-01-24

---

## 一、概述

`AggregatorMiddleware` 是一个**文本聚合与边界重建模块**，用于解决以下问题：

1. **Utterance 过碎**：将多个短小的 utterance 合并成完整的句子
2. **边界重复**：去除相邻 utterance 之间的重复文本
3. **语言抖动误切**：防止因语言检测不稳定导致的错误切分
4. **短尾单独输出**：减少过短的文本片段单独输出

---

## 二、启用状态

### 2.1 备份代码中的启用状态

**文件**: `expired/lingua_1-main/electron_node/electron-node/main/src/agent/node-agent.ts`

```typescript
// 第109-119行
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: true,  // ✅ 备份代码中 AggregatorMiddleware 是启用的
  mode: 'offline',
  ttlMs: 5 * 60 * 1000,  // 5 分钟 TTL
  maxSessions: 500,
  translationCacheSize: 200,
  translationCacheTtlMs: 10 * 60 * 1000,
  enableAsyncRetranslation: true,
  asyncRetranslationThreshold: 50,
};
this.aggregatorMiddleware = new AggregatorMiddleware(aggregatorConfig, taskRouter);
```

**结论**：✅ **备份代码中 AggregatorMiddleware 是启用的**（`enabled: true`）

### 2.2 当前代码中的启用状态

✅ **当前代码中已启用 AggregatorMiddleware**（`enabled: true`），配置与备份代码一致。

---

## 三、处理流程

### 3.1 调用时机

在 ASR 之后、NMT 之前调用

### 3.2 核心方法

**核心方法**：`processASRResult(job, asrResult)`

### 3.3 处理步骤

1. **调用 AggregatorManager.processUtterance()**：
   ```typescript
   const aggregatorResult = this.manager.processUtterance(
     job.session_id,
     asrTextTrimmed,
     segments,
     langProbs,
     qualityScore,
     true,  // isFinal: P0 只处理 final 结果
     isManualCut,
     mode
   );
   ```

2. **决策结果**：
   - `action: 'MERGE'` - 当前文本应该与之前的文本合并
   - `action: 'NEW_STREAM'` - 当前文本是新的独立句子
   - `shouldCommit: true/false` - 是否应该提交（发送给 NMT）

3. **文本聚合**：
   - 如果 `shouldCommit=true` 且 `aggregatorResult.text` 存在，使用聚合后的文本
   - 如果 `action='MERGE'` 但 `shouldCommit=false`，强制 flush pending 文本

4. **去重检查**：
   ```typescript
   const duplicateCheck = this.deduplicationHandler.isDuplicate(
     job.session_id,
     aggregatedText,
     job.job_id,
     job.utterance_index
   );
   ```
   - 检查是否与上次发送的文本完全相同
   - 检查是否有重叠（overlap）
   - 如果有重叠，进行去重处理

5. **返回结果**：
   ```typescript
   return {
     aggregatedText: finalText,  // 聚合后的文本
     shouldProcess: finalText.trim().length > 0,  // 是否应该处理（发送给 NMT）
     action: aggregatorResult.action,  // MERGE 或 NEW_STREAM
     metrics: aggregatorResult.metrics,  // 去重统计等
   };
   ```

---

## 四、AggregatorManager 的决策逻辑

### 4.1 决策依据

`AggregatorManager.processUtterance()` 会根据以下因素决定是 MERGE 还是 NEW_STREAM：

1. **时间间隔**：
   - `hard_gap_ms`: 硬间隔（如 2000ms），超过此间隔认为是新句子
   - `soft_gap_ms`: 软间隔（如 1500ms），在此范围内可能合并
   - `strong_merge_ms`: 强合并间隔（如 700ms），在此范围内强制合并

2. **文本未完成度**（Text Incompleteness Score）：
   - 判断当前文本是否完整（是否以句号、问号等结尾）
   - 不完整的文本更可能被合并

3. **语言稳定性**（Language Stability Gate）：
   - 检查语言检测是否稳定
   - 防止因语言抖动导致的错误切分

4. **文本长度**：
   - 短文本（如 < 6 字符）可能被合并
   - 长文本（如 > 40 字符）可能被截断

5. **时间戳**：
   - 从 ASR segments 推导 utterance 的时间戳
   - 根据时间间隔判断是否应该合并

### 4.2 决策结果

**MERGE**：
- 当前文本应该与之前的 pending 文本合并
- 合并后的文本会在 `shouldCommit=true` 时提交
- 如果 `isFinal=true` 但 `shouldCommit=false`，会强制 flush pending 文本

**NEW_STREAM**：
- 当前文本是新的独立句子
- 直接使用当前文本，不进行合并

---

## 五、去重功能

### 5.1 去重检查

`DeduplicationHandler.isDuplicate()` 会检查：

1. **完全重复**：
   - 当前文本与上次发送的文本完全相同
   - 返回 `isDuplicate: true`，`shouldProcess: false`

2. **重叠检测**：
   - 检查当前文本是否与上次发送的文本有重叠
   - 如果有重叠，使用 `dedupMergePrecise()` 进行去重
   - 返回去重后的文本

### 5.2 去重示例

**场景**：
- 上次发送：`"開始進行一次語音識別"`
- 当前文本：`"語音識別穩定性測試"`

**去重后**：
- 合并为：`"開始進行一次語音識別穩定性測試"`

---

## 六、配置参数

### 6.1 备份代码配置

```typescript
{
  enabled: true,  // ✅ 启用
  mode: 'offline',  // 离线模式
  ttlMs: 5 * 60 * 1000,  // 5 分钟 TTL
  maxSessions: 500,  // 最大会话数
  translationCacheSize: 200,  // 翻译缓存大小
  translationCacheTtlMs: 10 * 60 * 1000,  // 翻译缓存过期时间
  enableAsyncRetranslation: true,  // 异步重新翻译
  asyncRetranslationThreshold: 50,  // 异步重新翻译阈值
}
```

### 6.2 模式配置（Offline）

- `hard_gap_ms`: 2000ms（硬间隔）
- `soft_gap_ms`: 1500ms（软间隔）
- `strong_merge_ms`: 700ms（强合并间隔）
- `commit_interval_ms`: 1200-1500ms（提交间隔）
- `tail_carry_tokens`: 1-3 token / CJK 2-6 字（尾巴延迟归属）

---

## 七、常见问题

### 7.1 为什么所有 job 都被判定为 NEW_STREAM？

**原因**：
- 如果 `lastUtterance.isManualCut === true`，`AggregatorStateActionDecider` 会强制返回 `NEW_STREAM`
- 即使 `gapMs=0`（音频连续），因为 `isManualCut=true`，仍然被强制判定为 `NEW_STREAM`

**解决方案**：
- 检查调度器的 `is_manual_cut` 设置逻辑
- 考虑在 `AggregatorStateActionDecider` 中增加时间间隔检查，即使 `isManualCut=true`，如果时间间隔很短，也应该允许合并

### 7.2 为什么文本未被合并？

**可能原因**：
1. `AggregatorMiddleware` 未启用（`enabled: false`）
2. 所有 job 都被判定为 `NEW_STREAM`（见问题 7.1）
3. `shouldCommit=false` 且未强制 flush pending 文本

**解决方案**：
- 检查 `hasAggregatorManager` 日志
- 检查 `action` 日志（应该是 `MERGE` 而不是 `NEW_STREAM`）
- 检查 `shouldCommit` 日志

---

## 八、总结

### 8.1 核心功能

1. **文本聚合**：将多个短小的 utterance 合并成完整的句子
2. **边界去重**：去除相邻 utterance 之间的重复文本
3. **智能决策**：根据时间间隔、文本完整性、语言稳定性等因素决定是否合并
4. **去重处理**：检测并处理完全重复和重叠文本

### 8.2 修复状态

✅ **已修复**：当前代码中已启用 AggregatorMiddleware（`enabled: true`），配置与备份代码一致

---

## 九、相关文档

- [UtteranceAggregator 配置对比](./utterance_aggregator.md)
- [任务管理](../job/README.md)
- [音频处理](../audio/README.md)
- [Finalize 处理机制](../finalize/README.md)

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24
