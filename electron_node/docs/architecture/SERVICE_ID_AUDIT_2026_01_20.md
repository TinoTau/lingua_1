# 🔍 服务ID审计报告 - 2026-01-20

## 发现的问题

### ⚠️ 字段名不一致

**Python服务**（6个）使用 `"id"` 字段：
```json
// ✅ 正确格式
{
  "id": "faster-whisper-vad",
  "name": "Faster Whisper VAD",
  ...
}
```

**语义修复服务**（3个）使用 `"service_id"` 字段：
```json
// ❌ 字段名不一致
{
  "service_id": "semantic-repair-zh",
  "name": "Semantic Repair Service - Chinese",
  ...
}
```

---

## 完整服务ID清单

### ✅ Python核心服务（使用`"id"`）

| 服务目录 | service.json中的ID | 前端可能传的格式 | 状态 |
|---------|------------------|----------------|------|
| `faster_whisper_vad/` | `faster-whisper-vad` | `faster_whisper_vad` | ✅ 已支持转换 |
| `nmt_m2m100/` | `nmt-m2m100` | `nmt_m2m100` | ✅ 已支持转换 |
| `piper_tts/` | `piper-tts` | `piper_tts` | ✅ 已支持转换 |
| `speaker_embedding/` | `speaker-embedding` | `speaker_embedding` | ✅ 已支持转换 |
| `your_tts/` | `your-tts` | `your_tts` | ✅ 已支持转换 |

### ✅ Rust服务（使用`"id"`）

| 服务目录 | service.json中的ID | 前端可能传的格式 | 状态 |
|---------|------------------|----------------|------|
| `node-inference/` | `node-inference` | `node-inference` | ✅ 无需转换 |

### ⚠️ 语义修复服务（使用`"service_id"`）

| 服务目录 | service.json中的字段 | ID值 | 状态 |
|---------|---------------------|------|------|
| `semantic_repair_zh/` | `"service_id"` | `semantic-repair-zh` | ⚠️ 字段名错误 |
| `semantic_repair_en_zh/` | `"service_id"` | `semantic-repair-en-zh` | ⚠️ 字段名错误 |
| `en_normalize/` | `"service_id"` | `en-normalize` | ⚠️ 字段名错误 |

---

## 问题影响

### 当前状态
`ServiceDiscovery.ts`可能期望`"id"`字段，但语义修复服务使用`"service_id"`

### 可能的后果
1. ❌ 语义修复服务无法被ServiceRegistry识别
2. ❌ 启动日志显示6个服务，而不是9个
3. ❌ 前端无法启动语义修复服务

---

## 修复方案

### 方案1: 修改service.json（推荐）✅

**统一所有服务使用`"id"`字段**

#### 需要修改的文件：
1. `services/semantic_repair_zh/service.json`
2. `services/semantic_repair_en_zh/service.json`
3. `services/en_normalize/service.json`

**修改示例**:
```json
// 修改前
{
  "service_id": "semantic-repair-zh",
  ...
}

// 修改后
{
  "id": "semantic-repair-zh",
  ...
}
```

**优点**:
- ✅ 统一规范
- ✅ 符合新架构设计
- ✅ 无需修改代码

---

### 方案2: 修改ServiceDiscovery支持两种字段名

**位置**: `main/src/service-layer/ServiceDiscovery.ts`

```typescript
// 读取service.json时
const serviceId = serviceDef.id || serviceDef.service_id;
if (!serviceId) {
  throw new Error('Service definition must have "id" or "service_id"');
}
```

**优点**:
- ✅ 向后兼容
- ✅ 支持旧格式

**缺点**:
- ❌ 保留技术债务
- ❌ 不符合"单一规范"原则

---

## 推荐方案

### ✅ 采用方案1：统一修改service.json

**理由**:
1. 符合新架构"单一规范"原则
2. 简化代码逻辑
3. 3个文件，修改成本低

---

## 立即修复

我现在可以帮您修复这3个service.json文件，只需要修改字段名`service_id` → `id`。

**是否立即修复？**

---

## 附录：完整ID映射表

### 前端可能传的格式 → service.json中的ID

| 前端格式 | service.json ID | 需要转换 |
|---------|----------------|---------|
| `faster_whisper_vad` | `faster-whisper-vad` | ✅ 是（下划线→连字符） |
| `nmt_m2m100` | `nmt-m2m100` | ✅ 是（下划线→连字符） |
| `piper_tts` | `piper-tts` | ✅ 是（下划线→连字符） |
| `speaker_embedding` | `speaker-embedding` | ✅ 是（下划线→连字符） |
| `your_tts` | `your-tts` | ✅ 是（下划线→连字符） |
| `node-inference` | `node-inference` | ❌ 否（完全一致） |
| `semantic_repair_zh` | `semantic-repair-zh` | ✅ 是（下划线→连字符） |
| `semantic_repair_en_zh` | `semantic-repair-en-zh` | ✅ 是（下划线→连字符） |
| `en_normalize` | `en-normalize` | ✅ 是（下划线→连字符） |

**结论**: 当前的下划线→连字符转换逻辑**已经足够**，只需要修复字段名问题。
