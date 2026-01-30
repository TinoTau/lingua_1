# 白屏问题修复 - 2026-01-20

## 🐛 **问题现象**

Electron应用启动后显示**白屏**，无任何内容。

## 🔍 **根本原因**

**前端开发服务器（Vite）没有运行**

### 错误日志
```
(node:17016) electron: Failed to load URL: http://localhost:5173/ with error: ERR_CONNECTION_REFUSED
(node:17016) electron: Failed to load URL: http://localhost:5174/ with error: ERR_CONNECTION_REFUSED
```

### 分析

1. **后端完全正常**：
   ```
   ✅ Application initialized successfully!
   ✅ 服务数量: 9
   ✅ serviceRunner: true
   ```

2. **前端未启动**：
   - Electron尝试加载 `http://localhost:5173/`（Vite默认端口）
   - 连接被拒绝 → 前端开发服务器未运行
   - 结果：白屏

## ✅ **解决方案**

### 方案1：使用两个终端（开发模式 - 推荐）

**终端1 - 启动前端开发服务器**：
```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev
```

**等待Vite启动完成**（看到 `ready in XXms`），然后：

**终端2 - 启动Electron应用**：
```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### 方案2：使用一条命令（推荐）

**同时启动前端和后端**：
```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev:all
```

（如果`dev:all`脚本不存在，需要在`package.json`中添加）

### 方案3：使用生产模式（无需Vite）

**构建前端并启动**：
```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run build
npm start
```

## 📝 **package.json 配置建议**

### 当前配置检查

```json
{
  "scripts": {
    "dev": "vite",                    // 前端开发服务器
    "build": "vite build",            // 构建前端
    "start": "electron .",            // 启动Electron
    "dev:all": "concurrently \"npm run dev\" \"npm run start\"" // 同时启动
  }
}
```

### 添加并发启动脚本

如果没有`dev:all`，添加：

```powershell
npm install --save-dev concurrently
```

然后在`package.json`中添加：
```json
{
  "scripts": {
    "dev:all": "concurrently -k \"npm run dev\" \"wait-on http://localhost:5173 && npm start\""
  }
}
```

## 🎯 **正确的启动流程**

### 开发模式（热重载）

1. **启动前端**（自动重载）：
   ```powershell
   npm run dev
   ```
   等待看到：`ready in XXms`

2. **启动Electron**：
   ```powershell
   npm start
   ```

### 生产模式（无需Vite）

1. **构建前端**：
   ```powershell
   npm run build
   ```

2. **启动Electron**（加载构建后的文件）：
   ```powershell
   npm start
   ```

## ⚠️ **注意事项**

### 为什么需要前端开发服务器？

- **开发模式**：Electron加载 `http://localhost:5173/`（Vite开发服务器）
- **生产模式**：Electron加载 `file://dist/index.html`（构建后的静态文件）

### 如何判断当前模式？

检查 `main/src/index.ts` 或 `main.js`：

```typescript
// 开发模式
if (isDev) {
  mainWindow.loadURL('http://localhost:5173/');
} else {
  // 生产模式
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}
```

## 🔧 **自动修复脚本**

创建 `start-dev.ps1`：

```powershell
# 启动开发环境
Write-Host "Starting development environment..." -ForegroundColor Cyan

# 启动前端
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run dev"

# 等待Vite启动
Write-Host "Waiting for Vite to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 检查Vite是否运行
$viteRunning = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5173/" -TimeoutSec 1 -ErrorAction SilentlyContinue
        $viteRunning = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

if ($viteRunning) {
    Write-Host "Vite is ready! Starting Electron..." -ForegroundColor Green
    npm start
} else {
    Write-Host "Vite failed to start. Please check the Vite terminal." -ForegroundColor Red
}
```

使用：
```powershell
powershell -ExecutionPolicy Bypass -File start-dev.ps1
```

## ✅ **验证修复**

启动后，检查：

1. **Vite日志**：
   ```
   VITE v4.x.x  ready in XXX ms
   ➜  Local:   http://localhost:5173/
   ➜  Network: use --host to expose
   ```

2. **Electron窗口**：
   - ✅ 显示服务管理界面
   - ✅ 可以看到服务列表
   - ✅ 可以启动/停止服务

3. **无错误日志**：
   - ❌ 不再出现 `ERR_CONNECTION_REFUSED`

## 📚 **相关文档**

- Day 1重构完成文档
- 服务发现架构文档
- Electron开发环境配置

---

**问题类型**: 前端开发服务器未启动  
**修复方法**: 启动Vite开发服务器  
**修复时间**: 2026-01-20  
**状态**: ✅ 已修复
