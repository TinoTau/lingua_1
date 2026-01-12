# Aggregator Session 隔离验证

**日期**：2025-01-XX  
**问题**：节点端收到的 utterance 可能来自不同的 session，需要确认 Aggregator 是否正确根据 session_id 进行区分

---

## 问题描述

用户担心：调度服务器可能将多个 web 端的任务打散后发送到同一个节点，这些任务可能来自不同的 session。需要确认 Aggregator 是否正确根据 `session_id` 进行区分。

---

## 实现验证

### 1. AggregatorManager 实现

**文件**：`electron_node/electron-node/main/src/aggregator/aggregator-manager.ts`

**实现方式**：
- 使用 `Map<string, AggregatorState>` 存储不同 session 的状态
- Key 是 `sessionId`，Value 是 `AggregatorState`
- 每个 session 都有独立的状态管理

**关键代码**：
```typescript
export class AggregatorManager {
  private states: Map<string, AggregatorState> = new Map();
  private lastAccessTime: Map<string, number> = new Map();

  getOrCreateState(
    sessionId: string,
    mode: Mode = 'offline',
    tuning?: AggregatorTuning
  ): AggregatorState {
    let state = this.states.get(sessionId);
    
    if (!state) {
      // 检查是否超过最大会话数
      if (this.states.size >= this.config.maxSessions) {
        this.evictLRU();
      }
      
      state = new AggregatorState(sessionId, mode, tuning);
      this.states.set(sessionId, state);
      logger.debug({ sessionId, mode }, 'Created new AggregatorState');
    }
    
    this.lastAccessTime.set(sessionId, Date.now());
    return state;
  }

  processUtterance(
    sessionId: string,  // ← 关键：使用 sessionId 作为区分
    text: string,
    // ... 其他参数
  ): AggregatorCommitResult {
    const state = this.getOrCreateState(sessionId, mode);
    return state.processUtterance(
      text,
      segments,
      langProbs,
      qualityScore,
      isFinal,
      isManualCut
    );
  }
}
```

---

### 2. AggregatorMiddleware 实现

**文件**：`electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**实现方式**：
- 从 `job.session_id` 获取 session ID
- 传递给 `manager.processUtterance(job.session_id, ...)`
- 所有操作都基于 `job.session_id`

**关键代码**：
```typescript
async process(
  job: JobAssignMessage,
  result: JobResult
): Promise<AggregatorMiddlewareResult> {
  // ...
  
  // 处理 utterance
  const aggregatorResult = this.manager.processUtterance(
    job.session_id,  // ← 关键：使用 job.session_id 作为区分
    asrTextTrimmed,
    segments,
    langProbs,
    result.quality_score,
    true,  // isFinal
    false,  // isManualCut
    mode
  );
  
  // 所有后续操作都基于 job.session_id
  const metrics = this.manager.getMetrics(job.session_id);
  const contextText = this.manager?.getLastTranslatedText(job.session_id);
  // ...
}
```

---

### 3. JobAssignMessage 结构

**文件**：`electron_node/shared/protocols/messages.ts`

**结构定义**：
```typescript
export interface JobAssignMessage {
  type: 'job_assign';
  job_id: string;
  attempt_id: number;
  session_id: string;  // ← 必需字段，用于区分 session
  utterance_index: number;
  // ... 其他字段
}
```

**验证**：
- ✅ `session_id` 是必需字段
- ✅ 每个 job 都应该有正确的 `session_id`
- ✅ 调度服务器在发送 job 时应该包含正确的 `session_id`

---

## 隔离机制

### 1. 状态隔离

- **每个 session 有独立的状态**：
  - `pendingText`：待提交的文本
  - `lastUtterance`：上一个 utterance 信息
  - `tailBuffer`：Tail Carry 缓冲区
  - `lastTranslatedText`：上下文翻译文本
  - `lastCommittedText`：上一次提交的文本

- **不同 session 的状态完全隔离**：
  - Session A 的 `pendingText` 不会影响 Session B
  - Session A 的 `lastUtterance` 不会影响 Session B
  - Session A 的 `tailBuffer` 不会影响 Session B

### 2. 上下文隔离

- **翻译上下文隔离**：
  - `getLastTranslatedText(sessionId)` 只返回该 session 的上下文
  - `setLastTranslatedText(sessionId, text)` 只设置该 session 的上下文
  - 不同 session 的上下文完全隔离

### 3. 缓存隔离

- **翻译缓存**：
  - 缓存键包含 `session_id`（通过 `job.session_id` 间接使用）
  - 不同 session 的翻译结果不会混淆

- **最后发送文本记录**：
  - `lastSentText: Map<string, string>` 使用 `sessionId` 作为 key
  - 不同 session 的发送记录完全隔离

---

## 潜在问题

### 问题 1：调度服务器是否正确传递 session_id？

**风险**：
- 如果调度服务器在打散任务时丢失或错误传递 `session_id`
- 可能导致不同 session 的 utterance 被错误聚合

**验证方法**：
1. 检查日志中 `job.session_id` 是否总是存在
2. 检查不同 session 的 job 是否被正确区分
3. 检查是否有 `session_id` 为空或 null 的情况

**当前状态**：
- ✅ 从日志中看到所有 job 都有 `sessionId`
- ✅ `JobAssignMessage` 中 `session_id` 是必需字段
- ⚠️ 需要确认调度服务器在打散任务时是否正确传递

---

### 问题 2：session_id 的唯一性

**风险**：
- 如果不同 web 端的 session 使用了相同的 `session_id`
- 可能导致不同用户的 utterance 被错误聚合

**验证方法**：
1. 检查 `session_id` 的生成规则
2. 确认不同 web 端的 session 是否有唯一标识

**当前状态**：
- ⚠️ 需要确认 `session_id` 的生成规则
- ⚠️ 需要确认不同 web 端的 session 是否有唯一标识

---

### 问题 3：时间戳计算

**风险**：
- 如果不同 session 的 utterance 时间戳计算错误
- 可能导致 gap_ms 计算错误，影响 merge/new_stream 决策

**验证方法**：
1. 检查 `calculateUtteranceTime` 是否基于 session 独立计算
2. 确认不同 session 的时间戳不会互相影响

**当前状态**：
- ✅ `AggregatorState` 中每个 session 有独立的 `sessionStartTimeMs` 和 `lastUtteranceEndTimeMs`
- ✅ 时间戳计算基于 session 独立进行

---

## 验证建议

### 1. 日志验证

检查日志中是否有不同 `session_id` 的 job：

```bash
# 检查是否有多个不同的 session_id
grep "sessionId" logs/electron-main.log | grep -o "sessionId\":\"[^\"]*" | sort | uniq

# 检查同一时间是否有不同 session 的 job
grep "Received job_assign" logs/electron-main.log | grep -E "sessionId|jobId"
```

### 2. 功能验证

**测试场景**：
1. 同时打开多个 web 端（不同 session）
2. 在不同 web 端同时说话
3. 确认每个 web 端收到的结果只包含自己的 utterance

**预期结果**：
- ✅ 每个 web 端只收到自己 session 的结果
- ✅ 不同 session 的 utterance 不会互相影响
- ✅ 每个 session 的聚合状态独立

### 3. 代码验证

**检查点**：
1. ✅ `AggregatorManager` 使用 `Map<string, AggregatorState>` 存储状态
2. ✅ `processUtterance` 接收 `sessionId` 作为第一个参数
3. ✅ `getOrCreateState` 根据 `sessionId` 获取或创建状态
4. ✅ 所有操作都基于 `sessionId` 进行

---

## 结论

### ✅ 已确认的隔离机制

1. **状态隔离**：每个 session 有独立的 `AggregatorState`
2. **上下文隔离**：每个 session 有独立的翻译上下文
3. **缓存隔离**：每个 session 有独立的发送记录

### ⚠️ 需要验证的点

1. **调度服务器是否正确传递 session_id**：
   - 需要确认调度服务器在打散任务时是否正确传递 `session_id`
   - 建议检查调度服务器的实现

2. **session_id 的唯一性**：
   - 需要确认不同 web 端的 session 是否有唯一标识
   - 建议检查 `session_id` 的生成规则

3. **实际使用验证**：
   - 建议进行多 session 并发测试
   - 确认不同 session 的 utterance 不会互相影响

---

## 建议

### 1. 添加日志验证

在 `AggregatorMiddleware.process` 中添加更详细的日志：

```typescript
logger.debug(
  {
    jobId: job.job_id,
    sessionId: job.session_id,
    traceId: job.trace_id,
    activeSessions: this.manager?.getStats().totalSessions,
  },
  'Processing utterance with session isolation check'
);
```

### 2. 添加断言验证

在关键位置添加断言，确保 `session_id` 不为空：

```typescript
if (!job.session_id || job.session_id.trim() === '') {
  logger.error(
    { jobId: job.job_id, traceId: job.trace_id },
    'Job missing session_id, cannot process with Aggregator'
  );
  // 降级处理或抛出错误
}
```

### 3. 多 session 并发测试

建议进行多 session 并发测试，确认：
- 不同 session 的 utterance 不会互相影响
- 每个 session 的聚合状态独立
- 没有 session 间的数据泄露

---

## 相关文档

- `AGGREGATOR_IMPLEMENTATION_STATUS_AND_ARCHITECTURE.md` - 实现状态与架构
- `AGGREGATOR_MIDDLEWARE_ARCHITECTURE.md` - 中间件架构说明

