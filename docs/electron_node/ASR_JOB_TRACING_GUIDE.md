# ASR Job 处理流程日志追踪指南

## 文档目的
本文档说明如何通过日志追踪每个job在ASR处理流程中的各个步骤，用于问题诊断和调试。

---

## 1. 日志追踪流程概览

### 1.1 完整处理流程

```
Job到达
  ↓
[AudioAggregator] 音频聚合和切分
  ↓
[asr-step] 注册原始job和批次处理
  ↓
[ASR服务] ASR识别
  ↓
[OriginalJobResultDispatcher] ASR结果累积和分发
  ↓
[后续处理] SR、NMT、TTS
```

---

## 2. 关键日志点

### 2.1 AudioAggregator 日志（音频聚合阶段）

#### 2.1.1 音频块接收
**日志关键词**: `AudioAggregator: Audio chunk added to buffer`

**日志字段**:
- `jobId`: 当前job ID
- `sessionId`: 会话ID
- `utteranceIndex`: Utterance索引
- `chunkSizeBytes`: 音频块大小
- `chunkDurationMs`: 音频块时长
- `totalDurationMs`: 累积总时长
- `isTimeoutTriggered`: 是否超时触发

**示例**:
```json
{
  "jobId": "job-123",
  "sessionId": "session-456",
  "utteranceIndex": 2,
  "chunkSizeBytes": 32000,
  "chunkDurationMs": 1000,
  "totalDurationMs": 5000,
  "isTimeoutTriggered": false
}
```

#### 2.1.2 超时finalize处理
**日志关键词**: `AudioAggregator: [TimeoutFinalize]` 或 `AudioAggregator: [TimeoutPending]`

**关键日志**:
- `AudioAggregator: [TimeoutFinalize] Aggregated audio chunks for timeout finalize`
  - `aggregatedAudioSizeBytes`: 聚合音频大小
  - `aggregatedAudioDurationMs`: 聚合音频时长
  - `totalChunks`: 音频块数量

- `AudioAggregator: [Cache] Cached audio to pendingTimeoutAudio, waiting for next job`
  - `pendingAudioDurationMs`: 缓存的音频时长
  - `pendingJobInfoCount`: 缓存的job信息数量

- `AudioAggregator: [TimeoutMerge] Consecutive timeout jobs, merging existing pendingTimeoutAudio with current audio`
  - 连续超时job的合并日志

#### 2.1.3 合并pending音频
**日志关键词**: `AudioAggregator: [TimeoutMerge]` 或 `AudioAggregator: [PauseMerge]`

**关键日志**:
- `AudioAggregator: [TimeoutMerge] Merging pendingTimeoutAudio with current audio for processing`
  - `pendingAudioDurationMs`: pending音频时长
  - `currentAudioDurationMs`: 当前音频时长
  - `mergedAudioDurationMs`: 合并后音频时长
  - `pendingJobInfoCount`: pending job信息数量
  - `currentJobInfoCount`: 当前job信息数量

- `AudioAggregator: [PauseMerge] Merging pendingPauseAudio with current short pause audio`
  - 类似字段，用于pause音频合并

**⚠️ 重要检查点**:
- 检查 `pendingUtteranceIndex` 和 `currentUtteranceIndex` 是否一致
- 如果不一致，应该看到警告日志：`PendingTimeoutAudio belongs to different utterance, clearing it`

#### 2.1.4 音频切分
**日志关键词**: `AudioAggregator: [AudioSplit]` 或 `AudioAggregator: [SplitByEnergy]`

**关键日志**:
- `AudioAggregator: [AudioSplit] Starting audio split by energy`
  - `audioSizeBytes`: 输入音频大小
  - `audioDurationMs`: 输入音频时长

- `AudioAggregator: [AudioSplit] Audio split by energy completed`
  - `inputAudioSizeBytes`: 输入音频大小
  - `outputSegmentCount`: 输出段数量
  - `outputSegmentsDurationMs`: 每段时长数组

#### 2.1.5 流式批次创建
**日志关键词**: `AudioAggregator: [StreamingBatch]`

**关键日志**:
- `AudioAggregator: [StreamingBatch] Creating streaming batches from audio segments`
  - `inputSegmentCount`: 输入段数量
  - `shouldCacheRemaining`: 是否缓存剩余片段

- `AudioAggregator: [StreamingBatch] Streaming batches created`
  - `outputBatchCount`: 输出批次数量
  - `remainingSegmentsCount`: 剩余片段数量
  - `batchesDurationMs`: 每批次时长数组

#### 2.1.6 originalJobIds分配
**日志关键词**: `AudioAggregator: Multiple jobs detected` 或 `AudioAggregator: Independent utterance`

**关键日志**:
- `AudioAggregator: Multiple jobs detected, using container assignment algorithm`
  - `batchCount`: 批次数量
  - `jobInfoCount`: job信息数量

- `AudioAggregator: Independent utterance, using direct assignment`
  - `batchCount`: 批次数量

---

### 2.2 asr-step 日志（ASR处理阶段）

#### 2.2.1 音频缓冲
**日志关键词**: `runAsrStep: Audio buffered, returning empty`

**说明**: 音频被缓冲，等待更多音频或触发标识

#### 2.2.2 原始job注册
**日志关键词**: `runAsrStep: Registering original job with expected segment count`

**关键日志字段**:
- `originalJobId`: 原始job ID
- `isFinalize`: 是否是finalize
- `batchCountForThisJob`: 该job对应的batch数量
- `expectedSegmentCount`: 期望的片段数量（finalize时为batchCount，否则为undefined）
- `totalBatches`: 总批次数量

**示例**:
```json
{
  "originalJobId": "job-123",
  "isFinalize": true,
  "batchCountForThisJob": 3,
  "expectedSegmentCount": 3,
  "totalBatches": 3
}
```

#### 2.2.3 ASR批次处理
**日志关键词**: `runAsrStep: Processing ASR batch`

**关键日志字段**:
- `originalJobId`: 原始job ID
- `segmentIndex`: 批次索引（从0开始）
- `batchDurationMs`: 批次时长
- `isStreaming`: 是否是流式ASR

**示例**:
```json
{
  "originalJobId": "job-123",
  "segmentIndex": 0,
  "batchDurationMs": 5000,
  "isStreaming": true
}
```

#### 2.2.4 ASR结果接收
**日志关键词**: `runAsrStep: ASR result received`

**关键日志字段**:
- `originalJobId`: 原始job ID
- `segmentIndex`: 批次索引
- `asrTextLength`: ASR文本长度
- `segmentCount`: ASR段数量

#### 2.2.5 原始job处理完成
**日志关键词**: `runAsrStep: Original job pipeline completed` 或 `runAsrStep: Original job result sent to scheduler`

**关键日志字段**:
- `originalJobId`: 原始job ID
- `textAsrLength`: ASR文本长度
- `textTranslatedLength`: 翻译文本长度
- `ttsAudioLength`: TTS音频长度
- `shouldSend`: 是否发送

---

### 2.3 OriginalJobResultDispatcher 日志（ASR结果分发阶段）

#### 2.3.1 ASR批次累积
**日志关键词**: `OriginalJobResultDispatcher: [Debug] Accumulating ASR segment`

**关键日志字段**:
- `sessionId`: 会话ID
- `originalJobId`: 原始job ID
- `batchIndex`: 批次索引
- `accumulatedCount`: 已累积的批次数量
- `expectedSegmentCount`: 期望的片段数量

**示例**:
```json
{
  "sessionId": "session-456",
  "originalJobId": "job-123",
  "batchIndex": 0,
  "accumulatedCount": 1,
  "expectedSegmentCount": 3
}
```

#### 2.3.2 文本合并
**日志关键词**: `OriginalJobResultDispatcher: [TextMerge] Merging ASR text`

**关键日志字段**:
- `sessionId`: 会话ID
- `originalJobId`: 原始job ID
- `segmentCount`: 片段数量
- `mergedTextLength`: 合并后文本长度
- `mergedTextPreview`: 合并后文本预览（前100字符）

#### 2.3.3 触发后续处理
**日志关键词**: `OriginalJobResultDispatcher: [Callback] Triggering callback for original job`

**关键日志字段**:
- `sessionId`: 会话ID
- `originalJobId`: 原始job ID
- `segmentCount`: 片段数量
- `isFinalized`: 是否已finalize

#### 2.3.4 强制完成
**日志关键词**: `OriginalJobResultDispatcher: [ForceComplete] Forcing completion`

**关键日志字段**:
- `sessionId`: 会话ID
- `originalJobId`: 原始job ID
- `segmentCount`: 片段数量
- `reason`: 触发原因

---

## 3. 日志追踪方法

### 3.1 按jobId追踪

**PowerShell命令**:
```powershell
# 查找特定job的所有日志
Select-String -Path "electron-main.log" -Pattern "job-123" | Select-Object -First 50

# 查找特定job的ASR处理日志
Select-String -Path "electron-main.log" -Pattern "job-123.*ASR" | Select-Object -First 20
```

### 3.2 按originalJobId追踪

**PowerShell命令**:
```powershell
# 查找特定originalJobId的所有日志
Select-String -Path "electron-main.log" -Pattern "originalJobId.*job-123" | Select-Object -First 50

# 查找原始job的注册和累积日志
Select-String -Path "electron-main.log" -Pattern "Registering original job|Accumulating ASR segment" | Select-String "job-123"
```

### 3.3 按sessionId追踪

**PowerShell命令**:
```powershell
# 查找特定session的所有日志
Select-String -Path "electron-main.log" -Pattern "session-456" | Select-Object -First 100
```

### 3.4 按操作类型追踪

**PowerShell命令**:
```powershell
# 查找所有音频合并操作
Select-String -Path "electron-main.log" -Pattern "TimeoutMerge|PauseMerge" | Select-Object -First 30

# 查找所有音频切分操作
Select-String -Path "electron-main.log" -Pattern "AudioSplit|SplitByEnergy" | Select-Object -First 30

# 查找所有批次创建操作
Select-String -Path "electron-main.log" -Pattern "StreamingBatch" | Select-Object -First 30
```

---

## 4. 问题诊断检查清单

### 4.1 Job4混杂Job1半句话的问题

**检查步骤**:

1. **检查Job1的finalize类型**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "job-1.*isPauseTriggered|job-1.*isManualCut|job-1.*isTimeoutTriggered"
   ```

2. **检查Job1是否有pendingPauseAudio**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "job-1.*pendingPauseAudio|PauseMerge.*job-1"
   ```

3. **检查Job4处理时的pending音频**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "job-4.*pendingPauseAudio|job-4.*pendingTimeoutAudio|job-4.*Checking pending"
   ```

4. **检查utteranceIndex是否一致**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "job-4.*utteranceIndex|PendingPauseAudio belongs to different utterance"
   ```

5. **检查Job4的originalJobIds分配**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "job-4.*originalJobIds|job-4.*container assignment"
   ```

### 4.2 Job5/Job7/Job8重复问题

**检查步骤**:

1. **检查pendingSmallSegments**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "pendingSmallSegments|Remaining small segments"
   ```

2. **检查音频切分结果**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "Audio split by energy completed" | Select-String "job-5|job-7|job-8"
   ```

3. **检查批次创建结果**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "Streaming batches created" | Select-String "job-5|job-7|job-8"
   ```

### 4.3 第四句话丢失问题

**检查步骤**:

1. **检查是否有超时触发**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "isTimeoutTriggered.*true|TimeoutFinalize"
   ```

2. **检查pendingTimeoutAudio是否被处理**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "pendingTimeoutAudio.*TTL|pendingTimeoutAudio.*merged"
   ```

3. **检查是否有未处理的音频**:
   ```powershell
   Select-String -Path "electron-main.log" -Pattern "pendingTimeoutAudio.*waiting|pendingTimeoutAudio.*clearing"
   ```

---

## 5. 日志分析脚本示例

### 5.1 追踪单个job的完整流程

```powershell
# 追踪job-123的完整处理流程
$jobId = "job-123"
$logFile = "electron-main.log"

Write-Host "=== Job $jobId 处理流程追踪 ===" -ForegroundColor Green

# 1. 音频聚合阶段
Write-Host "`n[1] 音频聚合阶段:" -ForegroundColor Yellow
Select-String -Path $logFile -Pattern "AudioAggregator.*$jobId" | 
  Select-Object -First 20 | 
  ForEach-Object { Write-Host $_.Line }

# 2. ASR处理阶段
Write-Host "`n[2] ASR处理阶段:" -ForegroundColor Yellow
Select-String -Path $logFile -Pattern "runAsrStep.*$jobId" | 
  Select-Object -First 20 | 
  ForEach-Object { Write-Host $_.Line }

# 3. ASR结果分发阶段
Write-Host "`n[3] ASR结果分发阶段:" -ForegroundColor Yellow
Select-String -Path $logFile -Pattern "OriginalJobResultDispatcher.*$jobId" | 
  Select-Object -First 20 | 
  ForEach-Object { Write-Host $_.Line }
```

### 5.2 检查utteranceIndex一致性

```powershell
# 检查特定job的utteranceIndex一致性
$jobId = "job-4"
$logFile = "electron-main.log"

Write-Host "=== 检查 Job $jobId 的 utteranceIndex 一致性 ===" -ForegroundColor Green

# 查找所有包含该job和utteranceIndex的日志
Select-String -Path $logFile -Pattern "$jobId.*utteranceIndex|utteranceIndex.*$jobId" | 
  ForEach-Object {
    $line = $_.Line
    if ($line -match '"utteranceIndex":\s*(\d+)') {
      Write-Host "Found utteranceIndex: $($matches[1])" -ForegroundColor Cyan
    }
    Write-Host $line
  }

# 检查是否有utteranceIndex不一致的警告
Select-String -Path $logFile -Pattern "belongs to different utterance" | 
  Select-String $jobId
```

### 5.3 检查pending音频合并

```powershell
# 检查特定job的pending音频合并情况
$jobId = "job-4"
$logFile = "electron-main.log"

Write-Host "=== 检查 Job $jobId 的 pending 音频合并 ===" -ForegroundColor Green

# 查找pending音频相关日志
Select-String -Path $logFile -Pattern "$jobId.*pending|TimeoutMerge.*$jobId|PauseMerge.*$jobId" | 
  ForEach-Object {
    Write-Host $_.Line -ForegroundColor Cyan
  }
```

---

## 6. 常见问题模式

### 6.1 不同utterance的音频被错误合并

**症状**: Job4混杂了Job1的半句话

**日志特征**:
- 应该看到警告：`PendingPauseAudio belongs to different utterance, clearing it`
- 如果没有这个警告，说明utteranceIndex检查没有生效

**修复**: 确保合并pending音频时检查utteranceIndex一致性

### 6.2 音频被重复处理

**症状**: Job7、Job8是第三句话尾部的重复

**日志特征**:
- `pendingSmallSegments`被多次处理
- 批次创建时剩余片段没有被正确清理

**修复**: 检查`pendingSmallSegments`的清理逻辑

### 6.3 音频丢失

**症状**: 第四句话完全丢失

**日志特征**:
- `pendingTimeoutAudio`被缓存但没有被处理
- TTL超时后音频被清空但没有发送

**修复**: 检查TTL超时后的处理逻辑

---

**文档版本**: v1.0  
**创建日期**: 2026年1月18日
