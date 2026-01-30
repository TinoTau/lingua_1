# 简单架构修复方案 - 2026-01-20

## 🎯 **设计原则**

> "代码逻辑尽可能简单易懂，方便找到问题，而不是添加一层又一层的保险措施来掩盖问题"

---

## ❌ **当前的问题（不掩盖）**

### 问题1：白屏 - Vite依赖不清晰

**现象**: Electron启动后白屏

**根本原因**: 
```typescript
// index.ts
app.whenReady().then(() => {
  mainWindow.loadURL('http://localhost:5173');  // ❌ 假设Vite在运行
});
```

**问题**：没有检查Vite是否运行，用户不知道为什么白屏

---

### 问题2：服务启动失败 - 原因不明

**现象**: "Process exited with code 1"

**根本原因**: 不知道！因为：
1. 日志中没有详细的错误信息
2. spawn失败的原因被吞掉了
3. 用户无法定位问题

---

## ✅ **简单的修复方案**

### 修复1：明确Vite依赖（10行代码）

```typescript
// index.ts - 在创建窗口前
async function checkDevelopmentEnvironment() {
  if (!isDev) return;
  
  try {
    await fetch('http://localhost:5173', { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const { dialog } = require('electron');
    dialog.showErrorBox(
      '❌ 开发环境未就绪',
      '请先在另一个终端运行:\nnpm run dev\n\n然后再启动 npm start'
    );
    app.quit();
  }
}

app.whenReady().then(async () => {
  await checkDevelopmentEnvironment();  // ← 添加这一行
  // ... 其他初始化
});
```

**效果**：
- 用户立即知道问题：Vite未运行
- 清晰的解决方案：先运行npm run dev
- 不会看到白屏，直接看到错误提示

---

### 修复2：捕获spawn的真实错误（5行代码）

```typescript
// ServiceProcessRunner.ts - start()方法中
const child = spawn(executable, args, { cwd: workingDir, env: serviceEnv });

// 添加错误捕获
child.on('error', (error) => {
  logger.error({ serviceId, error: error.message }, '❌ Spawn failed');
  entry.runtime.status = 'stopped';
  entry.runtime.lastError = error.message;  // ← 保存真实错误
});

child.stderr?.on('data', (data) => {
  const errorText = data.toString();
  logger.error({ serviceId, stderr: errorText }, '❌ Service stderr');
  entry.runtime.lastError = errorText;  // ← 保存stderr内容
});
```

**效果**：
- 用户可以在UI中看到真实的错误信息
- 不再是模糊的"exit code 1"
- 方便定位问题（缺少依赖、路径错误等）

---

### 修复3：在UI中显示真实错误（前端）

```typescript
// ServiceManagement.tsx
{service.status === 'stopped' && service.lastError && (
  <div className="error-message">
    <strong>启动失败原因：</strong>
    <pre>{service.lastError}</pre>
  </div>
)}
```

**效果**：
- 用户直接看到Python的错误输出
- 例如："ModuleNotFoundError: No module named 'xxx'"
- 立即知道是缺少依赖，而不是猜测

---

## 📋 **完整的简单修复**

### 文件1: `index.ts` （添加10行）

在`app.whenReady()`开头添加：

```typescript
app.whenReady().then(async () => {
  // ✅ 开发环境检查
  if (!app.isPackaged) {
    try {
      await fetch('http://localhost:5173', { signal: AbortSignal.timeout(3000) });
    } catch {
      dialog.showErrorBox('开发环境未就绪', '请先运行: npm run dev');
      app.quit();
      return;
    }
  }
  
  // ... 其他代码
});
```

### 文件2: `ServiceProcessRunner.ts` （修改stderr处理）

找到Line 120附近的stderr处理，改为：

```typescript
// 当前代码（Line ~127）
child.stderr?.on('data', (data) => {
  const text = data.toString();
  logger.error({ serviceId, stderr: text.slice(0, 200) }, 'Service stderr');
  
  // ✅ 添加这一行：保存错误到runtime
  entry.runtime.lastError = text.slice(0, 500);
});

// 当前代码（Line ~145）
child.on('exit', (code, signal) => {
  logger.info({ serviceId, code, signal }, 'Service process exited');
  
  // 如果没有错误信息，添加退出码
  if (!entry.runtime.lastError && code !== 0) {
    entry.runtime.lastError = `Process exited with code ${code}`;
  }
  
  // ... 其他代码
});
```

### 文件3: `ServiceTypes.ts` （确认已有lastError字段）

检查`ServiceRuntimeStatus`接口：

```typescript
export interface ServiceRuntimeStatus {
  status: ServiceStatus;
  pid?: number;
  startedAt?: number;
  lastError?: string;  // ← 确保这个字段存在
}
```

---

## 🎯 **为什么这是简单的方案？**

### 对比复杂方案

| 方案 | 代码量 | 新增模块 | 复杂度 | 解决问题 |
|------|-------|---------|--------|----------|
| **ResourceManager** | +300行 | 1个新类 | 高 | ❌ 掩盖问题 |
| **启动状态机** | +200行 | 1个新类 | 高 | ❌ 增加复杂度 |
| **重试机制** | +50行 | 0个 | 中 | ❌ 隐藏失败 |
| **明确错误提示** | +15行 | 0个 | 低 | ✅ **暴露问题** |

### 简单方案的优势

1. **代码少**：只添加15行
2. **无新模块**：不增加架构复杂度
3. **问题透明**：用户直接看到错误
4. **易于调试**：错误信息完整

---

## 🧪 **验证效果**

### 修复前
```
用户: "服务启动失败"
日志: "Process exited with code 1"
结果: ❌ 不知道为什么失败
```

### 修复后
```
用户: "服务启动失败"
UI显示: "ModuleNotFoundError: No module named 'prompt_templates'"
结果: ✅ 立即知道是导入错误
```

---

## 📝 **实施步骤**

### Step 1: 修复Vite依赖检查（2分钟）
1. 打开`electron_node/electron-node/main/src/index.ts`
2. 在`app.whenReady()`开头添加检查代码
3. 保存

### Step 2: 修复错误信息捕获（3分钟）
1. 打开`ServiceProcessRunner.ts`
2. 修改stderr和exit事件处理
3. 保存lastError到runtime

### Step 3: 重新编译和测试（2分钟）
```powershell
npm run build:main
npm start
```

**总时间**：7分钟

---

## 🎯 **这才是正确的架构改进**

### ❌ 错误的思路
```
问题 → 添加复杂机制掩盖 → 问题依然存在，但被隐藏了
```

### ✅ 正确的思路
```
问题 → 暴露真实原因 → 用户看到问题 → 直接修复根因
```

---

## 💡 **具体到当前问题**

### 当前的语义修复服务失败

**我应该做的**：
1. ✅ 找出失败的**真实错误日志**（stderr输出）
2. ✅ 把错误显示给用户
3. ✅ 用户看到具体错误后，直接修复

**我不应该做的**：
1. ❌ 添加重试（隐藏失败）
2. ❌ 添加资源管理器（增加复杂度）
3. ❌ 猜测原因（内存不足？启动间隔？）

---

## 🚀 **立即行动**

让我现在就实施这3个简单修复，不添加任何复杂机制！

是否同意这个思路？我现在就开始修改代码。
