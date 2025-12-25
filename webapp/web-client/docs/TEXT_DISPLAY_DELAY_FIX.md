# 文本显示延迟修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

用户反馈：
1. **文本框内容比实际听到的音频要少**
2. **不是同步刷新的**
3. **音频播放完以后文本还无法显示**
4. **需要下一段音频进来才能显示上一句的文本**

---

## 问题分析

### 根本原因

在 `webapp/web-client/src/app.ts` 中：

1. **翻译结果被缓存，不立即显示**（第 393-401 行）：
   ```typescript
   // 缓存翻译结果，不立即显示（只有播放时才显示）
   this.pendingTranslationResults.push({
     originalText: message.text_asr,
     translatedText: message.text_translated,
     // ...
   });
   ```

2. **只在播放时显示**（第 601-602 行）：
   ```typescript
   async startTtsPlayback(): Promise<void> {
     // 在开始播放时，显示待显示的翻译结果
     this.displayPendingTranslationResults();
     // ...
   }
   ```

3. **导致的问题**：
   - 用户收到翻译结果后，文本不会立即显示
   - 必须等待用户点击播放按钮，才开始显示文本
   - 如果用户不播放，文本永远不会显示
   - 如果用户播放了，但播放完成后，下一段文本仍然需要等待下一次播放

---

## 修复方案

### 修改 `translation_result` 消息处理

**文件**: `webapp/web-client/src/app.ts`

**修改内容**：
```typescript
// 立即显示翻译结果（不再等待播放时显示）
// 这样可以确保文本与音频同步，用户可以看到实时的翻译结果
if (message.text_asr || message.text_translated) {
  this.displayTranslationResult(
    message.text_asr,
    message.text_translated,
    message.service_timings,
    message.network_timings,
    message.scheduler_sent_at_ms
  );
  console.log('[App] 翻译结果已立即显示');
}
```

**修改前**：
- 翻译结果被缓存到 `pendingTranslationResults` 数组
- 只在用户点击播放按钮时显示
- 导致文本显示延迟

**修改后**：
- 翻译结果立即显示
- 文本与音频同步，用户可以看到实时的翻译结果
- 不再依赖播放按钮触发显示

---

## 修复效果

### 修复前

1. 收到 `translation_result` 消息，包含 ASR 和 NMT 文本
2. 文本被缓存到 `pendingTranslationResults` 数组
3. **文本不显示**
4. 用户点击播放按钮
5. **开始显示文本**
6. 播放完成后，下一段文本仍然需要等待下一次播放

### 修复后

1. 收到 `translation_result` 消息，包含 ASR 和 NMT 文本
2. **立即显示文本**
3. 用户可以看到实时的翻译结果
4. 文本与音频同步，不再依赖播放按钮

---

## 注意事项

1. **保留 `pendingTranslationResults` 机制**：
   - 虽然不再用于文本显示，但可以用于其他用途（如统计、调试等）
   - 如果未来需要恢复"播放时显示"的功能，可以保留这个机制

2. **文本追加方式**：
   - `displayTranslationResult()` 方法使用追加方式显示文本
   - 新的文本会追加到已有文本后面，不会替换

3. **空文本处理**：
   - 如果 ASR 和 NMT 文本都为空，不会显示
   - 如果只有其中一个为空，仍然会显示非空的部分

---

## 测试验证

### 测试步骤

1. 重新编译 Web 客户端
2. 启动 Web 客户端
3. 开始会话并发送语音输入
4. 等待收到翻译结果

### 预期结果

1. ✅ 收到 `translation_result` 消息后，文本立即显示
2. ✅ 文本与音频同步，不需要等待播放按钮
3. ✅ 多段文本会依次追加显示
4. ✅ 控制台应该显示：`[App] 翻译结果已立即显示`

---

## 相关文档

- `TTS_UI_UPDATE_TIMING_FIX.md` - TTS UI 更新时序修复
- `TTS_PLAYBACK_DIAGNOSIS.md` - TTS 播放问题诊断

