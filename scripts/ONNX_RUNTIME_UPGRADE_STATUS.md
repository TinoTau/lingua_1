# ONNX Runtime 升级状态

## 当前配置

### ✅ 已完成
1. **cuDNN 9.6 已安装**：`C:\Program Files\NVIDIA\CUDNN\v9.6`
2. **启动脚本已更新**：自动检测 cuDNN 9.6 并配置 PATH
3. **ort crate 已升级**：从 1.16.3 升级到 2.0.0-rc.10

### ⚠️ 当前问题
ort crate 2.0.0-rc.10 的 API 与 1.16.3 差异很大，需要大量代码修改：
- `SessionBuilder` 是私有的，无法直接使用
- `Environment` 和 `Tensor` 的导入路径可能不同
- `Value::from_array()` 和输出提取方法已改变

### 📊 影响范围
**只有 VAD 模块受影响**：
- ✅ ASR 模块：使用 whisper-rs（不受影响）
- ✅ NMT 模块：使用 HTTP 客户端（不受影响）
- ✅ TTS 模块：使用 HTTP 客户端（不受影响）
- ⚠️ VAD 模块：使用 ONNX Runtime（需要修改代码）

## 解决方案

### 方案 1：继续修复 ort crate 2.0.0-rc.10 API（进行中）
需要查看实际的 API 文档或源代码来确定正确的用法。

### 方案 2：回退到 ort crate 1.16.3 + 手动安装 ONNX Runtime 1.17/1.18
- 优点：代码改动最小
- 缺点：需要手动管理 ONNX Runtime 安装
- 状态：未实施

## 建议

由于 ort crate 2.0.0-rc.10 是预发布版本，API 可能不稳定。建议：
1. 先配置好 cuDNN 9.6 的 PATH（已完成）
2. 查看 ort crate 2.0.0-rc.10 的实际 API 文档
3. 如果 API 修复困难，考虑方案 2
