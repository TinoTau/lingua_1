# 紧急Bug修复 - 2026-01-20

## 🐛 **发现的问题**

用户报告：
1. ❌ 关闭服务后再启动会报错
2. ❌ 日志显示：`Process exited with code 1 (signal: null)`
3. ❌ 点击"刷新服务"按钮没有任何反应

---

## 🔍 **问题分析**

### 问题1: 服务启动失败（exit code 1）

**症状**:
```
INFO: Started server process [135208]
INFO: Waiting for application startup
Process exited with code 1 (signal: null)
```

**可能原因**:
1. **端口未释放** - 服务停止后端口仍被占用
2. **进程未完全kill** - 旧进程还在运行
3. **Python环境问题** - 依赖或环境变量问题
4. **服务内部错误** - 服务代码启动失败

**需要检查**:
- 停止逻辑是否正确kill进程
- 端口是否被释放
- 服务的stderr输出（真实错误信息）

---

### 问题2: 刷新按钮无反应

**可能原因**:
1. IPC handler未正确注册
2. 前端没有正确调用IPC
3. handler执行出错但未返回错误

**需要检查**:
- `services:refresh` handler是否存在
- 是否有错误日志
- 前端调用代码

---

## 🚨 **诊断步骤**

### Step 1: 检查具体是哪个服务

**请告知**:
- 是哪个服务出错？（NMT/TTS/VAD/语义修复？）
- 错误发生的完整步骤

### Step 2: 检查进程和端口

```powershell
# 检查Python进程
Get-Process python -ErrorAction SilentlyContinue | Format-Table Id, StartTime

# 检查端口占用
netstat -ano | findstr "8001 8002 8003 8100 8101"
```

### Step 3: 查看详细日志

```powershell
# 查看Electron日志最后100行
Get-Content "d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log" -Tail 100

# 或者打开Electron DevTools (F12) 查看Console
```

### Step 4: 手动测试服务

```powershell
# 假设是NMT服务
cd d:\Programs\github\lingua_1\electron_node\services\nmt_m2m100

# 先kill所有Python进程
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force

# 手动启动服务
python nmt_service.py

# 观察错误信息
```

---

## 🔧 **可能的修复方案**

### 修复1: 改进停止逻辑（确保进程完全终止）

**ServiceProcessRunner.ts - stop()方法**

需要确保：
1. 发送SIGTERM
2. 等待进程退出
3. 如果超时，强制kill
4. 清理状态

### 修复2: 添加端口检查

在启动前检查端口是否被占用：

```typescript
private async isPortAvailable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000)
    });
    return false; // 端口被占用
  } catch {
    return true; // 端口可用
  }
}
```

### 修复3: 修复刷新按钮

检查IPC handler注册和前端调用。

---

## 📋 **请提供以下信息**

1. **具体服务名称**: 是哪个服务出错？
2. **完整错误日志**: Electron控制台的完整错误
3. **进程状态**: 
   ```powershell
   Get-Process python -ErrorAction SilentlyContinue
   ```
4. **端口状态**:
   ```powershell
   netstat -ano | findstr "8001 8002 8003"
   ```
5. **刷新按钮**: 点击后Console有什么输出？

---

## ⚡ **临时解决方案**

### 方案1: 手动清理

```powershell
# 1. Kill所有Python进程
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 等待2秒
Start-Sleep -Seconds 2

# 3. 重启Electron
# (关闭现有Electron窗口)
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### 方案2: 重启前清理端口

```powershell
# 查找占用端口的进程并kill
$port = 8002  # 替换为实际端口
$process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
if ($process) {
    Stop-Process -Id $process -Force
}
```

---

## 🎯 **下一步行动**

1. **立即**: 提供上述信息（服务名、日志、进程状态）
2. **然后**: 我会针对性修复代码
3. **验证**: 测试修复后的功能

---

**优先级**: 🔴 **高** - 影响核心功能  
**状态**: 等待详细信息以进行针对性修复
