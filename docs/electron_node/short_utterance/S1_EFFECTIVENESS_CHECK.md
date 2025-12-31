# S1 Prompt 生效检查与问题排查

## 问题描述

从开发 S1 之后识别率下降了很多，需要检查 S1 是否正常工作，以及是否导致了识别率下降。

---

## 检查 S1 是否生效

### 1. 检查 S1 初始化日志

**日志关键字**：
```
PipelineOrchestrator: S1 PromptBuilder initialized
S1: AggregatorManager passed to InferenceService for prompt building
```

**检查方法**：
- 在节点端启动日志中搜索这些关键字
- 如果**没有找到**，说明 S1 未正确初始化

**可能原因**：
- `AggregatorManager` 未传递给 `PipelineOrchestrator`
- `NodeAgent` 未正确调用 `InferenceService.setAggregatorManager()`

---

### 2. 检查 S1 Prompt 构建日志

**日志关键字**：
```
S1: Prompt built and applied to ASR task
S1: Prompt not built (no context available)
S1: Failed to build prompt, using original context_text
```

**检查方法**：
- 在处理每个 job 时，应该看到其中一条日志
- 如果看到 `S1: Prompt built and applied to ASR task`，说明 S1 正在工作

**日志内容**（`S1: Prompt built and applied to ASR task`）：
```json
{
  "jobId": "...",
  "sessionId": "...",
  "promptLength": 123,
  "hasKeywords": true/false,
  "hasRecent": true/false,
  "keywordCount": 5,
  "recentCount": 2,
  "promptPreview": "[CONTEXT]\nKeywords:\n- ..."
}
```

**关键字段**：
- `promptLength`: prompt 的长度（应该 > 0）
- `hasKeywords`: 是否有关键词
- `hasRecent`: 是否有最近上下文
- `promptPreview`: prompt 的前 100 个字符（可以查看实际内容）

---

### 3. 检查 ASR 任务中的 context_text

**检查方法**：
- 在 `TaskRouter.routeASRTask()` 的日志中，查看 `context_text` 字段
- 或者在 ASR 服务端日志中，查看接收到的 `context_text` 参数

**预期内容**：
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

**如果 context_text 为空或不是上述格式**：
- 说明 S1 未生效，或者构建失败

---

## 可能导致识别率下降的原因

### 1. S1 Prompt 内容错误

**问题**：
- prompt 中包含了错误的上下文信息
- 错误的上下文可能误导 ASR 识别

**检查方法**：
- 查看 `promptPreview` 字段，检查 prompt 内容是否合理
- 检查 `recentCommittedText` 是否包含错误的识别结果

**示例问题**：
```
[CONTEXT]
Keywords:
- 错误的关键词
Recent:
这是错误的识别结果
这也是错误的识别结果
[/CONTEXT]
```

如果 prompt 中包含了错误的识别结果，ASR 可能会被误导，导致后续识别也出错。

---

### 2. S1 Prompt 过长或格式问题

**问题**：
- prompt 过长可能导致 ASR 服务处理异常
- prompt 格式不正确可能导致 ASR 服务无法正确解析

**检查方法**：
- 查看 `promptLength` 字段，应该 < 600（offline）或 < 500（room）
- 查看 `promptPreview` 字段，检查格式是否正确

**预期格式**：
```
[CONTEXT]
Keywords:
- keyword1
- keyword2
Recent:
recent line 1
recent line 2
[/CONTEXT]
```

---

### 3. S1 Prompt 覆盖了原有的 context_text

**问题**：
- 代码中，如果构建了 prompt，会**替换**原有的 `context_text`
- 如果原有的 `context_text` 包含重要信息，可能会丢失

**代码位置**：
```typescript
// pipeline-orchestrator.ts 第 91-93 行
if (prompt) {
  // 如果原有context_text存在，可以合并或替换
  // 这里选择替换，因为prompt包含了更完整的上下文信息
  contextText = prompt;
}
```

**检查方法**：
- 查看 job 中是否包含 `context_text` 字段
- 如果原有 `context_text` 被替换，可能导致识别率下降

---

### 4. S1 Prompt 在低质量时仍然使用错误的上下文

**问题**：
- 代码中有质量门控：如果 `qualityScore < 0.4`，只启用 keywords，禁用 recent context
- 但如果之前的识别结果都是错误的，keywords 也可能包含错误信息

**代码位置**：
```typescript
// prompt-builder.ts 第 52-54 行
const enableRecent = this.config.enableRecentContext && 
  (ctx.qualityScore === undefined || ctx.qualityScore >= 0.4);
```

**检查方法**：
- 查看 `hasRecent` 字段，如果 `qualityScore < 0.4`，应该为 `false`
- 查看 `hasKeywords` 字段，检查关键词是否合理

---

### 5. AggregatorState 中的 recentCommittedText 包含错误结果

**问题**：
- `recentCommittedText` 是从 `AggregatorState` 中获取的
- 如果之前的识别结果都是错误的，这些错误结果会被用作上下文

**检查方法**：
- 查看 `recentCount` 字段，检查最近文本的数量
- 查看 `promptPreview` 字段，检查最近文本的内容是否合理

---

## 排查步骤

### 步骤 1: 检查 S1 是否初始化

```bash
# 在节点端启动日志中搜索
grep "S1 PromptBuilder initialized" node.log
grep "AggregatorManager passed to InferenceService" node.log
```

**如果没有找到**：
- 检查 `NodeAgent` 是否正确传递了 `AggregatorManager`
- 检查 `InferenceService` 是否正确调用了 `setAggregatorManager()`

---

### 步骤 2: 检查 S1 是否在构建 prompt

```bash
# 在处理 job 时搜索
grep "S1: Prompt built and applied" node.log
grep "S1: Prompt not built" node.log
grep "S1: Failed to build prompt" node.log
```

**如果看到 `S1: Prompt built and applied`**：
- 记录 `promptLength`、`hasKeywords`、`hasRecent`、`promptPreview`
- 检查 prompt 内容是否合理

**如果看到 `S1: Prompt not built`**：
- 说明没有关键词或最近文本，S1 未生效（这是正常的，如果 session 刚开始）

**如果看到 `S1: Failed to build prompt`**：
- 说明 S1 构建失败，使用了原始 `context_text`（降级处理）

---

### 步骤 3: 检查 prompt 内容

**查看 prompt 的实际内容**：
```bash
# 搜索包含 promptPreview 的日志
grep "promptPreview" node.log | head -20
```

**检查点**：
1. prompt 格式是否正确（`[CONTEXT]` ... `[/CONTEXT]`）
2. Keywords 是否合理（不应该包含明显的错误）
3. Recent 文本是否合理（不应该包含明显的错误）
4. prompt 长度是否合理（< 600 字符）

---

### 步骤 4: 对比识别结果

**方法**：
1. 记录使用 S1 时的识别结果
2. 临时禁用 S1（注释掉 prompt 构建代码）
3. 对比识别结果

**临时禁用 S1**：
```typescript
// pipeline-orchestrator.ts 第 73 行
// 临时注释掉 S1 逻辑
// if (this.aggregatorManager && this.promptBuilder && job.session_id) {
//   ...
// }
```

---

## 建议的修复方案

### 方案 1: 增强质量门控

**问题**：即使 qualityScore 很低，仍然会使用 keywords，可能包含错误信息

**修复**：
```typescript
// prompt-builder.ts
const enableKeywords = ctx.qualityScore === undefined || ctx.qualityScore >= 0.3;
const enableRecent = this.config.enableRecentContext && 
  (ctx.qualityScore === undefined || ctx.qualityScore >= 0.4);
```

---

### 方案 2: 添加 prompt 验证

**问题**：prompt 可能包含明显错误的内容

**修复**：
- 在构建 prompt 前，验证 `recentCommittedText` 的质量
- 如果质量太低，不使用 recent context

---

### 方案 3: 允许禁用 S1

**问题**：如果 S1 导致识别率下降，应该能够快速禁用

**修复**：
- 添加 Feature Flag：`enableS1Prompt`
- 如果禁用，跳过 prompt 构建，使用原始 `context_text`

---

### 方案 4: 合并而不是替换 context_text

**问题**：当前代码会替换原有的 `context_text`，可能丢失重要信息

**修复**：
```typescript
// pipeline-orchestrator.ts
if (prompt) {
  // 合并而不是替换
  contextText = originalContextText 
    ? `${originalContextText}\n${prompt}` 
    : prompt;
}
```

---

## 总结

### 检查清单

- [ ] S1 是否正确初始化（查看启动日志）
- [ ] S1 是否在构建 prompt（查看 job 处理日志）
- [ ] prompt 内容是否合理（查看 `promptPreview`）
- [ ] prompt 长度是否合理（查看 `promptLength`）
- [ ] 是否覆盖了原有的 `context_text`（检查 job 中的 `context_text`）
- [ ] `recentCommittedText` 是否包含错误结果（查看 `promptPreview` 中的 Recent 部分）

### 如果识别率下降

1. **先检查 S1 是否生效**（查看日志）
2. **如果生效，检查 prompt 内容是否合理**
3. **如果 prompt 包含错误内容，考虑增强质量门控**
4. **如果问题持续，考虑临时禁用 S1 进行对比测试**

