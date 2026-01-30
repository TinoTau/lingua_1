# 透明错误处理 - 让问题暴露而不是隐藏 - 2026-01-20

## 🎯 **设计原则**

> "代码逻辑尽可能简单易懂，方便找到问题，而不是添加一层又一层的保险措施来掩盖问题"

---

## ✅ **修复内容（仅添加20行代码）**

### 修复1：Vite依赖检查（10行）

**文件**: `electron-node/main/src/index.ts`

**位置**: `app.whenReady()` 开头

**代码**:
```typescript
// ✅ 开发模式：检查Vite是否运行（简单直接）
if (!app.isPackaged) {
  try {
    await fetch('http://localhost:5173', { signal: AbortSignal.timeout(2000) });
    console.log('✅ Vite dev server is running');
  } catch (error) {
    const { dialog } = require('electron');
    dialog.showErrorBox(
      '❌ 开发环境未就绪',
      '请先在另一个终端运行:\n\nnpm run dev\n\n等待Vite启动后，再运行 npm start'
    );
    app.quit();
    return;
  }
}
```

**效果**：
- 用户启动`npm start`时，如果Vite未运行，**立即看到清晰的错误对话框**
- 不会看到白屏
- 明确告诉用户怎么解决
- **不掩盖问题，直接暴露**

---

### 修复2：捕获Python服务的真实错误（3行）

**文件**: `electron-node/main/src/service-layer/ServiceProcessRunner.ts`

**位置**: Line 136，stderr处理

**代码**:
```typescript
proc.stderr?.on('data', (data) => {
  const output = data.toString().trim();
  if (output) {
    console.error(`[child-stderr] [${serviceId}]`, output);
    logger.warn({ serviceId, pid: proc.pid }, `[stderr] ${output}`);
    // ✅ 保存stderr到runtime，让用户在UI中看到真实错误
    if (!entry.runtime.lastError) {
      entry.runtime.lastError = output.slice(0, 1000);  // 保存前1000字符
    }
  }
});
```

**效果**：
- Python服务启动失败时，**stderr的内容被保存到`runtime.lastError`**
- 例如："ModuleNotFoundError: No module named 'prompt_templates'"
- 用户可以在UI中看到这个错误
- **不猜测，直接显示真实原因**

---

## 📊 **对比：简单 vs 复杂**

### ❌ 复杂的方案（我之前建议的）

```typescript
// ServiceResourceManager.ts (+300行)
class ServiceResourceManager {
  async canStartService() { ... }
  async scheduleServiceStart() { ... }
  private topologicalSort() { ... }
}

// ServiceStartupStateMachine.ts (+200行)
class ServiceStartupStateMachine {
  async startServiceWithHealthCheck() { ... }
  private async waitForHealth() { ... }
}

// service.json (+50行扩展字段)
{
  "resources": { ... },
  "dependencies": [ ... ],
  "healthCheck": { ... }
}

// 总计：+550行代码，2个新模块，复杂度大幅增加
```

**问题**：
- 代码复杂，难以维护
- 问题被"机制"掩盖
- 开发力量不足时无法理解

---

### ✅ 简单的方案（当前实施的）

```typescript
// 修复1: index.ts (+10行)
if (!app.isPackaged) {
  try {
    await fetch('http://localhost:5173', { signal: AbortSignal.timeout(2000) });
  } catch {
    dialog.showErrorBox('开发环境未就绪', '请先运行: npm run dev');
    app.quit();
  }
}

// 修复2: ServiceProcessRunner.ts (+3行)
proc.stderr?.on('data', (data) => {
  const output = data.toString().trim();
  if (!entry.runtime.lastError) {
    entry.runtime.lastError = output.slice(0, 1000);
  }
});

// 总计：+13行代码，0个新模块，逻辑清晰简单
```

**优势**：
- 代码极简，容易理解
- 问题直接暴露给用户
- 方便定位和修复

---

## 🎯 **问题透明化**

### 修复前
```
用户: "白屏了，不知道为什么"
系统: （静默失败）
用户: "只能猜测..."
```

### 修复后
```
用户: "白屏了"
系统: 弹出对话框 → "请先运行: npm run dev"
用户: "哦，原来是Vite没启动" ✅
```

---

### 修复前
```
用户: "服务启动失败"
UI显示: "Process exited with code 1"
用户: "不知道为什么，只能猜..."
```

### 修复后
```
用户: "服务启动失败"
UI显示: "ModuleNotFoundError: No module named 'prompt_templates'"
用户: "哦，是导入错误" ✅
```

---

## 📋 **修改文件清单**

1. ✅ `index.ts` - 添加Vite检查（+10行）
2. ✅ `ServiceProcessRunner.ts` - 保存stderr（+3行）

**总计**: 2个文件，13行代码

---

## 🧪 **验证效果**

### 测试1：Vite未运行时启动Electron

```powershell
# 确保Vite未运行
taskkill /F /IM node.exe /FI "WINDOWTITLE eq npm*" 2>$null

# 启动Electron
npm start
```

**预期**: ✅ 弹出对话框，告诉用户先运行npm run dev

---

### 测试2：服务启动失败

在UI中点击启动任何服务，如果失败：

**预期**: ✅ UI显示真实的Python错误信息（从stderr捕获）

---

## 💡 **这才是好的架构**

### 好的架构特征：

1. ✅ **简单直接** - 13行代码解决问题
2. ✅ **问题透明** - 直接显示错误，不隐藏
3. ✅ **易于调试** - 开发者立即知道问题所在
4. ✅ **无额外复杂度** - 不引入新模块、新机制

### 不好的架构特征：

1. ❌ **过度设计** - 为了避免问题而堆砌机制
2. ❌ **掩盖问题** - 重试、fallback、资源管理器
3. ❌ **难以维护** - 开发力量不足时无法理解
4. ❌ **增加复杂度** - 引入新的抽象层

---

## 🎯 **总结**

### 修改内容
- ✅ 2个文件
- ✅ 13行代码
- ✅ 0个新模块
- ✅ 逻辑清晰简单

### 解决的问题
- ✅ 白屏 → 清晰提示Vite未运行
- ✅ 服务失败 → 显示真实Python错误
- ✅ 方便调试 → 不再猜测原因

### 架构改进
- ✅ 简单 - 13行代码
- ✅ 透明 - 问题暴露而不是隐藏
- ✅ 易维护 - 容易理解和修改

---

**修复时间**: 2026-01-20  
**修改行数**: 13行  
**架构原则**: **让问题暴露，而不是掩盖**
