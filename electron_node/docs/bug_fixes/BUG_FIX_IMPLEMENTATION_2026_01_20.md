# Bug修复实施 - 2026-01-20

## 🐛 **问题总结**

1. ❌ 服务停止后再启动报错：`Process exited with code 1`
2. ❌ 刷新服务按钮无反应

---

## 🔍 **根本原因分析**

### 问题1: 服务启动失败（exit code 1）

**根本原因**: 
- 服务进程启动后，在初始化阶段（`Waiting for application startup`）出错
- **最可能的原因**: 端口仍被旧进程占用，或环境变量/工作目录问题

**证据**:
```
INFO: Started server process [135208]
INFO: Waiting for application startup
Process exited with code 1 (signal: null)
```

这表明：
1. ✅ uvicorn成功启动（进程创建成功）
2. ✅ 分配了PID（135208）
3. ❌ FastAPI应用初始化失败（exit code 1）

**可能的具体原因**:
1. **端口占用** - 旧进程未完全释放端口
2. **模型加载失败** - 模型文件路径或权限问题
3. **依赖导入失败** - Python包问题
4. **工作目录错误** - 服务找不到必需文件

---

### 问题2: 刷新按钮无反应

**根本原因**: 
- IPC handler虽然注册了，但可能：
  1. 前端调用方式不对
  2. Handler执行很慢但没有loading状态
  3. Handler返回的数据格式前端无法处理

---

## 🔧 **修复方案**

### 修复1: 改进停止逻辑 - 确保端口释放

**文件**: `ServiceProcessRunner.ts`

**问题**: 当前stop()等待进程exit事件，但可能端口还没释放

**修复**:

```typescript
async stop(serviceId: string): Promise<void> {
  const entry = this.registry.get(serviceId);
  if (!entry) {
    throw new Error(`Service not found: ${serviceId}`);
  }

  const proc = this.processes.get(serviceId);
  if (!proc) {
    logger.warn({ serviceId }, 'Service process not found (already stopped?)');
    entry.runtime.status = 'stopped';
    entry.runtime.pid = undefined;
    entry.runtime.port = undefined;  // ✅ 清理port
    entry.runtime.startedAt = undefined;  // ✅ 清理startedAt
    return;
  }

  logger.info({ serviceId, pid: proc.pid }, '🛑 Stopping service');
  
  // ✅ 1. 设置状态为stopping
  entry.runtime.status = 'stopping';

  // 2. 尝试优雅关闭
  proc.kill('SIGTERM');

  // 3. 等待进程退出
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn({ serviceId, pid: proc.pid }, 'Service did not stop gracefully, force killing');
      proc.kill('SIGKILL');
      resolve();
    }, 5000);

    proc.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  
  // ✅ 4. 如果有端口，等待端口释放
  const port = entry.def.port;
  if (port) {
    logger.info({ serviceId, port }, 'Waiting for port to be released...');
    await this.waitForPortRelease(port, 3000);  // 最多等3秒
  }

  // 5. 清理状态
  this.processes.delete(serviceId);
  entry.runtime.status = 'stopped';
  entry.runtime.pid = undefined;
  entry.runtime.port = undefined;
  entry.runtime.startedAt = undefined;

  logger.info({ serviceId }, '✅ Service stopped and cleaned up');
}

/**
 * 等待端口释放
 */
private async waitForPortRelease(port: number, maxWaitMs: number): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      // 尝试连接端口，如果失败说明端口已释放
      await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(500)
      });
      // 端口仍被占用，继续等待
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch {
      // 端口已释放
      logger.info({ port }, '✅ Port released');
      return;
    }
  }
  
  logger.warn({ port, maxWaitMs }, '⚠️ Port may still be in use after timeout');
}
```

---

### 修复2: 启动前检查端口

**在start()方法开头添加**:

```typescript
async start(serviceId: string): Promise<void> {
  const entry = this.registry.get(serviceId);
  if (!entry) {
    throw new Error(`Service not found: ${serviceId}`);
  }

  // ✅ 检查端口是否可用
  const port = entry.def.port;
  if (port) {
    const isPortFree = await this.isPortFree(port);
    if (!isPortFree) {
      const errorMsg = `Port ${port} is already in use, cannot start service`;
      logger.error({ serviceId, port }, errorMsg);
      entry.runtime.status = 'error';
      entry.runtime.lastError = errorMsg;
      throw new Error(errorMsg);
    }
  }

  // ... 现有的启动逻辑
}

/**
 * 检查端口是否空闲
 */
private async isPortFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000)
    });
    return false; // 端口被占用
  } catch {
    return true; // 端口空闲
  }
}
```

---

### 修复3: 增强错误日志

**在spawn后的stderr处理中**:

```typescript
proc.stderr?.on('data', (data) => {
  const output = data.toString().trim();
  if (output) {
    console.error(`[child-stderr] [${serviceId}]`, output);
    logger.error({ serviceId, pid: proc.pid }, `[stderr] ${output}`);  // ✅ 改为error级别
    
    // ✅ 保存完整的stderr（不只是前1000字符）
    if (!entry.runtime.lastError) {
      entry.runtime.lastError = output;
    } else {
      entry.runtime.lastError += '\n' + output;
    }
    
    // ✅ 限制总长度
    if (entry.runtime.lastError.length > 5000) {
      entry.runtime.lastError = entry.runtime.lastError.slice(-5000);
    }
  }
});
```

---

### 修复4: 刷新按钮反馈

**前端需要添加loading状态**（如果还没有）:

```typescript
const [isRefreshing, setIsRefreshing] = useState(false);

const handleRefresh = async () => {
  setIsRefreshing(true);
  try {
    await window.electron.serviceDiscovery.refresh();
    // 刷新成功后重新加载服务列表
    loadServices();
  } catch (error) {
    console.error('Refresh failed:', error);
    // 显示错误提示
  } finally {
    setIsRefreshing(false);
  }
};

// 按钮
<button 
  onClick={handleRefresh} 
  disabled={isRefreshing}
>
  {isRefreshing ? '刷新中...' : '刷新服务'}
</button>
```

---

## 🚨 **立即诊断步骤**

### Step 1: 检查端口占用

```powershell
# 检查哪些端口被占用
netstat -ano | findstr "8001 8002 8003 8100 8101"

# 如果有占用，kill对应进程
# 例如：Stop-Process -Id <PID> -Force
```

### Step 2: 完全清理后重试

```powershell
# 1. Kill所有Python进程
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 等待端口释放
Start-Sleep -Seconds 3

# 3. 验证端口已释放
netstat -ano | findstr "8001 8002 8003"
# 应该没有输出

# 4. 重启Electron
# (关闭Electron窗口，然后)
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### Step 3: 查看详细错误

**打开Electron DevTools (F12)**:
1. 查看Console是否有错误
2. 点击刷新按钮，观察Network标签的请求
3. 检查是否有未捕获的异常

**查看Electron日志**:
```powershell
# 查看最后100行
Get-Content "d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log" -Tail 100

# 搜索错误
Select-String -Path "d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log" -Pattern "error|Error|ERROR" | Select-Object -Last 20
```

---

## 📋 **需要的信息**

为了精确修复，请提供：

1. **具体服务名称**: 
   - 是哪个服务出错？（NMT/TTS/VAD/语义修复？）

2. **端口状态**:
   ```powershell
   netstat -ano | findstr "800"
   ```

3. **Python进程**:
   ```powershell
   Get-Process python -ErrorAction SilentlyContinue | Format-Table Id, StartTime
   ```

4. **Electron Console输出**:
   - 打开DevTools (F12)
   - 点击刷新按钮
   - 截图Console输出

5. **完整错误日志**:
   - 从服务停止到再次启动的完整日志
   - Electron console的所有红色错误

---

## ⚡ **临时解决方案（立即可用）**

### 解决方案1: 强制清理脚本

```powershell
# 创建清理脚本
@"
# Kill all Python processes
Write-Host "Killing Python processes..." -ForegroundColor Yellow
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force

# Wait for port release
Write-Host "Waiting for ports to release..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Verify
Write-Host "Checking remaining processes..." -ForegroundColor Cyan
Get-Process python -ErrorAction SilentlyContinue

Write-Host "Checking port usage..." -ForegroundColor Cyan
netstat -ano | findstr "8001 8002 8003 8100 8101"

Write-Host "`nCleanup complete! You can now restart Electron." -ForegroundColor Green
"@ | Out-File d:\Programs\github\lingua_1\force_cleanup.ps1

# 运行清理
powershell -ExecutionPolicy Bypass -File d:\Programs\github\lingua_1\force_cleanup.ps1
```

### 解决方案2: 服务重启流程

**在UI中**:
1. 停止服务
2. **等待5-10秒**（让端口完全释放）
3. 再次启动

---

## 🎯 **下一步**

1. **立即**: 运行Step 2的完全清理
2. **提供**: 上述需要的信息
3. **我会**: 根据信息实施精确修复
4. **验证**: 测试修复效果

---

**优先级**: 🔴 **紧急**  
**影响**: 核心功能无法使用  
**状态**: 等待详细信息，准备实施修复
