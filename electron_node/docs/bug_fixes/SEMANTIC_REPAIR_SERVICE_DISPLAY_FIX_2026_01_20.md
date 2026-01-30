# 语义修复服务显示修复 - 2026-01-20

## 🐛 **问题描述**

用户报告：**在节点端UI看不到语义修复服务**

---

## 🔍 **问题分析**

### 服务发现正常

后端日志显示服务发现成功：
```
服务数量: 9
服务ID: en-normalize, faster-whisper-vad, nmt-m2m100, node-inference, 
        piper-tts, semantic-repair-en-zh, semantic-repair-zh, 
        speaker-embedding, your-tts
```

✅ **服务发现没有问题**，发现了2个语义修复服务：
- `semantic-repair-en-zh` - 统一语义修复服务（中英文+标准化）
- `semantic-repair-zh` - 中文语义修复服务

### 前端查询正常

前端代码调用正确：
```typescript
const semanticRepair = await window.electronAPI.getAllSemanticRepairServiceStatuses();
setSemanticRepairStatuses(semanticRepair || []);
```

### IPC Handler问题

**根本原因**: `get-all-semantic-repair-service-statuses` handler只是临时stub！

**问题代码** (`index.ts` Line 507-511):
```typescript
ipcMain.handle('get-all-semantic-repair-service-statuses', async () => {
  // 返回空数组，表示没有语义修复服务在运行
  // 实际状态需要通过ServiceSupervisor查询，等待初始化完成
  return [];  // ❌ 总是返回空数组！
});
```

**正确实现**在`runtime-handlers-simple.ts`中存在：
```typescript
ipcMain.handle('get-all-semantic-repair-service-statuses', async () => {
  const supervisor = getServiceSupervisor();
  if (!supervisor) {
    return [];
  }
  
  // 获取所有语义修复类型的服务
  const allServices = supervisor.listServices();
  const semanticServices = allServices.filter(s => s.def.type === 'semantic');
  
  return semanticServices.map(service => ({
    serviceId: service.def.id,
    running: service.runtime.status === 'running',
    starting: service.runtime.status === 'starting',
    pid: service.runtime.pid || null,
    port: service.def.port || null,
    startedAt: service.runtime.startedAt || null,
    lastError: service.runtime.lastError || null,
  }));
});
```

**但是`registerRuntimeHandlers()`从未被调用！**

---

## ✅ **解决方案**

### 修改1：调用registerRuntimeHandlers

**位置**: `electron-node/main/src/index.ts`

**修改**: 在服务初始化后注册Runtime handlers

```typescript
// 注册 Model IPC 处理器
registerModelHandlers(managers.modelManager);

// 注册 Runtime IPC 处理器（覆盖之前的临时stub handlers）
registerRuntimeHandlers(managers);
```

### 修改2：兼容ServiceManagers接口

**位置**: `electron-node/main/src/ipc-handlers/runtime-handlers-simple.ts`

**问题**: `registerRuntimeHandlers`期望旧的ServiceManagers接口，包含`rustServiceManager`和`pythonServiceManager`

**修改**: 将这些字段改为可选

```typescript
/**
 * 简化的服务管理器类型（兼容新旧架构）
 */
interface ServiceManagers {
  nodeAgent: any;
  modelManager: any;
  inferenceService: any;
  serviceRunner?: any; // 新架构
  endpointResolver?: any; // 新架构
  rustServiceManager?: any; // 旧架构（已废弃）
  pythonServiceManager?: any; // 旧架构（已废弃）
}
```

---

## 🎯 **修复后的效果**

### 前端UI应该显示

1. **统一语义修复服务（中英文+标准化）**
   - Service ID: `semantic-repair-en-zh`
   - 端口: 5015
   - 功能: 中文修复 + 英文修复 + 英文标准化
   - 取代: semantic-repair-zh, semantic-repair-en, en-normalize

2. **中文语义修复服务**（如果有）
   - Service ID: `semantic-repair-zh`
   - 单独的中文语义修复服务

3. **EN Normalize服务**（已弃用）
   - Service ID: `en-normalize`
   - 状态: 已弃用（enabled: false）
   - 原因: 已被semantic-repair-en-zh统一服务取代

### 服务状态同步

- ✅ 启动/停止按钮可用
- ✅ 实时状态更新（运行中/已停止）
- ✅ 显示端口号和PID
- ✅ 显示错误信息（如果有）

---

## 📝 **技术细节**

### 服务类型过滤

```typescript
const semanticServices = allServices.filter(s => s.def.type === 'semantic');
```

所有`type === 'semantic'`的服务都会被识别为语义修复服务。

### service.json配置

**semantic-repair-en-zh** (`services/semantic_repair_en_zh/service.json`):
```json
{
  "id": "semantic-repair-en-zh",
  "name": "Unified Semantic Repair Service (EN/ZH + Normalize)",
  "name_zh": "统一语义修复服务（中英文+标准化）",
  "type": "semantic",
  "port": 5015,
  "enabled": true,
  "replaces": ["semantic-repair-zh", "semantic-repair-en", "en-normalize"],
  "features": {
    "zh_repair": true,
    "en_repair": true,
    "en_normalize": true
  }
}
```

**en-normalize** (`services/en_normalize/service.json`):
```json
{
  "id": "en-normalize",
  "name": "EN Normalize Service",
  "type": "semantic",
  "port": 5012,
  "enabled": false,
  "deprecated": true,
  "deprecated_reason": "Use semantic-repair-en-zh unified service instead"
}
```

### 前端UI渲染

```typescript
{semanticRepairStatuses.map((status) => {
  const serviceId = status.serviceId;
  const displayName = getServiceDisplayName(serviceId);
  
  return (
    <div key={serviceId} className="lsm-item">
      <h3>{displayName}</h3>
      <span className={`lsm-badge ${isRunning ? 'is-running' : 'is-stopped'}`}>
        {isRunning ? '运行中' : '已停止'}
      </span>
      {/* 启动/停止开关 */}
    </div>
  );
})}
```

---

## 💡 **为什么之前stub handler返回空数组？**

### 原因

在Day 1重构时，为了快速让应用启动，在`index.ts`中注册了临时stub handlers：

```typescript
// 临时stub - 避免前端调用时报错
ipcMain.handle('get-all-semantic-repair-service-statuses', async () => {
  return []; // 空数组 - 等待后续实现
});
```

### 遗留问题

注释中写了"实际状态需要通过ServiceSupervisor查询，等待初始化完成"，但忘记在初始化后调用`registerRuntimeHandlers()`来注册真正的实现！

---

## ✅ **修复状态**

| 项目 | 状态 |
|------|------|
| 服务发现 | ✅ 正常（9个服务） |
| IPC Handler | ✅ 已修复（注册正确实现） |
| 接口兼容性 | ✅ 已修复（可选字段） |
| 编译状态 | ✅ 成功 |
| 前端显示 | ⏳ 待用户确认 |

---

## 🚀 **验证步骤**

1. **打开Electron应用**（已自动重启）
2. **查看服务管理页面**
3. **确认显示**:
   - ✅ 节点推理服务（Rust）
   - ✅ **统一语义修复服务（中英文+标准化）** ⭐ 新显示
   - ✅ FastWhisperVad语音识别服务
   - ✅ NMT翻译服务
   - ✅ TTS语音合成（Piper）
   - ✅ （可能还有其他服务）

4. **测试功能**:
   - 点击启动/停止开关
   - 观察状态变化
   - 确认端口号显示

---

**修复时间**: 2026-01-20  
**问题类型**: IPC Handler stub未替换为真实实现  
**影响范围**: 所有语义修复服务无法显示  
**修复方法**: 调用registerRuntimeHandlers()注册真实handler  
**相关文件**: 
- `electron-node/main/src/index.ts` - 添加registerRuntimeHandlers()调用
- `electron-node/main/src/ipc-handlers/runtime-handlers-simple.ts` - 接口兼容性修复
