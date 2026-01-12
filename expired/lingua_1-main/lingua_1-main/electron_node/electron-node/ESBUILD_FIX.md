# ESBuild 服务崩溃问题修复指南

## 问题描述
Vite/ESBuild 服务崩溃，错误信息：`[plugin:vite:esbuild] The service is no longer running`

## 解决方案

### 方案 1：重启开发服务器（最简单）
```bash
# 1. 停止当前开发服务器（Ctrl+C）
# 2. 重新启动
npm run dev
```

### 方案 2：清理缓存后重启
```bash
# Windows PowerShell
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force renderer\node_modules\.vite -ErrorAction SilentlyContinue

# 重新启动
npm run dev
```

### 方案 3：终止所有相关进程后重启
```powershell
# 终止所有 node 和 esbuild 进程
Get-Process | Where-Object {$_.ProcessName -like "*node*" -or $_.ProcessName -like "*esbuild*"} | Stop-Process -Force

# 清理缓存
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue

# 重新启动
npm run dev
```

### 方案 4：检查并修复配置
已更新 `vite.config.ts`，添加了：
- 禁用 HMR overlay（减少崩溃风险）
- ESBuild 稳定性配置
- 优化依赖配置

### 方案 5：如果问题持续存在
1. **检查系统资源**：确保有足够的内存和 CPU
2. **检查文件大小**：确保 `ServiceManagement.tsx` 文件不是太大
3. **检查依赖版本**：确保 `vite` 和 `esbuild` 版本兼容
4. **临时禁用 HMR**：在 `vite.config.ts` 中设置 `server.hmr: false`

## 已应用的修复
- ✅ 禁用 HMR overlay（`server.hmr.overlay: false`）
- ✅ 添加 ESBuild 稳定性配置
- ✅ 优化依赖配置

## 注意事项
- ESBuild 服务崩溃通常是临时性的，重启开发服务器通常可以解决
- 如果问题频繁出现，可能需要检查系统资源或依赖版本
- 禁用 HMR overlay 后，错误信息会在浏览器控制台中显示，而不是覆盖层
