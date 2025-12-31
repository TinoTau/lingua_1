# TTS 强制使用 Opus 格式修复

## 修复内容

### 1. 移除回退机制

**问题**: 之前的实现允许在 Opus 编码失败时回退到 PCM16 格式。

**修复**: 
- 移除所有回退到 PCM16 的逻辑
- 如果 Opus 编码失败，直接抛出错误
- 如果 Opus 编码器不可用，直接抛出错误

### 2. 强制使用 Opus 格式

**修改位置**:

1. **`TaskRouter.routeTTSTask()`**:
   - 移除回退到 PCM16 的逻辑
   - 如果 Opus 编码器不可用，抛出错误
   - 如果 Opus 编码失败，抛出错误（不再回退）

2. **`TTSStage.process()`**:
   - 所有返回的 `ttsFormat` 都强制为 `'opus'`
   - 如果 `TaskRouter` 返回非 Opus 格式，抛出错误

3. **`PostProcessCoordinator`**:
   - 默认 `ttsFormat` 从 `'pcm16'` 改为 `'opus'`

4. **`NodeAgent`**:
   - 所有默认 `tts_format` 从 `'pcm16'` 改为 `'opus'`

5. **`opus-encoder.ts`**:
   - 移除环境变量 `OPUS_ENCODING_ENABLED` 的检查
   - Opus 编码是必需的，不再允许禁用

### 3. 依赖库确认

**Web 端**: 使用 `@minceraftmc/opus-encoder` (版本 `^0.0.7-rc.1`)

**节点端**: 使用 `@minceraftmc/opus-encoder` (与 Web 端一致)

✅ **确认**: 两端使用相同的 Opus 编码库。

## 错误处理

### Opus 编码器不可用

```typescript
if (!isOpusEncoderAvailable()) {
  throw new Error(`Opus encoder is not available. TTS must use Opus format.`);
}
```

### Opus 编码失败

```typescript
catch (opusError) {
  throw new Error(`Opus encoding failed: ${opusError.message}. TTS must use Opus format.`);
}
```

### TaskRouter 返回非 Opus 格式

```typescript
if (!audioFormat || audioFormat !== 'opus') {
  throw new Error(`TTS must use Opus format, but TaskRouter returned: ${audioFormat}`);
}
```

## 验证方法

1. **检查日志**:
   - 搜索 `TTS audio encoded to Opus successfully` - 确认 Opus 编码成功
   - 搜索 `Opus encoder is not available` - 确认没有编码器不可用的错误
   - 搜索 `Opus encoding failed` - 确认没有编码失败的错误

2. **检查返回格式**:
   - 所有 `tts_format` 字段都应该是 `'opus'`
   - 不应该出现 `'pcm16'` 格式

3. **检查错误**:
   - 如果出现 Opus 编码相关的错误，应该立即抛出，而不是回退到 PCM16

## 总结

✅ **已修复**: 
- 移除所有回退到 PCM16 的逻辑
- 强制使用 Opus 格式
- 确认使用与 Web 端相同的 Opus 编码库 (`@minceraftmc/opus-encoder`)
- 所有默认格式都改为 `'opus'`
- 添加严格的格式验证和错误处理

现在 TTS 必须使用 Opus 格式，不再允许回退到 PCM16。

