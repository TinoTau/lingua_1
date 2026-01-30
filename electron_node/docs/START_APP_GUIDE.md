# 🚀 应用启动指南

## 快速启动（3步）

### 步骤1: 打开新的PowerShell窗口

按 `Win + X` 选择 "Windows PowerShell" 或 "终端"

### 步骤2: 导航到项目目录

```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
```

### 步骤3: 启动应用

```powershell
npm start
```

---

## 🔍 启动后应该看到什么

### 终端输出（主进程日志）

```
[时间] ========================================
[时间]    使用新的简化服务层架构
[时间] ========================================
[时间] Initializing service layer
[时间] Service layer initialized { serviceCount: 9 }
[时间] [RuntimeHandlers] Runtime IPC handlers registered (simplified)
[时间] System resource IPC handlers registered
[时间] ========================================
[时间]    应用初始化完成（新架构）
[时间] ========================================
```

### Electron窗口

- ✅ 窗口打开
- ✅ 左侧面板显示CPU/内存使用率
- ✅ 看到"模型管理"按钮
- ✅ 服务管理页面显示服务卡片

---

## 🐛 常见问题

### Q: 窗口打开了，但UI显示"加载中..."

**A**: 按F12打开DevTools，在Console中查看错误信息

### Q: 终端显示 "Failed to initialize services"

**A**: 查看完整的错误信息，可能是services目录问题

### Q: 没有看到"模型管理"按钮

**A**: 
1. 打开DevTools (F12)
2. 在Console中执行: `window.electronAPI`
3. 如果是undefined，说明preload脚本未加载

---

## 💡 诊断命令

在DevTools Console中执行以下命令来诊断：

```javascript
// 1. 验证API
console.log(window.electronAPI);

// 2. 测试系统资源
await window.electronAPI.getSystemResources()

// 3. 测试服务元数据  
await window.electronAPI.getAllServiceMetadata()

// 4. 测试服务发现
await window.electronAPI.serviceDiscovery.list()
```

---

## 📋 如果需要重新编译

```powershell
# 清理旧的编译产物
Remove-Item -Recurse -Force main\electron-node, renderer\dist

# 重新编译
npm run build

# 启动
npm start
```

---

**准备好了吗？现在就启动应用吧！** 🎉

```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```
