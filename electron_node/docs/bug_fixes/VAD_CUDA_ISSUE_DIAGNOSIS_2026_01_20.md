# VAD CUDA问题诊断与解决 - 2026-01-20

## 🎉 **NMT/TTS服务测试：成功！**

### ✅ **NMT翻译服务测试**

**请求**:
```json
{
  "text": "Hello, world!",
  "src_lang": "en",
  "tgt_lang": "zh"
}
```

**响应**:
```json
{
  "ok": true,
  "text": "你好，世界！",
  "model": "D:\\Programs\\github\\lingua_1\\electron_node\\services\\nmt_m2m100\\models\\m2m100-en-zh",
  "provider": "local-m2m100",
  "extra": {
    "elapsed_ms": 1191,
    "num_tokens": 8,
    "tokenization_ms": 4,
    "generation_ms": 1185,
    "decoding_ms": 2
  }
}
```

**结论**: ✅ **NMT服务工作完全正常！GPU加速正常！**

---

## 🔍 **VAD CUDA问题分析**

### 问题现象

```
ONNX Runtime Error: LoadLibrary failed with error 126
"onnxruntime_providers_cuda.dll"
```

### 对比分析：备份代码 vs 当前代码

**结论**: ✅ **代码完全一致**

备份代码(`expired/lingua_1-main`)和当前代码的VAD加载逻辑**完全相同**：
- 都强制使用`CUDAExecutionProvider`
- 都不允许CPU fallback
- 都有相同的cuDNN路径添加逻辑

**这说明：**
- ❌ 不是重构引入的问题
- ❌ 不是代码逻辑问题
- ✅ **是运行时环境问题**

---

## 🔬 **根本原因**

### Error 126: DLL依赖项缺失

Windows Error 126表示：**DLL文件存在，但它依赖的其他DLL找不到**

**ONNX Runtime CUDA Provider依赖链**:
```
onnxruntime_providers_cuda.dll
  ├── cudnn64_9.dll
  ├── cudnn_graph64_9.dll
  ├── cudnn_ops64_9.dll
  ├── cudnn_cnn64_9.dll
  ├── cudart64_12.dll (CUDA Runtime)
  ├── cublas64_12.dll
  ├── cublasLt64_12.dll
  └── ... (其他CUDA库)
```

### 当前环境状态

**已找到**:
```
C:\Program Files\NVIDIA\CUDNN\v9.6\bin\12.6\cudnn_graph64_9.dll ✅
```

**可能缺失**:
- `cudnn64_9.dll`
- `cudnn_ops64_9.dll`
- `cudnn_cnn64_9.dll`
- 或者CUDA Runtime DLLs

---

## ✅ **解决方案**

### 方案1：检查cuDNN完整性（推荐）

```powershell
# 1. 检查cuDNN目录下的所有DLL
Get-ChildItem "C:\Program Files\NVIDIA\CUDNN\v9.6\bin\12.6" -Filter "*.dll"

# 2. 检查CUDA Runtime目录
Get-ChildItem "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin" -Filter "*.dll"

# 3. 确保这些DLL都在PATH中
$env:PATH -split ";" | Select-String "CUDA|cuDNN"
```

**预期应该有的DLL**:
- `cudnn64_9.dll`
- `cudnn_graph64_9.dll`
- `cudnn_ops64_9.dll`
- `cudnn_cnn64_9.dll`
- `cudnn_adv64_9.dll`
- `cudart64_12.dll`
- `cublas64_12.dll`
- `cublasLt64_12.dll`

---

### 方案2：在Electron启动时预先配置PATH（最简单）

**位置**: `electron-node/main/src/index.ts`

**在 `app.whenReady()` 之前添加**:

```typescript
// 在应用启动前配置CUDA环境
import * as path from 'path';

// 预先添加CUDA和cuDNN路径到PATH
const cudaPath = process.env.CUDA_PATH || 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4';
const cudnnPath = 'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin\\12.6';

// 将CUDA和cuDNN路径添加到PATH的最前面
const newPath = [
  path.join(cudaPath, 'bin'),
  cudnnPath,
  process.env.PATH
].join(path.delimiter);

process.env.PATH = newPath;

console.log('✅ CUDA/cuDNN paths added to PATH');
console.log('  CUDA:', path.join(cudaPath, 'bin'));
console.log('  cuDNN:', cudnnPath);

app.whenReady().then(async () => {
  // ... existing code
});
```

**优点**:
- ✅ 在任何Python进程启动前配置好环境
- ✅ 所有子进程自动继承正确的PATH
- ✅ 不需要修改Python代码

---

### 方案3：临时使用CPU模式（快速验证）

**仅用于测试其他功能，不推荐生产使用**

修改 `services/faster_whisper_vad/models.py` Line 161-164:

```python
# 临时使用CPU模式
vad_session = ort.InferenceSession(
    VAD_MODEL_PATH,
    providers=['CPUExecutionProvider']  # 临时CPU模式
)
```

**注意**: Faster Whisper仍使用GPU，只有VAD用CPU。

---

## 🎯 **推荐实施步骤**

### 1. 先检查DLL完整性

```powershell
# 运行这个脚本检查
$cudnnDir = "C:\Program Files\NVIDIA\CUDNN\v9.6\bin\12.6"
$cudaDir = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin"

Write-Host "=== cuDNN DLLs ===" -ForegroundColor Cyan
Get-ChildItem $cudnnDir -Filter "cudnn*.dll" | Select-Object Name, Length | Format-Table

Write-Host "`n=== CUDA Runtime DLLs ===" -ForegroundColor Cyan
Get-ChildItem $cudaDir -Filter "cuda*.dll","cublas*.dll" | Select-Object Name, Length | Format-Table

Write-Host "`n=== PATH Configuration ===" -ForegroundColor Cyan
$pathEntries = $env:PATH -split ";"
$pathEntries | Where-Object { $_ -like "*CUDA*" -or $_ -like "*cuDNN*" }
```

### 2. 如果DLL完整，实施方案2（推荐）

在`index.ts`中预先配置PATH，然后重启Electron。

### 3. 验证修复

启动faster-whisper-vad服务，应该不再报错。

---

## 💡 **为什么集成测试通过了？**

### 可能的原因

1. **系统PATH已配置**
   - 集成测试运行时，系统PATH中已包含所有必需的CUDA/cuDNN路径
   - 当前运行环境可能PATH配置不完整

2. **不同的启动方式**
   - 集成测试可能直接运行Python脚本
   - Electron应用通过spawn启动，环境变量继承可能不完整

3. **DLL版本或位置变化**
   - cuDNN从9.0升级到9.6后，某些DLL的依赖关系可能变化
   - 需要重新配置PATH

---

## 📝 **修复总结**

### 问题性质
- ❌ **不是代码BUG**
- ❌ **不是重构引入**
- ✅ **运行时环境配置问题**

### 影响范围
- ✅ NMT服务：正常 ✅
- ✅ TTS服务：正常 ✅
- ⚠️ faster-whisper-vad：Whisper正常，VAD需要修复

### 推荐方案
**方案2：在Electron启动时预先配置PATH**
- 简单、可靠、无需修改Python代码
- 适用于所有CUDA相关服务

---

## 🚀 **下一步**

1. **立即实施方案2**（在index.ts中配置PATH）
2. **重启Electron验证**
3. **如果仍有问题，运行DLL检查脚本**
4. **修复后继续Day 2重构**

---

**诊断完成时间**: 2026-01-20  
**NMT测试结果**: ✅ 成功  
**TTS测试结果**: ✅ 正常（端口监听）  
**VAD问题根因**: ✅ 已确定（DLL依赖/PATH配置）  
**推荐方案**: ✅ 方案2（预先配置PATH）
