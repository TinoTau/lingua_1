# 文本显示与音频播放同步

**日期**: 2025-12-25  
**状态**: ⚠️ **待实现**

---

## 问题描述

用户要求：
- **文本显示应该与音频播放同步**
- **播放到哪条音频就显示对应的文本**

当前实现：
- 文本在收到 `translation_result` 消息时立即显示
- 文本与音频播放不同步
- 用户无法知道当前播放的是哪条文本

---

## 当前实现分析

### 1. 文本显示逻辑

**文件**: `webapp/web-client/src/app.ts`

**当前实现**：
```typescript
// 立即显示翻译结果（不再等待播放时显示）
if (message.text_asr || message.text_translated) {
  this.displayTranslationResult(
    message.text_asr,
    message.text_translated,
    // ...
  );
}
```

**问题**：
- 文本立即显示，与音频播放不同步
- 无法知道当前播放的是哪条文本

---

### 2. 音频播放逻辑

**文件**: `webapp/web-client/src/tts_player.ts`

**当前实现**：
```typescript
const playNext = async () => {
  // 立即移除音频块（边播放边清理，减少内存占用）
  const buffer = this.audioBuffers.shift()!;
  // 播放音频
  // ...
};
```

**问题**：
- 音频块被立即移除（`shift()`），无法跟踪当前播放的是哪个音频块
- 无法将音频块与文本关联

---

## 解决方案

### 方案 1: 将文本与音频段关联（推荐）

**核心思路**：
1. 将每个翻译结果与对应的音频段关联（使用 `utterance_index`）
2. 在播放音频时，根据当前播放的音频段显示对应的文本
3. 修改 `TtsPlayer` 来跟踪当前播放的音频段索引

**实现步骤**：

1. **修改 `TtsPlayer` 类**：
   ```typescript
   export class TtsPlayer {
     private audioBuffers: Array<{
       audio: Float32Array;
       utteranceIndex: number;  // 添加 utterance_index
     }> = [];
     private currentPlaybackIndex: number = -1;  // 当前播放的索引
     
     async addAudioChunk(base64Data: string, utteranceIndex: number): Promise<void> {
       // 将音频块与 utterance_index 关联
       this.audioBuffers.push({
         audio: float32Array,
         utteranceIndex: utteranceIndex
       });
     }
     
     const playNext = async () => {
       if (this.audioBuffers.length === 0) {
         return;
       }
       
       // 获取当前播放的音频块（不移除）
       const currentBuffer = this.audioBuffers[this.currentPlaybackIndex + 1];
       this.currentPlaybackIndex++;
       
       // 通知 App 显示对应的文本
       if (this.onPlaybackIndexChange) {
         this.onPlaybackIndexChange(currentBuffer.utteranceIndex);
       }
       
       // 播放音频
       // ...
       
       // 播放完成后，移除已播放的音频块
       this.audioBuffers.shift();
       this.currentPlaybackIndex--;
     };
   }
   ```

2. **修改 `App` 类**：
   ```typescript
   export class App {
     private translationResults: Map<number, {
       originalText: string;
       translatedText: string;
       utteranceIndex: number;
     }> = new Map();
     
     // 在收到 translation_result 时，保存结果但不立即显示
     case 'translation_result':
       // 保存翻译结果
       this.translationResults.set(message.utterance_index, {
         originalText: message.text_asr,
         translatedText: message.text_translated,
         utteranceIndex: message.utterance_index
       });
       
       // 添加音频块时传递 utterance_index
       this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index);
       break;
     
     // 在播放时显示对应的文本
     private onPlaybackIndexChange(utteranceIndex: number): void {
       const result = this.translationResults.get(utteranceIndex);
       if (result) {
         this.displayTranslationResult(
           result.originalText,
           result.translatedText
         );
       }
     }
   }
   ```

---

### 方案 2: 使用播放进度回调（备选）

**核心思路**：
1. 在 `TtsPlayer` 中添加播放进度回调
2. 根据播放进度计算当前播放的音频段
3. 显示对应的文本

**实现步骤**：

1. **修改 `TtsPlayer` 类**：
   ```typescript
   export class TtsPlayer {
     private onPlaybackProgress?: (currentIndex: number, totalDuration: number) => void;
     
     setPlaybackProgressCallback(callback: (currentIndex: number, totalDuration: number) => void): void {
       this.onPlaybackProgress = callback;
     }
     
     const playNext = async () => {
       // 播放音频
       // ...
       
       // 通知播放进度
       if (this.onPlaybackProgress) {
         const currentIndex = this.audioBuffers.length - this.remainingBuffers.length;
         const totalDuration = this.getTotalDuration();
         this.onPlaybackProgress(currentIndex, totalDuration);
       }
     };
   }
   ```

2. **修改 `App` 类**：
   ```typescript
   export class App {
     constructor() {
       // 设置播放进度回调
       this.ttsPlayer.setPlaybackProgressCallback((currentIndex, totalDuration) => {
         // 根据 currentIndex 显示对应的文本
         const result = this.translationResults.get(currentIndex);
         if (result) {
           this.displayTranslationResult(
             result.originalText,
             result.translatedText
           );
         }
       });
     }
   }
   ```

---

## 推荐方案

**推荐使用方案 1**，因为：
1. 更直接：直接将文本与音频段关联
2. 更准确：使用 `utterance_index` 精确匹配
3. 更简单：不需要计算播放进度

---

## 注意事项

1. **内存管理**：
   - 播放完成后，需要清理已播放的文本和音频块
   - 避免内存泄漏

2. **文本显示方式**：
   - 可以选择追加显示（累积所有文本）
   - 也可以选择替换显示（只显示当前播放的文本）

3. **用户体验**：
   - 可以考虑高亮当前播放的文本
   - 可以考虑显示播放进度条

---

## 相关文档

- `TEXT_DISPLAY_DELAY_FIX.md` - 文本显示延迟修复
- `TTS_UI_UPDATE_TIMING_FIX.md` - TTS UI 更新时序修复

