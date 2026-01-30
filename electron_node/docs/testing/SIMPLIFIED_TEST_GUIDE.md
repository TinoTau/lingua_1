# 🧪 简化测试指南 - 白屏诊断

## 当前状态

✅ **App.tsx已替换为最简化测试版本**

这个版本只有30行代码，不依赖任何复杂组件，用于验证：
1. React渲染是否正常
2. Vite是否正常编译
3. electronAPI是否正常工作

---

## 🔍 现在请检查Electron窗口

### 情况1: 看到"测试页面 - 简化版" ✅

**说明**: React渲染正常，白屏问题已解决！

**下一步**: 
1. 点击"测试API调用"按钮
2. 查看弹窗和Console输出
3. 如果API正常，逐步恢复完整界面

### 情况2: 还是白屏 ❌

**说明**: 问题不在前端代码，而在：
- Electron无法连接到Vite服务器
- 或preload脚本未加载

**检查**:
1. 在DevTools Console中查看`window.location.href`
2. 应该是 `http://localhost:5176/`
3. 如果不是，说明window-manager的tryPorts没有生效

### 情况3: 看到页面但按钮无反应 ⚠️

**说明**: React正常，但electronAPI有问题

**检查**: 打开DevTools查看错误信息

---

## 🔧 如果还是白屏的解决方案

### 方案A: 手动刷新Electron窗口

在Electron窗口中按 `Ctrl+R` 或 `F5` 刷新页面。

### 方案B: 重启Electron

```bash
# 停止Electron
taskkill /F /IM electron.exe

# 重新启动
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### 方案C: 检查Vite连接

在DevTools Console中执行：
```javascript
fetch('http://localhost:5176/')
  .then(r => r.text())
  .then(html => console.log('Vite响应:', html.substring(0, 200)))
  .catch(e => console.error('Vite连接失败:', e))
```

---

## 📋 测试步骤

一旦看到测试页面：

### 步骤1: 基础渲染测试
- [ ] 能看到标题"测试页面 - 简化版"
- [ ] 能看到说明文字
- [ ] 能看到两个按钮

### 步骤2: 按钮交互测试
- [ ] 点击"测试按钮"，应该弹出"按钮点击测试"

### 步骤3: API调用测试
- [ ] 点击"测试API调用"
- [ ] 查看Console输出（应该显示window.electronAPI对象）
- [ ] 应该弹窗显示"API调用成功"或具体错误

---

## 🎯 根据测试结果的下一步

### 如果测试页面正常显示且API正常 ✅

**说明**: 基础架构没问题，原App.tsx的某个组件有问题

**恢复步骤**:
1. 先恢复基本布局（不包含ModelManagement）
2. 逐个添加组件：SystemResources → NodeStatus → ServiceManagement
3. 最后添加ModelManagement
4. 找出是哪个组件导致的500错误

### 如果测试页面正常但API失败 ⚠️

**说明**: Electron连接正常，但IPC handlers有问题

**解决**: 
1. 查看主进程日志
2. 确认"System resource IPC handlers registered"
3. 检查编译后的index.js

### 如果还是白屏 ❌

**说明**: Electron根本没有连接到Vite

**解决**:
1. 手动在浏览器中打开 http://localhost:5176/
2. 如果浏览器能看到，说明window-manager的tryPorts有问题
3. 如果浏览器也看不到，说明Vite有问题

---

## 📝 当前文件状态

```
App.tsx → App.tsx.backup (原始完整版本)
App.test-simple.tsx → App.tsx (当前使用的简化版本)
```

恢复原版本：
```bash
Copy-Item renderer\src\App.tsx.backup renderer\src\App.tsx -Force
```

---

**🔍 现在请查看Electron窗口（可能需要按Ctrl+R刷新），告诉我看到了什么！**
