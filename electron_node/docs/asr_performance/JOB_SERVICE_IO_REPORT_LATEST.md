# 集成测试 · 各 Job 在各服务的输入/输出

从节点端日志 `electron-main.log` 提取，按 utterance_index 排序。

---
## Job: `job-c68a7283-2135-43a9-a272-2df00c2dd8b8`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 1

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:03:06.198] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:03:06.227] AudioAggregator: Creating new buffer
  - [09:03:06.228] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [09:03:06.238] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [09:03:06.238] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [09:03:06.239] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [09:03:06.240] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [09:03:06.240] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 76800 bytes（约 2.4s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「我会先读一语音时别稳定性测试」（14 字，1 片段，耗时 494 ms）

#### ASR 调用 #2
- **输入**: 音频 251736 bytes（约 7.9s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有」（33 字，1 片段，耗时 986 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「我会先读一语音时别稳定性测试 两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有」（48 字），zh -> en，上下文长度 0 字符
- **输出**: 「I will read a voice first and do not test stability. two short words are used to confirm that the system does not arbitrarily cut the sound between the sentences or in no way.」（175 字，耗时 1216 ms）

### 小结
- ASR 调用次数: 2 | NMT 调用次数: 1 | 总 ASR 文本长度: 47 字符

---
## Job: `job-caa7dfaf-b120-4ff5-90f2-3ba019914477`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 2

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:03:11.804] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:03:11.809] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:03:11.809] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口
  - [09:03:11.809] AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio
  - [09:03:11.809] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长
  - [09:03:11.809] AudioAggregatorFinalizeHandler: Merged audio still < 5 seconds, keeping pendingMaxDurationAudio (waiting for next job)
  - [09:03:11.810] AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口
  - [09:03:11.810] AudioAggregatorFinalizeHandler: PendingMaxDurationAudio held (merged audio still < 5s)
  - ... 共 10 条

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-a239101c-58a0-4f6a-8d91-64cf69bdb0fb`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 3

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:03:18.406] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:03:18.432] AudioAggregator: [StateMachine] Buffer in finalizing/closed state, switching epoch
  - [09:03:18.432] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [09:03:18.437] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [09:03:18.437] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [09:03:18.438] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [09:03:18.438] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [09:03:18.438] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 106668 bytes（约 3.3s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「接下来这一句」（6 字，1 片段，耗时 734 ms）

#### ASR 调用 #2
- **输入**: 音频 281600 bytes（约 8.8s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「我会尽量地延续地说的长一些中间只保留自然的呼吸节奏不做刻意的挺顿看看在超过」（37 字，1 片段，耗时 1055 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「接下来这一句 我会尽量地延续地说的长一些中间只保留自然的呼吸节奏不做刻意的挺顿看看在超过」（44 字），zh -> en，上下文长度 0 字符
- **输出**: 「Next this phrase I will try to say as long as possible in the middle only retain a natural breathing rate not do intentionally and look at it over.」（147 字，耗时 1079 ms）

### 小结
- ASR 调用次数: 2 | NMT 调用次数: 1 | 总 ASR 文本长度: 43 字符

---
## Job: `job-216f2ebc-a312-471c-893e-a1bc29cac3fa`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 4

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:03:25.256] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:03:25.288] AudioAggregatorMaxDurationHandler: Consecutive MaxDuration finalize, merged audio
  - [09:03:25.288] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [09:03:25.293] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [09:03:25.293] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [09:03:25.294] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [09:03:25.294] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [09:03:25.294] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 264536 bytes（约 8.3s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「或是没有终之后系统会不会因为超时或者经营判定而下心法这句话阶段从而导致前」（36 字，1 片段，耗时 980 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「或是没有终之后系统会不会因为超时或者经营判定而下心法这句话阶段从而导致前」（36 字），zh -> en，上下文长度 0 字符
- **输出**: 「Or without the end of the system will not be due to overtime or business judgment and this phase of phrase thereby lead to the first.」（133 字，耗时 996 ms）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 1 | 总 ASR 文本长度: 36 字符

---
## Job: `job-12e3c695-3df5-4aca-9b5a-226e38401fc3`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 5

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:03:31.917] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:03:31.932] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:03:31.932] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口
  - [09:03:31.932] AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio
  - [09:03:31.932] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长
  - [09:03:31.932] AudioAggregatorFinalizeHandler: Merging pendingMaxDurationAudio with current audio (≥5s)
  - [09:03:31.932] AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口
  - [09:03:31.933] AudioAggregatorFinalizeHandler: Cleared MaxDuration session mapping (manual/timeout finalize merged MaxDuration audio)
  - ... 共 13 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 192000 bytes（约 6.0s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「两半局后半局在阶点端被猜成两个不同的任务甚至出现于」（25 字，1 片段，耗时 780 ms）

#### ASR 调用 #2
- **输入**: 音频 131416 bytes（约 4.1s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「与义上的不安整独起来结后不两关的情况」（18 字，1 片段，耗时 573 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「与义上的不安整独起来结后不两关的情况」（18 字），zh -> en，上下文长度 0 字符
- **输出**: 「The uncertainty of justice is not related to the situation.」（59 字，耗时 519 ms）

### 小结
- ASR 调用次数: 2 | NMT 调用次数: 1 | 总 ASR 文本长度: 43 字符

---
## Job: `job-6394cd5b-efbf-4178-98ee-210e1d9b036d`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 6

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:03:39.280] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:03:39.283] AudioAggregator: Creating new buffer
  - [09:03:39.283] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:03:39.283] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [09:03:39.283] AudioAggregator: Audio split by energy completed
  - [09:03:39.283] AudioAggregator: Batches assigned using unified head alignment strategy
  - [09:03:39.283] AudioAggregator: Sending audio segments to ASR
  - [09:03:39.283] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-da2a764e-dcbe-4aa0-b457-b7c527c7c2f1`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 7

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:04:00.717] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:04:00.749] AudioAggregator: Creating new buffer
  - [09:04:00.749] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [09:04:00.754] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [09:04:00.755] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [09:04:00.755] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [09:04:00.755] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [09:04:00.755] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 298668 bytes（约 9.3s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「这次的长距能够被完整的试炼出来而且不会出现半句话被提前发送或者直接丢失的现象那就说明我们」（44 字，1 片段，耗时 1365 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「这次的长距能够被完整的试炼出来而且不会出现半句话被提前发送或者直接丢失的现象那就说明我们」（44 字），zh -> en，上下文长度 0 字符
- **输出**: 「This long distance can be tested in full and there is no half-word phenomenon that is sent in advance or lost directly, which shows us.」（135 字，耗时 1066 ms）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 1 | 总 ASR 文本长度: 44 字符

---
## Job: `job-2d37ef5f-acce-4734-89b5-9b09435a0408`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 8

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:04:06.449] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:04:06.454] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:04:06.455] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口
  - [09:04:06.455] AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio
  - [09:04:06.455] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长
  - [09:04:06.455] AudioAggregatorFinalizeHandler: Merged audio still < 5 seconds, keeping pendingMaxDurationAudio (waiting for next job)
  - [09:04:06.455] AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口
  - [09:04:06.455] AudioAggregatorFinalizeHandler: PendingMaxDurationAudio held (merged audio still < 5s)
  - ... 共 10 条

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-74989361-248c-4b02-b5f9-7514140fb523`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 9

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:04:13.459] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:04:13.477] AudioAggregator: [StateMachine] Buffer in finalizing/closed state, switching epoch
  - [09:04:13.477] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:04:13.477] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [09:04:13.477] AudioAggregator: Audio split by energy completed
  - [09:04:13.478] AudioAggregator: Batches assigned using unified head alignment strategy
  - [09:04:13.478] AudioAggregator: Sending audio segments to ASR
  - [09:04:13.478] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 89600 bytes（约 2.8s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「否则我们」（4 字，1 片段，耗时 775 ms）

#### ASR 调用 #2
- **输入**: 音频 198828 bytes（约 6.2s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「还是要继续分析预制找出到底是在哪一个环节把我的语音给吃掉了」（29 字，1 片段，耗时 782 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「否则我们 还是要继续分析预制找出到底是在哪一个环节把我的语音给吃掉了」（34 字），zh -> en，上下文长度 0 字符
- **输出**: 「Otherwise we will continue to analyze the pre-preparation to find out exactly in which line my voice has been eaten.」（116 字，耗时 897 ms）

### 小结
- ASR 调用次数: 2 | NMT 调用次数: 1 | 总 ASR 文本长度: 33 字符

---
## Job: `job-1f6f3c30-d95d-4610-bfff-6b370869b9db`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 10

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:04:21.353] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:04:21.362] AudioAggregator: Creating new buffer
  - [09:04:21.362] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:04:21.362] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [09:04:21.362] AudioAggregator: Audio split by energy completed
  - [09:04:21.362] AudioAggregator: Batches assigned using unified head alignment strategy
  - [09:04:21.362] AudioAggregator: Sending audio segments to ASR
  - [09:04:21.362] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-b6e7742a-db88-4471-a0e9-fa4723c12e73`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: 11

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:04:29.116] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:04:29.117] AudioAggregator: Creating new buffer
  - [09:04:29.117] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:04:29.117] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [09:04:29.117] AudioAggregator: Audio split by energy completed
  - [09:04:29.117] AudioAggregator: Batches assigned using unified head alignment strategy
  - [09:04:29.117] AudioAggregator: Sending audio segments to ASR
  - [09:04:29.117] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-baecb685-9d2d-4f70-ac7a-a0ef90ddedf3`

- **Session ID**: s-66D2E0A4
- **Utterance Index**: -

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [09:02:58.308] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [09:02:58.592] AudioAggregator: Creating new buffer
  - [09:02:58.593] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [09:02:58.593] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [09:02:58.593] AudioAggregator: Audio split by energy completed
  - [09:02:58.594] AudioAggregator: Batches assigned using unified head alignment strategy
  - [09:02:58.594] AudioAggregator: Sending audio segments to ASR
  - [09:02:58.595] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 133120 bytes（约 4.2s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「开始进行一次语音时别稳定性测试」（15 字，1 片段，耗时 1813 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「开始进行一次语音时别稳定性测试」（15 字），zh -> en，上下文长度 0 字符
- **输出**: 「Do not test stability when you start a voice.」（45 字，耗时 1108 ms）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 1 | 总 ASR 文本长度: 15 字符
