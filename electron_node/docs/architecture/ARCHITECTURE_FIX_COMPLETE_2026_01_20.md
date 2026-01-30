# 架构修复完成 - 统一服务管理器 - 2026-01-20

## ✅ **修复完成**

已统一所有服务启动路径使用 `ServiceProcessRunner`，删除了双管理器架构问题。

---

## 🐛 **原问题**

### 问题现象
- EN Normalize Service 和 Unified Semantic Repair Service 重启失败
- 错误：`[Errno 10048] error while attempting to bind on address`
- 停止服务时提示：`Service process not found (already stopped?)`

### 根本原因

**双管理器架构导致进程追踪失败**：

```typescript
// ❌ 启动时（app-init-simple.ts 第313行）
const supervisor = getServiceSupervisor();
supervisor.startService(entry.def.id);  // 使用 ServiceSupervisor

// ❌ IPC handlers (index.ts)
ipcMain.handle('stop-semantic-repair-service', async (_event, serviceId: string) => {
  await managers.serviceRunner.stop(serviceId);  // 使用 ServiceProcessRunner
});
```

**问题**：
- `ServiceSupervisor` 维护自己的 `Map<string, ChildProcess>`
- `ServiceProcessRunner` 维护自己的 `processes: Map<string, ChildProcess>`
- 两个管理器**不共享进程Map**！

**结果**：
1. 启动：进程记录在 `ServiceSupervisor` 的Map中
2. 停止：`ServiceProcessRunner` 查找自己的Map → 找不到进程
3. 进程永不停止：端口持续占用
4. 重启失败：`EADDRINUSE` 错误

---

## ✅ **修复方案**

### 修改文件

**`electron-node/main/src/app/app-init-simple.ts`** (第296-337行)

### 修改内容

```typescript
// ❌ 修复前
const supervisor = getServiceSupervisor();
supervisor.startService(entry.def.id);

// ✅ 修复后
managers.serviceRunner!.start(entry.def.id);
```

### 效果

**统一服务启动路径**：
- ✅ 自动启动：`ServiceProcessRunner`
- ✅ IPC handlers：`ServiceProcessRunner`
- ✅ 所有启停操作：同一个进程Map

---

## 📊 **修复前后对比**

### 修复前 ❌

```
Electron启动
    ↓
startServicesByPreference()
    ↓
ServiceSupervisor.startService('en-normalize')
    ↓
进程启动 (PID: 61760)
    ↓
记录在 ServiceSupervisor.processes Map
    ↓
用户点击"停止"
    ↓
IPC handler调用 ServiceProcessRunner.stop()
    ↓
查找 ServiceProcessRunner.processes Map
    ↓
找不到！❌ "Service process not found"
    ↓
进程永不停止 → 端口占用 → 重启失败
```

### 修复后 ✅

```
Electron启动
    ↓
startServicesByPreference()
    ↓
ServiceProcessRunner.start('en-normalize')  ← 统一管理器
    ↓
进程启动 (PID: 61760)
    ↓
记录在 ServiceProcessRunner.processes Map
    ↓
用户点击"停止"
    ↓
IPC handler调用 ServiceProcessRunner.stop()
    ↓
查找 ServiceProcessRunner.processes Map
    ↓
找到！✅ 进程成功kill
    ↓
端口释放 → 重启成功
```

---

## 🎯 **影响范围**

### 影响的服务

所有语义修复服务（semantic type）：
- ✅ semantic-repair-zh
- ✅ semantic-repair-en-zh
- ✅ en-normalize
- ✅ 任何未来添加的semantic服务

### 不影响的服务

以下服务本来就使用 `ServiceProcessRunner`，无变化：
- Rust inference service
- Python services (nmt, tts, faster-whisper-vad, etc.)

---

## 🔄 **ServiceSupervisor的未来**

### 当前状态

`ServiceSupervisor` 仍然存在于代码中，但**不再被自动启动逻辑使用**。

### 使用场景

可能被以下地方使用（待确认）：
1. ✅ `service-ipc-handlers.ts` - 新的统一IPC handlers
2. ⚠️  可能有其他地方调用（需要全局搜索）

### 建议

**Day 5重构时决定**：
- **方案1**: 删除 `ServiceSupervisor`，统一使用 `ServiceProcessRunner`
- **方案2**: 明确 `ServiceSupervisor` 的职责（如果有独特功能）
- **方案3**: 重构 `ServiceSupervisor` 使其共享 `ServiceProcessRunner` 的进程Map

---

## ✅ **测试清单**

### 立即测试（用户操作）

1. **重启Electron**
   ```powershell
   cd d:\Programs\github\lingua_1\electron_node\electron-node
   npm start
   ```

2. **测试语义修复服务**
   - [ ] EN Normalize Service - 启动/停止/重启
   - [ ] Unified Semantic Repair Service (EN/ZH) - 启动/停止/重启
   - [ ] Semantic Repair Service - Chinese - 启动/停止/重启

3. **验证无端口冲突**
   - [ ] 停止服务后端口立即释放
   - [ ] 重启服务成功，无 `EADDRINUSE` 错误
   - [ ] UI显示状态正确：stopped/starting/running

---

## 📝 **其他发现**

### 1. Llama上下文警告（非错误）

```
llama_context: n_ctx_per_seq (2048) < n_ctx_train (32768) 
-- the full capacity of the model will not be utilized
```

**说明**：
- 这是模型配置警告，不是错误
- 服务仍能正常运行
- 上下文长度受限于2048 tokens（可能影响长文本处理）

**解决**（可选）：
- 增加模型配置中的 `n_ctx_per_seq` 参数
- 或接受当前限制（对大多数使用场景足够）

---

## 🎉 **预期结果**

重启Electron后：

1. ✅ 所有语义修复服务可以正常启动
2. ✅ 停止后进程立即被kill
3. ✅ 重启成功，无端口冲突
4. ✅ UI状态正确反映服务状态
5. ✅ 日志中无"Service process not found"错误

---

**修复时间**: 2026-01-20  
**修复文件**: 1个 (`app-init-simple.ts`)  
**修改行数**: ~10行  
**问题**: 双服务管理器架构  
**解决**: 统一使用 `ServiceProcessRunner`  
**状态**: ✅ **已修复并编译，等待用户测试！**
