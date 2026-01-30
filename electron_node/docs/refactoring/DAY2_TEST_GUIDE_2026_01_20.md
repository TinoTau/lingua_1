# Day 2 测试指南 - 2026-01-20

## 🎯 **测试目标**

确定NodeAgent注册流程卡在哪一步。

---

## 🔧 **已完成的改动**

在 `node-agent-registration.ts` 中添加了关键日志：

```typescript
logger.info({}, '[1/6] Getting hardware info...');
const hardware = await this.hardwareHandler.getHardwareInfo();
logger.info({ gpus: hardware.gpus?.length || 0 }, '[1/6] Hardware info retrieved');
```

现在每个步骤都有明确的进度标记。

---

## 🚀 **测试步骤**

### Step 1: 重新编译（已完成）

```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main
```

### Step 2: 重启Electron

```bash
npm start
```

### Step 3: 观察日志

启动后，应该看到以下日志序列：

```
✅ NodeAgent initialized (Day 2 Refactor: snapshot-based)
✅ Connected to scheduler server
✅ Starting node registration

# 然后应该看到6个步骤：
[1/6] Getting hardware info...
[1/6] Hardware info retrieved: { gpus: X }

[2/6] Getting installed models...
[2/6] Installed models retrieved: { modelCount: X }

[3/6] Getting installed services...
Installed services retrieved: { serviceCount: X, services: [...] }

[4/6] Getting capability by type...
[4/6] Capability by type retrieved

[5/6] Detecting language capabilities...
[5/6] Language capabilities detected

[6/6] Getting features supported...
[6/6] Features supported retrieved

Sending node registration message
Registration message sent
Node registered successfully
```

---

## 🔍 **诊断关键点**

### 场景1: 日志停在 "[1/6] Getting hardware info..."

**问题**: `getHardwareInfo()` 调用卡住

**原因**: 可能是GPU信息查询超时

**解决方案**: 
1. 检查 `node-agent-hardware.ts` 的实现
2. 添加超时保护
3. 或者使用缓存的硬件信息

### 场景2: 日志停在 "[3/6] Getting installed services..."

**问题**: `getInstalledServices()` 卡住

**原因**: 快照函数有问题

**解决方案**:
1. 检查 `ServiceSnapshots.ts` 的实现
2. 确认Registry是否正确初始化

### 场景3: 所有步骤都完成，但没有 "Node registered successfully"

**问题**: 调度器没有响应`node_register_ack`

**原因**: 
- 调度器端问题
- 消息格式不匹配
- WebSocket连接中断

**解决方案**:
1. 检查调度器日志
2. 验证消息格式
3. 检查WebSocket状态

---

## 📋 **检查清单**

### Electron日志位置

```
d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log
```

### 调度器日志位置

```bash
# 如果调度器有日志输出，应该在终端看到
# 或者检查：
d:\Programs\github\lingua_1\central_server\scheduler\*.log
```

### 关键日志关键词

搜索这些内容：
- `Starting node registration`
- `[1/6]`, `[2/6]`, ... `[6/6]`
- `Sending node registration message`
- `Node registered successfully`
- `Failed to register`

---

## 🐛 **已知问题**

### 问题: 日志中没有看到任何 "[1/6]" 标记

**说明**: 代码没有正确编译或Electron使用了旧的编译产物

**解决**:
```bash
# 强制清理并重新编译
cd d:\Programs\github\lingua_1\electron_node\electron-node
Remove-Item -Recurse -Force main\electron-node
npm run build:main

# 重启
npm start
```

---

## 📊 **预期结果**

### 成功场景

```
Connected to scheduler server
Starting node registration
[1/6] Getting hardware info...
[1/6] Hardware info retrieved: { gpus: 1 }
[2/6] Getting installed models...
[2/6] Installed models retrieved: { modelCount: 0 }
[3/6] Getting installed services...
Service snapshot obtained: { totalCount: 9, services: [...] }
Installed services retrieved: { serviceCount: 9, services: [...] }
[4/6] Getting capability by type...
[4/6] Capability by type retrieved
[5/6] Detecting language capabilities...
[5/6] Language capabilities detected
[6/6] Getting features supported...
[6/6] Features supported retrieved
Sending node registration message: { ... }
Registration message sent
Node registered successfully: { nodeId: "xxx" }
```

### 失败场景（卡住）

```
Connected to scheduler server
Starting node registration
[1/6] Getting hardware info...
# 卡在这里，没有后续日志
```

这说明 `getHardwareInfo()` 调用卡住了。

---

## 🎯 **下一步行动**

### 如果测试成功
- ✅ Day 2完成！
- 继续Day 3重构

### 如果卡在某个步骤
- 📋 记录卡在哪一步
- 🔍 针对性分析该步骤的实现
- 🔧 修复该步骤的问题

---

## 📞 **需要反馈的信息**

请重启Electron后，告诉我：

1. **日志停在哪一步？**
   - 例如："停在 [1/6] Getting hardware info..."

2. **有没有错误信息？**
   - 例如："Failed to register node: xxx"

3. **调度器有没有日志输出？**
   - 如果调度器终端有输出，请复制最后几行

---

**准备完成**: ✅  
**等待用户测试**: 请重启Electron并观察日志  
**时间**: 2026-01-20
