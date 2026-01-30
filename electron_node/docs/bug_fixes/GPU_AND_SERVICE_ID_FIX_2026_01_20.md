# 🔧 GPU监控和服务ID修复 - 2026-01-20

## 问题诊断

### 问题1: GPU资源未显示 ❌
**原因**: `get-system-resources` handler没有调用GPU监控函数
**影响**: 用户看不到GPU使用率

### 问题2: 服务启动失败 ❌
**错误**: `service not found: faster_whisper_vad`
**原因**: 前端传的是下划线格式（`faster_whisper_vad`），但`service.json`中ID是连字符格式（`faster-whisper-vad`）

---

## 修复方案

### 修复1: 实现GPU监控 ✅

**位置**: `main/src/index.ts` 第118-147行

**修改前**:
```typescript
ipcMain.handle('get-system-resources', async () => {
  // ... CPU和内存计算 ...
  return {
    cpu: Math.min(Math.max(cpuUsage, 0), 100),
    memory: Math.min(Math.max(memoryUsage, 0), 100),
    gpu: null,  // ❌ 永远返回null
  };
});
```

**修改后**:
```typescript
ipcMain.handle('get-system-resources', async () => {
  // ... CPU和内存计算 ...
  
  // 获取GPU使用率
  let gpuUsage: number | null = null;
  try {
    const { getGpuUsage } = await import('./system-resources');
    const gpuInfo = await getGpuUsage();
    gpuUsage = gpuInfo?.usage ?? null;
  } catch (error) {
    logger.debug({ error }, 'Failed to get GPU usage');
  }
  
  return {
    cpu: Math.min(Math.max(cpuUsage, 0), 100),
    memory: Math.min(Math.max(memoryUsage, 0), 100),
    gpu: gpuUsage,  // ✅ 返回真实GPU使用率
  };
});
```

**GPU监控原理**:
1. 调用`system-resources.ts`的`getGpuUsage()`
2. 先尝试`nvidia-smi`命令（Windows/Linux）
3. 失败则尝试Python + pynvml
4. 超时保护：2秒内必须返回
5. 失败返回`null`，不阻塞界面

---

### 修复2: 服务ID格式转换 ✅

**位置**: `main/src/index.ts`

**问题根源**:
- **service.json**: 使用连字符 `faster-whisper-vad`, `nmt-m2m100`
- **前端传参**: 使用下划线 `faster_whisper_vad`, `nmt_m2m100`

**解决方案**: 在IPC handlers中自动转换

#### 2.1 启动服务handler

```typescript
ipcMain.handle('start-python-service', async (_event, serviceName: string) => {
  if (!managers.serviceRunner) {
    throw new Error('Service runner not initialized');
  }
  
  // serviceName可能是下划线格式，需要转换成连字符格式
  let serviceId = serviceName;
  const registry = getServiceRegistry();
  
  if (registry && !registry.has(serviceId)) {
    // 尝试下划线转连字符
    const convertedId = serviceName.replace(/_/g, '-');
    if (registry.has(convertedId)) {
      serviceId = convertedId;
      logger.debug({ serviceName, convertedId }, 'Converted service ID');
    }
  }
  
  logger.info({ serviceId, originalName: serviceName }, 'IPC: Starting service');
  await managers.serviceRunner.start(serviceId);
  return { success: true };
});
```

#### 2.2 停止服务handler
同样的转换逻辑

#### 2.3 服务状态查询handler
同样的转换逻辑

---

## 技术细节

### GPU监控实现（system-resources.ts）

#### 方法1: nvidia-smi命令
```bash
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits
```

**输出示例**: `45, 2048, 8192`
- 第1个值：GPU利用率 (%)
- 第2个值：已使用显存 (MB)
- 第3个值：总显存 (MB)

#### 方法2: Python + pynvml
```python
import pynvml
pynvml.nvmlInit()
handle = pynvml.nvmlDeviceGetHandleByIndex(0)
util = pynvml.nvmlDeviceGetUtilizationRates(handle)
mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
print(f"{util.gpu},{mem_info.used / mem_info.total * 100}")
```

#### 超时保护
- 总超时：2秒
- nvidia-smi超时：1.5秒
- Python脚本超时：1秒

---

## 测试清单

### GPU监控 ✅
- [ ] 刷新窗口，GPU显示数值（如 45%）
- [ ] GPU数值每2秒更新
- [ ] 如果没有NVIDIA GPU，显示"--"（不报错）

### 服务启动 ✅
- [ ] 点击"faster_whisper_vad"启动按钮
- [ ] 不再显示"service not found"
- [ ] 服务成功启动（Console显示进程启动日志）
- [ ] 服务状态变为"运行中"

### 其他服务
- [ ] nmt-m2m100（前端传nmt_m2m100）
- [ ] piper-tts（前端传piper_tts）
- [ ] speaker-embedding（前端传speaker_embedding）

---

## 预期结果

### UI显示
```
系统资源
CPU: 25%     [绿色进度条]
内存: 60%    [黄色进度条]
GPU: 45%     [蓝色进度条] ← ✅ 现在有数值了！

服务管理
- faster-whisper-vad  [运行中] PID: 12345  ← ✅ 能启动了！
- nmt-m2m100          [运行中] PID: 12346
- piper-tts           [已停止] [启动]
```

### Console日志（主进程）
```
IPC: Starting Python service
  serviceId: "faster-whisper-vad"
  originalName: "faster_whisper_vad"
  convertedId: "faster-whisper-vad"
  
🚀 Starting service process
  serviceId: "faster-whisper-vad"
  executable: "python"
  args: ["faster_whisper_vad_service.py"]
  cwd: "D:/Programs/github/lingua_1/electron_node/services/faster_whisper_vad"
  
✅ Service started successfully
  pid: 12345
```

---

## 如果还有问题

### GPU仍显示"--"
**可能原因**:
1. 没有安装NVIDIA驱动
2. nvidia-smi命令不在PATH
3. Python没有安装pynvml包

**解决**:
```bash
# 测试nvidia-smi
nvidia-smi

# 安装pynvml（如果需要）
pip install nvidia-ml-py3
```

### 服务仍无法启动
**检查**:
1. 主进程Console是否显示"Converted service ID"
2. 如果显示，检查转换后的ID是否正确
3. 查看完整错误日志（包含command、cwd、exit code）

---

## 代码改动总结

**修改文件**: 1个
- `main/src/index.ts`

**新增代码**: ~80行
- GPU监控集成（~15行）
- 服务ID转换逻辑（~65行，3个handlers）

**复用代码**: `system-resources.ts`
- 无需修改，直接导入使用

---

**现在请测试GPU显示和服务启动！** 🚀
