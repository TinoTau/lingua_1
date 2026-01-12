# iOS 客户端调试与监控系统设计（实时带宽 / 延迟 / 状态）

版本：v1.0

本文件描述在 iOS 客户端中构建调试与监控体系的设计，包括：  
- 实时带宽监控（上行/下行）  
- 延迟监控（RTT）  
- WebSocket 状态监控  
- 调试面板 Debug Overlay  
- 本地日志系统  

---

# 1. 设计目标

- 开发阶段可观察系统状态  
- 用户遇到问题时能快速甄别原因（网络问题 / 设备问题 / 服务器问题）  
- 支持导出日志给开发团队排查  

---

# 2. 带宽监控（上行/下行速率）

在 RealtimeClient 中记录每秒收发的数据量：

```swift
struct NetworkStats {
    var uploadBytesPerSec: Int = 0
    var downloadBytesPerSec: Int = 0
}
```

统计方式：

```
sendAudioChunk → 累加 upload
receiveLoop    → 累加 download

计时器每秒刷新 → 展示到 UI
```

展示示例：

```
↑ 24 KB/s     ↓ 32 KB/s
```

---

# 3. 延迟监控（端到端 RTT）

发送：audio_chunk 中附带 timestamp_ms  
接收：translation_result 中由服务器原样返回 timestamp  

RTT 计算：

```
RTT = now() - timestamp_ms
```

UI 实时显示：

```
延迟: 162 ms
```

---

# 4. WebSocket 状态监控

RealtimeClient 暴露状态：

```swift
enum WSState {
    case disconnected
    case connecting
    case connected
    case reconnecting
    case error(String)
}
```

UI 显示：

```
WS: connected (ping 35ms)
```

或：

```
WS: reconnecting…
```

---

# 5. DebugOverlay（调试面板）

设计为一个悬浮层，可通过三指双击或摇一摇打开：

内容包括：

```
WSState: connected
Upload: 20 KB/s
Download: 15 KB/s
RTT: 140 ms
Active Session: sess-123
Sequence: 421
Last Error: none
```

UI 结构：

```
+-----------------------------+
|   DEBUG PANEL               |
| --------------------------- |
| WS: connected               |
| Upload: 20KB/s              |
| Download: 15KB/s            |
| RTT: 140 ms                 |
| Active session: sess-123    |
| Last error: none            |
+-----------------------------+
```

---

# 6. 日志系统

## 6.1 本地日志文件
写入 App Documents/logs/xxx.log

格式：

```
[TIME] [WS] connected
[TIME] [SEND] audio_chunk seq=120 size=4000
[TIME] [RECV] translation_result seq=120
[TIME] [ERR] ping timeout
```

## 6.2 导出日志
用户可在设置页点击：

```
导出调试文件
```

并通过 iOS 分享面板发送给开发人员。

---

# 7. 性能监控

## 7.1 CPU / 内存
使用 Swift 的 `os_signpost` 记录音频线程开销。

## 7.2 Audio Engine 状态
周期性检查：

- 是否发生 audio interruption  
- 是否有 lost frame  

---

# 8. 调试系统实施步骤

1. 在 RealtimeClient 中加入统计字段  
2. 在 WebSocket 的 send/receive 中累加字节数  
3. 添加 RTTSampler 模块  
4. 创建 DebugOverlay  
5. 在 Settings 或手势中加入触发入口  
6. 添加本地日志系统  

---

# 9. 验收标准

- 开发者可在 App 内随时查看带宽、延迟、连接状态  
- 弱网情况下能观察 RTT 和 WS 状态变化  
- 日志文件可导出  
- 不影响生产环境性能  

