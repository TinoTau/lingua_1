# S1 Prompt 实现总结

## 实现完成时间
2025-01-XX

## 实现内容

### 1. PipelineOrchestrator 扩展
- ✅ 添加 `AggregatorManager` 和 `PromptBuilder` 引用
- ✅ 在构造函数中接收可选的 `AggregatorManager` 和 `mode` 参数
- ✅ 在 `processJob` 中构建 prompt 并传递给 ASRTask
- ✅ 在 `processASROnly` 中构建 prompt 并传递给 ASRTask
- ✅ 在 `processASRStreaming` 中（通过 processJob 创建的 asrTask 已包含 prompt）

### 2. InferenceService 扩展
- ✅ 添加 `aggregatorManager` 私有字段
- ✅ 在构造函数中接收可选的 `aggregatorManager` 参数
- ✅ 添加 `setAggregatorManager` 方法用于动态更新
- ✅ 将 `aggregatorManager` 传递给 `PipelineOrchestrator`

### 3. NodeAgent 集成
- ✅ 在构造函数中，从 `AggregatorMiddleware` 获取 `AggregatorManager`
- ✅ 调用 `InferenceService.setAggregatorManager` 传递 manager

## 数据流

```
NodeAgent
  ↓ (初始化时)
AggregatorMiddleware.manager
  ↓
InferenceService.setAggregatorManager()
  ↓
PipelineOrchestrator (构造函数)
  ↓ (处理job时)
1. 从 AggregatorManager 获取 session state
2. 提取 recentCommittedText 和 userKeywords
3. 使用 PromptBuilder 构建 prompt
4. 将 prompt 设置到 ASRTask.context_text
5. 传递给 TaskRouter.routeASRTask()
6. ASR服务使用 prompt 进行识别
```

## Prompt 构建逻辑

### 输入
- `userKeywords`: 用户配置的关键词（专名、术语、产品名）
- `recentCommittedText`: 最近提交的文本列表（最多5条）
- `qualityScore`: 上一次提交的质量分数（用于门控）

### 处理
1. **质量门控**：如果 `qualityScore < 0.4`，只启用 keywords，禁用 recent context
2. **关键词提取**：
   - 用户配置的关键词（最高优先级）
   - 从最近文本中提取高频词和专名
3. **最近上下文提取**：取最近2条文本，每行最多120字符
4. **压缩**：如果超过 maxChars（offline: 600, room: 500），进行截断

### 输出
```
[CONTEXT]
Keywords:
- <keyword1>
- <keyword2>
Recent:
<recent_line1>
<recent_line2>
[/CONTEXT]
```

## 配置参数

### PromptBuilder 配置
- `maxChars`: offline 600, room 500
- `maxKeywords`: 30
- `maxRecentLines`: 2
- `maxRecentLineChars`: 120
- `enableRecentContext`: 根据 qualityScore 动态控制

## 日志记录

### 成功构建 prompt
```
S1: Prompt built and applied to ASR task
  - jobId, sessionId
  - promptLength
  - hasKeywords, hasRecent
```

### 构建失败（降级）
```
S1: Failed to build prompt, using original context_text
  - error, jobId, sessionId
```

## 测试建议

### 功能测试
1. **短句测试**：发送包含专名的短句，检查是否减少了同音字错误
2. **上下文测试**：连续发送相关文本，检查后续识别是否受益于上下文
3. **关键词测试**：设置用户关键词，检查是否提高了识别准确率

### 性能测试
1. **延迟影响**：测量添加 prompt 后的延迟增加（预期很小）
2. **内存使用**：检查 prompt 构建的内存开销
3. **CPU使用**：检查 prompt 构建的CPU开销

## 预期效果

### 识别准确率提升
- **同音字错误减少**：通过上下文偏置，帮助ASR识别正确的词汇
- **专名识别改善**：用户关键词和最近上下文中的专名更容易被识别
- **短句识别改善**：上下文信息帮助短句识别

### 性能影响
- **延迟增加**：< 10ms（prompt构建和传递）
- **内存增加**：每个session约几KB（存储recentCommittedText）
- **CPU增加**：可忽略（prompt构建是轻量级操作）

## 后续优化

### P1: 动态配置
- 支持运行时更新 prompt 参数
- 支持不同模式（offline/room）的参数切换

### P2: 关键词学习
- 自动从识别结果中学习高频专名
- 动态更新用户关键词列表

### P3: Prompt 优化
- 根据识别结果反馈优化 prompt 内容
- 支持更智能的关键词提取

## 注意事项

1. **降级机制**：如果 prompt 构建失败，自动降级使用原始 context_text
2. **性能保护**：prompt 构建是同步的，但非常快速，不会阻塞主流程
3. **内存管理**：recentCommittedText 有最大数量限制（5条），自动清理过期数据

