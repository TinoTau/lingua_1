# Job1和Job2丢失问题 - 修复实现

**日期**: 2026-01-28  
**状态**: ✅ Job1问题已修复，Job2问题需要进一步调查

---

## 一、修复内容

### 1.1 Job1的问题修复

**问题**: 有pendingMaxDurationAudio时，即使所有batch都已收到，也不触发回调

**修复方案**: 移除`hasPendingMaxDurationAudio`的检查

**修改文件**: `original-job-result-dispatcher.ts`

**修改位置**: 第391-406行

**修改前**:
```typescript
if (shouldProcess) {
  // ✅ 如果有 pendingMaxDurationAudio，不立即 finalize，等待 TTL 或后续 batch
  if (registration.hasPendingMaxDurationAudio) {
    logger.info(
      {
        sessionId,
        originalJobId,
        receivedCount: registration.receivedCount,
        expectedSegmentCount: registration.expectedSegmentCount,
        reason: 'Has pendingMaxDurationAudio, waiting for TTL or subsequent batches',
      },
      'OriginalJobResultDispatcher: Waiting for pendingMaxDurationAudio (TTL or subsequent batches)'
    );
    // 不 finalize，继续等待 TTL 超时或后续 batch
    return false;  // ❌ 阻止了已经收到的batch的处理
  }
  // ... 处理逻辑
}
```

**修改后**:
```typescript
if (shouldProcess) {
  // ✅ 架构设计：如果所有batch都已经收到，立即处理
  // pendingMaxDurationAudio只影响后续的batch，不应该影响当前已经收到的batch的处理
  // 如果所有batch都已收到，应该立即处理，不需要等待pending音频
  
  // ✅ 清除 TTL 定时器
  // ... 处理逻辑
}
```

**设计原则**:
- 如果所有batch都已经收到（`receivedCount >= expectedSegmentCount`），立即处理
- `hasPendingMaxDurationAudio`只用于标记，不应该阻止已经收到的batch的处理
- 这样逻辑更简单，不需要特殊处理pendingMaxDurationAudio的情况

### 1.2 Job2的问题

**问题**: 合并pending音频后，ASR结果不完整

**状态**: ⚠️ 需要进一步调查

**可能原因**:
1. pending音频 (940ms) 太短，ASR服务可能没有正确识别
2. 合并后的音频在ASR服务中被截断
3. ASR服务只识别了音频的后半部分（当前音频的部分）

**需要检查**:
- 合并后的音频 (2760ms) 是否完整发送到ASR服务
- ASR服务是否返回了完整的识别结果
- 是否有音频质量问题

**暂时不修复**:
- 需要先确认ASR服务是否正确识别了合并后的音频
- 如果ASR服务识别正确，问题可能在音频合并或发送过程中
- 如果ASR服务识别不正确，可能是ASR服务的问题，不是代码逻辑问题

---

## 二、修复效果

### 2.1 Job1的修复效果

**修复前**:
- Job1有2个batch，都已经收到
- 但是有pendingMaxDurationAudio，不触发回调
- 导致`ctx.asrText`为空，发送了空结果 ❌

**修复后**:
- Job1有2个batch，都已经收到
- 即使有pendingMaxDurationAudio，也会立即处理 ✅
- `ctx.asrText`会被正确设置，不会发送空结果 ✅

### 2.2 Job2的问题

**状态**: ⚠️ 需要进一步调查ASR服务的识别结果

---

## 三、代码变更

### 3.1 修改文件

**文件**: `original-job-result-dispatcher.ts`

**修改**: 移除`hasPendingMaxDurationAudio`的检查

**影响**:
- 如果所有batch都已经收到，立即处理，不受pendingMaxDurationAudio影响
- 逻辑更简单，不需要特殊处理pendingMaxDurationAudio的情况

---

## 四、测试验证

### 4.1 需要测试的场景

**场景1**: Job1在有pendingMaxDurationAudio时，所有batch都已收到
- ✅ 应该立即处理，不会发送空结果

**场景2**: 后续batch到达时，应该正确追加并处理
- ✅ 行为不变，后续batch到达时会追加并处理

**场景3**: TTL超时时，应该正确处理已累积的batch
- ✅ 行为不变，TTL超时仍然会处理已累积的batch

---

*修复方案遵循简洁的架构设计原则，不新增不必要的流程路径。*
