# 孤立进程诊断和解决方案

## 问题描述

集成测试后，系统后台出现大量未关闭的进程：
- Node.js JavaScript Runtime
- Python 服务进程
- esBuilder.exe

## 可能的原因

### 1. 应用异常退出

**原因**：如果 Electron 应用被强制关闭（任务管理器、系统崩溃等），清理逻辑可能不会执行。

**代码位置**：
- `electron_node/electron-node/main/src/index.ts` - 主入口文件
- `electron_node/electron-node/main/src/service-cleanup.ts` - 清理逻辑

**清理触发点**：
- `window-all-closed` 事件
- `before-quit` 事件
- `SIGTERM` / `SIGINT` 信号
- `uncaughtException` / `unhandledRejection` 异常

**问题**：如果进程被强制终止（`taskkill /F`），这些事件可能不会触发。

### 2. 测试代码未正确清理

**原因**：集成测试可能直接启动服务，但没有在测试结束后调用清理函数。

**相关文件**：
- `electron_node/electron-node/tests/stage3.2/integration-test.ts`
- 其他集成测试文件

**检查点**：
- 测试是否在 `afterAll` 或 `teardown` 中调用清理函数
- 测试是否使用 `try-finally` 确保清理

### 3. Python 服务进程管理问题

**原因**：Python 服务进程可能因为以下原因未正确终止：
- 子进程未正确清理
- 端口占用导致进程无法退出
- Windows 上的进程终止超时

**代码位置**：
- `electron_node/electron-node/main/src/python-service-manager/service-process.ts`
- `stopServiceProcess` 函数使用 `taskkill /PID /T /F` 强制终止

**潜在问题**：
- 如果 `taskkill` 失败，进程可能残留
- 5 秒超时可能不够（第 323-332 行）

### 4. esBuilder.exe 进程

**原因**：`esBuilder.exe` 是 `electron-builder` 的打包工具进程。

**可能场景**：
- 打包过程中断
- 打包配置错误导致进程挂起
- 打包后未清理临时进程

**相关文件**：
- `electron_node/electron-node/electron-builder.yml`
- `electron_node/electron-node/package.json` 中的打包脚本

## 解决方案

### 方案 1：使用清理脚本（推荐）

运行清理脚本：

```powershell
.\scripts\cleanup_orphaned_processes.ps1
```

该脚本会：
1. 扫描所有相关进程
2. 显示进程详细信息
3. 确认后清理进程
4. 验证清理结果

### 方案 2：手动清理

#### 清理 Node.js 进程

```powershell
# 查找 Node.js 进程
Get-Process -Name "node" | Where-Object { $_.Path -notlike "*\Windows\*" }

# 终止所有 Node.js 进程（谨慎使用）
Get-Process -Name "node" | Where-Object { $_.Path -notlike "*\Windows\*" } | Stop-Process -Force
```

#### 清理 Python 进程

```powershell
# 查找 Python 进程
Get-Process -Name "python*" | Where-Object { $_.Path -notlike "*\Windows\*" }

# 终止所有 Python 进程（谨慎使用）
Get-Process -Name "python*" | Where-Object { $_.Path -notlike "*\Windows\*" } | Stop-Process -Force
```

#### 清理 esBuilder 进程

```powershell
# 查找并终止 esBuilder 进程
Get-Process -Name "esBuilder*" | Stop-Process -Force
```

### 方案 3：改进清理逻辑（长期方案）

#### 3.1 增强进程终止逻辑

在 `python-service-manager/service-process.ts` 中：

```typescript
// 增加超时时间
setTimeout(async () => {
  if (child.exitCode === null && !child.killed) {
    logger.warn({ serviceName, pid, port }, `Service did not stop within 10 seconds, forcing termination`);
    // 使用更强制的方式
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', pid.toString(), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  }
}, 10000); // 从 5 秒增加到 10 秒
```

#### 3.2 添加进程监控

在应用启动时，检查并清理残留进程：

```typescript
// 在 index.ts 启动时添加
async function cleanupOrphanedProcesses() {
  // 检查是否有残留的 Python 服务进程
  // 检查端口占用情况
  // 清理残留进程
}
```

#### 3.3 改进测试清理

在测试文件中确保清理：

```typescript
afterAll(async () => {
  // 确保所有服务都被清理
  await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager);
  
  // 等待进程完全退出
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 验证进程已退出
  const remainingProcesses = await checkRemainingProcesses();
  if (remainingProcesses.length > 0) {
    console.warn('警告：仍有进程残留', remainingProcesses);
  }
});
```

## 预防措施

### 1. 定期运行清理脚本

在集成测试后，运行清理脚本：

```powershell
.\scripts\cleanup_orphaned_processes.ps1
```

### 2. 使用任务管理器监控

在任务管理器中监控：
- Node.js 进程数量
- Python 进程数量
- 内存使用情况

### 3. 改进退出处理

确保应用正常退出：
- 使用 `Ctrl+C` 而不是强制关闭
- 在开发环境中，使用 `npm run dev` 而不是直接运行可执行文件

### 4. 添加进程监控日志

在服务启动和停止时记录 PID：

```typescript
logger.info({ pid: process.pid, serviceName }, 'Service started');
logger.info({ pid: process.pid, serviceName }, 'Service stopped');
```

## 相关文件

- `scripts/cleanup_orphaned_processes.ps1` - 清理脚本
- `electron_node/electron-node/main/src/service-cleanup.ts` - 清理逻辑
- `electron_node/electron-node/main/src/python-service-manager/service-process.ts` - Python 服务进程管理
- `electron_node/electron-node/main/src/index.ts` - 主入口文件

## 检查清单

- [ ] 运行清理脚本清理残留进程
- [ ] 检查应用退出逻辑是否正确
- [ ] 检查测试代码是否正确清理
- [ ] 检查 Python 服务进程终止逻辑
- [ ] 检查 esBuilder 打包配置
- [ ] 添加进程监控日志
- [ ] 改进进程终止超时时间

