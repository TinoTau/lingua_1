# Unified Semantic Repair Service

统一语义修复服务：**合并原中文与英文语义修复**，在同一服务内提供中英文修复与英文标准化。**同音/近音纠错**已拆分为独立服务 `phonetic_correction_zh`（端口 5016）；本服务可通过环境变量 `PHONETIC_SERVICE_URL` 可选调用该服务，未配置时仅做繁→简 + LLM 修复。

## 特性

✅ **路径即策略**: 通过 URL 路径自动路由到不同处理器  
✅ **零 if-else**: 不在业务代码中判断语言，由路由层负责  
✅ **并发安全**: 处理器初始化含并发保护（asyncio.Lock）  
✅ **统一包装**: ProcessorWrapper 统一日志、计时、异常、fallback  
✅ **超时控制**: 30秒超时，自动降级返回原文（PASS）  
✅ **Request ID**: 自动生成或使用 job_id  
✅ **健康检查**: 区分模型型和规则型处理器  
✅ **ASR兼容**: 完全兼容现有ASR模块调用方式 ⭐

## 架构

```
semantic_repair_en_zh/
├── service.py                 # 统一服务入口
├── config.py                  # 配置管理
├── base/                      # 基础设施
│   ├── models.py             # 请求/响应模型
│   └── processor_wrapper.py  # 统一包装器
├── processors/                # 处理器层
│   ├── base_processor.py     # 抽象基类
│   ├── zh_repair_processor.py
│   ├── en_repair_processor.py
│   └── en_normalize_processor.py
├── engines/                   # 引擎层
│   ├── llamacpp_engine.py
│   └── normalizer_engine.py
└── utils/                     # 工具类
    └── model_loader.py
```

## 路径设计

| 路径 | 处理器 | 功能 |
|------|--------|------|
| `POST /zh/repair` | ZhRepairProcessor | 中文语义修复 |
| `POST /en/repair` | EnRepairProcessor | 英文语义修复 |
| `POST /en/normalize` | EnNormalizeProcessor | 英文标准化 |
| `POST /repair` ⭐ | 根据 lang 参数路由 | ASR兼容端点 |
| `GET /health` | - | 全局健康检查 |
| `GET /zh/health` | - | 中文处理器健康检查 |
| `GET /en/health` | - | 英文处理器健康检查 |

⭐ **ASR兼容**: `/repair` 端点为向后兼容而设计，根据请求中的 `lang` 参数（`zh`/`en`）自动路由到相应处理器。

## 安装

### 1. 虚拟环境与依赖（自动执行）

**应用在启动本服务时**，若检测到服务目录下无 `venv`，会**自动执行** `scripts\service\setup_venv.ps1`，创建虚拟环境并安装依赖，无需用户手动运行。之后启动均使用 `venv\Scripts\python.exe`，保证在虚拟环境中运行。

若需手动创建或更新依赖（例如离线安装后）：
```powershell
cd electron_node/services/semantic_repair_en_zh
.\scripts\service\setup_venv.ps1
```
若已存在 venv，脚本仅会执行 `pip install -r requirements.txt` 更新依赖。

### 2. 安装模型文件

**重要**: 服务需要在本目录下准备模型文件。

请参考 [模型安装指南](./MODELS_SETUP_GUIDE.md) 完成模型安装。

快速安装（从旧服务复制）：
```powershell
# 创建 models 目录
New-Item -Path "models" -ItemType Directory -Force

# 复制中文模型
Copy-Item -Path "..\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf" `
          -Destination "models\" -Recurse

# 复制英文模型
Copy-Item -Path "..\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf" `
          -Destination "models\" -Recurse
```

## 配置

通过环境变量配置：

```bash
# 服务配置
HOST=127.0.0.1
PORT=5015
TIMEOUT=30

# 启用/禁用处理器
ENABLE_ZH_REPAIR=true
ENABLE_EN_REPAIR=true
ENABLE_EN_NORMALIZE=true

# 可选：同音纠错服务 URL（如 http://127.0.0.1:5016），不设则中文修复仅做繁→简 + LLM
# PHONETIC_SERVICE_URL=http://127.0.0.1:5016
```

## 启动

- **由应用自动启动**：应用启动本服务时，若无 venv 会先自动执行 `setup_venv.ps1` 创建虚拟环境，再使用 `venv\Scripts\python.exe` 启动，保证在虚拟环境中运行。
- **手动启动**（优先使用 venv）：
  ```powershell
  .\scripts\service\start_service.ps1
  ```
  或直接：`python service.py`（使用当前 PATH 下的 Python）。

服务将在 `http://localhost:5015` 启动。

## 使用示例

### ASR模块调用（向后兼容）⭐

```bash
# 中文修复（ASR标准调用方式）
curl -X POST http://localhost:5015/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "asr-001",
    "session_id": "session-001",
    "utterance_index": 1,
    "lang": "zh",
    "text_in": "你号，这是一个测试。",
    "quality_score": 0.75
  }'

# 英文修复（ASR标准调用方式）
curl -X POST http://localhost:5015/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "asr-002",
    "session_id": "session-001",
    "utterance_index": 2,
    "lang": "en",
    "text_in": "Helo, this is a test.",
    "quality_score": 0.80
  }'
```

### 路径隔离调用（推荐新方式）

```bash
# 中文语义修复
curl -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-001",
    "session_id": "session-001",
    "text_in": "你号，这是一个测试。",
    "quality_score": 0.8
  }'

# 英文语义修复
curl -X POST http://localhost:5015/en/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-002",
    "session_id": "session-001",
    "text_in": "Helo, this is a test.",
    "quality_score": 0.8
  }'

# 英文标准化
curl -X POST http://localhost:5015/en/normalize \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-003",
    "session_id": "session-001",
    "text_in": "HELLO  WORLD !!!"
  }'
```

### 健康检查

```bash
curl http://localhost:5015/health
```

## 响应格式

节点端读取 `decision`、`text_out`、`confidence`、`repair_time_ms`：

```json
{
  "request_id": "test-001",
  "decision": "REPAIR",
  "text_out": "你好，这是一个测试。",
  "confidence": 0.92,
  "diff": [],
  "reason_codes": ["LOW_QUALITY_SCORE", "REPAIR_APPLIED"],
  "process_time_ms": 245,
  "repair_time_ms": 245,
  "processor_name": "zh_repair"
}
```

## 模型与 ASR 准确度

- **语义修复**：使用本目录 `models/` 下 GGUF 模型（中文/英文），行为与原 semantic_repair_zh、semantic_repair_en 一致。
- **同音/近音纠错**：`models/` 下提供字符级 KenLM 模型 `zh_char_3gram.trie.bin`，供**节点端**流水线使用（`CHAR_LM_PATH` 指向该文件），在语义修复前对 ASR 文本做候选选优，提高识别准确度。详见 `models/README.md`。

## 测试

### 快速功能测试

```bash
# 确保服务正在运行
python service.py

# 在另一个终端运行快速测试
python test_service.py

# 或使用 PowerShell（Windows）
.\test_service.ps1
```

### 全面测试（包含性能测试）

```bash
python test_comprehensive.py
```

### 单元测试（可选）

```bash
# 需要先安装 pytest-asyncio
pip install pytest-asyncio

# 运行单元测试
pytest tests/ -v
```

### ASR兼容性测试 ⭐

```bash
# 测试ASR模块的标准调用方式
python test_asr_compatibility.py

# 或使用 PowerShell
.\test_asr_compatibility.ps1
```

详细测试说明参考 [TEST_SUMMARY.md](./TEST_SUMMARY.md) 和 [ASR_COMPATIBILITY.md](./ASR_COMPATIBILITY.md)

## 日志

### 查看日志

```powershell
# 使用日志查看器
.\view_logs.ps1

# 查看最新启动日志
Get-ChildItem logs\ -Filter "startup_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100
```

### 捕获启动日志

```powershell
# 启动服务并捕获所有输出到日志文件
.\capture_startup_logs.ps1
```

### 日志类型

- **任务链日志**: 每个请求的输入/输出（与中文服务格式一致）
- **资源使用日志**: CPU、内存、GPU 使用情况（7个监控阶段）
- **错误日志**: 详细的异常堆栈跟踪
- **超时日志**: 请求超时和自动降级
- **信号日志**: 进程信号和优雅关闭

详细日志说明参考 [LOGGING_SUMMARY.md](./LOGGING_SUMMARY.md)

## 文档

### 📚 完整文档

本服务提供完整的文档体系，参考 [文档索引](./docs/README.md) 或 [文档整理总结](./DOCUMENTATION_SUMMARY.md)。

### 🔰 快速导航

| 文档 | 用途 |
|------|------|
| [模型安装指南](./MODELS_SETUP_GUIDE.md) | 模型下载和安装 |
| [部署检查清单](./DEPLOYMENT_CHECKLIST.md) | 部署前验证 |
| [架构设计](./docs/ARCHITECTURE.md) | 系统架构 |
| [API 参考](./docs/API_REFERENCE.md) | API 详细文档 |
| [故障排查](./docs/TROUBLESHOOTING.md) | 问题诊断 |
| [维护指南](./docs/MAINTENANCE_GUIDE.md) | 日常维护 |
| [性能优化](./docs/PERFORMANCE_OPTIMIZATION.md) | 性能调优 |
| [测试指南](./docs/TESTING_GUIDE.md) | 测试方法 |

### 🏗️ 设计文档

- [设计方案](../../../docs/architecture/SEMANTIC_REPAIR_SERVICE_UNIFICATION_DESIGN.md)
- [审阅和任务列表](../../../docs/architecture/UNIFIED_SEMANTIC_REPAIR_REVIEW_AND_TASKLIST.md)
- [实施总结](../../../docs/architecture/UNIFIED_SEMANTIC_REPAIR_IMPLEMENTATION_SUMMARY.md)

## 对比旧服务

| 指标 | 旧方案（3个服务） | 新方案（统一服务） |
|------|----------------|------------------|
| 服务数量 | 3 | 1 |
| 代码行数 | ~1500 | ~800 |
| 重复代码 | 85% | 0% |
| if-else 判断 | 3处 | 0处 |
| 部署配置 | 3个 | 1个 |

## License

MIT
