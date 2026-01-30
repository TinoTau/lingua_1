# 🔍 运行时问题诊断指南

## 问题现象
- 左侧面板显示"加载中..."（资源和调度服务器状态）
- 看不到"模型管理"按钮
- 服务无法启动，报错 "No handler registered for 'start-python-service'"

## 诊断步骤

### 步骤1: 确认编译产物是最新的

```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node

# 清理旧编译产物
Remove-Item -Path "main\electron-node" -Recurse -Force -ErrorAction SilentlyContinue

# 重新编译
npm run build
```

**验证**: 
- 应该看到 `✓ Fixed ServiceType export in messages.js`
- 应该看到 `✓ built in Xs`（renderer）

### 步骤2: 使用开发模式启动

```bash
npm run dev
```

**为什么用dev模式?**
- dev模式会显示详细的控制台日志
- 可以打开DevTools查看前端错误
- 可以看到主进程的实时日志

### 步骤3: 检查DevTools控制台

启动应用后，按 `F12` 或 `Ctrl+Shift+I` 打开DevTools

**查找以下信息**:

1. **前端调用IPC的错误**:
   ```
   Error: No handler registered for 'xxx'
   ```

2. **API调用失败**:
   ```
   Failed to fetch system resources
   加载服务偏好失败
   ```

3. **Service registry 状态**:
   ```
   Loaded service metadata: {}
   ```

### 步骤4: 查看主进程日志

在终端查看主进程输出，应该看到：

```
[时间戳] ========================================
[时间戳]    使用新的简化服务层架构
[时间戳] ========================================
[时间戳] Initializing service layer
[时间戳] Service layer initialized { serviceCount: X, serviceIds: [...] }
[时间戳] [RuntimeHandlers] Runtime IPC handlers registered (simplified)
[时间戳] System resource IPC handlers registered
[时间戳] ========================================
[时间戳]    应用初始化完成（新架构）
[时间戳] ========================================
```

**如果看不到这些日志**，说明初始化失败了。

### 步骤5: 运行IPC诊断脚本

```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node
node test-ipc-handlers.js
```

**预期输出**:
```
✅ get-system-resources
✅ get-all-service-metadata
✅ start-python-service
...
总计: 28 个 handlers
已注册: 28 个
缺失: 0 个
```

**如果有缺失**，说明handlers没有正确注册。

---

## 可能的问题和解决方案

### 问题 1: 编译产物缓存

**症状**: 代码修改了但运行时没变化

**解决**:
```bash
# 完全清理
Remove-Item -Recurse -Force main\electron-node, renderer\dist

# 重新编译
npm run build

# 或直接用dev模式
npm run dev
```

### 问题 2: managers 初始化失败

**症状**: 日志显示"Failed to initialize services"

**原因**: `initializeServicesSimple()` 执行出错

**检查**:
1. `services/` 目录是否存在？
2. 是否有有效的 `service.json` 文件？
3. ServiceRegistry 是否正确初始化？

**解决**:
```bash
# 检查services目录
ls d:\Programs\github\lingua_1\electron_node\services

# 应该看到：
# nmt-m2m100/
# piper-tts/
# node-inference/
# ...
```

### 问题 3: preload脚本未加载

**症状**: `window.electronAPI` 为 `undefined`

**检查**: 在DevTools Console 中输入:
```javascript
console.log(window.electronAPI);
```

**如果是 undefined**:
1. 检查 `window-manager.ts` 中的 preload 路径
2. 确认 preload.ts 已编译到正确位置

### 问题 4: IPC调用时机问题

**症状**: handlers已注册，但调用时报错

**原因**: 前端在主进程初始化完成前就调用了IPC

**解决**: 在 `App.tsx` 中添加重试逻辑或等待

---

## 快速诊断命令

```bash
# 1. 清理并重新编译
Remove-Item -Recurse -Force d:\Programs\github\lingua_1\electron_node\electron-node\main\electron-node
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run build

# 2. 验证编译产物
Test-Path d:\Programs\github\lingua_1\electron_node\electron-node\main\electron-node\main\src\index.js

# 3. 检查services目录
ls d:\Programs\github\lingua_1\electron_node\services

# 4. 运行开发模式
npm run dev
```

---

## 对比备份代码的关键差异

### 备份代码 (expired/lingua_1-main)
```typescript
// app/app-init.ts
export function registerIpcHandlers(managers) {
  registerModelHandlers(...);
  registerServiceHandlers(...);
  registerRuntimeHandlers(...);
  
  // 直接在这里注册 get-system-resources
  ipcMain.handle('get-system-resources', async () => {
    const [cpu, mem, gpuInfo] = await Promise.all([
      si.currentLoad(),  // 使用 systeminformation 库
      si.mem(),
      getGpuUsage(),
    ]);
    // ...
  });
}
```

### 当前代码
```typescript
// index.ts
function registerSystemResourceHandlers(managers) {
  ipcMain.handle('get-system-resources', async () => {
    const cpus = os.cpus();  // 使用 Node.js 内置 os 模块
    // ...
  });
}

// 在初始化时调用
registerSystemResourceHandlers(managers);
```

**差异分析**:
- ✅ 注册位置：相同（都在managers初始化后）
- ✅ 注册时机：相同（都在app.whenReady中）
- ⚠️ 实现方式：不同（systeminformation vs os模块）

**当前实现应该是正确的**，使用os模块更简洁。

---

## 推荐的启动和验证流程

### 1. 完全清理
```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node

# 删除所有编译产物
Remove-Item -Recurse -Force main\electron-node, renderer\dist

# 删除node_modules/.cache
Remove-Item -Recurse -Force node_modules\.cache -ErrorAction SilentlyContinue
```

### 2. 重新编译
```bash
npm run build
```

### 3. 运行并诊断
```bash
# 使用dev模式（推荐）
npm run dev

# 或运行打包版本
npm start
```

### 4. 在DevTools中验证

打开DevTools Console，执行：

```javascript
// 检查 electronAPI 是否存在
console.log('electronAPI:', window.electronAPI);

// 测试 get-system-resources
window.electronAPI.getSystemResources().then(console.log).catch(console.error);

// 测试 get-all-service-metadata
window.electronAPI.getAllServiceMetadata().then(console.log).catch(console.error);

// 测试 start-python-service
window.electronAPI.startPythonService('nmt').then(console.log).catch(console.error);
```

**预期结果**:
```javascript
// getSystemResources 应该返回:
{ cpu: 35.2, memory: 52.1, gpu: null }

// getAllServiceMetadata 应该返回:
{ 
  "nmt-m2m100": { name: "...", type: "nmt", ... },
  "piper-tts": { name: "...", type: "tts", ... },
  ...
}

// startPythonService 应该返回:
{ success: true }
```

---

## 如果问题依然存在

请提供以下信息：

1. **Dev模式终端输出**（最后50行）
2. **DevTools Console 的错误信息**（截图或文本）
3. **执行以下命令的输出**:
   ```bash
   ls d:\Programs\github\lingua_1\electron_node\services
   ```

4. **在DevTools Console中执行**:
   ```javascript
   window.electronAPI
   ```
   并复制输出

---

## 已知问题排查

### 问题: "No handler registered"

**可能原因1**: 主进程初始化时抛出异常

**查看**: 终端输出中是否有 "Failed to initialize services"

**解决**: 修复初始化错误

---

**问题: electronAPI undefined**

**可能原因**: preload脚本未加载

**查看**: window-manager.ts 中的 preload 路径

**解决**: 确认路径正确

---

**问题: ServiceRegistry 为空**

**可能原因**: services 目录不存在或无service.json

**查看**: 
```bash
ls d:\Programs\github\lingua_1\electron_node\services\*/service.json
```

**解决**: 运行迁移脚本或手动创建service.json

---

**完成时间**: 2026-01-20  
**状态**: ✅ 诊断工具已创建，等待用户反馈

---

**请按照上述步骤诊断，并告诉我DevTools Console中的具体错误信息！**
