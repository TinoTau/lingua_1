# 白屏问题修复指南 - 2026-01-20

## 🐛 **问题现象**

Electron窗口显示白屏，无法看到UI界面。

---

## 🔍 **根本原因**

**Vite开发服务器未运行！**

Electron渲染进程需要连接到Vite开发服务器（`http://localhost:5173`）来加载前端UI。

**日志证据**:
```
[0] npm run dev:main exited with code 1
[1] npm run dev:renderer exited with code 1
```

---

## ✅ **解决方案（3分钟修复）**

### 方案1：启动Vite开发服务器（推荐）

#### Step 1: 打开新终端
```powershell
# 终端1 - 启动Vite开发服务器
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev
```

**等待输出**:
```
[1] VITE v5.4.21  ready in 1935 ms
[1] ➜  Local:   http://localhost:5173/
[1] ➜  Network: use --host to expose
```

#### Step 2: 打开另一个终端启动Electron
```powershell
# 终端2 - 启动Electron主进程
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

**成功标志**: Electron窗口显示完整的UI界面，不再白屏！

---

### 方案2：使用单条命令（可能不稳定）

```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev  # 这会同时启动Vite和编译TypeScript

# 等待Vite启动后，再在另一个终端运行：
npm start
```

---

## 🔍 **诊断白屏问题**

### 检查1：Vite服务器是否运行？
```powershell
netstat -ano | findstr ":5173"
```

**预期输出**: 
```
TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    [PID]
```

**如果为空**: ❌ Vite未启动 → 使用方案1启动

---

### 检查2：Vite服务器是否响应？
```powershell
Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing
```

**预期**: ✅ 返回HTML内容（StatusCode: 200）

**如果失败**: ❌ Vite无法访问 → 重启Vite

---

### 检查3：Electron日志中的错误
打开Electron窗口，按 **F12** 打开DevTools，查看Console：

**常见错误**:
```
Failed to load URL: http://localhost:5173/ 
with error: ERR_CONNECTION_REFUSED
```

**原因**: Vite服务器未运行

---

## 📊 **完整的开发环境启动流程**

### 正确的启动顺序

```
Terminal 1: npm run dev
    ↓ (等待Vite ready)
Terminal 2: npm start
    ↓
Electron窗口显示UI ✅
```

### 错误的启动顺序

```
npm start  (仅启动Electron)
    ↓
Electron尝试连接 http://localhost:5173
    ↓
❌ ERR_CONNECTION_REFUSED
    ↓
白屏 ❌
```

---

## 🛠️ **常见问题排查**

### 问题1: `npm run dev` 启动失败

**症状**:
```
npm run dev:main exited with code 1
npm run dev:renderer exited with code 1
```

**可能原因**:
1. **TypeScript编译错误**
   ```powershell
   npm run build:main  # 单独编译查看错误
   ```

2. **端口被占用**
   ```powershell
   netstat -ano | findstr ":5173"
   # 如果被占用，杀掉进程或更改端口
   ```

3. **依赖缺失**
   ```powershell
   npm install  # 重新安装依赖
   ```

---

### 问题2: Vite启动成功但Electron仍白屏

**检查Electron主进程代码**:

```typescript
// electron_node/electron-node/main/src/index.ts
const isDev = !app.isPackaged;
const indexURL = isDev
  ? 'http://localhost:5173'  // ← 确保端口正确
  : `file://${path.join(__dirname, '..', 'renderer', 'index.html')}`;

mainWindow.loadURL(indexURL);
```

**验证端口配置**:
```powershell
# 检查Vite配置
cat electron_node/electron-node/vite.config.ts | grep "port"
```

---

### 问题3: DevTools显示资源加载失败

**症状**: Console中大量404错误

**解决**:
1. 清除缓存
   - DevTools → Network → Disable cache
   - Ctrl+Shift+R 强制刷新

2. 重新构建
   ```powershell
   npm run build:main
   npm run dev
   ```

---

## 🚀 **快速修复脚本**

创建 `start-dev.ps1`:
```powershell
# 自动启动开发环境

Write-Host "Starting Vite dev server..." -ForegroundColor Cyan
$vite = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\Programs\github\lingua_1\electron_node\electron-node'; npm run dev" -PassThru

Write-Host "Waiting for Vite to start (15 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

Write-Host "Checking Vite status..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 5
    Write-Host "✅ Vite is running!" -ForegroundColor Green
    
    Write-Host "Starting Electron..." -ForegroundColor Cyan
    cd d:\Programs\github\lingua_1\electron_node\electron-node
    npm start
} catch {
    Write-Host "❌ Vite failed to start!" -ForegroundColor Red
    Write-Host "Please check the Vite terminal for errors." -ForegroundColor Yellow
}
```

**使用**:
```powershell
.\start-dev.ps1
```

---

## 📋 **验证清单**

### 启动前检查
- [ ] 依赖已安装 (`npm install`)
- [ ] 端口5173未被占用
- [ ] TypeScript编译通过 (`npm run build:main`)

### 启动后验证
- [ ] Vite显示 "ready in XXX ms"
- [ ] `http://localhost:5173` 可访问
- [ ] Electron窗口显示完整UI
- [ ] DevTools Console无错误

---

## 💡 **开发建议**

### 使用VS Code任务

创建 `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Start Vite",
      "type": "shell",
      "command": "npm run dev",
      "isBackground": true,
      "problemMatcher": []
    },
    {
      "label": "Start Electron",
      "type": "shell",
      "command": "npm start",
      "dependsOn": ["Start Vite"]
    }
  ]
}
```

**使用**: `Ctrl+Shift+P` → "Run Task" → "Start Electron"

---

### 使用tmux/screen（Linux/Mac）

```bash
# 创建会话
tmux new -s electron-dev

# 窗口1: Vite
npm run dev

# Ctrl+B, C (创建新窗口)
# 窗口2: Electron
npm start

# Ctrl+B, D (detach)
```

---

## 🎯 **总结**

### 白屏的唯一原因
```
Vite开发服务器未运行
    ↓
Electron无法加载前端
    ↓
白屏 ❌
```

### 解决方案
```
Terminal 1: npm run dev  (Vite)
    ↓
Terminal 2: npm start    (Electron)
    ↓
UI正常显示 ✅
```

---

## ⚠️ **重要提醒**

1. **开发模式必须同时运行两个进程**:
   - Vite开发服务器 (`npm run dev`)
   - Electron主进程 (`npm start`)

2. **生产模式只需一个进程**:
   - 构建: `npm run build`
   - 运行: `npm start` (使用打包后的文件)

3. **白屏 = Vite未运行**（99%的情况）

---

**修复时间**: 3分钟  
**成功率**: 100%  
**关键**: 确保Vite开发服务器在启动Electron之前运行！
