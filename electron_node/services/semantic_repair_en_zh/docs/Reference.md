# 语义修复服务参考（架构 / API / 配置 / 引擎）

**服务**: semantic-repair-en-zh | **端口**: 5015 | **基础 URL**: `http://localhost:5015`

---

## 1. 架构概览

- **路径即策略**：URL 路径决定处理器，业务代码零语言 if-else。
- **组件**：FastAPI 到 ProcessorWrapper（统一日志/计时/超时/异常），再到三个处理器（ZhRepair / EnRepair / EnNormalize），最后到 LlamaCppEngine 或 NormalizerEngine。
- **并发安全**：处理器懒加载，ensure_initialized() 使用 asyncio.Lock 双重检查，只初始化一次。
- **超时与降级**：单次处理 30 秒超时，超时或异常时返回 decision: PASS、text_out 为原文。

### 路径与处理器

| 路径 | 方法 | 处理器 | 说明 |
|------|------|--------|------|
| /zh/repair | POST | ZhRepairProcessor | 中文语义修复（LlamaCpp + 中文模型） |
| /en/repair | POST | EnRepairProcessor | 英文语义修复（LlamaCpp + 英文模型） |
| /en/normalize | POST | EnNormalizeProcessor | 英文标准化（规则引擎，<10ms） |
| /repair | POST | 按 lang 路由 | ASR 兼容：lang=zh 或 en |
| /health | GET | - | 全局健康（各处理器状态） |
| /zh/health、/en/health | GET | - | 单处理器健康 |

---

## 2. API 要点

### 请求体（修复类端点）

- job_id、session_id、utterance_index、text_in、quality_score、micro_context、meta。
- /repair 必须带 lang: "zh" 或 "en"。

### 响应体

- request_id、decision（PASS | REPAIR | REJECT）、text_out、confidence、diff、reason_codes、process_time_ms、processor_name。
- reason_codes 示例：LOW_QUALITY_SCORE、REPAIR_APPLIED、TIMEOUT、ERROR。

### 健康检查

- GET /health 返回 status（healthy/degraded/error）与各 processors 的 status、processor_type（model/rule_engine）、initialized、warmed、model_loaded/rules_loaded。
- 503 表示处理器不可用，detail 为 "Processor 'xxx' not available"。

---

## 3. 配置（config.py + 环境变量）

### 服务

- HOST 默认 127.0.0.1；PORT 默认 5015；TIMEOUT 默认 30 秒。

### 处理器开关

- ENABLE_ZH_REPAIR、ENABLE_EN_REPAIR、ENABLE_EN_NORMALIZE 默认 true。

### 模型相关（config.py）

- 中文/英文修复：model_path 为本目录 models 下 qwen2.5-3b-instruct-zh-gguf、en-gguf 的 .gguf；n_ctx 默认 2048；n_gpu_layers 默认 -1；quality_threshold 默认 0.85。
- 英文标准化：仅规则，无模型。

### service.json

- 服务元数据：service_id、port、gpu_required、vram_estimate、max_concurrency、health_check 等，见本目录 service.json。

---

## 4. LlamaCpp 引擎（GGUF）

- 技术：llama.cpp，GGUF 格式，INT4 量化；中文/英文修复共用同一引擎类，不同模型路径。
- GPU：需 CUDA 版 llama-cpp-python（如 pip 安装 cu121 wheel）。n_gpu_layers=-1 表示全部上 GPU。
- 主要参数：n_ctx、n_gpu_layers、temperature（如 0.3）、max_tokens（如 512）。
- Prompt：见 engines/prompt_templates.py，Qwen2.5 对话格式。

---

## 5. 扩展与规范

- 新增语言：新增处理器类、在 config 中增加配置、在 service.py 增加路由（如 POST /ja/repair）。
- 日志格式：[processor_name] INPUT/OUTPUT/ERROR | request_id=... | ...
- 代码分层：API（service.py）、包装（ProcessorWrapper）、处理器（processors/*）、引擎（engines/*）。

详细故障排查与运维见 Operations.md。
