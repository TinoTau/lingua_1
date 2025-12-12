# Lingua Web 客户端

Web 端实时语音翻译客户端，基于 v3 统一设计方案实现。

## 功能特性

- ✅ **半双工模式**：输入模式和输出模式自动切换
- ✅ **Send 按钮**：用户主动结束本轮输入
- ✅ **静音自动结束**：固定参数（1000ms + 250ms 尾部缓冲）
- ✅ **播放期间关麦**：彻底关闭浏览器麦克风
- ✅ **ASR 字幕**：实时显示识别内容（需要后端支持 partial 结果）
- ⏸️ **Utterance Group**：上下文拼接（需要后端支持）

## 项目结构

```
web-client/
├── src/
│   ├── types.ts              # 类型定义
│   ├── state_machine.ts      # 状态机模块
│   ├── recorder.ts           # 录音模块（录音 + 静音检测）
│   ├── websocket_client.ts   # WebSocket 客户端
│   ├── tts_player.ts         # TTS 播放模块
│   ├── asr_subtitle.ts       # ASR 字幕模块
│   └── main.ts               # 主应用入口
├── index.html                # HTML 入口
├── package.json              # 项目配置
├── tsconfig.json             # TypeScript 配置
└── vite.config.ts            # Vite 配置
```

## 安装和运行

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 预览构建结果
npm run preview
```

## 使用说明

1. **连接服务器**：点击"连接服务器"按钮，选择源语言和目标语言
2. **开始录音**：点击"开始录音"按钮，开始说话
3. **结束本轮**：点击"结束本轮 (Send)"按钮，或等待静音自动结束
4. **查看结果**：等待翻译结果和 TTS 播放

## 状态机

系统有四个状态：

- `INPUT_READY`：准备就绪，可以开始录音
- `INPUT_RECORDING`：正在录音，ASR 字幕实时显示
- `WAITING_RESULT`：等待翻译结果
- `PLAYING_TTS`：播放 TTS 音频

## 配置

默认配置在 `src/types.ts` 中：

```typescript
{
  silenceTimeoutMs: 1000,    // 静音超时（ms）
  tailBufferMs: 250,         // 尾部缓冲（ms）
  groupTimeoutSec: 30,       // Group 超时（秒）
  schedulerUrl: 'ws://localhost:8080/ws/session'
}
```

## 待实现功能

- ⏸️ **ASR Partial 结果**：需要后端支持流式 ASR partial 结果推送
- ⏸️ **Utterance Group**：需要后端支持 Group 管理和上下文拼接

## 相关文档

- [Web 端实时语音翻译统一设计方案 v3](../docs/webClient/Web_端实时语音翻译_统一设计方案_v3.md)
- [可行性评估](../docs/WEB_CLIENT_V3_FEASIBILITY_ASSESSMENT.md)

