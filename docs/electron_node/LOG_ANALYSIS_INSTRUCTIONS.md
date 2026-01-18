# 日志分析使用说明

## 快速开始

### 1. 找到日志文件位置

日志文件通常位于以下位置之一：
- `logs\electron-main.log` (相对于当前工作目录)
- `electron_node\electron-node\logs\electron-main.log`
- `electron_node\electron-node\main\logs\electron-main.log`

### 2. 运行分析脚本

```powershell
# 进入docs/electron_node目录
cd D:\Programs\github\lingua_1\docs\electron_node

# 运行分析脚本（自动查找日志文件）
.\analyze_job_issues.ps1

# 或者指定日志文件路径
.\analyze_job_issues.ps1 -LogFile "D:\path\to\logs\electron-main.log"

# 或者只分析特定Job
.\analyze_job_issues.ps1 -LogFile "logs\electron-main.log" -JobId "job-4"
```

### 3. 手动分析命令

如果脚本无法找到日志文件，可以使用以下PowerShell命令手动分析：

#### 查找Job4的所有日志
```powershell
Select-String -Path "logs\electron-main.log" -Pattern "job-4" | Select-Object -Last 50
```

#### 检查Job4的pending音频合并
```powershell
Select-String -Path "logs\electron-main.log" -Pattern "job-4.*pending|TimeoutMerge.*job-4|PauseMerge.*job-4" | Select-Object -First 30
```

#### 检查utteranceIndex一致性
```powershell
Select-String -Path "logs\electron-main.log" -Pattern "job-[014578].*utteranceIndex|belongs to different utterance" | Select-Object -First 30
```

#### 检查Job4的originalJobIds分配
```powershell
Select-String -Path "logs\electron-main.log" -Pattern "job-4.*originalJobIds|job-4.*Registering original job" | Select-Object -First 20
```

#### 检查Job4的ASR批次处理
```powershell
Select-String -Path "logs\electron-main.log" -Pattern "runAsrStep.*job-4|Added ASR batch.*job-4" | Select-Object -First 20
```

#### 检查Job4的文本合并
```powershell
Select-String -Path "logs\electron-main.log" -Pattern "TextMerge.*job-4|Merged ASR batches.*job-4" | Select-Object -First 10
```

---

## 关键检查点

### 1. Job4混杂Job1半句话的问题

**需要检查的日志**:
1. Job1是否是pause finalize？
2. Job1是否有pendingPauseAudio？
3. Job4处理时是否有pendingPauseAudio？
4. utteranceIndex是否一致？（应该有警告日志）
5. Job4的originalJobIds是什么？

**关键日志关键词**:
- `job-1.*isPauseTriggered`
- `job-1.*pendingPauseAudio`
- `job-4.*pendingPauseAudio`
- `belongs to different utterance`
- `job-4.*originalJobIds`

### 2. Job5/Job7/Job8重复问题

**需要检查的日志**:
1. 是否有pendingSmallSegments？
2. 音频切分结果是什么？
3. 批次创建结果是什么？

**关键日志关键词**:
- `pendingSmallSegments`
- `Audio split by energy completed`
- `Streaming batches created`

### 3. 第四句话丢失问题

**需要检查的日志**:
1. 是否有超时触发？
2. pendingTimeoutAudio是否被处理？
3. TTL超时后发生了什么？

**关键日志关键词**:
- `isTimeoutTriggered.*true`
- `TimeoutFinalize`
- `pendingTimeoutAudio.*TTL`
- `pendingTimeoutAudio.*merged`

---

## 日志格式说明

日志使用JSON格式，主要字段：
- `jobId`: 当前job ID
- `originalJobId`: 原始job ID
- `sessionId`: 会话ID
- `utteranceIndex`: Utterance索引
- `operation`: 操作类型
- `batchIndex`: 批次索引
- `expectedSegmentCount`: 期望的片段数量

---

**文档版本**: v1.0  
**创建日期**: 2026年1月18日
