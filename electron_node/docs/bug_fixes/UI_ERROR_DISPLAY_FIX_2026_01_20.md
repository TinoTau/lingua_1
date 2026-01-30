# UI错误显示优化 - 2026-01-20

## ✅ **完成的改进**

修改前端服务卡片，**只显示真正的错误(error)，过滤警告(warning)**。

---

## 🎯 **用户需求**

用户反馈：语义修复服务的卡片显示了warning信息（如llama_context警告），希望只显示error。

### 典型的Warning（不需要显示）

```
llama_context: n_ctx_per_seq (2048) < n_ctx_train (32768) 
-- the full capacity of the model will not be utilized
```

这是模型配置警告，不影响服务运行，不需要在UI中显示。

---

## 🔧 **实现方案**

### 修改位置

**文件**: `electron-node/renderer/src/components/ServiceManagement.tsx`

### 修改内容

对所有服务卡片的 `lastError` 显示逻辑进行统一修改：

```typescript
// ❌ 修改前：显示所有stderr内容（包括warning）
{status?.lastError && (
  <div className="lsm-error">
    <span className="lsm-error-icon">⚠️</span>
    <span>{status.lastError}</span>
  </div>
)}

// ✅ 修改后：只显示包含"error"的行
{(() => {
  // 只显示真正的错误，过滤掉警告信息
  if (!status?.lastError) return null;
  const errorLines = status.lastError
    .split('\n')
    .filter(line => {
      const lowerLine = line.toLowerCase();
      // 只保留包含error的行，过滤warning/info
      return lowerLine.includes('error') && !lowerLine.includes('warning');
    })
    .join('\n')
    .trim();
  
  if (!errorLines) return null;
  
  return (
    <div className="lsm-error">
      <span className="lsm-error-icon">❌</span>
      <span>{errorLines}</span>
    </div>
  );
})()}
```

### 过滤规则

1. **分割行**: `lastError.split('\n')`
2. **过滤规则**: 
   - ✅ 包含 "error" (不区分大小写)
   - ❌ 同时包含 "warning" (排除)
   - ❌ 不包含 "error" (排除)
3. **合并**: 过滤后的行重新合并
4. **显示**: 只有存在真正的error才显示

---

## 📊 **效果对比**

### 修改前 ❌

**语义修复服务卡片显示**：
```
⚠️ llama_context: n_ctx_per_seq (2048) < n_ctx_train (32768) 
   -- the full capacity of the model will not be utilized
```

- 用户看到警告信息，可能误以为是错误
- 卡片显得混乱

### 修改后 ✅

**语义修复服务卡片**：
- 不显示warning信息
- 只在真正出错时显示错误（如启动失败、端口冲突等）
- 卡片更简洁

**示例错误显示**（真正的错误才会显示）：
```
❌ ERROR: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 5013)
```

---

## 🎯 **修改范围**

修改了3处 `lastError` 显示位置：

1. **Rust Service 卡片** (Line ~409)
2. **Python Services 卡片** (Line ~465)
3. **Semantic Repair Services 卡片** (Line ~575)

所有服务类型统一使用相同的过滤逻辑。

---

## 📝 **技术细节**

### 为什么使用IIFE (立即执行函数)

```typescript
{(() => {
  // 过滤逻辑
})()}
```

**原因**：
- JSX中需要复杂逻辑（多行if/filter等）
- IIFE可以在JSX中执行多行代码并返回结果
- 保持代码可读性

### 为什么改用 ❌ 而不是 ⚠️

- `⚠️` (警告图标) → 用于warning
- `❌` (错误图标) → 用于error
- 更准确地表达错误的严重性

---

## ✅ **测试建议**

### 正常场景（不显示任何内容）

1. 启动语义修复服务
2. 卡片应该**不显示**任何warning信息
3. 服务状态显示"运行中"

### 错误场景（显示错误）

1. 故意造成启动失败（如端口被占用）
2. 卡片应该显示:
   ```
   ❌ ERROR: [Errno 10048] error while attempting to bind...
   ```

---

## 🔍 **可能需要调整的情况**

如果某些真实错误没有包含"error"关键字，可以扩展过滤规则：

```typescript
// 可选：更严格的错误识别
return lowerLine.includes('error') || 
       lowerLine.includes('exception') ||
       lowerLine.includes('failed') ||
       lowerLine.includes('errno');
```

当前实现：**只要包含"error"且不包含"warning"**

---

## 📚 **相关文件**

- `ServiceManagement.tsx` - 前端服务管理UI
- `ServiceProcessRunner.ts` - 后端stderr捕获（未修改）

---

**修改时间**: 2026-01-20  
**修改文件**: 1个 (ServiceManagement.tsx)  
**修改行数**: 3处显示逻辑  
**效果**: 只显示真正的错误，UI更简洁  
**状态**: ✅ 已完成，刷新页面生效
