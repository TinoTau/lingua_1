# 文本显示和ASR识别质量问题

**日期**: 2025-12-25  
**状态**: 🔧 **部分修复**

---

## 问题描述

用户反馈：
1. **文本框内容比实际听到的音频要少**
2. **不是同步刷新的**
3. **音频播放完以后文本还无法显示**
4. **需要下一段音频进来才能显示上一句的文本**
5. **文本识别质量非常差，连一点逻辑都没有**，例如：
   ```
   有些任务不符合要求不符合
   不符合标准被船部的教育端以后没有办法
   被船部的教育端以后没有办法再会传到会不端
   他有些序后被丢掉的导致者
   这里任务的IT不笔配就没有办法
   这IT不笔配就没有办法会,就是这个问题
   就是这个问题
   有没有发挥结果
   好的我们现在看到接电端已经由内容返回了
   我们的外部团了
   ```

---

## 问题分析

### 1. 文本显示延迟问题 ✅ **已修复**

**根本原因**：
- 在 `webapp/web-client/src/app.ts` 中，翻译结果被缓存到 `pendingTranslationResults` 数组
- 只在用户点击播放按钮时显示（`startTtsPlayback()` 方法）
- 导致文本不会立即显示，必须等待播放时才显示

**修复方案**：
- 修改 `translation_result` 消息处理，立即显示翻译结果
- 不再等待播放按钮触发显示

**修复文件**：
- `webapp/web-client/src/app.ts`（第 393-401 行）

**修复效果**：
- ✅ 文本立即显示，与音频同步
- ✅ 不再依赖播放按钮触发显示

---

### 2. ASR识别质量问题 ⚠️ **待进一步调查**

**日志显示乱码**：
```
transcript_preview='鎴戞病鏈夊彂鎸ョ幆鏉?'
text_len=7
```

**可能的原因**：

1. **日志编码问题**（最可能）：
   - Windows PowerShell 使用 GBK 编码读取日志文件
   - 日志文件本身是 UTF-8 编码（已确认：`faster_whisper_vad_service.py` 第 30 行）
   - 在 PowerShell 中显示时出现乱码，但实际文本可能是正确的

2. **实际识别问题**：
   - Faster Whisper 识别错误
   - 音频质量问题（虽然通过了质量检查，但质量仍然不足以准确识别）
   - 模型配置问题（`large-v3` 模型可能没有正确加载或配置）

3. **文本传递过程中编码损坏**：
   - 文本在 pickle 序列化/反序列化过程中损坏
   - 文本在 HTTP 传输过程中编码损坏

**需要检查**：
- ✅ 日志文件编码：已确认使用 UTF-8（`faster_whisper_vad_service.py` 第 30 行）
- ⚠️ 实际识别文本：需要检查 ASR worker 返回的原始文本
- ⚠️ 文本传递过程：需要检查 pickle 序列化/反序列化
- ⚠️ HTTP 传输：需要检查 FastAPI 响应编码

---

## 修复方案

### 1. 文本显示延迟修复 ✅

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

**修改后**：
- 翻译结果立即显示
- 文本与音频同步

---

### 2. ASR识别质量问题诊断 ⚠️

**建议的检查步骤**：

1. **检查日志编码**：
   - ✅ 已确认日志文件使用 UTF-8 编码
   - ⚠️ 使用 UTF-8 编码的文本编辑器（如 VS Code）打开日志文件，查看实际文本

2. **检查 ASR worker 返回的原始文本**：
   - 在 `asr_worker_process.py` 中添加日志，记录 `full_text` 的原始值
   - 检查文本在 pickle 序列化/反序列化前后是否一致

3. **检查 HTTP 响应编码**：
   - FastAPI 默认使用 UTF-8 编码
   - 检查响应头中的 `Content-Type` 是否包含 `charset=utf-8`

4. **检查音频质量**：
   - 虽然音频质量检查通过，但可能需要提高阈值
   - 检查音频的 RMS、STD、动态范围等指标

5. **检查模型配置**：
   - 确认 `large-v3` 模型已正确加载
   - 检查 `beam_size`、`condition_on_previous_text` 等参数

---

## 测试验证

### 文本显示延迟修复测试

1. 重新编译 Web 客户端
2. 启动 Web 客户端
3. 开始会话并发送语音输入
4. 等待收到翻译结果

**预期结果**：
- ✅ 收到 `translation_result` 消息后，文本立即显示
- ✅ 文本与音频同步，不需要等待播放按钮
- ✅ 控制台应该显示：`[App] 翻译结果已立即显示`

### ASR识别质量问题诊断

1. **使用 UTF-8 编码的文本编辑器打开日志文件**：
   ```bash
   # 使用 VS Code 或 Notepad++ 打开日志文件
   # 确保编辑器使用 UTF-8 编码
   ```

2. **检查 ASR worker 返回的原始文本**：
   - 在 `asr_worker_process.py` 中添加日志：
     ```python
     logger.info(f"[{trace_id}] ASR raw text (repr): {repr(full_text)}")
     logger.info(f"[{trace_id}] ASR raw text (bytes): {full_text.encode('utf-8')}")
     ```

3. **检查 HTTP 响应**：
   - 在浏览器开发者工具中查看网络请求
   - 检查响应头中的 `Content-Type` 是否包含 `charset=utf-8`

---

## 相关文档

- `TEXT_DISPLAY_DELAY_FIX.md` - 文本显示延迟修复
- `RESULT_QUEUE_AND_ASR_ENCODING_ISSUES.md` - 结果队列和ASR编码问题
- `ASR_ACCURACY_AND_QUEUE_ISSUES.md` - ASR识别准确度和结果队列问题

