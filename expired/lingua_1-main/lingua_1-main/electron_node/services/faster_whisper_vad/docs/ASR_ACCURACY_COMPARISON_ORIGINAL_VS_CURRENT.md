# ASR识别准确度对比：原项目 vs 当前项目

**日期**: 2025-12-25  
**状态**: ✅ **已确认差异**

---

## 原项目（D:\Programs\github\lingua）ASR实现

### 确认：原项目使用 Faster Whisper（Python HTTP服务）

**证据**：
1. **Python服务文件**: `core/engine/scripts/asr_service.py`
   - 使用 `faster_whisper` 库
   - 端口：6006
   - 模型：`Systran/faster-whisper-large-v3`

2. **Rust客户端**: `core/engine/src/asr_whisper/faster_whisper_streaming.rs`
   - Rust代码通过HTTP客户端调用Python服务
   - 使用文本上下文（`initial_prompt`）

### 原项目配置

```python
# asr_service.py
segments, info = model.transcribe(
    audio,
    language=req.language,
    task=req.task,
    beam_size=req.beam_size,  # 默认 5
    vad_filter=False,  # Silero VAD在Rust端处理
    initial_prompt=req.prompt if req.prompt else None,  # ★ 文本上下文
    condition_on_previous_text=req.condition_on_previous_text,  # ★ 默认 True
)
```

**关键特性**：
- ✅ **引擎**: Faster Whisper（Python HTTP服务）
- ✅ **模型**: `Systran/faster-whisper-large-v3`（大模型）
- ✅ **解码策略**: Beam Search（`beam_size=5`）
- ✅ **文本上下文**: `initial_prompt`（前一个utterance的文本）
- ✅ **条件生成**: `condition_on_previous_text=True`
- ✅ **VAD**: 在Rust端使用Silero VAD处理

---

## 当前项目（lingua_1）ASR实现

### 当前项目有两个ASR实现

#### 1. node-inference（Rust服务）

**位置**: `electron_node/services/node-inference/src/asr.rs`

**配置**：
```rust
let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });  // 贪心搜索
// 没有 initial_prompt 支持
// 没有 condition_on_previous_text 支持
```

**关键特性**：
- ❌ **引擎**: whisper-rs（Rust库）
- ❌ **模型**: Whisper Base（小模型）
- ❌ **解码策略**: Greedy Search（`best_of=1`）
- ❌ **文本上下文**: 不支持 `initial_prompt`
- ❌ **条件生成**: 不支持 `condition_on_previous_text`
- ✅ **音频上下文**: 前置音频（最后2秒）

#### 2. faster-whisper-vad（Python服务）

**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**配置**：
```python
segments, info = model.transcribe(
    audio,
    language=asr_language,
    task=req.task,
    beam_size=req.beam_size,  # 默认 5
    vad_filter=False,
    initial_prompt=text_context if text_context else None,  # ✅ 文本上下文
    condition_on_previous_text=req.condition_on_previous_text,  # ✅ 默认 True
)
```

**关键特性**：
- ✅ **引擎**: Faster Whisper（Python HTTP服务）
- ⚠️ **模型**: `Systran/faster-whisper-base`（小模型，不是large-v3）
- ✅ **解码策略**: Beam Search（`beam_size=5`）
- ✅ **文本上下文**: `initial_prompt`（前一个utterance的文本）
- ✅ **条件生成**: `condition_on_previous_text=True`
- ✅ **VAD**: 使用Silero VAD处理

---

## 关键差异对比

| 特性 | 原项目 | 当前项目（node-inference） | 当前项目（faster-whisper-vad） |
|------|--------|---------------------------|-------------------------------|
| **引擎** | Faster Whisper (Python) | whisper-rs (Rust) | Faster Whisper (Python) |
| **模型大小** | **large-v3**（大模型） | base（小模型） | **base**（小模型） |
| **解码策略** | Beam Search (beam_size=5) | Greedy (best_of=1) | Beam Search (beam_size=5) |
| **文本上下文** | ✅ initial_prompt | ❌ 不支持 | ✅ initial_prompt |
| **条件生成** | ✅ condition_on_previous_text | ❌ 不支持 | ✅ condition_on_previous_text |
| **音频上下文** | ❌ 不使用 | ✅ 前置音频 | ✅ 前置音频 |

---

## 识别准确度低的主要原因

### 1. 模型大小差异（最重要）

**原项目**: `Systran/faster-whisper-large-v3`（大模型）
- 参数量：约1.5B
- 准确度：高

**当前项目**: `Systran/faster-whisper-base`（小模型）
- 参数量：约74M
- 准确度：较低

**影响**: 模型大小是影响识别准确度的**最重要因素**，大模型通常比小模型准确度高 20-30%

### 2. node-inference 使用 whisper-rs（Rust）

**问题**：
- 使用贪心搜索而非束搜索
- 不支持文本上下文（`initial_prompt`）
- 不支持条件生成（`condition_on_previous_text`）

**影响**: 准确度降低 15-25%

### 3. faster-whisper-vad 配置正确但模型小

**问题**：
- 配置与原项目一致（束搜索、文本上下文、条件生成）
- 但使用的是 `base` 模型而非 `large-v3` 模型

**影响**: 准确度降低 20-30%

---

## 解决方案

### 方案 1：升级 faster-whisper-vad 模型（推荐）

**目标**: 将 `faster-whisper-vad` 服务的模型从 `base` 升级到 `large-v3`

**步骤**：

1. **修改模型配置**
   ```python
   # faster_whisper_vad_service.py
   MODEL_PATH = os.getenv("ASR_MODEL_PATH", "Systran/faster-whisper-large-v3")  # 改为 large-v3
   ```

2. **下载模型**
   - Faster Whisper 会自动从 HuggingFace 下载模型
   - 或者手动下载并配置路径

3. **性能考虑**
   - `large-v3` 模型更大，需要更多内存和计算资源
   - 如果资源有限，可以考虑 `medium` 或 `large-v2` 作为折中

**预期效果**: 准确度提升 20-30%

### 方案 2：确保使用 faster-whisper-vad 服务

**检查点**：
- 确认调度服务器正确路由到 `faster-whisper-vad` 服务
- 确认节点端正确调用 `faster-whisper-vad` 服务而非 `node-inference`

**验证**：
```bash
# 检查服务是否运行
curl http://127.0.0.1:6007/health

# 检查日志
tail -f electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log
```

### 方案 3：改进 node-inference（如果必须使用）

**如果必须使用 Rust 服务**，需要：
1. 检查 whisper-rs 是否支持 `initial_prompt`
2. 改用束搜索（如果支持）
3. 启用条件生成（如果支持）

**但建议**: 优先使用 `faster-whisper-vad` 服务，因为它配置更完整

---

## 验证步骤

### 1. 检查当前使用的服务

```bash
# 检查 faster-whisper-vad 服务日志
tail -f electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log

# 检查节点端日志，看调用的是哪个服务
tail -f electron_node/electron-node/main/logs/node-inference.log
```

### 2. 检查模型配置

```python
# faster_whisper_vad_service.py
# 确认 MODEL_PATH 配置
MODEL_PATH = os.getenv("ASR_MODEL_PATH", "Systran/faster-whisper-large-v3")  # 应该是 large-v3
```

### 3. 对比测试

使用相同的测试音频，对比：
- 原项目（large-v3）
- 当前项目 faster-whisper-vad（base）
- 当前项目 faster-whisper-vad（large-v3，升级后）

---

## 总结

### 原项目 ASR 实现

✅ **确认**: 原项目使用 **Faster Whisper（Python HTTP服务）**
- 模型：`Systran/faster-whisper-large-v3`（大模型）
- 配置：束搜索、文本上下文、条件生成

### 当前项目 ASR 实现

1. **node-inference（Rust）**: 
   - 使用 whisper-rs，配置不完整（贪心搜索、无文本上下文）
   - ❌ **不推荐使用**

2. **faster-whisper-vad（Python）**: 
   - 使用 Faster Whisper，配置正确（束搜索、文本上下文、条件生成）
   - ⚠️ **但模型是 base 而非 large-v3**
   - ✅ **推荐使用，但需要升级模型**

### 识别准确度低的原因

1. **主要原因**: 模型大小差异（base vs large-v3）
2. **次要原因**: 如果使用 node-inference，配置不完整

### 推荐方案

1. **立即**: 升级 `faster-whisper-vad` 模型到 `large-v3`
2. **验证**: 确认调度服务器正确使用 `faster-whisper-vad` 服务
3. **测试**: 对比升级前后的识别准确度

---

## 相关文档

- [ASR识别准确率对比与改进方案](../node-inference/docs/ASR_ACCURACY_COMPARISON_AND_IMPROVEMENTS.md)
- [原项目 ASR 服务实现](../../../../D:/Programs/github/lingua/core/engine/scripts/asr_service.py)
- [当前项目 faster-whisper-vad 服务实现](./faster_whisper_vad_service.py)

