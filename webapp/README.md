# Web 客户端

Web 客户端是 Lingua 系统的用户界面，提供实时语音翻译功能。

## 技术栈

- **框架**: TypeScript + Vite
- **功能**: 实时语音采集、WebSocket 通信、TTS 播放、ASR 字幕

## 快速开始

### 使用启动脚本（推荐）

```powershell
# 从项目根目录运行
.\scripts\start_web_client.ps1
```

### 手动启动

```bash
cd webapp/web-client
npm install
npm run dev
```

服务将在 `http://localhost:9001` 启动。

## 主要功能

- ✅ 半双工模式（输入模式和输出模式自动切换）
- ✅ Send 按钮主导节奏
- ✅ 静音自动结束（1000ms 阈值 + 250ms 尾部缓冲）
- ✅ 播放期间完全关麦，避免回声问题
- ✅ ASR 实时字幕
- ✅ Utterance Group 上下文拼接

## 文档

详细文档请参考 `docs/` 目录。

### 迁移文档

- **迁移说明**: `docs/MIGRATION.md` - 迁移内容和路径调整说明
- **文档索引**: `docs/README.md` - 文档索引
