# 语义修复GPU等待策略修复

## 问题

Job 6的语义修复被跳过，原因是GPU忙时使用了SKIP策略，直接返回PASS，没有实际调用语义修复服务。

## 修复内容

### 1. 修改GPU仲裁器配置

**文件**: `electron_node/electron-node/main/src/gpu-arbiter/gpu-arbiter-factory.ts`

**修改**:
- 将`SEMANTIC_REPAIR`的`busyPolicy`从`"SKIP"`改为`"WAIT"`
- 将`maxWaitMs`从`400ms`增加到`8000ms`（8秒）

**原因**:
- 语义修复是重要的处理步骤，不应该被跳过
- 8秒的等待时间足够长，确保在GPU忙时也能等待到资源

### 2. 移除SKIP策略处理逻辑

**文件**: `electron_node/electron-node/main/src/agent/postprocess/semantic-repair-stage-zh.ts`

**修改**:
- 移除了SKIP策略的处理逻辑
- 移除了FALLBACK_CPU策略的处理逻辑（未实现）
- 如果GPU租约获取失败（返回null），抛出错误而不是返回PASS

**原因**:
- 如果busyPolicy是WAIT，`tryAcquireGpuLease`应该会等待，不会返回null
- 如果返回null，说明等待超时或系统异常，应该抛出错误让上层处理

### 3. 改进错误处理

**修改**:
- 如果GPU租约获取失败，记录详细的错误日志
- 抛出错误，让上层处理（外层的catch会捕获并返回PASS，但会记录错误）

## 预期效果

1. **语义修复不会被跳过**：GPU忙时会等待，直到获取到GPU租约或超时
2. **更长的等待时间**：8秒的等待时间足够长，确保在GPU忙时也能等待到资源
3. **更好的错误处理**：如果GPU租约获取失败，会记录详细的错误日志，便于排查问题

## 注意事项

1. **等待时间**：如果GPU真的非常忙，8秒的等待时间可能会导致任务延迟
2. **超时处理**：如果等待超时，会抛出错误，外层的catch会捕获并返回PASS
3. **系统监控**：需要监控GPU使用率和语义修复的等待时间，确保系统正常运行

## 测试建议

1. **正常情况**：确认语义修复正常执行
2. **GPU忙时**：确认语义修复会等待，而不是跳过
3. **超时情况**：确认如果等待超时，会记录错误日志
