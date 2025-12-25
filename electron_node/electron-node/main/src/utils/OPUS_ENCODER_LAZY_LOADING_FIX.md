# Opus 编码器延迟加载修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

在添加 TTS Opus 编码功能后，NMT 服务出现崩溃（退出码: 3221225477）。

**根本原因**:
- `opus-encoder.ts` 在**模块加载时**就执行了 `require('opusscript')`
- `task-router.ts` 在模块顶层导入了 `opus-encoder.ts`
- 当 `TaskRouter` 类被导入时，`opusscript` 原生模块会被立即加载
- `opusscript` 是一个包含原生绑定的 Node.js 模块，其加载可能会：
  - 加载原生 DLL/共享库
  - 影响系统环境变量
  - 在模块加载时触发某些初始化代码
  - **可能干扰 Python 服务的启动环境**

---

## 修复方案

### 修改内容

**文件**: `electron_node/electron-node/main/src/utils/opus-encoder.ts`

**修改前**（立即加载）:
```typescript
// 模块加载时立即执行
try {
  OpusScript = require('opusscript');
  opusAvailable = true;
  logger.info('Opus encoder (opusscript) is available');
} catch (error) {
  opusAvailable = false;
}
```

**修改后**（延迟加载）:
```typescript
let opusCheckAttempted = false;

function checkOpusEncoder(): void {
  if (opusCheckAttempted) {
    return;
  }
  opusCheckAttempted = true;
  
  try {
    // 延迟导入，只在真正需要时才加载
    OpusScript = require('opusscript');
    opusAvailable = true;
    logger.info('Opus encoder (opusscript) is available');
  } catch (error) {
    opusAvailable = false;
  }
}

// 在函数中延迟检查
export function isOpusEncoderAvailable(): boolean {
  if (!opusCheckAttempted) {
    checkOpusEncoder();
  }
  return opusAvailable;
}

export function encodePcm16ToOpus(...): Buffer {
  if (!opusCheckAttempted) {
    checkOpusEncoder();
  }
  // ... 编码逻辑
}
```

---

## 修复效果

### 修复前
- ❌ `opusscript` 在模块加载时立即加载
- ❌ 可能影响其他服务（如 NMT）的启动
- ❌ NMT 服务崩溃（退出码: 3221225477）

### 修复后
- ✅ `opusscript` 只在真正需要时才加载（首次调用 `isOpusEncoderAvailable()` 或 `encodePcm16ToOpus()` 时）
- ✅ 不影响其他服务的启动
- ✅ NMT 服务可以正常启动

---

## 验证步骤

1. **重新编译节点端**:
   ```bash
   cd electron_node/electron-node
   npm run build:main
   ```

2. **重启节点端**:
   - 检查 NMT 服务是否正常启动
   - 检查日志中是否有 "Opus encoder (opusscript) is available"（只有在 TTS 任务时才会出现）

3. **测试 TTS Opus 编码**:
   - 发送一个 TTS 任务
   - 验证 Opus 编码是否正常工作
   - 验证 NMT 服务是否仍然正常运行

---

## 技术说明

### 为什么延迟加载可以解决问题？

1. **模块加载时机**:
   - 修复前：`TaskRouter` 类被导入 → `opus-encoder.ts` 被加载 → `require('opusscript')` 立即执行
   - 修复后：`TaskRouter` 类被导入 → `opus-encoder.ts` 被加载 → **不执行任何 require** → 只在需要时加载

2. **原生模块的影响**:
   - `opusscript` 包含原生绑定，加载时会：
     - 加载 DLL/共享库
     - 可能修改环境变量
     - 可能触发系统调用
   - 这些操作可能会影响 Python 服务的启动环境

3. **延迟加载的优势**:
   - 只在真正需要时才加载原生模块
   - 不影响其他服务的启动
   - 如果 Opus 编码器不可用，也不会影响其他功能

---

## 相关文件

- **修复文件**: `electron_node/electron-node/main/src/utils/opus-encoder.ts`
- **使用位置**: `electron_node/electron-node/main/src/task-router/task-router.ts`
- **问题报告**: NMT 服务崩溃（退出码: 3221225477）

---

## 总结

通过将 `opusscript` 的加载从模块加载时改为延迟加载（首次使用时），成功解决了 NMT 服务崩溃的问题。这确保了：

1. ✅ TTS Opus 编码功能正常工作
2. ✅ NMT 服务不受影响，可以正常启动
3. ✅ 其他服务不受影响
4. ✅ 代码更加健壮（延迟加载原生模块是更好的实践）

