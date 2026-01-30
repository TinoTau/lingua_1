# 端口冲突根本原因分析 - 2026-01-20

## 🐛 **问题现象**

用户报告：
1. ✅ Semantic Repair Service - Chinese 启动成功（有警告但能运行）
2. ❌ EN Normalize Service 重启失败
3. ❌ Unified Semantic Repair Service 重启失败

错误信息：
```
ERROR: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 5012/5015): 
通常每个套接字地址(协议/网络地址/端口)只允许使用一次。
```

---

## 🔍 **根本原因**

### 问题1: 双启动架构导致进程丢失追踪

**日志证据**:

启动时使用 `ServiceSupervisor`:
```json
{"serviceId":"en-normalize","serviceName":"EN Normalize Service","msg":"[ServiceSupervisor] 🚀 Starting service..."}
{"serviceId":"en-normalize","pid":61760,"port":5012,"msg":"[ServiceSupervisor] ✅ Service started successfully"}
```

尝试停止时使用 `ServiceProcessRunner`:
```json
{"serviceId":"en-normalize","msg":"IPC: Stopping semantic repair service"}
{"serviceId":"en-normalize","msg":"Service process not found (already stopped?)"}
```

**问题**：
- 启动：`ServiceSupervisor` → 维护自己的进程列表
- 停止：`ServiceProcessRunner` → 查找不到进程（不同的进程Map）

### 问题2: 进程未被kill，端口持续占用

**Netstat证据**:
```
TCP    127.0.0.1:5012    LISTENING    61760  ← EN Normalize (第一次启动)
TCP    127.0.0.1:5015    LISTENING    75348  ← Semantic Repair EN-ZH (第一次启动)
TCP    127.0.0.1:5013    LISTENING    83204  ← Semantic Repair ZH (正常)
```

这些PID一直存在，说明第一次启动的进程从未被kill。

---

## 🎯 **架构分析**

### 当前代码中的问题

检查 `index.ts` 中的自动启动逻辑：

```typescript
// startServicesByPreference() 调用 ServiceSupervisor
logger.info({ serviceId }, 'Auto-starting semantic repair service...');
await serviceSupervisor.startService(serviceId);
```

但IPC handlers使用：
```typescript
ipcMain.handle('start-semantic-repair-service', async (_event, serviceId: string) => {
  await managers.serviceRunner.start(serviceId); // ← 使用 ServiceProcessRunner
});

ipcMain.handle('stop-semantic-repair-service', async (_event, serviceId: string) => {
  await managers.serviceRunner.stop(serviceId); // ← 使用 ServiceProcessRunner
});
```

**矛盾**：
- 自动启动：`ServiceSupervisor`
- UI手动启停：`ServiceProcessRunner`
- 这两个管理器维护**不同的进程Map**！

---

## ✅ **解决方案**

### 短期方案（立即执行）

**Step 1: Kill旧进程**
```powershell
Stop-Process -Id 61760,75348 -Force
```

**Step 2: 在UI中重新启动服务**

---

### 长期方案（架构修复）

**问题根源**: 混用了两个服务管理器

#### 方案1: 统一使用 ServiceProcessRunner（推荐）

修改 `startServicesByPreference()`:
```typescript
async function startServicesByPreference(managers: ServiceManagers): Promise<void> {
  // 删除 ServiceSupervisor 的调用
  // await serviceSupervisor.startService(serviceId); // ❌ 删除

  // 统一使用 ServiceProcessRunner
  await managers.serviceRunner.start(serviceId); // ✅ 统一
}
```

#### 方案2: 统一使用 ServiceSupervisor

修改 IPC handlers:
```typescript
ipcMain.handle('start-semantic-repair-service', async (_event, serviceId: string) => {
  // 使用 ServiceSupervisor 而不是 ServiceProcessRunner
  await serviceSupervisor.startService(serviceId); // ✅ 统一
});
```

---

## 📊 **为什么会有两个管理器？**

### ServiceSupervisor

- **位置**: `service-layer/service-ipc-handlers.ts`
- **特点**: 使用 `node:child_process` 的 `spawn`
- **职责**: 旧架构的服务管理器
- **进程追踪**: 维护自己的 `Map<string, ChildProcess>`

### ServiceProcessRunner

- **位置**: `service-layer/ServiceProcessRunner.ts`
- **特点**: 新架构，统一的服务启停接口
- **职责**: Day 1重构后的标准服务管理器
- **进程追踪**: 维护 `processes: Map<string, ChildProcess>`

**问题**: 重构不彻底，导致两套系统并存！

---

## 🎯 **修复优先级**

### 🔴 高优先级（立即修复）

1. ✅ Kill占用端口的旧进程
2. 🔧 修改 `startServicesByPreference()` - 统一使用 `ServiceProcessRunner`

### 🟡 中优先级（本次重构完成前）

3. 删除 `ServiceSupervisor` 或明确其职责
4. 确保所有启动路径都经过同一个管理器

### 🟢 低优先级（Day 5重构）

5. 彻底清理旧架构代码
6. 统一IPC命名

---

## 📝 **当前状态**

- ✅ 已手动Kill进程61760和75348
- ⏳ 等待用户重新启动服务测试
- ⏳ 需要修复自动启动逻辑

---

## 🔧 **需要修改的文件**

1. `electron-node/main/src/index.ts` - `startServicesByPreference()`
2. 可能需要删除或重构 `ServiceSupervisor`

---

**诊断时间**: 2026-01-20  
**问题**: 双服务管理器架构导致进程追踪失败  
**优先级**: 🔴 紧急 - 阻塞用户使用  
**下一步**: 修改自动启动逻辑，统一使用 `ServiceProcessRunner`
