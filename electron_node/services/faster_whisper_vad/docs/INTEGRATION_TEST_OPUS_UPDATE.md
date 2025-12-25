# 集成测试脚本更新 - 使用 Opus 格式

**日期**: 2025-12-25  
**状态**: ✅ **已更新**

---

## 更新说明

根据用户反馈，调度服务器现在只接受 Opus 格式，不再接受 PCM16。测试脚本已更新为使用 Opus Plan A 格式。

---

## 主要变更

### 1. 音频格式改为 Opus ✅

- **之前**: 使用 PCM16 格式（直接发送 WAV 文件内容）
- **现在**: 使用 Opus Plan A 格式（将 WAV 转换为 Opus packets）

### 2. 必需的库

测试脚本现在需要以下库：

```bash
pip install numpy soundfile pyogg scipy
```

- **numpy**: 音频数据处理
- **soundfile**: 读取 WAV 文件（支持 format 3）
- **pyogg**: Opus 编码
- **scipy**: 音频重采样

### 3. 转换流程

1. **读取 WAV 文件**: 使用 `soundfile` 读取（支持多种格式）
2. **重采样**: 如果采样率不是 16000Hz，重采样到 16000Hz
3. **Opus 编码**: 使用 `pyogg` 将音频编码为 Opus packets（每 20ms 一帧）
4. **Plan A 格式**: 为每个 packet 添加长度前缀（`uint16_le packet_len + packet_bytes`）
5. **Base64 编码**: 转换为 base64 字符串
6. **发送请求**: 使用 `audio_format="opus"` 发送到服务

---

## 使用方法

### 1. 安装依赖

```bash
pip install numpy soundfile pyogg scipy requests
```

### 2. 运行测试

```bash
python test_integration_wav.py
```

### 3. 测试文件

- 中文文件: `D:\Programs\github\lingua_1\electron_node\services\test\chinese.wav`
- 英文文件: `D:\Programs\github\lingua_1\electron_node\services\test\english.wav`

---

## 测试内容

1. **健康检查**: 验证服务状态
2. **中文识别**: 测试中文音频识别
3. **英文识别**: 测试英文音频识别
4. **多个顺序请求**: 测试连续请求处理
5. **Worker 稳定性**: 验证进程隔离架构

---

## 注意事项

1. **环境要求**: 测试脚本需要与服务相同的 Python 环境（包含所有依赖库）
2. **服务运行**: 确保 ASR 服务在 `http://127.0.0.1:6007` 运行
3. **音频格式**: 现在只支持 Opus Plan A 格式

---

## 错误处理

如果缺少必需的库，测试脚本会在启动时检查并提示：

```
❌ 缺少必需的库，请先安装：
   pip install numpy soundfile pyogg scipy
```

---

**更新完成时间**: 2025-12-25  
**状态**: ✅ **已更新为 Opus 格式**

