# TTS 缓冲区 UI 更新修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

用户反馈：**web端有播放按钮，但是完全没有提示能播放语音。按照设计语音播放是有一个缓冲区的**

---

## 问题分析

### 根本原因

1. **TTS 音频添加到缓冲区后，UI 没有更新**
   - `notifyTtsAudioAvailable()` 函数被调用
   - 但 UI 只在状态变化时更新
   - 添加 TTS 音频时状态没有变化（仍然是 `INPUT_RECORDING`）
   - 导致播放按钮状态和文本没有更新

2. **UI 更新机制的问题**
   - UI 通过 `stateMachine.onStateChange()` 回调更新
   - 但 `notifyTtsAudioAvailable()` 没有触发状态变化
   - 代码中有注释："实际上 UI 应该监听音频可用事件，这里先保持现状"

3. **定期更新机制的问题**
   - `startDurationUpdate()` 每 500ms 更新一次播放按钮时长
   - 但播放按钮的启用/禁用状态只在状态变化时更新
   - 如果音频在状态变化后添加，按钮可能保持禁用状态

---

## 修复方案

### 1. 添加 `notifyUIUpdate()` 方法到状态机

**文件**: `webapp/web-client/src/state_machine.ts`

**修改内容**:
```typescript
/**
 * 触发 UI 更新（不改变状态）
 * 用于在状态不变时通知 UI 更新（例如：TTS 音频缓冲区更新）
 */
notifyUIUpdate(): void {
  // 使用当前状态作为 newState 和 oldState，触发回调但不改变状态
  const currentState = this.state;
  this.callbacks.forEach(callback => {
    try {
      callback(currentState, currentState);
    } catch (error) {
      console.error('Error in UI update callback:', error);
    }
  });
}
```

**作用**: 允许在不改变状态的情况下触发 UI 更新

---

### 2. 修改 `notifyTtsAudioAvailable()` 触发 UI 更新

**文件**: `webapp/web-client/src/app.ts`

**修改内容**:
```typescript
private notifyTtsAudioAvailable(): void {
  const duration = this.ttsPlayer.getTotalDuration();
  const hasPendingAudio = this.ttsPlayer.hasPendingAudio();
  console.log('[App] TTS 音频可用，总时长:', duration.toFixed(2), '秒', 'hasPendingAudio:', hasPendingAudio);

  // 触发 UI 更新（如果存在回调）
  if (typeof window !== 'undefined' && (window as any).onTtsAudioAvailable) {
    (window as any).onTtsAudioAvailable(duration);
  }

  // 如果当前在 INPUT_RECORDING 状态，需要更新播放按钮文本（显示时长）
  const currentState = this.stateMachine.getState();
  if (currentState === SessionState.INPUT_RECORDING) {
    // 触发 UI 更新（不改变状态）
    // 这会触发状态变化回调，让 UI 重新检查 hasPendingAudio 并更新播放按钮
    console.log('[App] 触发 UI 更新（不改变状态），当前状态:', currentState, 'hasPendingAudio:', hasPendingAudio);
    this.stateMachine.notifyUIUpdate();
  } else {
    console.log('[App] 当前状态不是 INPUT_RECORDING，不触发 UI 更新。当前状态:', currentState);
  }
}
```

**作用**: 当 TTS 音频添加到缓冲区时，主动触发 UI 更新

---

### 3. 改进 UI 更新日志

**文件**: `webapp/web-client/src/ui/renderers.ts`

**修改内容**:
```typescript
stateMachine.onStateChange((newState: SessionState, oldState?: SessionState) => {
  // ...
  // 如果是状态不变的通知（UI 更新），记录日志
  const isUIUpdate = oldState === newState;
  if (isUIUpdate) {
    console.log('[UI] UI 更新通知（状态未变化）:', {
      state: newState,
      isSessionActive,
      isConnected,
      hasPendingAudio: app.hasPendingTtsAudio(),
      duration: app.getTtsAudioDuration()
    });
  }
  // ...
});
```

**作用**: 区分真正的状态变化和 UI 更新通知，便于调试

---

## 修复效果

### 修复前

1. TTS 音频添加到缓冲区
2. `notifyTtsAudioAvailable()` 被调用
3. 但 UI 没有更新
4. 播放按钮保持禁用状态
5. 用户看不到任何提示

### 修复后

1. TTS 音频添加到缓冲区
2. `notifyTtsAudioAvailable()` 被调用
3. **触发 `stateMachine.notifyUIUpdate()`**
4. **UI 回调被触发，重新检查 `hasPendingAudio`**
5. **播放按钮被启用，显示时长**
6. **用户可以看到播放提示**

---

## 测试验证

### 测试步骤

1. 启动 Web 客户端
2. 开始会话
3. 发送语音输入
4. 等待收到翻译结果（包含 TTS 音频）

### 预期结果

1. ✅ 播放按钮应该被启用
2. ✅ 播放按钮应该显示时长（例如："播放 (3.5s)"）
3. ✅ TTS 音频信息应该显示
4. ✅ 控制台应该显示 UI 更新日志

### 验证日志

**控制台应该显示**:
```
[App] TTS 音频可用，总时长: 3.50 秒 hasPendingAudio: true
[App] 触发 UI 更新（不改变状态），当前状态: input_recording hasPendingAudio: true
[UI] UI 更新通知（状态未变化）: { state: 'input_recording', hasPendingAudio: true, duration: 3.5 }
```

---

## 相关文件

- `webapp/web-client/src/state_machine.ts` - 添加 `notifyUIUpdate()` 方法
- `webapp/web-client/src/app.ts` - 修改 `notifyTtsAudioAvailable()` 触发 UI 更新
- `webapp/web-client/src/ui/renderers.ts` - 改进 UI 更新日志

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **已修复**

