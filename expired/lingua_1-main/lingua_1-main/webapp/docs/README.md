# Web 客户端文档

本文档目录包含 Web 客户端的所有产品设计、说明和技术方案文档。

## 文档列表

### 产品设计
- `webClient/Web_端实时语音翻译_功能需求说明_FRD.md` - 功能需求文档
- `webClient/Web_端实时语音翻译_技术方案_TechSpec.md` - 技术方案文档
- `webClient/Web_端实时语音翻译_统一设计方案_v3.md` - 统一设计方案
- `webClient/Web_端半双工实时语音翻译交互与上下文拼接设计说明_v2.md` - 半双工交互设计

### 架构设计
- `webClient/PRODUCT_ARCHITECTURE_AND_SESSION_MANAGEMENT.md` - 产品架构和会话管理
- `webClient/FACE_TO_FACE_MODE.md` - 面对面模式设计
- `webClient/FACE_TO_FACE_MODE_CONNECTION.md` - 面对面模式连接
- `webClient/UTTERANCE_GROUP.md` - Utterance Group 设计

### 可行性分析
- `webClient/WEB_CLIENT_SCHEME_FEASIBILITY_ANALYSIS.md` - 方案可行性分析
- `webClient/WEB_CLIENT_V3_FEASIBILITY_ASSESSMENT.md` - V3 可行性评估

### WebRTC 相关
- `webRTC/` - WebRTC 相关文档
  - `ROOM_MODE_CONNECTION_AND_ROUTING.md` - 会议室模式连接和路由
  - `ROOM_MODE_SCHEDULING_LOGIC.md` - 会议室模式调度逻辑
  - `WEBRTC_AUDIO_MIXER_IMPLEMENTATION.md` - WebRTC 音频混控器实现
  - 其他 WebRTC 相关文档

### iOS 相关（参考）
- `IOS/` - iOS 客户端设计文档（作为参考）

## 快速参考

- **主要功能**: 实时语音采集、WebSocket 通信、TTS 播放、ASR 字幕
- **技术栈**: TypeScript + Vite
- **项目位置**: `webapp/web-client/`
- **开发服务器**: `http://localhost:9001`
- **启动脚本**: `scripts/start_web_client.ps1`
- **快速开始**: 查看 `QUICK_START.md`
- **迁移文档**: 查看 `MIGRATION.md`

## 项目结构

```
webapp/
├── web-client/          # 实际项目目录
│   ├── src/            # 源代码
│   │   ├── main.ts     # 应用入口
│   │   ├── app.ts      # 主应用类
│   │   ├── state_machine.ts  # 状态机
│   │   ├── recorder.ts       # 录音模块
│   │   ├── websocket_client.ts # WebSocket 客户端
│   │   ├── tts_player.ts     # TTS 播放器
│   │   ├── asr_subtitle.ts   # ASR 字幕
│   │   ├── audio_mixer.ts    # 音频混控器
│   │   ├── types.ts          # 类型定义
│   │   └── ui/               # UI 渲染器
│   ├── tests/          # 测试文件
│   │   ├── stage2.1/  # 阶段 2.1 测试
│   │   ├── stage2.1.3/ # Utterance Group 测试
│   │   ├── stage3.2/  # 功能选择测试
│   │   ├── session_mode/ # 会话模式测试
│   │   └── room_mode/  # 会议室模式测试
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── vitest.config.ts
└── docs/               # 文档
```

## 快速开始

### 安装依赖

```bash
cd webapp/web-client
npm install
```

### 开发模式

```bash
npm run dev
```

服务将在 `http://localhost:9001` 启动。

### 运行测试

```bash
npm test              # 运行所有测试
npm run test:watch    # 监听模式
npm run test:coverage # 生成覆盖率报告
```

### 构建生产版本

```bash
npm run build
```

构建输出在 `dist/` 目录。

## 主要功能

- ✅ 半双工模式（输入模式和输出模式自动切换）
- ✅ Send 按钮主导节奏
- ✅ 静音自动结束（1000ms 阈值 + 250ms 尾部缓冲）
- ✅ 播放期间完全关麦，避免回声问题
- ✅ ASR 实时字幕
- ✅ Utterance Group 上下文拼接
- ✅ 会话模式（持续输入+输出）
- ✅ 会议室模式（WebRTC 原声传递）

## 测试

测试文件位于 `webapp/web-client/tests/` 目录，包括：

- **阶段 2.1**: 状态机和 ASR 字幕测试
- **阶段 2.1.3**: Utterance Group 测试
- **阶段 3.2**: 功能选择测试
- **会话模式**: 会话生命周期测试
- **会议室模式**: 房间加入和原声传递测试

运行 `npm test` 执行所有测试。详细文档请参考 `webapp/web-client/docs/README.md`。
