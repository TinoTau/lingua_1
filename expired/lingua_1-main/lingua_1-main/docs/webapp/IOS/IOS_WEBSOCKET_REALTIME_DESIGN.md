# iOS 客户端 WebSocket 与实时通信设计

版本：v1.0  
适用对象：iOS 客户端开发（Swift）

---

## 1. 设计目标

- 建立稳定的 WebSocket 长连接：
  - 上行：`session_init`、`audio_chunk`、控制消息
  - 下行：翻译结果、TTS 音频、错误信息
- 处理弱网环境：断线检测、自动重连、会话恢复。
- 保证发送顺序（通过 `sequence` 字段）。

---

## 2. WebSocket 客户端抽象

```swift
protocol RealtimeClientDelegate: AnyObject {
    func realtimeClientDidConnect(_ client: RealtimeClient)
    func realtimeClient(_ client: RealtimeClient, didReceiveText text: String, inSession sessionId: String)
    func realtimeClient(_ client: RealtimeClient, didReceiveTtsPcm data: Data, inSession sessionId: String)
    func realtimeClient(_ client: RealtimeClient, didEncounterError error: Error)
    func realtimeClientDidDisconnect(_ client: RealtimeClient, willReconnect: Bool)
}

final class RealtimeClient {
    weak var delegate: RealtimeClientDelegate?
    
    func connect(url: URL, authToken: String) async throws
    func disconnect()
    
    func startSession(config: SessionConfig) async throws -> String
    func sendAudioChunk(_ chunk: AudioChunk, sessionId: String) async
    func endSession(sessionId: String) async
}
```

---

## 3. URLSessionWebSocketTask 使用

```swift
import Foundation

final class WebSocketTransport {
    private var webSocketTask: URLSessionWebSocketTask?
    private let session: URLSession
    
    init() {
        self.session = URLSession(configuration: .default)
    }
    
    func connect(url: URL, authToken: String) {
        var request = URLRequest(url: url)
        request.addValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()
        
        receiveLoop()
    }
    
    func send(text: String) {
        webSocketTask?.send(.string(text)) { error in
            if let error = error {
                print("WS send error: \(error)")
            }
        }
    }
    
    func send(data: Data) {
        webSocketTask?.send(.data(data)) { error in
            if let error = error {
                print("WS send error: \(error)")
            }
        }
    }
    
    private func receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            
            switch result {
            case .failure(let error):
                print("WS receive error: \(error)")
                // TODO: 触发重连
            case .success(let message):
                switch message {
                case .string(let text):
                    print("WS text: \(text)")
                case .data(let data):
                    print("WS data size: \(data.count)")
                @unknown default:
                    break
                }
                self.receiveLoop()
            }
        }
    }
    
    func disconnect() {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
    }
}
```

---

## 4. 心跳与重连

### 4.1 心跳

```swift
func startHeartbeat() {
    Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
        self?.webSocketTask?.sendPing { error in
            if let error = error {
                print("WS ping error: \(error)")
                // 触发重连
            }
        }
    }
}
```

### 4.2 重连策略

- 检测：
  - `receive` 出错
  - ping 超时
- 步骤：
  1. 关闭旧连接
  2. 延迟一段时间（1s / 2s / 4s）
  3. 重新 `connect`
  4. 可选：发送 `session_resume`

---

## 5. 消息协议示例

### 5.1 session_init

```json
{
  "type": "session_init",
  "session_id": "",
  "src_lang": "zh",
  "tgt_lang": "en",
  "metadata": {
    "device": "iPhone"
  }
}
```

### 5.2 audio_chunk

```json
{
  "type": "audio_chunk",
  "session_id": "sess-123",
  "sequence": 42,
  "timestamp_ms": 123400,
  "audio_format": "pcm16le_16k_mono",
  "audio": "<base64-encoded>",
  "dropped_silence_ms": 200
}
```

### 5.3 translation_result

```json
{
  "type": "translation_result",
  "session_id": "sess-123",
  "sequence": 42,
  "partial": false,
  "text_src": "你好",
  "text_tgt": "Hello",
  "tts_audio": "<base64-encoded-pcm>",
  "tts_format": "pcm16le_16k_mono"
}
```

---

## 6. 与音频管线的协作

```text
[AudioCaptureService] → onPcmFrame
    ↓
[AudioChunker] → onChunkReady(chunk)
    ↓
[发送队列 / Actor]
    ↓
[RealtimeClient.sendAudioChunk]
    ↓
[WebSocketTransport.send]
```

- 发送顺序由 `sequence` 保证  
- 音频线程与 WebSocket 线程解耦

---

## 7. 错误处理与用户提示

分类处理：

- 网络错误 → 提示“网络不稳定，正在重连…”  
- 鉴权错误 → 提示“登录失效，请重新登录”  
- 协议错误 → 写日志即可，用户可提示“服务异常”  
- 服务器错误 → 显示简单字段（如 message），详细错误写日志

---

## 8. 小结

- iOS WebSocket 推荐 `URLSessionWebSocketTask`，结合心跳与重连。  
- 实时场景要特别关注顺序控制、断线检测与会话恢复。  
- 音频与网络通过队列解耦，是保证稳定性的关键。
