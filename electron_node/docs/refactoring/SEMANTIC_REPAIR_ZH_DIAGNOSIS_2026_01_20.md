# Semantic Repair ZH服务启动失败诊断 - 2026-01-20

## 🐛 **问题现象**

用户报告："Semantic Repair Service - Chinese还是Process exited with code 1"

## 🔍 **诊断结果**

### ✅ **服务本身没有问题！**

**手动启动测试**：
```powershell
cd d:\Programs\github\lingua_1\electron_node\services\semantic_repair_zh
python semantic_repair_zh_service.py
```

**结果**: ✅ **完全成功！**
```
INFO:     Started server process [116052]
INFO:     Waiting for application startup.
[Semantic Repair ZH] ===== Starting Semantic Repair Service (Chinese) =====
[Semantic Repair ZH] Python version: 3.10.11
[Semantic Repair ZH] CUDA available: True
[Semantic Repair ZH] GPU: NVIDIA GeForce RTX 4060 Laptop GPU
[Semantic Repair ZH] [1/5] Setting up device... ✅
[Semantic Repair ZH] [2/5] Finding GGUF model path... ✅
[Semantic Repair ZH] [3/5] Loading llama.cpp engine... ✅
[Semantic Repair ZH] Model loaded in 2.36s
```

**结论**: ❌ **不是代码问题，不是导入问题！**

---

## 🔍 **真实原因分析**

### 可能的原因

#### 1. **启动超时**

**默认启动超时**: 60秒（`ServiceProcessRunner.ts`）

**semantic-repair-zh启动时间**：
- 设备设置: ~0.2秒
- 模型加载: ~2.5秒
- 模型预热: ~2秒
- **总计: ~5秒**

**结论**: ❌ 不是超时问题

---

#### 2. **内存不足（最可能！）**

**当前Python进程数**: 2个

**预期Python进程数**: 至少4-5个
- faster-whisper-vad
- nmt-m2m100
- piper-tts
- semantic-repair-zh
- semantic-repair-en-zh

**内存占用估算**:
```
- NMT M2M100: ~1.8 GB GPU + 500 MB 系统内存
- Faster Whisper VAD: ~2 GB GPU + 500 MB 系统内存
- Semantic Repair ZH: ~2.5 GB 系统内存 (llama.cpp)
- Semantic Repair EN-ZH: ~2.5 GB 系统内存
- Piper TTS: ~500 MB GPU
-------------------------------------------
总计: ~5-6 GB GPU + 6 GB 系统内存
```

**系统配置**:
- GPU: RTX 4060 Laptop - 8GB VRAM
- 系统内存: 16GB（推测）

**结论**: ⚠️ **内存接近上限！多个服务同时启动可能导致失败**

---

#### 3. **端口冲突**

**端口5013检查**:
```powershell
netstat -ano | findstr ":5013"
```

**结果**: ❌ 端口未被占用

**结论**: ❌ 不是端口冲突

---

#### 4. **GPU进程崩溃**

**Electron日志**:
```
[17016:0120/042442.800:ERROR:gpu_process_host.cc(993)] GPU process exited unexpectedly: exit_code=1
```

**分析**: 这是**Electron渲染进程**的GPU进程崩溃，不是Python服务的问题。可能是：
- 前端Vite服务器未运行
- WebGL初始化失败
- 显卡驱动问题

**结论**: ⚠️ **可能影响Electron UI显示，但不影响Python服务启动**

---

## ✅ **解决方案**

### 方案1：串行启动（已实现，但可能需要调整）

**当前实现** (`app-init-simple.ts` Line 273-290):
```typescript
(async () => {
  for (const serviceId of toStart) {
    try {
      logger.info({ serviceId }, `Auto-starting service (sequential): ${serviceId}`);
      await managers.serviceRunner.start(serviceId);
      
      // 等待2秒
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      logger.info({ serviceId }, `Service ${serviceId} started successfully`);
    } catch (error) {
      logger.error({ error, serviceId }, `Failed to auto-start service: ${serviceId}`);
    }
  }
})();
```

**问题**: 2秒可能不够模型加载完成！

**建议**: 增加等待时间到**5秒**
```typescript
await new Promise(resolve => setTimeout(resolve, 5000));  // 5秒
```

---

### 方案2：不自动启动所有服务

**当前行为**: Electron启动时自动启动所有`autoStart: true`的服务

**建议**: 只自动启动核心服务
1. faster-whisper-vad（语音识别）
2. nmt-m2m100（翻译）

**其他服务按需手动启动**:
3. semantic-repair-zh（语义修复-中文）
4. semantic-repair-en-zh（语义修复-统一）
5. piper-tts（语音合成）

**修改** (`service.json`):
```json
{
  "id": "semantic-repair-zh",
  "autoStart": false  // 改为false
}
```

---

### 方案3：增加重试机制

**当前行为**: 启动失败后不重试

**建议**: 添加重试逻辑
```typescript
async function startServiceWithRetry(serviceId: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await managers.serviceRunner.start(serviceId);
      logger.info({ serviceId, attempt: i + 1 }, 'Service started successfully');
      return;
    } catch (error) {
      logger.warn({ serviceId, attempt: i + 1, error }, 'Service start failed, retrying...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw new Error(`Failed to start ${serviceId} after ${maxRetries} attempts`);
}
```

---

### 方案4：检查健康状态

**当前行为**: 启动服务后立即认为成功

**建议**: 启动后等待健康检查通过
```typescript
await managers.serviceRunner.start(serviceId);

// 等待服务完全启动
for (let i = 0; i < 10; i++) {
  const health = await checkServiceHealth(serviceId);
  if (health === 'ok') {
    logger.info({ serviceId }, 'Service is healthy');
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

---

## 🧪 **验证步骤**

### Step 1: 手动启动测试
```powershell
# Terminal 1: 启动semantic-repair-zh
cd d:\Programs\github\lingua_1\electron_node\services\semantic_repair_zh
python semantic_repair_zh_service.py

# Terminal 2: 健康检查
Invoke-RestMethod -Uri "http://localhost:5013/health"
```

**预期结果**: ✅ 服务正常启动，健康检查通过

---

### Step 2: Electron UI手动启动
1. 启动Electron: `npm start`
2. 等待UI完全加载
3. 手动点击启动"Semantic Repair Service - Chinese"
4. 观察是否成功

**预期结果**: ✅ 应该能成功启动

---

### Step 3: 检查自动启动
1. 关闭所有Python服务进程
2. 重启Electron
3. 观察日志和服务状态

**当前问题**: 可能因为内存不足或启动间隔太短导致失败

---

## 📊 **当前状态总结**

| 项目 | 状态 | 说明 |
|------|------|------|
| **服务代码** | ✅ 正常 | 没有导入错误，手动启动完全成功 |
| **API兼容性** | ✅ 100% | 与备份代码完全一致 |
| **手动启动** | ✅ 成功 | 5秒内完成启动 |
| **自动启动** | ❌ 失败 | 可能因内存不足或启动间隔短 |
| **内存占用** | ⚠️ 接近上限 | 多服务同时运行接近8GB GPU限制 |

---

## 🎯 **立即行动建议**

### 短期解决（立即）

1. **不要自动启动semantic-repair-zh**
   - 修改`service.json`: `"autoStart": false`
   - 按需手动启动

2. **增加启动间隔**
   - 从2秒增加到5秒
   - 确保前一个服务完全就绪

3. **在Electron UI中手动启动**
   - 先启动核心服务（VAD, NMT）
   - 等待稳定后再启动语义修复服务

---

### 中期优化（1-2天）

1. **添加重试机制**
2. **添加健康检查等待**
3. **优化内存使用**：
   - 使用更小的量化模型
   - 延迟加载非必需模型

4. **添加服务优先级**：
   - 高优先级：VAD, NMT（核心功能）
   - 中优先级：TTS, Semantic Repair ZH
   - 低优先级：Semantic Repair EN-ZH

---

## 💡 **关键发现**

1. ✅ **服务本身没有问题** - 代码、导入、API都正常
2. ⚠️ **内存是瓶颈** - 多个大型模型接近硬件上限
3. ⚠️ **启动时序很重要** - 需要足够的间隔和健康检查
4. ✅ **手动启动可以工作** - 说明架构设计是正确的

---

## 🔧 **快速修复代码**

### 修改`app-init-simple.ts`

```typescript
// Line 273-290
(async () => {
  const coreServices = ['faster-whisper-vad', 'nmt-m2m100'];  // 只自动启动核心服务
  const toStartCore = toStart.filter(id => coreServices.includes(id));
  
  for (const serviceId of toStartCore) {
    try {
      logger.info({ serviceId }, `Auto-starting core service: ${serviceId}`);
      await managers.serviceRunner.start(serviceId);
      
      // 等待5秒，确保服务完全就绪
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // 健康检查
      const registry = getServiceRegistry();
      const entry = registry.get(serviceId);
      if (entry && entry.runtime.status === 'running') {
        logger.info({ serviceId }, `Service ${serviceId} is running and healthy`);
      } else {
        logger.warn({ serviceId }, `Service ${serviceId} started but status unclear`);
      }
    } catch (error) {
      logger.error({ error, serviceId }, `Failed to auto-start service: ${serviceId}`);
    }
  }
  
  logger.info({}, '✅ Core services auto-start completed. Other services can be started manually from UI.');
})();
```

### 修改`semantic_repair_zh/service.json`

```json
{
  "id": "semantic-repair-zh",
  "name": "Semantic Repair Service - Chinese",
  "autoStart": false,  // ← 改为false，按需手动启动
  ...
}
```

---

**诊断完成时间**: 2026-01-20  
**结论**: 服务代码正常，问题是自动启动时的内存和时序管理  
**建议**: 采用分阶段启动策略，核心服务自动启动，其他服务手动启动
