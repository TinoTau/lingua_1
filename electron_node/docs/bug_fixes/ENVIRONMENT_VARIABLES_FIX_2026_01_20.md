# 环境变量修复 - 2026-01-20

## 🐛 发现的问题

通过日志分析，发现**3个服务失败**，全部是**环境变量缺失**导致的：

### 1. piper-tts (TTS服务) ❌

**错误**:
```
Line 108: ❌ PIPER_USE_GPU is not set to 'true'. GPU is required for TTS service.
Line 115: RuntimeError: GPU is required for TTS service. PIPER_USE_GPU must be set to 'true'.
```

**原因**: 服务内部要求 `PIPER_USE_GPU=true`，但启动时未设置

---

### 2. nmt-m2m100 (翻译服务) ❌

**错误**:
```
Line 257: UnicodeEncodeError: 'gbk' codec can't encode character '\u27ea'
```

**原因**: Windows控制台默认使用GBK编码，无法输出Unicode特殊字符

---

### 3. faster-whisper-vad (VAD模型) ⚠️

**Faster Whisper**: ✅ 成功加载（Line 89）
**VAD模型**: ❌ ONNX Runtime CUDA加载失败

**错误**:
```
Line 174: CUDA_PATH is set but CUDA wasn't able to be loaded.
Line 226: LoadLibrary failed with error 126 "onnxruntime_providers_cuda.dll"
```

**原因**: ONNX Runtime无法加载cuDNN DLL（需要cuDNN 9.x配置）

---

## 📋 备份代码中的环境变量配置

### 找到的关键配置

**位置**: `expired/lingua_1-main/electron_node/electron-node/main/src/utils/python-service-config.ts`

```typescript
const baseEnv: Record<string, string> = {
  ...process.env,
  ...setupCudaEnvironment(),
  PYTHONIOENCODING: 'utf-8',  // ✅ 解决GBK编码问题
};

// TTS服务专用配置
case 'tts': {
  return {
    env: {
      ...baseEnv,
      PIPER_USE_GPU: (baseEnv as any).CUDA_PATH ? 'true' : 'false',  // ✅ 启用GPU模式
      PIPER_MODEL_DIR: modelDir,
    },
  };
}
```

---

## ✅ 修复方案

### 在ServiceProcessRunner中添加统一的环境变量配置

**位置**: `electron-node/main/src/service-layer/ServiceProcessRunner.ts`

**修改前**:
```typescript
const proc = spawn(executable, args || [], {
  cwd: workingDir,
  env: { ...process.env }, // 暂不支持自定义env
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

**修改后**:
```typescript
// 4. 准备环境变量（添加Python服务必需的配置）
const serviceEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  // 解决Windows GBK编码问题（nmt服务报错）
  PYTHONIOENCODING: 'utf-8',
  // 启用Piper TTS的GPU模式（tts服务要求）
  PIPER_USE_GPU: 'true',
};

// 5. 启动进程
const proc = spawn(executable, args || [], {
  cwd: workingDir,
  env: serviceEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

---

## 🎯 预期结果

### 修复后

1. ✅ **piper-tts**: `PIPER_USE_GPU=true` → 应该能启动
2. ✅ **nmt-m2m100**: `PYTHONIOENCODING=utf-8` → GBK编码错误消失
3. ⚠️ **faster-whisper-vad**: 
   - ✅ Faster Whisper模型仍然能加载（已验证）
   - ❌ VAD模型仍需CUDA环境修复

---

## 🔧 VAD模型CUDA问题（待解决）

### 问题详情

**ONNX Runtime** 无法加载 `onnxruntime_providers_cuda.dll`：
```
LoadLibrary failed with error 126 when trying to load
"D:\Python\Python310\lib\site-packages\onnxruntime\capi\onnxruntime_providers_cuda.dll"
```

### 根本原因

**Error 126**: DLL依赖项缺失，通常是缺少：
- `cudnn64_9.dll`
- `cudnn_graph64_9.dll`
- `cudnn_ops64_9.dll`
- 等cuDNN 9.x的DLL文件

### 日志显示

```
Line 163: cuDNN DLL found: C:\Program Files\NVIDIA\CUDNN\v9.6\bin\12.6\cudnn_graph64_9.dll
Line 164: Added cuDNN path to PATH: C:\Program Files\NVIDIA\CUDNN\v9.6\bin\12.6
```

**说明**：代码已经找到并添加了cuDNN路径，但ONNX Runtime仍然无法加载。

### 可能的原因

1. **cuDNN版本不兼容**：ONNX Runtime-gpu 1.16+可能需要cuDNN 8.x而不是9.x
2. **PATH未生效**：在Python进程中添加PATH可能太晚了
3. **缺少其他依赖**：除了cuDNN，还可能缺少zlib、cudart等

### 解决方案（3选1）

#### 方案A：临时使用CPU模式（推荐用于快速验证）

**修改**: `services/faster_whisper_vad/config.py`

```python
# 临时强制VAD使用CPU
VAD_DEVICE = os.getenv("VAD_DEVICE", "cpu")  # 改为cpu
```

或启动前设置环境变量：
```powershell
$env:VAD_DEVICE = "cpu"
npm start
```

**优点**：
- ✅ 立即可用，验证其他功能
- ✅ Faster Whisper仍使用GPU（速度影响不大）

**缺点**：
- ⚠️ VAD在CPU上慢一些（但通常可接受）

---

#### 方案B：降级到cuDNN 8.x（推荐长期方案）

1. **卸载当前cuDNN 9.6**
2. **安装cuDNN 8.9**（与ONNX Runtime 1.16+兼容）
3. **重新配置PATH**

**参考**: https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html

---

#### 方案C：在系统PATH中预先添加cuDNN路径

**问题**：当前代码在Python进程启动后才添加PATH，可能太晚

**解决**：在Electron主进程启动时就添加

**位置**: `electron-node/main/src/index.ts`

```typescript
// 在app.on('ready')之前
import * as path from 'path';

// 预先添加cuDNN路径到系统PATH
const cudnnPath = 'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin\\12.6';
process.env.PATH = `${cudnnPath};${process.env.PATH}`;
console.log('✅ Added cuDNN to PATH:', cudnnPath);
```

---

## 📊 当前状态（修复后）

### ✅ 已修复
1. ✅ piper-tts环境变量
2. ✅ nmt-m2m100 GBK编码

### ⚠️ 待处理
3. ⚠️ faster-whisper-vad VAD模型CUDA配置

### 🎯 建议的验证步骤

1. **重启Electron**（环境变量已修复）
2. **测试piper-tts启动**（应该成功）
3. **测试nmt-m2m100启动**（应该成功）
4. **faster-whisper-vad**:
   - Faster Whisper部分正常工作 ✅
   - VAD部分如果需要，临时使用CPU模式

---

## 🎉 总结

### 核心问题
**新架构的ServiceProcessRunner缺少环境变量配置**，而备份代码中有完整的配置。

### 修复方法
统一在`ServiceProcessRunner.ts`中添加必需的环境变量：
- `PYTHONIOENCODING=utf-8`
- `PIPER_USE_GPU=true`

### 后续优化（可选）
Day 5重构时，可以考虑：
- 支持`service.json`中的`env`字段
- 每个服务自定义环境变量
- 更灵活的配置方式

---

**修复用时**: 15分钟
**测试状态**: 等待重启验证
**预期**: TTS和NMT应该能正常启动 ✅
