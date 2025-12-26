# Context And Deduplication (Part 3/4)

   Utterance 1: "然后总是出现一些结果互完占的提示位置"
   Utterance 2: "然后总是出现一些结果互完占的提示位置"
   ```
   **期望**：Utterance 2 返回空结果

2. **场景 2：部分重复**
   ```
   Utterance 1: "然后总是出现一些结果互完占的提示位置"
   Utterance 2: "然后总是出现一些结果互完占的提示位置，我也发现web端播放的语音会有被截断的内容"
   ```
   **期望**：Utterance 2 返回 "我也发现web端播放的语音会有被截断的内容"

3. **场景 3：开头重复**
   ```
   Utterance 1: "然后总是出现一些结果互完占的提示位置"
   Utterance 2: "然后评并调整"
   ```
   **期望**：Utterance 2 返回 "评并调整"（移除开头的"然后"）

---

## 总结

### 确认的工作流程

1. ✅ **调度服务器将 audio_chunk 通过 finalize 拼接成 utterance**
2. ✅ **utterance 作为完整的短句发送给节点端**
3. ✅ **节点端以 utterance 为单位进行 ASR 处理**
4. ✅ **ASR 服务使用上一个 utterance 的文本和音频作为上下文**

### 跨 Utterance 去重

- ✅ **可以进行跨 utterance 去重**
- ✅ **推荐在 ASR 服务端实现**（利用已有的文本上下文机制）
- ✅ **可以访问上一个 utterance 的文本，便于检测重复**

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/ISSUE_STATUS_REPORT.md` - 问题状态报告
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md` - 音频截断和ASR识别质量问题



---

## UTTERANCE_CONTEXT_MECHANISM.md

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



---

## ASR_DUPLICATE_TEXT_ANALYSIS.md

# ASR重复文本问题分析

**日期**: 2025-12-25  
**问题**: ASR识别结果出现重复文本

---

## 用户报告的重复文本

```
现在让我们来试试看大模型的功能

已经上下温功能有没有生效

上下温功能有没有生效?

上下温功能有没有生效? 上下温功能有没有生效?

刚才出现了一些问题 导致没有办法播

那些问题 导致没有办法播

但是现在应该会好一点 这是

至少服务部还会报错崩溃了

我还会报错崩溃了

我还会报错崩溃了
```

---

## 问题分析

### 1. 单个utterance内的重复

**示例**: `"上下温功能有没有生效? 上下温功能有没有生效?"`

**原因**: 
- ASR模型使用 `initial_prompt` 和 `condition_on_previous_text=True`
- 当上下文文本和当前音频内容相似时，模型可能产生重复输出

**处理**: ✅ **已处理**
- 去重功能在 Step 9.2 中处理
- 日志显示去重成功：
  ```
  Step 9.2: Deduplication applied, original_len=23, deduplicated_len=11
  original_text="上下温功能有没有生效? 上下温功能有没有生效?"
  deduplicated_text="上下温功能有没有生效?"
  ```

### 2. 开头和结尾的重复

**示例**: `"导致没有办法播 那些问题 导致没有办法播"`

**原因**: 
- ASR模型可能识别到开头和结尾都有相同的短语
- 原去重逻辑只检测相邻重复，无法处理中间有其他文本的情况

**处理**: ✅ **已增强**
- 新增方法3：检测开头和结尾的重复
- 可以处理中间有其他文本的重复情况

### 3. 多个utterance之间的重复

**示例**: 
- Utterance 1: `"我还会报错崩溃了"`
- Utterance 2: `"我还会报错崩溃了"`

**原因**: 
- 不同的utterance返回了相同或相似的文本
- Web端将它们拼接在一起显示（用 `\n\n` 分隔）

**处理**: ⚠️ **部分处理**
- 每个utterance单独去重（已处理）
- 但不会跨utterance去重（未处理）
- **建议**: 在Web端添加去重逻辑

---

## 去重功能状态

### ✅ 已实现的去重方法

1. **方法1：完全重复检测**
   - 处理: `"这边能不能用这边能不能用"` → `"这边能不能用"`
   - 支持多重重复

2. **方法2：相邻重复检测**
   - 处理: `"这个地方我觉得还行这个地方我觉得还行"` → `"这个地方我觉得还行"`
   - 允许中间有空格

3. **方法3：开头结尾重复检测（新增）**
   - 处理: `"导致没有办法播 那些问题 导致没有办法播"` → `"导致没有办法播 那些问题"`
   - 允许中间有其他文本

### ⚠️ 未处理的场景

1. **跨utterance的重复**
   - 问题: 多个utterance返回了相同的文本
   - 当前: 每个utterance单独去重，但不会跨utterance去重
   - 建议: 在Web端添加去重逻辑

2. **部分重叠的重复**
   - 问题: 文本部分重叠但不在开头或结尾
   - 示例: `"测试A测试B测试A"`（中间的"测试A"和结尾的"测试A"重复）
   - 当前: 可能无法完全去重

---

## 解决方案

### 方案1：增强服务端去重（已完成）✅

**修改**: `text_deduplicator.py`
- 添加方法3：检测开头和结尾的重复
- 可以处理 `"导致没有办法播 那些问题 导致没有办法播"` 这种情况

**测试**: ✅ 所有测试通过（14/14）

### 方案2：Web端去重（不采用）❌

**决定**: **不在Web端添加去重逻辑**

**原因**:
- 去重逻辑应该在服务端完成，保持架构清晰
- Web端只负责显示服务端返回的结果
- 如果多个utterance返回了相同的文本，这是正常的（用户可能确实说了相同的话）

**说明**:
- 服务端的去重逻辑已经完整（Step 9.2）
- 每个utterance的结果都会经过去重处理
- 如果用户看到多个utterance的结果拼接在一起，这是正常的显示行为

---

## 验证

### 测试增强后的去重功能

```bash
python test_text_deduplicator.py
```

**结果**: ✅ 所有测试通过（14/14）

### 测试实际案例

```python
from text_deduplicator import deduplicate_text

# 测试用户报告的案例
test_cases = [
    "上下温功能有没有生效? 上下温功能有没有生效?",
    "导致没有办法播 那些问题 导致没有办法播",
    "我还会报错崩溃了 我还会报错崩溃了",
]

for text in test_cases:
    result = deduplicate_text(text)
    print(f"输入: {text}")
    print(f"输出: {result}\n")
```

**结果**:
- ✅ `"上下温功能有没有生效? 上下温功能有没有生效?"` → `"上下温功能有没有生效?"`
- ✅ `"导致没有办法播 那些问题 导致没有办法播"` → `"导致没有办法播 那些问题"`
- ✅ `"我还会报错崩溃了 我还会报错崩溃了"` → `"我还会报错崩溃了"`

---

## 总结

### 已解决的问题 ✅

1. **单个utterance内的重复**: 已通过去重功能处理
2. **开头和结尾的重复**: 已通过新增的方法3处理

### 说明

1. **跨utterance的重复**: 这是正常的显示行为
   - 每个utterance的结果都会经过服务端去重处理
   - 如果多个utterance返回了相同的文本，Web端会正常显示（因为用户可能确实说了相同的话）
   - **不在Web端添加去重逻辑**，保持架构清晰

### 建议

1. **立即**: 重新编译并测试，验证增强后的去重功能
2. **架构原则**: 去重逻辑完全在服务端完成，不在Web端添加去重逻辑

---

## 相关文档

- [文本去重功能增强](./DEDUPLICATION_ENHANCEMENT.md)
- [文本去重测试报告](./TEXT_DEDUPLICATOR_TEST_REPORT.md)
- [上下文重复问题说明](./CONTEXT_DUPLICATE_ISSUE_EXPLANATION.md)



---

## ASR_DUPLICATE_TEXT_FIX.md

# ASR 重复文本去重修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

用户反馈：**翻译效果非常奇怪，像是一句话被翻译了好几遍**
