# 进程清理改进说明

## 改进内容

### 1. 增加进程终止超时时间

**位置**: `electron_node/electron-node/main/src/python-service-manager/service-process.ts`

**改进前**: 5秒超时
**改进后**: 10秒超时

**原因**: 某些 Python 服务可能需要更长时间来清理资源（如释放 GPU 内存、关闭文件句柄等）。

### 2. 改进 Windows 平台进程终止逻辑

**位置**: `electron_node/electron-node/main/src/python-service-manager/service-process.ts`

**改进内容**:
- 在超时情况下，使用 `taskkill /PID /T /F` 强制终止进程树
- 添加进程终止结果验证
- 确保 `resolve()` 在所有情况下都被调用，避免 Promise 挂起

**代码逻辑**:
```typescript
if (process.platform === 'win32' && pid) {
  const killProcess = spawn('taskkill', ['/PID', pid.toString(), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  
  killProcess.on('exit', async (code) => {
    // 验证终止结果
    // 验证端口释放
    // 调用 resolve()
  });
}
```

### 3. 添加清理超时保护

**位置**: `electron_node/electron-node/main/src/service-cleanup.ts`

**改进内容**:
- 为 Python 服务清理添加 30 秒超时保护
- 即使清理失败，也继续执行，避免阻塞应用退出

**代码逻辑**:
```typescript
const cleanupTimeout = 30000; // 30秒超时
const cleanupPromise = pythonServiceManager.stopAllServices();
const timeoutPromise = new Promise<void>((_, reject) => {
  setTimeout(() => {
    reject(new Error(`Python services cleanup timeout after ${cleanupTimeout}ms`));
  }, cleanupTimeout);
});

await Promise.race([cleanupPromise, timeoutPromise]);
```

### 4. 清理超时定时器

**位置**: `electron_node/electron-node/main/src/python-service-manager/service-process.ts`

**改进内容**:
- 当进程正常退出时，清除超时定时器，避免内存泄漏

**代码逻辑**:
```typescript
const timeoutId = setTimeout(async () => {
  // 超时处理逻辑
}, 10000);

child.once('exit', () => {
  clearTimeout(timeoutId);
});
```

## 验证方法

### 1. 正常退出测试

1. 启动 Electron 节点应用
2. 启动一些 Python 服务（如 faster-whisper-vad）
3. 正常关闭应用窗口
4. 检查进程是否被正确终止：
   ```powershell
   Get-Process -Name "python*" | Where-Object { $_.Path -notlike "*\Windows\*" }
   ```

### 2. 强制退出测试

1. 启动 Electron 节点应用
2. 启动一些 Python 服务
3. 使用任务管理器强制关闭应用
4. 运行清理脚本：
   ```powershell
   .\scripts\cleanup_orphaned_processes.ps1
   ```

### 3. 集成测试后验证

1. 运行集成测试
2. 测试结束后，检查是否有残留进程
3. 如果有，运行清理脚本

## 预期行为

### 正常退出

- 应用关闭窗口时，所有 Python 服务应在 10 秒内被终止
- 所有端口应在服务终止后释放
- 不应有残留进程

### 异常退出

- 如果应用被强制关闭，清理脚本应能清理所有残留进程
- 清理脚本应显示详细的进程信息，便于诊断

## 相关文件

- `electron_node/electron-node/main/src/python-service-manager/service-process.ts` - 进程终止逻辑
- `electron_node/electron-node/main/src/service-cleanup.ts` - 服务清理逻辑
- `electron_node/electron-node/main/src/index.ts` - 应用退出处理
- `scripts/cleanup_orphaned_processes.ps1` - 清理脚本

## 注意事项

1. **超时时间**: 如果服务在 10 秒内无法正常退出，会被强制终止。如果经常出现这种情况，可能需要检查服务本身的清理逻辑。

2. **进程树终止**: 在 Windows 上，`taskkill /T /F` 会终止整个进程树，包括所有子进程。这确保了所有相关进程都被清理。

3. **端口释放验证**: 即使进程被强制终止，也会验证端口是否已释放。如果端口仍被占用，可能需要手动检查。

4. **清理脚本**: 定期运行清理脚本可以确保没有残留进程。建议在集成测试后运行。

