# 🔥 激进式改造进展报告 - 2026-01-20

**当前时间**: 正在进行中  
**总进度**: 40% (2/5 Phases)

---

## ✅ 已完成

### Phase 1: 创建核心模块 ✅
- ✅ `ServiceProcessRunner.ts` (统一的进程启动器)
- ✅ `ServiceEndpointResolver.ts` (endpoint解析器)
- ✅ 导出到`service-layer/index.ts`

### Phase 2: 更新app-init-simple.ts ✅  
- ✅ 移除`PythonServiceManager`和`RustServiceManager`依赖
- ✅ 移除`legacyServiceRegistryManager`兼容层
- ✅ 使用`ServiceProcessRunner`统一管理所有服务
- ✅ 使用`ServiceEndpointResolver`简化InferenceService

---

## 🚧 进行中

### Phase 3: 更新IPC Handlers (50%)
**当前状态**: `index.ts`中有大量旧的IPC handlers需要替换

**问题识别**:
```typescript
// index.ts 第108-310行：旧的IPC handlers
// 这些handlers依赖旧的managers：
- get-rust-service-status → managers.rustServiceManager ❌
- get-python-service-status → managers.pythonServiceManager ❌
- start-rust-service → managers.rustServiceManager.start() ❌
- start-python-service → managers.pythonServiceManager.startService() ❌
// ... 等等
```

**需要做的**:
1. ⏳ 创建新的统一handlers使用`ServiceProcessRunner`
2. ⏳ 替换`index.ts`中所有旧handlers
3. ⏳ 删除对`managers.rustServiceManager`和`managers.pythonServiceManager`的引用

---

## 📋 待完成

### Phase 4: 删除旧代码
- [ ] 删除`main/src/python-service-manager/index.ts`（旧实现）
- [ ] 删除`main/src/rust-service-manager/index.ts`（旧实现）
- [ ] 删除`main/src/ipc-handlers/runtime-handlers-simple.ts`（如果有重复）
- [ ] 搜索并删除所有`legacy`/`compat`相关文件

### Phase 5: 编译测试
- [ ] 运行`npm run build:main`
- [ ] 解决编译错误
- [ ] 启动应用测试
- [ ] 验证服务启动功能

---

## 🔧 下一步行动

### 立即需要做的（Phase 3完成）

**方案A: 最小修改（推荐）**
直接修改`index.ts`中的handlers，让它们使用`managers.serviceRunner`：

```typescript
// 第240行开始，修改启动handlers
ipcMain.handle('start-rust-service', async () => {
  if (!managers.serviceRunner) {
    throw new Error('Service runner not initialized');
  }
  try {
    // 从service.json找到Rust服务的ID
    const registry = getServiceRegistry();
    const rustService = Array.from(registry.values()).find(
      entry => entry.def.type === 'rust'
    );
    if (!rustService) {
      throw new Error('Rust service not found in registry');
    }
    await managers.serviceRunner.start(rustService.def.id);
    return { success: true };
  } catch (error) {
    logger.error({ error }, 'Failed to start Rust service');
    throw error; // 直接抛出，不包装
  }
});

// Python服务同理
ipcMain.handle('start-python-service', async (_event, serviceName: string) => {
  if (!managers.serviceRunner) {
    throw new Error('Service runner not initialized');
  }
  try {
    // serviceName可能是 "nmt"，需要转换成serviceId "nmt-m2m100"
    // 或者前端直接传serviceId
    await managers.serviceRunner.start(serviceName); // 假设前端传的就是serviceId
    return { success: true };
  } catch (error) {
    logger.error({ error, serviceName }, 'Failed to start Python service');
    throw error;
  }
});
```

**方案B: 彻底重构（更激进）**
1. 创建新的`unified-service-handlers.ts`
2. 提供4个核心handlers：
   - `services:list`
   - `services:start`
   - `services:stop`
   - `services:status`
3. 前端也需要修改，使用新的统一API

---

## 🎯 建议

### 优先级1: 完成Phase 3（方案A）
**理由**:
- ✅ 改动最小
- ✅ 前端不需要修改
- ✅ 可以快速验证新架构是否工作
- ✅ 保持API兼容性

**步骤**:
1. 修改`start-rust-service` handler（10行）
2. 修改`stop-rust-service` handler（10行）
3. 修改`start-python-service` handler（10行）
4. 修改`stop-python-service` handler（10行）
5. 修改状态查询handlers使用`serviceRunner.getStatus()`
6. 编译测试

**预计时间**: 0.5小时

---

### 优先级2: 验证服务启动
**验证清单**:
1. [ ] 编译成功（无TypeScript错误）
2. [ ] 应用启动成功
3. [ ] UI显示服务列表
4. [ ] 点击"启动"按钮能启动服务
5. [ ] 服务进程真的启动了（检查进程列表）
6. [ ] 服务启动失败时能看到详细错误

---

### 优先级3: 清理代码（Phase 4）
**只有在验证成功后才删除**：
1. 确认新架构完全工作
2. 所有服务都能正常启动
3. 错误能正确显示

然后删除：
- `python-service-manager/index.ts`
- `rust-service-manager/index.ts`
- 其他废弃代码

---

## 📊 当前代码状态

### 新代码
```
✅ service-layer/ServiceProcessRunner.ts       (~280行)
✅ service-layer/ServiceEndpointResolver.ts    (~100行)
✅ app/app-init-simple.ts                      (已更新)
```

### 待修改代码
```
⏳ main/src/index.ts                          (108-310行的handlers)
⏳ ipc-handlers/runtime-handlers-simple.ts    (如果还在用)
```

### 待删除代码
```
❌ python-service-manager/index.ts             (~500行)
❌ rust-service-manager/index.ts               (~400行)
❌ 各种legacy/compat文件
```

**预期净减少代码**: ~900-1500行

---

## ⚠️ 潜在问题

### 问题1: InferenceService仍依赖旧接口
**当前状态**: 
```typescript
managers.inferenceService = new InferenceService(
  managers.modelManager,
  null as any, // pythonServiceManager
  null as any, // rustServiceManager
  managers.endpointResolver as any, // 类型不匹配
  // ...
);
```

**影响**: InferenceService可能无法正常工作

**解决方案**: 
1. 暂时保持，先验证服务启动功能
2. 之后单独重构InferenceService构造函数

---

### 问题2: 前端API兼容性
**当前前端调用**:
```typescript
// ServiceManagement.tsx 可能调用:
window.electronAPI.startRustService()
window.electronAPI.startPythonService('nmt')
```

**需要确认**:
- 前端传的是`serviceName`还是`serviceId`？
- 如果是`serviceName`，需要映射到`serviceId`

---

## 🚀 准备好继续？

**现在可以做的**:
1. ✅ 修改`index.ts`的handlers（方案A）
2. ✅ 编译测试
3. ✅ 启动应用验证

**需要决策**:
- [ ] 继续完成Phase 3？
- [ ] 还是先暂停，验证当前改动？

**我的建议**: 继续完成Phase 3（20分钟内可完成），然后立即测试。

---

**准备好了就告诉我，我立即继续Phase 3！**
