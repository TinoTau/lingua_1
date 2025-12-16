# Lingua Web 客户端

Web 客户端是 Lingua 系统的用户界面，提供实时语音翻译功能。

## 技术栈

- **框架**: TypeScript + Vite
- **功能**: 实时语音采集、WebSocket 通信、TTS 播放、ASR 字幕

## 快速开始

### 使用启动脚本（推荐）

从项目根目录运行：

```powershell
.\scripts\start_web_client.ps1
```

启动脚本会自动：
- ✅ 检查 Node.js 和 npm 是否安装
- ✅ 检查并安装依赖（如果未安装）
- ✅ 检查端口 9001 是否被占用
- ✅ 创建日志目录并配置日志轮转（5MB）
- ✅ 启动开发服务器

### 手动启动

```bash
cd webapp/web-client
npm install
npm run dev
```

服务将在 `http://localhost:9001` 启动。

### 构建生产版本

```bash
npm run build
```

构建输出在 `dist/` 目录。

### 运行测试

```bash
npm test              # 运行所有测试
npm run test:watch    # 监听模式
npm run test:coverage # 生成覆盖率报告
```

## 主要功能

- ✅ 半双工模式（输入模式和输出模式自动切换）
- ✅ Send 按钮主导节奏
- ✅ 静音自动结束（1000ms 阈值 + 250ms 尾部缓冲）
- ✅ 播放期间完全关麦，避免回声问题
- ✅ ASR 实时字幕
- ✅ Utterance Group 上下文拼接
- ✅ 会话模式（持续输入+输出）
- ✅ 会议室模式（WebRTC 原声传递）

## 项目结构

```
web-client/
├── src/              # 源代码
│   ├── main.ts       # 应用入口
│   ├── app.ts        # 主应用类
│   ├── state_machine.ts  # 状态机
│   ├── recorder.ts       # 录音模块
│   ├── websocket_client.ts # WebSocket 客户端
│   ├── tts_player.ts     # TTS 播放器
│   ├── asr_subtitle.ts   # ASR 字幕
│   ├── audio_mixer.ts    # 音频混控器
│   ├── types.ts          # 类型定义
│   └── ui/               # UI 渲染器
├── tests/            # 测试文件
│   ├── stage2.1/     # 阶段 2.1 测试
│   ├── stage2.1.3/   # Utterance Group 测试
│   ├── stage3.2/     # 功能选择测试
│   ├── session_mode/ # 会话模式测试
│   └── room_mode/    # 会议室模式测试
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## 配置

### 调度服务器地址

默认调度服务器地址：`ws://localhost:5010/ws/session`

可以通过修改 `src/types.ts` 中的 `DEFAULT_CONFIG` 来更改：

```typescript
export const DEFAULT_CONFIG: Config = {
  schedulerUrl: 'ws://localhost:5010/ws/session',
  // ...
};
```

## 文档

详细文档请参考 `../docs/` 目录。
