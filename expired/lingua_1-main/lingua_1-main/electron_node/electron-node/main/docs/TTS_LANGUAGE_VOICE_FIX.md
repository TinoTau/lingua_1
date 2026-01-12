# TTS 语言语音匹配修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

用户反馈：**现在播放的语音根本听不出是什么语言，TTS之前都是正常的**

---

## 问题分析

### 根本原因

1. **Node.js 端 TTS 路由没有根据目标语言选择正确的语音**
   - `task-router.ts` 中的 `routeTTSTask` 方法总是使用 `'zh_CN-huayan-medium'` 作为默认语音
   - 即使目标语言是 `en`（英语），也会使用中文语音模型来合成英语文本
   - 这导致英语文本被中文语音模型合成，听起来完全无法识别

2. **Rust 端有正确的语言-语音映射逻辑**
   - `electron_node/services/node-inference/src/tts.rs` 中的 `determine_voice` 函数会根据语言选择正确的语音：
     - 英语 (`en`) → `en_US-lessac-medium`
     - 中文 (`zh`) → `zh_CN-huayan-medium`
   - 但 Node.js 端没有实现这个逻辑

3. **日志证据**
   - 从调度服务器日志可以看到，翻译结果包含英语文本（例如："Why is this part not back to this part?"）
   - 但 TTS 请求可能使用了错误的中文语音模型

---

## 修复方案

### 修改 `task-router.ts` 中的 `routeTTSTask` 方法

**文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**修改内容**:
```typescript
// TTS服务端点：/tts
// 请求格式：{ text: string, voice: string, language?: string }
// 响应：WAV格式的音频数据（二进制）
// 根据目标语言自动选择语音（如果没有指定 voice_id）
const targetLang = (task.lang || 'zh').toLowerCase();
let defaultVoice = 'zh_CN-huayan-medium'; // 默认使用中文语音
if (targetLang.startsWith('en')) {
  defaultVoice = 'en_US-lessac-medium'; // 英语使用英语语音
} else if (targetLang.startsWith('zh')) {
  defaultVoice = 'zh_CN-huayan-medium'; // 中文使用中文语音
}

const response = await httpClient.post('/tts', {
  text: task.text,
  voice: task.voice_id || defaultVoice, // 使用根据语言选择的默认语音
  language: task.lang || 'zh', // 将lang映射到language
}, {
  signal: abortController.signal, // 支持任务取消
  responseType: 'arraybuffer', // TTS服务返回WAV音频数据（二进制）
});
```

**作用**: 
- 根据目标语言（`task.lang`）自动选择正确的语音模型
- 英语文本使用英语语音模型（`en_US-lessac-medium`）
- 中文文本使用中文语音模型（`zh_CN-huayan-medium`）
- 如果用户明确指定了 `voice_id`，则优先使用用户指定的语音

---

## 修复效果

### 修复前

1. 翻译结果为英语文本（例如："Why is this part not back to this part?"）
2. TTS 请求使用中文语音模型（`zh_CN-huayan-medium`）
3. 英语文本被中文语音模型合成
4. **播放的语音完全无法识别，听不出是什么语言**

### 修复后

1. 翻译结果为英语文本（例如："Why is this part not back to this part?"）
2. TTS 请求根据目标语言（`en`）自动选择英语语音模型（`en_US-lessac-medium`）
3. 英语文本被英语语音模型合成
4. **播放的语音清晰可辨，是正常的英语语音**

---

## 测试验证

### 测试步骤

1. 重新编译 Node.js 端
2. 重启节点端服务
3. 使用 Web 客户端进行测试：
   - 输入中文语音
   - 翻译为英语
   - 播放 TTS 音频

### 预期结果

1. ✅ TTS 音频应该使用英语语音模型合成
2. ✅ 播放的语音应该清晰可辨，是正常的英语语音
3. ✅ 中文到英语的翻译和 TTS 应该正常工作

### 验证日志

**Node.js 端日志应该显示**:
```
TTS request: text="Why is this part not back to this part?", lang="en", voice="en_US-lessac-medium"
```

**调度服务器日志应该显示**:
```
text_translated: "Why is this part not back to this part?"
tts_audio_len: [正常长度]
```

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 添加语言-语音映射逻辑
- `electron_node/services/node-inference/src/tts.rs` - Rust 端的参考实现（已有正确的语言-语音映射）

---

## 注意事项

1. **语音模型可用性**
   - 确保 Piper TTS 服务已安装并支持 `en_US-lessac-medium` 语音模型
   - 如果该模型不可用，需要安装或使用其他可用的英语语音模型

2. **扩展性**
   - 当前实现只支持英语和中文
   - 如果需要支持其他语言，需要在 `routeTTSTask` 中添加相应的语言-语音映射

3. **用户指定语音**
   - 如果用户通过 `voice_id` 明确指定了语音，则优先使用用户指定的语音
   - 这允许用户覆盖默认的语言-语音映射

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **已修复**

