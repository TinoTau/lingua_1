# Phase 1 代码重构与项目路径总结

## 一、代码重构

### 1.1 文件拆分

为了确保每个代码文件不超过500行，将语义修复相关代码拆分到独立文件：

#### 新增文件

1. **`electron_node/electron-node/main/src/agent/node-agent-services-semantic-repair.ts`** (92行)
   - 职责：语义修复服务发现逻辑
   - 包含：`SemanticRepairServiceDiscovery` 类
   - 方法：
     - `getInstalledSemanticRepairServices()` - 获取已安装的语义修复服务
     - `isSemanticRepairServiceRunning()` - 检查服务运行状态

2. **`electron_node/electron-node/main/src/agent/postprocess/postprocess-semantic-repair-initializer.ts`** (105行)
   - 职责：语义修复Stage初始化逻辑
   - 包含：`SemanticRepairInitializer` 类
   - 方法：
     - `initialize()` - 初始化语义修复Stage
     - `reinitialize()` - 重新初始化（热插拔）
     - `isInitialized()` - 检查初始化状态
     - `getInitPromise()` - 获取初始化Promise

#### 修改文件

1. **`electron_node/electron-node/main/src/agent/node-agent-services.ts`** (258行，原354行)
   - 移除：语义修复服务发现相关代码（已移至独立文件）
   - 保留：通用服务发现逻辑
   - 新增：`SemanticRepairServiceDiscovery` 实例

2. **`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`** (390行，原523行)
   - 移除：语义修复初始化相关代码（已移至独立文件）
   - 保留：后处理协调逻辑
   - 新增：`SemanticRepairInitializer` 实例

### 1.2 文件行数统计

所有文件均控制在500行以内：

| 文件 | 行数 | 状态 |
|------|------|------|
| `node-agent-services.ts` | 258 | ✅ |
| `node-agent-services-semantic-repair.ts` | 92 | ✅ |
| `postprocess-coordinator.ts` | 390 | ✅ |
| `postprocess-semantic-repair-initializer.ts` | 105 | ✅ |
| `task-router-semantic-repair.ts` | 213 | ✅ |

## 二、项目路径结构

### 2.1 语义修复服务目录

已创建三个语义修复服务的项目路径：

#### 1. 中文语义修复服务 (`semantic_repair_zh`)

```
electron_node/services/semantic_repair_zh/
├── service.json                      # 服务配置文件
├── semantic_repair_zh_service.py     # 主服务文件（待实现）
├── model_loader.py                   # 模型加载器（待实现）
├── repair_engine.py                  # 修复引擎（待实现）
├── prompt_templates.py               # Prompt模板（待实现）
├── requirements.txt                  # Python依赖
├── README.md                         # 服务文档
├── models/                           # 模型目录（待用户准备）
│   └── qwen2.5-3b-instruct-zh/      # 中文优化模型
└── logs/                             # 日志目录
```

**服务配置**:
- 服务ID: `semantic-repair-zh`
- 端口: `5010`
- 模型: `qwen2.5-3b-instruct-zh` (INT4量化)
- GPU: 需要 (约2GB VRAM)
- 最大并发: 2

#### 2. 英文语义修复服务 (`semantic_repair_en`)

```
electron_node/services/semantic_repair_en/
├── service.json                      # 服务配置文件
├── semantic_repair_en_service.py     # 主服务文件（待实现）
├── model_loader.py                   # 模型加载器（待实现）
├── repair_engine.py                  # 修复引擎（待实现）
├── prompt_templates.py               # Prompt模板（待实现）
├── requirements.txt                     # Python依赖
├── README.md                         # 服务文档
├── models/                           # 模型目录（待用户准备）
│   └── qwen2.5-3b-instruct-en/      # 英文优化模型
└── logs/                             # 日志目录
```

**服务配置**:
- 服务ID: `semantic-repair-en`
- 端口: `5011`
- 模型: `qwen2.5-3b-instruct-en` (INT4量化)
- GPU: 需要 (约2GB VRAM)
- 最大并发: 2

#### 3. 英文标准化服务 (`en_normalize`)

```
electron_node/services/en_normalize/
├── service.json                      # 服务配置文件
├── en_normalize_service.py          # 主服务文件（待实现）
├── normalizer.py                     # 标准化器（待实现）
├── rules/                            # 规则文件目录（待实现）
│   ├── number_rules.py
│   ├── unit_rules.py
│   ├── date_rules.py
│   └── acronym_rules.py
├── requirements.txt                  # Python依赖
├── README.md                         # 服务文档
└── logs/                             # 日志目录
```

**服务配置**:
- 服务ID: `en-normalize`
- 端口: `5012`
- 模型: 无（纯规则处理）
- GPU: 不需要
- 最大并发: 10

### 2.2 服务接口规范

所有服务需要实现以下接口：

#### POST /repair (或 /normalize)

**请求格式**:
```json
{
  "job_id": "string",
  "session_id": "string",
  "utterance_index": 0,
  "lang": "zh" | "en",
  "text_in": "string",
  "quality_score": 0.0-1.0,
  "micro_context": "string",
  "meta": {
    "segments": [],
    "language_probability": 0.0-1.0,
    "reason_codes": []
  }
}
```

**响应格式**:
```json
{
  "decision": "PASS" | "REPAIR" | "REJECT",
  "text_out": "string",
  "confidence": 0.0-1.0,
  "diff": [
    {
      "from": "string",
      "to": "string",
      "position": 0
    }
  ],
  "reason_codes": [],
  "repair_time_ms": 0
}
```

#### GET /health

**响应格式**:
```json
{
  "status": "healthy" | "ready" | "error",
  "model_loaded": true,
  "model_version": "string"
}
```

## 三、下一步工作（Phase 2）

### 3.1 服务实现

1. **semantic_repair_zh**:
   - 实现 `semantic_repair_zh_service.py`
   - 实现模型加载逻辑
   - 实现修复引擎
   - 实现Prompt模板

2. **semantic_repair_en**:
   - 实现 `semantic_repair_en_service.py`
   - 实现模型加载逻辑
   - 实现修复引擎
   - 实现Prompt模板

3. **en_normalize**:
   - 实现 `en_normalize_service.py`
   - 实现标准化规则
   - 实现规则引擎

### 3.2 模型准备

用户需要准备以下模型：

1. **qwen2.5-3b-instruct-zh** (INT4量化)
   - 路径: `electron_node/services/semantic_repair_zh/models/qwen2.5-3b-instruct-zh/`
   - 用途: 中文语义修复

2. **qwen2.5-3b-instruct-en** (INT4量化)
   - 路径: `electron_node/services/semantic_repair_en/models/qwen2.5-3b-instruct-en/`
   - 用途: 英文语义修复

### 3.3 依赖安装

每个服务需要安装相应的Python依赖：

```bash
# 中文语义修复服务
cd electron_node/services/semantic_repair_zh
pip install -r requirements.txt

# 英文语义修复服务
cd electron_node/services/semantic_repair_en
pip install -r requirements.txt

# 英文标准化服务
cd electron_node/services/en_normalize
pip install -r requirements.txt
```

## 四、文件清单

### 4.1 新增文件

**Node端代码**:
- `electron_node/electron-node/main/src/agent/node-agent-services-semantic-repair.ts`
- `electron_node/electron-node/main/src/agent/postprocess/postprocess-semantic-repair-initializer.ts`

**服务端代码**:
- `electron_node/services/semantic_repair_zh/service.json`
- `electron_node/services/semantic_repair_zh/semantic_repair_zh_service.py`
- `electron_node/services/semantic_repair_zh/requirements.txt`
- `electron_node/services/semantic_repair_zh/README.md`
- `electron_node/services/semantic_repair_en/service.json`
- `electron_node/services/semantic_repair_en/semantic_repair_en_service.py`
- `electron_node/services/semantic_repair_en/requirements.txt`
- `electron_node/services/semantic_repair_en/README.md`
- `electron_node/services/en_normalize/service.json`
- `electron_node/services/en_normalize/en_normalize_service.py`
- `electron_node/services/en_normalize/requirements.txt`
- `electron_node/services/en_normalize/README.md`

### 4.2 修改文件

- `electron_node/electron-node/main/src/agent/node-agent-services.ts`
- `electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

## 五、验证

### 5.1 代码检查

- ✅ 所有文件行数 < 500行
- ✅ 无Linter错误
- ✅ 类型定义完整

### 5.2 测试

- ✅ 单元测试通过（10个测试用例）
- ✅ 服务发现机制正常工作

## 六、注意事项

1. **模型路径**: 用户需要将模型放置在对应的 `models/` 目录下
2. **端口配置**: 确保端口5010、5011、5012未被占用
3. **GPU资源**: 中文和英文语义修复服务需要GPU，请确保有足够的VRAM
4. **服务注册**: 服务安装后需要通过ServiceRegistryManager注册
