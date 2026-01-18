# 架构设计文档

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0  
**架构模式**: 策略模式 + 路径隔离

---

## 🏗️ 架构概览

### 设计原则

1. **路径即策略**: 通过 URL 路径自动路由到对应处理器
2. **零 if-else**: 业务代码不包含语言判断逻辑
3. **处理器独立**: 每个处理器是独立的类，互不干扰
4. **并发安全**: 使用 asyncio.Lock 保护初始化
5. **统一行为**: ProcessorWrapper 统一处理所有请求

---

## 📊 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                   Unified Semantic Repair Service               │
│                         (semantic-repair-en-zh)                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌───────────────────────┐
                    │   FastAPI Application │
                    │      (service.py)     │
                    └───────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │    Lifespan Manager    │
                    │  (初始化/关闭处理器)   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   ProcessorWrapper      │ ← 统一包装器
                    │  (统一日志/计时/异常)   │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  ZhRepairProc.  │    │  EnRepairProc.  │    │ EnNormalizeProc.│
│  (中文修复)     │    │  (英文修复)     │    │  (英文标准化)   │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                       │
         ▼                      ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ LlamaCppEngine  │    │ LlamaCppEngine  │    │ NormalizerEngine│
│  (中文模型)     │    │  (英文模型)     │    │   (规则引擎)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 🔀 请求流程

### 1. 请求路由流程

```
客户端请求
    │
    ▼
FastAPI 路由层
    │
    ├─ POST /zh/repair      → zh_repair()
    ├─ POST /en/repair      → en_repair()
    └─ POST /en/normalize   → en_normalize()
    │
    ▼
ProcessorWrapper.handle_request(processor_name, request)
    │
    ├─ 1. 获取处理器
    ├─ 2. 确保初始化（并发安全）
    ├─ 3. 生成 Request ID
    ├─ 4. 记录输入日志
    ├─ 5. 调用处理器（带超时）
    ├─ 6. 记录输出日志
    └─ 7. 构造响应
    │
    ▼
BaseProcessor.process(text_in, ...)
    │
    ├─ ZhRepairProcessor → LlamaCppEngine（中文模型）
    ├─ EnRepairProcessor → LlamaCppEngine（英文模型）
    └─ EnNormalizeProcessor → NormalizerEngine（规则）
    │
    ▼
返回 ProcessorResult
    │
    ▼
ProcessorWrapper 构造 RepairResponse
    │
    ▼
返回给客户端
```

### 2. 初始化流程（并发安全）

```
服务启动
    │
    ▼
lifespan 启动阶段
    │
    ├─ 加载配置（Config）
    ├─ 创建处理器实例
    │   ├─ ZhRepairProcessor(config)
    │   ├─ EnRepairProcessor(config)
    │   └─ EnNormalizeProcessor(config)
    ├─ 创建 ProcessorWrapper
    └─ 服务就绪
    │
    ▼
首次请求到达
    │
    ▼
processor.ensure_initialized()
    │
    ├─ 检查 _initialized 标志
    ├─ 获取 _init_lock（asyncio.Lock）
    ├─ 双重检查锁定
    ├─ 调用 initialize()
    │   ├─ 加载模型（ZH/EN）
    │   ├─ 初始化引擎（Normalize）
    │   └─ 预热测试
    ├─ 设置 _initialized = True
    └─ 释放锁
    │
    ▼
处理器就绪
```

**并发场景**:
```
请求1 ─┐
请求2 ─┼─→ ensure_initialized()
请求3 ─┘       │
               ├─ 请求1：获得锁，开始初始化
               ├─ 请求2：等待锁
               └─ 请求3：等待锁
               │
               ▼
        请求1 初始化完成，释放锁
               │
               ├─ 请求2：检查 _initialized=true，直接返回
               └─ 请求3：检查 _initialized=true，直接返回
```

---

## 🧩 核心组件

### 1. BaseProcessor（抽象基类）

**职责**: 定义处理器接口和并发安全初始化

**关键特性**:
- `_init_lock`: asyncio.Lock，保护初始化
- `_initialized`: 初始化状态标志
- `_init_error`: 初始化错误缓存

**接口方法**:
```python
async def initialize()     # 子类实现：加载模型/引擎
async def process(...)     # 子类实现：处理文本
async def get_health()     # 子类实现：健康状态
async def shutdown()       # 子类实现：清理资源
```

### 2. ProcessorWrapper（统一包装器）

**职责**: 统一所有处理器的行为

**功能**:
- ✅ Request ID 生成/复用
- ✅ 统一日志格式（INPUT/OUTPUT/ERROR）
- ✅ 计时和性能监控
- ✅ 超时控制（asyncio.wait_for）
- ✅ 异常处理和 fallback
- ✅ 响应构造

**代码量**: ~120行  
**消除重复**: ~300行（旧方案的重复代码）

### 3. 处理器实现

#### ZhRepairProcessor（中文语义修复）

**引擎**: LlamaCppEngine  
**模型**: qwen2.5-3b-instruct-zh (INT4 量化)  
**特性**:
- 模型加载和预热
- 质量分数阈值判断
- 微上下文支持

#### EnRepairProcessor（英文语义修复）

**引擎**: LlamaCppEngine  
**模型**: qwen2.5-3b-instruct-en (INT4 量化)  
**特性**:
- 与中文处理器相同的架构
- 独立的英文模型

#### EnNormalizeProcessor（英文标准化）

**引擎**: NormalizerEngine（规则引擎）  
**模型**: 无（轻量级）  
**特性**:
- 快速响应（<10ms）
- 无需 GPU
- 规则可配置

### 4. LlamaCppEngine（推理引擎）

**技术栈**: llama.cpp  
**模型格式**: GGUF  
**GPU 支持**: 需要 CUDA 版本的 llama-cpp-python

**关键参数**:
- `n_ctx`: 上下文长度（2048）
- `n_gpu_layers`: GPU 层数（-1 表示全部）
- `verbose`: 详细日志（False）

**推理流程**:
1. 构造 Prompt（使用模板）
2. 调用 llama.cpp 推理
3. 解析输出（JSON 格式）
4. 返回结果

---

## 🔐 并发安全机制

### 处理器初始化锁

**问题**: 多个请求同时到达时，可能重复初始化模型

**解决方案**: 双重检查锁定模式

```python
async def ensure_initialized(self):
    if self._initialized:
        return True  # 快速路径
    
    async with self._init_lock:
        # 双重检查
        if self._initialized:
            return True
        
        await self.initialize()
        self._initialized = True
```

**优势**:
- 只初始化一次
- 并发请求等待初始化完成
- 无竞态条件

### 超时控制

**实现**:
```python
result = await asyncio.wait_for(
    processor.process(...),
    timeout=30  # 30秒超时
)
```

**超时降级**:
- 返回 `decision: PASS`
- 返回原文（text_out = text_in）
- 记录 `TIMEOUT` reason code

---

## 🔌 API 设计

### 路径设计原则

**路径即策略**: 不在代码中判断语言，由路径决定处理器

| 路径 | 处理器 | 语言 | 功能 |
|------|--------|------|------|
| `/zh/repair` | ZhRepairProcessor | 中文 | 语义修复 |
| `/en/repair` | EnRepairProcessor | 英文 | 语义修复 |
| `/en/normalize` | EnNormalizeProcessor | 英文 | 文本标准化 |

**优势**:
- ✅ 代码简洁（零 if-else）
- ✅ 易于扩展（新增语言只需添加路由）
- ✅ 易于测试（每个路径独立）
- ✅ RESTful 风格

### 统一请求格式

```json
{
  "job_id": "任务ID",
  "session_id": "会话ID",
  "utterance_index": 0,
  "text_in": "输入文本",
  "quality_score": 0.8,
  "micro_context": "上一句末尾",
  "meta": {}
}
```

### 统一响应格式

```json
{
  "request_id": "请求ID（自动生成或使用job_id）",
  "decision": "PASS | REPAIR | REJECT",
  "text_out": "输出文本",
  "confidence": 0.92,
  "diff": [],
  "reason_codes": ["LOW_QUALITY_SCORE", "REPAIR_APPLIED"],
  "process_time_ms": 245,
  "processor_name": "zh_repair"
}
```

---

## 🎯 设计模式

### 1. 策略模式（Strategy Pattern）

**定义**: 定义一系列算法，将每个算法封装起来，并使它们可以互换。

**应用**:
- `BaseProcessor`: 策略接口
- `ZhRepairProcessor`, `EnRepairProcessor`, `EnNormalizeProcessor`: 具体策略
- `ProcessorWrapper`: 上下文，使用策略

**优势**:
- 易于添加新语言（新增一个处理器类）
- 处理器之间完全解耦
- 易于单元测试

### 2. 模板方法模式（Template Method）

**应用**: `BaseProcessor` 定义初始化流程

```python
async def ensure_initialized(self):
    # 模板方法：定义初始化流程
    if self._initialized:
        return True
    
    async with self._init_lock:
        if self._initialized:
            return True
        
        await self.initialize()  # 子类实现
        self._initialized = True
```

### 3. 装饰器模式（Decorator）

**应用**: `ProcessorWrapper` 装饰处理器调用

**功能**:
- 添加日志
- 添加计时
- 添加异常处理
- 添加超时控制

---

## 🔄 数据流

### 请求数据流

```
RepairRequest (Pydantic Model)
    │
    ├─ job_id: str
    ├─ session_id: str
    ├─ text_in: str
    ├─ quality_score: float
    └─ micro_context: str
    │
    ▼
ProcessorWrapper
    │
    ▼
BaseProcessor.process()
    │
    ▼
ProcessorResult (内部模型)
    │
    ├─ text_out: str
    ├─ decision: str
    ├─ confidence: float
    ├─ diff: List[Dict]
    └─ reason_codes: List[str]
    │
    ▼
ProcessorWrapper 添加元数据
    │
    ├─ request_id
    ├─ process_time_ms
    └─ processor_name
    │
    ▼
RepairResponse (Pydantic Model)
    │
    ▼
返回给客户端（JSON）
```

### 初始化数据流

```
Config
    │
    ├─ zh_config → ZhRepairProcessor
    ├─ en_config → EnRepairProcessor
    └─ norm_config → EnNormalizeProcessor
    │
    ▼
processors Dict[str, BaseProcessor]
    │
    ├─ "zh_repair": ZhRepairProcessor
    ├─ "en_repair": EnRepairProcessor
    └─ "en_normalize": EnNormalizeProcessor
    │
    ▼
ProcessorWrapper(processors, timeout)
    │
    ▼
路由函数使用 ProcessorWrapper
```

---

## 🧱 分层架构

### Layer 1: API 层（service.py）

**职责**:
- 定义 FastAPI 路由
- 参数验证（Pydantic）
- 调用 ProcessorWrapper

**代码量**: ~140行

### Layer 2: 包装层（ProcessorWrapper）

**职责**:
- 统一请求处理流程
- 日志、计时、异常处理
- Request ID 管理
- 超时控制

**代码量**: ~120行  
**关键价值**: 消除 ~300行重复代码

### Layer 3: 处理器层（Processors）

**职责**:
- 实现具体的处理逻辑
- 管理引擎生命周期
- 提供健康检查

**组件**:
- `BaseProcessor`: 抽象基类（80行）
- `ZhRepairProcessor`: 中文修复（90行）
- `EnRepairProcessor`: 英文修复（90行）
- `EnNormalizeProcessor`: 英文标准化（60行）

### Layer 4: 引擎层（Engines）

**职责**:
- 模型推理（LlamaCppEngine）
- 规则处理（NormalizerEngine）
- Prompt 管理（prompt_templates）

**复用**: 从旧服务复用引擎代码

---

## 🔧 关键技术决策

### 1. 为什么使用路径隔离？

**对比**:
```python
# ❌ 旧方案：if-else 判断
@app.post("/repair")
async def repair(request):
    if request.lang == "zh":
        return zh_processor.process(...)
    elif request.lang == "en":
        return en_processor.process(...)

# ✅ 新方案：路径即策略
@app.post("/zh/repair")
async def zh_repair(request):
    return await processor_wrapper.handle_request("zh_repair", request)

@app.post("/en/repair")
async def en_repair(request):
    return await processor_wrapper.handle_request("en_repair", request)
```

**优势**:
- 代码更清晰
- 易于扩展
- 符合 RESTful 风格
- 易于测试和文档化

### 2. 为什么使用 ProcessorWrapper？

**对比**:
```python
# ❌ 旧方案：每个路由重复实现
@app.post("/zh/repair")
async def zh_repair(request):
    request_id = request.job_id or uuid4()
    logger.info(f"INPUT | request_id={request_id} ...")
    start = time.time()
    try:
        result = processor.process(...)
        elapsed = int((time.time() - start) * 1000)
        logger.info(f"OUTPUT | request_id={request_id} ...")
        return RepairResponse(...)
    except Exception as e:
        logger.error(f"ERROR | request_id={request_id} ...")
        return RepairResponse(decision="PASS", text_out=request.text_in)

# 以上代码在 3 个路由中重复 ×3 = ~300行

# ✅ 新方案：统一包装
@app.post("/zh/repair")
async def zh_repair(request):
    return await processor_wrapper.handle_request("zh_repair", request)
```

**优势**:
- 消除 ~300行重复代码
- 统一行为（一致的日志、异常处理）
- 易于维护（修改一处即可）

### 3. 为什么使用 asyncio.Lock？

**问题场景**:
```
时刻 T0: 请求1到达 → 开始加载模型（需要10秒）
时刻 T1: 请求2到达 → 尝试加载模型（重复加载！）
时刻 T3: 请求3到达 → 尝试加载模型（重复加载！）
```

**解决方案**:
```python
async with self._init_lock:
    if not self._initialized:
        await self.initialize()  # 只有一个协程能执行
```

**效果**:
- 请求1：加载模型（10秒）
- 请求2、3：等待请求1完成，然后直接使用已加载的模型

### 4. 为什么使用超时控制？

**问题**: 模型推理可能因为异常情况卡住

**解决方案**:
```python
result = await asyncio.wait_for(
    processor.process(...),
    timeout=30
)
# 超时后自动返回原文（PASS）
```

**优势**:
- 防止请求永久挂起
- 自动降级保证服务可用性
- 客户端获得及时响应

---

## 🎨 扩展性设计

### 添加新语言支持

**步骤**:

1. **创建处理器类**:
```python
# processors/ja_repair_processor.py
class JaRepairProcessor(BaseProcessor):
    def __init__(self, config):
        super().__init__(config, "ja_repair")
        # ... 实现日文修复逻辑
```

2. **添加配置**:
```python
# config.py
self.ja_config = {
    'model_path': self._find_model('ja'),
    'n_ctx': 2048,
    'n_gpu_layers': -1,
    'quality_threshold': 0.85
}
```

3. **添加路由**:
```python
# service.py
@app.post("/ja/repair")
async def ja_repair(request: RepairRequest):
    return await processor_wrapper.handle_request("ja_repair", request)
```

**就这么简单！** 无需修改其他代码。

---

## 📏 代码规范

### 文件组织

```
服务入口层:    service.py
配置层:        config.py
基础设施层:    base/models.py, base/processor_wrapper.py
处理器层:      processors/*.py
引擎层:        engines/*.py
工具层:        utils/*.py
测试层:        tests/*.py
```

### 命名规范

- **类名**: PascalCase（如 `ZhRepairProcessor`）
- **函数名**: snake_case（如 `ensure_initialized`）
- **常量**: UPPER_CASE（如 `MAX_TIMEOUT`）
- **私有成员**: `_` 前缀（如 `_init_lock`）

### 日志规范

**格式**:
```
[processor_name] LEVEL | field1=value1 | field2=value2 | ...
```

**示例**:
```
[zh_repair] INPUT | request_id=test-001 | text_in='你号' | text_length=2
[zh_repair] OUTPUT | request_id=test-001 | decision=REPAIR | text_out='你好'
[zh_repair] ERROR | request_id=test-002 | error=... | fallback=PASS
```

---

## 📚 参考文档

- [故障排查指南](./TROUBLESHOOTING.md) - 问题诊断
- [性能优化指南](./PERFORMANCE_OPTIMIZATION.md) - 性能调优
- [API 参考](./API_REFERENCE.md) - API 详细文档
- [测试指南](./TESTING_GUIDE.md) - 测试方法

---

**更新**: 2026-01-19  
**维护**: 开发团队
