# 语义修复服务统一设计方案

**设计日期**: 2026-01-19  
**实施状态**: ✅ 已完成  
**目标**: 合并中文/英文语义修复和英文标准化服务，使用路径隔离而非 if-else

**查看实施结果**: [实施总结文档](./UNIFIED_SEMANTIC_REPAIR_IMPLEMENTATION_SUMMARY.md)

---

## 1. 现状分析

### 1.1 现有服务

| 服务 | 端口 | 端点 | 处理器 | 模型 | 语言检查 |
|------|------|------|--------|------|---------|
| **semantic_repair_zh** | 5013 | `/repair` | LlamaCppEngine | Qwen2.5-3B-ZH GGUF | `if lang != "zh"` → PASS |
| **semantic_repair_en** | 5011 | `/repair` | LlamaCppEngine | Qwen2.5-3B-EN GGUF | `if lang != "en"` → PASS |
| **en_normalize** | 5012 | `/normalize` | EnNormalizer | 无（规则引擎） | `if lang != "en"` → PASS |

### 1.2 代码相似度分析

**高度相似部分** (~85% 代码相同):
- FastAPI 应用结构
- lifespan 生命周期管理
- 请求/响应模型（RepairRequest/RepairResponse）
- 健康检查端点
- 日志记录逻辑
- 错误处理

**差异部分** (~15%):
- 模型加载路径（中文/英文模型）
- 处理器实现（LlamaCppEngine vs EnNormalizer）
- 端点路径（/repair vs /normalize）
- 语言过滤逻辑

---

## 2. 统一设计方案：路径隔离架构

### 2.1 核心设计原则

✅ **路径即策略**: 通过不同的 URL 路径自动路由到不同处理器  
✅ **零 if-else**: 不在业务代码中判断语言，由路由层负责  
✅ **处理器独立**: 每个处理器是独立的类，可单独测试  
✅ **共享基础设施**: 共用日志、监控、错误处理等

### 2.2 统一服务架构

```
unified-semantic-repair-service/
├── service.py                    # 统一服务入口
├── config.py                     # 配置管理
├── base/                         # 基础设施
│   ├── models.py                # 统一的请求/响应模型
│   ├── logging.py               # 统一日志
│   └── health.py                # 统一健康检查
├── processors/                   # 处理器层（策略模式）
│   ├── base_processor.py        # 抽象基类
│   ├── zh_repair_processor.py   # 中文语义修复处理器
│   ├── en_repair_processor.py   # 英文语义修复处理器
│   └── en_normalize_processor.py # 英文标准化处理器
├── engines/                      # 引擎层
│   ├── llamacpp_engine.py       # Llama.cpp 引擎
│   └── normalizer_engine.py     # 标准化引擎
└── utils/                        # 工具类
    ├── model_loader.py          # 模型加载
    └── device_manager.py        # 设备管理
```

### 2.3 路径设计

| 路径 | 处理器 | 功能 | 模型 |
|------|--------|------|------|
| `POST /zh/repair` | ZhRepairProcessor | 中文语义修复 | Qwen2.5-3B-ZH GGUF |
| `POST /en/repair` | EnRepairProcessor | 英文语义修复 | Qwen2.5-3B-EN GGUF |
| `POST /en/normalize` | EnNormalizeProcessor | 英文标准化 | 无（规则引擎） |
| `GET /health` | - | 全局健康检查 | - |
| `GET /zh/health` | - | 中文处理器健康检查 | - |
| `GET /en/health` | - | 英文处理器健康检查 | - |

---

## 3. 详细设计

### 3.1 处理器抽象基类

```python
# processors/base_processor.py
from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseProcessor(ABC):
    """处理器抽象基类"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.initialized = False
    
    @abstractmethod
    async def initialize(self):
        """初始化处理器（加载模型等）"""
        pass
    
    @abstractmethod
    async def process(
        self,
        text_in: str,
        micro_context: str = None,
        quality_score: float = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        处理文本
        
        Returns:
            {
                'text_out': str,
                'decision': str,  # PASS, REPAIR, REJECT
                'confidence': float,
                'diff': List[Dict],
                'reason_codes': List[str]
            }
        """
        pass
    
    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        pass
    
    @abstractmethod
    async def shutdown(self):
        """优雅关闭"""
        pass
```

### 3.2 中文语义修复处理器

```python
# processors/zh_repair_processor.py
from .base_processor import BaseProcessor
from engines.llamacpp_engine import LlamaCppEngine

class ZhRepairProcessor(BaseProcessor):
    """中文语义修复处理器"""
    
    async def initialize(self):
        """加载中文模型"""
        model_path = self.config['zh_model_path']
        self.engine = LlamaCppEngine(
            model_path=model_path,
            n_ctx=2048,
            n_gpu_layers=-1,
            verbose=False
        )
        # 预热
        await self._warmup()
        self.initialized = True
    
    async def process(
        self,
        text_in: str,
        micro_context: str = None,
        quality_score: float = None,
        **kwargs
    ) -> Dict[str, Any]:
        """执行中文语义修复"""
        if not self.initialized:
            raise RuntimeError("Processor not initialized")
        
        result = self.engine.repair(
            text_in=text_in,
            micro_context=micro_context,
            quality_score=quality_score
        )
        
        decision = "REPAIR" if result['text_out'] != text_in else "PASS"
        reason_codes = []
        
        if quality_score is not None and quality_score < 0.85:
            reason_codes.append("LOW_QUALITY_SCORE")
        
        if decision == "REPAIR":
            reason_codes.append("REPAIR_APPLIED")
        
        return {
            'text_out': result['text_out'],
            'decision': decision,
            'confidence': result['confidence'],
            'diff': result['diff'],
            'reason_codes': reason_codes
        }
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        return {
            'status': 'healthy' if self.initialized else 'loading',
            'model_loaded': self.initialized,
            'warmed': self.initialized
        }
    
    async def shutdown(self):
        """清理资源"""
        if hasattr(self, 'engine'):
            self.engine.shutdown()
```

### 3.3 统一服务入口

```python
# service.py
from fastapi import FastAPI, HTTPException, Request
from contextlib import asynccontextmanager
from typing import Dict

from base.models import RepairRequest, RepairResponse, HealthResponse
from processors.zh_repair_processor import ZhRepairProcessor
from processors.en_repair_processor import EnRepairProcessor
from processors.en_normalize_processor import EnNormalizeProcessor
from config import Config

# 全局处理器注册表
processors: Dict[str, BaseProcessor] = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global processors
    
    # 启动：初始化所有处理器
    config = Config()
    
    print("[Unified Service] Initializing processors...")
    
    # 初始化中文语义修复处理器
    if config.enable_zh_repair:
        zh_processor = ZhRepairProcessor(config.zh_config)
        await zh_processor.initialize()
        processors['zh_repair'] = zh_processor
        print("[Unified Service] ✅ ZH Repair Processor ready")
    
    # 初始化英文语义修复处理器
    if config.enable_en_repair:
        en_processor = EnRepairProcessor(config.en_config)
        await en_processor.initialize()
        processors['en_repair'] = en_processor
        print("[Unified Service] ✅ EN Repair Processor ready")
    
    # 初始化英文标准化处理器
    if config.enable_en_normalize:
        norm_processor = EnNormalizeProcessor(config.norm_config)
        await norm_processor.initialize()
        processors['en_normalize'] = norm_processor
        print("[Unified Service] ✅ EN Normalize Processor ready")
    
    print(f"[Unified Service] Service ready with {len(processors)} processors")
    
    yield  # 应用运行期间
    
    # 关闭：清理所有处理器
    print("[Unified Service] Shutting down processors...")
    for name, processor in processors.items():
        await processor.shutdown()
        print(f"[Unified Service] ✅ {name} shut down")
    processors.clear()


app = FastAPI(
    title="Unified Semantic Repair Service",
    version="2.0.0",
    lifespan=lifespan
)

# ==================== 路径隔离的端点 ====================

@app.post("/zh/repair", response_model=RepairResponse)
async def zh_repair(request: RepairRequest):
    """中文语义修复"""
    processor = processors.get('zh_repair')
    if not processor:
        raise HTTPException(status_code=503, detail="ZH Repair processor not available")
    
    # 记录日志
    logger.info(
        f"ZH_REPAIR INPUT: job_id={request.job_id} | "
        f"text_in={request.text_in!r}"
    )
    
    start_time = time.time()
    
    try:
        result = await processor.process(
            text_in=request.text_in,
            micro_context=request.micro_context,
            quality_score=request.quality_score
        )
        
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        # 记录日志
        logger.info(
            f"ZH_REPAIR OUTPUT: job_id={request.job_id} | "
            f"decision={result['decision']} | "
            f"text_out={result['text_out']!r} | "
            f"repair_time_ms={elapsed_ms}"
        )
        
        return RepairResponse(
            **result,
            repair_time_ms=elapsed_ms
        )
    except Exception as e:
        logger.error(f"ZH_REPAIR ERROR: {e}")
        # 返回原文
        return RepairResponse(
            decision="PASS",
            text_out=request.text_in,
            confidence=0.5,
            diff=[],
            reason_codes=["ERROR"],
            repair_time_ms=int((time.time() - start_time) * 1000)
        )


@app.post("/en/repair", response_model=RepairResponse)
async def en_repair(request: RepairRequest):
    """英文语义修复"""
    processor = processors.get('en_repair')
    if not processor:
        raise HTTPException(status_code=503, detail="EN Repair processor not available")
    
    # 类似于 zh_repair 的实现
    # ... (省略重复代码)


@app.post("/en/normalize", response_model=RepairResponse)
async def en_normalize(request: RepairRequest):
    """英文标准化"""
    processor = processors.get('en_normalize')
    if not processor:
        raise HTTPException(status_code=503, detail="EN Normalize processor not available")
    
    # 类似实现
    # ... (省略重复代码)


@app.get("/health")
async def global_health():
    """全局健康检查"""
    health_status = {}
    overall_healthy = True
    
    for name, processor in processors.items():
        status = await processor.health_check()
        health_status[name] = status
        if status['status'] != 'healthy':
            overall_healthy = False
    
    return {
        'status': 'healthy' if overall_healthy else 'degraded',
        'processors': health_status
    }


@app.get("/zh/health")
async def zh_health():
    """中文处理器健康检查"""
    processor = processors.get('zh_repair')
    if not processor:
        return {'status': 'unavailable'}
    return await processor.health_check()


@app.get("/en/health")
async def en_health():
    """英文处理器健康检查"""
    # 返回英文相关处理器的综合状态
    repair_status = {'status': 'unavailable'}
    norm_status = {'status': 'unavailable'}
    
    if 'en_repair' in processors:
        repair_status = await processors['en_repair'].health_check()
    
    if 'en_normalize' in processors:
        norm_status = await processors['en_normalize'].health_check()
    
    return {
        'repair': repair_status,
        'normalize': norm_status
    }
```

### 3.4 配置管理

```python
# config.py
import os
from typing import Dict, Any

class Config:
    """统一配置管理"""
    
    def __init__(self):
        # 全局配置
        self.host = os.environ.get("HOST", "127.0.0.1")
        self.port = int(os.environ.get("PORT", 5015))  # 新的统一端口
        
        # 启用/禁用处理器（可通过环境变量控制）
        self.enable_zh_repair = os.environ.get("ENABLE_ZH_REPAIR", "true").lower() == "true"
        self.enable_en_repair = os.environ.get("ENABLE_EN_REPAIR", "true").lower() == "true"
        self.enable_en_normalize = os.environ.get("ENABLE_EN_NORMALIZE", "true").lower() == "true"
        
        # 中文语义修复配置
        self.zh_config = {
            'model_path': self._find_zh_model(),
            'n_ctx': 2048,
            'n_gpu_layers': -1,
            'quality_threshold': 0.85
        }
        
        # 英文语义修复配置
        self.en_config = {
            'model_path': self._find_en_model(),
            'n_ctx': 2048,
            'n_gpu_layers': -1,
            'quality_threshold': 0.85
        }
        
        # 英文标准化配置
        self.norm_config = {
            'rules': ['lowercase', 'punctuation', 'whitespace']
        }
    
    def _find_zh_model(self) -> str:
        """查找中文模型路径"""
        base_dir = os.path.dirname(__file__)
        model_dir = os.path.join(base_dir, 'models', 'qwen2.5-3b-instruct-zh-gguf')
        # 查找 .gguf 文件
        for file in os.listdir(model_dir):
            if file.endswith('.gguf'):
                return os.path.join(model_dir, file)
        raise FileNotFoundError(f"ZH model not found in {model_dir}")
    
    def _find_en_model(self) -> str:
        """查找英文模型路径"""
        # 类似实现
        pass
```

---

## 4. 优势分析

### 4.1 架构优势

✅ **路径即策略**: 
- 调用方通过路径直接选择处理器，无需在业务代码中判断语言
- 例如：`POST /zh/repair` 自动路由到中文处理器

✅ **零 if-else**:
```python
# ❌ 旧方式（在业务代码中判断）
if request.lang == "zh":
    result = zh_processor.repair(text)
elif request.lang == "en":
    result = en_processor.repair(text)

# ✅ 新方式（路由层自动处理）
# 调用方直接访问 /zh/repair 或 /en/repair
```

✅ **可扩展性**:
- 新增语言处理器只需：
  1. 实现 `BaseProcessor` 接口
  2. 注册到 `processors` 字典
  3. 添加路由 `@app.post("/ja/repair")`
- 无需修改现有代码

✅ **可测试性**:
- 每个处理器是独立的类，可单独测试
- 不依赖其他处理器

✅ **资源优化**:
- 可通过环境变量选择性启用处理器
- 例如：只需要中文处理时，`ENABLE_EN_REPAIR=false`

### 4.2 部署优势

**单服务模式**（推荐）:
```bash
# 启动统一服务（包含所有处理器）
python service.py
# 监听端口: 5015
# 路径: /zh/repair, /en/repair, /en/normalize
```

**多服务模式**（可选）:
```bash
# 只启动中文处理器
ENABLE_EN_REPAIR=false ENABLE_EN_NORMALIZE=false python service.py --port 5013

# 只启动英文处理器
ENABLE_ZH_REPAIR=false python service.py --port 5011
```

---

## 5. 迁移路径

### 5.1 向后兼容方案

为了不影响现有调用方，可以同时保留旧端点：

```python
@app.post("/repair", response_model=RepairResponse)
async def legacy_repair(request: RepairRequest):
    """兼容旧端点（根据 lang 字段路由）"""
    if request.lang == "zh":
        return await zh_repair(request)
    elif request.lang == "en":
        return await en_repair(request)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {request.lang}")
```

### 5.2 迁移步骤

**Phase 1: 统一服务部署**
1. 部署新的统一服务（端口 5015）
2. 保持旧服务运行（端口 5011/5012/5013）
3. 调用方可选择访问新端点或旧端点

**Phase 2: 调用方迁移**
1. 更新调用方代码，使用新路径：
   - `POST http://localhost:5015/zh/repair`
   - `POST http://localhost:5015/en/repair`
   - `POST http://localhost:5015/en/normalize`
2. 移除请求中的 `lang` 字段（不再需要）

**Phase 3: 旧服务下线**
1. 确认所有调用方已迁移
2. 关闭旧服务（端口 5011/5012/5013）
3. 移除兼容端点 `/repair`

---

## 6. 代码量对比

| 指标 | 现有方案 | 统一方案 | 变化 |
|------|---------|---------|------|
| 服务数量 | 3 | 1 | ⬇️ -66% |
| 总代码行数 | ~1500 行 | ~800 行 | ⬇️ -47% |
| 重复代码 | ~85% | ~0% | ⬇️ -100% |
| 业务逻辑 if-else | 3 处 | 0 处 | ⬇️ -100% |
| 部署配置文件 | 3 个 | 1 个 | ⬇️ -66% |

---

## 7. 实现建议

### 7.1 优先级

**P0 (必须)**:
- 实现 `BaseProcessor` 抽象基类
- 实现 3 个处理器（ZhRepairProcessor、EnRepairProcessor、EnNormalizeProcessor）
- 实现统一服务入口和路由

**P1 (重要)**:
- 配置管理（Config 类）
- 统一日志
- 健康检查

**P2 (可选)**:
- 向后兼容端点
- Prometheus 指标
- 诊断端点

### 7.2 测试策略

1. **单元测试**: 每个处理器独立测试
2. **集成测试**: 测试路由和端到端流程
3. **性能测试**: 对比统一服务和独立服务的性能
4. **兼容性测试**: 确保旧调用方可以无缝迁移

---

## 8. 总结

### 优势
✅ **代码精简**: 消除 85% 重复代码  
✅ **零 if-else**: 通过路径隔离实现策略选择  
✅ **易扩展**: 新增语言只需添加处理器和路由  
✅ **可测试**: 每个处理器独立，易于单元测试  
✅ **资源优化**: 可选择性启用处理器  
✅ **向后兼容**: 可保留兼容端点，平滑迁移

### 风险
⚠️ **初期开发工作量**: 需要重构现有代码  
⚠️ **迁移成本**: 需要更新调用方代码（可通过兼容端点缓解）  
⚠️ **单点故障**: 统一服务故障会影响所有语言处理（可通过多实例部署缓解）

### 建议
💡 **推荐实施**: 架构更清晰，维护成本更低，长期收益明显  
💡 **分阶段迁移**: 先部署统一服务，再逐步迁移调用方，最后下线旧服务  
💡 **保留灵活性**: 通过环境变量控制启用哪些处理器，支持灵活部署

---

**文档结束**
