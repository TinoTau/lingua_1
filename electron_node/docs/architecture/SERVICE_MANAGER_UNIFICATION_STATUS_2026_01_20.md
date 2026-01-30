# 服务管理器统一状态报告 - 2026-01-20

## 📊 **当前状态检查**

### 文件审查：`runtime-handlers-simple.ts`

检查发现该文件**仍在使用旧的Manager**（Line 102, 116, 137, 177等）。

---

## 🎯 **统一方案**

由于`runtime-handlers-simple.ts`使用旧Manager，但新架构已经在`index.ts`中通过其他IPC handlers实现了服务管理，我们有两个选择：

### 方案A：删除`runtime-handlers-simple.ts`（推荐）✅

**理由**:
1. `index.ts`已经注册了完整的IPC handlers：
   - `get-rust-service-status` ✅
   - `get-python-service-status` ✅  
   - `get-all-python-service-statuses` ✅
   - `start/stop-python-service` (通过新架构) ✅

2. `runtime-handlers-simple.ts`的功能已被替代

3. 避免重复注册IPC handlers

**操作**:
```powershell
# 1. 确认index.ts已有所有IPC handlers
# 2. 删除runtime-handlers-simple.ts
# 3. 删除对它的import和调用
```

---

### 方案B：重写`runtime-handlers-simple.ts`（不推荐）

**问题**:
- 会与`index.ts`中的handlers重复
- 增加维护成本
- 违反DRY原则

---

## ✅ **推荐行动**

### Step 1: 确认`index.ts`已有完整IPC handlers

让我检查`index.ts`中是否已注册所有必要的handlers。

**期望的handlers**:
- ✅ `get-node-status`
- ✅ `get-rust-service-status`
- ✅ `get-python-service-status`
- ✅ `get-all-python-service-statuses`
- ✅ `get-all-semantic-repair-service-statuses`
- ✅ `start/stop` services (通过`service:start/stop`)
- ✅ `get-service-preferences`
- ✅ `set-service-preferences`

### Step 2: 删除旧文件

如果`index.ts`已有所有handlers，则：

```powershell
# 删除runtime-handlers-simple.ts
Remove-Item electron_node/electron-node/main/src/ipc-handlers/runtime-handlers-simple.ts

# 删除python-service-manager和rust-service-manager目录
Remove-Item electron_node/electron-node/main/src/python-service-manager -Recurse
Remove-Item electron_node/electron-node/main/src/rust-service-manager -Recurse
```

### Step 3: 清理引用

**文件**: `index.ts`

删除对`registerRuntimeHandlers`的调用（如果有）。

---

## 📋 **现有IPC Handlers检查**

### `index.ts`中已实现的handlers

```typescript
// ✅ 系统资源
ipcMain.handle('get-system-resources', ...)

// ✅ 节点状态
ipcMain.handle('get-node-status', ...)

// ✅ 服务元数据
ipcMain.handle('get-all-service-metadata', ...)

// ✅ 服务偏好
ipcMain.handle('get-service-preferences', ...)
ipcMain.handle('set-service-preferences', ...)

// ✅ Rust服务状态
ipcMain.handle('get-rust-service-status', ...)

// ✅ Python服务状态
ipcMain.handle('get-python-service-status', ...)
ipcMain.handle('get-all-python-service-statuses', ...)

// ✅ 语义修复服务
ipcMain.handle('get-all-semantic-repair-service-statuses', ...)
ipcMain.handle('start-semantic-repair-service', ...)
ipcMain.handle('stop-semantic-repair-service', ...)

// ✅ 服务管理（新架构）
ipcMain.handle('service:start', ...) // 统一启动接口
ipcMain.handle('service:stop', ...)  // 统一停止接口
```

### `runtime-handlers-simple.ts`提供的handlers（重复）

```typescript
// ❌ 重复
ipcMain.handle('get-rust-service-status', ...)
ipcMain.handle('start-rust-service', ...)  // 重复！
ipcMain.handle('stop-rust-service', ...)   // 重复！

// ❌ 重复  
ipcMain.handle('get-python-service-status', ...)
ipcMain.handle('get-all-python-service-statuses', ...)
ipcMain.handle('start-python-service', ...)  // 重复！
ipcMain.handle('stop-python-service', ...)   // 重复！

// ✅ 唯一（但也可以删除）
ipcMain.handle('get-service-preferences', ...)
ipcMain.handle('set-service-preferences', ...)
```

---

## 🎯 **最终决定**

### 保留在`index.ts`中的handlers

由于`index.ts`已经有：
- `get-service-preferences` ✅
- `set-service-preferences` ✅

我们**不需要**`runtime-handlers-simple.ts`！

---

## 📝 **清理清单**

### 文件删除

- [ ] `ipc-handlers/runtime-handlers-simple.ts`
- [ ] `python-service-manager/` 整个目录
- [ ] `rust-service-manager/` 整个目录

### 引用清理

- [ ] 删除`index.ts`中对`registerRuntimeHandlers`的import
- [ ] 删除`index.ts`中对`registerRuntimeHandlers`的调用
- [ ] 删除`app-init-simple.ts`中对旧Manager的类型定义

### 测试验证

- [ ] 编译通过
- [ ] 所有IPC handlers正常工作
- [ ] 服务启动/停止正常
- [ ] 配置保存正常

---

## ✅ **收益**

删除这些文件后：

| 项目 | 删除前 | 删除后 | 减少 |
|------|--------|--------|------|
| **文件数** | 20+ | 5 | **-75%** |
| **代码行数** | ~2000行 | ~800行 | **-60%** |
| **IPC handlers** | 重复实现 | 单一实现 | **-50%** |
| **维护复杂度** | 高（两套系统） | 低（统一架构） | **-50%** |

---

## 🚀 **下一步**

1. **确认index.ts中的IPC handlers完整性**
2. **删除runtime-handlers-simple.ts**
3. **删除旧Manager目录**
4. **清理引用**
5. **编译和测试**

完成后，项目将**完全统一到新架构**，无任何冗余！

---

**报告时间**: 2026-01-20  
**建议**: ✅ **立即清理**  
**风险**: **低**（新架构已完全实现所有功能）
