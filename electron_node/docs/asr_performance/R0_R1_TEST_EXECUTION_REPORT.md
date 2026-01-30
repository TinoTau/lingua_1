# R0 和 R1 测试执行报告

## 执行时间
2026-01-26

## 测试执行结果

### 测试状态概览
```
Test Suites: 1 failed, 1 total
Tests:       2 failed, 4 passed, 6 total
```

### 失败测试详情

#### R0: MaxDuration残段合并后仍不足5s应该继续等待
- **状态**: ❌ 失败
- **失败断言**: `expect(result2.shouldReturnEmpty).toBe(true)`
- **期望值**: `true`
- **实际值**: `false`
- **执行时间**: 191ms

#### R1: MaxDuration残段补齐到≥5s应该正常送ASR
- **状态**: ❌ 失败
- **失败断言**: `expect(result2.reason).toBe('NORMAL_MERGE')`
- **期望值**: `'NORMAL_MERGE'`
- **实际值**: `'NORMAL'`
- **执行时间**: 239ms

### 通过测试
- ✅ R2: TTL强制flush应该处理<5s的音频 (195ms)
- ✅ R3: ASR失败不应触发空核销毁 (113ms)
- ✅ R4: 真正无音频才允许empty清销 (2ms)
- ✅ R5: originalJobIds头部对齐应该可解析 (225ms)

## 排查任务执行情况

### ✅ T0: 冻结一次失败样例（可复现性）
- [x] 测试用例输入参数已固定：
  - R0: Job1 7秒音频，Job2 2秒音频
  - R1: Job1 8.58秒音频，Job2 4秒音频
- [x] sessionId 和 jobId 已固定
- [x] 测试可稳定复现失败

### ⚠️ T1-T3: 日志输出问题

**问题描述**：
虽然已按照决策部门的排查任务清单完成了 T1-T3 的日志添加，但在测试执行过程中，日志未能正常输出到控制台。

**可能原因**：
1. Jest 测试环境中的 logger mock 可能拦截了日志输出
2. 日志输出可能被 Jest 的默认输出过滤机制屏蔽
3. 需要额外的配置才能让测试中的 console.log 正常输出

**已添加的日志点**：
- ✅ T1: `audio-aggregator.ts:418-435` - Job1 MaxDuration finalize 后 pending 状态检查
- ✅ T2: `audio-aggregator-finalize-handler.ts:279-298` - mergePendingMaxDurationAudio 入口
- ✅ T2: `audio-aggregator-finalize-handler.ts:370-384` - 合并后时长计算
- ✅ T3(1): `audio-aggregator-finalize-handler.ts:383-395` - mergePendingMaxDurationAudio 出口 (PENDING_MAXDUR_HOLD)
- ✅ T3(1): `audio-aggregator-finalize-handler.ts:425-437` - mergePendingMaxDurationAudio 出口 (NORMAL_MERGE)
- ✅ T3(2): `audio-aggregator-finalize-handler.ts:127-140` - handleFinalize 出口 (shouldMerge === true)
- ✅ T3(2): `audio-aggregator-finalize-handler.ts:152-165` - handleFinalize 出口 (PENDING_MAXDUR_HOLD)
- ✅ T3(2): `audio-aggregator-finalize-handler.ts:216-229` - handleFinalize 出口 (最终返回)
- ✅ T3(3): `audio-aggregator.ts:509-522` - audio-aggregator.ts 最终返回前 (shouldHoldPendingMaxDur === true)
- ✅ T3(3): `audio-aggregator.ts:770-783` - audio-aggregator.ts 最终返回前 (正常处理)

## 基于代码逻辑的分析

由于无法直接获取 T1-T3 的日志输出，基于测试失败结果和代码逻辑进行以下分析：

### R0 失败分析

**测试场景**：
1. Job1: MaxDuration finalize，7秒音频
2. Job2: Manual finalize，2秒音频
3. **期望**：合并后约4秒（<5秒），应该返回 `shouldReturnEmpty: true, reason: 'PENDING_MAXDUR_HOLD'`
4. **实际**：返回 `shouldReturnEmpty: false`

**可能原因**：

1. **假设1：pendingMaxDurationAudio 不存在**
   - 如果 Job1 的 MaxDuration finalize 后，剩余音频部分 >= 5秒，则不会被缓存到 `pendingMaxDurationAudio`
   - 7秒音频处理后，如果剩余部分 >= 5秒，就不会产生 pending
   - 这会导致 Job2 处理时，`mergePendingMaxDurationAudio` 不会被调用
   - 最终返回 `shouldReturnEmpty: false`（因为没有 pending 需要等待）

2. **假设2：mergedDurationMs 计算错误**
   - 如果 `mergePendingMaxDurationAudio` 被调用，但 `mergedDurationMs` 实际 >= 5000ms
   - 这会导致返回 `shouldMerge: true, reason: 'NORMAL_MERGE'`
   - 最终返回 `shouldReturnEmpty: false`

3. **假设3：reason 传递链断裂**
   - 如果 `mergePendingMaxDurationAudio` 返回 `shouldMerge: false, reason: 'PENDING_MAXDUR_HOLD'`
   - 但 `handleFinalize` 没有正确传递 `shouldHoldPendingMaxDur: true`
   - 或者 `audio-aggregator.ts` 没有正确处理 `shouldHoldPendingMaxDur`

### R1 失败分析

**测试场景**：
1. Job1: MaxDuration finalize，8.58秒音频
2. Job2: Manual finalize，4秒音频
3. **期望**：合并后约7.58秒（≥5秒），应该返回 `shouldReturnEmpty: false, reason: 'NORMAL_MERGE'`
4. **实际**：返回 `shouldReturnEmpty: false, reason: 'NORMAL'`

**可能原因**：

1. **假设1：mergePendingMaxDurationAudio 没有被调用**
   - 如果 `pendingMaxDurationAudio` 不存在，`handleFinalize` 会继续处理
   - 最终返回 `reason: undefined`，导致 `audio-aggregator.ts` 设置 `reason = 'NORMAL'`

2. **假设2：reason 传递链断裂**
   - 如果 `mergePendingMaxDurationAudio` 返回 `shouldMerge: true, reason: 'NORMAL_MERGE'`
   - 但 `handleFinalize` 没有正确传递 `reason: 'NORMAL_MERGE'`
   - 或者 `audio-aggregator.ts` 的 reason 赋值逻辑有问题

3. **假设3：mergedDurationMs 计算错误**
   - 如果合并后的音频时长实际 < 5秒，会返回 `shouldMerge: false, reason: 'PENDING_MAXDUR_HOLD'`
   - 但测试期望的是 `NORMAL_MERGE`，说明合并后的时长可能不符合预期

## 需要决策的问题

### 问题1：如何获取 T1-T3 的日志输出？

**选项A**：修改测试配置，确保 logger 的 console.log 能正常输出
- 修改 `__mocks__/logger.ts`，确保日志能输出到控制台
- 或者使用 Jest 的 `--verbose` 选项

**选项B**：使用调试器
- 在关键位置设置断点
- 使用调试器运行测试，直接查看变量值

**选项C**：添加测试断言
- 在测试代码中直接访问内部状态
- 添加断言来验证关键变量的值

### 问题2：基于当前信息，优先排查哪个假设？

**建议优先级**：
1. **优先排查假设1（pendingMaxDurationAudio 不存在）**
   - 这是最可能的原因，因为两个测试都失败，且都与 pending 相关
   - 需要确认 MaxDuration finalize 后，剩余音频是否真的 < 5秒

2. **其次排查假设2（reason 传递链断裂）**
   - R1 的失败明确指向 reason 传递问题
   - 需要检查 `handleFinalize` 和 `audio-aggregator.ts` 的 reason 传递逻辑

3. **最后排查假设3（mergedDurationMs 计算错误）**
   - 需要实际运行并查看日志才能确认

## 建议的下一步行动

### 立即行动（必须）
1. **解决日志输出问题**
   - 修改测试配置或 logger mock，确保 T1-T3 日志能正常输出
   - 或者使用调试器直接查看关键变量

2. **回答 Q1-Q3 三个问题**
   - Q1：Job1 后 pending 是否存在？pendingDurationMs 是多少？
   - Q2：merge 是否被调用？mergedDurationMs 真实值是多少？
   - Q3：reason 在 merge → finalize → return 三段是否一致？在哪一段丢失/被覆盖？

### 短期行动
1. 根据日志结果，精确归类问题
2. 实施对应的最小修复

### 长期行动
1. 考虑改进测试环境的日志输出机制
2. 添加更多的集成测试，覆盖边界情况

## 相关文件

- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.test.ts` (R0, R1 测试用例)
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-finalize-handler.ts` (handleFinalize, mergePendingMaxDurationAudio)
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` (processAudioChunk)
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-maxduration-handler.ts` (handleMaxDurationFinalize)
- `electron_node/electron-node/__mocks__/logger.ts` (logger mock 配置)

## 观测数据收集改进（2026-01-26 更新）

### 已实施的改进
1. ✅ **修复 logger mock**：确保包含 `testCase: 'R0/R1'` 或 `[T1]`/`[T2]`/`[T3]` 标记的日志能通过 `console.error` 输出
2. ✅ **在测试代码中直接输出 T1 观测数据**：绕过 logger mock，直接访问 `aggregator.buffers` 获取内部状态
3. ✅ **使用 console.error 确保输出不被过滤**：Jest 不会过滤 `console.error` 输出

### 观测数据获取方式
运行测试后，查找输出中的：
- `[T1_OBSERVATION]` - 来自测试代码的直接观测（T1 数据）
- `[TEST_LOG]` - 来自 logger mock 的日志（T1-T3 数据）

**详细说明请参考**：`R0_R1_OBSERVATION_DATA_COLLECTION.md`

## 结论

虽然已按照决策部门的排查任务清单完成了 T1-T3 的日志添加，但由于测试环境的限制，日志未能正常输出。**已实施改进措施**：

1. ✅ 修复了 logger mock，确保日志能输出
2. ✅ 在测试代码中添加了直接观测数据输出（T1）
3. ✅ 使用 `console.error` 确保输出不被过滤

**下一步**：运行测试并提取观测数据，根据数据回答 Q1-Q3 三个问题，精确归类问题并实施对应的最小修复。

**详细观测数据收集方案请参考**：`R0_R1_OBSERVATION_DATA_COLLECTION.md`
