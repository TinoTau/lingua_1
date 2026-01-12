# Web 客户端 UI 改进和功能更新

## 概述

本文档记录了 Web 客户端最近的 UI 改进和功能更新，包括界面布局优化、会话管理增强和翻译结果显示逻辑改进。

## 更新日期

2025-01-XX

## UI 布局改进

### 按钮布局优化

#### 改进前
所有按钮（连接服务器、开始、结束、发送、播放、倍速）都在同一行显示。

#### 改进后
按钮分为两行显示，布局更加清晰：

**第一行**：连接服务器、开始、结束
- 这些是会话控制按钮，放在第一行便于快速访问

**第二行**：发送、播放（放大 1.5 倍）、倍速
- 发送和播放按钮放大 1.5 倍（`font-size: 24px`，`padding: 15px 30px`），更加醒目
- 倍速按钮保持正常大小，与播放按钮一起放在第二行

#### 实现细节

```typescript
<!-- 第一行：连接服务器、开始、结束 -->
<div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 10px;">
  <button id="connect-btn">连接服务器</button>
  <button id="start-btn">开始</button>
  <button id="end-btn">结束</button>
</div>

<!-- 第二行：发送、播放（放大1.5倍）、倍速 -->
<div style="display: flex; justify-content: center; gap: 10px; align-items: center;">
  <button id="send-btn" style="font-size: 24px; padding: 15px 30px;">发送</button>
  <button id="play-pause-btn" style="font-size: 24px; padding: 15px 30px;">播放</button>
  <button id="playback-rate-btn">1x</button>
</div>
```

## 会话管理增强

### 结束会话时丢弃未播放内容

#### 功能说明
当用户点击"结束"按钮时，系统会：
1. 停止录音
2. 停止播放并清空所有未播放的 TTS 音频缓冲区
3. 清空音频缓冲区
4. **清空 WebSocket 发送队列**（丢弃所有未发送的音频数据）
5. **清空待显示的翻译结果队列**
6. **清空已显示的翻译结果文本**

#### 实现细节

**在 `endSession()` 方法中**：
```typescript
async endSession(): Promise<void> {
  this.isSessionActive = false;

  // 停止录音
  this.recorder.stop();
  this.recorder.close();

  // 停止播放并清空所有未播放的音频
  this.ttsPlayer.stop();
  this.ttsPlayer.clearBuffers();

  // 清空音频缓冲区
  this.audioBuffer = [];

  // 清空 WebSocket 发送队列（丢弃所有未发送的音频数据）
  this.wsClient.clearSendQueue();

  // 清空待显示的翻译结果队列
  this.pendingTranslationResults = [];
  this.displayedTranslationCount = 0;
  
  // 清空已显示的翻译结果文本
  this.clearDisplayedTranslationResults();

  // 结束会话（状态机会回到 INPUT_READY）
  this.stateMachine.endSession();
}
```

**WebSocket 客户端支持**：
- 将 `clearSendQueue()` 方法改为公开方法，供外部调用
- 清空发送队列时会停止发送定时器并重置背压状态

### 拒绝接收会话结束后的翻译结果

#### 功能说明
当会话结束后，即使调度服务器返回新的翻译结果，系统也会直接丢弃，不会处理或显示。

#### 实现细节

在 `onServerMessage()` 方法中，对翻译相关的消息类型进行检查：

```typescript
private async onServerMessage(message: ServerMessage): Promise<void> {
  switch (message.type) {
    case 'asr_partial':
      // 如果会话已结束，丢弃 ASR 部分结果
      if (!this.isSessionActive) {
        console.log('[App] 会话已结束，丢弃 ASR 部分结果:', message.text);
        return;
      }
      // ... 处理逻辑
      break;

    case 'translation':
      // 如果会话已结束，丢弃翻译消息
      if (!this.isSessionActive) {
        console.log('[App] 会话已结束，丢弃翻译消息:', message.text);
        return;
      }
      // ... 处理逻辑
      break;

    case 'translation_result':
      // 如果会话已结束，丢弃翻译结果
      if (!this.isSessionActive) {
        console.log('[App] 会话已结束，丢弃翻译结果:', {
          text_asr: message.text_asr,
          text_translated: message.text_translated,
          trace_id: message.trace_id
        });
        return;
      }
      // ... 处理逻辑
      break;

    case 'tts_audio':
      // 如果会话已结束，丢弃 TTS 音频
      if (!this.isSessionActive) {
        console.log('[App] 会话已结束，丢弃 TTS 音频消息');
        return;
      }
      // ... 处理逻辑
      break;
  }
}
```

**不会被过滤的消息类型**：
- `backpressure` - 背压消息（与会话状态无关）
- `room_*` - 房间相关消息
- `webrtc_*` - WebRTC 相关消息
- `session_init_ack` - 会话初始化确认

## 翻译结果显示逻辑改进

### 只有播放时才显示翻译结果

#### 功能说明
改进前，收到翻译结果后立即显示原文和译文。改进后，翻译结果会被缓存，只有在用户点击播放按钮开始播放 TTS 音频时才显示。

#### 实现细节

**翻译结果缓存机制**：
```typescript
// 待显示的翻译结果队列
private pendingTranslationResults: Array<{
  originalText: string;
  translatedText: string;
  serviceTimings?: {...};
  networkTimings?: {...};
  schedulerSentAtMs?: number;
}> = [];

// 已显示的翻译结果数量
private displayedTranslationCount: number = 0;
```

**收到翻译结果时**：
```typescript
case 'translation_result':
  // 缓存翻译结果，不立即显示（只有播放时才显示）
  this.pendingTranslationResults.push({
    originalText: message.text_asr,
    translatedText: message.text_translated,
    serviceTimings: message.service_timings,
    networkTimings: message.network_timings,
    schedulerSentAtMs: message.scheduler_sent_at_ms
  });
  console.log('[App] 翻译结果已缓存，待播放时显示。当前待显示数量:', 
    this.pendingTranslationResults.length);
  break;
```

**开始播放时**：
```typescript
async startTtsPlayback(): Promise<void> {
  if (!this.ttsPlayer.hasPendingAudio()) {
    console.warn('没有待播放的音频');
    return;
  }

  console.log('用户手动触发播放，当前状态:', this.stateMachine.getState());
  
  // 在开始播放时，显示待显示的翻译结果
  this.displayPendingTranslationResults();
  
  await this.ttsPlayer.startPlayback();
}
```

**显示待显示结果的方法**：
```typescript
private displayPendingTranslationResults(): void {
  // 显示所有待显示的翻译结果
  for (const result of this.pendingTranslationResults) {
    this.displayTranslationResult(
      result.originalText,
      result.translatedText,
      result.serviceTimings,
      result.networkTimings,
      result.schedulerSentAtMs
    );
  }
  // 更新已显示的数量
  this.displayedTranslationCount += this.pendingTranslationResults.length;
  // 清空待显示队列（已显示的结果不再需要保留）
  this.pendingTranslationResults = [];
  console.log('[App] 已显示所有待显示的翻译结果，已显示总数:', 
    this.displayedTranslationCount);
}
```

**清空显示的方法**：
```typescript
private clearDisplayedTranslationResults(): void {
  const originalDiv = document.getElementById('translation-original');
  const translatedDiv = document.getElementById('translation-translated');
  
  if (originalDiv) {
    originalDiv.textContent = '';
  }
  if (translatedDiv) {
    translatedDiv.textContent = '';
  }
  
  // 隐藏翻译结果容器
  const resultContainer = document.getElementById('translation-result-container');
  if (resultContainer) {
    resultContainer.style.display = 'none';
  }
  
  console.log('[App] 已清空显示的翻译结果');
}
```

### 工作流程

1. **收到翻译结果**：
   - 缓存到 `pendingTranslationResults` 队列
   - 不立即显示

2. **用户点击播放**：
   - 调用 `displayPendingTranslationResults()` 显示所有待显示的结果
   - 开始播放 TTS 音频

3. **用户点击结束**：
   - 清空 `pendingTranslationResults` 队列
   - 清空已显示的文本
   - 丢弃所有未播放的音频

## 相关文件

- `src/ui/renderers.ts` - UI 渲染和按钮布局
- `src/app.ts` - 应用主逻辑，包括会话管理和消息处理
- `src/websocket_client.ts` - WebSocket 客户端，包括发送队列管理

## 测试建议

1. **UI 布局测试**：
   - 验证按钮布局是否符合设计要求
   - 验证发送和播放按钮是否放大 1.5 倍
   - 验证按钮在不同屏幕尺寸下的显示效果

2. **会话管理测试**：
   - 验证点击"结束"按钮后，所有未播放内容是否被清空
   - 验证会话结束后，新的翻译结果是否被丢弃
   - 验证 WebSocket 发送队列是否被清空

3. **翻译结果显示测试**：
   - 验证收到翻译结果后，是否不立即显示
   - 验证点击播放后，是否显示所有待显示的结果
   - 验证点击结束后，未播放的翻译结果是否被清空

## 注意事项

1. **翻译结果缓存**：待显示的翻译结果会占用内存，如果用户长时间不播放，可能会累积较多。建议在内存压力过高时自动播放。

2. **会话状态检查**：所有翻译相关的消息处理都需要检查 `isSessionActive` 状态，确保会话结束后不会处理新消息。

3. **UI 更新**：翻译结果的显示和清空都需要更新 UI，确保用户界面状态正确。

## 后续改进建议

1. **批量显示优化**：如果待显示的结果很多，可以考虑分批显示，避免一次性显示过多内容。

2. **显示状态指示**：可以添加一个指示器，显示有多少待显示的翻译结果。

3. **自动播放触发**：在内存压力过高时，可以考虑自动播放并显示翻译结果。

