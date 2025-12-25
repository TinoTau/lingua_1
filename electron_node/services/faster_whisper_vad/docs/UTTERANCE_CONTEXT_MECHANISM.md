# Utterance上下文机制说明

**日期**: 2025-12-24  
**问题**: 手动控制utterance合并多少语句？只有上下文两句话吗？  
**状态**: ✅ **已分析**

---

## Web端audioBuffer机制

### audioBuffer的作用

**定义**: `private audioBuffer: Float32Array[] = []`

**功能**:
- 临时缓存当前正在录制的音频帧
- 每100ms自动发送一部分（通过`sendAudioChunk`）
- 剩余部分保留在buffer中，等待手动发送或自动finalize

### 数据流

```
录音开始
  → onAudioFrame() 接收音频帧
  → audioBuffer.push(audioData) 累积到buffer
  → 每100ms: 发送前10帧 → sendAudioChunk()
  → buffer中剩余帧继续累积
  → 用户手动触发: sendCurrentUtterance()
  → 发送buffer中所有剩余数据 → sendUtterance()
  → audioBuffer = [] 清空buffer
```

### sendCurrentUtterance()发送的内容

**代码**:
```typescript
async sendCurrentUtterance(): Promise<void> {
  if (this.audioBuffer.length > 0) {
    const audioData = this.concatAudioBuffers(this.audioBuffer);
    this.audioBuffer = []; // 清空缓冲区
    await this.wsClient.sendUtterance(audioData, ...);
  }
}
```

**发送内容**:
- **不是多句话**，而是**当前正在录制的一句话的剩余部分**
- 因为每100ms已经通过`sendAudioChunk`发送了一部分
- `audioBuffer`中只保留**尚未发送的剩余帧**

**示例**:
- 用户开始说话，录音3秒
- 前2.9秒：每100ms通过`sendAudioChunk`发送
- 剩余0.1秒：保留在`audioBuffer`中
- 用户点击发送按钮：`sendCurrentUtterance()`发送这0.1秒的数据

---

## 服务端上下文缓冲区机制

### 音频上下文缓冲区（Audio Context Buffer）

**配置**: `CONTEXT_DURATION_SEC = 2.0`（2秒）

**功能**:
- 保存**前一个utterance的最后2秒音频**
- 用于ASR的上下文，提高识别准确率
- 在下一个utterance处理时，将上下文音频拼接到当前音频前面

**实现**:
```python
# context.py
def update_context_buffer(audio_data: np.ndarray, vad_segments: List[Tuple[int, int]]):
    """更新上下文缓冲区：保存最后一个语音段的尾部（最多2秒）"""
    context_samples = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)  # 2秒 = 32000样本
    
    if len(vad_segments) > 0:
        last_segment = audio_data[vad_segments[-1][0]:vad_segments[-1][1]]
        # 从最后一个语音段的尾部提取上下文（最多2秒）
        if len(last_segment) > context_samples:
            context_buffer = last_segment[-context_samples:]  # 最后2秒
        else:
            context_buffer = last_segment  # 整个段（如果小于2秒）
```

**使用**:
```python
# faster_whisper_vad_service.py
# 处理utterance时，拼接上下文音频
context_audio = get_context_audio()  # 获取前一个utterance的最后2秒
if len(context_audio) > 0:
    audio = np.concatenate([context_audio, audio])  # 拼接
```

### 文本上下文缓存（Text Context Cache）

**功能**:
- 保存**前几个utterance的转录文本**
- 用于Faster Whisper的`initial_prompt`参数
- 帮助ASR更好地理解上下文

**实现**:
```python
# context.py
text_context_cache: List[str] = []  # 存储前几个utterance的文本

def update_text_context(transcript: str):
    """更新文本上下文：保存前几个utterance的文本"""
    text_context_cache.append(transcript)
    # 限制缓存大小（例如：只保留最近5个utterance）
    if len(text_context_cache) > 5:
        text_context_cache.pop(0)
```

**使用**:
```python
# faster_whisper_vad_service.py
# 处理utterance时，使用文本上下文作为initial_prompt
text_context = get_text_context()  # 获取前几个utterance的文本
if text_context:
    initial_prompt = " ".join(text_context)
    # 传递给Faster Whisper
```

---

## 回答您的问题

### 问题1: 手动控制utterance合并多少语句？

**答案**: **只包含当前正在录制的一句话的剩余部分**，不是多句话

**原因**:
- `audioBuffer`是临时缓存，每100ms已经发送了一部分
- 剩余部分才是手动发送的内容
- 通常只有几百毫秒到几秒的数据

### 问题2: 只有上下文两句话吗？

**答案**: **不是**，上下文机制分为两部分：

1. **音频上下文**（Audio Context）:
   - 保存**前一个utterance的最后2秒音频**
   - 用于ASR的音频上下文
   - **不是2句话，而是前一句话的最后2秒**

2. **文本上下文**（Text Context）:
   - 保存**前几个utterance的转录文本**（通常5个）
   - 用于Faster Whisper的`initial_prompt`
   - **是多个utterance的文本，但数量可配置**

---

## 完整的数据流

### Web端 → 调度服务器 → 节点端 → 服务端

```
Web端录音
  → audioBuffer累积音频帧
  → 每100ms: sendAudioChunk() [流式发送]
  → 用户手动触发: sendCurrentUtterance() [发送剩余数据]
  → utterance消息 [包含当前一句话的剩余部分]
  
调度服务器
  → 接收utterance消息
  → 创建job
  → 发送给节点端
  
节点端
  → 转发给服务端
  
服务端处理
  → 获取音频上下文 [前一个utterance的最后2秒]
  → 拼接: context_audio + current_audio
  → 获取文本上下文 [前几个utterance的文本]
  → ASR识别: 使用initial_prompt = text_context
  → 更新音频上下文 [保存当前utterance的最后2秒]
  → 更新文本上下文 [保存当前utterance的文本]
```

---

## 上下文缓冲区大小

### 音频上下文

- **大小**: 2秒（`CONTEXT_DURATION_SEC = 2.0`）
- **内容**: 前一个utterance的最后2秒音频
- **用途**: ASR的音频上下文

### 文本上下文

- **大小**: 可配置（当前代码中可能没有明确限制，或限制为5个utterance）
- **内容**: 前几个utterance的转录文本
- **用途**: Faster Whisper的`initial_prompt`

---

## 总结

1. **Web端`audioBuffer`**: 只包含当前正在录制的一句话的剩余部分（不是多句话）

2. **服务端音频上下文**: 保存前一个utterance的最后2秒音频（不是2句话）

3. **服务端文本上下文**: 保存前几个utterance的文本（通常5个，可配置）

4. **手动控制utterance**: 发送的是当前buffer中的剩余数据，通常只有几百毫秒到几秒

---

## 相关配置

**文件**: `electron_node/services/faster_whisper_vad/config.py`

```python
# 音频上下文：2秒
CONTEXT_DURATION_SEC = 2.0
CONTEXT_SAMPLE_RATE = 16000
CONTEXT_MAX_SAMPLES = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)  # 32000样本
```

**文件**: `electron_node/services/faster_whisper_vad/context.py`

```python
# 文本上下文：可能需要检查是否有大小限制
text_context_cache: List[str] = []
```

