# 服务状态显示修复 - 2026-01-20

## 🐛 问题描述

**现象**: NMT和TTS服务虽然已成功启动（日志显示Uvicorn running），但UI显示"已停止"

**日志证据**:
```
Line 100: [piper-tts] INFO: Uvicorn running on http://0.0.0.0:5005
Line 252: [nmt-m2m100] INFO: Uvicorn running on http://127.0.0.1:5008
```

**UI显示**: ❌ 已停止

---

## 🔍 根本原因

### 问题代码

**位置**: `electron-node/main/src/index.ts` Line 316

```typescript
// ❌ 错误的过滤条件
const pythonServices = Array.from(registry.values()).filter(e => e.def.type === 'python');
```

### 实际的service.json

```json
// nmt_m2m100/service.json
{
  "type": "nmt"  // ✅ 不是 "python"
}

// piper_tts/service.json
{
  "type": "tts"  // ✅ 不是 "python"
}

// faster_whisper_vad/service.json
{
  "type": "asr"  // ✅ 不是 "python"
}
```

### 结果

**过滤条件 `e.def.type === 'python'` 匹配不到任何服务**

→ `pythonServices` 数组为空  
→ 前端获取到空数组  
→ UI显示默认状态（已停止）

---

## ✅ 修复方案

### 正确的过滤逻辑

**Python服务包括**：
- `type: 'asr'` (faster-whisper-vad)
- `type: 'nmt'` (nmt-m2m100)
- `type: 'tts'` (piper-tts)
- `type: 'speaker-embedding'` (speaker-embedding)
- 等等

**非Python服务**：
- `type: 'rust'` (node-inference)
- `type: 'semantic-repair'` (语义修复服务，单独处理)

### 修复代码

```typescript
// ✅ 正确的过滤条件：排除rust和semantic-repair，其他都是Python服务
const pythonServices = Array.from(registry.values()).filter(e => 
  e.def.type !== 'rust' && e.def.type !== 'semantic-repair'
);
```

---

## 📊 修复前后对比

### 修复前 ❌

```typescript
// 过滤条件
filter(e => e.def.type === 'python')

// 结果
pythonServices = []  // 空数组

// 前端收到
[]

// UI显示
所有服务：已停止 ❌
```

### 修复后 ✅

```typescript
// 过滤条件
filter(e => e.def.type !== 'rust' && e.def.type !== 'semantic-repair')

// 结果
pythonServices = [
  { id: 'nmt-m2m100', type: 'nmt', status: 'running' },
  { id: 'piper-tts', type: 'tts', status: 'running' },
  { id: 'faster-whisper-vad', type: 'asr', status: 'stopped' },
  ...
]

// 前端收到
[
  { name: 'Nmt M2m100', running: true, pid: 58052, port: 5008 },
  { name: 'Piper Tts', running: true, pid: 59192, port: 5005 },
  ...
]

// UI显示
NMT翻译服务：运行中 ✅
TTS语音合成：运行中 ✅
```

---

## 🎯 为什么没有统一使用 'python' 类型？

### 设计考虑

service.json中的`type`字段用于：
1. **功能分类**：区分ASR、NMT、TTS等不同功能
2. **路由决策**：InferenceService根据type路由任务
3. **热插拔支持**：新增服务类型无需修改核心代码

**如果统一为'python'**：
- ❌ 失去功能分类信息
- ❌ 需要额外字段区分功能
- ❌ 与现有架构不兼容

### 正确的实现方式

**在service.json中**：使用具体的功能类型
```json
{
  "id": "nmt-m2m100",
  "type": "nmt",  // ✅ 功能类型
  "exec": {
    "command": "python",  // ✅ 执行命令说明是Python服务
    ...
  }
}
```

**在代码中**：通过排除法识别Python服务
```typescript
// 方法1：排除非Python服务（推荐）
const isPythonService = (type: string) => 
  type !== 'rust' && type !== 'semantic-repair';

// 方法2：如果将来需要精确控制，可以在service.json中添加runtime字段
{
  "type": "nmt",
  "runtime": "python"  // 显式说明运行时
}
```

---

## 📝 修改的文件

1. **d:\Programs\github\lingua_1\electron_node\electron-node\main\src\index.ts**
   - Line 316: 修复`get-all-python-service-statuses` handler的过滤条件

---

## 🧪 验证方法

### 1. 重启Electron

```powershell
npm start
```

### 2. 观察UI

- ✅ NMT翻译服务应该显示"运行中"
- ✅ TTS语音合成应该显示"运行中"
- ⚠️ faster-whisper-vad可能显示"已停止"（VAD CUDA问题）

### 3. 检查DevTools Console

```javascript
await window.electronAPI.getAllPythonServiceStatuses()
// 应该返回非空数组
```

---

## 🎉 总结

### 问题根因

错误的服务类型过滤条件 `type === 'python'`，导致无法查询Python服务状态

### 修复方法

使用排除法 `type !== 'rust' && type !== 'semantic-repair'`

### 影响范围

只修改1个IPC handler，不影响其他功能

### 后续优化（可选）

Day 5重构时，可以考虑：
- 在`service.json`中添加`runtime`字段明确标识
- 创建统一的服务分类工具函数
- 完善TypeScript类型定义

---

**修复用时**: 5分钟  
**难度**: 简单（逻辑错误）  
**测试**: 等待用户验证UI显示
