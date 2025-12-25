# 文本显示与音频播放同步实现

**日期**: 2025-12-25  
**状态**: ✅ **已实现**

---

## 实现方案

使用**方案1：将文本与音频段关联**，实现文本显示与音频播放同步。

---

## 实现内容

### 1. 修改 `TtsPlayer` 类

**文件**: `webapp/web-client/src/tts_player.ts`

#### 1.1 添加类型定义

```typescript
export type PlaybackIndexChangeCallback = (utteranceIndex: number) => void;

interface AudioBufferWithIndex {
  audio: Float32Array;
  utteranceIndex: number;
}
```

#### 1.2 修改 `audioBuffers` 结构

**修改前**：
```typescript
private audioBuffers: Float32Array[] = [];
```

**修改后**：
```typescript
private audioBuffers: AudioBufferWithIndex[] = []; // 包含 utteranceIndex
```

#### 1.3 添加播放索引跟踪

```typescript
private currentPlaybackIndex: number = -1; // 当前播放的索引
private playbackIndexChangeCallback: PlaybackIndexChangeCallback | null = null;
```

#### 1.4 修改 `addAudioChunk` 方法

**修改前**：
```typescript
async addAudioChunk(base64Data: string): Promise<void>
```

**修改后**：
```typescript
async addAudioChunk(base64Data: string, utteranceIndex: number): Promise<void>
```

**功能**：
- 将音频块与 `utteranceIndex` 关联
- 保存到 `audioBuffers` 数组中

#### 1.5 修改 `startPlayback` 方法

**修改内容**：
- 在播放每个音频块时，获取对应的 `utteranceIndex`
- 调用 `playbackIndexChangeCallback` 通知 `App` 显示对应的文本
- 播放完成后，移除已播放的音频块

**关键代码**：
```typescript
// 获取当前播放的音频块（不移除，先播放）
this.currentPlaybackIndex++;
const currentBuffer = this.audioBuffers[0];
const utteranceIndex = currentBuffer.utteranceIndex;

// 通知 App 显示对应的文本
if (this.playbackIndexChangeCallback) {
  console.log('TtsPlayer: 播放索引变化，显示 utteranceIndex:', utteranceIndex);
  this.playbackIndexChangeCallback(utteranceIndex);
}

// 移除音频块（边播放边清理）
const bufferWithIndex = this.audioBuffers.shift()!;
```

#### 1.6 添加回调设置方法

```typescript
setPlaybackIndexChangeCallback(callback: PlaybackIndexChangeCallback): void {
  this.playbackIndexChangeCallback = callback;
}
```

---

### 2. 修改 `App` 类

**文件**: `webapp/web-client/src/app.ts`

#### 2.1 添加翻译结果 Map

**修改前**：
```typescript
private pendingTranslationResults: Array<{...}> = [];
```

**修改后**：
```typescript
// 翻译结果映射（key: utterance_index, value: 翻译结果）
private translationResults: Map<number, {
  originalText: string;
  translatedText: string;
  serviceTimings?: {...};
  networkTimings?: {...};
  schedulerSentAtMs?: number;
}> = new Map();
```

#### 2.2 设置播放索引变化回调

**在 `setupCallbacks()` 中**：
```typescript
// TTS 播放索引变化回调（用于文本显示同步）
this.ttsPlayer.setPlaybackIndexChangeCallback((utteranceIndex) => {
  this.onPlaybackIndexChange(utteranceIndex);
});
```

#### 2.3 修改 `translation_result` 消息处理

**修改前**：
```typescript
// 立即显示翻译结果
if (message.text_asr || message.text_translated) {
  this.displayTranslationResult(...);
}
```

**修改后**：
```typescript
// 保存翻译结果到 Map（不立即显示，等待播放时显示）
if (message.text_asr || message.text_translated) {
  this.translationResults.set(message.utterance_index, {
    originalText: message.text_asr,
    translatedText: message.text_translated,
    // ...
  });
}

// 添加音频块时传递 utterance_index
this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index);
```

#### 2.4 添加 `onPlaybackIndexChange` 方法

```typescript
private onPlaybackIndexChange(utteranceIndex: number): void {
  console.log('[App] 播放索引变化，显示 utterance_index:', utteranceIndex);
  
  // 如果 utterance_index 为 -1，说明是单独的 tts_audio 消息，不显示文本
  if (utteranceIndex === -1) {
    return;
  }
  
  // 从 Map 中获取对应的翻译结果
  const result = this.translationResults.get(utteranceIndex);
  if (result) {
    this.displayTranslationResult(
      result.originalText,
      result.translatedText,
      result.serviceTimings,
      result.networkTimings,
      result.schedulerSentAtMs
    );
  }
}
```

#### 2.5 清理翻译结果 Map

**在 `startSession()` 和 `endSession()` 中**：
```typescript
// 清空翻译结果 Map
this.translationResults.clear();
```

---

## 工作流程

### 1. 收到翻译结果

1. 收到 `translation_result` 消息
2. 保存翻译结果到 `translationResults` Map（key: `utterance_index`）
3. 添加音频块到 `TtsPlayer`，传递 `utterance_index`
4. **文本不立即显示**

### 2. 开始播放

1. 用户点击播放按钮
2. `TtsPlayer.startPlayback()` 开始播放
3. 播放第一个音频块时：
   - 获取 `utteranceIndex`
   - 调用 `playbackIndexChangeCallback(utteranceIndex)`
   - `App.onPlaybackIndexChange(utteranceIndex)` 被调用
   - 从 `translationResults` Map 中获取对应的翻译结果
   - **显示文本**

### 3. 继续播放

1. 第一个音频块播放完成
2. 播放第二个音频块时：
   - 获取对应的 `utteranceIndex`
   - 调用 `playbackIndexChangeCallback(utteranceIndex)`
   - **显示对应的文本**（追加到已有文本）

---

## 效果

### 修复前

- 文本在收到 `translation_result` 时立即显示
- 文本与音频播放不同步
- 用户无法知道当前播放的是哪条文本

### 修复后

- 文本在播放对应的音频段时显示
- 文本与音频播放完全同步
- 用户可以看到当前播放的文本

---

## 注意事项

1. **单独的 `tts_audio` 消息**：
   - 如果 `tts_audio` 消息没有 `utterance_index`，使用 `-1` 作为占位符
   - `onPlaybackIndexChange` 会跳过 `utterance_index === -1` 的情况

2. **内存管理**：
   - 播放完成后，音频块会被移除
   - 翻译结果 Map 在会话结束时会被清理

3. **文本显示方式**：
   - 使用 `displayTranslationResult()` 追加显示
   - 新的文本会追加到已有文本后面

---

## 测试验证

### 测试步骤

1. 重新编译 Web 客户端
2. 启动 Web 客户端
3. 开始会话并发送语音输入
4. 等待收到翻译结果
5. 点击播放按钮

### 预期结果

1. ✅ 收到 `translation_result` 消息后，文本**不立即显示**
2. ✅ 点击播放按钮后，开始播放音频
3. ✅ 播放到第一个音频段时，显示对应的文本
4. ✅ 播放到第二个音频段时，显示对应的文本（追加）
5. ✅ 控制台应该显示：`[App] 播放索引变化，显示 utterance_index: X`

---

## 相关文档

- `TEXT_DISPLAY_SYNC_WITH_AUDIO_PLAYBACK.md` - 文本显示与音频播放同步方案
- `TEXT_DISPLAY_DELAY_FIX.md` - 文本显示延迟修复

