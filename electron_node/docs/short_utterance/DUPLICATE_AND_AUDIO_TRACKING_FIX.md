# 重复返回和音频追踪修复

## 修复日期
2025-01-XX

## 问题描述

### 1. 重复返回问题
- **现象**：停止说话后，返回了两次相同的结果
- **最后一句重复**："这些漏掉的音频 但是不知道是什么的，可以看到最后一句还是重复的内容"

### 2. 音频数量不一致
- **现象**：用户怀疑有音频被丢弃
- **需要验证**：web端发出的和节点端返回的音频数量是否一致

## 已实施的修复

### 修复1：改进重复检测逻辑 ✅

#### 1.1 文本规范化
- **问题**：只使用 `trim()` 可能无法检测有细微差异的重复文本（如多个空格、换行符等）
- **修复**：使用更严格的文本规范化
  ```typescript
  const normalizeText = (text: string): string => {
    return text.replace(/\s+/g, ' ').trim();
  };
  ```
- **效果**：将所有空白字符（空格、换行、制表符等）统一为单个空格，然后trim

#### 1.2 相似度检测
- **新增**：如果文本相似度>95%，也视为重复
- **实现**：`calculateTextSimilarity` 方法
- **效果**：可以检测几乎相同但略有差异的重复文本

#### 1.3 多层重复检测
- **AggregatorState**：检测与 `lastCommittedText` 的重复
- **AggregatorMiddleware**：检测与 `lastSentText` 的重复
- **NodeAgent**：再次检测与 `lastSentText` 的重复（双重保护）

### 修复2：增强日志记录 ✅

#### 2.1 音频处理日志
- **新增**：记录每个job的音频信息
  - `audioLength`: 音频数据长度
  - `audioFormat`: 音频格式
  - `utteranceIndex`: utterance索引

#### 2.2 结果发送日志
- **新增**：记录每个job_result的详细信息
  - `textAsrLength`: ASR文本长度
  - `ttsAudioLength`: TTS音频长度
  - `utteranceIndex`: utterance索引

#### 2.3 S1 Prompt日志
- **增强**：更详细的prompt构建日志
  - `promptPreview`: prompt内容预览
  - `keywordCount`: 关键词数量
  - `recentCount`: 最近文本数量

## 代码修改

### 1. AggregatorMiddleware
- ✅ 改进重复检测逻辑（规范化文本 + 相似度检测）
- ✅ 添加 `calculateTextSimilarity` 方法
- ✅ 改进 `setLastSentText` 方法（规范化存储）

### 2. NodeAgent
- ✅ 改进重复检测逻辑（规范化文本比较）
- ✅ 增强日志记录（音频信息和结果信息）

### 3. AggregatorState
- ✅ 改进重复检测逻辑（规范化文本比较）

### 4. PipelineOrchestrator
- ✅ 增强S1 Prompt日志记录

## 验证方法

### 1. 检查重复检测日志
查看日志中是否有：
- `Skipping duplicate text (same as last sent after normalization)`
- `Skipping duplicate job result (same as last sent after normalization)`
- `Detected duplicate with last committed text (after normalization)`

### 2. 检查音频处理日志
查看日志中是否有：
- `Processing job: received audio data` - 记录接收的音频
- `Sending job_result to scheduler` - 记录发送的结果
- 对比 `utteranceIndex` 和 `audioLength` 是否一致

### 3. 检查S1 Prompt日志
查看日志中是否有：
- `S1: Prompt built and applied to ASR task` - prompt构建成功
- `S1: Prompt not built (no context available)` - prompt未构建

## 预期效果

### 重复返回问题
- ✅ **更严格的重复检测**：规范化文本比较 + 相似度检测
- ✅ **多层保护**：AggregatorState + AggregatorMiddleware + NodeAgent
- ✅ **预期改善**：应该能够检测并阻止大部分重复返回

### 音频追踪
- ✅ **详细日志**：可以追踪每个音频的处理流程
- ✅ **数量对比**：可以对比接收和发送的数量
- ✅ **问题定位**：可以快速定位音频丢失的位置

### S1 Prompt
- ✅ **详细日志**：可以确认prompt是否正常工作
- ✅ **内容预览**：可以查看prompt的实际内容
- ✅ **问题诊断**：可以诊断prompt构建失败的原因

## 下一步

1. **重新编译并测试**
2. **检查日志**：
   - 查看重复检测是否正常工作
   - 查看音频处理流程
   - 查看S1 Prompt是否正常工作
3. **验证效果**：
   - 测试停止说话后是否还会重复返回
   - 对比音频数量是否一致
   - 验证识别准确率是否提升

