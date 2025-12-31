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

### Python

**必需依赖**，需要手动安装：

1. 下载：https://www.python.org/downloads/
2. 安装时勾选 "Add Python to PATH"
3. 验证安装：
   ```powershell
   python --version
   ```
   应该显示 Python 3.10 或更高版本

### ffmpeg

**已自动打包**，无需手动安装。如果打包版本不可用，可以手动安装：

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

### CUDA（可选）

用于 GPU 加速，可选安装：

1. 下载：https://developer.nvidia.com/cuda-downloads
2. 安装后会自动添加到 PATH
3. 应用会自动检测并使用 CUDA

## 当前实现状态

### ✅ 已实现

- **ffmpeg 自动打包和检测**
  - 打包到应用中（`tools/ffmpeg/bin/ffmpeg.exe`）
  - 自动检测打包版本，回退到系统版本
  - 自动配置 `FFMPEG_BINARY` 环境变量
  - 实现位置：`main/src/utils/dependency-checker.ts`、`main/src/utils/python-service-config.ts`

- **CUDA 环境自动检测和配置**
  - 自动检测 CUDA 安装路径
  - 自动配置 CUDA 环境变量
  - 实现位置：`main/src/utils/cuda-env.ts`

- **Python 依赖自动安装**
  - 通过各服务的 `requirements.txt` 自动安装
  - 虚拟环境自动管理

- **依赖检查器**
  - 启动时自动检查所有依赖
  - 提供详细的状态信息
  - 实现位置：`main/src/utils/dependency-checker.ts`

### ❌ 未实现

- 安装程序依赖检查（计划中）

## 依赖检查

应用启动时会自动检查所有依赖。检查结果会记录在日志中：

- ✅ **已安装**：依赖可用，版本信息已记录
- ⚠️ **缺失（必需）**：必需依赖缺失，应用可能无法正常工作
- ℹ️ **缺失（可选）**：可选依赖缺失，功能受限但不影响基本使用

### 手动检查依赖

依赖检查器提供以下函数：

```typescript
import { checkAllDependencies, validateRequiredDependencies } from './utils/dependency-checker';

// 检查所有依赖
const dependencies = checkAllDependencies();

// 验证必需依赖
const { valid, missing } = validateRequiredDependencies();
```

## 故障排除

### Python 未找到

**症状**：应用无法启动 Python 服务

**解决方案**：
1. 确认 Python 已安装：`python --version`
2. 确认 Python 在 PATH 中：`where python`（Windows）或 `which python`（Linux/macOS）
3. 如果不在 PATH 中，重新安装 Python 并勾选 "Add Python to PATH"

### ffmpeg 未找到

**症状**：faster-whisper-vad 服务无法解码 Opus 音频

**解决方案**：
1. 应用已打包 ffmpeg，通常不需要手动安装
2. 如果打包版本不可用，检查系统 PATH 中是否有 ffmpeg
3. 如果都没有，按照上述安装方式手动安装

### CUDA 未检测到

**症状**：GPU 加速不可用，使用 CPU 模式

**解决方案**：
1. 确认 CUDA 已正确安装
2. 检查 CUDA 路径是否在标准位置
3. CPU 模式也可以正常工作，只是速度较慢

## 相关文档

- [FFmpeg 配置与打包](./FFMPEG.md)：详细的 FFmpeg 配置说明

