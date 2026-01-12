# 客户端背压与降级机制实现文档

## 实现时间
2025年1月

## 概述

客户端背压与降级机制是 Web 客户端 Phase 3 开发的核心功能之一，用于在高负载情况下响应服务端的限流请求，防止服务端过载。

## 功能特性

### 1. 背压状态管理

支持三种背压状态：
- **NORMAL**: 正常状态，直接发送音频数据
- **BUSY**: 服务端繁忙，降低发送速率（从100ms间隔降至500ms）
- **PAUSED**: 暂停发送，等待恢复
- **SLOW_DOWN**: 降速发送（从100ms间隔降至500ms）

### 2. 背压消息处理

**消息类型**:
```typescript
interface BackpressureMessage {
  type: 'backpressure';
  action: 'BUSY' | 'PAUSE' | 'SLOW_DOWN';
  resume_after_ms?: number; // 恢复时间（毫秒）
  message?: string; // 可选消息
}
```

**处理逻辑**:
- 去抖机制：最小发送间隔 ≥500ms/session，避免频繁切换状态
- 自动恢复：根据 `resume_after_ms` 自动恢复，如果没有指定则默认5秒
- 状态回调：支持注册状态变化回调，便于 UI 更新

### 3. 发送策略调整

**NORMAL 状态**:
- 直接发送音频数据
- 不需要定时器

**BUSY/SLOW_DOWN 状态**:
- 音频数据加入发送队列
- 使用定时器按间隔发送（500ms）
- 每次只处理队列中的一个项目，避免阻塞

**PAUSED 状态**:
- 非结束帧：直接丢弃
- 结束帧：加入队列等待恢复
- 使用定时器（100ms间隔）检查恢复时间

### 4. 发送队列管理

**队列行为**:
- 暂停状态下，非结束帧丢弃，结束帧加入队列
- BUSY/SLOW_DOWN 状态下，所有音频数据加入队列
- 恢复正常后，立即处理队列中的剩余数据

**队列清理**:
- 断开连接时清空队列
- 恢复正常后立即刷新队列

## 实现位置

### 核心代码

**文件**: `webapp/web-client/src/websocket_client.ts`

**关键方法**:
- `handleBackpressure(message: BackpressureMessage)`: 处理背压消息
- `adjustSendStrategy()`: 调整发送策略
- `processSendQueue()`: 处理发送队列
- `flushSendQueue()`: 立即处理队列中的所有数据
- `clearSendQueue()`: 清空发送队列

**状态管理**:
- `backpressureState`: 当前背压状态
- `backpressureResumeTime`: 恢复时间戳
- `audioSendQueue`: 音频发送队列
- `sendInterval`: 发送定时器

### 类型定义

**文件**: `webapp/web-client/src/types.ts`

```typescript
export interface BackpressureMessage {
  type: 'backpressure';
  action: 'BUSY' | 'PAUSE' | 'SLOW_DOWN';
  resume_after_ms?: number;
  message?: string;
}
```

**文件**: `webapp/web-client/src/websocket_client.ts`

```typescript
export enum BackpressureState {
  NORMAL = 'normal',
  BUSY = 'busy',
  PAUSED = 'paused',
  SLOW_DOWN = 'slow_down',
}
```

## 测试覆盖

**测试文件**: `webapp/web-client/tests/backpressure_test.ts`

**测试用例**: 16个测试，全部通过 ✅

**测试覆盖**:
1. ✅ 背压状态管理（初始状态、获取状态）
2. ✅ 背压消息处理（BUSY、PAUSE、SLOW_DOWN）
3. ✅ 去抖机制（忽略重复消息）
4. ✅ 背压状态回调（状态变化、恢复）
5. ✅ 发送策略调整（BUSY、PAUSE、SLOW_DOWN）
6. ✅ 自动恢复（resume_after_ms）
7. ✅ 断开连接时的清理

## 使用示例

### 注册背压状态回调

```typescript
const wsClient = new WebSocketClient(stateMachine, 'ws://localhost:5010/ws/session');

wsClient.setBackpressureStateCallback((state: BackpressureState) => {
  console.log('背压状态变化:', state);
  // 更新 UI，显示当前状态
  if (state === BackpressureState.PAUSED) {
    // 显示"服务端繁忙，暂停发送"
  } else if (state === BackpressureState.BUSY || state === BackpressureState.SLOW_DOWN) {
    // 显示"服务端繁忙，降速发送"
  } else {
    // 显示"正常发送"
  }
});
```

### 获取当前背压状态

```typescript
const currentState = wsClient.getBackpressureState();
console.log('当前背压状态:', currentState);
```

## 性能优化

### 避免无限循环

1. **队列处理限制**: 每次只处理队列中的一个项目
2. **定时器管理**: 队列为空时停止定时器，有数据时重新启动
3. **状态检查**: 在 `processSendQueue` 中检查恢复时间，避免重复处理

### 内存管理

1. **队列清理**: 断开连接时清空队列
2. **定时器清理**: 确保所有定时器在断开连接时被清除
3. **状态重置**: 断开连接时重置所有背压相关状态

## 验收标准

- ✅ 能正确处理 BUSY / PAUSE / SLOW_DOWN 消息
- ✅ 发送频率能动态调整（100ms → 500ms）
- ✅ 暂停时能缓存结束帧，恢复时发送
- ✅ 非结束帧在暂停状态下被丢弃
- ✅ 自动恢复机制正常工作
- ✅ 背压状态回调正常触发
- ✅ 断开连接时正确清理
- ✅ 单元测试覆盖率 100%（16/16）

## 后续优化建议

1. **可配置参数**: 允许用户配置发送间隔、去抖时间等
2. **统计信息**: 记录背压事件次数、持续时间等
3. **UI 提示**: 在 UI 中显示当前背压状态和预计恢复时间
4. **重试策略**: 在恢复后重试发送失败的数据（如果需要）

## 总结

客户端背压与降级机制已完整实现并通过测试，能够有效响应服务端的限流请求，防止服务端过载。实现遵循了规模化方案的要求，支持三种背压状态和自动恢复机制。

