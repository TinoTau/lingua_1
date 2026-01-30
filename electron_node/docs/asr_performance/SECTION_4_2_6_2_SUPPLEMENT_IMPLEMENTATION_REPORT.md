# §4.2/§6.2 补充建议实施报告

## 文档信息

- **实施日期**: 2026-01-27
- **实施范围**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.test.ts`
- **测试状态**: ✅ 全部通过（新增 2 个测试用例）
- **参考依据**: `AUDIO_AGGREGATOR_TEST_IMPROVEMENTS_SUMMARY.md` §4.2、§6.2

---

## 一、背景与目标

### 1.1 问题背景

根据 `AUDIO_AGGREGATOR_TEST_IMPROVEMENTS_SUMMARY.md` 的分析，虽然逻辑分支错误在测试模型内已基本排除，但文档明确指出：

> **能通过测试 ≠ 找到线上问题**

若线上仍有问题，最大概率落在以下两类（当前测试未覆盖）：
1. **发送层 / 回填映射层**：ASR 真实调用、回调与 job 的映射、结果回填
2. **时序 / 并发交错**：多 job 交错到达、异步回调乱序、并发 finalize

### 1.2 实施目标

在**单测层**补充以下内容：
- ✅ **多 session 交错用例**：验证 buffer 隔离、无串话
- ✅ **多 session 并发用例**：验证并发处理正确性、结果可区分
- ⚠️ **发送层/回填映射层**：需在 集成/E2E 层补充（不在本次单测范围）

---

## 二、实施内容

### 2.1 Debug Snapshot 扩展

**改动位置**: `audio-aggregator.test.ts:58-108`

**改动内容**:
- 扩展 `AsrCallSnapshot` 接口，新增字段：
  - `sessionId?: string` - 用于按 session 区分
  - `jobId?: string` - 用于按 job 区分
  - `action: 'SEND' | 'HOLD'` - 明确操作类型（当前仅记录 SEND）
- 扩展 `recordAsrSnapshot()` 函数签名：
  ```typescript
  function recordAsrSnapshot(
    result: any, 
    meta?: { sessionId: string; jobId: string }
  ): void
  ```
- 支持在交错/并发用例中传入 `meta` 参数，便于按 session 断言

**优势**:
- 不破坏现有测试（`meta` 为可选参数）
- 支持多 session 场景下的结果追踪与断言

### 2.2 createJobAssignMessage 增强

**改动位置**: `audio-aggregator.test.ts:333-355`

**改动内容**:
- 新增可选参数 `options?: { skipMock?: boolean }`
- 当 `skipMock: true` 时，不自动设置 `mockDecodeOpusToPcm16` mock
- 允许测试用例自行控制 decode mock 的调用顺序（用于交错用例）

**使用场景**:
- 交错用例需要按特定顺序返回不同的 decode 结果
- 使用 decode 队列 + `skipMock: true` 实现精确控制

### 2.3 新增测试用例 1：多 session 交错

**用例名称**: `interleaved_sessions_should_not_cross_talk`

**测试场景**:
```
Session A: Job1 (MaxDuration) → 产生 pending
Session B: Job1 (MaxDuration) → 产生 pending
Session A: Job2 (Manual, 不足 MIN) → HOLD
Session B: Job2 (Manual, 不足 MIN) → HOLD
```

**验证点**:
- ✅ 两 session buffer 完全隔离（无串话）
- ✅ 两 session pending 互不影响
- ✅ 无 ASR 发送（两方均为 HOLD）
- ✅ 各自 pending 保持且 duration 增加

**技术实现**:
- 使用 decode 队列机制：`mockDecodeOpusToPcm16.mockImplementation(() => Promise.resolve(decodeQueue.shift()!))`
- 按调用顺序返回对应音频 buffer
- 使用 `createJobAssignMessage(..., { skipMock: true })` 避免 mock 被覆盖

**代码位置**: `audio-aggregator.test.ts:920-1000`

### 2.4 新增测试用例 2：多 session 并发

**用例名称**: `concurrent_sessions_should_complete_without_contamination`

**测试场景**:
```typescript
Promise.all([
  aggregator.processAudioChunk(jobA),  // Session A, 5s 音频
  aggregator.processAudioChunk(jobB)   // Session B, 5s 音频
])
```

**验证点**:
- ✅ 两方均返回 `!shouldReturnEmpty`
- ✅ 两方均有 `audioSegments`（立即发送 ASR）
- ✅ snapshot 中记录 2 次 SEND
- ✅ snapshot 按 `sessionId`/`jobId` 可区分

**技术实现**:
- 使用 `Promise.all` 实现真正的并发调用
- 两 session 使用相同音频 buffer（简化 mock）
- 通过 `recordAsrSnapshot(result, { sessionId, jobId })` 记录 meta 信息
- 验证 snapshot 中两方结果均正确且可区分

**代码位置**: `audio-aggregator.test.ts:1002-1035`

### 2.5 测试清理与文档

**改动内容**:
- 在 `afterEach` 中新增清理：`test-session-interleave-a/b`、`test-session-concurrent-a/b`
- 新增 `describe('§4.2/§6.2 补充：多 session 交错与并发')` 块，明确说明：
  - 发送层/回填映射层需在 集成/E2E 层补充
  - 本文件仅覆盖多 session 交错与并发
  - ASR 回调乱序等仍需 集成/E2E 层验证

---

## 三、测试结果

### 3.1 新增用例执行结果

```
PASS main/src/pipeline-orchestrator/audio-aggregator.test.ts
  AudioAggregator - 集成测试场景
    集成测试场景：MaxDuration finalize修复
      ✓ R0: MaxDuration残段合并后仍不足5s应该继续等待 (272 ms)
      ✓ R1: MaxDuration残段补齐到≥5s应该正常送ASR (236 ms)
      ✓ R2: TTL强制flush应该处理<5s的音频 (193 ms)
      ✓ R3: ASR失败不应触发空核销 (115 ms)
      ✓ R4: 真正无音频才允许empty核销 (2 ms)
      ✓ R5: originalJobIds头部对齐应该可解释 (222 ms)
      ✓ pending_should_persist_across_jobs_when_merge_still_below_min (234 ms)
      ✓ merged_duration_should_equal_pending_plus_incoming_within_tolerance (256 ms)
      ✓ empty_finalize_should_only_happen_when_input_duration_is_zero_and_no_pending (122 ms)
      ✓ multi_job_batch_should_be_explainable_and_must_not_empty_close_non_owner_jobs (284 ms)
      §4.2/§6.2 补充：多 session 交错与并发
        ✓ interleaved_sessions_should_not_cross_talk (549 ms)
        ✓ concurrent_sessions_should_complete_without_contamination (120 ms)

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Time:        ~3.1 s
```

### 3.2 测试覆盖对比

| 测试场景 | 实施前 | 实施后 | 状态 |
|---------|--------|--------|------|
| 逻辑分支错误 | ✅ 已覆盖 | ✅ 已覆盖 | 保持 |
| pending 生命周期 | ✅ 已覆盖 | ✅ 已覆盖 | 保持 |
| mergedDuration 关系 | ✅ 已覆盖 | ✅ 已覆盖 | 保持 |
| 空核销严格性 | ✅ 已覆盖 | ✅ 已覆盖 | 保持 |
| 多 job 归属 | ✅ 已覆盖 | ✅ 已覆盖 | 保持 |
| **多 session 交错** | ❌ 未覆盖 | ✅ **新增** | **新增** |
| **多 session 并发** | ❌ 未覆盖 | ✅ **新增** | **新增** |
| 发送层/回填映射层 | ❌ 未覆盖 | ❌ 未覆盖 | **需 集成/E2E** |
| ASR 回调乱序 | ❌ 未覆盖 | ❌ 未覆盖 | **需 集成/E2E** |

---

## 四、技术细节

### 4.1 交错用例实现机制

**问题**: 交错用例需要按调用顺序返回不同的 decode 结果，但 `createJobAssignMessage` 每次都会覆盖 mock。

**解决方案**:
1. 使用 `mockImplementation` 替代 `mockResolvedValue`：
   ```typescript
   const decodeQueue: Buffer[] = [audioA1, audioB1, audioA2, audioB2];
   mockDecodeOpusToPcm16.mockImplementation(() =>
     Promise.resolve(decodeQueue.shift() ?? Buffer.alloc(0))
   );
   ```
2. 创建 job 时使用 `skipMock: true`：
   ```typescript
   const jobA1 = createJobAssignMessage(..., { skipMock: true });
   ```
3. 按处理顺序 push 音频到队列：
   ```typescript
   decodeQueue.push(audioA2, audioB2); // 在需要时添加
   ```

**优势**:
- 精确控制每次 decode 调用的返回值
- 不依赖 mock 调用次数统计
- 代码清晰，易于维护

### 4.2 并发用例实现机制

**问题**: 需要验证真正的并发调用不会导致状态污染。

**解决方案**:
1. 使用 `Promise.all` 实现并发：
   ```typescript
   const [resultA, resultB] = await Promise.all([
     aggregator.processAudioChunk(jobA),
     aggregator.processAudioChunk(jobB)
   ]);
   ```
2. 使用相同的 mock 返回值（两 session 使用相同音频）：
   ```typescript
   mockDecodeOpusToPcm16.mockResolvedValue(audio5s);
   ```
3. 通过 `meta` 参数区分结果：
   ```typescript
   recordAsrSnapshot(resultA, { sessionId: sessionA, jobId: jobA.job_id });
   recordAsrSnapshot(resultB, { sessionId: sessionB, jobId: jobB.job_id });
   ```

**验证**:
- 两方结果独立正确
- snapshot 中可区分两方的 SEND 记录

---

## 五、仍待补充（不在本次单测范围）

### 5.1 发送层 / 回填映射层

**说明**: 需在**集成或 E2E** 层对 ASR 客户端做**真实 spy**。

**验证点**:
- 送了什么音频给 ASR
- ASR 回调如何映射回 job
- 结果回填是否正确

**当前单测缺口**:
- 仅对 `processAudioChunk` 的**返回值**做快照
- 未 spy 真实 ASR 调用与回调映射

**建议**: 在集成/E2E 测试中补充。

### 5.2 ASR 回调乱序

**说明**: 需验证当 ASR 回调顺序与发送顺序不一致时的处理。

**场景示例**:
- 发送顺序：Segment1 → Segment2 → Segment3
- 回调顺序：Segment2 → Segment1 → Segment3（乱序）

**当前单测缺口**:
- 单测中 ASR 调用是同步的（通过返回值模拟）
- 无法模拟真实的异步回调乱序

**建议**: 在集成/E2E 测试中补充。

### 5.3 同 session 内并发 finalize

**说明**: 需验证同一 session 内多个 job 同时触发 finalize 的情况。

**场景示例**:
- Session A: Job1 和 Job2 几乎同时到达，均触发 finalize

**当前单测缺口**:
- 单测用例均为顺序执行
- 未覆盖同 session 并发场景

**建议**: 在集成/E2E 测试中补充。

---

## 六、代码变更统计

### 6.1 新增代码

- **Debug Snapshot 扩展**: 约 15 行（接口扩展 + 函数签名更新）
- **createJobAssignMessage 增强**: 约 3 行（skipMock 选项）
- **交错用例**: 约 80 行
- **并发用例**: 约 35 行
- **describe 块与说明**: 约 10 行
- **afterEach 清理**: 约 4 行
- **总计**: 约 147 行

### 6.2 修改代码

- **现有测试用例**: 无修改（向后兼容）

### 6.3 代码质量

- ✅ 向后兼容（现有测试无需修改）
- ✅ 代码清晰，注释完整
- ✅ 测试隔离良好（afterEach 清理）

---

## 七、验收标准

### 7.1 功能验收

- ✅ **多 session 交错**: 验证 buffer 隔离、无串话、无 ASR 误送
- ✅ **多 session 并发**: 验证各自结果正确、snapshot 可区分
- ✅ **向后兼容**: 所有现有测试用例通过（12/12）

### 7.2 代码质量验收

- ✅ 新增代码通过 TypeScript 编译
- ✅ 所有测试用例通过
- ✅ 代码注释清晰，说明完整

### 7.3 文档验收

- ✅ 测试用例有清晰的 describe 块说明
- ✅ 明确标注仍待补充的部分（发送层/回填映射层、ASR 回调乱序等）

---

## 八、总结与建议

### 8.1 完成情况

✅ **单测层补充完成**:
- 多 session 交错用例：已实现并验证通过
- 多 session 并发用例：已实现并验证通过
- Debug Snapshot 扩展：已实现，支持按 session 区分

### 8.2 仍待补充（需决策）

⚠️ **集成/E2E 层补充**（不在本次单测范围）:
1. **发送层 / 回填映射层**：真实 spy ASR 调用与回调映射
2. **ASR 回调乱序**：验证乱序回调的处理
3. **同 session 内并发 finalize**：验证并发 finalize 的处理

### 8.3 建议行动

1. **✅ 批准合并**: 建议批准本次单测层补充合并到主分支
   - 所有测试通过，无业务逻辑风险
   - 向后兼容，不影响现有测试
   - 提升了测试覆盖度（多 session 场景）

2. **📋 后续计划**（需决策部门评估优先级）:
   - **高优先级**: 发送层/回填映射层的集成/E2E 测试
   - **中优先级**: ASR 回调乱序的集成/E2E 测试
   - **低优先级**: 同 session 内并发 finalize 的集成/E2E 测试

3. **📋 可选优化**:
   - 提取测试工具函数到独立文件（`createMockPcm16Audio` 等）
   - 添加更多边界情况测试

---

## 九、附录

### 9.1 相关文档

- `AUDIO_AGGREGATOR_TEST_IMPROVEMENTS_SUMMARY.md` - 完整测试改进总结
- `AUDIO_AGGREGATOR_TEST_ONLY_MIN_PATCHLIST_AND_REGRESSION_CHECKLIST.md` - 原始改进清单
- `R0_R1_TEST_ONLY_MIN_PATCHLIST_AND_REGRESSION_CHECKLIST.md` - R0/R1 修复清单

### 9.2 测试文件位置

- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.test.ts`

### 9.3 关键代码片段

**交错用例核心逻辑**:
```typescript
const decodeQueue: Buffer[] = [audioA1, audioB1];
mockDecodeOpusToPcm16.mockImplementation(() =>
  Promise.resolve(decodeQueue.shift() ?? Buffer.alloc(0))
);

const jobA1 = createJobAssignMessage(..., { skipMock: true });
const jobB1 = createJobAssignMessage(..., { skipMock: true });

await aggregator.processAudioChunk(jobA1);
await aggregator.processAudioChunk(jobB1);

decodeQueue.push(audioA2, audioB2);
// ... 继续处理
```

**并发用例核心逻辑**:
```typescript
const [resultA, resultB] = await Promise.all([
  aggregator.processAudioChunk(jobA),
  aggregator.processAudioChunk(jobB)
]);

recordAsrSnapshot(resultA, { sessionId: sessionA, jobId: jobA.job_id });
recordAsrSnapshot(resultB, { sessionId: sessionB, jobId: jobB.job_id });
```

---

## 文档版本

- **版本**: v1.0
- **最后更新**: 2026-01-27
- **作者**: AI Assistant (Auto)
- **审核状态**: 待决策部门审核
