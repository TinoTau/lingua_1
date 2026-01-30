# Day 2 NodeAgent连接修复 - 2026-01-20

## 🐛 **问题**

用户启动了调度服务器，但NodeAgent未收到心跳。

## 🔍 **诊断结果**

从日志和netstat确认：
- ✅ 调度器正在运行（PID 125092, 端口 5010）
- ✅ Electron已连接到调度器（建立了TCP连接）
- ✅ NodeAgent显示"Connected to scheduler server"
- ✅ 开始注册流程："Starting node registration"
- ❌ 但注册流程之后没有日志，说明卡住了

---

## 🔧 **已完成的修复**

### 1. ✅ 添加详细日志

修改 `node-agent-registration.ts`，为每个步骤添加进度日志：

```typescript
logger.info({}, '🔵 [1/6] Getting hardware info...');
logger.info({}, '✅ [1/6] Hardware info retrieved');

logger.info({}, '🔵 [2/6] Getting installed models...');
logger.info({}, '✅ [2/6] Installed models retrieved');

logger.info({}, '🔵 [3/6] Getting installed services...');
logger.info({}, '✅ [3/6] Installed services retrieved');

logger.info({}, '🔵 [4/6] Getting capability by type...');
logger.info({}, '✅ [4/6] Capability by type retrieved');

logger.info({}, '🔵 [5/6] Detecting language capabilities...');
logger.info({}, '✅ [5/6] Language capabilities detected');

logger.info({}, '🔵 [6/6] Getting features supported...');
logger.info({}, '✅ [6/6] Features supported retrieved');

logger.info({}, '📤 Sending message to scheduler...');
logger.info({}, '✅ Registration message sent successfully');
```

### 2. ✅ 修复ServiceType映射

确保 `buildInstalledServices()` 返回正确的类型格式：

```typescript
// 返回的type字段是字符串（'asr', 'nmt'等）
// 符合InstalledService接口定义
{
  service_id: string,
  type: string,  // 不是枚举，是字符串
  device: 'gpu' | 'cpu',
  status: 'running' | 'stopped' | 'error',
  version: string
}
```

### 3. ✅ 增强快照函数日志

在 `ServicesHandlerSimple.getInstalledServices()` 中添加详细日志：

```typescript
logger.info({}, '🔍 [DEBUG] getInstalledServices called');
logger.info({
  totalCount: services.length,
  services: services.map(s => ({
    id: s.service_id,
    type: s.type,
    status: s.status
  }))
}, '🔍 [DEBUG] Service snapshot obtained');
```

---

## 🚀 **测试步骤**

### Step 1: 重启Electron

```powershell
# 关闭当前Electron
# 重启
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### Step 2: 观察日志

现在应该能看到详细的注册流程日志：

```
🔵 [1/6] Getting hardware info...
✅ [1/6] Hardware info retrieved
🔵 [2/6] Getting installed models...
✅ [2/6] Installed models retrieved
🔵 [3/6] Getting installed services...
🔍 [DEBUG] getInstalledServices called
🔍 [DEBUG] Service snapshot obtained: {...}
✅ [3/6] Installed services retrieved
🔵 [4/6] Getting capability by type...
✅ [4/6] Capability by type retrieved
🔵 [5/6] Detecting language capabilities...
✅ [5/6] Language capabilities detected
🔵 [6/6] Getting features supported...
✅ [6/6] Features supported retrieved
📤 Sending message to scheduler...
✅ Registration message sent successfully
✅ Node registered successfully (nodeId: xxx)
```

### Step 3: 查看卡住的位置

如果日志在某个步骤停止，那就是问题所在。例如：
- 如果停在"[3/6] Getting installed services"，说明快照函数有问题
- 如果停在"[5/6] Detecting language capabilities"，说明语言检测有问题

---

## 📋 **可能的问题**

### 问题1: 快照函数返回空数组

如果Registry是空的或服务未正确扫描，快照会返回空数组。

**检查**:
```javascript
// 在UI Console中运行
const services = await window.electron.serviceDiscovery.list();
console.log('Registry has', services.length, 'services');
```

### 问题2: 语言检测失败

`LanguageCapabilityDetector` 可能有问题。

### 问题3: 调度器协议不兼容

调度器可能期望不同的消息格式。

---

## 🎯 **下一步**

1. **重启Electron并观察日志**
2. **报告在哪个步骤卡住**（[1/6] 到 [6/6]）
3. **提供完整的错误信息**（如果有）

有了详细日志，我们就能精确定位问题！

---

**修复时间**: 2026-01-20  
**修改内容**: 添加详细日志 + 类型映射  
**状态**: ✅ 已编译，等待测试  
**下一步**: 用户重启并提供日志
