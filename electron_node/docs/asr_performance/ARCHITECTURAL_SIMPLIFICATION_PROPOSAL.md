# 架构简化方案：统一数据源

**日期**: 2026-01-28  
**目标**: 用简单的架构设计解决文本分配问题，避免打补丁

---

## 一、当前问题

### 1.1 数据源不一致

**当前架构**：
- `originalJobIds`: 从`batchJobInfo`派生（`batchJobInfo.map(info => info.jobId)`）
- `originalJobInfo`: 从音频聚合得到（`jobInfoToProcess`）
- 空容器检测：比较这两个列表，找出不在`originalJobIds`中的job

**问题**：
- 两个数据源可能不一致
- 合并pendingMaxDurationAudio时，batch被分配给了当前job，但`originalJobInfo`中还保留了其他job
- 导致空容器检测逻辑错误地标记有文本的job为空容器

### 1.2 当前修复（打补丁方式）

**修复方式**：
```typescript
if (hasMergedPendingAudio) {
  finalJobInfoToProcess = [currentJobInfo];
  jobInfoToProcess = [currentJobInfo]; // 打补丁：确保一致性
}
```

**问题**：
- 这是打补丁的方式，在特殊情况下强制更新数据
- 没有从根本上解决数据源不一致的问题

---

## 二、架构简化方案

### 2.1 统一数据源（推荐）

**核心思想**：
- `originalJobIds`应该直接从`originalJobInfo`派生，而不是从`batchJobInfo`派生
- 这样就不需要比较两个列表了
- 空容器检测逻辑可以简化为：只检查`originalJobInfo`中的job是否被注册到dispatcher

**实现**：
```typescript
// 在audio-aggregator.ts中
// 统一数据源：originalJobIds直接从originalJobInfo派生
const originalJobIds = jobInfoToProcess.map(info => info.jobId);

// 在asr-step.ts中
// 简化空容器检测：只检查originalJobInfo中的job是否被注册到dispatcher
if (originalJobInfo.length > 0) {
  const dispatcher = getOriginalJobResultDispatcher();
  const emptyJobIds = originalJobInfo
    .filter(info => {
      // 检查dispatcher中是否有该job的注册
      const registration = dispatcher.getRegistration(job.session_id, info.jobId);
      return !registration; // 没有注册 = 空容器
    })
    .map(info => info.jobId);
  
  // 发送空结果核销
}
```

**优点**：
- ✅ 统一数据源，逻辑简单清晰
- ✅ 不需要比较两个列表
- ✅ 不需要在特殊情况下打补丁
- ✅ 空容器检测逻辑更准确（直接检查dispatcher）

**缺点**：
- ⚠️ 需要给dispatcher添加`getRegistration`方法（如果还没有的话）

### 2.2 删除空容器检测（备选）

**核心思想**：
- 如果某个job没有文本，dispatcher会自然处理（TTL超时或finalize时处理）
- 删除空容器检测逻辑，简化代码

**实现**：
```typescript
// 删除asr-step.ts中的空容器检测逻辑（第254-318行）
// dispatcher的TTL机制会自动处理没有文本的job
```

**优点**：
- ✅ 代码更简单
- ✅ 不需要维护额外的检测逻辑

**缺点**：
- ⚠️ 可能导致调度服务器等待更长时间（TTL超时）
- ⚠️ 可能影响用户体验

---

## 三、推荐方案

### 3.1 方案1：统一数据源（推荐）

**理由**：
- 从根本上解决数据源不一致的问题
- 逻辑简单清晰，不需要打补丁
- 空容器检测更准确

**实现步骤**：
1. 修改`audio-aggregator.ts`：`originalJobIds`直接从`originalJobInfo`派生
2. 修改`asr-step.ts`：简化空容器检测逻辑，直接检查dispatcher
3. 删除之前的打补丁代码

### 3.2 方案2：删除空容器检测（备选）

**理由**：
- 代码更简单
- dispatcher的TTL机制已经可以处理

**实现步骤**：
1. 删除`asr-step.ts`中的空容器检测逻辑
2. 依赖dispatcher的TTL机制

---

## 四、总结

### 4.1 当前问题

- **数据源不一致**：`originalJobIds`和`originalJobInfo`来自不同的数据源
- **打补丁修复**：在特殊情况下强制更新数据，没有从根本上解决问题

### 4.2 推荐方案

- **统一数据源**：`originalJobIds`直接从`originalJobInfo`派生
- **简化空容器检测**：直接检查dispatcher，不需要比较两个列表

---

*本方案遵循"简单易懂，架构设计解决"的原则，避免打补丁。*
