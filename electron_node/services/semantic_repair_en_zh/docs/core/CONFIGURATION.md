# 配置参考文档

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0

---

## 📋 配置文件

### 1. service.json（服务元数据）

**位置**: `semantic_repair_en_zh/service.json`

```json
{
  "service_id": "semantic-repair-en-zh",
  "name": "Unified Semantic Repair Service (EN/ZH + Normalize)",
  "version": "1.0.0",
  "type": "semantic-repair",
  "language": "multi",
  "port": 5015,
  "enabled": true,
  "replaces": ["semantic-repair-zh", "semantic-repair-en", "en-normalize"],
  "gpu_required": true,
  "vram_estimate": 2048,
  "max_concurrency": 1,
  "startup_command": "python",
  "startup_args": ["service.py"],
  "health_check": {
    "endpoint": "/health",
    "timeout_ms": 5000
  },
  "model": {
    "name": "qwen2.5-3b-instruct-multi",
    "type": "llm",
    "quantization": "int4",
    "path": "models"
  },
  "features": {
    "zh_repair": true,
    "en_repair": true,
    "en_normalize": true
  },
  "endpoints": [
    {"path": "/zh/repair", "method": "POST"},
    {"path": "/en/repair", "method": "POST"},
    {"path": "/en/normalize", "method": "POST"}
  ]
}
```

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `service_id` | string | 服务唯一标识 |
| `port` | integer | 服务端口 |
| `enabled` | boolean | 是否默认启用 |
| `replaces` | array | 替代的旧服务列表 |
| `gpu_required` | boolean | 是否需要 GPU |
| `vram_estimate` | integer | 预估显存占用（MB） |
| `max_concurrency` | integer | 最大并发数 |

---

### 2. config.py（运行时配置）

**位置**: `semantic_repair_en_zh/config.py`

#### 全局配置

```python
# 服务地址
self.host = os.environ.get("HOST", "127.0.0.1")
self.port = int(os.environ.get("PORT", 5015))

# 处理超时（秒）
self.timeout = int(os.environ.get("TIMEOUT", 30))
```

#### 处理器启用/禁用

```python
# 通过环境变量控制
self.enable_zh_repair = os.environ.get("ENABLE_ZH_REPAIR", "true").lower() == "true"
self.enable_en_repair = os.environ.get("ENABLE_EN_REPAIR", "true").lower() == "true"
self.enable_en_normalize = os.environ.get("ENABLE_EN_NORMALIZE", "true").lower() == "true"
```

#### 中文修复配置

```python
self.zh_config = {
    'model_path': self._find_model('zh'),
    'n_ctx': 2048,              # 上下文长度
    'n_gpu_layers': -1,         # GPU 层数（-1=全部）
    'quality_threshold': 0.85   # 质量阈值
}
```

#### 英文修复配置

```python
self.en_config = {
    'model_path': self._find_model('en'),
    'n_ctx': 2048,
    'n_gpu_layers': -1,
    'quality_threshold': 0.85
}
```

#### 英文标准化配置

```python
self.norm_config = {
    'rules': ['lowercase', 'punctuation', 'whitespace']
}
```

---

## 🌍 环境变量配置

### 服务配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `HOST` | 127.0.0.1 | 监听地址 |
| `PORT` | 5015 | 监听端口 |
| `TIMEOUT` | 30 | 处理超时（秒） |

**示例**:
```bash
# Linux/Mac
export HOST=0.0.0.0
export PORT=8080
export TIMEOUT=60

# Windows PowerShell
$env:HOST="0.0.0.0"
$env:PORT=8080
$env:TIMEOUT=60
```

### 处理器控制

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `ENABLE_ZH_REPAIR` | true | 启用中文修复 |
| `ENABLE_EN_REPAIR` | true | 启用英文修复 |
| `ENABLE_EN_NORMALIZE` | true | 启用英文标准化 |

**使用场景**:

```bash
# 只启用中文修复
export ENABLE_EN_REPAIR=false
export ENABLE_EN_NORMALIZE=false
python service.py

# 只启用英文相关功能
export ENABLE_ZH_REPAIR=false
python service.py
```

---

## 🎛️ 高级配置

### 1. 修改质量阈值

**位置**: `config.py` 中的 `quality_threshold`

```python
self.zh_config = {
    'quality_threshold': 0.85  # 低于此阈值触发修复
}
```

**效果**:
- 阈值越高，修复越频繁
- 阈值越低，修复越保守

**建议值**:
- 保守: 0.90
- 默认: 0.85
- 激进: 0.75

### 2. 修改 GPU 层数

**位置**: `config.py` 中的 `n_gpu_layers`

```python
self.zh_config = {
    'n_gpu_layers': -1  # 全部使用 GPU
}
```

**调优建议**:

| 显存大小 | 推荐值 | 说明 |
|---------|--------|------|
| 8GB+ | -1 | 全部使用 GPU |
| 6-8GB | 28-32 | 大部分使用 GPU |
| 4-6GB | 20-28 | 部分使用 GPU |
| <4GB | 0 | 使用 CPU |

### 3. 修改上下文长度

**位置**: `config.py` 中的 `n_ctx`

```python
self.zh_config = {
    'n_ctx': 2048  # 上下文长度
}
```

**trade-off**:
- 越大: 支持更长文本，占用内存越多
- 越小: 占用内存少，但可能截断长文本

### 4. 修改超时时间

**位置**: `config.py` 中的 `timeout`

```python
self.timeout = 30  # 处理超时（秒）
```

**建议值**:
- CPU 模式: 60-120 秒
- GPU 模式: 30-60 秒
- 快速服务: 10-30 秒

---

## 📝 配置示例

### 场景 1: 仅中文修复（节省资源）

```bash
export ENABLE_EN_REPAIR=false
export ENABLE_EN_NORMALIZE=false
python service.py
```

### 场景 2: 有限 GPU 内存

```python
# 修改 config.py
self.zh_config = {
    'n_gpu_layers': 20,  # 只使用部分 GPU
    'n_ctx': 1024        # 减少上下文
}
```

### 场景 3: CPU 模式（无 GPU）

```python
# 修改 config.py
self.zh_config = {
    'n_gpu_layers': 0,   # 使用 CPU
    'n_ctx': 2048
}

# 增加超时时间
self.timeout = 120  # 2分钟超时
```

### 场景 4: 高性能模式

```python
# 修改 config.py
self.zh_config = {
    'n_gpu_layers': -1,   # 全部 GPU
    'n_ctx': 4096         # 更大上下文
}
```

---

## 🔄 配置更新流程

### 1. 修改配置文件

```python
# 编辑 config.py
vim config.py
```

### 2. 重启服务

```typescript
// 停止服务
await semanticRepairServiceManager.stopService('semantic-repair-en-zh');

// 启动服务（新配置生效）
await semanticRepairServiceManager.startService('semantic-repair-en-zh');
```

### 3. 验证配置

```bash
# 检查服务启动日志
# 应该显示新的配置值

# 测试功能
curl http://localhost:5015/health
```

---

## 🛠️ 配置工具

### 配置验证脚本

```python
# validate_config.py
from config import Config

config = Config()

print("=== Configuration ===")
print(f"Host: {config.host}")
print(f"Port: {config.port}")
print(f"Timeout: {config.timeout}s")
print(f"\nEnabled Processors:")
print(f"  ZH Repair: {config.enable_zh_repair}")
print(f"  EN Repair: {config.enable_en_repair}")
print(f"  EN Normalize: {config.enable_en_normalize}")

enabled = config.get_enabled_processors()
print(f"\nTotal Enabled: {len(enabled)}")
for name in enabled:
    print(f"  - {name}")
```

---

## 📚 相关文档

- [架构设计](./ARCHITECTURE.md) - 系统架构
- [llama.cpp 引擎](./LLAMACPP_ENGINE.md) - 推理引擎说明
- [性能优化](./PERFORMANCE_OPTIMIZATION.md) - 性能调优

---

**更新**: 2026-01-19  
**维护**: 开发团队
