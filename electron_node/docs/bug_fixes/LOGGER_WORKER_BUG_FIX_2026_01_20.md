# Logger Worker线程BUG修复 - 2026-01-20

## 问题根因

```
[FATAL] uncaughtException: Error: the worker has exited
    at ThreadStream.write (thread-stream/index.js:238:19)
    at Pino.write (pino/lib/proto.js:217:10)
    at cleanupAppResources (app-lifecycle-simple.js:138:26)
```

### 根本原因

**Pino logger使用worker线程进行异步日志写入，但在应用清理阶段worker线程已退出，导致logger调用崩溃！**

### 发生场景

1. 应用初始化成功
2. 某个异常触发cleanup
3. `cleanupAppResources` 调用 `logger.warn/info/error`
4. Pino的worker线程已关闭
5. 抛出 "the worker has exited" 异常
6. 触发 `uncaughtException` handler
7. Handler又调用 `cleanupAppResources`
8. 再次触发logger错误
9. **无限循环** → 应用退出

---

## 修复方案

### 在cleanup和lifecycle函数中使用console代替logger

**修改文件**: `app-lifecycle-simple.ts`

**修改内容**:
- `cleanupAppResources`: 所有 `logger.*` → `console.*`
- `stopAllServices`: 所有 `logger.*` → `console.*`
- `saveCurrentServiceState`: 所有 `logger.*` → `console.*`
- `registerExceptionHandlers`: 所有 `logger.*` → `console.*`
- `registerProcessSignalHandlers`: 所有 `logger.*` → `console.*`
- `registerBeforeQuitHandler`: 所有 `logger.*` → `console.*`
- `registerWindowAllClosedHandler`: 所有 `logger.*` → `console.*`

**原因**: cleanup阶段logger不可靠，使用console直接输出

---

## 验证结果

修复后的日志：
```
✅ Diagnostic hooks installed
✅ Application initialized successfully!
========================================
🛑 Starting application cleanup...
========================================
✅ Service preferences saved
✅ Application cleanup completed
========================================
```

**无logger崩溃** ✅

---

## 额外发现的问题

通过诊断还发现了两个关键BUG：

### Bug 1: CWD路径重复拼接
```
workingDir = D:\...\faster_whisper_vad\D:\...\faster_whisper_vad
```

### Bug 2: Python命令不在PATH
```
Error: spawn python ENOENT
```

---

## 总结

这个BUG说明：
1. ⚠️  不能在cleanup中依赖任何可能已关闭的资源（logger, DB, etc）
2. ✅ console.log/error是唯一安全的cleanup日志方式
3. ✅ 诊断钩子非常有效，应该保留

---

**修复**: ✅ 完成
**状态**: 应用现在不会因为logger崩溃而退出
