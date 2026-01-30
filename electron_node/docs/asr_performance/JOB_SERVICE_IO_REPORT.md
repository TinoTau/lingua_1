# 集成测试 · 各 Job 在各服务的输入/输出

从节点端日志 `electron-main.log` 提取，按 utterance_index 排序。  
**合并报告**：详见 [INTEGRATION_TEST_MERGED_REPORT.md](./INTEGRATION_TEST_MERGED_REPORT.md)。

---
## Job: `job-bc0927cc-79fd-4751-ad70-98c77e40d133`

- **Session ID**: s-9791DB50
- **Utterance Index**: 1

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:05.854] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:05.878] AudioAggregator: Creating new buffer
  - [14:04:05.879] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [14:04:05.891] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [14:04:05.891] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [14:04:05.892] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [14:04:05.892] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [14:04:05.892] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 76800 bytes（约 2.4s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「我会先读一读」（6 字，1 片段，耗时 632 ms）

#### ASR 调用 #2
- **输入**: 音频 260268 bytes（约 8.1s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「这一两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有」（35 字，1 片段，耗时 1142 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「我会先读一读 这一两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有」（42 字），zh -> en，上下文长度 0 字符
- **输出**: 「I will read the two short words that are used to confirm that the system does not arbitrarily cut the voice between the sentences or in no way.」（143 字，耗时 1076 ms）

### 小结
- ASR 调用次数: 2 | NMT 调用次数: 1 | 总 ASR 文本长度: 41 字符

---
## Job: `job-8a192db0-5494-4d87-9126-8ea9554019fb`

- **Session ID**: s-9791DB50
- **Utterance Index**: 2

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:08.970] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:08.976] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:04:08.976] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口
  - [14:04:08.976] AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio
  - [14:04:08.976] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长
  - [14:04:08.976] AudioAggregatorFinalizeHandler: Merged audio still < 5 seconds, keeping pendingMaxDurationAudio (waiting for next job)
  - [14:04:08.977] AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口
  - [14:04:08.977] AudioAggregatorFinalizeHandler: PendingMaxDurationAudio held (merged audio still < 5s)
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
## Job: `job-66d64331-39d6-444b-8b11-7f9cb16f6640`

- **Session ID**: s-9791DB50
- **Utterance Index**: 3

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:14.432] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:14.460] AudioAggregator: [StateMachine] Buffer in finalizing/closed state, switching epoch
  - [14:04:14.461] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [14:04:14.467] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [14:04:14.468] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [14:04:14.468] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [14:04:14.468] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [14:04:14.468] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 81068 bytes（约 2.5s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「接下来最」（4 字，1 片段，耗时 398 ms）

#### ASR 调用 #2
- **输入**: 音频 290136 bytes（约 9.1s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「这一句我会尽量连续的说的长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过」（39 字，1 片段，耗时 1118 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「接下来最 这一句我会尽量连续的说的长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过」（44 字），zh -> en，上下文长度 0 字符
- **输出**: 「Next the most this sentence I will try as continuously as long as possible to say that the middle only retains a natural breathing rate not do intentionally stops looking at over.」（179 字，耗时 1434 ms）

### 小结
- ASR 调用次数: 2 | NMT 调用次数: 1 | 总 ASR 文本长度: 43 字符

---
## Job: `job-6d136f14-e203-4811-884d-ae65a6e357fc`

- **Session ID**: s-9791DB50
- **Utterance Index**: 4

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:20.803] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:20.835] AudioAggregatorMaxDurationHandler: Consecutive MaxDuration finalize, merged audio
  - [14:04:20.835] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [14:04:20.839] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [14:04:20.840] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [14:04:20.840] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [14:04:20.840] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [14:04:20.840] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 264536 bytes（约 8.3s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「10秒钟之后系统会不会因为超时或者进行判定而创新把这句话解断从而导致」（34 字，1 片段，耗时 1301 ms）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 0 | 总 ASR 文本长度: 34 字符

---
## Job: `job-6e2a4dfe-7c72-48bb-949d-0826b96eecf0`

- **Session ID**: s-9791DB50
- **Utterance Index**: 5

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 超时触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:35.369] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:35.373] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:04:35.374] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口
  - [14:04:35.374] AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio
  - [14:04:35.374] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长
  - [14:04:35.374] AudioAggregatorFinalizeHandler: TTL expired, force flushing pendingMaxDurationAudio (< 5s)
  - [14:04:35.374] AudioAggregatorFinalizeHandler: Cleared MaxDuration session mapping (manual/timeout finalize merged MaxDuration audio)
  - [14:04:35.374] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - ... 共 12 条

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-ee117dd3-033a-46ed-96b9-22900bef2c57`

- **Session ID**: s-9791DB50
- **Utterance Index**: 6

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:45.720] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:45.751] AudioAggregator: [StateMachine] Buffer in finalizing/closed state, switching epoch
  - [14:04:45.751] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [14:04:45.755] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [14:04:45.756] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [14:04:45.756] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [14:04:45.756] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [14:04:45.756] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 302936 bytes（约 9.5s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「它的长距能够被完整的识别出来而且不会出现判军话被提前发送或者直接丢失的现象那就说明了」（42 字，1 片段，耗时 1109 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「它的长距能够被完整的识别出来而且不会出现判军话被提前发送或者直接丢失的现象那就说明了」（42 字），zh -> en，上下文长度 0 字符
- **输出**: 「Its long distance can be fully identified and there is no phenomenon that the judgment of military words are sent in advance or lost directly.」（142 字，耗时 1003 ms）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 1 | 总 ASR 文本长度: 42 字符

---
## Job: `job-bc80eb6d-68fb-48f4-9183-553f156ef362`

- **Session ID**: s-9791DB50
- **Utterance Index**: 7

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:51.095] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:51.100] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:04:51.100] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口
  - [14:04:51.100] AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio
  - [14:04:51.101] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长
  - [14:04:51.101] AudioAggregatorFinalizeHandler: Merged audio still < 5 seconds, keeping pendingMaxDurationAudio (waiting for next job)
  - [14:04:51.101] AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口
  - [14:04:51.101] AudioAggregatorFinalizeHandler: PendingMaxDurationAudio held (merged audio still < 5s)
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
## Job: `job-54f932e6-4aca-4b36-84f5-4966a59996b2`

- **Session ID**: s-9791DB50
- **Utterance Index**: 8

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:04:59.323] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:04:59.343] AudioAggregator: [StateMachine] Buffer in finalizing/closed state, switching epoch
  - [14:04:59.343] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:04:59.343] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:04:59.344] AudioAggregator: Audio split by energy completed
  - [14:04:59.344] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:04:59.345] AudioAggregator: Sending audio segments to ASR
  - [14:04:59.345] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 102400 bytes（约 3.2s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「」（0 字，0 片段，耗时 840 ms）

#### ASR 调用 #2
- **输入**: 音频 110936 bytes（约 3.5s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「我们还需要继续分析预置找出到底」（15 字，1 片段，耗时 573 ms）

#### ASR 调用 #3
- **输入**: 音频 119468 bytes（约 3.7s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「可以试在哪一个环节把我的语音吃掉了」（17 字，1 片段，耗时 553 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「我们还需要继续分析预置找出到底 可以试在哪一个环节把我的语音吃掉了」（33 字），zh -> en，上下文长度 0 字符
- **输出**: 「We also need to continue the analysis of pre-set to find out where I can try which line my voice is eaten.」（106 字，耗时 766 ms）

### 小结
- ASR 调用次数: 3 | NMT 调用次数: 1 | 总 ASR 文本长度: 32 字符

---
## Job: `job-b1e0d7a7-7274-4842-bce8-091a1ede5669`

- **Session ID**: s-9791DB50
- **Utterance Index**: 9

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:06.812] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:06.826] AudioAggregator: Creating new buffer
  - [14:05:06.827] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:05:06.827] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:05:06.827] AudioAggregator: Audio split by energy completed
  - [14:05:06.827] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:05:06.827] AudioAggregator: Sending audio segments to ASR
  - [14:05:06.827] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-45d5d3b6-9a1d-4bb6-a6b0-b8cfc8efd3d3`

- **Session ID**: s-9791DB50
- **Utterance Index**: 10

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:15.024] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:15.025] AudioAggregator: Creating new buffer
  - [14:05:15.025] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:05:15.025] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:05:15.025] AudioAggregator: Audio split by energy completed
  - [14:05:15.025] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:05:15.025] AudioAggregator: Sending audio segments to ASR
  - [14:05:15.025] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-22be043d-fca8-442d-911a-d781a8f7d45c`

- **Session ID**: s-9791DB50
- **Utterance Index**: 11

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:22.591] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:22.593] AudioAggregator: Creating new buffer
  - [14:05:22.593] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:05:22.593] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:05:22.593] AudioAggregator: Audio split by energy completed
  - [14:05:22.593] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:05:22.593] AudioAggregator: Sending audio segments to ASR
  - [14:05:22.593] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-8036fa04-f5bd-449a-a4e9-99a8d39403b0`

- **Session ID**: s-9791DB50
- **Utterance Index**: 12

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:32.272] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:32.272] AudioAggregator: Creating new buffer
  - [14:05:32.272] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:05:32.272] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:05:32.272] AudioAggregator: Audio split by energy completed
  - [14:05:32.272] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:05:32.272] AudioAggregator: Sending audio segments to ASR
  - [14:05:32.273] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-9c575604-7077-4c26-8076-d309e1193ace`

- **Session ID**: s-9791DB50
- **Utterance Index**: 13

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:38.520] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:38.521] AudioAggregator: Creating new buffer
  - [14:05:38.521] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:05:38.521] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:05:38.521] AudioAggregator: Audio split by energy completed
  - [14:05:38.521] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:05:38.521] AudioAggregator: Sending audio segments to ASR
  - [14:05:38.521] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-1b7e60e5-c8fa-42fe-bf48-4c8746a33fae`

- **Session ID**: s-9791DB50
- **Utterance Index**: 14

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:46.904] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:46.905] AudioAggregator: Creating new buffer
  - [14:05:46.905] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:05:46.905] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:05:46.905] AudioAggregator: Audio split by energy completed
  - [14:05:46.905] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:05:46.905] AudioAggregator: Sending audio segments to ASR
  - [14:05:46.905] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-ee8e1cef-0d30-4aff-8170-22027986de68`

- **Session ID**: s-9791DB50
- **Utterance Index**: 15

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:54.212] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:54.248] AudioAggregator: Creating new buffer
  - [14:05:54.248] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [14:05:54.255] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [14:05:54.255] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [14:05:54.255] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [14:05:54.255] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [14:05:54.256] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 302936 bytes（约 9.5s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「他这一句我会尽量的连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过」（41 字，1 片段，耗时 1223 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「他这一句我会尽量的连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过」（41 字），zh -> en，上下文长度 0 字符
- **输出**: 「He said that I would try as long as possible to say a few days in the middle only retain natural breathing rhythm not do intentionally stops looking at over.」（157 字，耗时 1179 ms）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 1 | 总 ASR 文本长度: 41 字符

---
## Job: `job-2a74f42d-1887-4f9a-883f-7739fd060775`

- **Session ID**: s-9791DB50
- **Utterance Index**: 16

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: MaxDuration触发
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:05:59.686] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:05:59.727] AudioAggregatorMaxDurationHandler: Consecutive MaxDuration finalize, merged audio
  - [14:05:59.727] AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping
  - [14:05:59.733] AudioAggregatorMaxDurationHandler: Split audio by energy
  - [14:05:59.733] AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result
  - [14:05:59.735] AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment
  - [14:05:59.735] AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container
  - [14:05:59.735] AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio
  - ... 共 11 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 264536 bytes（约 8.3s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「如果10秒钟之后系统会不会因为超时或者监控判定而相信把这句话解断」（32 字，1 片段，耗时 1038 ms）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 0 | 总 ASR 文本长度: 32 字符

---
## Job: `job-25c9d9ee-d9d4-48db-a866-f05ad19e965a`

- **Session ID**: s-9791DB50
- **Utterance Index**: 17

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:06:07.117] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:06:07.126] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:06:07.126] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口
  - [14:06:07.126] AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio
  - [14:06:07.126] AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长
  - [14:06:07.127] AudioAggregatorFinalizeHandler: Merging pendingMaxDurationAudio with current audio (≥5s)
  - [14:06:07.127] AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口
  - [14:06:07.127] AudioAggregatorFinalizeHandler: Cleared MaxDuration session mapping (manual/timeout finalize merged MaxDuration audio)
  - ... 共 13 条

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 179200 bytes（约 5.6s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「前半句和后半句在几点端被参战两个不同的任务甚至出现」（25 字，1 片段，耗时 945 ms）

#### ASR 调用 #2
- **输入**: 音频 129708 bytes（约 4.1s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「变于医生的不完整,读起来前后不连关的情况」（20 字，1 片段，耗时 676 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「变于医生的不完整,读起来前后不连关的情况」（20 字），zh -> en，上下文长度 0 字符
- **输出**: 「The doctors are not complete, and they are unrelated to the read before.」（72 字，耗时 567 ms）

### 小结
- ASR 调用次数: 2 | NMT 调用次数: 1 | 总 ASR 文本长度: 45 字符

---
## Job: `job-837fc3ac-8be4-43ac-beab-c33322959c83`

- **Session ID**: s-9791DB50
- **Utterance Index**: 18

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:06:13.458] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:06:13.470] AudioAggregator: Creating new buffer
  - [14:06:13.470] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:06:13.470] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:06:13.470] AudioAggregator: Audio split by energy completed
  - [14:06:13.470] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:06:13.471] AudioAggregator: Sending audio segments to ASR
  - [14:06:13.471] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
- **输入**: -
- **输出**: -（未调用 ASR）

### 3. NMT
- **输入**: -
- **输出**: -（未调用 NMT）

### 小结
- ASR 调用次数: 0 | NMT 调用次数: 0 | 总 ASR 文本长度: 0 字符

---
## Job: `job-0cc12002-6762-47d0-9130-008977e758c4`

- **Session ID**: s-9791DB50
- **Utterance Index**: -

### 1. AudioAggregator
- **输入**: 当前 chunk + buffer 状态；触发: 手动截断
- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表
- **事件**:
  - [14:03:58.498] AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check
  - [14:03:58.584] AudioAggregator: Creating new buffer
  - [14:03:58.584] AudioAggregator: [StateMachine] Buffer state -> FINALIZING
  - [14:03:58.585] AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口
  - [14:03:58.585] AudioAggregator: Audio split by energy completed
  - [14:03:58.586] AudioAggregator: Batches assigned using unified head alignment strategy
  - [14:03:58.586] AudioAggregator: Sending audio segments to ASR
  - [14:03:58.587] AudioAggregator: [T3(3)] 最终返回前

### 2. ASR
#### ASR 调用 #1
- **输入**: 音频 133120 bytes（约 4.2s），格式 pcm16，16000 Hz，src_lang=auto，上下文长度 0 字符
- **输出**: 「我开始进行一次运营识别稳定性测试」（16 字，1 片段，耗时 2292 ms）

### 3. NMT
#### NMT 调用 #1
- **输入**: 「我开始进行一次运营识别稳定性测试」（16 字），zh -> en，上下文长度 0 字符
- **输出**: 「I started a operating identification stability test.」（52 字，耗时 1466 ms）

### 小结
- ASR 调用次数: 1 | NMT 调用次数: 1 | 总 ASR 文本长度: 16 字符
