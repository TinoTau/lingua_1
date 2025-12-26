# Error Analysis (Part 2/4)


## 报错原因

### 错误现象

**服务端日志**:
```
第一个请求（job-62962106）- 成功 ✅
  [INFO] Detected Opus packet format: packet_len=73, total_bytes=8352
  [INFO] Successfully decoded Opus packets: 3840 samples
  [INFO] POST /utterance HTTP/1.1" 200 OK

后续请求 - 失败 ❌
  [WARN] Opus data is not in packet format
  [ERROR] Failed to decode Opus audio (continuous byte stream method)
  [INFO] POST /utterance HTTP/1.1" 400 Bad Request
```

### 原因分析

1. **第一个请求成功**：
   - 数据来源：`utterance`消息（Web端手动发送）
   - 格式：packet格式（使用`encodePackets()`）
   - 结果：服务端检测到packet格式，解码成功 ✅

2. **后续请求失败**：
   - 数据来源：`audio_chunk`消息合并（Web端流式发送）
   - 格式：连续字节流（使用`encode()`方法）
   - 结果：服务端检测不到packet格式，解码失败 ❌

---

## 为什么说是"两种格式的数据流"？

### 误解澄清

❌ **错误理解**：节点端收到了`utterance`和`audio_chunk`两种消息类型

✅ **正确理解**：节点端只收到`JobAssignMessage`，但数据来源不同，导致格式不一致

### 实际情况

1. **节点端只接收`JobAssignMessage`**：
   - 消息类型统一：`job_assign`
   - 但数据内容格式不同：
     - 来自`utterance`：packet格式 ✅
     - 来自`audio_chunk`合并：连续字节流 ❌（修复前）

2. **服务端检测逻辑**：
   - 检测数据格式（packet格式 vs 连续字节流）
   - 如果检测到packet格式，使用Plan A解码 ✅
   - 如果检测不到packet格式，报错 ❌

---

## 修复后的情况

### 修复内容

**文件**: `webapp/web-client/src/websocket_client.ts`

**修复**: `sendAudioChunkJSON()`方法
- 修复前：使用`encode()`方法，生成连续字节流 ❌
- 修复后：使用`encodePackets()`方法，生成packet格式 ✅

### 修复后的数据流

#### 路径1: Utterance消息 → JobAssignMessage（不变）

```
Web端
  → sendUtterance() [packet格式] ✅
  → utterance消息
  
调度服务器
  → 直接创建job（packet格式）
  → JobAssignMessage（packet格式）
  
节点端
  → 接收JobAssignMessage（packet格式）✅
  → 服务端检测到packet格式 ✅
```

#### 路径2: AudioChunk消息 → JobAssignMessage（修复后）

```
Web端
  → sendAudioChunk() [packet格式] ✅
  → audio_chunk消息（packet格式）
  
调度服务器
  → audio_buffer.add_chunk()（packet格式）
  → finalize（合并所有chunk，保持packet格式）
  → 创建job（packet格式）
  → JobAssignMessage（packet格式）
  
节点端
  → 接收JobAssignMessage（packet格式）✅
  → 服务端检测到packet格式 ✅
```

---

## 总结

### 报错原因

1. **节点端只接收`JobAssignMessage`**，但数据来源不同：
   - 来自`utterance`消息：packet格式 ✅
   - 来自`audio_chunk`消息合并：连续字节流 ❌（修复前）

2. **服务端检测逻辑**：
   - 检测数据格式（packet格式 vs 连续字节流）
   - 如果格式不一致，导致部分请求成功，部分请求失败

3. **根本原因**：
   - Web端`sendAudioChunk()`没有使用Plan A格式
   - 导致`audio_chunk`消息中的数据是连续字节流
   - 调度服务器合并后，仍然是连续字节流
   - 节点端收到的`JobAssignMessage`中，数据格式不一致

### 修复后

- 所有数据都使用packet格式
- 无论数据来源是`utterance`还是`audio_chunk`，格式都一致
- 服务端可以正确检测到packet格式，解码成功

---

## 相关文档

- `WEB_CLIENT_AUDIO_FORMAT_ANALYSIS.md` - Web端音频格式分析
- `ERROR_ANALYSIS_404_400.md` - 404/400错误分析
- `AUDIO_FORMAT_INVESTIGATION.md` - 音频格式调查
- `FIX_AUDIO_CHUNK_FORMAT.md` - 修复audio_chunk格式
- `NODE_CLIENT_MESSAGE_TYPES.md` - 节点端消息类型



---

## COMPREHENSIVE_404_INVESTIGATION.md

# 404错误全面调查总结

**日期**: 2025-12-24  
**问题**: 节点端报告404错误，但服务端成功处理请求  
**状态**: ✅ **已添加全面日志和检查**

---

## 已实施的改进

### 1. 服务端点刷新日志

在`refreshServiceEndpoints()`中添加了详细日志：

```typescript
// 记录所有已安装服务
logger.debug({
  installedServicesCount: installedServices.length,
  installedServices: installedServices.map(s => ({
    service_id: s.service_id,
    type: s.type,
    status: s.status,
  })),
}, 'Refreshing service endpoints');

// 记录跳过的非运行服务
logger.debug({ serviceId, status }, 'Skipping non-running service');

// 记录创建的服务端点
logger.debug({
  serviceId: endpoint.serviceId,
  baseUrl: endpoint.baseUrl,
  port: endpoint.port,
  serviceType: endpoint.serviceType,
}, 'Created service endpoint');

// 记录刷新结果（包含详细信息）
logger.info({
  asr: endpoints.get(ServiceType.ASR)?.map(e => ({ 
    serviceId: e.serviceId, 
    baseUrl: e.baseUrl 
  })) || [],
  // ... 其他服务类型
}, 'Service endpoints refreshed');
```

### 2. 端口获取日志

在`getServicePort()`中添加了日志：

```typescript
logger.debug({ 
  serviceId, 
  port: portMap[serviceId], 
  source: 'portMap' 
}, 'Got service port from portMap');
```

### 3. 服务端点创建日志

在`createServiceEndpoint()`中添加了详细日志：

```typescript
// 端口不可用时记录警告
logger.warn({
  serviceId: service.service_id,
  serviceType: service.type,
  status: service.status,
}, 'Cannot create service endpoint: port not available');

// 成功创建时记录详细信息
logger.debug({
  serviceId: endpoint.serviceId,
  baseUrl: endpoint.baseUrl,
  port: endpoint.port,
  serviceType: endpoint.serviceType,
  status: endpoint.status,
}, 'Created service endpoint');
```

### 4. HTTP请求日志（之前已添加）

- 请求前：记录完整URL和请求参数
- 请求成功：记录状态码
- 请求失败：记录详细错误信息

### 5. 服务端点选择日志（之前已添加）

- 无可用端点时记录警告
- 选择端点时记录可用端点列表

---

## 关键配置检查点

### 1. 端口配置 ✅

**位置**: `task-router.ts` - `getServicePort()`

```typescript
const portMap: Record<string, number> = {
  'faster-whisper-vad': 6007,  // ✅ 正确
  // ...
};
```

**验证**: 端口映射正确，`faster-whisper-vad`映射到`6007`

### 2. 服务ID映射 ✅

**位置**: `task-router.ts` - `getServicePort()`

```typescript
const pythonServiceNameMap: Record<string, string> = {
  'faster-whisper-vad': 'faster_whisper_vad',  // ✅ 正确
  // ...
};
```

**验证**: 服务ID映射正确

### 3. 服务类型映射 ✅

**位置**: `task-router.ts` - `getServiceType()`

```typescript
const typeMap: Record<string, ServiceType> = {
  'faster-whisper-vad': ServiceType.ASR,  // ✅ 正确
  // ...
};
```

**验证**: 服务类型映射正确

### 4. 服务端点刷新时机 ✅

**位置**: `inference-service.ts` - `processJob()`

```typescript
// 刷新服务端点列表（确保使用最新的服务状态）
await this.taskRouter.refreshServiceEndpoints();
```

**验证**: 每次处理任务前都会刷新服务端点列表

### 5. HTTP客户端配置 ✅

**位置**: `task-router.ts` - `routeASRTask()`

```typescript
const httpClient: AxiosInstance = axios.create({
  baseURL: endpoint.baseUrl,  // http://127.0.0.1:6007
  timeout: 60000,
});

response = await httpClient.post('/utterance', requestBody, {
  signal: abortController.signal,
});
```

**验证**: HTTP客户端配置正确，使用正确的baseURL和路径

### 6. FastAPI路由配置 ✅

**位置**: `faster_whisper_vad_service.py`

```python
@app.post("/utterance", response_model=UtteranceResponse)
def process_utterance(req: UtteranceRequest):
    # 端点正确定义
```

**验证**: FastAPI路由配置正确

---

## 可能的问题场景

### 场景1: 服务端点未及时刷新 ⚠️

**问题**: 
- 服务在启动过程中，状态可能暂时不一致
- `refreshServiceEndpoints()`可能在服务完全就绪前被调用

**检查**:
- 查看日志中的`Service endpoints refreshed`，确认`faster-whisper-vad`是否在列表中
- 查看`Created service endpoint`日志，确认端点是否正确创建

### 场景2: 端口获取失败 ⚠️

**问题**:
- `getServicePort()`可能返回`null`
- 导致`createServiceEndpoint()`返回`null`

**检查**:
- 查看`Got service port from portMap`日志
- 查看`Cannot create service endpoint: port not available`警告

### 场景3: 服务状态不一致 ⚠️

**问题**:
- `getInstalledServices()`返回的服务状态可能不准确
- `isServiceRunning()`可能返回错误的状态

**检查**:
- 查看`Refreshing service endpoints`日志，确认服务状态
- 查看`Skipping non-running service`日志

### 场景4: HTTP请求路径错误 ⚠️

**问题**:
- baseURL或路径拼接错误
- 请求发送到错误的URL

**检查**:
- 查看`Routing ASR task to faster-whisper-vad`日志，确认`requestUrl`
- 查看`faster-whisper-vad request failed`日志，确认实际请求的URL

### 场景5: 服务暂时不可用 ⚠️

**问题**:
- 服务在处理其他请求时暂时不可用
- 服务重启导致请求失败

**检查**:
- 查看服务端日志，确认请求是否到达
- 查看节点端日志，确认请求发送时间

---

## 调试步骤

### 步骤1: 重新编译和重启

```bash
cd electron_node/electron-node
npm run build
# 重启节点端
```

### 步骤2: 查看日志

**节点端日志**（查找以下关键日志）:
1. `Refreshing service endpoints` - 确认服务列表
2. `Created service endpoint` - 确认端点创建
3. `Selecting service endpoint` - 确认端点选择
4. `Routing ASR task to faster-whisper-vad` - 确认请求路由
5. `faster-whisper-vad request succeeded/failed` - 确认请求结果

**服务端日志**:
1. `Received utterance request` - 确认请求到达
2. `POST /utterance HTTP/1.1" 200 OK` - 确认请求成功

### 步骤3: 对比时间戳

- 对比节点端请求发送时间和服务端请求接收时间
- 检查是否有时间差或延迟

### 步骤4: 检查服务状态

- 确认`faster-whisper-vad`服务在节点端显示为`running`
- 确认服务端口`6007`正在监听
- 使用`curl`或`Postman`直接测试`http://127.0.0.1:6007/utterance`

---

## 预期日志输出示例

### 成功的服务端点刷新

```
[DEBUG] Refreshing service endpoints: {
  installedServicesCount: 5,
  installedServices: [
    { service_id: 'faster-whisper-vad', type: 'asr', status: 'running' },
    ...
  ]
}

[DEBUG] Created service endpoint: {
  serviceId: 'faster-whisper-vad',
  baseUrl: 'http://127.0.0.1:6007',
  port: 6007,
  serviceType: 'asr',
  status: 'running'
}

[INFO] Service endpoints refreshed: {
  asr: [{ serviceId: 'faster-whisper-vad', baseUrl: 'http://127.0.0.1:6007' }],
  ...
}
```

### 成功的请求

```
[INFO] Routing ASR task to faster-whisper-vad: {
  serviceId: 'faster-whisper-vad',
  baseUrl: 'http://127.0.0.1:6007',
  requestUrl: 'http://127.0.0.1:6007/utterance',
  audioFormat: 'opus',
  jobId: 'job-XXX'
}

[INFO] faster-whisper-vad request succeeded: {
  serviceId: 'faster-whisper-vad',
  requestUrl: 'http://127.0.0.1:6007/utterance',
  status: 200,
  jobId: 'job-XXX'
}
```

### 失败的请求

```
[ERROR] faster-whisper-vad request failed: {
  serviceId: 'faster-whisper-vad',
  requestUrl: 'http://127.0.0.1:6007/utterance',
  baseUrl: 'http://127.0.0.1:6007',
  status: 404,
  statusText: 'Not Found',
  errorMessage: 'Request failed with status code 404',
  jobId: 'job-XXX',
  responseData: { ... }
}
```

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 任务路由和端点管理
- `electron_node/electron-node/main/src/inference/inference-service.ts` - 推理服务
- `electron_node/electron-node/main/src/agent/node-agent.ts` - 节点代理
- `electron_node/electron-node/main/src/python-service-manager/index.ts` - Python服务管理
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - FastAPI服务

---

## 下一步

1. **重新编译节点端**并重启
2. **运行测试**并收集日志
3. **分析日志**找出404错误的根本原因
4. **根据日志结果**采取相应的修复措施



---

## NMT_404_ERROR_ANALYSIS.md

# NMT服务404错误分析报告

**日期**: 2025-12-25  
**问题**: job-556E716C (trace_id=dff4fb04-7c98-4b61-a983-faa35f6f9842) 处理失败  
**状态**: 🔍 **问题已定位**