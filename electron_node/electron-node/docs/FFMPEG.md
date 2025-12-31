# FFmpeg 配置与打包

## 概述

FFmpeg 用于 Opus 音频解码（faster-whisper-vad 服务）。应用已自动打包 FFmpeg，用户无需手动安装。

## 实现状态

### ✅ 已实现

- FFmpeg 已打包到应用中（`tools/ffmpeg/bin/ffmpeg.exe`）
- 自动检测打包版本，如果不可用则回退到系统 PATH
- Python 服务自动配置 `FFMPEG_BINARY` 环境变量
- 依赖检查器自动验证 FFmpeg 可用性

## 打包配置

在 `electron-builder.yml` 中配置：

```yaml
extraFiles:
  - from: "tools/ffmpeg/bin"
    to: "tools/ffmpeg/bin"
    filter:
      - "ffmpeg.exe"
      - "ffprobe.exe"
```

## 目录结构

```
electron_node/electron-node/
├── tools/
│   └── ffmpeg/
│       └── bin/
│           ├── ffmpeg.exe      # Windows 可执行文件
│           └── ffprobe.exe     # 可选，用于音频信息
```

## 自动配置

### 开发环境

- 自动从 `{projectRoot}/electron_node/electron-node/tools/ffmpeg/bin/ffmpeg.exe` 查找
- 如果找到，设置 `FFMPEG_BINARY` 环境变量

### 生产环境

- 自动从 `{appPath}/tools/ffmpeg/bin/ffmpeg.exe` 查找
- 如果找到，设置 `FFMPEG_BINARY` 环境变量

### 环境变量设置

在 `python-service-config.ts` 中自动配置：

```typescript
if (ffmpegBinary) {
  env.FFMPEG_BINARY = ffmpegBinary;
  env.PATH = `${path.dirname(ffmpegBinary)};${env.PATH}`;
}
```

pydub 会自动使用 `FFMPEG_BINARY` 环境变量。

## 依赖检查

`dependency-checker.ts` 提供自动检查功能：

- 优先检查打包的 ffmpeg
- 如果打包版本不可用，回退到系统 PATH
- 返回详细的状态信息（版本、路径等）

## FFmpeg 版本信息

- **版本**: ffmpeg 8.0.1-essentials_build-www.gyan.dev
- **构建**: 静态构建（包含所有 DLL）
- **Opus 支持**: ✅ 已启用 (`--enable-libopus`)
- **来源**: https://www.gyan.dev/ffmpeg/builds/

## 使用流程

### 开发环境

1. FFmpeg 自动从 `tools/ffmpeg/bin/ffmpeg.exe` 加载
2. 环境变量自动设置
3. pydub 自动使用打包的 ffmpeg

### 生产环境

1. 运行 `npm run package:win` 打包应用
2. FFmpeg 自动包含在安装包中
3. 用户安装后，FFmpeg 自动可用
4. 无需用户手动安装

## 验证

### 验证 FFmpeg 可执行

```powershell
.\tools\ffmpeg\bin\ffmpeg.exe -version
```

### 验证 Opus 支持

```powershell
.\tools\ffmpeg\bin\ffmpeg.exe -codecs | Select-String "opus"
```

应该看到：
- `libopus` (编码器)
- `opus` (解码器)

### 测试打包

```powershell
cd electron_node/electron-node
npm run package:win
```

打包后检查 `dist/win-unpacked/tools/ffmpeg/bin/ffmpeg.exe` 是否存在。

## 优势

1. **用户体验**：用户无需手动安装 ffmpeg
2. **可靠性**：使用固定版本，避免兼容性问题
3. **自动化**：应用自动配置，无需用户干预
4. **回退机制**：如果打包版本不可用，自动回退到系统版本

## 注意事项

1. **许可证**：FFmpeg 使用 LGPL/GPL 许可证，请确保遵守许可证要求
2. **文件大小**：FFmpeg 会增加约 50-60 MB 的安装包大小
3. **更新**：如果需要更新 FFmpeg，只需替换 `tools/ffmpeg/bin/ffmpeg.exe` 并重新打包

## 相关文件

- `electron-builder.yml`: 打包配置
- `main/src/utils/python-service-config.ts`: Python 服务配置
- `main/src/utils/dependency-checker.ts`: 依赖检查

