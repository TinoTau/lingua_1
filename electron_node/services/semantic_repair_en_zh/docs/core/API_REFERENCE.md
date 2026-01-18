# API 参考文档

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0  
**基础 URL**: `http://localhost:5015`

---

## 📋 API 端点总览

| 端点 | 方法 | 功能 | 处理器 |
|------|------|------|--------|
| `/zh/repair` | POST | 中文语义修复 | ZhRepairProcessor |
| `/en/repair` | POST | 英文语义修复 | EnRepairProcessor |
| `/en/normalize` | POST | 英文文本标准化 | EnNormalizeProcessor |
| `/repair` | POST | 统一修复端点（ASR兼容） | 根据 lang 参数路由 ⭐ |
| `/health` | GET | 全局健康检查 | - |
| `/zh/health` | GET | 中文处理器健康检查 | - |
| `/en/health` | GET | 英文处理器健康检查 | - |

---

## 🔧 修复端点

### POST /zh/repair

中文语义修复

#### 请求

**URL**: `http://localhost:5015/zh/repair`  
**Method**: `POST`  
**Content-Type**: `application/json`

**请求体**:
```json
{
  "job_id": "test-zh-001",
  "session_id": "session-001",
  "utterance_index": 0,
  "text_in": "你号，这是一个测试。",
  "quality_score": 0.8,
  "micro_context": "上一句话的末尾部分",
  "meta": {}
}
```

**字段说明**:

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `job_id` | string | ✅ | 任务ID（为空时自动生成UUID） |
| `session_id` | string | ✅ | 会话ID |
| `utterance_index` | integer | ❌ | 话语索引（默认0） |
| `text_in` | string | ✅ | 输入文本 |
| `quality_score` | float | ❌ | ASR质量分数（0.0-1.0） |
| `micro_context` | string | ❌ | 微上下文（上一句末尾） |
| `meta` | object | ❌ | 元数据 |

#### 响应

**成功响应** (200 OK):
```json
{
  "request_id": "test-zh-001",
  "decision": "REPAIR",
  "text_out": "你好，这是一个测试。",
  "confidence": 0.92,
  "diff": [],
  "reason_codes": ["LOW_QUALITY_SCORE", "REPAIR_APPLIED"],
  "process_time_ms": 245,
  "processor_name": "zh_repair"
}
```

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_id` | string | 请求ID（job_id 或自动生成） |
| `decision` | string | 决策：PASS（保持原文）、REPAIR（已修复）、REJECT（拒绝） |
| `text_out` | string | 输出文本 |
| `confidence` | float | 置信度（0.0-1.0） |
| `diff` | array | 差异列表（当前为空，未来可能实现） |
| `reason_codes` | array | 原因代码列表 |
| `process_time_ms` | integer | 处理耗时（毫秒） |
| `processor_name` | string | 处理器名称 |

**错误响应** (503 Service Unavailable):
```json
{
  "detail": "Processor 'zh_repair' not available"
}
```

#### 决策逻辑

| decision | 条件 | text_out |
|----------|------|----------|
| `PASS` | 文本无需修复 | 与 text_in 相同 |
| `REPAIR` | 文本已修复 | 修复后的文本 |
| `REJECT` | 文本无法处理（未实现） | 与 text_in 相同 |

#### Reason Codes

| 代码 | 说明 |
|------|------|
| `LOW_QUALITY_SCORE` | ASR 质量分数低于阈值（0.85） |
| `REPAIR_APPLIED` | 已应用修复 |
| `TIMEOUT` | 处理超时，返回原文 |
| `ERROR` | 处理出错，返回原文 |

#### 示例

**cURL**:
```bash
curl -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-001",
    "session_id": "session-001",
    "text_in": "你号，这是一个测试。",
    "quality_score": 0.8
  }'
```

**Python**:
```python
import requests

response = requests.post(
    "http://localhost:5015/zh/repair",
    json={
        "job_id": "test-001",
        "session_id": "session-001",
        "text_in": "你号，这是一个测试。",
        "quality_score": 0.8
    }
)

result = response.json()
print(f"Decision: {result['decision']}")
print(f"Output: {result['text_out']}")
```

**TypeScript**:
```typescript
const response = await fetch('http://localhost:5015/zh/repair', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    job_id: 'test-001',
    session_id: 'session-001',
    text_in: '你号，这是一个测试。',
    quality_score: 0.8
  })
});

const result = await response.json();
console.log('Decision:', result.decision);
console.log('Output:', result.text_out);
```

---

### POST /en/repair

英文语义修复

#### 请求

**URL**: `http://localhost:5015/en/repair`  
**Method**: `POST`  
**Content-Type**: `application/json`

**请求体**:
```json
{
  "job_id": "test-en-001",
  "session_id": "session-001",
  "text_in": "Helo, this is a test.",
  "quality_score": 0.75
}
```

**字段说明**: 与 `/zh/repair` 相同

#### 响应

**成功响应** (200 OK):
```json
{
  "request_id": "test-en-001",
  "decision": "REPAIR",
  "text_out": "Hello, this is a test.",
  "confidence": 0.88,
  "diff": [],
  "reason_codes": ["LOW_QUALITY_SCORE", "REPAIR_APPLIED"],
  "process_time_ms": 320,
  "processor_name": "en_repair"
}
```

#### 示例

**cURL**:
```bash
curl -X POST http://localhost:5015/en/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-en-001",
    "session_id": "session-001",
    "text_in": "Helo, this is a test."
  }'
```

---

### POST /repair ⭐

**统一修复端点（向后兼容ASR模块）**

为了兼容ASR模块的旧调用方式，提供统一的 `/repair` 端点。根据请求中的 `lang` 参数自动路由到相应的处理器。

**推荐**: 新的调用应该使用路径隔离的端点（`/zh/repair`, `/en/repair`），更清晰明确。

#### 请求

**方法**: `POST`  
**端点**: `/repair`  
**Content-Type**: `application/json`

**请求体**:
```json
{
  "job_id": "test-001",
  "session_id": "session-001",
  "utterance_index": 1,
  "lang": "zh",              // ⭐ 关键：通过参数指定语言
  "text_in": "你号，世界",
  "quality_score": 0.75,
  "micro_context": null
}
```

**字段说明**:
- `lang` (string, **必填**): 语言代码
  - `"zh"`: 中文语义修复
  - `"en"`: 英文语义修复
  - 其他: 返回PASS（不修复）
- 其他字段与 `/zh/repair` 相同

#### 响应

**成功响应** (200 OK):

当 `lang="zh"`:
```json
{
  "request_id": "test-001",
  "decision": "REPAIR",
  "text_out": "你好，世界",
  "confidence": 0.92,
  "diff": [],
  "reason_codes": ["LOW_QUALITY_SCORE", "REPAIR_APPLIED"],
  "process_time_ms": 245,
  "processor_name": "zh_repair"
}
```

当 `lang="en"`:
```json
{
  "request_id": "test-002",
  "decision": "REPAIR",
  "text_out": "Hello, world",
  "confidence": 0.88,
  "diff": [],
  "reason_codes": ["LOW_QUALITY_SCORE", "REPAIR_APPLIED"],
  "process_time_ms": 320,
  "processor_name": "en_repair"
}
```

当 `lang="other"` (不支持的语言):
```json
{
  "request_id": "test-003",
  "decision": "PASS",
  "text_out": "原文本内容",
  "confidence": 1.0,
  "diff": [],
  "reason_codes": ["UNSUPPORTED_LANGUAGE"],
  "process_time_ms": 0,
  "processor_name": "none"
}
```

#### 示例

**cURL (中文)**:
```bash
curl -X POST http://localhost:5015/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-zh-001",
    "session_id": "session-001",
    "utterance_index": 1,
    "lang": "zh",
    "text_in": "你号，世界",
    "quality_score": 0.75
  }'
```

**cURL (英文)**:
```bash
curl -X POST http://localhost:5015/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-en-001",
    "session_id": "session-001",
    "utterance_index": 2,
    "lang": "en",
    "text_in": "Helo, world",
    "quality_score": 0.80
  }'
```

**TypeScript (ASR模块标准调用)**:
```typescript
// ASR模块的标准调用方式
const response = await fetch('http://localhost:5015/repair', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    job_id: task.job_id,
    session_id: task.session_id,
    utterance_index: task.utterance_index,
    lang: task.lang,  // 'zh' or 'en' ⭐
    text_in: task.text_in,
    quality_score: task.quality_score,
    micro_context: task.micro_context,
    meta: task.meta,
  })
});

const result = await response.json();
```

#### 路由决策

| lang 参数 | 路由到 | 等价端点 |
|----------|--------|---------|
| `"zh"` | ZhRepairProcessor | `/zh/repair` |
| `"en"` | EnRepairProcessor | `/en/repair` |
| 其他 | 返回PASS | - |

#### 注意事项

⚠️ **向后兼容**: 此端点主要用于兼容现有的ASR模块调用方式  
💡 **推荐新方式**: 新的集成应该直接使用路径隔离的端点（`/zh/repair`, `/en/repair`）  
🎯 **自动路由**: 内部根据 `lang` 参数自动选择处理器，无需手动判断

---

### POST /en/normalize

英文文本标准化

#### 请求

**URL**: `http://localhost:5015/en/normalize`  
**Method**: `POST`  
**Content-Type**: `application/json`

**请求体**:
```json
{
  "job_id": "test-norm-001",
  "session_id": "session-001",
  "text_in": "HELLO  WORLD !!!"
}
```

**字段说明**: 与其他端点相同

#### 响应

**成功响应** (200 OK):
```json
{
  "request_id": "test-norm-001",
  "decision": "REPAIR",
  "text_out": "hello world!",
  "confidence": 0.9,
  "diff": [],
  "reason_codes": ["NORMALIZED"],
  "process_time_ms": 8,
  "processor_name": "en_normalize"
}
```

**特点**:
- ⚡ 极快响应（<10ms）
- 🚫 不使用 GPU
- 📏 基于规则引擎

#### 示例

**cURL**:
```bash
curl -X POST http://localhost:5015/en/normalize \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-norm-001",
    "session_id": "session-001",
    "text_in": "HELLO  WORLD !!!"
  }'
```

---

## 🏥 健康检查端点

### GET /health

全局健康检查（所有处理器）

#### 请求

**URL**: `http://localhost:5015/health`  
**Method**: `GET`

#### 响应

**成功响应** (200 OK):
```json
{
  "status": "healthy",
  "processors": {
    "zh_repair": {
      "status": "healthy",
      "processor_type": "model",
      "initialized": true,
      "warmed": true,
      "model_loaded": true,
      "model_version": "qwen2.5-3b-instruct-zh-q4_0.gguf"
    },
    "en_repair": {
      "status": "healthy",
      "processor_type": "model",
      "initialized": true,
      "warmed": true,
      "model_loaded": true,
      "model_version": "qwen2.5-3b-instruct-en-q4_0.gguf"
    },
    "en_normalize": {
      "status": "healthy",
      "processor_type": "rule_engine",
      "initialized": true,
      "warmed": true,
      "rules_loaded": true
    }
  }
}
```

**状态说明**:

| status | 说明 |
|--------|------|
| `healthy` | 所有处理器正常 |
| `degraded` | 部分处理器异常 |
| `error` | 全部处理器异常 |

**处理器状态**:

| status | 说明 |
|--------|------|
| `healthy` | 已初始化且已预热 |
| `loading` | 正在初始化 |
| `error` | 初始化失败 |

---

### GET /zh/health

中文处理器健康检查

#### 响应

```json
{
  "status": "healthy",
  "processor_type": "model",
  "initialized": true,
  "warmed": true,
  "model_loaded": true,
  "model_version": "qwen2.5-3b-instruct-zh-q4_0.gguf"
}
```

---

### GET /en/health

英文处理器健康检查（返回 repair 或 normalize 处理器状态）

#### 响应

```json
{
  "status": "healthy",
  "processor_type": "model",
  "initialized": true,
  "warmed": true,
  "model_loaded": true,
  "model_version": "qwen2.5-3b-instruct-en-q4_0.gguf"
}
```

或（如果 en_repair 未启用）:
```json
{
  "status": "healthy",
  "processor_type": "rule_engine",
  "initialized": true,
  "warmed": true,
  "rules_loaded": true
}
```

---

## 🔒 错误处理

### 标准错误响应

**400 Bad Request** - 请求格式错误:
```json
{
  "detail": [
    {
      "loc": ["body", "text_in"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

**503 Service Unavailable** - 处理器不可用:
```json
{
  "detail": "Processor 'zh_repair' not available"
}
```

### 降级策略

当处理器出错或超时时，自动返回降级响应：

```json
{
  "request_id": "auto-generated-uuid",
  "decision": "PASS",
  "text_out": "原始输入文本",
  "confidence": 0.5,
  "diff": [],
  "reason_codes": ["TIMEOUT"],
  "process_time_ms": 30001,
  "processor_name": "zh_repair"
}
```

**降级场景**:
- ⏱️ 处理超时（>30秒）
- ❌ 处理出错
- 🔒 处理器未初始化失败

**优势**: 保证服务始终可用，不阻塞业务流程

---

## 📊 性能指标

### 响应时间

| 端点 | 首次请求 | 后续请求（GPU） | 后续请求（CPU） |
|------|---------|---------------|---------------|
| `/zh/repair` | ~30秒 | 200-500ms | 2000-4000ms |
| `/en/repair` | ~30秒 | 200-500ms | 2000-4000ms |
| `/en/normalize` | <10ms | <10ms | <10ms |

### 并发限制

- **max_concurrency**: 1（同时只处理一个请求）
- **原因**: GPU 模型推理是串行的
- **排队**: 超过并发限制的请求会排队等待

---

## 🧪 测试示例

### 集成测试脚本

```bash
#!/bin/bash
# test_api.sh

BASE_URL="http://localhost:5015"

echo "=== 测试中文修复 ==="
curl -X POST $BASE_URL/zh/repair \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test-zh","session_id":"s1","text_in":"你号"}' \
  | jq .

echo "=== 测试英文修复 ==="
curl -X POST $BASE_URL/en/repair \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test-en","session_id":"s1","text_in":"helo"}' \
  | jq .

echo "=== 测试英文标准化 ==="
curl -X POST $BASE_URL/en/normalize \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test-norm","session_id":"s1","text_in":"HELLO"}' \
  | jq .

echo "=== 测试健康检查 ==="
curl $BASE_URL/health | jq .
```

---

## 📚 相关文档

- [架构设计](./ARCHITECTURE.md) - 系统架构说明
- [故障排查指南](./TROUBLESHOOTING.md) - 问题诊断
- [测试指南](./TESTING_GUIDE.md) - 测试方法

---

**更新**: 2026-01-19  
**维护**: 开发团队
