# Job2 阻塞问题分析

## 问题描述

用户观察：
- Job1 正常处理
- 从 Job2 开始出现问题（ASR 返回空文本）
- 怀疑 Job2 进入 ASR 后产生了阻塞
- 可能原因：Job1 的内容无法被清除

## 上下文传递流程

### 1. Job1 处理流程

1. **Job1 到达** → `InferenceService.processJob()`
2. **构建 context_text**：
   - 如果启用 S1 Prompt，从 `AggregatorState.getRecentCommittedText()` 获取（此时为空）
   - 构建 prompt（此时没有 recentCommittedText，所以 prompt 可能为空）
   - 作为 `context_text` 传递给 ASR 服务
3. **ASR 服务处理**：
   - `use_text_context: true` - 使用 `context_text` 作为 initial_prompt
   - `use_context_buffer: false` - 禁用音频上下文
   - `condition_on_previous_text: false` - 禁用条件化
4. **Job1 完成**：
   - ASR 结果被提交到 Aggregator
   - Aggregator 调用 `updateRecentCommittedText()` 将 Job1 的文本添加到 `recentCommittedText`

### 2. Job2 处理流程

1. **Job2 到达** → `InferenceService.processJob()`
2. **构建 context_text**：
   - 从 `AggregatorState.getRecentCommittedText()` 获取（此时包含 Job1 的文本）
   - 构建 prompt（包含 Job1 的文本）
   - 作为 `context_text` 传递给 ASR 服务
3. **ASR 服务处理**：
   - `use_text_context: true` - 使用 `context_text` 作为 initial_prompt（包含 Job1 的文本）
   - 这可能导致 ASR 服务在识别 Job2 时受到 Job1 的影响

## 可能的问题

### 问题1：Job1 的文本被错误地包含在 Job2 的 context 中

**现象**：
- Job2 的 `context_text` 包含 Job1 的文本
- ASR 服务使用 `use_text_context: true`，会将 `context_text` 作为 initial_prompt
- 如果 Job1 的文本与 Job2 的音频不匹配，可能导致 ASR 识别错误

**检查方法**：
- 查看日志中的 `S1: Building prompt - context_text details`
- 检查 `recentCommittedTextPreview` 是否包含 Job1 的文本
- 检查 `promptPreview` 是否包含 Job1 的文本

### 问题2：ASR 服务内部状态残留

**现象**：
- ASR 服务可能有内部状态（如模型状态、缓存等）
- 即使 `use_context_buffer: false`，某些状态可能仍然存在
- Job1 的状态可能影响 Job2 的识别

**检查方法**：
- 查看 ASR 服务的实现，确认是否有内部状态
- 检查是否有清除机制

### 问题3：音频输入质量问题

**现象**：
- Job2 的音频可能包含大量静音或噪音
- 音频质量差导致 ASR 无法识别

**检查方法**：
- 查看日志中的 `ASR task: Audio input quality check`
- 检查 `rms` 值（应该 > 0.01）
- 检查 `estimatedDurationMs` 是否合理

## 已添加的日志

### 1. Context Text 详细信息
- 位置：`pipeline-orchestrator.ts`
- 日志：`S1: Building prompt - context_text details`
- 包含：
  - `originalContextText` - 原始 context_text
  - `recentCommittedTextCount` - 最近提交的文本数量
  - `recentCommittedTextPreview` - 最近提交的文本预览（前3条）
  - `promptPreview` - 构建的 prompt 预览

### 2. 音频输入质量检查
- 位置：`task-router.ts`
- 日志：`ASR task: Audio input quality check`
- 包含：
  - `audioDataLength` - 音频数据长度
  - `estimatedDurationMs` - 估计的音频时长
  - `rms` - RMS 值（归一化到 0-1）
  - `contextTextLength` - context_text 长度
  - `contextTextPreview` - context_text 预览

## 建议的修复方案

### 方案1：禁用 S1 Prompt 用于 Job2（临时方案）

如果确认是 context_text 导致的问题，可以临时禁用 S1 Prompt：

```typescript
// 在 pipeline-orchestrator.ts 中
if (this.enableS1PromptBias && job.utterance_index === 0) {
  // 只对第一个 utterance 启用 S1 Prompt
  // ...
}
```

### 方案2：检查并清除 ASR 服务状态

如果 ASR 服务有内部状态，需要添加清除机制：

```typescript
// 在 task-router.ts 中，每次调用 ASR 服务前
// 如果 utterance_index > 0，清除 ASR 服务状态
if (task.utterance_index && task.utterance_index > 0) {
  // 调用 ASR 服务的 reset 端点
  await httpClient.post(`${endpoint.baseUrl}/reset`, {
    reset_context: true,
    reset_text_context: true,
  });
}
```

### 方案3：调整 context_text 传递逻辑

如果确认 Job1 的文本不应该包含在 Job2 的 context 中：

```typescript
// 在 pipeline-orchestrator.ts 中
// 只使用最近提交的文本，不包括当前 utterance 之前的文本
const recentCommittedText = (state as any).getRecentCommittedText();
// 过滤掉与当前 utterance 相关的文本
const filteredRecentText = recentCommittedText.filter(/* ... */);
```

## 下一步

1. **重新测试**，查看新增的日志
2. **检查 context_text** 是否包含 Job1 的文本
3. **检查音频输入质量**，确认是否有问题
4. **根据日志结果**，决定采用哪个修复方案

## 相关文件

- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - Context text 构建
- `electron_node/electron-node/main/src/task-router/task-router.ts` - ASR 任务路由和音频质量检查
- `electron_node/electron-node/main/src/aggregator/aggregator-state.ts` - RecentCommittedText 管理

