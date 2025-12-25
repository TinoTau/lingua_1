# 问题状态报告

**日期**: 2025-12-25  
**状态**: 🔍 **问题分析中**

---

## 用户反馈的问题

用户报告仍然有大量重复的ASR和NMT输出：

**ASR重复示例**：
```
然後呢 我們
然後呢 我們的這個零輸出的方便
這個零輸出的方面 也添加了新的認識 看看有沒有效果
還有一個新的認識 看看有沒有效果
還有就是原始業的準確度還是要自於來看
原始業的準確度還是要自於來看
```

**NMT重复示例**：
```
And then we.
This is our zero-exporting convenience.
This zero-export aspect also added a new recognition to see if it does not work.
There is a new recognition to see if it works.
It is also the accuracy of the original work or to look at it.
The accuracy of the original work is to be seen.
```

---

## 日志分析

### 1. ASR服务日志

**关键发现**：
```
condition_on_previous_text=True  # ❌ 仍然是 True
```

**去重功能状态**：
```
Step 9.2: Deduplication applied  # ✅ 去重功能在工作
```

**问题**：
- ⚠️ `condition_on_previous_text=True` 仍然在使用
- ✅ 去重功能在工作，但可能无法处理跨 utterance 的重复

---

### 2. 调度服务器日志

**成功发送的结果**：
```
"Sending translation result to session (single mode)"
"text_asr": "原始業的準確度還是要自於來看"
"text_translated": "The accuracy of the original work is to be seen."
"tts_audio_len": 155024
```

**状态**：
- ✅ 调度服务器成功发送了翻译结果
- ✅ TTS 音频已生成并发送

---

## 问题分析

### 1. `condition_on_previous_text` 仍然是 `True`

**问题**：
- 虽然修改了 `asr_worker_process.py` 的默认值为 `False`
- 但日志显示 `condition_on_previous_text=True`

**可能的原因**：
1. **任务中明确传递了 `True`**：
   - `faster_whisper_vad_service.py` 中 `UtteranceRequest.condition_on_previous_text: bool = False`
   - 但可能在某个地方被覆盖为 `True`

2. **服务未重启**：
   - 修改后需要重启服务才能生效

3. **代码路径问题**：
   - 可能有多个代码路径，某些路径仍然使用 `True`

**需要检查**：
- `faster_whisper_vad_service.py` 中 `submit_task` 调用时传递的参数
- 是否有其他地方覆盖了 `condition_on_previous_text`

---

### 2. 跨 Utterance 重复

**问题**：
- 去重功能只处理单个 utterance 内的重复
- 无法处理跨多个 utterance 的重复

**示例**：
```
Utterance 1: "然後呢 我們"
Utterance 2: "然後呢 我們的這個零輸出的方便"  # 包含 Utterance 1 的内容
Utterance 3: "這個零輸出的方面 也添加了新的認識 看看有沒有效果"
Utterance 4: "還有一個新的認識 看看有沒有效果"  # 部分重复 Utterance 3
```

**解决方案**：
- 需要在调度服务器端实现跨 utterance 去重
- 或者在 Web 端实现去重（显示时去重）

---

### 3. ASR 上下文导致重复

**问题**：
- `condition_on_previous_text=True` 会导致 ASR 重复识别
- `initial_prompt` 包含之前的文本，如果当前音频与之前文本相似，会导致重复

**解决方案**：
- ✅ 已修复：将 `condition_on_previous_text` 默认值改为 `False`
- ⚠️ 需要确认：服务是否已重启，参数是否正确传递

---

## 已解决的问题

### ✅ 1. Web端音频缓存日志增强

**状态**: ✅ **已修复**

**修改**：
- 添加了详细的接收和处理日志
- 可以清楚地看到 Web 端是否收到消息

---

### ✅ 2. ASR Worker 默认值修复

**状态**: ✅ **已修复（但需要重启服务）**

**修改**：
- `asr_worker_process.py` 中 `condition_on_previous_text` 默认值改为 `False`

**注意**：
- 需要重启服务才能生效
- 需要确认参数是否正确传递

---

## 未解决的问题

### ❌ 1. `condition_on_previous_text` 仍然是 `True`

**状态**: ❌ **未解决**

**原因**：
- 服务可能未重启
- 或者任务中明确传递了 `True`

**下一步**：
1. 确认服务已重启
2. 检查 `faster_whisper_vad_service.py` 中 `submit_task` 调用
3. 确认参数传递路径

---

### ❌ 2. 跨 Utterance 重复

**状态**: ❌ **未解决**

**原因**：
- 当前去重功能只处理单个 utterance 内的重复
- 无法处理跨多个 utterance 的重复

**下一步**：
- 实现跨 utterance 去重（调度服务器端或 Web 端）

---

### ❌ 3. ASR 识别准确度

**状态**: ❌ **需要进一步分析**

**问题**：
- 用户反馈识别准确度差
- 日志显示乱码（可能是编码问题）

**下一步**：
- 检查 ASR 上下文参数是否正确
- 检查模型配置
- 检查音频质量

---

## 下一步行动

### 立即行动

1. **确认服务重启**：
   - 重启 `faster-whisper-vad` 服务
   - 确认 `condition_on_previous_text=False` 生效

2. **检查参数传递**：
   - 检查 `faster_whisper_vad_service.py` 中 `submit_task` 调用
   - 确认 `condition_on_previous_text` 参数传递路径

3. **验证修复**：
   - 重新测试，查看日志确认 `condition_on_previous_text=False`
   - 检查是否还有重复

---

### 后续行动

1. **实现跨 Utterance 去重**：
   - 在调度服务器端实现
   - 或在 Web 端实现（显示时去重）

2. **ASR 准确度优化**：
   - 检查 ASR 上下文参数
   - 检查模型配置
   - 检查音频质量

---

## 相关文档

- `WEB_CLIENT_AUDIO_BUFFER_AND_ASR_CONTEXT_ISSUES.md` - Web端音频缓存和ASR上下文问题分析
- `ASR_CONTEXT_AND_OUTPUT_LOGGING.md` - ASR上下文和输出日志
- `TEXT_DEDUPLICATOR_TEST_REPORT.md` - 文本去重测试报告

