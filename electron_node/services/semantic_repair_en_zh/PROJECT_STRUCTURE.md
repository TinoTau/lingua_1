# 项目目录结构

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0  
**最后更新**: 2026-01-19

---

## 📁 完整目录结构

```
semantic-repair-en-zh/
│
├── 📄 README.md                           # 服务主文档
├── 📄 MODELS_SETUP_GUIDE.md               # 模型安装指南
├── 📄 ASR_COMPATIBILITY.md                # ASR兼容性说明
│
├── 🐍 service.py                          # 服务主程序
├── ⚙️ config.py                           # 配置管理
├── 📋 service.json                        # 服务元数据
├── 📦 requirements.txt                    # Python依赖
├── 🚫 .gitignore                          # Git忽略规则
├── 🔧 __init__.py                         # Python包初始化
│
├── 📚 docs/                               # 文档目录
│   ├── 📄 README.md                       # 文档索引
│   │
│   ├── 📖 core/                           # 核心技术文档
│   │   ├── ARCHITECTURE.md                # 架构设计
│   │   ├── API_REFERENCE.md               # API参考
│   │   ├── CONFIGURATION.md               # 配置说明
│   │   └── LLAMACPP_ENGINE.md             # LlamaCpp引擎
│   │
│   ├── 🔧 operations/                     # 运维文档
│   │   ├── DEPLOYMENT_CHECKLIST.md        # 部署检查清单
│   │   ├── MAINTENANCE_GUIDE.md           # 维护指南
│   │   ├── TROUBLESHOOTING.md             # 故障排查
│   │   └── PERFORMANCE_OPTIMIZATION.md    # 性能优化
│   │
│   ├── 🧪 testing/                        # 测试文档
│   │   ├── TESTING_GUIDE.md               # 测试指南
│   │   └── TEST_SUMMARY.md                # 测试总结
│   │
│   ├── 📜 scripts/                        # 脚本文档
│   │   ├── SCRIPTS_USAGE_GUIDE.md         # 脚本使用指南
│   │   └── README_SCRIPTS.md              # 脚本说明
│   │
│   ├── 💻 development/                    # 开发文档
│   │   ├── LOGGING_SUMMARY.md             # 日志总结
│   │   ├── FILE_MANIFEST.md               # 文件清单
│   │   └── SERVICE_REGISTRATION.md        # 服务注册
│   │
│   ├── 📊 summaries/                      # 总结报告
│   │   └── DOCUMENTATION_SUMMARY.md       # 文档整理总结
│   │
│   └── 📦 archived/                       # 历史文档（归档）
│       ├── implementation/                # 实现过程（5个）
│       ├── issues/                        # 历史问题（3个）
│       └── summaries/                     # 历史总结（4个）
│
├── 🔧 scripts/                            # 脚本目录
│   ├── 📄 README.md                       # 脚本使用说明
│   │
│   ├── 🚀 service/                        # 服务管理
│   │   ├── start_service.ps1              # 启动服务
│   │   └── setup_models.ps1               # 安装模型
│   │
│   ├── 📋 logs/                           # 日志相关
│   │   ├── view_logs.ps1                  # 查看日志
│   │   └── capture_startup_logs.ps1       # 捕获启动日志
│   │
│   └── 🛠️ utils/                          # 工具脚本
│       ├── fix_config.ps1                 # 修复配置
│       └── check_syntax.py                # 语法检查
│
├── 🧪 tests/                              # 测试目录
│   ├── 📄 README.md                       # 测试指南
│   ├── ⚙️ pytest.ini                      # pytest配置
│   ├── 🔧 __init__.py                     # 包初始化
│   │
│   ├── 🔬 unit/                           # 单元测试（快速）
│   │   ├── __init__.py
│   │   ├── test_base_processor.py         # 基础处理器
│   │   ├── test_config.py                 # 配置测试
│   │   └── test_processor_wrapper.py      # 包装器测试
│   │
│   └── 🔄 integration/                    # 集成测试（完整）
│       ├── __init__.py
│       ├── test_service.py                # 快速功能测试
│       ├── test_service.ps1               # PowerShell版本
│       ├── test_comprehensive.py          # 全面测试
│       ├── test_asr_compatibility.py      # ASR兼容测试
│       └── test_asr_compatibility.ps1     # PowerShell版本
│
├── 📦 base/                               # 基础模块
│   ├── __init__.py
│   ├── models.py                          # Pydantic模型
│   └── processor_wrapper.py               # 处理器包装器
│
├── ⚙️ engines/                            # 引擎实现
│   ├── __init__.py
│   ├── llamacpp_engine.py                 # LlamaCpp引擎
│   ├── normalizer_engine.py               # 标准化引擎
│   ├── repair_engine.py                   # 修复引擎基类
│   └── prompt_templates.py                # 提示词模板
│
├── 🔄 processors/                         # 处理器
│   ├── __init__.py
│   ├── base_processor.py                  # 基础处理器
│   ├── zh_repair_processor.py             # 中文修复
│   ├── en_repair_processor.py             # 英文修复
│   └── en_normalize_processor.py          # 英文标准化
│
├── 🛠️ utils/                              # 工具函数
│   ├── __init__.py
│   └── model_loader.py                    # 模型加载器
│
├── 🤖 models/                             # 模型目录（.gitignore）
│   ├── qwen2.5-3b-instruct-zh-gguf/       # 中文模型
│   └── qwen2.5-3b-instruct-en-gguf/       # 英文模型
│
└── 📋 logs/                               # 日志目录（运行时生成）
    └── semantic_repair_YYYYMMDD.log
```

---

## 📊 目录功能说明

### 根目录
**核心文件和快速入门文档**

| 文件/目录 | 说明 | 角色 |
|----------|------|------|
| README.md | 服务主文档 | 所有用户 |
| MODELS_SETUP_GUIDE.md | 模型安装指南 | 新用户 |
| ASR_COMPATIBILITY.md | ASR兼容性说明 | 集成开发者 |
| service.py | 服务主程序 | - |
| config.py | 配置管理 | - |
| service.json | 服务元数据 | - |

---

### docs/ - 文档目录
**所有技术文档和历史记录**

| 子目录 | 说明 | 文档数 |
|--------|------|--------|
| **core/** | 核心技术文档（架构、API、配置） | 4 |
| **operations/** | 运维文档（部署、维护、故障排查） | 4 |
| **testing/** | 测试文档 | 2 |
| **scripts/** | 脚本文档 | 2 |
| **development/** | 开发文档 | 3 |
| **summaries/** | 总结报告 | 1 |
| **archived/** | 历史文档（实现/问题/总结） | 22 |

**入口**: [docs/README.md](./docs/README.md)

---

### scripts/ - 脚本目录
**所有运维和工具脚本**

| 子目录 | 说明 | 脚本数 |
|--------|------|--------|
| **service/** | 服务管理（启动、模型安装） | 2 |
| **logs/** | 日志相关（查看、捕获） | 2 |
| **utils/** | 工具脚本（修复配置、语法检查） | 2 |

**入口**: [scripts/README.md](./scripts/README.md)

---

### tests/ - 测试目录
**所有测试代码**

| 子目录 | 说明 | 测试数 |
|--------|------|--------|
| **unit/** | 单元测试（快速、独立） | 3+1 |
| **integration/** | 集成测试（完整、依赖服务） | 5+1 |

**入口**: [tests/README.md](./tests/README.md)

**运行测试**:
```bash
# 单元测试
pytest tests/unit/

# 集成测试
pytest tests/integration/

# 所有测试
pytest tests/
```

---

### base/ - 基础模块
**核心基础代码**

| 文件 | 说明 |
|------|------|
| models.py | Pydantic数据模型 |
| processor_wrapper.py | 处理器包装器（日志、计时、异常） |

---

### engines/ - 引擎实现
**底层引擎代码**

| 文件 | 说明 |
|------|------|
| llamacpp_engine.py | LlamaCpp引擎（中英文修复） |
| normalizer_engine.py | 标准化引擎（规则引擎） |
| repair_engine.py | 修复引擎基类 |
| prompt_templates.py | 提示词模板 |

---

### processors/ - 处理器
**业务处理器**

| 文件 | 说明 |
|------|------|
| base_processor.py | 基础处理器 |
| zh_repair_processor.py | 中文语义修复处理器 |
| en_repair_processor.py | 英文语义修复处理器 |
| en_normalize_processor.py | 英文标准化处理器 |

---

### utils/ - 工具函数
**通用工具**

| 文件 | 说明 |
|------|------|
| model_loader.py | 模型加载器 |

---

## 🎯 快速导航

### 我想...

| 目的 | 位置 |
|------|------|
| **了解服务** | [README.md](./README.md) |
| **安装模型** | [MODELS_SETUP_GUIDE.md](./MODELS_SETUP_GUIDE.md) |
| **了解架构** | [docs/core/ARCHITECTURE.md](./docs/core/ARCHITECTURE.md) |
| **查看API** | [docs/core/API_REFERENCE.md](./docs/core/API_REFERENCE.md) |
| **启动服务** | `.\scripts\service\start_service.ps1` |
| **查看日志** | `.\scripts\logs\view_logs.ps1` |
| **运行测试** | `pytest tests/` |
| **快速测试** | `.\tests\integration\test_service.ps1` |
| **故障排查** | [docs/operations/TROUBLESHOOTING.md](./docs/operations/TROUBLESHOOTING.md) |
| **查找文档** | [docs/README.md](./docs/README.md) |

---

## 📊 目录统计

### 文件类型分布

| 类型 | 数量 | 位置 |
|------|------|------|
| **Python代码** | 16个 | base/, engines/, processors/, utils/ |
| **文档** | 41个 | 根目录（3）+ docs/（38） |
| **脚本** | 6个 | scripts/ |
| **测试** | 8个 | tests/ |
| **配置文件** | 4个 | service.json, requirements.txt, pytest.ini等 |

**总计**: ~75个文件

---

### 代码行数统计（估算）

| 模块 | 行数 | 说明 |
|------|------|------|
| **核心代码** | ~1,745 | service.py, processors/, engines/等 |
| **测试代码** | ~1,400 | tests/ |
| **脚本** | ~400 | scripts/ |
| **文档** | ~12,600 | docs/ + 根目录 |

**总计**: ~16,145行

---

## 🎯 各角色使用指南

### 新用户（首次使用）

**阅读顺序**:
1. [README.md](./README.md) - 了解服务概况
2. [MODELS_SETUP_GUIDE.md](./MODELS_SETUP_GUIDE.md) - 安装模型
3. [docs/core/API_REFERENCE.md](./docs/core/API_REFERENCE.md) - 了解API

**启动服务**:
```powershell
.\scripts\service\setup_models.ps1     # 安装模型
.\scripts\service\start_service.ps1    # 启动服务
.\tests\integration\test_service.ps1   # 测试功能
```

---

### 开发者（修改代码）

**主要目录**:
- `base/` - 基础模块
- `engines/` - 引擎实现
- `processors/` - 业务处理器
- `tests/unit/` - 单元测试

**开发流程**:
```bash
# 1. 修改代码
vim processors/zh_repair_processor.py

# 2. 运行单元测试
pytest tests/unit/ -v

# 3. 运行集成测试
python service.py &
pytest tests/integration/test_service.py

# 4. 检查语法
python scripts/utils/check_syntax.py .
```

**参考文档**:
- [docs/core/ARCHITECTURE.md](./docs/core/ARCHITECTURE.md) - 架构设计
- [docs/development/LOGGING_SUMMARY.md](./docs/development/LOGGING_SUMMARY.md) - 日志规范
- [tests/README.md](./tests/README.md) - 测试指南

---

### 运维人员（部署维护）

**主要目录**:
- `scripts/` - 运维脚本
- `docs/operations/` - 运维文档

**常用操作**:
```powershell
# 启动服务
.\scripts\service\start_service.ps1

# 查看日志
.\scripts\logs\view_logs.ps1

# 修复配置
.\scripts\utils\fix_config.ps1

# 性能监控
# 参考 docs/operations/MAINTENANCE_GUIDE.md
```

**参考文档**:
- [docs/operations/DEPLOYMENT_CHECKLIST.md](./docs/operations/DEPLOYMENT_CHECKLIST.md) - 部署清单
- [docs/operations/TROUBLESHOOTING.md](./docs/operations/TROUBLESHOOTING.md) - 故障排查
- [docs/operations/MAINTENANCE_GUIDE.md](./docs/operations/MAINTENANCE_GUIDE.md) - 维护指南
- [scripts/README.md](./scripts/README.md) - 脚本说明

---

### 测试人员（质量保证）

**主要目录**:
- `tests/` - 所有测试
- `docs/testing/` - 测试文档

**测试流程**:
```bash
# 1. 启动服务
python service.py &

# 2. 运行快速测试
.\tests\integration\test_service.ps1

# 3. 运行ASR兼容性测试
.\tests\integration\test_asr_compatibility.ps1

# 4. 运行全面测试
python tests/integration/test_comprehensive.py

# 5. 运行单元测试
pytest tests/unit/ -v
```

**参考文档**:
- [tests/README.md](./tests/README.md) - 测试指南
- [docs/testing/TESTING_GUIDE.md](./docs/testing/TESTING_GUIDE.md) - 详细测试文档
- [docs/testing/TEST_SUMMARY.md](./docs/testing/TEST_SUMMARY.md) - 测试总结

---

## 📝 目录维护规范

### 添加新文件

**代码文件**:
- 核心代码 → `base/`, `engines/`, `processors/`, `utils/`
- 单元测试 → `tests/unit/`
- 集成测试 → `tests/integration/`

**文档**:
- 核心文档 → `docs/core/`
- 运维文档 → `docs/operations/`
- 测试文档 → `docs/testing/`
- 开发文档 → `docs/development/`

**脚本**:
- 服务管理 → `scripts/service/`
- 日志相关 → `scripts/logs/`
- 工具脚本 → `scripts/utils/`

### 归档旧文件

**文档归档**:
- 实现文档 → `docs/archived/implementation/`
- 问题报告 → `docs/archived/issues/`
- 历史总结 → `docs/archived/summaries/`

**更新索引**:
- 更新 `docs/README.md`
- 更新 `scripts/README.md`
- 更新 `tests/README.md`

---

## ⚠️ 注意事项

### 路径引用
- 所有脚本应从服务根目录运行
- 使用相对路径：`.\scripts\...`, `.\tests\...`

### Import 路径
- Python 包导入从根目录开始
- 例如：`from base.models import RepairRequest`

### 测试运行
- 单元测试可独立运行
- 集成测试需要服务运行中

---

## 🔗 关键链接

| 文档 | 链接 |
|------|------|
| 服务主文档 | [README.md](./README.md) |
| 文档索引 | [docs/README.md](./docs/README.md) |
| 脚本说明 | [scripts/README.md](./scripts/README.md) |
| 测试指南 | [tests/README.md](./tests/README.md) |
| 架构设计 | [docs/core/ARCHITECTURE.md](./docs/core/ARCHITECTURE.md) |
| API参考 | [docs/core/API_REFERENCE.md](./docs/core/API_REFERENCE.md) |
| 故障排查 | [docs/operations/TROUBLESHOOTING.md](./docs/operations/TROUBLESHOOTING.md) |

---

## 🎉 项目特点

### 清晰的结构 ⭐⭐⭐
- 根目录简洁（只有核心文件和快速入门）
- 文档按用途分类（7个分类）
- 脚本按功能分类（3个分类）
- 测试按类型分类（2个分类）

### 完善的文档 ⭐⭐⭐
- 41个文档，~12,600行
- 每个目录都有README索引
- 覆盖所有使用场景
- 包含历史决策记录

### 易于维护 ⭐⭐
- 清晰的维护规范
- 明确的文件归属
- 完整的索引系统
- 便于长期维护

### 用户友好 ⭐⭐⭐
- 新用户快速上手
- 开发者方便查找
- 运维人员有专门工具
- 测试人员流程清晰

---

**最后更新**: 2026-01-19  
**状态**: ✅ **项目结构完整、清晰、易于维护！**
