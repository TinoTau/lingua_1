# NMT 服务崩溃诊断指南

**退出码**: `3221225477` (0xC0000005)  
**错误类型**: Access Violation (访问冲突)  
**状态**: 🔍 **需要诊断**

---

## 错误码说明

退出码 `3221225477` 转换为十六进制是 `0xC0000005`，这是 Windows 上的**访问冲突**错误，通常表示：

- 内存访问违规
- 空指针解引用
- 数组越界
- 未初始化的变量
- PyTorch/CUDA 相关问题

---

## 可能的原因

### 1. PyTorch 模型加载问题 ⚠️

**症状**:
- 服务在启动时（模型加载阶段）崩溃
- 日志可能在 "Loading PyTorch model" 之后停止

**可能原因**:
- 模型文件损坏或不完整
- PyTorch 版本与模型不兼容
- CUDA 版本与 PyTorch 不匹配
- 内存不足（模型太大）

**检查方法**:
```bash
# 查看 NMT 服务日志
cat electron_node/services/nmt_m2m100/logs/nmt-service.log

# 检查最后几行日志
tail -50 electron_node/services/nmt_m2m100/logs/nmt-service.log
```

**解决方案**:
1. 检查模型文件是否完整
2. 验证 PyTorch 版本
3. 尝试使用 CPU 模式（禁用 CUDA）

---

### 2. CUDA 相关问题 ⚠️

**症状**:
- 服务在检测 CUDA 或加载模型到 GPU 时崩溃
- 日志显示 CUDA 相关信息后停止

**可能原因**:
- CUDA 驱动版本不匹配
- GPU 内存不足
- CUDA 库损坏

**检查方法**:
```bash
# 检查 CUDA 版本
nvidia-smi

# 检查 PyTorch CUDA 版本
python -c "import torch; print(torch.version.cuda)"
```

**解决方案**:
1. 强制使用 CPU 模式（临时解决方案）
2. 更新 CUDA 驱动
3. 检查 GPU 内存使用情况

---

### 3. 虚拟环境问题 ⚠️

**症状**:
- 服务在导入模块时崩溃
- Python 解释器本身崩溃

**可能原因**:
- 虚拟环境损坏
- 依赖库版本冲突
- Python 解释器问题

**检查方法**:
```bash
# 检查虚拟环境
cd electron_node/services/nmt_m2m100
venv\Scripts\python.exe -c "import torch; print(torch.__version__)"

# 检查依赖
venv\Scripts\pip.exe list | findstr torch
```

**解决方案**:
1. 重新创建虚拟环境
2. 重新安装依赖
3. 检查 Python 版本兼容性

---

### 4. 模型文件问题 ⚠️

**症状**:
- 服务在加载模型时崩溃
- 日志显示 "Failed to load PyTorch model"

**可能原因**:
- 模型文件不完整
- 模型文件损坏
- 模型格式不兼容

**检查方法**:
```bash
# 检查模型目录
dir electron_node\services\nmt_m2m100\models\m2m100-*

# 检查关键文件
dir electron_node\services\nmt_m2m100\models\m2m100-*\pytorch_model.bin
dir electron_node\services\nmt_m2m100\models\m2m100-*\tokenizer.json
```

**解决方案**:
1. 重新下载模型文件
2. 验证模型文件完整性
3. 检查模型文件大小是否合理

---

## 诊断步骤

### 步骤 1: 查看日志

```bash
# 查看 NMT 服务日志
type electron_node\services\nmt_m2m100\logs\nmt-service.log

# 或使用 PowerShell
Get-Content electron_node\services\nmt_m2m100\logs\nmt-service.log -Tail 100
```

**查找关键信息**:
- `[NMT Service] Device: ...`
- `[NMT Service] Loading PyTorch model...`
- `[NMT Service] Failed to load model: ...`
- 任何错误或异常信息

---

### 步骤 2: 手动测试模型加载

```bash
# 进入服务目录
cd electron_node\services\nmt_m2m100

# 激活虚拟环境
venv\Scripts\activate

# 手动测试模型加载
python -c "
import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import os

os.environ['HF_LOCAL_FILES_ONLY'] = '1'
model_path = 'models/m2m100-en-zh'
print(f'Loading model from {model_path}...')
try:
    tokenizer = M2M100Tokenizer.from_pretrained(model_path)
    model = M2M100ForConditionalGeneration.from_pretrained(
        model_path,
        low_cpu_mem_usage=False,
        torch_dtype=torch.float32
    )
    print('Model loaded successfully!')
except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()
"
```

---

### 步骤 3: 检查 CUDA 可用性

```bash
# 测试 CUDA
python -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda if torch.cuda.is_available() else 'N/A')"
```

---

### 步骤 4: 强制使用 CPU 模式（临时解决方案）

如果 CUDA 有问题，可以强制使用 CPU：

**修改**: `electron_node/services/nmt_m2m100/nmt_service.py`

```python
# 第 20 行，强制使用 CPU
DEVICE = torch.device("cpu")  # 强制使用 CPU，避免 CUDA 问题
```

---

## 快速修复方案

### 方案 1: 强制使用 CPU（推荐用于诊断）

1. 编辑 `nmt_service.py`:
   ```python
   # 第 20 行
   DEVICE = torch.device("cpu")  # 临时强制使用 CPU
   ```

2. 重启节点端

3. 如果 CPU 模式可以工作，说明是 CUDA 问题

---

### 方案 2: 重新创建虚拟环境

```bash
# 备份当前虚拟环境（可选）
cd electron_node\services\nmt_m2m100
ren venv venv_backup

# 创建新的虚拟环境
python -m venv venv

# 激活虚拟环境
venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt
```

---

### 方案 3: 检查并修复模型文件

```bash
# 检查模型目录
cd electron_node\services\nmt_m2m100\models

# 列出模型文件
dir m2m100-* /s

# 检查关键文件是否存在
dir m2m100-en-zh\tokenizer.json
dir m2m100-en-zh\pytorch_model.bin
dir m2m100-zh-en\tokenizer.json
dir m2m100-zh-en\pytorch_model.bin
```

---

## 常见问题排查

### Q1: 日志文件为空或不存在

**原因**: 服务在启动早期就崩溃了，没有机会写入日志

**解决方案**:
1. 检查 Python 解释器是否正常
2. 手动运行服务脚本
3. 检查虚拟环境是否正确

---

### Q2: 服务启动后立即崩溃

**原因**: 可能是模型加载阶段的问题

**解决方案**:
1. 添加更多日志输出
2. 使用 try-except 捕获异常
3. 检查模型文件完整性

---

### Q3: CUDA 相关错误

**原因**: CUDA 驱动或库版本不匹配

**解决方案**:
1. 更新 NVIDIA 驱动
2. 检查 PyTorch CUDA 版本
3. 临时使用 CPU 模式

---

## 添加调试日志

如果需要更多诊断信息，可以在 `nmt_service.py` 中添加日志：

```python
@app.on_event("startup")
async def load_model():
    """启动时加载模型"""
    global tokenizer, model, loaded_model_path
    try:
        print(f"[NMT Service] Starting model loading...")
        print(f"[NMT Service] Device: {DEVICE}")
        print(f"[NMT Service] Python version: {sys.version}")
        print(f"[NMT Service] PyTorch version: {torch.__version__}")
        
        # ... 现有代码 ...
        
    except Exception as e:
        print(f"[NMT Service] ❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise
```

---

## 相关文件

- **NMT 服务代码**: `electron_node/services/nmt_m2m100/nmt_service.py`
- **服务配置**: `electron_node/electron-node/main/src/utils/python-service-config.ts`
- **进程管理**: `electron_node/electron-node/main/src/python-service-manager/service-process.ts`
- **日志文件**: `electron_node/services/nmt_m2m100/logs/nmt-service.log`

---

## 下一步

1. **查看日志**: 检查 `nmt-service.log` 文件，找到崩溃前的最后一条日志
2. **手动测试**: 使用上面的 Python 脚本手动测试模型加载
3. **尝试 CPU 模式**: 临时强制使用 CPU，确认是否是 CUDA 问题
4. **检查模型文件**: 验证模型文件是否完整

---

## 联系支持

如果以上方法都无法解决问题，请提供：
1. 完整的日志文件内容
2. Python 版本 (`python --version`)
3. PyTorch 版本 (`pip show torch`)
4. CUDA 版本 (`nvidia-smi`)
5. 模型文件大小和完整性信息

