# iOS 客户端架构与核心接口草稿

版本：v1.0  
适用对象：iOS 客户端开发（Swift + SwiftUI）

---

## 1. 模块架构

```text
UI (SwiftUI)
  └─ SessionView / SettingsView

ViewModel
  └─ SessionViewModel

Services
  ├─ AudioCaptureService (录音 + AEC)
  ├─ AudioChunker (轻量 VAD + 打包)
  ├─ AudioPlayerService (播放 TTS)
  └─ RealtimeClient (WebSocket + 协议)

Models
  ├─ SessionConfig
  ├─ AudioChunk
  └─ TranslationSegment
```

---

## 2. 核心模型

```swift
struct SessionConfig: Codable {
    let srcLang: String
    let tgtLang: String
    let dialect: String?
    let enableEmotion: Bool
    let enableVoiceStyle: Bool
    let enableSpeechRate: Bool
}

enum SessionStatus {
    case idle
    case connecting
    case active(sessionId: String)
    case reconnecting
    case ended
    case error(String)
}

struct TranslationSegment: Identifiable {
    let id = UUID()
    let sequence: Int
    let textSrc: String
    let textTgt: String
}

struct AudioChunk {
    let sequence: Int
    let timestampMs: Int64
    let pcmData: Data
    let droppedSilenceMs: Int
}
```

---

## 3. Service 接口草稿

### 3.1 AudioCaptureService

```swift
protocol AudioCaptureServiceProtocol {
    var isRunning: Bool { get }
    var onPcmFrame: (([Int16]) -> Void)? { get set }
    
    func start() throws
    func stop()
}

final class AudioCaptureService: AudioCaptureServiceProtocol {
    // 具体实现见 IOS_AUDIO_VAD_PIPELINE 文档
}
```

### 3.2 AudioChunker

```swift
protocol AudioChunkerProtocol {
    var onChunkReady: ((AudioChunk) -> Void)? { get set }
    func onPcmFrame(_ frame: [Int16])
    func flush()
}

final class AudioChunker: AudioChunkerProtocol {
    // 具体实现见 IOS_AUDIO_VAD_PIPELINE 文档
}
```

### 3.3 AudioPlayerService

```swift
protocol AudioPlayerServiceProtocol {
    func play(pcmData: Data)
    func stop()
}

final class AudioPlayerService: AudioPlayerServiceProtocol {
    // 使用 AVAudioEngine + AVAudioPlayerNode 播放 PCM16
}
```

### 3.4 RealtimeClient

```swift
protocol RealtimeClientDelegate: AnyObject {
    func realtimeClientDidConnect(_ client: RealtimeClient)
    func realtimeClient(_ client: RealtimeClient, didReceiveSegment segment: TranslationSegment, inSession sessionId: String)
    func realtimeClient(_ client: RealtimeClient, didReceiveTtsPcm data: Data, inSession sessionId: String)
    func realtimeClient(_ client: RealtimeClient, didChangeStatus status: SessionStatus)
    func realtimeClient(_ client: RealtimeClient, didEncounterError error: Error)
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

## 4. SessionViewModel 草稿

```swift
import Combine

final class SessionViewModel: ObservableObject {
    @Published var status: SessionStatus = .idle
    @Published var segments: [TranslationSegment] = []
    @Published var isRecording: Bool = false
    
    private let audioCapture: AudioCaptureServiceProtocol
    private let chunker: AudioChunkerProtocol
    private let player: AudioPlayerServiceProtocol
    private let realtimeClient: RealtimeClient
    
    private var currentSessionId: String?
    
    init(audioCapture: AudioCaptureServiceProtocol,
         chunker: AudioChunkerProtocol,
         player: AudioPlayerServiceProtocol,
         realtimeClient: RealtimeClient) {
        self.audioCapture = audioCapture
        self.chunker = chunker
        self.player = player
        self.realtimeClient = realtimeClient
        
        bind()
    }
    
    private func bind() {
        audioCapture.onPcmFrame = { [weak self] frame in
            self?.chunker.onPcmFrame(frame)
        }
        
        chunker.onChunkReady = { [weak self] chunk in
            guard let self = self,
                  let sessionId = self.currentSessionId else { return }
            Task {
                await self.realtimeClient.sendAudioChunk(chunk, sessionId: sessionId)
            }
        }
        
        realtimeClient.delegate = self
    }
    
    func start(config: SessionConfig) {
        Task {
            do {
                let sessionId = try await realtimeClient.startSession(config: config)
                self.currentSessionId = sessionId
                try audioCapture.start()
                DispatchQueue.main.async {
                    self.isRecording = true
                    self.status = .active(sessionId: sessionId)
                }
            } catch {
                DispatchQueue.main.async {
                    self.status = .error("Failed to start session: \(error)")
                }
            }
        }
    }
    
    func stop() {
        audioCapture.stop()
        isRecording = false
        if let sessionId = currentSessionId {
            Task { await realtimeClient.endSession(sessionId: sessionId) }
        }
        currentSessionId = nil
        status = .ended
    }
}

extension SessionViewModel: RealtimeClientDelegate {
    func realtimeClientDidConnect(_ client: RealtimeClient) {}
    
    func realtimeClient(_ client: RealtimeClient, didReceiveSegment segment: TranslationSegment, inSession sessionId: String) {
        DispatchQueue.main.async {
            self.segments.append(segment)
        }
    }
    
    func realtimeClient(_ client: RealtimeClient, didReceiveTtsPcm data: Data, inSession sessionId: String) {
        player.play(pcmData: data)
    }
    
    func realtimeClient(_ client: RealtimeClient, didChangeStatus status: SessionStatus) {
        DispatchQueue.main.async {
            self.status = status
        }
    }
    
    func realtimeClient(_ client: RealtimeClient, didEncounterError error: Error) {
        DispatchQueue.main.async {
            self.status = .error(error.localizedDescription)
        }
    }
}
```

---

## 5. SwiftUI 界面骨架

```swift
import SwiftUI

struct SessionView: View {
    @StateObject var viewModel: SessionViewModel
    
    @State private var config = SessionConfig(
        srcLang: "zh",
        tgtLang: "en",
        dialect: nil,
        enableEmotion: false,
        enableVoiceStyle: false,
        enableSpeechRate: false
    )
    
    var body: some View {
        VStack {
            Text("Lingua 实时翻译").font(.title)
            
            List(viewModel.segments) { seg in
                VStack(alignment: .leading, spacing: 4) {
                    Text(seg.textSrc)
                        .font(.body)
                    Text(seg.textTgt)
                        .font(.subheadline)
                        .foregroundColor(.blue)
                }
            }
            
            Spacer()
            
            Text("状态：\(statusText)")
                .font(.footnote)
                .foregroundColor(.gray)
            
            Button(action: toggleSession) {
                Text(viewModel.isRecording ? "停止翻译" : "开始翻译")
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(viewModel.isRecording ? .red : .green)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
        }
        .padding()
    }
    
    private var statusText: String {
        switch viewModel.status {
        case .idle: return "空闲"
        case .connecting: return "连接中…"
        case .active: return "翻译中"
        case .reconnecting: return "重连中…"
        case .ended: return "已结束"
        case .error(let msg): return "错误：\(msg)"
        }
    }
    
    private func toggleSession() {
        if viewModel.isRecording {
            viewModel.stop()
        } else {
            viewModel.start(config: config)
        }
    }
}
```

---

## 6. App 入口与依赖注入

```swift
@main
struct LinguaApp: App {
    var body: some Scene {
        WindowGroup {
            let capture = AudioCaptureService()
            let chunker = AudioChunker()
            let player = AudioPlayerService()
            let realtime = RealtimeClient()
            
            let vm = SessionViewModel(audioCapture: capture,
                                      chunker: chunker,
                                      player: player,
                                      realtimeClient: realtime)
            
            SessionView(viewModel: vm)
        }
    }
}
```

---

## 7. 小结

- 该设计将 iOS 客户端拆分为清晰的模块：音频、网络、播放、状态管理、UI。  
- 所有接口已经以 Swift 草稿形式给出，开发可以直接按此实现。  
- 后续可以在此基础上扩展多会话管理、设置页面、调试工具等。