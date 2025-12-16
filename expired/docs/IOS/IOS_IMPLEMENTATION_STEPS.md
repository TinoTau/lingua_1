# iOS 客户端开发步骤（完整实施指南）

版本：v1.0

本文件汇总了从零开始构建实时语音翻译 iOS 客户端所需的全部步骤，涵盖音频采集、VAD、WebSocket、TTS 播放、多会话支持、调试与监控模块。此文档可直接交给开发团队执行。

---

# 1. 阶段 0：工程初始化与基础架构

## 1.1 创建项目
- Xcode → New Project → App
- 语言：Swift  
- UI：SwiftUI  
- 最低支持 iOS：15+

## 1.2 建立目录结构

```
LinguaiOS/
  ├─ App/
  ├─ UI/
  ├─ ViewModel/
  ├─ Services/
  ├─ Models/
  └─ Utilities/
```

## 1.3 导入基础代码
从其他文档（如 IOS_CLIENT_DESIGN）中添加：
- SessionConfig / AudioChunk / TranslationSegment 等模型  
- SessionViewModel 草稿  
- SessionView（UI）骨架  

验收条件：  
App 可运行，能看到主界面按钮和空白列表。

---

# 2. 阶段 1：音频采集 + 轻量 VAD + AudioChunk 打包

## 2.1 实现 AudioCaptureService
- 使用 AVAudioEngine  
- 采样率 16kHz / 单声道 PCM16  
- AVAudioSession 设置为 `.playAndRecord + .voiceChat`（启用系统 AEC）

## 2.2 实现 LightweightVAD
- 仅过滤绝对静音  
- 不参与断句  
- 稳定性优先  

## 2.3 实现 AudioChunker
- 每帧 20ms  
- 每 200–250ms 打一个 chunk  
- 输出字段：sequence、timestampMs、pcmData、droppedSilenceMs

## 2.4 测试
- 真机运行  
- 控制台打印 chunk 信息  
- 静音减少 chunk 输出  

验收条件：  
iPhone 上可稳定输出 AudioChunk。

---

# 3. 阶段 2：WebSocket + 协议打通

## 3.1 实现 WebSocketTransport
- 使用 URLSessionWebSocketTask  
- 支持 connect / send / receiveLoop  
- 打印接收内容

## 3.2 实现 RealtimeClient
- 封装 session_init、audio_chunk 发送  
- 解析服务器回传 JSON  
- 通过 delegate 通知 ViewModel

## 3.3 后端提供测试接口
接收 audio_chunk → 回传固定 translation_result JSON

## 3.4 SessionViewModel 绑定事件
- chunker → sendAudioChunk  
- WebSocket → append UI segments  

验收条件：  
开始翻译后，能够实时显示服务器返回文本。

---

# 4. 阶段 3：TTS 播放 + AEC 协作

## 4.1 实现 AudioPlayerService
- AVAudioEngine + AVAudioPlayerNode  
- 播放 PCM16 (16kHz mono)

## 4.2 RealtimeClient 解码 TTS PCM
- Base64 → Data → delegate

## 4.3 ViewModel 调用 player.play()

## 4.4 AEC 测试
- 确保 AVAudioSession.mode = voiceChat  
- 真机测试外放是否出现循环回声  

验收条件：  
翻译语音可播放，且无明显回声。

---

# 5. 阶段 4：弱网处理 + 重连 + 心跳

## 5.1 心跳机制
- WebSocketTask.sendPing() 每 20–30 秒  

## 5.2 自动重连
- receiveLoop 出错 → 进入重连  
- 指数退避：1s → 2s → 4s  
- 重连成功后重新发 session_init 或走 session_resume

## 5.3 用户提示
- SessionStatus.reconnecting → “网络不稳定，正在重连…”

验收条件：  
在 WiFi ↔ 4G 切换、短暂断网情况下，App 不崩、可恢复。

---

# 6. 阶段 5：多会话管理功能（新增）

见 MultiSessionDesign 文档的详细逻辑，这里给出实施步骤摘要。

## 6.1 新增会话管理模型

```
struct ChatSession: Identifiable {
    let id: UUID
    let title: String
    var messages: [TranslationSegment]
    var createdAt: Date
}
```

## 6.2 会话列表界面 SessionsView
- 显示所有会话  
- 支持新建会话按钮  
- 点击进入 SessionView  

## 6.3 ViewModel 层新增 SessionsViewModel
- 管理多个 SessionViewModel  
- 若每个会话需要独立 WebSocket，则每个 session 启动独立 RealtimeClient  
- 若共用一个 WebSocket，则 session_id 由消息区分

## 6.4 持久化
- 将 ChatSession 元数据存储到本地（UserDefaults / sqlite）  
- 保留最近 n 条记录

验收条件：  
App 能像微信/Teams 一样管理多个会话互不影响。

---

# 7. 阶段 6：iOS 端调试 & 性能监控（新增）

见 IOS_DEBUG_MONITORING 文档，这里列出实现步骤。

## 7.1 实时带宽监控
在 RealtimeClient 中统计：
- 上行：发送的 AudioChunk 字节数  
- 下行：收到的 TTS / 文本字节数  
- 每秒刷新一次 UI 显示  

## 7.2 延迟监控（端到端）
- 对 audio_chunk 增加 timestamp  
- 服务器在 translation_result 中回传原 timestamp  
- RTT = now - timestamp  

## 7.3 调试面板 DebugOverlay
显示：
- WebSocket 状态  
- 最近错误  
- 当前会话序列号  
- 上行/下行速率  
- 平均延迟  

## 7.4 日志
- 写入本地文件  
- 可通过 iTunes / AirDrop 导出

验收条件：  
开发者可打开调试面板观察系统运行情况。

---

# 8. 阶段 7：最终优化与准备上线

## 8.1 添加设置页
- 源语言 / 目标语言  
- 功能开关（情绪识别、语速识别等）

## 8.2 优化 UI 动画与体验

## 8.3 真机压力测试
- 10 分钟连续翻译  
- 看内存、CPU、网络是否异常

## 8.4 准备 TestFlight 包

验收条件：  
系统稳定可用，用户体验顺畅，调试信息可控。

---

# 9. 总结

该文档提供了完整的 iOS 实现路线，从音频底层、WebSocket 通信、多会话架构、TTS 播放到监控体系。  
开发团队可严格按阶段执行，确保每个模块稳定后再进入下一阶段。

