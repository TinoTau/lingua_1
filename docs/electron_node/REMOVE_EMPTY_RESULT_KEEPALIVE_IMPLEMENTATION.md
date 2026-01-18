# 移除空结果保活机制 - 实施记录

## 决策背景

经过分析，发现"流式ASR处理 + 头部对齐"功能与"空结果保活机制"产生设计冲突，导致长语音场景下实际ASR结果被错误过滤。

**决策**：保留流式ASR处理能力，移除空结果保活机制，延长调度服务器超时时间。

---

## 实施内容

### 1. 节点端：移除空结果发送逻辑

**文件**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`

**修改**：
- **移除**：当 `isEmpty=true` 时发送空结果的逻辑
- **移除**：当 `shouldSend=false` 时发送空结果的逻辑
- **保留**：只在有实际ASR结果时发送 `job_result`

**逻辑变化**：

**修改前**：
```typescript
if (isEmpty) {
  // 发送空结果作为保活信号
  sendEmptyResult();
}
if (!shouldSend) {
  // 发送空结果防止超时
  sendEmptyResult();
}
```

**修改后**：
```typescript
if (isEmpty) {
  // 不发送任何结果，等待实际结果产生
  return;
}
if (!shouldSend) {
  // 去重过滤，不发送任何结果
  return;
}
// 只有实际结果才发送
sendActualResult();
```

### 2. 调度服务器：延长超时时间

**文件**：`central_server/scheduler/config.toml`

**修改**：
```toml
# 修改前
job_timeout_seconds = 30

# 修改后
job_timeout_seconds = 60  # 调整为60秒以容纳流式ASR聚合的额外等待时间（从30秒延长）
```

**原因**：
- 流式ASR处理需要跨job合并音频，可能增加等待时间
- `pendingTimeoutAudio` 的TTL为10秒，加上处理时间，需要更长的超时窗口
- 60秒足够容纳流式聚合的额外等待时间

### 3. 去重逻辑：保持简单模型

**文件**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`

**修改**：
- 简化 job_id 记录逻辑
- 由于现在只会发送实际结果，不再需要区分"空结果"和"实际结果"
- 所有发送的结果都统一记录 job_id

---

## 预期效果

### 功能改进

1. **解决冲突**：
   - 不再发送空结果，消除了与去重逻辑的冲突
   - 一个 job_id 只发送一次实际结果，符合去重逻辑假设

2. **保留流式处理**：
   - 音频缓存机制（`pendingTimeoutAudio`）继续工作
   - 头部对齐机制（`originalJobIds`）继续工作
   - 长语音的识别质量优势得以保留

3. **简化代码**：
   - 移除了复杂的"空结果 vs 实际结果"判断逻辑
   - 代码逻辑更直观：**有结果才发送，没结果不发送**

### 风险评估

**低风险场景**（正常情况）：
- `pendingTimeoutAudio` 在10秒TTL内被处理 → 不会触发超时
- 大多数情况下，实际结果会在超时前发送

**中风险场景**（边界情况）：
- `pendingTimeoutAudio` 长时间不被处理（超过60秒）
- **需要监控**：如果出现这种情况，可能需要调整TTL或超时时间

---

## 测试建议

### 1. 长语音场景测试

- 连续说话超过10秒，触发 MaxDuration finalize
- 验证：
  - Job 618 不发送空结果
  - Job 619 合并音频并产生实际结果
  - 实际结果正常发送，不被去重过滤

### 2. 超时场景测试

- 模拟 `pendingTimeoutAudio` 长时间不被处理的情况
- 验证调度服务器的超时机制（60秒）正常工作

### 3. 正常场景回归测试

- 短语音、手动cut、pause finalize → 确保正常工作
- 去重逻辑 → 确保仍能正常过滤重复结果

---

## 相关文档

- `docs/electron_node/AUDIO_AGGREGATOR_DESIGN_CONFLICT_DECISION.md` - 决策文档
- `docs/electron_node/AUDIO_AGGREGATOR_TIMEOUT_ISSUE_ANALYSIS.md` - 问题分析文档

---

## 实施日期

2026-01-16

## 实施人员

AI Assistant (根据用户决策实施)
