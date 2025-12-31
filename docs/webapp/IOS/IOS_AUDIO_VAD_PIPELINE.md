# iOS 客户端音频采集与轻量 VAD 设计

版本：v1.0  
适用对象：iOS 客户端开发（Swift）

---

## 1. 设计目标

- 在 iOS 端实现**稳定、低延迟的音频采集管线**。  
- 使用**轻量级 VAD**（只做静音过滤，不做断句），减小带宽。  
- 为上游 WebSocket 发送提供统一的 `AudioChunk` 数据结构。  
- 为下游节点端 Silero VAD + ASR 提供连续的语音流。

---

## 2. 技术栈选择

- 语言：Swift 5+  
- 音频框架：`AVAudioSession` + `AVAudioEngine`  
- 编码格式：PCM 16-bit，单声道 (mono)，16 kHz  
- AEC：依赖 iOS 系统硬件 AEC（通过 `AVAudioSessionMode.voiceChat`）  
- VAD：轻量级 RMS 能量阈值判定 + 短时静音过滤

---

## 3. 音频管线总体结构

```text
[麦克风输入]
      ↓ (AVAudioEngine input node)
  [Audio Capture Thread]
      ↓ PCM16 (frame)
  [轻量 VAD] —— 过滤掉长时间全静音
      ↓ 有效 PCM 数据
[Chunk 打包器] —— 每 200–500ms 打一个包
      ↓
[发送队列] → 交给 WebSocket 线程发送 audio_chunk
```

注意：

- **音频采集线程** 只负责：
  - 从 input node 拿 PCM 数据
  - 做极轻量 VAD + 写入环形缓冲
- **WebSocket 线程** 负责：
  - 从发送队列中取 chunk
  - JSON 序列化 / Base64
  - 通过 WebSocket 发送

禁止在音频回调中做：JSON 处理、WebSocket I/O、复杂逻辑。

---

## 4. AVAudioSession 配置（开启硬件 AEC）

```swift
import AVFoundation

func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    
    // 录音 + 播放（走通话路径，支持 AEC）
    try session.setCategory(.playAndRecord,
                            mode: .voiceChat, // 关键：使用通话模式，启用系统 AEC
                            options: [.defaultToSpeaker, .allowBluetooth])
    
    try session.setPreferredSampleRate(16_000)
    try session.setPreferredIOBufferDuration(0.02) // 20ms
    
    try session.setActive(true, options: [])
}
```

说明：

- `mode: .voiceChat` 会启用 iOS 内置的语音通话处理链路（AEC + NS + AGC）。  
- 采样率设置为 16kHz，保证与后端 ASR 一致。  
- IO buffer 建议设为 20ms，以兼顾延迟与稳定性。

---

## 5. AVAudioEngine 管线搭建

```swift
import AVFoundation

final class AudioCaptureService {
    private let engine = AVAudioEngine()
    private let bus: AVAudioNodeBus = 0
    
    // 回调：输出经过轻量 VAD 过滤后的 PCM 帧
    var onPcmFrame: (([Int16]) -> Void)?
    
    func start() throws {
        try configureAudioSession()
        
        let inputNode = engine.inputNode
        let inputFormat = inputNode.inputFormat(forBus: bus)
        
        // 重设为 16k mono
        let desiredFormat = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                          sampleRate: 16_000,
                                          channels: 1,
                                          interleaved: true)!
        
        inputNode.installTap(onBus: bus,
                             bufferSize: 320, // 320 sample @16kHz ≈ 20ms
                             format: desiredFormat) { [weak self] (buffer, time) in
            self?.handleBuffer(buffer)
        }
        
        engine.prepare()
        try engine.start()
    }
    
    func stop() {
        engine.inputNode.removeTap(onBus: bus)
        engine.stop()
    }
    
    private func handleBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.int16ChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)
        
        var samples = [Int16](repeating: 0, count: frameCount)
        for i in 0..<frameCount {
            samples[i] = channelData[i]
        }
        
        onPcmFrame?(samples)
    }
}
```

---

## 6. 轻量级 VAD 设计（只过滤静音）

```swift
struct VadConfig {
    let frameMs: Int = 20
    let silenceThresholdDb: Float = -50.0 // 非常保守，只过滤几乎为 0 的信号
    let minSilenceMsToDrop: Int = 200     // 连续静音超 200ms 才丢掉
}

final class LightweightVad {
    private let config = VadConfig()
    
    private var silenceMs: Int = 0
    
    // 输入一帧（20ms），返回是否将该帧视为“可传输”
    func shouldKeepFrame(_ frame: [Int16]) -> Bool {
        let rmsDb = rmsDb(of: frame)
        
        if rmsDb < config.silenceThresholdDb {
            silenceMs += config.frameMs
            // 如果静音累计很短，不丢，保持一些冗余
            return silenceMs < config.minSilenceMsToDrop
        } else {
            silenceMs = 0
            return true
        }
    }
    
    private func rmsDb(of frame: [Int16]) -> Float {
        if frame.isEmpty { return -100.0 }
        var sum: Float = 0
        for s in frame {
            let v = Float(s) / Float(Int16.max)
            sum += v * v
        }
        let mean = sum / Float(frame.count)
        let rms = sqrt(mean)
        return 20 * log10(max(rms, 1e-6))
    }
}
```

---

## 7. AudioChunk 打包逻辑（摘要）

```swift
struct AudioChunk {
    let sequence: Int
    let timestampMs: Int64
    let pcmData: Data
    let droppedSilenceMs: Int
}

final class AudioChunker {
    private let chunkSizeMs: Int = 250
    private let frameMs: Int = 20
    
    private var currentFrames: [[Int16]] = []
    private var sequence: Int = 0
    private var timestampMs: Int64 = 0
    private var droppedSilenceMs: Int = 0
    
    var onChunkReady: ((AudioChunk) -> Void)?
    private let vad = LightweightVad()
    
    func onPcmFrame(_ frame: [Int16]) {
        if vad.shouldKeepFrame(frame) {
            currentFrames.append(frame)
        } else {
            droppedSilenceMs += frameMs
        }
        
        timestampMs += Int64(frameMs)
        
        let accumulatedMs = currentFrames.count * frameMs
        if accumulatedMs >= chunkSizeMs {
            flushChunk()
        }
    }
    
    func flushChunk() {
        guard !currentFrames.isEmpty else { return }
        let flat = currentFrames.flatMap { $0 }
        let data = Data(bytes: flat, count: flat.count * MemoryLayout<Int16>.size)
        
        let chunk = AudioChunk(sequence: sequence,
                               timestampMs: timestampMs,
                               pcmData: data,
                               droppedSilenceMs: droppedSilenceMs)
        
        sequence += 1
        currentFrames.removeAll(keepingCapacity: true)
        droppedSilenceMs = 0
        
        onChunkReady?(chunk)
    }
}
```

---

## 8. 小结

- 使用 `AVAudioSession` + `AVAudioEngine` 构建音频采集管线，并启用系统 AEC。  
- 轻量 VAD 只做静音过滤，算法简单稳定即可，不参与断句。  
- `AudioChunker` 将连续 PCM 帧组合为固定长度的 `AudioChunk`，上游是音频采集，下游是 WebSocket 发送。  
- 音频线程只做轻量操作，避免阻塞，保证实时性与稳定性。
