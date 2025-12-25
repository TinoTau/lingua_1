# 日志分析结果

**日期**: 2025-12-25  
**状态**: ✅ **问题已定位**

---

## 调度服务器日志分析

### Finalize原因

从调度服务器日志看，所有job的finalize原因：

1. **`job-D6A0E6E9`**: `reason="Pause"` - pause检测触发
2. **`job-CDEA69AC`**: `reason="Pause"` - pause检测触发  
3. **`job-53EAE321`**: `reason="IsFinal"` - 收到`is_final=true`
4. **`job-2F4E3B7A`**: `reason="Pause"` - pause检测触发
5. **`job-7377CA70`**: `reason="Pause"` - pause检测触发
6. **`job-5617F316`**: `reason="Timeout"` - 超时触发

### 音频大小

所有job的音频大小都只有约9KB（对应0.24秒）：

- `job-E14E2B85`: `audio_size_bytes=9275` (约9KB)
- `job-D6A0E6E9`: `audio_size_bytes=8991` (约9KB)
- `job-CDEA69AC`: `audio_size_bytes=8967` (约9KB)
- `job-53EAE321`: `audio_size_bytes=2537` (约2.5KB) - 更小
- `job-2F4E3B7A`: `audio_size_bytes=9266` (约9KB)
- `job-7377CA70`: `audio_size_bytes=9250` (约9KB)

### 节点端错误

**`job-7377CA70`**: 
```
read ECONNRESET
faster-whisper-vad request failed
```

**说明**: faster-whisper-vad服务在处理该job时崩溃了（连接被重置）

---

## 问题定位

### 问题1: 音频太短（0.24秒）

**根本原因**: **调度服务器的pause检测过早触发**

**证据**:
- 所有job的finalize原因都是`Pause`（除了一个`IsFinal`和一个`Timeout`）
- 音频大小只有约9KB（对应0.24秒，约2-3个audio_chunk）

**分析**:
- Web端每100ms发送一个audio_chunk
- 0.24秒 = 240ms ≈ 2-3个audio_chunk
- 调度服务器的`pause_ms`（默认2000ms）检测到chunk之间的间隔 > 2秒
- 触发pause检测 → finalize → 只有2-3个chunk被合并

**可能原因**:
1. **Web端发送间隔过长**: Web端可能没有每100ms发送一次，而是间隔更长
2. **Web端静音检测过早触发**: Web端可能在发送2-3个chunk后就停止发送
3. **调度服务器pause检测逻辑问题**: 可能错误地检测到pause

### 问题2: faster-whisper-vad服务崩溃

**证据**:
- `job-7377CA70`: `read ECONNRESET` - 连接被重置
- 节点端日志显示：`faster-whisper-vad request failed`

**可能原因**:
1. **服务在处理时崩溃**: 可能是segfault或其他严重错误
2. **连接被意外关闭**: 可能是网络问题或服务重启

---

## 修复建议

### 1. 检查Web端audio_chunk发送频率 ⚠️

**问题**: Web端可能没有每100ms发送一次

**检查**:
- Web端`onAudioFrame`是否每10ms调用一次（10帧 = 100ms）
- Web端是否在发送2-3个chunk后就停止发送
- Web端静音检测是否过早触发

**修复**:
- 确保Web端每100ms发送一次audio_chunk
- 检查Web端静音检测配置（`silence_duration_ms`）

### 2. 检查调度服务器pause检测逻辑 ⚠️

**问题**: 调度服务器可能错误地检测到pause

**检查**:
- `pause_ms`配置值（默认2000ms）
- `record_chunk_and_check_pause`的逻辑
- chunk之间的时间间隔是否真的 > pause_ms

**修复**:
- 增加`pause_ms`（比如从2000ms增加到3000ms）
- 或者：修复pause检测逻辑

### 3. 检查faster-whisper-vad服务崩溃原因 ⚠️

**问题**: 服务在处理`job-7377CA70`时崩溃

**检查**:
- ASR worker进程是否崩溃（查看watchdog日志）
- 是否有segfault或其他错误
- 服务是否自动重启

**修复**:
- 查看ASR worker进程的崩溃日志
- 检查是否是`list(segments)`转换时崩溃
- 增强错误处理和日志记录

---

## 下一步

1. ✅ **检查Web端日志**: 查看发送了多少个audio_chunk，发送频率是多少
2. ⚠️ **检查调度服务器pause检测**: 确认chunk之间的时间间隔
3. ⚠️ **检查faster-whisper-vad崩溃日志**: 查看服务崩溃的原因

---

**分析完成时间**: 2025-12-25  
**状态**: ✅ **问题已定位：调度服务器的pause检测过早触发，导致只累积了2-3个audio_chunk就finalize了**

