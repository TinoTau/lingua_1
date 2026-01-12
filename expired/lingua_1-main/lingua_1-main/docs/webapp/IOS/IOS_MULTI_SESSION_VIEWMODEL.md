# SessionViewModel（多会话版）完整代码草稿

此文档提供可直接使用的 Swift 代码框架，用于支持多会话系统。

---

# 1. 单会话 ViewModel

```swift
final class SessionViewModel: ObservableObject {
    @Published var status: SessionStatus = .idle
    @Published var segments: [TranslationSegment] = []
    @Published var isRecording: Bool = false

    let sessionId: UUID

    private let audioCapture: AudioCaptureServiceProtocol
    private let chunker: AudioChunkerProtocol
    private let player: AudioPlayerServiceProtocol
    private let realtimeClient: RealtimeClient

    init(sessionId: UUID,
         audioCapture: AudioCaptureServiceProtocol,
         chunker: AudioChunkerProtocol,
         player: AudioPlayerServiceProtocol,
         realtimeClient: RealtimeClient) {
        self.sessionId = sessionId
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
            guard let self = self else { return }
            Task {
                await self.realtimeClient.sendAudioChunk(chunk,
                                                         sessionUUID: self.sessionId)
            }
        }

        realtimeClient.delegate = self
    }

    func startSession(config: SessionConfig) {
        Task {
            do {
                try audioCapture.start()
                isRecording = true
                status = .active(sessionId: sessionId.uuidString)
            } catch {
                status = .error(error.localizedDescription)
            }
        }
    }

    func stopSession() {
        audioCapture.stop()
        isRecording = false
        status = .ended
    }
}

extension SessionViewModel: RealtimeClientDelegate {
    func realtimeClientDidConnect(_ client: RealtimeClient) {}

    func realtimeClient(_ client: RealtimeClient,
                        didReceiveSegment segment: TranslationSegment,
                        inSession sessionId: String) {
        DispatchQueue.main.async {
            self.segments.append(segment)
        }
    }

    func realtimeClient(_ client: RealtimeClient,
                        didReceiveTtsPcm data: Data,
                        inSession sessionId: String) {
        player.play(pcmData: data)
    }

    func realtimeClient(_ client: RealtimeClient,
                        didChangeStatus status: SessionStatus) {
        DispatchQueue.main.async {
            self.status = status
        }
    }

    func realtimeClient(_ client: RealtimeClient,
                        didEncounterError error: Error) {
        DispatchQueue.main.async {
            self.status = .error(error.localizedDescription)
        }
    }
}
```

---

# 2. 多会话 SessionsViewModel

```swift
final class SessionsViewModel: ObservableObject {
    @Published var sessions: [ChatSession] = []
    @Published var activeSession: SessionViewModel?

    func createSession(src: String, tgt: String) {
        let id = UUID()
        let session = ChatSession(id: id,
                                  title: "会话 \(sessions.count + 1)",
                                  createdAt: Date(),
                                  srcLang: src,
                                  tgtLang: tgt)
        sessions.append(session)
    }

    func openSession(id: UUID) {
        guard let session = sessions.first(where: { $0.id == id }) else { return }

        activeSession = SessionViewModel(
            sessionId: id,
            audioCapture: AudioCaptureService(),
            chunker: AudioChunker(),
            player: AudioPlayerService(),
            realtimeClient: RealtimeClient()
        )
    }

    func deleteSession(id: UUID) {
        sessions.removeAll { $0.id == id }
        if activeSession?.sessionId == id {
            activeSession = nil
        }
    }
}
```

---

# 3. 多会话录音冲突处理

```swift
func startSessionSafely(_ vm: SessionViewModel) {
    if let active = activeSession, active.isRecording {
        active.stopSession()
    }
    activeSession = vm
    vm.startSession(config: ...)
}
```

---

# 4. 使用建议

- 单会话 ViewModel 独立完整，不共享状态  
- SessionsViewModel 只是管理容器，不承担翻译逻辑  
- 每个会话可使用独立 WebSocket（推荐）  

