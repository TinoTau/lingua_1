# Job分割问题分析报告

## 测试结果回顾

**原文**: "现在我们开始进行一次语音识别稳定性测试。我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。"

**实际返回结果**:
- [0] 我们开始进行一次语音识别稳定性测试
- [1] 语音识别稳定性测试 两句比较短的话 用来确认系统不会在句子之间随意的把语音切断或者在没有
- [3] 接下来这一句 我会尽量练续的说得长一些中间直保
- [5] 与一双不完整,读起来结后不连关的情况。
- [7] 这次的长距能够被完整的识别出来,而且不会出现半句话,被提前发送或者直接丢失的现象,那就说明我们.
- [9] 我们还需要继续分析日质,找出到底是在哪一个环节把我们的语言给吃掉了。

## 问题分析

### 1. Job分割问题

**观察**: 原文被分割成了6个job（utterance_index: 0, 1, 3, 5, 7, 9）

**可能原因**:

#### A. 超时触发 (isTimeoutTriggered)
- **位置**: `audio-aggregator.ts` 和 `audio-aggregator-timeout-handler.ts`
- **机制**: 调度服务器检测到没有新的audio_chunk后，会触发timeout finalize
- **问题**: 如果用户在说话过程中有自然的呼吸停顿，可能被误判为超时
- **检查点**: 
  - 查找日志中的 `isTimeoutTriggered: true`
  - 检查 `AudioAggregatorTimeoutHandler` 的处理逻辑

#### B. 静音触发 (isPauseTriggered)
- **位置**: `audio-aggregator.ts`
- **机制**: 检测到3秒静音后触发处理
- **问题**: 长句中的自然停顿可能被误判为句子结束
- **检查点**:
  - 查找日志中的 `isPauseTriggered: true`
  - 检查静音检测阈值（默认3秒）

#### C. MaxDuration触发 (isMaxDurationTriggered)
- **位置**: `audio-aggregator.ts` 和 `audio-aggregator-finalize-handler.ts`
- **机制**: 音频超过20秒后触发MaxDuration切分
- **问题**: 长句可能被切分成前半句和后半句
- **检查点**:
  - 查找日志中的 `isMaxDurationTriggered: true`
  - 检查 `pendingMaxDurationAudio` 的处理逻辑

#### D. UtteranceIndex跳跃
- **观察**: utterance_index不是连续的（0, 1, 3, 5, 7, 9），说明中间有job被跳过或丢失
- **可能原因**:
  - 某些job的音频为空，被过滤掉了
  - 某些job的ASR结果为空，没有产生输出
  - 调度服务器端的utterance_index分配问题

### 2. ASR结果不完整问题

**观察**: 
- [1] 文本被截断："用来确认系统不会在句子之间随意的把语音切断或者在没有"
- [3] 文本不完整："接下来这一句 我会尽量练续的说得长一些中间直保"
- [5] 文本不完整："与一双不完整,读起来结后不连关的情况。"
- [7] 文本被截断："这次的长距能够被完整的识别出来,而且不会出现半句话,被提前发送或者直接丢失的现象,那就说明我们."

**可能原因**:

#### A. 音频被提前切分
- **问题**: AudioAggregator在用户还在说话时就触发了处理
- **影响**: ASR收到的音频不完整，导致识别结果不完整
- **检查点**:
  - 检查每个job的ASR输入音频长度
  - 检查AudioAggregator的触发条件

#### B. ASR服务内部问题
- **问题**: Faster Whisper在识别长句时可能出现问题
- **可能原因**:
  - 音频质量不足
  - 上下文参数设置不当
  - 模型处理长句的能力有限
- **检查点**:
  - 检查ASR服务的日志，查看是否有错误
  - 检查音频质量分数（qualityScore）
  - 检查语言检测概率（language_probability）

#### C. 文本去重/过滤问题
- **位置**: `text_processing.py` 和 `text_filter.py`
- **问题**: 文本去重或过滤可能误删了部分内容
- **检查点**:
  - 检查ASR原始输出（在去重之前）
  - 检查去重和过滤的日志

### 3. 文本质量问题

**观察**: 
- "练续" 应该是 "连续"
- "直保" 应该是 "只保留"
- "与一双不完整" 应该是 "出现语义上不完整"
- "结后不连关" 应该是 "前后不连贯"
- "长距" 应该是 "长句"
- "日质" 应该是 "日志"

**可能原因**:
- ASR识别错误（同音字、语音质量等）
- 上下文信息不足
- 音频被切分导致上下文丢失

## 需要检查的日志点

### 1. AudioAggregator日志
查找以下关键日志：
```
AudioAggregator: Processing audio
AudioAggregator: shouldProcessNow
isTimeoutTriggered: true/false
isPauseTriggered: true/false
isManualCut: true/false
isMaxDurationTriggered: true/false
totalDurationMs: <时长>
chunkCount: <块数>
```

### 2. ASR输入输出日志
查找以下关键日志：
```
ASR INPUT: Sending ASR request to faster-whisper-vad
  - audioLength: <音频长度>
  - contextText: <上下文文本>
  
ASR OUTPUT: faster-whisper-vad request succeeded
  - asrText: <识别文本>
  - asrTextLength: <文本长度>
  - qualityScore: <质量分数>
  
[trace_id] Step 9.4: Final text to be sent to NMT (full): '<完整文本>'
```

### 3. NMT输入输出日志
查找以下关键日志：
```
NMT INPUT: Sending NMT request (START)
  - text: <待翻译文本>
  - textLength: <文本长度>
  
NMT OUTPUT: NMT request succeeded (END)
  - translatedText: <翻译文本>
  - translatedTextLength: <文本长度>
```

### 4. AudioAggregatorFinalizeHandler日志
查找以下关键日志：
```
AudioAggregatorFinalizeHandler: Merging pendingTimeoutAudio
AudioAggregatorFinalizeHandler: UtteranceIndex跳跃太大（>2），清除pendingTimeoutAudio
AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingTimeoutAudio
```

## 建议的修复方向

### 1. 优化超时和静音判定
- **增加超时阈值**: 从当前值增加到更长的值（例如15-20秒）
- **优化静音检测**: 使用更智能的静音检测算法，避免误判自然停顿
- **添加语音活动检测**: 在判定超时/静音前，确认是否真的没有语音活动

### 2. 改进MaxDuration处理
- **优化切分逻辑**: 在MaxDuration切分时，找到更合适的切分点（例如最长停顿）
- **改进合并逻辑**: 确保前半句和后半句能够正确合并

### 3. 增强上下文传递
- **改进上下文缓冲**: 确保上下文信息能够正确传递到ASR
- **优化文本去重**: 避免误删有效内容

### 4. 添加诊断日志
- **记录音频切分原因**: 明确记录为什么某个音频被切分
- **记录ASR输入输出**: 完整记录ASR的输入和输出，便于诊断
- **记录处理时间线**: 记录每个job的完整处理时间线

## 下一步行动

1. **启用详细日志**: 设置 `LOG_LEVEL=debug` 或 `LOG_LEVEL=info`
2. **运行分析脚本**: 使用 `analyze_job_processing.py` 分析日志
3. **检查关键日志点**: 按照上述日志点逐一检查
4. **对比预期和实际**: 对比每个job的预期结果和实际结果
5. **定位问题根源**: 根据日志定位问题发生的具体环节

## 如何启用日志

### Electron主进程
```bash
# 设置环境变量
export LOG_LEVEL=info
export LOG_FORMAT=pretty  # 或 json

# 日志文件位置
electron_node/electron-node/logs/electron-main.log
```

### ASR服务
```bash
# 日志文件位置
electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log

# 日志会自动记录，无需额外配置
```

### NMT服务
```bash
# 日志文件位置
electron_node/services/nmt_m2m100/logs/nmt-service.log

# 日志会自动记录，无需额外配置
```

## 分析工具使用

### 快速检查
```bash
cd electron_node
python scripts/quick_check_jobs.py
```

### 详细分析
```bash
# 分析所有job
python scripts/analyze_job_processing.py electron-node/logs/electron-main.log

# 分析特定job
python scripts/analyze_job_processing.py electron-node/logs/electron-main.log --job-id <job_id>

# 只显示摘要
python scripts/analyze_job_processing.py electron-node/logs/electron-main.log --summary
```
