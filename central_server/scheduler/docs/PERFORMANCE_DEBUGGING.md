# 性能调试指南

## 问题诊断

### 1. 处理时间分析

日志中现在包含 `elapsed_ms` 字段，显示从 job 创建到结果返回的总耗时。

查看方法：
```powershell
Get-Content "logs\scheduler.log" | Select-String -Pattern "elapsed_ms" | Select-Object -Last 20
```

**关键指标：**
- **正常范围**：ASR + NMT + TTS 通常在 2-5 秒
- **慢速**：> 10 秒可能表示节点处理慢或网络问题
- **超时**：> 30 秒可能表示节点无响应

### 2. utterance_index 不连续问题

**症状：**
- `ready_results_count: 0` 但队列中有结果
- 日志显示 utterance_index 跳跃（如 0, 2, 3 缺少 1）

**原因：**
- 自动切句（pause）和手动 finalize 可能同时触发
- 超时任务使用了过期的 utterance_index

**诊断方法：**
```powershell
# 查看 utterance_index 的变化
Get-Content "logs\scheduler.log" | Select-String -Pattern "utterance_index|Incremented utterance_index" | Select-Object -Last 30
```

**日志关键字段：**
- `expected_index`: 结果队列期望的下一个 utterance_index
- `queue_indices`: 队列中所有结果的 utterance_index 列表
- `first_index`: 队列第一个结果的 utterance_index

### 3. 结果队列阻塞

**症状：**
- 第一句话能返回，后续输入不返回
- `ready_results_count: 0` 但 `queue_size > 0`

**诊断：**
查看结果队列的详细状态：
```powershell
Get-Content "logs\scheduler.log" | Select-String -Pattern "Checking ready results|Ready results extracted" | Select-Object -Last 20
```

**关键信息：**
- `expected_index`: 应该等于下一个要发送的 utterance_index
- `queue_indices`: 如果第一个 index 不等于 expected_index，说明有缺失
- `remaining_queue_size`: 队列中剩余的结果数量

### 4. 重复创建 Job

**症状：**
- 同一个 job_id 在短时间内创建多次
- 可能导致资源浪费和结果重复

**诊断：**
```powershell
Get-Content "logs\scheduler.log" | Select-String -Pattern "Job created" | Group-Object | Where-Object { $_.Count -gt 1 }
```

## 性能优化建议

### 1. 减少处理时间

- **检查节点性能**：查看节点的 CPU/GPU 使用率
- **优化模型加载**：确保模型已预热
- **网络延迟**：检查 scheduler 和 node 之间的网络延迟

### 2. 修复 utterance_index 不连续

**临时解决方案：**
如果发现 utterance_index 不连续，可以：
1. 重启会话（重新初始化 utterance_index）
2. 检查是否有并发的 finalize 操作

**长期解决方案：**
- 确保 finalize 操作的原子性
- 避免使用过期的 utterance_index

### 3. 结果队列优化

- **监控队列大小**：如果队列持续增长，说明处理速度跟不上输入速度
- **超时处理**：对于长时间未返回的结果，应该超时并跳过

## 日志示例

### 正常流程
```
[INFO] Job created, utterance_index=0
[INFO] Received JobResult, utterance_index=0, elapsed_ms=3500ms
[INFO] Getting ready results, expected_index=0, queue_size=1
[INFO] Ready results extracted, ready_count=1, new_expected_index=1
[INFO] Successfully sent translation result
```

### 问题流程（utterance_index 不连续）
```
[INFO] Job created, utterance_index=0
[INFO] Received JobResult, utterance_index=0, elapsed_ms=3500ms
[INFO] Getting ready results, expected_index=0, queue_size=1
[INFO] Ready results extracted, ready_count=1, new_expected_index=1
[INFO] Job created, utterance_index=2  # 注意：跳过了 1
[INFO] Received JobResult, utterance_index=2, elapsed_ms=4000ms
[INFO] Getting ready results, expected_index=1, queue_size=1, queue_indices=[2]
[DEBUG] Waiting for expected index 1, breaking  # 队列阻塞
```

## 下一步行动

1. **重新编译并测试**，查看新的日志输出
2. **分析 utterance_index 的变化**，找出为什么会出现不连续
3. **检查处理时间**，找出性能瓶颈
4. **监控结果队列**，确保结果能正常发送

