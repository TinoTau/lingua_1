# Piper TTS 单元测试

## 测试文件

- `test_models.py` - 测试数据模型（TtsRequest）
- `test_utils.py` - 测试工具函数（find_piper_command, find_model_path, create_wav_header 等）
- `test_synthesis.py` - 测试合成逻辑（使用 mock）
- `test_api.py` - 测试 API 端点（使用 FastAPI TestClient）

## 运行测试

### 方法 1：使用 unittest 模块（推荐）

```bash
# 激活虚拟环境
. venv/Scripts/activate.ps1  # Windows PowerShell
# 或
source venv/bin/activate    # Linux/Mac

# 运行所有测试
python -m unittest discover -s . -p "test_*.py" -v

# 运行特定测试文件
python -m unittest test_models -v
python -m unittest test_utils -v
python -m unittest test_api -v

# 运行特定测试类
python -m unittest test_models.TestTtsRequest -v

# 运行特定测试方法
python -m unittest test_models.TestTtsRequest.test_create_request_with_required_fields -v
```

### 方法 2：使用 run_tests.py 脚本

```bash
python run_tests.py
```

### 方法 3：使用 pytest（如果已安装）

```bash
pytest test_*.py -v
```

## 测试覆盖

### models.py
- ✅ TtsRequest 模型创建
- ✅ 必需字段验证
- ✅ 可选字段（language）
- ✅ Unicode 文本支持
- ✅ JSON 序列化

### utils.py
- ✅ find_piper_command - 从环境变量、虚拟环境、PATH 查找
- ✅ find_model_path - 标准模型、扁平结构、VITS 模型查找
- ✅ create_wav_header - WAV 文件头创建和验证
- ✅ get_or_load_voice - 模型加载和缓存（需要 API 可用）

### synthesis.py
- ✅ synthesize_with_python_api - Python API 合成（使用 mock）
- ✅ synthesize_with_command_line - 命令行工具合成（使用 mock）
- ✅ _synthesize_chinese_vits - 中文 VITS 合成（使用 mock）
- ✅ _generate_vits_audio - VITS 音频生成（使用 mock）

### piper_http_server.py
- ✅ /health 端点
- ✅ /voices 端点
- ✅ /tts 端点（成功、失败、回退场景）

## 测试注意事项

1. **依赖要求**：某些测试需要安装相应的依赖（FastAPI, piper-tts 等）
2. **Mock 使用**：由于外部依赖（模型文件、API 等），大部分测试使用 mock
3. **跳过测试**：如果某些依赖不可用，相关测试会被自动跳过
4. **环境变量**：某些测试会修改环境变量，测试后会恢复

## 测试结果示例

```
test_create_request_with_required_fields (test_models.TestTtsRequest) ... ok
test_create_request_with_language (test_models.TestTtsRequest) ... ok
test_request_validation (test_models.TestTtsRequest) ... ok
test_request_with_unicode_text (test_models.TestTtsRequest) ... ok
test_request_json_serialization (test_models.TestTtsRequest) ... ok

test_find_piper_from_env (test_utils.TestFindPiperCommand) ... ok
test_find_piper_from_venv (test_utils.TestFindPiperCommand) ... ok
test_find_piper_default (test_utils.TestFindPiperCommand) ... ok

test_find_standard_model (test_utils.TestFindModelPath) ... ok
test_find_flat_model (test_utils.TestFindModelPath) ... ok
test_find_vits_model (test_utils.TestFindModelPath) ... ok
test_model_not_found (test_utils.TestFindModelPath) ... ok

test_create_wav_header_basic (test_utils.TestCreateWavHeader) ... ok
test_create_wav_header_different_params (test_utils.TestCreateWavHeader) ... ok
test_wav_header_contains_audio_data (test_utils.TestCreateWavHeader) ... ok

test_health_check (test_api.TestApiEndpoints) ... ok
test_list_voices_empty (test_api.TestApiEndpoints) ... ok
test_tts_endpoint_success (test_api.TestApiEndpoints) ... ok
test_tts_endpoint_model_not_found (test_api.TestApiEndpoints) ... ok

----------------------------------------------------------------------
Ran XX tests in X.XXXs

OK
```

## 添加新测试

1. 创建新的测试文件 `test_<module_name>.py`
2. 继承 `unittest.TestCase`
3. 使用 `unittest.mock` 来模拟外部依赖
4. 使用 `@unittest.skipIf` 来跳过需要特定依赖的测试

示例：

```python
import unittest
from unittest.mock import patch, MagicMock

class TestMyModule(unittest.TestCase):
    def test_my_function(self):
        # 测试代码
        pass
    
    @unittest.skipIf(not SOME_DEPENDENCY_AVAILABLE, "Dependency not available")
    def test_requires_dependency(self):
        # 需要特定依赖的测试
        pass
```
