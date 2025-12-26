# Web Client Integration (Part 2/2)


### 当前流程（有问题）

```
Web端录音
  → sendAudioChunk() [连续字节流] 
  → audio_chunk消息 
  → 调度服务器audio_buffer 
  → finalize合并 
  → 创建job [连续字节流] 
  → 节点端 
  → 服务端 [检测不到packet格式] ❌
```

### 修复后流程

```
Web端录音
  → sendAudioChunk() [packet格式] 
  → audio_chunk消息 
  → 调度服务器audio_buffer 
  → finalize合并 [packet格式] 
  → 创建job [packet格式] 
  → 节点端 
  → 服务端 [检测到packet格式] ✅
```

---

## 总结

1. **Web端同时使用两种消息**：
   - `audio_chunk`：流式发送（当前使用连续字节流）
   - `utterance`：一次性发送（使用packet格式）

2. **调度服务器处理方式不同**：
   - `audio_chunk` → `audio_buffer` → finalize → job
   - `utterance` → 直接创建job

3. **问题根源**：
   - `sendAudioChunk()`没有使用Plan A格式
   - 导致`audio_chunk`消息中的数据是连续字节流

4. **解决方案**：
   - 修复`sendAudioChunk()`，使用`encodePackets()`和Plan A格式
   - 确保所有音频数据都使用packet格式



---

## WEB_CLIENT_NO_AUDIO_DIAGNOSIS.md

# Web客户端没有可播放音频的诊断

**日期**: 2025-12-25  
**状态**: 🔍 **诊断中**

---

## 问题描述

用户反馈：**调度服务器的终端上已经看到了翻译的结果，但是web端始终没有可以播放的音频**

---

## 调度服务器日志分析

### 1. 调度服务器确实发送了结果

从日志中可以看到：
```
"Successfully sent translation result to session"
```

### 2. 但是很多结果都是空的

```
"翻译结果详情 - 原文(ASR): \"\", 译文(NMT): \"\""
```

这些空结果被跳过了：
```
"Skipping empty translation result (silence detected), not forwarding to web client"
```

### 3. 有一个有效结果（utterance_index=7）

从日志中可以看到：
- ASR 文本：`"应该返回时间是有点长的因为我已经看到了服务端收到了这个预应返回但是没有问问题现在我这个"`
- 翻译文本：`"The time to return was a bit long because I've seen the server got this pre-request back but there's no problem now I'm this."`
- 调度服务器已发送：`"Successfully sent translation result to session"`

---

## 可能的原因

### 1. Web客户端没有收到消息

**检查点**：
- Web客户端的浏览器控制台是否有 `[App] 📥 收到 translation_result 消息` 日志？
- WebSocket 连接是否正常？
- 是否有网络错误？

**诊断方法**：
1. 打开浏览器开发者工具（F12）
2. 查看 Console 标签页
3. 搜索 `translation_result` 或 `收到 translation_result 消息`
4. 如果没有任何日志，说明 Web 客户端没有收到消息

---

### 2. Web客户端收到了消息但 TTS 音频为空

**检查点**：
- Web客户端的浏览器控制台是否有 `[App] ⚠️ 翻译结果中没有 TTS 音频` 警告？
- `tts_audio_length` 是否为 0？

**诊断方法**：
1. 查看浏览器控制台日志
2. 搜索 `TTS 音频` 或 `tts_audio`
3. 如果看到 `tts_audio_length: 0`，说明 TTS 音频为空

---

### 3. Web客户端收到了消息但被过滤掉了

**检查点**：
- Web客户端的浏览器控制台是否有 `[App] ⚠️ 收到空文本结果（静音检测），跳过缓存和播放` 日志？
- 会话是否已结束（`is_session_active: false`）？

**诊断方法**：
1. 查看浏览器控制台日志
2. 搜索 `空文本结果` 或 `会话已结束`
3. 如果看到这些日志，说明结果被过滤掉了

---

### 4. TTS 音频添加失败

**检查点**：
- Web客户端的浏览器控制台是否有 `[App] ❌ 添加 TTS 音频块失败` 错误？
- 是否有 JavaScript 错误？

**诊断方法**：
1. 查看浏览器控制台日志
2. 搜索 `添加 TTS 音频块失败` 或 `error`
3. 如果看到错误，检查错误详情

---

### 5. UI 更新问题

**检查点**：
- Web客户端的浏览器控制台是否有 `[App] ✅ TTS 音频块已成功添加到缓冲区` 日志？
- 播放按钮是否被禁用？

**诊断方法**：
1. 查看浏览器控制台日志
2. 搜索 `TTS 音频块已成功添加` 或 `buffer_size`
3. 如果看到 `buffer_size: '有音频'`，但播放按钮仍然被禁用，说明是 UI 更新问题

---

## 诊断步骤

### 步骤 1：检查浏览器控制台日志

1. 打开浏览器开发者工具（F12）
2. 切换到 Console 标签页
3. 搜索以下关键词：
   - `translation_result`
   - `收到 translation_result 消息`
   - `TTS 音频`
   - `添加 TTS 音频块`
   - `错误` 或 `error`

### 步骤 2：检查 WebSocket 连接

1. 切换到 Network 标签页
2. 筛选 `WS`（WebSocket）
3. 检查 WebSocket 连接状态
4. 查看是否有消息传输

### 步骤 3：检查调度服务器日志

1. 查看调度服务器日志
2. 确认是否有 `"Successfully sent translation result to session"` 日志
3. 确认 `tts_audio_len` 是否大于 0

### 步骤 4：检查节点端日志

1. 查看节点端日志
2. 确认 TTS 服务是否生成了音频
3. 确认音频是否被正确返回

---

## 常见问题

### 问题 1：Web客户端没有收到消息

**可能原因**：
- WebSocket 连接断开
- 路由问题（Phase 2 多实例）
- 消息序列化/反序列化错误

**解决方法**：
1. 检查 WebSocket 连接状态
2. 检查调度服务器的路由配置
3. 检查消息格式是否正确

---

### 问题 2：TTS 音频为空

**可能原因**：
- TTS 服务没有生成音频
- 音频格式错误
- 音频被过滤掉

**解决方法**：
1. 检查节点端 TTS 服务日志
2. 检查音频格式是否正确
3. 检查音频是否被正确编码

---

### 问题 3：结果被过滤掉

**可能原因**：
- 会话已结束
- 结果为空（ASR、NMT、TTS 都为空）

**解决方法**：
1. 确保会话处于活跃状态
2. 检查 ASR、NMT、TTS 结果是否为空

---

## 下一步

请用户提供：
1. **浏览器控制台日志**（特别是 `translation_result` 相关的日志）
2. **WebSocket 连接状态**（Network 标签页）
3. **播放按钮状态**（是否被禁用）

这样可以帮助我们进一步诊断问题。



---

## WEB_CLIENT_SILENCE_FILTER_ISSUE.md

# Web端静音过滤问题分析

**日期**: 2025-12-25  
**状态**: ✅ **问题已定位**

---

## 问题现象

**用户持续进行语音输入，但调度服务器只收到了2-3个audio_chunk（0.24秒）**

---

## 根本原因

**Web端的静音过滤机制过于敏感，导致在说话过程中过早停止发送audio_chunk**

### 静音过滤机制

**位置**: `webapp/web-client/src/recorder.ts` - `processSilenceFilter()`

**工作流程**:
```
音频帧输入（每10ms一帧）
  ↓
计算RMS值（音频能量）
  ↓
判断是否为语音（RMS >= threshold）
  ↓
[是语音] → 连续3帧语音 → 开始发送
[是静音] → 连续5帧静音 → 停止发送 ❌
```

**关键配置**:
- `threshold: 0.015` - RMS阈值（如果音频能量低于此值，认为是静音）
- `releaseFrames: 5` - 连续5帧静音就停止发送（5帧 = 50ms）
- `attackFrames: 3` - 连续3帧语音才开始发送（3帧 = 30ms）

### 问题分析

**场景**:
1. 用户开始说话 → 检测到语音 → 开始发送audio_chunk ✅
2. 用户说话过程中有短暂停顿（换气、思考等）→ 检测到静音
3. **如果停顿超过50ms（5帧）** → 静音过滤停止发送 ❌
4. 用户继续说话 → 需要重新检测到连续3帧语音（30ms）才会重新开始发送
5. **如果停顿时间较长，或者音量不够大，可能无法及时恢复发送**

**结果**:
- 调度服务器只收到了2-3个audio_chunk（0.24秒）
- 调度服务器检测到pause（chunk间隔 > 2秒）→ finalize → 只有0.24秒音频

---

## 修复建议

### 方案1: 降低静音阈值 ⚠️

**问题**: 阈值0.015可能太高，导致正常语音被误判为静音

**修复**:
```typescript
// webapp/web-client/src/types.ts
export const DEFAULT_SILENCE_FILTER_CONFIG: SilenceFilterConfig = {
  enabled: true,
  threshold: 0.01, // 从0.015降低到0.01（更宽松）
  windowMs: 100,
  attackFrames: 3,
  releaseFrames: 10, // 从5增加到10（允许更长的停顿）
};
```

**优点**: 简单，只需修改配置
**缺点**: 可能无法完全解决问题，如果用户真的停顿了

### 方案2: 增加releaseFrames ⚠️

**问题**: 5帧（50ms）太短，说话过程中的短暂停顿就会停止发送

**修复**:
```typescript
releaseFrames: 20, // 从5增加到20（200ms的停顿才停止发送）
```

**优点**: 允许更长的停顿，不会因为短暂停顿而停止发送
**缺点**: 可能会发送更多的静音片段

### 方案3: 使用更宽松的releaseThreshold ⚠️

**问题**: 进入和退出语音使用相同的阈值，可能不够灵活

**修复**:
```typescript
export const DEFAULT_SILENCE_FILTER_CONFIG: SilenceFilterConfig = {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015, // 进入语音的阈值（严格）
  releaseThreshold: 0.008, // 退出语音的阈值（宽松，避免误判）
  windowMs: 100,
  attackFrames: 3,
  releaseFrames: 15, // 增加releaseFrames
};
```

**优点**: 更灵活，进入严格，退出宽松
**缺点**: 需要调整两个阈值

### 方案4: 禁用静音过滤（临时方案）⚠️

**问题**: 如果静音过滤导致问题，可以临时禁用

**修复**:
```typescript
export const DEFAULT_SILENCE_FILTER_CONFIG: SilenceFilterConfig = {
  enabled: false, // 临时禁用静音过滤
  // ...
};
```

**优点**: 立即解决问题
**缺点**: 会发送所有音频（包括静音），增加服务器负担

---

## 推荐方案

**推荐使用方案3（更宽松的releaseThreshold）+ 增加releaseFrames**:

```typescript
export const DEFAULT_SILENCE_FILTER_CONFIG: SilenceFilterConfig = {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015, // 进入语音：严格（避免误触发）
  releaseThreshold: 0.008, // 退出语音：宽松（避免误停止）
  windowMs: 100,
  attackFrames: 3, // 连续3帧语音才开始发送
  releaseFrames: 15, // 连续15帧静音才停止发送（150ms）
};
```

**理由**:
1. **进入语音严格**：避免误触发，只有真正的语音才开始发送
2. **退出语音宽松**：避免误停止，只有真正的静音才停止发送
3. **增加releaseFrames**：允许更长的停顿（150ms），不会因为短暂停顿而停止发送

---

## 测试建议

1. **测试场景1**: 持续说话，中间有短暂停顿
   - 应该能够持续发送audio_chunk，不会因为短暂停顿而停止

2. **测试场景2**: 说话音量较小
   - 应该能够正常检测到语音，不会被误判为静音

3. **测试场景3**: 真正的静音（不说话）
   - 应该能够正确停止发送，不会一直发送静音片段

---

**分析完成时间**: 2025-12-25  
**修复时间**: 2025-12-25  
**状态**: ✅ **问题已定位并修复**

---

## 修复实施

**已修改**: `webapp/web-client/src/types.ts`

**修改内容**:
```typescript
export const DEFAULT_SILENCE_FILTER_CONFIG: SilenceFilterConfig = {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015, // 进入语音：严格（避免误触发）
  releaseThreshold: 0.008, // 退出语音：宽松（避免误停止）
  windowMs: 100,
  attackFrames: 3, // 连续3帧语音才开始发送
  releaseFrames: 15, // 连续15帧静音才停止发送（150ms，从50ms增加到150ms）
};
```

**修复效果**:
1. ✅ **进入语音严格**：避免误触发，只有真正的语音才开始发送
2. ✅ **退出语音宽松**：避免误停止，只有真正的静音才停止发送
3. ✅ **增加releaseFrames**：从5帧（50ms）增加到15帧（150ms），允许更长的停顿，不会因为短暂停顿而停止发送

**预期结果**:
- 用户持续说话时，即使有短暂停顿（< 150ms），也不会停止发送audio_chunk
- 调度服务器能够收到完整的音频数据，而不是只有0.24秒



---

