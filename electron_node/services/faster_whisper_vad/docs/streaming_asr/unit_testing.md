# 节点端流式 ASR 优化单元测试说明

**日期**: 2026-01-24  
**测试文件**: 
- `audio-aggregator-optimization.test.ts`
- `original-job-result-dispatcher-optimization.test.ts`

---

## 一、测试覆盖场景

### 1. AudioAggregator 优化功能测试

#### 场景1：短音频（手动 finalize）
- ✅ 正确处理短音频（<5秒）的手动 finalize
- ✅ 验证音频完整性
- ✅ 验证 bufferKey 稳定性

#### 场景2：长音频（timeout finalize）
- ✅ 正确处理 timeout finalize 并缓存短音频
- ✅ 合并 pendingTimeoutAudio 到下一个 job
- ✅ 处理 utteranceIndex 超界情况（差值>2）

#### 场景3：超长音频（MaxDuration finalize）
- ✅ 正确处理 MaxDuration finalize：处理前5秒，缓存剩余部分
- ✅ 正确处理连续的 MaxDuration finalize job
- ✅ 使用头部对齐策略为每个 batch 分配 originalJobId
- ✅ 正确处理 MaxDuration 序列的最后一个手动/timeout finalize

#### bufferKey 稳定性测试
- ✅ 为同一 session 生成稳定的 bufferKey
- ✅ 为不同 session 生成不同的 bufferKey
- ✅ 在 buffer 处于 FINALIZING 状态时切换到新 epoch

#### 状态机转换测试
- ✅ OPEN → FINALIZING → CLOSED
- ✅ OPEN → PENDING_TIMEOUT
- ✅ OPEN → PENDING_MAXDUR

### 2. OriginalJobResultDispatcher 优化功能测试

#### expectedSegmentCount 一致性
- ✅ 强制使用明确的 expectedSegmentCount（不允许 undefined）
- ✅ 正确计算 receivedCount 和 missingCount

#### Registration TTL 兜底机制
- ✅ 在 TTL 超时时强制 finalize partial
- ✅ 在正常完成时清除 TTL 定时器

#### ASR 失败 segment 的核销策略
- ✅ 正确处理 missing segment 并计入 receivedCount
- ✅ 允许所有 segment 都是 missing 的情况

#### 按 batchIndex 排序
- ✅ 按 batchIndex 排序合并文本

---

## 二、Mock 音频生成

### createMockPcm16Audio(durationMs: number, options?)

生成模拟的 PCM16 音频数据（带能量波动，可被切分）：

```typescript
function createMockPcm16Audio(
  durationMs: number,
  options: {
    withEnergyVariation?: boolean;  // 是否包含明显的能量波动（默认 true）
    silenceRatio?: number;           // 静音段占比（0-1，默认 0.2，即20%静音）
    baseFreq?: number;               // 基础频率（Hz，默认 440）
  } = {}
): Buffer
```

**特性**:
- ✅ **能量波动**：模拟真实语音的能量变化（高能量段和低能量段交替）
- ✅ **静音段**：包含静音段（接近零值，添加少量噪声模拟环境音）
- ✅ **能量包络**：模拟说话的开始、中间、结束（开始和结束能量较低）
- ✅ **振幅调制**：模拟不同音量的变化
- ✅ **可被切分**：能量波动明显，能够被能量切分算法正确识别和切分

**参数**:
- `durationMs`: 音频时长（毫秒）
- `options.withEnergyVariation`: 是否包含明显的能量波动（默认 `true`）
- `options.silenceRatio`: 静音段占比（0-1，默认 `0.2`，即20%静音）
- `options.baseFreq`: 基础频率（Hz，默认 `440`）

**返回**: PCM16 Buffer

**示例**:
- 短音频：`createMockPcm16Audio(3000)` - 3秒，带能量波动
- 长音频：`createMockPcm16Audio(12000)` - 12秒，带能量波动
- 超长音频：`createMockPcm16Audio(35000)` - 35秒，带能量波动
- 无能量波动：`createMockPcm16Audio(5000, { withEnergyVariation: false })` - 5秒，均匀能量
- 高静音比：`createMockPcm16Audio(5000, { silenceRatio: 0.5 })` - 5秒，50%静音

---

## 三、测试用例示例

### 示例1：短音频手动 finalize

```typescript
it('应该正确处理短音频（<5秒）的手动 finalize', async () => {
  const audio = createMockPcm16Audio(3000); // 3秒短音频
  const job = createJobAssignMessage('job-1', 'test-session-1', 0, audio, {
    is_manual_cut: true,
  });

  const result = await aggregator.processAudioChunk(job);
  
  expect(result).not.toBeNull();
  expect(result.shouldReturnEmpty).toBe(false);
  expect(result.audioSegments.length).toBeGreaterThan(0);
  
  // 验证音频完整性
  const totalLength = result.audioSegments.reduce(
    (sum, seg) => sum + Buffer.from(seg, 'base64').length,
    0
  );
  expect(totalLength).toBe(audio.length);
});
```

### 示例2：timeout finalize 合并

```typescript
it('应该合并 pendingTimeoutAudio 到下一个 job', async () => {
  // 第一个 job：timeout finalize，短音频被缓存
  const audio1 = createMockPcm16Audio(800); // 0.8秒短音频（<1秒阈值）
  const job1 = createJobAssignMessage('job-1', 'test-session-1', 0, audio1, {
    is_timeout_triggered: true,
  });
  await aggregator.processAudioChunk(job1);

  // 第二个 job：手动 finalize，应该合并 pendingTimeoutAudio
  const audio2 = createMockPcm16Audio(5000);
  const job2 = createJobAssignMessage('job-2', 'test-session-1', 1, audio2, {
    is_manual_cut: true,
  });
  const result2 = await aggregator.processAudioChunk(job2);
  
  expect(result2).not.toBeNull();
  expect(result2.shouldReturnEmpty).toBe(false);
  
  // 验证合并后的音频长度
  const totalLength = result2.audioSegments.reduce(
    (sum, seg) => sum + Buffer.from(seg, 'base64').length,
    0
  );
  expect(totalLength).toBeGreaterThan(audio1.length);
});
```

### 示例3：MaxDuration finalize

```typescript
it('应该正确处理 MaxDuration finalize：处理前5秒，缓存剩余部分', async () => {
  const audio = createMockPcm16Audio(6000); // 6秒音频
  const job = createJobAssignMessage('job-1', 'test-session-1', 0, audio, {
    is_max_duration_triggered: true,
  });

  const result = await aggregator.processAudioChunk(job);
  
  expect(result).not.toBeNull();
  expect(result.shouldReturnEmpty).toBe(false);
  
  // 验证处理的部分（应该 >= 5秒）
  const processedLength = result.audioSegments.reduce(
    (sum, seg) => sum + Buffer.from(seg, 'base64').length,
    0
  );
  const processedDurationMs = (processedLength / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  expect(processedDurationMs).toBeGreaterThanOrEqual(5000);
  
  // 验证有剩余音频被缓存（如果有）
  const status = aggregator.getBufferStatus('test-session-1');
  if (status?.hasPendingMaxDurationAudio) {
    expect(status.hasPendingMaxDurationAudio).toBe(true);
  }
});
```

---

## 四、运行测试

### 运行所有优化测试

```bash
cd electron_node/electron-node/main
npm test -- audio-aggregator-optimization.test.ts
npm test -- original-job-result-dispatcher-optimization.test.ts
```

### 运行特定测试用例

```bash
npm test -- audio-aggregator-optimization.test.ts -t "短音频"
npm test -- audio-aggregator-optimization.test.ts -t "MaxDuration"
```

### 查看测试覆盖率

```bash
npm test -- --coverage audio-aggregator-optimization.test.ts
```

---

## 五、测试验证点

### AudioAggregator 测试验证点

1. **bufferKey 稳定性**
   - ✅ 同一 session 的 bufferKey 保持一致
   - ✅ 不同 session 的 bufferKey 不同
   - ✅ epoch 正确递增

2. **状态机转换**
   - ✅ OPEN → FINALIZING → CLOSED
   - ✅ OPEN → PENDING_TIMEOUT
   - ✅ OPEN → PENDING_MAXDUR

3. **音频处理完整性**
   - ✅ 短音频手动 finalize 不丢失
   - ✅ timeout finalize 短音频被缓存（<1秒）
   - ✅ MaxDuration finalize 前5秒被处理，剩余部分被缓存

4. **头部对齐策略**
   - ✅ 每个 batch 使用其第一个音频片段所属的 job 容器
   - ✅ MaxDuration/Manual/Timeout 行为一致

5. **utteranceIndex 超界处理**
   - ✅ 差值>2时强制 finalize pending（丢弃 pending，不合并）

### OriginalJobResultDispatcher 测试验证点

1. **expectedSegmentCount 一致性**
   - ✅ 强制使用明确的 expectedSegmentCount
   - ✅ 正确计算 receivedCount 和 missingCount

2. **TTL 兜底机制**
   - ✅ 10秒超时强制 finalize partial
   - ✅ 正常完成时清除 TTL 定时器

3. **ASR 失败核销**
   - ✅ missing segment 计入 receivedCount
   - ✅ missing segment 文本被跳过

4. **排序和合并**
   - ✅ 按 batchIndex 排序合并文本

---

## 六、测试数据

### 测试音频时长

- **短音频**: 1-5秒（用于测试手动 finalize 和 timeout finalize 缓存）
- **长音频**: 5-15秒（用于测试流式切分）
- **超长音频**: 15-35秒（用于测试 MaxDuration finalize）

### 测试 utteranceIndex

- **连续**: 0, 1, 2（正常合并）
- **超界**: 0, 5（差值>2，丢弃 pending）

---

## 七、注意事项

1. **Mock 音频生成**：使用正弦波生成模拟音频，不包含真实的语音特征
2. **时间控制**：使用 `jest.useFakeTimers()` 控制 TTL 测试
3. **状态清理**：每个测试后清理 buffer，确保测试隔离
4. **误差容忍**：音频长度验证允许小的误差（流式切分可能导致长度差异）

---

## 八、后续扩展

### 建议添加的测试场景

1. **多 session 并发测试**
   - 多个 session 同时处理音频
   - 验证 bufferKey 隔离

2. **异常场景测试**
   - ASR 服务完全失败
   - 网络超时
   - 内存不足

3. **性能测试**
   - 大量并发请求
   - 长时间运行稳定性

4. **集成测试**
   - 端到端流程测试
   - 真实音频文件测试
