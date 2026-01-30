# 🚨 关键修复 - Services目录查找问题

## 问题根因

编译后的代码从 `main/electron-node/main/src/app/` 运行，路径层级太深（5层），向上查找 `services` 目录时：

```
__dirname = D:\Programs\github\lingua_1\electron_node\electron-node\main\electron-node\main\src\app
向上1层 → main\src\services ❌
向上2层 → main\services ❌
向上3层 → electron-node\services ❌
... 最多10层
```

**正确的services目录在**: `D:\Programs\github\lingua_1\electron_node\services`

但查找逻辑在达到之前就可能停止或找到错误的空目录。

---

## ✅ 修复内容

### 1. 改进services目录查找逻辑

**之前**:
```typescript
const testPath = path.join(currentDir, 'services');
if (fs.existsSync(testPath)) {
  return testPath;  // ❌ 只检查目录存在，可能找到空目录
}
```

**修复后**:
```typescript
const servicesPath = path.join(currentDir, 'services');
if (fs.existsSync(servicesPath)) {
  const entries = fs.readdirSync(servicesPath);
  const hasServiceJson = entries.some(entry => {
    const serviceJsonPath = path.join(servicesPath, entry, 'service.json');
    return fs.existsSync(serviceJsonPath);  // ✅ 确保包含实际的服务
  });
  
  if (hasServiceJson) {
    return servicesPath;
  }
}
```

**关键改进**:
- ✅ 增加查找深度：10层 → 15层
- ✅ 验证目录内容：必须包含至少一个 `service.json` 文件
- ✅ 添加警告日志：找不到时记录 "Could not find services directory"

### 2. 改进前端错误处理

**之前**:
```typescript
const status = await window.electronAPI.getNodeStatus();
const resources = await window.electronAPI.getSystemResources();
setNodeStatus(status);
setSystemResources(resources);
// ❌ API调用失败时没有捕获，导致state一直是null
```

**修复后**:
```typescript
try {
  const status = await window.electronAPI.getNodeStatus();
  setNodeStatus(status);
} catch (error) {
  console.error('Failed to fetch node status:', error);  // ✅ 错误会显示在DevTools
}

try {
  const resources = await window.electronAPI.getSystemResources();
  setSystemResources(resources);
} catch (error) {
  console.error('Failed to fetch system resources:', error);  // ✅ 错误会显示在DevTools
}
```

---

## 🚀 立即验证修复

### 步骤1: 启动应用

```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### 步骤2: 查看终端日志（关键！）

**应该看到**:
```
[时间] ========================================
[时间]    使用新的简化服务层架构
[时间] ========================================
[时间] Using project services directory (development mode) { servicesDir: 'D:\\Programs\\github\\lingua_1\\electron_node\\services' }
[时间] Initializing service layer
[时间] Service layer initialized { serviceCount: 9, serviceIds: [...] }
[时间] System resource IPC handlers registered
[时间] ========================================
[时间]    应用初始化完成（新架构）
[时间] ========================================
```

**如果看到** "Could not find services directory in project, falling back to userData":
- 说明查找逻辑还是没找到正确目录
- 需要手动设置环境变量：`$env:SERVICES_DIR="D:\Programs\github\lingua_1\electron_node\services"`

### 步骤3: 打开DevTools（F12）

在Console中执行：

```javascript
// 1. 验证API
console.log(window.electronAPI);

// 2. 测试系统资源（应该返回数据，不是报错）
await window.electronAPI.getSystemResources()

// 3. 测试服务元数据
await window.electronAPI.getAllServiceMetadata()
```

**如果看到错误**，复制错误信息告诉我。

### 步骤4: 检查UI

- [ ] 左侧面板显示CPU/内存百分比（不再是"加载中..."）
- [ ] 看到"模型管理"按钮
- [ ] 左侧显示"调度服务器: 未连接"或"已连接"
- [ ] 中间面板显示服务卡片

---

## 🐛 如果还是有问题

### 问题A: 终端日志显示 "Could not find services directory"

**解决**: 设置环境变量强制指定services目录

```powershell
# 在启动前设置
$env:SERVICES_DIR="D:\Programs\github\lingua_1\electron_node\services"
npm start
```

### 问题B: DevTools Console 显示 "No handler registered"

**可能原因**: 初始化失败，handlers未注册

**检查**: 
1. 终端日志中是否有 "Failed to initialize services"
2. 是否有 "Service layer initialized"
3. 是否有 "System resource IPC handlers registered"

### 问题C: Console 显示其他错误

**请复制完整错误信息**，包括堆栈跟踪，这样我能准确诊断。

---

## 📊 修复总结

| 修复项 | 状态 | 说明 |
|--------|------|------|
| services目录查找 | ✅ | 增加深度+验证内容 |
| 前端错误处理 | ✅ | 捕获并显示错误 |
| 主进程编译 | ✅ | 成功，0 errors |
| 渲染进程编译 | ✅ | 成功，166.58 KB |

---

## 💡 备用方案

如果上述修复仍然无效，可以直接强制使用环境变量：

**创建启动脚本** `start-with-services.ps1`:

```powershell
# 设置services目录
$env:SERVICES_DIR="D:\Programs\github\lingua_1\electron_node\services"

# 启动应用
npm start
```

然后运行：
```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
.\start-with-services.ps1
```

---

**完成时间**: 2026-01-20  
**修复类型**: ✅ **关键修复 - Services目录查找 + 错误处理**

---

**🚀 请立即启动应用（npm start），并告诉我：**
1. **终端日志**（特别是"Using project services directory"这一行）
2. **DevTools Console 的错误**（如果有）
3. **UI的实际显示效果**

这次应该能正常工作了！🎉
