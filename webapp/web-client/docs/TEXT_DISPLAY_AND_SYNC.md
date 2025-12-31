# 文本显示与音频播放同步

**状态**: ✅ **已实现**

## 概述

Web客户端实现了文本显示与音频播放的同步机制，确保翻译文本在对应的音频段播放时显示，提供更好的用户体验。

## 实现方案

使用**文本与音频段关联**的方案，通过 `utterance_index` 将每个翻译结果与对应的音频段关联，在播放音频时显示对应的文本。

## 核心实现

### 1. TtsPlayer 播放索引跟踪

**文件**: `webapp/web-client/src/tts_player.ts`

- 音频缓冲区包含 `utteranceIndex` 字段
- 播放时跟踪当前播放索引
- 通过回调通知 App 显示对应文本

```typescript
interface AudioBufferWithIndex {
  audio: Float32Array;
  utteranceIndex: number;
}

// 播放时通知索引变化
if (this.playbackIndexChangeCallback) {
  this.playbackIndexChangeCallback(utteranceIndex);
}
```

### 2. TranslationDisplayManager 文本管理

**文件**: `webapp/web-client/src/app/translation_display.ts`

- 使用 Map 存储翻译结果（key: `utterance_index`）
- 支持去重显示，避免重复追加
- 在播放时根据索引显示对应文本

### 3. App 同步逻辑

**文件**: `webapp/web-client/src/app.ts`

- 收到翻译结果时保存到 Map，不立即显示
- 设置播放索引变化回调
- 播放时根据索引从 Map 中获取并显示文本

## 工作流程

1. **收到翻译结果**
   - 保存翻译结果到 `translationResults` Map（key: `utterance_index`）
   - 添加音频块到 `TtsPlayer`，传递 `utterance_index`
   - 文本不立即显示

2. **开始播放**
   - 用户点击播放按钮
   - `TtsPlayer.startPlayback()` 开始播放
   - 播放第一个音频块时获取 `utteranceIndex`
   - 调用回调通知 App 显示对应文本

3. **继续播放**
   - 每个音频块播放时显示对应的文本
   - 文本追加显示，不会替换已有内容

## 关键特性

### 去重机制

- 使用 `isDisplayed()` 检查是否已显示
- 避免同一 `utterance_index` 的文本重复显示
- 支持完整段落匹配去重

### 空文本处理

- 如果 `utterance_index` 为 -1，跳过文本显示（单独的 tts_audio 消息）
- 如果翻译结果为空，不显示文本

### 内存管理

- 播放完成后，音频块会被移除
- 翻译结果 Map 在会话结束时会被清理

## 历史问题修复

### 问题1: 文本显示延迟

**问题**: 文本在收到翻译结果时被缓存，必须等待播放按钮才显示。

**修复**: 改为在播放时根据索引显示，确保文本与音频同步。

### 问题2: 文本与音频不同步

**问题**: 文本立即显示，但音频还在播放其他内容。

**修复**: 实现播放索引跟踪，播放到哪个音频段就显示对应的文本。

## 测试验证

### 预期行为

1. ✅ 收到 `translation_result` 消息后，文本不立即显示
2. ✅ 点击播放按钮后，开始播放音频
3. ✅ 播放到第一个音频段时，显示对应的文本
4. ✅ 播放到后续音频段时，显示对应的文本（追加）

### 调试日志

控制台应显示：
```
[App] 播放索引变化，显示 utterance_index: 0
[App] 找到对应的翻译结果，显示文本
[App] 播放时文本已显示，utterance_index: 0
```

## 相关文档

- [TTS 播放器实现](../src/tts_player.ts)
- [翻译显示管理器](../src/app/translation_display.ts)
- [Phase 2 实现总结](./PHASE2_IMPLEMENTATION_SUMMARY.md)

