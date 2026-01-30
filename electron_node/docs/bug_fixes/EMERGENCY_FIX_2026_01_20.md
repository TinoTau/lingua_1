# 紧急修复 - Service Not Found - 2026-01-20

## 🚨 **问题诊断**

用户报告：服务能显示在列表，但点击启动报"service not found"

### 已确认的情况

1. ✅ 所有service.json的ID都正确
2. ✅ IPC handlers都已注册（没有被删除）
3. ⚠️  但启动时仍然报"service not found"

---

## 🔍 **可能的原因**

### 原因1: ServiceID映射问题

前端可能传递的是旧的服务名称（如"nmt"），但Registry中的ID是新的（如"nmt-m2m100"）。

**检查代码**（index.ts Line 427-450）:

```typescript
ipcMain.handle('start-python-service', async (_event, serviceName: string) => {
  // serviceName可能需要转换成实际的service ID
  const serviceIdMap: Record<string, string> = {
    'nmt': 'nmt-m2m100',
    'tts': 'piper-tts',
    'faster_whisper_vad': 'faster-whisper-vad',
    'speaker_embedding': 'speaker-embedding',
    'yourtts': 'your-tts',
  };
  
  const actualServiceId = serviceIdMap[serviceName] || serviceName;
  await managers.serviceRunner.start(actualServiceId);
}
```

**如果映射不完整**：传入"xxx"，但映射表中没有，导致"service not found"

---

### 原因2: Registry未正确扫描

服务发现可能失败或部分失败。

---

### 原因3: managers.serviceRunner未初始化

虽然不太可能，但需要确认。

---

## ⚡ **立即诊断步骤**

### Step 1: 在Electron Console (F12)中运行

```javascript
// 查看所有服务
const services = await window.electron.serviceDiscovery.list();
console.log('Services found:', services.length);
console.table(services.map(s => ({ id: s.id, name: s.name, status: s.status })));

// 尝试使用正确的ID启动
try {
  await window.electron.serviceDiscovery.start('nmt-m2m100');
  console.log('Success!');
} catch (e) {
  console.error('Error:', e);
}
```

### Step 2: 查看完整错误

点击启动服务时，查看Console的完整错误输出（包括stack trace）。

---

## 🔧 **可能的修复**

### 修复1: 更新ServiceID映射表

如果是映射问题，需要在`index.ts`中更新映射表。

### 修复2: 点击"刷新服务"

让服务发现重新扫描所有service.json。

---

## 📋 **需要的信息**

请提供：

1. **具体服务名称** - 哪个服务报"service not found"？
2. **Devtools Console输出**:
   ```javascript
   const services = await window.electron.serviceDiscovery.list();
   console.log(services.map(s => s.id));
   ```
3. **完整错误堆栈** - Console中的完整错误信息

有了这些信息我就能精确修复！

---

**状态**: 等待诊断信息  
**优先级**: 🔴 紧急
