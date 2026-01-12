# NMT 服务故障排除指南

## 常见问题

### 1. 服务崩溃（退出码 3221225477）

**错误类型**: Access Violation (访问冲突)

**可能原因**:
- PyTorch 模型加载问题
- CUDA 相关问题
- 虚拟环境问题
- 模型文件问题

**诊断步骤**:

1. **查看日志**
   ```powershell
   Get-Content electron_node\services\nmt_m2m100\logs\nmt-service.log -Tail 100
   ```

2. **检查 CUDA 可用性**
   ```powershell
   python -c "import torch; print('CUDA available:', torch.cuda.is_available())"
   ```

3. **手动测试模型加载**
   ```powershell
   cd electron_node\services\nmt_m2m100
   .\venv\Scripts\activate
   python -c "from transformers import M2M100ForConditionalGeneration; model = M2M100ForConditionalGeneration.from_pretrained('models/m2m100-en-zh')"
   ```

**解决方案**:

#### 方案1: 强制使用 CPU 模式

设置环境变量：
```powershell
$env:NMT_FORCE_CPU = "true"
```

或修改 `nmt_service.py` 第 119 行：
```python
FORCE_CPU_MODE = True  # 强制使用 CPU
```

#### 方案2: 重新创建虚拟环境

```powershell
cd electron_node\services\nmt_m2m100
ren venv venv_backup
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

#### 方案3: 检查并修复模型文件

```powershell
# 检查模型目录
dir electron_node\services\nmt_m2m100\models\m2m100-*

# 检查关键文件
dir electron_node\services\nmt_m2m100\models\m2m100-en-zh\tokenizer.json
dir electron_node\services\nmt_m2m100\models\m2m100-en-zh\model.safetensors
```

### 2. 重复翻译问题

**症状**: 翻译结果出现重复文本

**原因**: `context_text` 和 `text` 相同，导致重复拼接

**解决方案**:

服务已实现自动检测和避免重复：

```python
# 如果 context_text 和 text 相同，只使用 text
if req.context_text and req.context_text.strip():
    if req.context_text.strip() != req.text.strip():
        input_text = f"{req.context_text}{SEPARATOR}{req.text}"
    else:
        input_text = req.text  # 避免重复
```

**说明**:
- `context_text` 应该是上一个 utterance 的翻译文本（不是当前文本）
- 当前实现已避免将当前文本作为自己的上下文
- 如果仍出现重复，检查调用方是否正确传递 `context_text`

### 3. CUDA 相关问题

**症状**: GPU 不可用或 CUDA 错误

**检查方法**:
```powershell
# 检查 CUDA 版本
nvidia-smi

# 检查 PyTorch CUDA 版本
python -c "import torch; print(torch.version.cuda)"
```

**解决方案**:
1. 更新 NVIDIA 驱动
2. 检查 PyTorch CUDA 版本是否匹配
3. 临时使用 CPU 模式（设置 `NMT_FORCE_CPU=true`）

### 4. 模型加载失败

**症状**: 服务启动时模型加载失败

**可能原因**:
- 模型文件不完整
- 模型文件损坏
- 内存不足

**检查方法**:
```powershell
# 检查模型目录
dir electron_node\services\nmt_m2m100\models\m2m100-*

# 检查关键文件是否存在
dir electron_node\services\nmt_m2m100\models\m2m100-en-zh\tokenizer.json
dir electron_node\services\nmt_m2m100\models\m2m100-en-zh\model.safetensors
```

**解决方案**:
1. 重新下载模型文件
2. 验证模型文件完整性
3. 检查内存是否足够（建议至少 8GB）

## 调试技巧

### 添加调试日志

在 `nmt_service.py` 的 `load_model()` 函数中添加更多日志：

```python
@app.on_event("startup")
async def load_model():
    print(f"[NMT Service] Starting model loading...")
    print(f"[NMT Service] Device: {DEVICE}")
    print(f"[NMT Service] Python version: {sys.version}")
    print(f"[NMT Service] PyTorch version: {torch.__version__}")
    # ... 现有代码 ...
```

### 手动测试模型加载

```python
import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import os

os.environ['HF_LOCAL_FILES_ONLY'] = '1'
model_path = 'models/m2m100-en-zh'

try:
    tokenizer = M2M100Tokenizer.from_pretrained(model_path)
    model = M2M100ForConditionalGeneration.from_pretrained(
        model_path,
        low_cpu_mem_usage=True,
        torch_dtype=torch.float32
    )
    print('Model loaded successfully!')
except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()
```

## 环境变量

### 强制 CPU 模式

```powershell
$env:NMT_FORCE_CPU = "true"
```

### 只使用本地模型

```powershell
$env:HF_LOCAL_FILES_ONLY = "true"
```

### HuggingFace Token（如果需要）

```powershell
$env:HF_TOKEN = "your_token"
```

## 相关文件

- **服务代码**: `nmt_service.py`
- **配置文件**: `nmt_config.json`
- **日志文件**: `logs/nmt-service.log`
- **模型目录**: `models/m2m100-en-zh`, `models/m2m100-zh-en`

## 联系支持

如果以上方法都无法解决问题，请提供：
1. 完整的日志文件内容
2. Python 版本 (`python --version`)
3. PyTorch 版本 (`pip show torch`)
4. CUDA 版本 (`nvidia-smi`)
5. 模型文件大小和完整性信息

