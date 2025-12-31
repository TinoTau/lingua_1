# S1/S2 禁用回退说明

## 回退日期
2025-01-XX

## 回退原因

用户反馈问题严重：
1. **识别文本非常差**：同音字太多（如"語應"应该是"语音"，"硬片"应该是"音频"）
2. **没有音频返回**
3. **有丢失的任务**
4. **直接报错**

## 回退方案

### 1. 添加 Feature Flag

在 `node-config.ts` 中添加了两个新的 feature flag：

```typescript
features?: {
  /** 是否启用 S1 Prompt Bias（默认 false，暂时禁用） */
  enableS1PromptBias?: boolean;
  /** 是否启用 S2 Rescoring（默认 false，已禁用） */
  enableS2Rescoring?: boolean;
}
```

**默认值**：
- `enableS1PromptBias: false` - 默认禁用 S1
- `enableS2Rescoring: false` - 默认禁用 S2（之前已禁用）

### 2. PipelineOrchestrator 修改

**修改位置**：`pipeline-orchestrator.ts`

**修改内容**：
1. 添加 `enableS1PromptBias` 字段
2. 在构造函数中读取 feature flag
3. 仅在 `enableS1PromptBias === true` 时初始化 `PromptBuilder`
4. 在 `processJob()` 和 `processASROnly()` 中检查 feature flag 再构建 prompt

**关键代码**：
```typescript
// 读取 Feature Flag
this.enableS1PromptBias = config.features?.enableS1PromptBias ?? false;

// 仅在启用时初始化
if (aggregatorManager && this.enableS1PromptBias) {
  this.promptBuilder = new PromptBuilder(mode);
}

// 仅在启用时构建 prompt
if (this.enableS1PromptBias && this.aggregatorManager && this.promptBuilder && job.session_id) {
  // 构建 prompt...
}
```

### 3. 回退效果

**禁用 S1 后**：
- ✅ 不再构建 prompt
- ✅ 不再使用 `recentCommittedText` 和 `recentKeywords`
- ✅ 保留原有的 `context_text`（如果调度服务器传递了）
- ✅ 回到 aggregator 刚完成时的状态（只使用 aggregator 的文本聚合功能，不使用 S1 prompt）

**禁用 S2 后**：
- ✅ 不再进行 rescoring（之前已禁用）
- ✅ 不再使用 `NeedRescoreDetector`、`Rescorer`、`CandidateProvider`

## 如何启用/禁用

### 方法 1：修改配置文件

编辑 `electron-node-config.json`（在用户数据目录）：
```json
{
  "features": {
    "enableS1PromptBias": false,  // false = 禁用，true = 启用
    "enableS2Rescoring": false
  }
}
```

### 方法 2：代码中修改默认值

在 `node-config.ts` 中修改：
```typescript
features: {
  enableS1PromptBias: false,  // 改为 true 启用
  enableS2Rescoring: false,
}
```

## 验证方法

### 1. 检查日志

禁用 S1 后，应该看到：
```
PipelineOrchestrator: S1 PromptBias disabled via feature flag
```

不应该看到：
```
S1: Prompt built and applied to ASR task
```

### 2. 检查识别结果

禁用 S1 后：
- 识别结果应该回到之前的状态（aggregator 刚完成时）
- 不应该有 S1 prompt 导致的错误传播
- 同音字错误应该减少（因为不再使用错误的 recent context）

## 当前状态

- ✅ **S1 Prompt Bias**: 默认禁用（`enableS1PromptBias: false`）
- ✅ **S2 Rescoring**: 默认禁用（`enableS2Rescoring: false`）
- ✅ **Aggregator**: 仍然启用（文本聚合功能不受影响）

## 后续计划

1. **调查问题根源**：
   - 查看三端日志，定位识别错误、音频丢失、任务丢失和报错的原因
   - 分析 S1 prompt 是否导致错误传播

2. **修复问题**：
   - 如果问题与 S1 无关，修复后可以重新启用
   - 如果问题与 S1 相关，需要优化 prompt 构建逻辑

3. **重新启用**：
   - 修复问题后，可以通过 feature flag 重新启用 S1
   - 建议先在小范围测试，确认效果后再全面启用

## 注意事项

1. **不要删除代码**：只是通过 feature flag 禁用，代码仍然保留，方便后续调试和修复
2. **保留日志**：禁用后仍然保留相关日志，方便分析问题
3. **渐进式启用**：如果后续重新启用，建议先在小范围测试

