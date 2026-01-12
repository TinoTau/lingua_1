# FFmpeg 打包说明

## ✅ FFmpeg 已配置

FFmpeg 已成功放置在此目录，配置已完成。

## 文件位置

- **ffmpeg.exe**: `tools/ffmpeg/bin/ffmpeg.exe`
- **ffprobe.exe**: `tools/ffmpeg/bin/ffprobe.exe` (可选)

## 配置验证

### 1. 打包配置 (`electron-builder.yml`)
```yaml
extraFiles:
  - from: "tools/ffmpeg/bin"
    to: "tools/ffmpeg/bin"
    filter:
      - "ffmpeg.exe"
      - "ffprobe.exe"
```

### 2. Python 服务配置
- 开发环境：自动从 `tools/ffmpeg/bin/ffmpeg.exe` 查找
- 生产环境：自动从打包后的 `tools/ffmpeg/bin/ffmpeg.exe` 查找
- 环境变量：自动设置 `FFMPEG_BINARY` 和 `PATH`

### 3. 依赖检查
- 优先检查打包的 ffmpeg
- 如果打包版本不可用，回退到系统 PATH

## 测试

运行以下命令验证配置：

```powershell
# 验证 ffmpeg 可执行
.\tools\ffmpeg\bin\ffmpeg.exe -version

# 验证 Opus 支持
.\tools\ffmpeg\bin\ffmpeg.exe -codecs | Select-String "opus"
```

## 版本信息

当前版本：ffmpeg 8.0.1-essentials_build-www.gyan.dev
- ✅ 包含 Opus 编解码器支持
- ✅ 静态构建（包含所有 DLL）
- ✅ 适合打包到应用中

## 许可证

FFmpeg 使用 LGPL/GPL 许可证，请确保遵守许可证要求。

