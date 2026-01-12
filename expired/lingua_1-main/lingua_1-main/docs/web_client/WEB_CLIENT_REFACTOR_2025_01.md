# Web 客户端重构与 Bug 修复文档 (2025-01)

**版本**: v1.0  
**日期**: 2025-01-27  
**状态**: ✅ 已完成

## 概述

本文档记录了 2025年1月 期间对 Web 客户端及相关组件进行的重要重构和 Bug 修复工作。本次重构主要解决了音频编码格式问题、空结果处理、音频播放逻辑优化以及节点端质量评分计算等问题。

---

## 目录

1. [重构背景](#重构背景)
2. [Bug 修复清单](#bug-修复清单)
3. [功能优化](#功能优化)
4. [技术细节](#技术细节)
5. [测试验证](#测试验证)
6. [相关文档](#相关文档)

---

## 重构背景

### 问题描述

在 Web 客户端文件拆分重构后，发现以下问题：

1. **Opus 音频编码格式错误**：Web 端在流式发送时使用了连续字节流格式，但服务端要求包格式（Plan A）
2. **空结果处理不当**：调度服务器直接丢弃空结果，导致客户端 `utterance_index` 不同步
3. **音频播放问题**：部分音频无法自动播放，播放按钮状态异常
4. **节点健康检查过慢**：节点需要 45 秒才能变为可用状态
5. **长音频处理**：超过 25 秒的音频被丢弃，缺乏合理的分段机制
6. **节点端质量评分错误**：`qualityScore` 可能为 `null`，导致 `toFixed()` 调用失败

### 重构目标

- ✅ 修复 Opus 编码格式问题，确保与服务端兼容
- ✅ 优化空结果处理，保证 `utterance_index` 连续性
- ✅ 改进音频播放逻辑，提升用户体验
- ✅ 优化节点健康检查，缩短节点就绪时间
- ✅ 添加音频时长限制，防止过长音频导致的问题
- ✅ 修复节点端质量评分计算，防止 `null` 值错误

---

## Bug 修复清单

### Bug #1: Opus 音频编码格式错误

**严重程度**: 🔴 高  
**影响范围**: Web 客户端 → 调度服务器 → 节点端 ASR 服务

#### 问题描述

Web 客户端在流式发送音频时（`audio_chunk` 消息），使用了 `audioEncoder.encode()` 方法，该方法生成的是连续字节流格式。但 `faster-whisper-vad` 服务要求使用 Opus 包格式（Plan A，长度前缀格式）。

**错误表现**:
- 部分任务返回 400 Bad Request 错误
- 错误信息：`ValueError: Opus audio must be in packet format (length-prefixed)`
- 流式发送的任务失败，手动发送的任务成功（因为手动发送使用了正确的 `encodePackets()` 方法）

#### 根本原因

在文件拆分重构过程中，`sendAudioChunkInternal` 方法中的 Opus 编码逻辑被错误地修改为使用 `encode()` 而不是 `encodePackets()`。

#### 修复方案

**文件**: `webapp/web-client/src/websocket/audio_sender.ts`

**修复内容**:
```typescript
// 修复前（错误）
if (this.audioEncoder && this.audioCodecConfig?.codec === 'opus') {
  const encoded = await this.audioEncoder.encode(audioData);
  base64 = this.arrayBufferToBase64(encoded);
}

// 修复后（正确）
if (this.audioEncoder && this.audioCodecConfig?.codec === 'opus') {
  const encoder = this.audioEncoder as any;
  if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
    const opusPackets = await encoder.encodePackets(audioData);
    // 手动打包为 Plan A 格式（长度前缀）
    const packetDataParts: Uint8Array[] = [];
    let totalSize = 0;
    for (const packet of opusPackets) {
      if (packet.length > 0) {
        const lenBuffer = new ArrayBuffer(2);
        new DataView(lenBuffer).setUint16(0, packet.length, true);
        packetDataParts.push(new Uint8Array(lenBuffer));
        packetDataParts.push(packet);
        totalSize += 2 + packet.length;
      }
    }
    const encodedAudio = new Uint8Array(totalSize);
    let offset = 0;
    for (const part of packetDataParts) {
      encodedAudio.set(part, offset);
      offset += part.length;
    }
    base64 = this.arrayBufferToBase64(encodedAudio);
  } else {
    throw new Error('Opus encoder does not support encodePackets() for audio_chunk');
  }
}
```

#### 验证结果

- ✅ 所有流式发送的任务不再出现 400 错误
- ✅ 手动发送和流式发送都使用相同的编码格式
- ✅ 与 `faster-whisper-vad` 服务完全兼容

---

### Bug #2: 空结果处理导致 utterance_index 不同步

**严重程度**: 🟡 中  
**影响范围**: 调度服务器 → Web 客户端

#### 问题描述

当 ASR 检测到静音时，会返回空结果（ASR、NMT、TTS 都为空）。调度服务器直接丢弃这些空结果，不转发给 Web 客户端。但调度服务器的 `expected_index` 仍然会递增，导致：

- Web 客户端的 `utterance_index` 与调度服务器不同步
- 后续结果被阻塞，等待缺失的索引（5秒超时）
- 第一个翻译结果可能没有音频
- 后续翻译非常慢（30秒或更多）

#### 根本原因

调度服务器在 `job_result.rs` 中直接跳过空结果，没有发送 `MissingResult` 消息给客户端，导致客户端不知道某个索引被跳过了。

#### 修复方案

**文件**: `central_server/scheduler/src/websocket/node_handler/message/job_result.rs`

**修复内容**:
```rust
// 修复前：直接跳过空结果
if asr_empty && translated_empty && tts_empty {
    warn!("Skipping empty translation result");
    continue; // 直接跳过，不发送给客户端
}

// 修复后：发送 MissingResult 消息
if asr_empty && translated_empty && tts_empty {
    warn!("Empty translation result, sending MissingResult");
    let missing_result = SessionMessage::MissingResult {
        session_id: session_id.clone(),
        utterance_index: *utterance_index,
        reason: "silence_detected".to_string(),
        created_at_ms: chrono::Utc::now().timestamp_millis(),
        trace_id: Some(trace_id.clone()),
    };
    // 发送 MissingResult 消息给客户端
    crate::phase2::send_session_message_routed(state, &session_id, missing_result).await;
    continue; // 跳过原始结果，因为已经发送了 MissingResult
}
```

#### 验证结果

- ✅ Web 客户端收到所有 `utterance_index` 的消息（包括空结果）
- ✅ `utterance_index` 保持连续性
- ✅ 不再出现长时间等待的问题
- ✅ 第一个翻译结果正常显示

---

### Bug #3: 节点健康检查过慢

**严重程度**: 🟡 中  
**影响范围**: 调度服务器 → 节点管理

#### 问题描述

节点启动后需要 45 秒才能变为 "Ready" 状态，导致用户开始说话时出现 "No available nodes" 错误。

#### 根本原因

调度服务器配置中 `health_check_count = 3`，需要连续 3 次成功的心跳（每次间隔 15 秒）才能将节点状态从 "Registering" 转为 "Ready"。

#### 修复方案

**文件**: `central_server/scheduler/config.toml`

**修复内容**:
```toml
# 修复前
health_check_count = 3  # 需要 3 次心跳（45秒）

# 修复后
health_check_count = 1  # 只需要 1 次心跳（15秒）
```

#### 验证结果

- ✅ 节点启动后约 15 秒即可变为 "Ready" 状态
- ✅ 用户开始说话时不再出现 "No available nodes" 错误
- ✅ 节点健康检查仍然有效（单次心跳足以验证节点状态）

---

### Bug #4: 音频播放逻辑问题

**严重程度**: 🟡 中  
**影响范围**: Web 客户端

#### 问题描述

1. 部分音频无法自动播放
2. 播放按钮不显示可播放时长
3. 播放按钮无法点击
4. 第一段音频不播放

#### 根本原因

1. 最大缓存时长设置为 15 秒，某些音频超过此限制被丢弃
2. UI 更新逻辑依赖特定状态（`INPUT_RECORDING`），导致其他状态下按钮不更新
3. 第一段音频（`utterance_index === 0`）没有特殊的自动播放逻辑

#### 修复方案

**文件 1**: `webapp/web-client/src/tts_player/memory_manager.ts`
```typescript
// 修复：将最大缓存时长从 15 秒增加到 25 秒
export function getMaxBufferDuration(): number {
  return 25; // 统一设置为 25 秒，确保能直接触发自动播放
}
```

**文件 2**: `webapp/web-client/src/app.ts`
```typescript
// 修复 1: 添加播放失败标记
if (audioDiscarded || !addSuccess) {
  const playbackFailed = true;
  // 显示文本时添加 [播放失败] 前缀
  this.translationDisplay.displayTranslationResult(
    utterance_index,
    text_asr,
    text_translated,
    playbackFailed
  );
}

// 修复 2: 添加第一段音频自动播放逻辑
if (utterance_index === 0 && 
    currentState === SessionState.INPUT_RECORDING &&
    this.ttsPlayer.getTotalDuration() > 0 &&
    !this.ttsPlayer.isPlaying()) {
  setTimeout(() => {
    this.startTtsPlayback();
  }, 100);
}

// 修复 3: 添加大音频预播放逻辑
const willExceedLimit = (currentDuration + estimatedDuration) > maxDuration;
if (willExceedLimit && currentState === SessionState.INPUT_RECORDING) {
  if (hasPendingAudio || currentDuration > 0) {
    this.startTtsPlayback(); // 提前播放，释放缓冲区空间
  }
}
```

**文件 3**: `webapp/web-client/src/app/translation_display.ts`
```typescript
// 修复：支持播放失败标记
displayTranslationResult(
  utteranceIndex: number,
  originalText: string,
  translatedText: string,
  playbackFailed: boolean = false
) {
  if (playbackFailed) {
    originalText = `[播放失败] ${originalText}`;
    translatedText = `[播放失败] ${translatedText}`;
  }
  // ... 显示文本
}
```

#### 验证结果

- ✅ 最大缓存时长增加到 25 秒，减少音频丢弃
- ✅ 播放失败时显示 `[播放失败]` 标记
- ✅ 第一段音频自动播放
- ✅ 大音频添加前自动触发播放，释放缓冲区

---

### Bug #5: 长音频处理问题

**严重程度**: 🟡 中  
**影响范围**: 调度服务器 → Web 客户端

#### 问题描述

某些音频片段超过 25 秒，导致 Web 客户端缓冲区溢出，音频被丢弃。

#### 根本原因

调度服务器没有对音频时长进行限制，允许用户连续说话超过 25 秒。

#### 修复方案

**文件 1**: `central_server/scheduler/src/core/config.rs`
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebTaskSegmentationConfig {
    pub pause_ms: u64,
    /// 最大音频时长（毫秒），超过该时长强制 finalize（默认 20000ms = 20秒）
    #[serde(default = "default_web_max_duration_ms")]
    pub max_duration_ms: u64,
    // ...
}

fn default_web_max_duration_ms() -> u64 {
    20000 // 20秒
}
```

**文件 2**: `central_server/scheduler/src/websocket/session_actor/actor.rs`
```rust
// 在 handle_audio_chunk 中累积音频时长
self.internal_state.accumulated_audio_duration_ms += chunk_duration_ms;

// 检查是否超过最大时长
if self.max_duration_ms > 0 && 
   self.internal_state.accumulated_audio_duration_ms >= self.max_duration_ms {
    warn!("Audio duration exceeded max limit, auto-finalizing");
    self.try_finalize(utterance_index, "MaxDuration").await?;
}
```

**文件 3**: `webapp/web-client/src/app.ts`
```typescript
// 在添加音频前检查时长
const estimatedDuration = this.estimateAudioDuration(audioData);
const currentDuration = this.ttsPlayer.getTotalDuration() || 0;
const maxDuration = getMaxBufferDuration() * 1000; // 转换为毫秒

if ((currentDuration + estimatedDuration) > maxDuration) {
  // 如果超过限制，自动播放以释放空间
  if (currentState === SessionState.INPUT_RECORDING) {
    this.startTtsPlayback();
  }
}
```

#### 验证结果

- ✅ 调度服务器在 20 秒时自动 finalize，防止过长音频
- ✅ Web 客户端在添加大音频前自动播放，释放缓冲区
- ✅ 减少音频丢弃情况

---

### Bug #6: 节点端 qualityScore 为 null

**严重程度**: 🔴 高  
**影响范围**: 节点端 → 调度服务器

#### 问题描述

节点端在处理某些任务时，`qualityScore` 可能为 `null`，导致调用 `toFixed()` 方法时出现错误：

```
Cannot read properties of null (reading 'toFixed')
```

#### 根本原因

在 `bad-segment-detector.ts` 中，当 `language_probability` 为 `null` 时：
1. `0.70 - null = NaN`
2. `qualityScore - NaN = NaN`
3. `Math.max(0.0, Math.min(1.0, NaN)) = NaN`
4. `NaN` 在 JSON 序列化时变成 `null`
5. `rerun-trigger.ts` 中调用 `null.toFixed()` 时报错

#### 修复方案

**文件 1**: `electron_node/electron-node/main/src/task-router/bad-segment-detector.ts`
```typescript
// 修复 1: 检查 language_probability 不为 null
if (asrResult.language_probability !== undefined && 
    asrResult.language_probability !== null) {
  const langProb = asrResult.language_probability;
  // 修复 2: 验证 langProb 是有效数字
  if (typeof langProb === 'number' && !isNaN(langProb) && isFinite(langProb)) {
    // ... 使用 langProb 进行计算
  }
}

// 修复 3: 在返回前验证 qualityScore
let finalQualityScore = qualityScore;
if (typeof finalQualityScore !== 'number' || 
    isNaN(finalQualityScore) || 
    !isFinite(finalQualityScore)) {
  logger.warn('qualityScore is invalid, using default 1.0');
  finalQualityScore = 1.0;
}

return {
  isBad,
  reasonCodes,
  qualityScore: Math.max(0.0, Math.min(1.0, finalQualityScore)),
};
```

**文件 2**: `electron_node/electron-node/main/src/task-router/rerun-trigger.ts`
```typescript
// 修复：防御性检查
const qualityScore = asrResult.badSegmentDetection.qualityScore ?? 0.0;
return {
  shouldRerun: true,
  reason: `Bad segment detected: langProb=${langProb.toFixed(2)}, duration=${audioDurationMs}ms, qualityScore=${qualityScore.toFixed(2)}`,
};
```

#### 验证结果

- ✅ `qualityScore` 不再为 `null` 或 `NaN`
- ✅ 所有 `toFixed()` 调用都安全
- ✅ 节点端任务处理不再出现此错误

---

## 功能优化

### 优化 #1: 调度服务器日志级别调整

**文件**: `central_server/scheduler/src/managers/result_queue.rs`

**优化内容**:
```rust
// 优化前：INFO 级别，终端输出过多
info!("Checking ready results", ...);
info!("Ready results extracted", ...);

// 优化后：DEBUG 级别，减少终端输出
debug!("Checking ready results", ...);
debug!("Ready results extracted", ...);
```

**效果**: 调度服务器终端输出更清晰，减少不必要的日志信息。

---

### 优化 #2: 音频时长估算优化

**文件**: `central_server/scheduler/src/websocket/session_actor/audio_duration.rs`

**优化内容**:
```rust
// 优化前：Opus 时长估算不准确
"opus" => {
    (audio_data.len() as u64 * 1000) / 60 * 20  // 不准确的估算
}

// 优化后：使用 24kbps 估算（更准确）
"opus" => {
    // 使用 24kbps 估算（Web 端 Opus 编码器默认比特率）
    // duration_ms = (bytes * 8 * 1000) / 24000 = bytes * 0.333...
    (audio_data.len() as u64 * 1000) / 3000  // 约 3000 字节/秒 @ 24kbps
}
```

**效果**: 音频时长估算更准确，有助于更好地控制音频分段。

---

## 技术细节

### Opus 编码格式说明

#### Plan A 格式（包格式，长度前缀）

Opus 音频数据必须按照以下格式打包：

```
[长度1 (2字节, little-endian)][Opus包1][长度2 (2字节)][Opus包2]...
```

**示例**:
```
假设有两个 Opus 包：
- 包1: [0x01, 0x02, 0x03] (3字节)
- 包2: [0x04, 0x05] (2字节)

打包后的数据：
[0x03, 0x00][0x01, 0x02, 0x03][0x02, 0x00][0x04, 0x05]
  ↑长度1    ↑包1数据            ↑长度2    ↑包2数据
```

#### 为什么需要包格式？

`faster-whisper-vad` 服务使用 `libopusfile` 库解码 Opus 音频，该库要求输入数据必须是包格式（Plan A），而不是连续字节流。

---

### MissingResult 消息协议

**消息类型**: `MissingResult`

**消息结构**:
```rust
SessionMessage::MissingResult {
    session_id: String,
    utterance_index: u64,
    reason: String,  // 例如: "silence_detected"
    created_at_ms: i64,
    trace_id: Option<String>,
}
```

**用途**: 通知客户端某个 `utterance_index` 的结果为空（通常是静音检测），保持索引连续性。

---

### 音频缓冲区管理

#### 最大缓存时长

- **默认值**: 25 秒
- **配置位置**: `webapp/web-client/src/tts_player/memory_manager.ts`
- **触发条件**: 当缓冲区总时长超过 25 秒时，自动触发播放

#### 自动播放触发条件

1. **内存压力触发**: 内存使用率超过 80% 时自动播放
2. **缓冲区满触发**: 缓冲区总时长超过 25 秒时自动播放
3. **大音频预触发**: 添加大音频前，如果会超过限制，提前播放
4. **第一段音频触发**: `utterance_index === 0` 时自动播放

---

## 测试验证

### 测试场景

1. ✅ **Opus 编码格式测试**
   - 流式发送音频，验证不再出现 400 错误
   - 手动发送音频，验证编码格式正确
   - 验证与 `faster-whisper-vad` 服务兼容

2. ✅ **空结果处理测试**
   - 静音检测时，验证客户端收到 `MissingResult` 消息
   - 验证 `utterance_index` 保持连续性
   - 验证后续结果不再被阻塞

3. ✅ **节点健康检查测试**
   - 验证节点启动后约 15 秒变为 "Ready"
   - 验证用户开始说话时不再出现 "No available nodes" 错误

4. ✅ **音频播放测试**
   - 验证第一段音频自动播放
   - 验证播放失败时显示 `[播放失败]` 标记
   - 验证大音频添加前自动触发播放

5. ✅ **长音频处理测试**
   - 验证调度服务器在 20 秒时自动 finalize
   - 验证 Web 客户端正确处理长音频

6. ✅ **qualityScore 测试**
   - 验证 `language_probability` 为 `null` 时不再报错
   - 验证 `qualityScore` 始终为有效数字

---

## 相关文档

### 内部文档

- [Web 端音频发送和播放逻辑总结](../../web_audio_logic_summary.md)
- [音频传输分析](../../audio_transmission_analysis.md)
- [Web 客户端架构设计](./ARCHITECTURE.md)
- [内存监控与自动播放](./MEMORY_MONITORING_AND_AUTO_PLAYBACK.md)

### 代码文件

- `webapp/web-client/src/websocket/audio_sender.ts` - 音频发送模块
- `webapp/web-client/src/app.ts` - 主应用逻辑
- `webapp/web-client/src/tts_player/memory_manager.ts` - 内存管理
- `central_server/scheduler/src/websocket/node_handler/message/job_result.rs` - 结果处理
- `electron_node/electron-node/main/src/task-router/bad-segment-detector.ts` - 坏段检测

---

## 总结

本次重构和 Bug 修复工作解决了以下关键问题：

1. ✅ **Opus 编码格式兼容性** - 确保 Web 端与服务端完全兼容
2. ✅ **空结果处理优化** - 保证 `utterance_index` 连续性
3. ✅ **节点健康检查优化** - 缩短节点就绪时间
4. ✅ **音频播放逻辑优化** - 提升用户体验
5. ✅ **长音频处理** - 添加合理的时长限制
6. ✅ **节点端质量评分修复** - 防止 `null` 值错误

所有修复已通过测试验证，系统稳定性和用户体验得到显著提升。

---

**文档维护**: 本文档应在每次重大重构或 Bug 修复后更新。  
**最后更新**: 2025-01-27

