# Service Not Found 问题诊断 - 2026-01-20

## 🔍 **问题分析**

用户报告：服务能显示在列表里，但点击启动时提示 "service not found"

### 可能的原因

1. **ServiceID不匹配** - 前端传递的ID与Registry中的不一致
2. **Registry未初始化** - 但不太可能（服务能显示说明已扫描）
3. **IPC Handler问题** - 调用了错误的handler
4. **JSON格式问题** - semantic_repair_en_zh的JSON有编码问题

---

## 📊 **验证结果**

从验证脚本输出：

```
✅ en_normalize: id=en-normalize, port=5012
✅ faster_whisper_vad: id=faster-whisper-vad, port=6007
✅ nmt_m2m100: id=nmt-m2m100, port=5008
✅ node-inference: id=node-inference, port=
✅ piper_tts: id=piper-tts, port=5009
⚠️  semantic_repair_en_zh: JSON解析错误（编码问题）
✅ semantic_repair_zh: id=semantic-repair-zh, port=5013
✅ speaker_embedding: id=speaker-embedding, port=5014
✅ your_tts: id=your-tts, port=5016
```

---

## 🔧 **需要检查的内容**

### 1. 前端传递的ServiceID

**请在Electron DevTools (F12) Console中运行**:

```javascript
// 查看服务列表
const services = await window.electron.serviceDiscovery.list();
console.log('Services:', services.map(s => s.id));

// 尝试启动一个服务
try {
  await window.electron.serviceDiscovery.start('nmt-m2m100');
  console.log('Start success');
} catch (e) {
  console.error('Start failed:', e.message);
}
```

### 2. IPC Handler注册

检查`index.ts`中是否正确注册了启动handler。

### 3. Registry内容

**在Electron控制台Console运行**:

```javascript
// 获取所有服务
const services = await window.electron.serviceDiscovery.list();
console.table(services.map(s => ({
  id: s.id,
  name: s.name,
  status: s.status,
  port: s.port
})));
```

---

## 🎯 **临时诊断方案**

### 方案1: 检查具体是哪个服务

**请告知**:
- 您尝试启动的是哪个服务？
- 服务在列表中显示的名称是什么？
- Console中的完整错误是什么？

### 方案2: 检查IPC调用

在DevTools Console中：
1. 打开Network标签
2. 点击启动服务
3. 查看IPC请求和参数

---

## ⚡ **快速修复尝试**

### 修复1: 清理并重启

```powershell
# 1. Kill所有Python进程
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 重新编译（确保使用最新代码）
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main

# 3. 重启
npm start
```

### 修复2: 点击"刷新服务"

在UI中点击"刷新服务"按钮，让服务发现重新扫描service.json。

---

## 📋 **需要的信息**

为了精确定位问题，请提供：

1. **具体服务名称** - 是哪个服务报"service not found"？
2. **DevTools Console截图** - 显示完整错误
3. **服务列表截图** - 显示所有服务的ID和状态
4. **点击启动时的Console输出**

---

**状态**: 等待更多信息以精确诊断  
**优先级**: 🔴 高
