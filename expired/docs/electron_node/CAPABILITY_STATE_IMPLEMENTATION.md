# capability_state 实现说明

## 实现概述

已实现节点模型能力图（capability_state）的上报机制，符合产品说明文档要求。

## 实现内容

### 1. ModelManager 增强

**文件**: `electron-node/main/src/model-manager/model-manager.ts`

#### 新增方法

1. **`getCapabilityState()`**: 获取所有模型的状态映射
   - 返回类型: `Promise<Record<string, ModelStatus>>`
   - 功能: 遍历所有可用模型，检查每个模型的安装状态，返回状态映射
   - 状态映射规则:
     - `ready`: 模型已安装且状态为 ready
     - `downloading`: 模型正在下载/验证/安装中
     - `error`: 模型安装失败或状态为 error
     - `not_installed`: 模型未安装

2. **`mapToModelStatus()`**: 内部状态映射方法（私有）
   - 将 `InstalledModelVersion['status']` 映射到 `ModelStatus`
   - 映射关系:
     - `ready` → `ready`
     - `downloading` / `verifying` / `installing` → `downloading`
     - `error` → `error`
     - 其他 → `not_installed`

#### 状态更新机制

- `updateModelStatus()` 方法在状态变化时触发 `capability-state-changed` 事件
- 确保状态变化能及时反映到 capability_state

### 2. NodeAgent 增强

**文件**: `electron-node/main/src/agent/node-agent.ts`

#### 新增功能

1. **`getCapabilityState()`**: 获取 capability_state（私有方法）
   - 调用 `ModelManager.getCapabilityState()` 获取状态映射
   - 处理错误情况，返回空对象

2. **节点注册时上报**: `registerNode()` 方法
   - 在 `node_register` 消息中包含 `capability_state` 字段
   - 确保调度服务器在节点注册时就能知道节点的模型能力

3. **心跳时上报**: `startHeartbeat()` 方法
   - 在 `node_heartbeat` 消息中包含 `capability_state` 字段
   - 每 15 秒上报一次最新的模型状态

4. **状态变化监听**: `start()` 方法
   - 监听 `ModelManager` 的 `capability-state-changed` 事件
   - 状态变化时会在下次心跳时自动更新

### 3. 类型定义

**文件**: `shared/protocols/messages.ts`

- `ModelStatus` 类型已定义: `'ready' | 'downloading' | 'not_installed' | 'error'`
- `NodeRegisterMessage` 和 `NodeHeartbeatMessage` 已包含 `capability_state?: Record<string, ModelStatus>` 字段

## 数据流

```
ModelManager
  ├─ 模型下载/安装/卸载
  ├─ updateModelStatus() → 更新 registry
  ├─ 触发 'capability-state-changed' 事件
  └─ getCapabilityState() → 返回状态映射

NodeAgent
  ├─ 监听 'capability-state-changed' 事件
  ├─ registerNode() → 上报 capability_state
  └─ startHeartbeat() → 定期上报 capability_state (每 15 秒)

调度服务器
  ├─ 接收 node_register 消息（包含 capability_state）
  └─ 接收 node_heartbeat 消息（包含 capability_state）
```

## 状态映射规则

| InstalledModelVersion['status'] | ModelStatus | 说明 |
|--------------------------------|-------------|------|
| `ready` | `ready` | 模型已安装且可用 |
| `downloading` | `downloading` | 正在下载 |
| `verifying` | `downloading` | 正在验证（视为下载中） |
| `installing` | `downloading` | 正在安装（视为下载中） |
| `error` | `error` | 安装失败或模型损坏 |
| 不存在 | `not_installed` | 模型未安装 |

## 使用示例

### 节点注册消息

```json
{
  "type": "node_register",
  "node_id": null,
  "version": "1.0.0",
  "platform": "windows",
  "hardware": { ... },
  "installed_models": [ ... ],
  "features_supported": { ... },
  "accept_public_jobs": true,
  "capability_state": {
    "whisper-large-v3-zh": "ready",
    "m2m100-418M": "ready",
    "emotion-xlm-r": "downloading",
    "persona-style-transformer": "not_installed"
  }
}
```

### 节点心跳消息

```json
{
  "type": "node_heartbeat",
  "node_id": "node-01",
  "timestamp": 1234567890,
  "resource_usage": { ... },
  "installed_models": [ ... ],
  "capability_state": {
    "whisper-large-v3-zh": "ready",
    "m2m100-418M": "ready",
    "emotion-xlm-r": "ready",
    "persona-style-transformer": "not_installed"
  }
}
```

## 测试建议

1. **状态更新测试**:
   - 启动模型下载，验证状态从 `not_installed` → `downloading` → `ready`
   - 下载失败，验证状态变为 `error`

2. **上报测试**:
   - 检查节点注册消息是否包含 `capability_state`
   - 检查心跳消息是否包含 `capability_state`
   - 验证状态变化后，下次心跳是否更新

3. **调度服务器集成测试**:
   - 验证调度服务器能正确解析 `capability_state`
   - 验证调度服务器能根据 `capability_state` 选择节点

## 注意事项

1. **性能考虑**:
   - `getCapabilityState()` 需要查询所有可用模型，可能有一定开销
   - 心跳频率为 15 秒，不会造成性能问题

2. **状态一致性**:
   - 状态更新是异步的，可能存在短暂延迟
   - 心跳机制确保最终一致性

3. **错误处理**:
   - 如果 `getCapabilityState()` 失败，返回空对象
   - 不会影响节点注册和心跳的正常流程

## 符合文档要求

✅ **capability_state 字段**: 已实现  
✅ **状态类型**: ready/downloading/not_installed/error  
✅ **上报频率**: 每 15 秒（心跳时）  
✅ **节点注册时上报**: 已实现  
✅ **状态实时更新**: 通过事件机制实现  

符合 [`docs/modular/LINGUA_完整技术说明书_v2.md`](../modular/LINGUA_完整技术说明书_v2.md) 中关于 capability_state 的所有要求。
