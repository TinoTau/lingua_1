# 测试指南

**服务**: semantic-repair-en-zh  
**测试框架**: pytest  
**最后更新**: 2026-01-19

---

## 📁 测试目录结构

```
tests/
├── pytest.ini           # pytest配置文件
├── README.md            # 本文档
│
├── unit/                # 单元测试（快速、独立）
│   ├── __init__.py
│   ├── test_base_processor.py     # 基础处理器测试
│   ├── test_config.py             # 配置加载测试
│   └── test_processor_wrapper.py  # 包装器测试
│
└── integration/         # 集成测试（完整、依赖服务）
    ├── __init__.py
    ├── test_service.py            # 快速功能测试
    ├── test_service.ps1           # PowerShell版本
    ├── test_comprehensive.py      # 全面测试
    ├── test_asr_compatibility.py  # ASR兼容性测试
    └── test_asr_compatibility.ps1 # PowerShell版本
```

---

## 🧪 测试类型

### 单元测试 (unit/)

**特点**:
- ✅ 快速执行（毫秒级）
- ✅ 独立运行（不依赖服务）
- ✅ 测试单个模块/函数
- ✅ 可以 Mock 外部依赖

**适用场景**:
- 开发过程中频繁运行
- CI/CD 的每次提交
- 验证代码逻辑正确性

**运行时间**: ~1-5秒

---

### 集成测试 (integration/)

**特点**:
- ⏱️ 执行较慢（秒到分钟级）
- 🔗 依赖服务运行
- 🔄 测试完整流程
- 📡 实际调用 API

**适用场景**:
- 部署前验证
- 重大更新后测试
- 验证端到端功能

**运行时间**: ~30秒 - 5分钟

---

## 🚀 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

### 运行所有测试

```bash
# 运行所有测试
pytest tests/

# 带详细输出
pytest tests/ -v

# 带覆盖率报告
pytest tests/ --cov=.
```

---

## 📋 分类运行测试

### 1. 只运行单元测试（推荐开发时使用）

```bash
# Python/pytest
pytest tests/unit/

# 带详细输出
pytest tests/unit/ -v

# 运行特定文件
pytest tests/unit/test_config.py
```

**优势**:
- ✅ 快速反馈（1-5秒）
- ✅ 不需要启动服务
- ✅ 适合频繁运行

---

### 2. 只运行集成测试（部署前使用）

```bash
# 先启动服务
python service.py &

# Python/pytest
pytest tests/integration/

# 带详细输出
pytest tests/integration/ -v
```

**或使用 PowerShell 脚本**:

```powershell
# 快速功能测试
.\tests\integration\test_service.ps1

# ASR兼容性测试
.\tests\integration\test_asr_compatibility.ps1
```

**前置条件**:
- ✅ 服务必须在运行中
- ✅ 模型文件已安装
- ✅ 端口 5015 未被占用

---

## 📊 测试用例清单

### 单元测试 (unit/)

#### test_config.py
- ✅ 配置文件加载
- ✅ 环境变量覆盖
- ✅ 默认值处理
- ✅ 配置验证

**覆盖**: `config.py`

---

#### test_base_processor.py
- ✅ 基础处理器初始化
- ✅ 请求验证
- ✅ 错误处理
- ✅ 超时机制

**覆盖**: `processors/base_processor.py`

---

#### test_processor_wrapper.py
- ✅ 请求包装
- ✅ 日志记录
- ✅ 计时功能
- ✅ 异常捕获

**覆盖**: `base/processor_wrapper.py`

---

### 集成测试 (integration/)

#### test_service.py（快速功能测试）
- ✅ 服务健康检查
- ✅ 中文修复基础功能
- ✅ 英文修复基础功能
- ✅ 英文标准化基础功能
- ✅ 端点响应时间

**运行时间**: ~10-30秒  
**依赖**: 服务运行中

---

#### test_comprehensive.py（全面测试）
- ✅ 健康检查（3个端点）
- ✅ 中文修复（4个测试用例）
- ✅ 英文修复（4个测试用例）
- ✅ 英文标准化（3个测试用例）
- ✅ 边界测试（空文本、单字符等）
- ✅ 性能测试（5次×3个端点）

**运行时间**: ~2-5分钟  
**依赖**: 服务运行中

---

#### test_asr_compatibility.py（ASR兼容性测试）
- ✅ 统一端点 `/repair` 测试
- ✅ 中文请求路由（lang=zh）
- ✅ 英文请求路由（lang=en）
- ✅ 不支持语言处理（lang=fr）
- ✅ 端点一致性对比

**运行时间**: ~30秒 - 1分钟  
**依赖**: 服务运行中

---

## 🎯 测试策略

### 开发阶段
```bash
# 频繁运行单元测试
pytest tests/unit/ -v

# 每次提交前运行
pytest tests/unit/
```

### 功能完成
```bash
# 启动服务
python service.py &

# 运行快速功能测试
pytest tests/integration/test_service.py -v
```

### 部署前
```bash
# 启动服务
python service.py &

# 运行所有测试
pytest tests/ -v

# 或运行全面测试
python tests/integration/test_comprehensive.py
```

---

## 📝 编写新测试

### 单元测试模板

```python
# tests/unit/test_new_module.py
import pytest
from your_module import YourClass

class TestYourClass:
    """测试 YourClass 的功能"""
    
    def test_basic_functionality(self):
        """测试基础功能"""
        obj = YourClass()
        result = obj.method()
        assert result == expected_value
    
    def test_error_handling(self):
        """测试错误处理"""
        obj = YourClass()
        with pytest.raises(ValueError):
            obj.method_with_error()
```

### 集成测试模板

```python
# tests/integration/test_new_feature.py
import requests

BASE_URL = "http://localhost:5015"

def test_new_endpoint():
    """测试新的 API 端点"""
    response = requests.post(
        f"{BASE_URL}/new/endpoint",
        json={"key": "value"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["result"] == "expected"
```

---

## 🔍 调试测试

### 运行特定测试

```bash
# 运行特定文件
pytest tests/unit/test_config.py

# 运行特定类
pytest tests/unit/test_config.py::TestConfig

# 运行特定方法
pytest tests/unit/test_config.py::TestConfig::test_load_config
```

### 调试模式

```bash
# 显示 print 输出
pytest tests/unit/ -s

# 遇到失败立即停止
pytest tests/unit/ -x

# 详细输出 + print
pytest tests/unit/ -v -s
```

### 查看覆盖率

```bash
# 生成覆盖率报告
pytest tests/ --cov=. --cov-report=html

# 打开 htmlcov/index.html 查看
```

---

## ⚠️ 常见问题

### Q1: 集成测试失败 "Connection refused"
**原因**: 服务未启动  
**解决**: 先启动服务 `python service.py`

### Q2: 测试超时
**原因**: 模型加载慢或服务响应慢  
**解决**: 增加超时时间或检查服务日志

### Q3: Import 错误
**原因**: 路径问题  
**解决**: 确保从服务根目录运行测试

### Q4: PowerShell 脚本无法运行
**原因**: 执行策略限制  
**解决**: 
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## 📚 相关文档

- **[../docs/testing/TESTING_GUIDE.md](../docs/testing/TESTING_GUIDE.md)** - 详细测试指南
- **[../docs/testing/TEST_SUMMARY.md](../docs/testing/TEST_SUMMARY.md)** - 测试总结报告
- **[../README.md](../README.md)** - 服务主文档

---

## 🔗 快速链接

| 测试类型 | 命令 |
|---------|------|
| 所有测试 | `pytest tests/` |
| 单元测试 | `pytest tests/unit/` |
| 集成测试 | `pytest tests/integration/` |
| 快速测试 (PS) | `.\tests\integration\test_service.ps1` |
| ASR兼容 (PS) | `.\tests\integration\test_asr_compatibility.ps1` |
| 带覆盖率 | `pytest tests/ --cov=.` |

---

**最后更新**: 2026-01-19  
**维护者**: Lingua Team
