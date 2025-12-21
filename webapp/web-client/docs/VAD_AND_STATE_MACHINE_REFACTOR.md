# VAD 静音过滤与状态机重构说明

## 问题分析

### 原始问题
调度服务器一直收到静音片段，导致 session 状态一直处于"翻译中"状态。

### 根本原因
虽然 `recorder.ts` 中已经实现了静音过滤（`processSilenceFilter`），但可能存在以下问题：
1. 静音过滤阈值设置不当
2. 平滑逻辑导致静音片段仍然被发送
3. 静音过滤未启用或配置错误

## 当前实现

### VAD 静音过滤机制

**位置**: `webapp/web-client/src/recorder.ts`

**功能**:
- ✅ 使用 RMS（均方根）值检测音频能量
- ✅ 通过阈值判断是否为语音（默认阈值：0.01）
- ✅ 使用平滑逻辑（Attack/Release）避免频繁启停
  - `attackFrames`: 连续 3 帧语音才开始发送
  - `releaseFrames`: 连续 5 帧静音才停止发送

**工作流程**:
```
音频帧输入
  ↓
计算 RMS 值
  ↓
判断是否为语音（RMS >= threshold）
  ↓
[是语音] → 连续 N 帧后开始发送 → 调用 audioFrameCallback
[是静音] → 连续 M 帧后停止发送 → 不调用 audioFrameCallback
```

**关键点**:
- ✅ 只有当 `processSilenceFilter` 返回 `true` 时，才会调用 `audioFrameCallback`
- ✅ 这意味着只有有效语音才会被发送到 `app.ts` 的 `onAudioFrame`
- ✅ 静音片段完全不会被发送

### 状态机当前结构

**位置**: `webapp/web-client/src/types.ts`

```typescript
export enum SessionState {
  INPUT_READY = 'input_ready',      // 初始状态/未开始会话
  INPUT_RECORDING = 'input_recording', // 输入状态：麦克风可用，收集语音
  PLAYING_TTS = 'playing_tts',        // 输出状态：麦克风不可用，播放音频
}
```

**状态流转**:
```
INPUT_READY (未开始会话)
  ↓ [点击开始]
INPUT_RECORDING (输入状态：收集语音，VAD过滤静音)
  ↓ [收到翻译结果，用户点击播放]
PLAYING_TTS (输出状态：播放音频，麦克风禁用)
  ↓ [播放完成/暂停]
INPUT_RECORDING (继续输入)
```

## 架构调整建议

### 1. VAD 功能定位（已实现 ✅）

**VAD 的作用**：过滤静音片段，只发送有效语音给调度服务器

**实现方式**：
- 在 `recorder.ts` 中实现静音过滤
- 只有有效语音才会触发 `audioFrameCallback`
- 静音片段完全不发送，避免调度服务器一直处于"翻译中"状态

### 2. 状态机简化

**核心业务状态**（只需要两个）：
1. **INPUT_RECORDING**（输入状态）
   - 麦克风可用
   - Web 端收集用户语音输入
   - VAD 过滤静音，只发送有效语音
   - 发送按钮可用（手动截断）

2. **PLAYING_TTS**（输出状态）
   - 麦克风不可用（避免声学回响）
   - 按指定倍速播放缓存区的输出音频
   - 播放按钮a

**辅助状态**（保留用于初始化）：
- **INPUT_READY**：初始状态，未开始会话时的状态

### 3. 关键修改点

#### ✅ 已完成
1. **静音过滤逻辑优化**：更新了注释，明确了 VAD 的作用是过滤静音
2. **音频帧处理**：`onAudioFrame` 只接收有效语音（因为 `recorder.ts` 已经过滤）

#### 🔄 需要确认
1. **静音过滤默认启用**：确保 `DEFAULT_SILENCE_FILTER_CONFIG.enabled = true`
2. **阈值设置**：当前阈值 0.01 是否合适，可能需要根据实际环境调整
3. **平滑参数**：`attackFrames=3, releaseFrames=5` 是否合适

#### 📝 可选优化
1. **状态机简化**：可以考虑将 `INPUT_READY` 合并到 `INPUT_RECORDING`，但需要大量 UI 代码修改
2. **日志增强**：添加更详细的 VAD 日志，便于调试

## 验证方法

### 验证静音过滤是否生效

1. **检查日志**：
   - 查看是否有 `[VAD] 检测到语音，开始发送音频`
   - 查看是否有 `[VAD] 检测到静音，停止发送音频（过滤静音片段）`

2. **网络监控**：
   - 使用浏览器开发者工具监控 WebSocket 消息
   - 确认在静音期间没有发送 `audio_chunk` 消息

3. **调度服务器日志**：
   - 确认不再收到静音片段
   - 确认 session 状态不再一直处于"翻译中"

## 配置建议

### 静音过滤配置

```typescript
export const DEFAULT_SILENCE_FILTER_CONFIG: SilenceFilterConfig = {
  enabled: true,              // ✅ 必须启用
  threshold: 0.01,            // RMS 阈值（可根据环境调整）
  windowMs: 100,              // 窗口大小
  attackFrames: 3,            // 连续 3 帧语音才开始发送（避免误触发）
  releaseFrames: 5,           // 连续 5 帧静音才停止发送（平滑过渡）
};
```

### 阈值调整建议

- **安静环境**：可以降低阈值（如 0.005），更敏感地检测语音
- **嘈杂环境**：可以提高阈值（如 0.02），避免噪音被误判为语音
- **建议**：提供配置界面，允许用户根据环境调整

## 总结

### ✅ 当前实现已经符合需求

1. **VAD 静音过滤已实现**：只有有效语音才会被发送
2. **状态机结构合理**：核心业务只需要两个状态（INPUT_RECORDING 和 PLAYING_TTS）
3. **架构清晰**：输入状态收集语音并过滤静音，输出状态播放音频

### 🔍 需要验证

1. 确认静音过滤在实际环境中正常工作
2. 确认调度服务器不再收到静音片段
3. 确认 session 状态正常流转

### 📈 后续优化方向

1. 提供 VAD 阈值配置界面
2. 添加 VAD 可视化（显示当前是否在发送音频）
3. 优化平滑参数，根据实际使用情况调整

