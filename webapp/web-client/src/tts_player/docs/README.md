# TTS 播放器模块文档

流式 TTS 播放、缓冲管理、解码与内存控制。对应目录 `src/tts_player.ts` 与 `src/tts_player/`。

## 模块与职责

| 文件 | 职责 |
|------|------|
| `tts_player.ts` | 对外 API：添加音频块、开始/暂停/恢复播放、倍速、回调；内部依赖 MemoryManager、解码与 AudioContext |
| `memory_manager.ts` | 最大缓冲时长、内存压力检测（Performance API + 缓冲时长占比）、压力回调、页面隐藏时清理策略 |
| `decode_chunk.ts` | base64 TTS 解码（PCM16/Opus → Float32Array），供 addAudioChunk 使用 |

## 播放流程

- **添加音频**：`addAudioChunk(base64, format, utteranceIndex)` → 解码为 Float32Array → 按 utteranceIndex 插入有序缓冲列表；若超过最大缓冲时长会修剪最旧块。
- **开始播放**：`startPlayback()` 在用户手势下确保 AudioContext 已创建并 resume，按顺序播放缓冲中的块，播放到每个块时触发 `playbackIndexChangeCallback(utteranceIndex)`。
- **暂停/恢复**：`pausePlayback()` / `resumePlayback()` 控制当前 AudioBufferSourceNode。
- **倍速**：`playbackRates` 循环切换，作用于 AudioBufferSourceNode.playbackRate。

## 缓冲与格式

- **结构**：`AudioBufferWithIndex { audio: Float32Array; utteranceIndex: number }`，按 utteranceIndex 排序。
- **格式**：支持 `pcm16` 与 `opus`，由 `decodeBase64TtsChunk` 与 `audio_codec` 的 decoder 完成解码。
- **最大缓冲**：`getMaxBufferDuration()` 当前为 25 秒；超限时移除最旧块（或按策略修剪）。

## 内存管理

- **MemoryManager**：每 2 秒检查一次；结合 Performance API（若存在）的堆使用率与缓冲时长占最大时长的比例，得到 normal / warning / critical。
- **压力回调**：App 层注册 `setMemoryPressureCallback`，用于 UI 闪烁、自动播放等。
- **页面隐藏**：`visibilitychange` 时可选清理或停止监控，恢复可见时重新 `startMemoryMonitoring`。
- **用户手势**：AudioContext 需在用户操作下创建/恢复；`prepareAudioContext()` 在 startSession 时调用，确保首次播放前已 resume。

## 与 App 的联动

- **播放开始/结束**：`playbackStartedCallback`、`playbackFinishedCallback` 用于状态机与录音恢复等。
- **播放索引**：`playbackIndexChangeCallback(utteranceIndex)` 用于翻译文本按句同步显示。
- **内存压力**：通过 `setMemoryPressureCallback` 上报，App 在 critical 时可自动 startTtsPlayback 或提示用户。
