# 将 last_chunk_at_ms 更新移到 RestartTimer 的风险分析

## 用户需求

用户希望：让 RestartTimer 处理所有逻辑，TTS_PLAY_ENDED 不要更新 last_chunk_at_ms。

---

## 风险分析

### 当前修复（在 TTS_PLAY_ENDED 中立即更新）

**流程**：
```
TTS_PLAY_ENDED 消息到达
  ↓
立即更新 last_chunk_at_ms（同步操作）✅
  ↓
发送 RestartTimer 事件（异步）
  ↓
Web端延迟500ms后，发送audio_chunk（异步）
  ↓
如果audio_chunk在RestartTimer之前到达
  ↓
pause检测：audio_chunk_timestamp - last_chunk_at_ms（已经更新）✅
  ↓
时间差 < 500ms（< 3秒），不触发pause finalize ✅
```

**优点**：
- ✅ 即使RestartTimer事件延迟，pause检测也能使用正确的时间戳
- ✅ 避免了pause finalize误触发

---

### 如果移到 RestartTimer（用户建议）

**流程**：
```
TTS_PLAY_ENDED 消息到达
  ↓
发送 RestartTimer 事件（异步）
  ↓
Web端延迟500ms后，发送audio_chunk（异步）
  ↓
【风险】如果audio_chunk在RestartTimer之前到达
  ↓
pause检测：audio_chunk_timestamp - last_chunk_at_ms（还是旧的时间戳）❌
  ↓
时间差 > 3秒，触发pause finalize ❌ 错误！
  ↓
然后RestartTimer事件才处理，更新last_chunk_at_ms（已经太晚了）
```

**风险**：
- ❌ 如果audio_chunk在RestartTimer事件之前到达，pause检测会使用旧的时间戳
- ❌ 导致时间差>3秒，触发pause finalize误触发
- ❌ 回到原来的时序问题

---

## 为什么会有时序问题？

### SessionActor 的事件处理是单线程的

1. **RestartTimer事件和audio_chunk事件都通过同一个channel到达SessionActor**
2. **SessionActor按顺序处理事件**
3. **如果audio_chunk在RestartTimer之前到达，pause检测会先执行**

### 关键时间线

```
时间轴：
T0: TTS_PLAY_ENDED 消息到达
T1: 发送 RestartTimer 事件（异步，进入队列）
T2: Web端延迟500ms后，发送audio_chunk（异步，进入队列）
T3: SessionActor处理audio_chunk事件（如果它在队列中排在RestartTimer之前）
    → pause检测：使用旧的last_chunk_at_ms
    → 时间差>3秒，触发pause finalize ❌
T4: SessionActor处理RestartTimer事件（太晚了）
    → 更新last_chunk_at_ms（已经太晚了）
```

---

## 结论

### 如果按照用户建议修改

**会回到原来的时序问题**：
- ❌ pause finalize误触发
- ❌ 长语音的最后一个job出问题
- ❌ Job 4→7, Job 8→11 的错误切分

### 建议

**保留当前修复**（在TTS_PLAY_ENDED中立即更新last_chunk_at_ms）：
- ✅ 这是关键修复，避免了pause finalize误触发
- ✅ 即使RestartTimer事件延迟，pause检测也能使用正确的时间戳

**但可以简化RestartTimer事件处理**：
- ✅ 移除RestartTimer事件中的重复`update_last_chunk_at_ms`调用
- ✅ 只保留`reset_timers()`调用

---

## 相关文档

- `docs/central_server/scheduler/PAUSE_FINALIZE_ROOT_CAUSE_FIX.md` - 根本原因和修复说明
- `docs/central_server/scheduler/RESTART_TIMER_IMMEDIATE_UPDATE_FIX.md` - 立即更新修复说明
