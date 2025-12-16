# 节点注册 UI 设计说明

**最后更新**: 2025-01-XX  
**版本**: 1.0

---

## 📋 概述

本文档说明节点注册状态的 UI 显示和用户交互设计，包括状态显示、错误提示、用户操作等。

## 🎨 UI 组件设计

### 1. 节点状态组件 (`NodeStatus`)

**位置**：Electron Node 客户端主界面顶部

**功能**：显示节点连接状态、注册状态、节点 ID

#### 状态类型

| 状态 | 说明 | 显示内容 |
|------|------|----------|
| `idle` | 初始状态，未连接 | "未连接" |
| `connecting` | 正在连接 WebSocket | "连接中..." |
| `registering` | 已连接，正在注册 | "注册中..." |
| `success` | 注册成功 | "已连接" + 节点 ID |
| `failed` | 注册失败 | "注册失败" + 错误信息 |

#### UI 设计

```
┌─────────────────────────────────────────┐
│  Lingua Node 客户端                      │
│  ┌───────────────────────────────────┐  │
│  │ ● 已连接                           │  │
│  │   节点ID: node-ABC12345            │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**状态指示器颜色**：
- 🟢 绿色：已连接并注册成功
- 🟡 黄色：连接中或注册中
- 🔴 红色：连接失败或注册失败
- ⚪ 灰色：未连接

#### 组件接口

```typescript
interface NodeStatusProps {
  status: {
    // 连接状态
    connected: boolean;
    
    // 注册状态
    registrationStatus: 'idle' | 'connecting' | 'registering' | 'success' | 'failed';
    
    // 节点 ID（注册成功后才有）
    nodeId: string | null;
    
    // 错误信息（注册失败时才有）
    registrationError?: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
  } | null;
}
```

---

### 2. 注册错误提示组件

**位置**：节点状态组件下方，或作为模态对话框

**功能**：显示注册失败的错误信息和解决建议

#### UI 设计

```
┌─────────────────────────────────────────┐
│  ⚠️ 节点注册失败                         │
│                                          │
│  错误码: NO_GPU_AVAILABLE                │
│  错误信息: 节点注册失败: 必须提供 GPU 信息│
│                                          │
│  可能的原因：                            │
│  • GPU 驱动未安装                        │
│  • GPU 未被系统识别                      │
│  • GPU 信息获取失败                      │
│                                          │
│  解决建议：                              │
│  1. 检查 GPU 驱动是否已安装              │
│  2. 检查 GPU 是否正常工作                │
│  3. 重启节点客户端                       │
│                                          │
│  [ 重试 ]  [ 关闭 ]                      │
└─────────────────────────────────────────┘
```

#### 错误码对应的提示信息

| 错误码 | 标题 | 可能的原因 | 解决建议 |
|--------|------|------------|----------|
| `NO_GPU_AVAILABLE` | GPU 未检测到 | • GPU 驱动未安装<br>• GPU 未被系统识别<br>• GPU 信息获取失败 | 1. 检查 GPU 驱动是否已安装<br>2. 检查 GPU 是否正常工作<br>3. 重启节点客户端 |
| `INVALID_MESSAGE` | 消息格式错误 | • 消息字段缺失<br>• 消息格式不正确 | 1. 检查节点客户端版本<br>2. 更新节点客户端<br>3. 查看日志获取详细信息 |
| `INTERNAL_ERROR` | 服务器内部错误 | • 服务器临时故障<br>• 数据库连接问题 | 1. 稍后重试<br>2. 联系管理员 |

---

## 🔄 状态流转

### 状态流转图

```
初始状态 (idle)
  ↓
[用户启动节点]
  ↓
连接中 (connecting)
  ↓
[WebSocket 连接成功]
  ↓
注册中 (registering)
  ↓
┌─────────────────┬─────────────────┐
│  注册成功        │   注册失败       │
│  (success)       │  (failed)       │
│  • 显示节点ID    │  • 显示错误信息  │
│  • 开始心跳      │  • 提供解决建议  │
│  • 正常服务      │  • 允许重试      │
└─────────────────┴─────────────────┘
```

### 状态更新时机

| 状态 | 更新时机 | 触发事件 |
|------|----------|----------|
| `idle` | 初始状态 | 节点启动 |
| `connecting` | WebSocket 连接开始 | `ws.connect()` |
| `registering` | WebSocket 连接成功 | `ws.on('open')` |
| `success` | 收到注册确认 | `node_register_ack` |
| `failed` | 收到错误消息 | `node_error` 或连接失败 |

---

## 💻 实现示例

### 1. 更新 NodeStatus 组件

```typescript
// electron-node/renderer/src/components/NodeStatus.tsx

import React from 'react';
import './NodeStatus.css';

interface NodeStatusProps {
  status: {
    connected: boolean;
    registrationStatus: 'idle' | 'connecting' | 'registering' | 'success' | 'failed';
    nodeId: string | null;
    registrationError?: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
  } | null;
}

export function NodeStatus({ status }: NodeStatusProps) {
  if (!status) {
    return <div className="node-status">加载中...</div>;
  }

  const getStatusIndicator = () => {
    switch (status.registrationStatus) {
      case 'success':
        return <span className="status-indicator success">●</span>;
      case 'connecting':
      case 'registering':
        return <span className="status-indicator pending">●</span>;
      case 'failed':
        return <span className="status-indicator error">●</span>;
      default:
        return <span className="status-indicator idle">○</span>;
    }
  };

  const getStatusText = () => {
    switch (status.registrationStatus) {
      case 'connecting':
        return '连接中...';
      case 'registering':
        return '注册中...';
      case 'success':
        return '已连接';
      case 'failed':
        return '注册失败';
      default:
        return '未连接';
    }
  };

  return (
    <div className={`node-status ${status.registrationStatus}`}>
      {getStatusIndicator()}
      <span className="status-text">{getStatusText()}</span>
      {status.nodeId && (
        <span className="node-id">节点ID: {status.nodeId}</span>
      )}
      {status.registrationError && (
        <div className="error-details">
          <div className="error-code">错误码: {status.registrationError.code}</div>
          <div className="error-message">{status.registrationError.message}</div>
        </div>
      )}
    </div>
  );
}
```

### 2. 更新 NodeAgent 以通知 UI

```typescript
// electron-node/main/src/agent/node-agent.ts

export class NodeAgent {
  private registrationStatus: 'idle' | 'connecting' | 'registering' | 'success' | 'failed' = 'idle';
  private registrationError?: { code: string; message: string };

  private async handleMessage(data: string): Promise<void> {
    const message = JSON.parse(data);

    switch (message.type) {
      case 'node_register_ack': {
        const ack = message as NodeRegisterAckMessage;
        this.nodeId = ack.node_id;
        this.registrationStatus = 'success';
        this.registrationError = undefined;
        
        logger.info({ nodeId: this.nodeId }, '节点注册成功');
        
        // 通知 UI 更新状态
        this.notifyRegistrationStatus();
        
        // 开始心跳
        this.startHeartbeat();
        break;
      }

      case 'node_error': {
        const error = message as NodeErrorMessage;
        this.registrationStatus = 'failed';
        this.registrationError = {
          code: error.code,
          message: error.message,
        };
        
        logger.error({ error }, '节点注册失败');
        
        // 通知 UI 显示错误
        this.notifyRegistrationStatus();
        break;
      }

      // ... 其他消息处理
    }
  }

  private notifyRegistrationStatus(): void {
    // 通过 IPC 通知渲染进程更新状态
    if (this.mainWindow) {
      this.mainWindow.webContents.send('node-registration-status', {
        connected: this.ws?.readyState === WebSocket.OPEN,
        registrationStatus: this.registrationStatus,
        nodeId: this.nodeId,
        registrationError: this.registrationError,
      });
    }
  }
}
```

### 3. 在 App 组件中监听状态更新

```typescript
// electron-node/renderer/src/App.tsx

useEffect(() => {
  // 监听节点注册状态更新
  const removeListener = window.electronAPI.onNodeRegistrationStatus((status) => {
    setNodeStatus(status);
  });

  return () => {
    removeListener();
  };
}, []);
```

---

## 🎯 用户体验优化

### 1. 错误提示优化

- **清晰的错误信息**：使用用户友好的语言，避免技术术语
- **解决建议**：针对不同错误码提供具体的解决步骤
- **重试机制**：提供"重试"按钮，方便用户快速重试

### 2. 状态反馈

- **实时更新**：状态变化时立即更新 UI
- **视觉反馈**：使用颜色、图标等视觉元素清晰表示状态
- **加载提示**：连接和注册过程中显示加载动画

### 3. 信息展示

- **节点 ID 显示**：注册成功后显示节点 ID，方便用户识别
- **错误详情**：提供展开/收起功能，显示详细的错误信息（用于调试）

---

## 🔗 相关文档

- [节点注册功能说明](./NODE_REGISTRATION_GUIDE.md) - 功能说明和实现指南
- [节点注册协议规范](./NODE_REGISTRATION_PROTOCOL.md) - 协议详细说明
- [Electron Node 实现文档](../electron_node/STAGE2.2_IMPLEMENTATION.md) - Electron Node 客户端实现

---

## 📝 更新日志

- **2025-01-XX**: 初始版本，包含 UI 设计说明和实现示例

