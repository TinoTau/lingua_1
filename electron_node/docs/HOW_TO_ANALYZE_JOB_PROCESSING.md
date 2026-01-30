# Job处理流程日志分析指南

## 问题描述

在集成测试中，发现长句被分割成多个job，且某些job的ASR结果不完整。需要分析每个job在各服务中的处理过程。

## 日志文件位置

### 1. Electron主进程日志
- **路径**: `electron_node/electron-node/logs/electron-main.log`
- **格式**: JSON格式（pino日志库）
- **内容**: 包含所有job的处理流程，包括AudioAggregator、ASR路由、NMT路由等

### 2. ASR服务日志
- **路径**: `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log`
- **格式**: Python标准日志格式
- **内容**: ASR服务的详细处理日志，包括输入参数、识别结果等

### 3. NMT服务日志
- **路径**: `electron_node/services/nmt_m2m100/logs/nmt-service.log`
- **格式**: Python标准日志格式
- **内容**: NMT服务的翻译日志

### 4. Rust推理服务日志
- **路径**: `electron_node/services/node-inference/logs/node-inference.log`
- **格式**: JSON或pretty格式
- **内容**: Rust推理服务的处理日志

## 关键日志标识

### ASR服务日志标识
- `[trace_id] ========== ASR 接口入参 ==========`
- `[trace_id] ASR 请求参数:`
- `[trace_id] ASR 识别完成`
- `[trace_id] Step 9.4: Final text to be sent to NMT (full):`

### 节点端ASR路由日志
- `ASR INPUT: Sending ASR request to faster-whisper-vad`
- `ASR OUTPUT: faster-whisper-vad request succeeded`

### NMT服务日志标识
- `NMT INPUT: Sending NMT request (START)`
- `NMT OUTPUT: NMT request succeeded (END)`

### AudioAggregator日志标识
- `AudioAggregator: Processing audio`
- `AudioAggregator: shouldProcessNow`
- `AudioAggregatorFinalizeHandler:`

## 使用分析脚本

### 安装依赖
```bash
# 无需额外依赖，使用Python标准库
```

### 基本用法

#### 1. 分析所有job
```bash
python electron_node/scripts/analyze_job_processing.py electron_node/electron-node/logs/electron-main.log
```

#### 2. 分析特定job
```bash
python electron_node/scripts/analyze_job_processing.py electron_node/electron-node/logs/electron-main.log --job-id <job_id>
```

#### 3. 分析特定session的所有job
```bash
python electron_node/scripts/analyze_job_processing.py electron_node/electron-node/logs/electron-main.log --session-id <session_id>
```

#### 4. 只显示摘要
```bash
python electron_node/scripts/analyze_job_processing.py electron_node/electron-node/logs/electron-main.log --summary
```

## 手动分析步骤

如果日志文件不存在或脚本无法解析，可以手动查看：

### 1. 查找所有job的utterance_index
```bash
# 在Electron主进程日志中搜索
grep -i "utteranceIndex" electron_node/electron-node/logs/electron-main.log | grep -i "jobId"
```

### 2. 查找ASR输入输出
```bash
# ASR输入
grep -i "ASR INPUT" electron_node/electron-node/logs/electron-main.log

# ASR输出
grep -i "ASR OUTPUT" electron_node/electron-node/logs/electron-main.log

# ASR服务内部日志
grep -i "Final text to be sent to NMT" electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log
```

### 3. 查找NMT输入输出
```bash
# NMT输入
grep -i "NMT INPUT" electron_node/electron-node/logs/electron-main.log

# NMT输出
grep -i "NMT OUTPUT" electron_node/electron-node/logs/electron-main.log
```

### 4. 查找AudioAggregator处理信息
```bash
# 查找音频聚合处理
grep -i "AudioAggregator.*Processing" electron_node/electron-node/logs/electron-main.log

# 查找超时/静音触发
grep -i "isTimeoutTriggered\|isPauseTriggered\|isManualCut" electron_node/electron-node/logs/electron-main.log
```

## 分析要点

### 1. 检查job分割原因
- **超时触发**: 查找 `isTimeoutTriggered: true`
- **静音触发**: 查找 `isPauseTriggered: true`
- **手动截断**: 查找 `isManualCut: true`
- **MaxDuration触发**: 查找 `isMaxDurationTriggered: true`

### 2. 检查ASR输入输出一致性
- **输入音频长度**: 检查 `audioLength` 字段
- **输出文本**: 检查 `asrText` 或 `Final text to be sent to NMT`
- **文本长度**: 检查文本是否被截断

### 3. 检查NMT输入输出一致性
- **输入文本**: 检查 `textToTranslate` 或 `text` 字段
- **输出文本**: 检查 `translatedText` 或 `nmtResultText` 字段
- **上下文**: 检查 `contextText` 是否正确传递

### 4. 检查时间线
- 查看每个job的处理时间线，确认是否有异常延迟
- 检查是否有错误或警告日志

## 常见问题

### Q1: 日志文件不存在
**A**: 检查：
1. 服务是否正在运行
2. 日志目录是否有写入权限
3. 环境变量 `LOG_LEVEL` 是否设置正确

### Q2: 找不到job记录
**A**: 检查：
1. 日志级别是否足够（建议使用 `info` 或 `debug`）
2. job_id 是否正确
3. 日志文件是否包含测试时间段的记录

### Q3: ASR输出为空或不完整
**A**: 检查：
1. ASR服务的日志，查看是否有错误
2. 音频质量是否足够
3. 音频长度是否过短
4. 是否有超时或静音误判

## 示例分析

假设测试结果显示了以下job：
- [0] 我们开始进行一次语音识别稳定性测试
- [1] 语音识别稳定性测试 两句比较短的话...
- [3] 接下来这一句 我会尽量练续的说得长一些中间直保
- [5] 与一双不完整,读起来结后不连关的情况。
- [7] 这次的长距能够被完整的识别出来...
- [9] 我们还需要继续分析日质...

### 分析步骤：

1. **查找所有相关job**:
   ```bash
   grep -i "utteranceIndex.*[013579]" electron_node/electron-node/logs/electron-main.log
   ```

2. **检查每个job的ASR输入**:
   ```bash
   # 对于job [0]
   grep -A 20 "jobId.*job_xxx.*utteranceIndex.*0" electron_node/electron-node/logs/electron-main.log | grep -i "ASR INPUT"
   ```

3. **检查每个job的ASR输出**:
   ```bash
   grep -A 20 "jobId.*job_xxx.*utteranceIndex.*0" electron_node/electron-node/logs/electron-main.log | grep -i "ASR OUTPUT"
   ```

4. **检查AudioAggregator处理**:
   ```bash
   grep -B 10 -A 10 "utteranceIndex.*0" electron_node/electron-node/logs/electron-main.log | grep -i "AudioAggregator"
   ```

5. **检查是否有超时/静音触发**:
   ```bash
   grep -i "isTimeoutTriggered\|isPauseTriggered" electron_node/electron-node/logs/electron-main.log | grep -i "utteranceIndex.*[013579]"
   ```

## 输出格式说明

分析脚本会输出以下信息：

```
================================================================================
Job处理流程分析: job_xxx
================================================================================
Session ID: session_xxx
Utterance Index: 0
Trace ID: trace_xxx

[AudioAggregator]
  总时长: 5000ms
  音频块数: 25
  手动截断: false
  静音触发: false
  超时触发: true

[ASR输入]
  音频长度: 160000 bytes
  音频格式: pcm16
  采样率: 16000 Hz
  源语言: zh
  上下文文本: ... (长度: 50)

[ASR输出]
  识别文本: "我们开始进行一次语音识别稳定性测试"
  文本长度: 18 字符
  片段数: 1
  质量分数: 0.95
  检测语言: zh
  语言概率: 0.99
  处理时间: 1200ms

[NMT输入]
  待翻译文本: "我们开始进行一次语音识别稳定性测试"
  文本长度: 18 字符
  源语言: zh -> 目标语言: en
  上下文文本: ... (长度: 0)

[NMT输出]
  翻译文本: "We are starting to perform a voice-identification stability test."
  文本长度: 60 字符
  置信度: 0.95
  处理时间: 800ms

[错误/警告]
  (如果有错误会显示在这里)

[处理时间线] (最近10条)
  [2026-01-27T10:30:15.123Z] [info] ASR INPUT: Sending ASR request...
  [2026-01-27T10:30:16.323Z] [info] ASR OUTPUT: faster-whisper-vad request succeeded...
  ...
```

## 下一步

根据分析结果，可以：
1. 检查AudioAggregator的切分逻辑是否正确
2. 检查ASR服务的识别质量
3. 检查NMT服务的翻译质量
4. 优化超时和静音判定参数
