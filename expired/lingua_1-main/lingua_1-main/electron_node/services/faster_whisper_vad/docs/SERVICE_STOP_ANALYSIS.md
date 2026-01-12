# Faster Whisper VAD 服务停止问题分析

**日期**: 2025-12-25  
**状态**: 🔍 **问题已定位**

---

## 问题现象

用户反馈：在停止语音输入后，faster-whisper-vad服务会自动停止。

---

## 日志分析

### 1. Opus解码器崩溃 ⚠️

从日志中看到大量的**内存访问违规（access violation）**错误：

```
🚨 CRITICAL: Opus decode_float access violation detected! 
packet_len=60, max_frame_samples=960, 
error=exception: access violation writing 0x000000D2AE600000

This may indicate a memory corruption or thread safety issue. 
The decoder state may be corrupted.
```

**问题**：
- Opus解码器在解码过程中发生内存访问违规
- 解码器状态可能已损坏
- 连续解码失败（`Consecutive decode fails >= 3`）

### 2. 服务多次重启

日志显示服务在多个时间点启动：
- `08:12:12` - 服务启动
- `08:17:23` - 服务启动（说明之前停止了）
- `08:32:14` - 服务启动（说明之前停止了）
- `08:41:35` - 服务启动（说明之前停止了）

每次启动前都有 `@app.on_event("shutdown")` 事件，说明服务是**正常关闭**的，而不是崩溃。

### 3. 没有看到主进程崩溃日志

虽然有全局异常处理器，但日志中没有看到：
- `🚨 Uncaught exception in main process, service may crash`
- `ASR Worker process CRASHED detected by Watchdog`

这说明：
- **主进程没有崩溃**（否则会有异常日志）
- **Worker进程也没有崩溃**（否则watchdog会检测到）

---

## 根本原因分析

### 可能的原因1：PythonServiceManager没有自动重启 ⚠️

**代码位置**: `electron_node/electron-node/main/src/python-service-manager/index.ts` (第163-172行)

```typescript
onProcessExit: (code, signal) => {
  this.updateStatus(serviceName, {
    running: false,
    starting: false,
    pid: null,
    port: config.port,
    startedAt: null,
    lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
  });
  this.services.delete(serviceName);  // ❌ 只是删除服务，不重启
},
```

**问题**：
- 当进程退出时，PythonServiceManager只是更新状态并删除服务
- **没有自动重启机制**
- 服务停止后需要手动重启或由外部监控重启

### 可能的原因2：主进程因Opus崩溃而退出 ⚠️

虽然日志中没有看到主进程崩溃的异常，但可能：
- Opus解码器的access violation导致Python进程异常退出
- 异常发生在C层面，Python的异常处理无法捕获
- 进程直接退出，没有记录异常日志

### 可能的原因3：外部监控重启 ⚠️

可能有外部监控（如electron-node的主进程）检测到服务停止后自动重启：
- 检查服务状态
- 发现服务停止
- 自动重启服务

---

## 检查清单

### 1. 检查electron-node主进程日志

查看electron-node主进程是否检测到服务停止并自动重启：
- 是否有"Service stopped, restarting..."的日志
- 是否有定时检查服务状态的逻辑

### 2. 检查服务退出码

查看服务退出时的退出码：
- 退出码 0：正常退出
- 退出码非0：异常退出

### 3. 检查Opus解码器状态

Opus解码器在发生access violation后：
- 解码器状态可能已损坏
- 后续解码请求可能继续失败
- 可能导致服务无法正常工作

---

## 建议的解决方案

### 1. 修复Opus解码器崩溃问题 ⭐ **优先**

**问题**：Opus解码器发生内存访问违规

**可能原因**：
- 解码器状态损坏
- 线程安全问题（虽然已有全局锁，但可能不够）
- 内存管理问题

**建议**：
1. **每次请求创建新的解码器实例**（避免状态损坏）
2. **添加解码器状态验证**（在解码前检查状态是否有效）
3. **限制并发解码**（确保全局锁真正生效）

### 2. 添加服务自动重启机制 ⭐ **推荐**

**问题**：PythonServiceManager没有自动重启机制

**建议**：
1. 在`onProcessExit`回调中添加自动重启逻辑
2. 设置最大重启次数（避免无限重启）
3. 添加重启延迟（避免频繁重启）

### 3. 增强错误处理

**建议**：
1. 在Opus解码失败时，重置解码器状态
2. 添加解码器健康检查
3. 在解码器损坏时，创建新的解码器实例

---

## 下一步行动

1. **立即**：检查electron-node主进程日志，确认是否有自动重启机制
2. **短期**：修复Opus解码器崩溃问题（每次请求创建新实例）
3. **中期**：添加服务自动重启机制
4. **长期**：考虑替换Opus解码库（如果问题持续存在）

---

**分析完成时间**: 2025-12-25  
**状态**: 🔍 **问题已定位，需要进一步调查electron-node主进程的监控机制**

