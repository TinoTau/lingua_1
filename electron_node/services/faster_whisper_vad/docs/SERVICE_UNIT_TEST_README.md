# faster_whisper_vad 服务单元测试说明

**日期**: 2025-12-24  
**测试文件**: `test_service_unit.py`

---

## 1. 测试概述

本测试套件对 faster_whisper_vad 服务的所有API端点和核心功能进行单元测试。

### 测试范围

- ✅ 健康检查端点 (`/health`)
- ✅ 重置端点 (`/reset`)
- ✅ Utterance处理端点 (`/utterance`)
- ✅ 音频格式处理（PCM16、Opus packet格式、Opus连续字节流）
- ✅ 错误处理和边界情况

---

## 2. 运行要求

### 2.1 服务运行

**必须先启动 faster_whisper_vad 服务**：

```bash
cd electron_node/services/faster_whisper_vad
python faster_whisper_vad_service.py
```

服务启动后，应该监听在 `http://127.0.0.1:6007`

### 2.2 依赖安装

```bash
pip install requests numpy pyogg
```

**注意**：
- `pyogg` 是可选的，用于测试Opus编码功能
- 如果 `pyogg` 不可用，相关测试会被跳过

---

## 3. 运行测试

### 3.1 运行所有测试

```bash
cd electron_node/services/faster_whisper_vad
python test_service_unit.py
```

### 3.2 测试输出

测试会输出详细的日志信息，包括：
- 每个测试的执行状态
- 测试结果（通过/失败/跳过）
- 错误信息（如果有）

---

## 4. 测试用例

### 4.1 健康检查测试

- **测试**: `TestServiceHealth.test_health_check`
- **验证**: 服务健康状态、模型加载状态

### 4.2 重置端点测试

- **测试**: `TestResetEndpoint.test_reset_all`
- **测试**: `TestResetEndpoint.test_reset_partial`
- **验证**: VAD状态、上下文缓冲区、文本上下文的重置

### 4.3 音频格式测试

#### PCM16音频

- **测试**: `TestAudioFormat.test_pcm16_audio`
- **验证**: PCM16格式音频的正确处理

#### Opus Packet格式（方案A）

- **测试**: `TestAudioFormat.test_opus_packet_format`
- **验证**: 方案A的packet格式解码功能
- **要求**: `pyogg` 库可用

#### Opus连续字节流

- **测试**: `TestAudioFormat.test_opus_continuous_stream`
- **验证**: 连续字节流格式的处理（已知存在问题）
- **预期**: 可能失败（符合预期）

### 4.4 Utterance端点测试

#### 基本功能

- **测试**: `TestUtteranceEndpoint.test_basic_utterance`
- **验证**: 基本的utterance处理流程

#### 自动语言检测

- **测试**: `TestUtteranceEndpoint.test_auto_language_detection`
- **验证**: 自动语言检测功能

#### 上下文缓冲区

- **测试**: `TestUtteranceEndpoint.test_context_buffer`
- **验证**: 上下文缓冲区的使用

#### 错误处理

- **测试**: `TestUtteranceEndpoint.test_invalid_audio_format`
- **测试**: `TestUtteranceEndpoint.test_missing_required_fields`
- **验证**: 错误情况的正确处理

### 4.5 错误处理测试

- **测试**: `TestErrorHandling.test_invalid_base64`
- **测试**: `TestErrorHandling.test_empty_audio`
- **验证**: 各种错误情况的处理

---

## 5. 测试结果解读

### 5.1 测试状态

- ✅ **通过**: 测试成功完成
- ❌ **失败**: 测试失败，需要检查
- ⏭️ **跳过**: 测试被跳过（通常是因为依赖不可用）

### 5.2 预期结果

**正常情况**：
- 健康检查：✅ 通过
- 重置端点：✅ 通过
- PCM16音频：✅ 通过
- 基本utterance：✅ 通过
- 自动语言检测：✅ 通过
- 上下文缓冲区：✅ 通过
- 错误处理：✅ 通过

**可选测试**（需要pyogg）：
- Opus packet格式：✅ 通过 或 ⏭️ 跳过
- Opus连续字节流：✅ 通过 或 ⏭️ 跳过 或 ❌ 失败（符合预期）

---

## 6. 故障排查

### 6.1 服务不可用

**错误**: `❌ 服务不可用: http://127.0.0.1:6007`

**解决方案**:
1. 检查服务是否正在运行
2. 检查端口6007是否被占用
3. 检查防火墙设置

### 6.2 测试失败

**常见原因**:
1. **模型未加载**: 检查模型文件是否存在
2. **CUDA/cuDNN问题**: 检查GPU配置
3. **依赖缺失**: 检查所有依赖是否安装

### 6.3 Opus测试跳过

**原因**: `pyogg` 库不可用

**解决方案**:
```bash
pip install pyogg
```

---

## 7. 测试数据

### 7.1 测试音频

测试使用生成的测试音频：
- **格式**: PCM16 WAV
- **采样率**: 16kHz
- **声道**: 单声道
- **内容**: 440Hz正弦波

### 7.2 Opus编码

如果 `pyogg` 可用，测试会：
1. 生成测试音频
2. 编码为Opus packets
3. 按方案A格式打包（length-prefixed）
4. 发送到服务进行解码

---

## 8. 持续集成

### 8.1 自动化测试

可以在CI/CD流程中运行：

```bash
# 启动服务（后台）
python faster_whisper_vad_service.py &
SERVICE_PID=$!

# 等待服务启动
sleep 10

# 运行测试
python test_service_unit.py
TEST_RESULT=$?

# 停止服务
kill $SERVICE_PID

# 退出
exit $TEST_RESULT
```

### 8.2 测试覆盖率

当前测试覆盖：
- ✅ API端点（100%）
- ✅ 音频格式处理（PCM16、Opus）
- ✅ 错误处理
- ⚠️ 边界情况（部分）

---

## 9. 参考

- **测试文件**: `test_service_unit.py`
- **服务文件**: `faster_whisper_vad_service.py`
- **方案A实现**: `opus_packet_decoder.py`

---

## 10. 更新日志

- **2025-12-24**: 创建初始测试套件
  - 健康检查测试
  - 重置端点测试
  - 音频格式测试（PCM16、Opus）
  - Utterance端点测试
  - 错误处理测试

