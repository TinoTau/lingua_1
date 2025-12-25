# 依赖安装指南

## 概述

Lingua Node Client 需要以下系统依赖：

### 必需依赖
- **Python 3.10+**：用于运行 Python 服务
- **ffmpeg**：用于 Opus 音频解码（faster-whisper-vad 服务）
  - ✅ **已打包到应用中**：用户无需手动安装
  - 如果打包版本不可用，会回退到系统 PATH 中的 ffmpeg

### 可选依赖（GPU 加速）
- **CUDA 11.8+**：用于 GPU 加速（推荐）
- **cuDNN 8.x/9.x**：ONNX Runtime GPU 支持

## 安装方式

### 方案1：用户手动安装（当前实现）

#### Python
- 下载：https://www.python.org/downloads/
- 安装时勾选 "Add Python to PATH"

#### ffmpeg
- **Windows**：
  1. 下载：https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
  2. 解压到 `C:\ffmpeg`
  3. 将 `C:\ffmpeg\bin` 添加到系统 PATH

- **Linux**：
  ```bash
  sudo apt-get install ffmpeg
  ```

- **macOS**：
  ```bash
  brew install ffmpeg
  ```

#### CUDA（可选）
- 下载：https://developer.nvidia.com/cuda-downloads
- 安装后会自动添加到 PATH

### 方案2：安装程序自动检查（推荐实现）

在安装程序中添加依赖检查脚本，如果缺失依赖：
1. 显示友好的错误提示
2. 提供下载链接
3. 引导用户安装

### 方案3：打包 ffmpeg 到应用（最佳体验）

将 ffmpeg 二进制文件打包到应用中，自动使用：
- 优点：用户无需手动安装
- 缺点：增加安装包大小（~50MB）

## 当前实现状态

### ✅ 已实现
- CUDA 环境自动检测和配置（`cuda-env.ts`）
- Python 依赖通过 `requirements.txt` 自动安装

### ✅ 已实现
- ffmpeg 自动检测（优先检查打包版本）
- ffmpeg 打包到应用
- Python 依赖通过 `requirements.txt` 自动安装

### ❌ 未实现
- 安装程序依赖检查

## 建议的改进

### 短期（v0.2.0）
1. 在应用启动时检查 ffmpeg
2. 如果缺失，显示友好的错误提示和安装指南

### 中期（v0.3.0）
1. 在安装程序中添加依赖检查
2. 提供一键安装脚本

### 长期（v0.4.0）
1. ✅ 将 ffmpeg 打包到应用中（已完成）
2. ✅ 自动配置环境变量（已完成）
3. 在安装程序中添加依赖检查

## 检查脚本示例

```typescript
// src/utils/dependency-checker.ts
export function checkFfmpegAvailable(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

