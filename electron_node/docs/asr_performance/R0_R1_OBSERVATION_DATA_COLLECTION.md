# R0/R1 观测数据收集报告

## 执行时间
2026-01-26

## 问题状态
- **R0/R1 测试状态**: ❌ 仍然失败
- **观测数据状态**: ⚠️ 部分获取（T1观测数据已添加，但需要运行测试获取）

## 已实施的观测数据收集方案

### 方案1: 修复 logger mock（已实施）
- 修改了 `__mocks__/logger.ts`，确保包含 `testCase: 'R0/R1'` 或 `[T1]`/`[T2]`/`[T3]` 标记的日志能输出
- 使用 `console.error` 输出，确保不被 Jest 过滤

### 方案2: 在测试代码中直接输出观测数据（已实施）
- 在 R0 和 R1 测试的 Job1 处理完成后，直接访问 `aggregator.buffers` 获取内部状态
- 使用 `console.error('[T1_OBSERVATION]', ...)` 输出，确保能被捕获

**实施位置**：
- `audio-aggregator.test.ts:210-227` (R0)
- `audio-aggregator.test.ts:262-279` (R1)

**观测数据内容**：
- `testCase`: 'R0' 或 'R1'
- `jobId`: Job1 的 job_id
- `sessionId`: 会话ID
- `pendingExists`: pendingMaxDurationAudio 是否存在
- `pendingDurationMs`: pending 音频时长（毫秒）
- `pendingBufferBytes`: pending 音频字节数

## 需要获取的观测数据

### T1: Job1 MaxDuration finalize 后 pending 状态
**问题**: Q1 - Job1 后 pending 是否存在？pendingDurationMs 是多少？

**获取方式**：
1. 运行测试：`npm test -- audio-aggregator.test.ts -t "R0|R1"`
2. 查找输出中的 `[T1_OBSERVATION]` 标记
3. 提取 JSON 数据中的 `pendingExists` 和 `pendingDurationMs`

### T2: mergePendingMaxDurationAudio 调用和 mergedDurationMs
**问题**: Q2 - merge 是否被调用？mergedDurationMs 真实值是多少？

**获取方式**：
1. 查找输出中的 `[TEST_LOG]` 标记（来自 logger mock）
2. 查找包含 `[T2]` 的日志
3. 提取 `hasPending`、`pendingDurationMs`、`incomingDurationMs`、`mergedDurationMs`

### T3: reason 传递链
**问题**: Q3 - reason 在 merge → finalize → return 三段是否一致？

**获取方式**：
1. 查找输出中的 `[TEST_LOG]` 标记
2. 查找包含 `[T3(1)]`、`[T3(2)]`、`[T3(3)]` 的日志
3. 提取 `mergeResultReason`、`finalizeResultReason`、`returnReason`

## 当前状态

### 已完成的改进
1. ✅ 修复了 logger mock，确保日志能输出
2. ✅ 在测试代码中添加了直接观测数据输出（T1）
3. ✅ 使用 `console.error` 确保输出不被过滤

### 待执行
1. ⏳ 运行测试并提取观测数据
2. ⏳ 根据观测数据回答 Q1-Q3
3. ⏳ 精确归类问题并实施修复

## 运行测试获取观测数据

### 命令
```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm test -- audio-aggregator.test.ts -t "R0|R1" 2>&1 | Select-String -Pattern "T1_OBSERVATION|TEST_LOG" | Out-File observation-data.log
```

### 预期输出格式
```json
[T1_OBSERVATION] {
  "testCase": "R0",
  "jobId": "job-maxdur-1",
  "sessionId": "test-session-integration-r0",
  "pendingExists": true/false,
  "pendingDurationMs": 2000,
  "pendingBufferBytes": 64000
}

[TEST_LOG] {
  "context": {
    "testCase": "R0/R1",
    "jobId": "...",
    "pendingExists": true/false,
    "pendingDurationMs": 2000,
    ...
  },
  "message": "AudioAggregator: [T1] Job1 MaxDuration finalize 后 pending 状态"
}
```

## 下一步行动

1. **立即执行**：运行测试命令，提取观测数据
2. **分析数据**：根据观测数据回答 Q1-Q3 三个问题
3. **问题归类**：根据答案精确归类问题类型
4. **实施修复**：根据问题类型实施对应的最小修复

## 相关文件

- `electron_node/electron-node/__mocks__/logger.ts` (logger mock 配置)
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.test.ts` (测试代码，包含 T1 观测数据输出)
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` (包含 T1 和 T3(3) 日志)
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-finalize-handler.ts` (包含 T2 和 T3(1)、T3(2) 日志)
