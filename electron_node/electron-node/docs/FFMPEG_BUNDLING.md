# FFmpeg 打包指南

## 推荐下载版本

### Windows x64（推荐）
- **下载地址**：https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
- **版本**：最新稳定版（release-essentials）
- **大小**：约 50-60 MB
- **特点**：
  - 静态构建（static build），包含所有必需的 DLL
  - 包含所有常用编解码器
  - 无需额外依赖
  - 适合打包到应用中

### 其他平台
- **Linux x64**：从系统包管理器安装，或下载静态构建版本
- **macOS**：使用 Homebrew 安装，或下载静态构建版本

## 目录结构

将 ffmpeg 解压后，目录结构应该是：

```
electron_node/electron-node/
├── tools/
│   └── ffmpeg/
│       ├── bin/
│       │   ├── ffmpeg.exe      # Windows
│       │   ├── ffprobe.exe     # 可选，用于音频信息
│       │   └── ffplay.exe      # 可选，用于播放
│       ├── doc/
│       └── presets/
```

## 打包配置

在 `electron-builder.yml` 中添加：

```yaml
extraFiles:
  # ... 其他文件 ...
  
  # FFmpeg 工具
  - from: "tools/ffmpeg/bin"
    to: "tools/ffmpeg/bin"
    filter:
      - "ffmpeg.exe"
      - "ffprobe.exe"  # 可选
```

## 环境变量配置

在 Python 服务启动时，设置 `FFMPEG_BINARY` 环境变量：

```typescript
// python-service-config.ts
const ffmpegPath = path.join(projectRoot, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
env.FFMPEG_BINARY = ffmpegPath;
```

## 使用方式

pydub 会自动使用 `FFMPEG_BINARY` 环境变量，如果未设置则从 PATH 查找。

## 许可证

FFmpeg 使用 LGPL/GPL 许可证，请确保遵守许可证要求。

