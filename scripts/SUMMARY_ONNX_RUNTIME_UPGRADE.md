# ONNX Runtime 升级总结

## 当前情况

### 已完成的配置
1. ✅ cuDNN 9.6 已安装：`C:\Program Files\NVIDIA\CUDNN\v9.6`
2. ✅ 启动脚本已更新，支持自动检测 cuDNN 9.6 并配置 PATH
3. ✅ ort crate 已升级到 2.0.0-rc.10（对应 ONNX Runtime 1.22）

### 影响范围
- **只有 VAD 模块使用 ONNX Runtime**（`node-inference/src/vad.rs`）
- 其他模块不受影响：
  - ASR：使用 whisper-rs（独立依赖）
  - NMT：使用 HTTP 客户端（不依赖 ONNX Runtime）
  - TTS：使用 HTTP 客户端（不依赖 ONNX Runtime）

### 当前问题
ort crate 2.0.0-rc.10 的 API 与 1.16.3 差异较大，需要修改代码以适配新 API。

## 解决方案

### 方案 1：继续修复 ort crate 2.0.0-rc.10 的 API（推荐）
- 优点：使用最新版本，支持 CUDA 12.4 和 cuDNN 9.x
- 缺点：需要修改代码以适配新 API
- 状态：进行中

### 方案 2：手动安装 ONNX Runtime 1.17/1.18，使用 system 策略
- 优点：可以保持 ort crate 1.16.3，代码改动最小
- 缺点：需要手动管理 ONNX Runtime 安装
- 状态：未实施

## 下一步操作

1. **配置 cuDNN 9.6 PATH**（已完成）
   - 启动脚本会自动检测并配置

2. **修复 ort crate 2.0.0-rc.10 API**
   - 需要查看实际的 API 文档或源代码
   - 可能需要使用不同的导入路径和方法

3. **测试 VAD GPU 加速**
   - 启动服务后检查日志，确认 CUDA 执行提供者是否启用

## 建议

由于 ort crate 2.0.0-rc.10 是预发布版本，API 可能不稳定。如果遇到困难，可以考虑：
- 等待 ort crate 2.0 正式版发布
- 或使用方案 2（手动安装 ONNX Runtime）
