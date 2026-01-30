# 服务状态细化改进 - 2026-01-20

## 🐛 **问题**

用户反馈：节点端启动时，所有服务都**立即显示"运行中"**，但实际上：
- Python进程刚spawn出来
- 还在加载模型（2-5秒）
- HTTP服务器还没启动
- **用户以为服务ready了，但实际上还在初始化**

---

## 🔍 **根本原因**

### 当前代码（ServiceProcessRunner.ts Line 231）

```typescript
// 9. 等待500ms确认进程有PID
await new Promise<void>((resolve) => {
  setTimeout(() => {
    if (!proc.pid) {
      reject(...);
    }
    resolve();  // ← 500ms后就resolve了
  }, 500);
});

// 10. 立即设置为running
entry.runtime.status = 'running';  // ❌ 问题！
```

**时间线**：
```
0ms:   spawn(python service.py)
500ms: 有PID → 设置status='running' → UI显示"运行中" ✅
1000ms: Python还在import模块...
2000ms: 还在加载模型...
3000ms: FastAPI启动...
4000ms: 真正ready，开始监听端口 ✅
```

**用户看到的**：500ms就"运行中"了  
**实际情况**：4秒后才真正可用

---

## ✅ **正确的状态流转**

### ServiceTypes已定义5个状态（Line 29）

```typescript
status: "stopped" | "starting" | "running" | "stopping" | "error";
```

### 应该这样使用

```
stopped → starting → running
  ↓         ↓          ↓
用户点击  spawn进程   健康检查通过
启动按钮  有PID      HTTP返回200
```

---

## 🔧 **修复方案（简单直接）**

### 方案1：使用`starting`状态（推荐）

**修改ServiceProcessRunner.ts**:

```typescript
// Line 120 - spawn后立即设置为starting
this.processes.set(serviceId, proc);
entry.runtime.status = 'starting';  // ← 添加这行
entry.runtime.pid = proc.pid;

// 5-8. 监听输出、错误、退出...

// 9. 等待500ms确认没立即崩溃
await new Promise<void>((resolve, reject) => {
  // ...
});

// 10. 仍然设置为starting（不是running）
entry.runtime.status = 'starting';  // ← 保持starting
entry.runtime.pid = proc.pid;
entry.runtime.startedAt = new Date();

logger.info({ serviceId, pid: proc.pid }, '⏳ Service is starting...');

// 11. 启动健康检查（后台异步）
this.checkServiceHealth(serviceId).catch(error => {
  logger.warn({ serviceId, error }, 'Health check failed after startup');
});
```

### 新增健康检查方法

```typescript
/**
 * 健康检查 - 等待服务真正ready
 */
private async checkServiceHealth(serviceId: string): Promise<void> {
  const entry = this.registry.get(serviceId);
  if (!entry || !entry.def.port) {
    // 没有port的服务，2秒后直接认为running
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (entry) {
      entry.runtime.status = 'running';
      logger.info({ serviceId }, '✅ Service is now running (no health check)');
    }
    return;
  }

  const port = entry.def.port;
  const maxAttempts = 20;  // 最多等待20秒
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // 尝试访问/health端点
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1000)
      });
      
      if (response.ok) {
        // 健康检查通过！
        entry.runtime.status = 'running';
        entry.runtime.port = port;
        logger.info({ serviceId, port, attempts: i + 1 }, '✅ Service is now running (health check passed)');
        return;
      }
    } catch (error) {
      // 继续等待
    }
    
    // 等待1秒后重试
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 检查进程是否还活着
    if (entry.runtime.status === 'stopped') {
      logger.warn({ serviceId }, 'Service stopped during health check');
      return;
    }
  }
  
  // 20秒后仍然没有健康检查通过，但保持starting状态
  logger.warn({ serviceId }, '⚠️ Health check timeout, but process is still running');
  // 宽容处理：设置为running（但记录警告）
  entry.runtime.status = 'running';
}
```

---

## 📊 **修复效果**

### 修复前（用户困惑）

| 时间 | 实际状态 | UI显示 | 用户感受 |
|------|----------|--------|----------|
| 0ms | spawn进程 | "已停止" | - |
| 500ms | 加载中... | **"运行中"** ✅ | ？真的ready了吗？ |
| 4000ms | 真正ready | "运行中" ✅ | 试了半天才能用 |

### 修复后（清晰透明）

| 时间 | 实际状态 | UI显示 | 用户感受 |
|------|----------|--------|----------|
| 0ms | spawn进程 | "已停止" | - |
| 500ms | 加载中... | **"正在启动..."** ⏳ | 知道还在启动 |
| 2000ms | 加载模型... | **"正在启动..."** ⏳ | 耐心等待 |
| 4000ms | 健康检查通过 | **"运行中"** ✅ | 现在可以用了！ |

---

## 🎯 **UI改进建议**

### 前端状态显示（ServiceManagement.tsx）

```typescript
const getStatusDisplay = (status: ServiceStatus) => {
  switch (status) {
    case 'stopped':
      return { text: '已停止', color: 'gray', icon: '⚫' };
    case 'starting':
      return { text: '正在启动...', color: 'yellow', icon: '⏳' };  // ← 新增
    case 'running':
      return { text: '运行中', color: 'green', icon: '✅' };
    case 'stopping':
      return { text: '正在停止...', color: 'orange', icon: '⏸️' };
    case 'error':
      return { text: '错误', color: 'red', icon: '❌' };
    default:
      return { text: '未知', color: 'gray', icon: '❓' };
  }
};
```

### 添加动画效果

```css
.status-starting {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## 📋 **实施步骤**

### Step 1: 修改ServiceProcessRunner.ts（5分钟）

1. Line 120 - spawn后设置`starting`
2. Line 231 - 保持`starting`（不设置`running`）
3. 添加`checkServiceHealth()`方法

### Step 2: 测试（2分钟）

```powershell
npm run build:main
npm start
```

观察：
- 点击启动服务
- 应该先显示"正在启动..."
- 几秒后变为"运行中"

### Step 3: 前端UI优化（可选）

更新`ServiceManagement.tsx`显示逻辑

---

## 💡 **设计原则**

> **透明 > 隐藏真相**

1. ✅ **真实状态** - 启动中就显示启动中
2. ✅ **用户预期** - 看到"运行中"就真的可以用
3. ✅ **简单实现** - 健康检查后台异步，不阻塞spawn

---

## ⚠️ **注意事项**

### 健康检查失败怎么办？

**宽容策略**（推荐）：
- 20秒后即使健康检查没通过
- 仍然设置为`running`（进程还活着）
- 记录警告日志
- **原因**：有些服务可能没有`/health`端点

### 无端口的服务

- 没有`port`字段的服务
- 等待2秒后直接设置为`running`
- 不进行HTTP健康检查

---

**修复时间**: 10分钟  
**用户体验改进**: ✅ **清晰透明的状态显示**  
**原则**: **让用户知道真实状态**
