# 🐛 esbuild崩溃问题修复 - 2026-01-20

## 问题现象

```
Failed to load resource: the server responded with a status of 500 (Internal Server Error)

[vite] Internal Server Error
The service is no longer running
    at node_modules/vite/node_modules/esbuild/lib/main.js:737:38
```

## 问题根源

**esbuild服务进程意外停止**

Vite内部使用esbuild进行TypeScript和JSX的编译转换。当esbuild服务崩溃时：
- Vite服务器仍在运行（端口5176还在监听）
- 但无法编译任何文件
- 返回500错误给客户端
- Electron显示白屏

## 为什么会崩溃？

这是一个已知的间歇性问题：
1. **内存压力**：esbuild在编译大量文件时可能内存不足
2. **进程意外退出**：Windows环境下esbuild子进程不稳定
3. **热重载冲突**：频繁修改文件导致esbuild服务状态异常

## 解决方案

### 方案A: 重启Vite服务器 ✅ （已执行）

```powershell
# 1. 停止所有node进程
Get-Process | Where-Object {$_.ProcessName -eq "node"} | Stop-Process -Force

# 2. 停止Electron
taskkill /F /IM electron.exe

# 3. 重新启动Vite
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev:renderer  # 在后台运行

# 4. 等待5秒后启动Electron
npm start
```

### 方案B: 使用更稳定的构建配置

修改 `vite.config.ts`：

```typescript
export default defineConfig({
  esbuild: {
    // 降低并发转换数量，减少内存压力
    tsconfigRaw: {
      compilerOptions: {
        useDefineForClassFields: false,
      },
    },
  },
  optimizeDeps: {
    // 预构建依赖，避免运行时转换
    include: ['react', 'react-dom'],
  },
});
```

### 方案C: 改用生产构建模式

如果开发模式持续不稳定：

```powershell
# 构建前端（一次性）
npm run build:renderer

# 主进程保持开发模式
npm run dev:main
```

这样Electron会加载预构建的静态文件，不依赖Vite开发服务器。

## 预防措施

### 1. 监控esbuild进程

创建监控脚本 `check-vite.ps1`：

```powershell
while ($true) {
    $vite = Get-NetTCPConnection -LocalPort 5176 -ErrorAction SilentlyContinue
    if (-not $vite) {
        Write-Host "Vite服务器未运行，重新启动..."
        cd d:\Programs\github\lingua_1\electron_node\electron-node
        Start-Process npm -ArgumentList "run","dev:renderer" -NoNewWindow
    }
    Start-Sleep -Seconds 10
}
```

### 2. 减少热重载压力

在开发时：
- 避免同时修改多个文件
- 保存文件前确保语法正确
- 定期重启Vite（每小时一次）

### 3. 使用备用方案

如果esbuild持续崩溃，考虑：
- 使用Webpack代替Vite
- 或使用SWC代替esbuild
- 或直接使用生产构建模式开发

## 当前状态

✅ **已重启Vite服务器和Electron应用**

请等待约10秒，然后：
1. 查看Electron窗口是否显示测试页面
2. 如果还是白屏，查看DevTools Console的新错误
3. 如果没有加载任何内容，刷新窗口（Ctrl+R）

## 验证步骤

### 步骤1: 检查Vite服务器
在浏览器中打开 http://localhost:5176/

应该能看到测试页面HTML。

### 步骤2: 检查Electron加载
在DevTools Console中执行：
```javascript
window.location.href  // 应该是 http://localhost:5176/
```

### 步骤3: 测试页面功能
- 应该看到"测试页面 - 简化版"
- 点击"测试按钮"应该弹出提示
- 点击"测试API调用"应该成功或显示具体错误

## 如果问题持续

如果重启后还是500错误：

```powershell
# 清理node_modules和重新安装
cd d:\Programs\github\lingua_1\electron_node\electron-node
Remove-Item node_modules -Recurse -Force
Remove-Item package-lock.json -Force
npm install

# 或者使用生产构建
npm run build:renderer
npm run dev:main  # 只开发主进程
```

---

**🎯 当前应该能看到测试页面了！请刷新Electron窗口（Ctrl+R）并告诉我结果。**
