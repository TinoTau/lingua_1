# Error Analysis (Part 3/4)


---

## 错误现象

### 调度服务器日志
```
ERROR Job processing failed trace_id=dff4fb04-7c98-4b61-a983-faa35f6f9842 job_id=job-556E716C session_id=s-BAFEA97F
```

### 节点端日志

#### 1. faster-whisper-vad 请求成功 ✅
```json
{
  "level": 30,
  "serviceId": "faster-whisper-vad",
  "requestUrl": "http://127.0.0.1:6007/utterance",
  "status": 200,
  "jobId": "job-4C2EE9CF",
  "msg": "faster-whisper-vad request succeeded"
}
```

**ASR识别结果**: "娉曞畾浜哄＋ 娉曞畾浜哄＋ 娉曞畾浜哄＋"

#### 2. NMT 任务失败 ❌
```json
{
  "level": 50,
  "error": {
    "message": "Request failed with status code 404",
    "name": "AxiosError",
    "config": {
      "baseURL": "http://127.0.0.1:5008",
      "method": "post",
      "url": "/v1/nmt/translate",
      "data": "{\"text\":\"娉曞畾浜哄＋ 娉曞畾浜哄＋ 娉曞畾浜哄＋\",\"src_lang\":\"zh\",\"tgt_lang\":\"en\",\"context_text\":\"娉曞畾浜哄＋ 娉曞畾浜哄＋ 娉曞畾浜哄＋\"}"
    },
    "status": 404
  },
  "serviceId": "nmt-m2m100",
  "msg": "NMT task failed"
}
```

---

## 问题分析

### 根本原因

**faster-whisper-vad服务工作正常**，问题出在**NMT服务**：

1. **ASR阶段成功**：
   - faster-whisper-vad 成功解码 Opus packets（Plan A格式）
   - 成功识别文本
   - 返回 200 OK

2. **NMT阶段失败**：
   - 节点端请求 `http://127.0.0.1:5008/v1/nmt/translate`
   - NMT服务返回 404 Not Found
   - 导致整个pipeline失败

### 可能的原因

1. **NMT服务端点路径不正确**：
   - 节点端请求: `/v1/nmt/translate`
   - 实际端点可能是: `/translate` 或其他路径

2. **NMT服务未正确启动**：
   - 服务可能未启动或已停止
   - 端口5008可能被占用或服务未监听

3. **NMT服务API版本不匹配**：
   - 节点端使用 `/v1/nmt/translate`
   - 服务端可能使用不同的API版本

---

## 解决方案

### 1. 检查NMT服务端点配置

需要确认：
- NMT服务的实际端点路径是什么？
- 节点端的 `routeNMTTask` 方法使用的URL是否正确？

### 2. 检查NMT服务状态

需要确认：
- NMT服务是否正在运行？
- 端口5008是否可访问？
- 服务日志中是否有相关错误？

### 3. 修复端点路径

如果端点路径不匹配，需要：
- 修改节点端的 `routeNMTTask` 方法
- 或修改NMT服务的端点定义
- 确保两者一致

---

## 下一步行动

1. ✅ **已完成**: 确认faster-whisper-vad服务工作正常
2. 🔍 **进行中**: 检查NMT服务的端点配置
3. ⏳ **待处理**: 修复NMT服务的404错误
4. ⏳ **待处理**: 重新测试完整的pipeline

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 节点端任务路由
- `electron_node/services/nmt_m2m100/` - NMT服务代码
- `electron_node/electron-node/logs/electron-main.log` - 节点端日志



---

## NMT_404_FIX_SUMMARY.md

# NMT服务404错误修复总结

**日期**: 2025-12-25  
**问题**: NMT服务返回404错误，导致整个pipeline失败  
**状态**: ✅ **已修复**

---

## 问题根源

### 错误现象
- 调度服务器报错: `ERROR Job processing failed trace_id=dff4fb04-7c98-4b61-a983-faa35f6f9842 job_id=job-556E716C`
- 节点端日志显示: `Request failed with status code 404`
- 请求URL: `http://127.0.0.1:5008/v1/nmt/translate`

### 根本原因

**端点路径不匹配**：
- **节点端请求**: `/v1/nmt/translate`
- **NMT服务实际端点**: `/v1/translate`

从NMT服务代码 (`electron_node/services/nmt_m2m100/nmt_service.py`) 可以看到：
```python
@app.post("/v1/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest) -> TranslateResponse:
```

---

## 修复方案

### 修改文件
`electron_node/electron-node/main/src/task-router/task-router.ts`

### 修改内容
将NMT任务的端点路径从 `/v1/nmt/translate` 改为 `/v1/translate`：

```typescript
// 修改前
const response = await httpClient.post('/v1/nmt/translate', {
  text: task.text,
  src_lang: task.src_lang,
  tgt_lang: task.tgt_lang,
  context_text: task.context_text,
}, {

// 修改后
const response = await httpClient.post('/v1/translate', {
  text: task.text,
  src_lang: task.src_lang,
  tgt_lang: task.tgt_lang,
  context_text: task.context_text,
}, {
```

---

## 验证

### 修复前
- faster-whisper-vad: ✅ 成功（200 OK）
- NMT: ❌ 失败（404 Not Found）
- Pipeline: ❌ 失败

### 修复后（预期）
- faster-whisper-vad: ✅ 成功（200 OK）
- NMT: ✅ 成功（200 OK）
- Pipeline: ✅ 成功

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 已修复
- `electron_node/services/nmt_m2m100/nmt_service.py` - NMT服务端点定义
- `electron_node/services/faster_whisper_vad/docs/NMT_404_ERROR_ANALYSIS.md` - 问题分析文档

---

## 注意事项

1. **faster-whisper-vad服务工作正常**：Plan A Opus解码和ASR识别都正常
2. **问题出在NMT服务**：端点路径配置错误
3. **需要重新编译节点端**：修改TypeScript代码后需要重新编译
4. **需要重启节点端**：修复后需要重启节点端以应用更改



---

## SCHEDULER_404_ERROR_ANALYSIS.md

# 调度服务器404错误分析

**日期**: 2025-12-24  
**问题**: 调度服务器收到404错误，但服务端成功处理请求  
**状态**: ⚠️ **待调查**

---

## 问题现象

### 1. 服务端日志（成功）

**Jobs**: `job-188455CD`, `job-C72E18A9`, `job-4FB17D7C`

```
2025-12-24T09:14:39.874Z [INFO] [job-188455CD] Received utterance request
2025-12-24T09:14:41.885Z [INFO] "POST /utterance HTTP/1.1" 200 OK

2025-12-24T09:14:47.841Z [INFO] [job-C72E18A9] Received utterance request
2025-12-24T09:14:54.885Z [INFO] "POST /utterance HTTP/1.1" 200 OK

2025-12-24T09:14:54.008Z [INFO] [job-4FB17D7C] Received utterance request
2025-12-24T09:14:56.891Z [INFO] "POST /utterance HTTP/1.1" 200 OK
```

**结论**: 服务端成功处理所有请求并返回200 OK。

### 2. 调度服务器日志（404错误）

```
{"timestamp":"2025-12-24T09:14:41.8924916Z","level":"INFO","fields":{"message":"Received node message (length: 308): {\"type\":\"job_result\",\"job_id\":\"job-188455CD\",\"attempt_id\":1,\"node_id\":\"node-A194D0A5\",\"session_id\":\"s-75EC2635\",\"utterance_index\":0,\"success\":false,\"processing_time_ms\":2051,\"error\":{\"code\":\"PROCESSING_ERROR\",\"message\":\"Request failed with status code 404\"},\"trace_id\":\"16b50646-f6d9-4619-a33c-d8ff5f226c2b\"}"}}

{"timestamp":"2025-12-24T09:14:44.3288435Z","level":"ERROR","fields":{"message":"Job processing failed","trace_id":"16b50646-f6d9-4619-a33c-d8ff5f226c2b","job_id":"job-188455CD","session_id":"s-75EC2635"}}
```

**结论**: 节点端向调度服务器报告404错误，但服务端实际成功处理了请求。

---

## 可能原因

### 1. 节点端HTTP客户端配置问题 ⚠️ **最可能**

**问题**：
- 节点端在发送请求到`faster_whisper_vad`服务时，可能使用了错误的URL
- 或者HTTP客户端的基础URL配置不正确

**证据**：
- 服务端日志显示请求成功到达并处理
- 但节点端报告404错误

**检查点**：
- `task-router.ts`中的`httpClient`配置
- `baseURL`是否正确设置为`http://127.0.0.1:6007`
- 端点路径是否正确为`/utterance`

### 2. 服务端点选择问题

**问题**：
- 节点端在路由任务时，可能选择了错误的服务端点
- 或者服务端点列表未正确刷新

**检查点**：
- `TaskRouter.refreshServiceEndpoints()`是否正确调用
- `selectServiceEndpoint()`是否正确选择`faster-whisper-vad`服务

### 3. 时序问题

**问题**：
- 节点端在服务完全启动之前尝试发送请求
- 或者服务在请求发送时暂时不可用

**证据**：
- 服务端日志显示请求成功处理
- 但节点端可能在请求发送时检测到服务不可用

---

## 已检查的配置

### 1. 服务端路由配置 ✅

```python
@app.post("/utterance", response_model=UtteranceResponse)
def process_utterance(req: UtteranceRequest):
    # 端点正确定义
```

### 2. 节点端路由配置 ✅

```typescript
// task-router.ts
const httpClient: AxiosInstance = axios.create({
  baseURL: endpoint.baseUrl,  // http://127.0.0.1:6007
  timeout: 60000,
});

response = await httpClient.post('/utterance', requestBody, {
  signal: abortController.signal,
});
```

### 3. 端口配置 ✅

```typescript
// task-router.ts
const portMap: Record<string, number> = {
  'faster-whisper-vad': 6007,
  // ...
};
```

---

## 下一步调查

1. **检查节点端日志**：
   - 查看节点端是否有HTTP请求失败的详细日志
   - 确认HTTP客户端发送的完整URL

2. **检查服务端点刷新**：
   - 确认`TaskRouter.refreshServiceEndpoints()`是否正确调用
   - 确认服务端点列表是否包含`faster-whisper-vad`

3. **检查HTTP客户端错误处理**：
   - 查看节点端如何处理HTTP 404错误
   - 确认错误消息的来源

4. **添加详细日志**：
   - 在节点端HTTP客户端添加请求URL日志
   - 在服务端添加请求接收日志

---

## 临时解决方案

如果问题持续存在，可以考虑：

1. **重启节点端**：确保服务端点列表正确刷新
2. **检查服务状态**：确认`faster-whisper-vad`服务在节点端显示为`running`
3. **手动测试**：使用curl或Postman直接测试`http://127.0.0.1:6007/utterance`端点

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts`
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`
- `electron_node/electron-node/main/src/utils/python-service-config.ts`



---

## NODE_CLIENT_404_INVESTIGATION.md

# 节点端404错误调查总结

**日期**: 2025-12-24  
**问题**: 节点端报告404错误，但服务端成功处理请求  
**状态**: ✅ **已添加详细日志**

---

## 已实施的改进

### 1. 增强的错误日志记录

在`task-router.ts`中添加了详细的错误日志：

```typescript
// 在faster-whisper-vad请求中添加详细日志
logger.info({
  serviceId: endpoint.serviceId,
  baseUrl: endpoint.baseUrl,
  requestUrl: `${endpoint.baseUrl}/utterance`,
  audioFormat,
  jobId: task.job_id,
}, 'Routing ASR task to faster-whisper-vad');

// 成功日志
logger.info({
  serviceId: endpoint.serviceId,
  requestUrl,
  status: response.status,
  jobId: task.job_id,
}, 'faster-whisper-vad request succeeded');

// 失败日志（包含Axios错误详情）
logger.error({
  serviceId: endpoint.serviceId,
  requestUrl,
  baseUrl: endpoint.baseUrl,
  status: axiosError.response?.status,
  statusText: axiosError.response?.statusText,
  errorMessage: axiosError.message,
  errorCode: axiosError.code,
  jobId: task.job_id,
  responseData: axiosError.response?.data,
}, 'faster-whisper-vad request failed');
```

### 2. 增强的错误处理

在错误捕获中添加了详细的错误信息：

```typescript
catch (error: any) {
  const errorDetails: any = {
    serviceId: endpoint.serviceId,
    baseUrl: endpoint.baseUrl,
    jobId: task.job_id,
    errorMessage: error.message,
  };
  
  if (error.response) {
    // Axios错误响应
    errorDetails.status = error.response.status;
    errorDetails.statusText = error.response.statusText;
    errorDetails.responseData = error.response.data;
    errorDetails.requestUrl = error.config?.url || 'unknown';
    errorDetails.requestMethod = error.config?.method || 'unknown';
  } else if (error.request) {
    // 请求已发送但没有收到响应
    errorDetails.requestError = true;
    errorDetails.requestUrl = error.config?.url || 'unknown';
  } else {
    // 其他错误
    errorDetails.errorCode = error.code;
    errorDetails.errorStack = error.stack;
  }
  
  logger.error(errorDetails, 'ASR task failed');
  throw error;
}
```

### 3. 服务端点选择日志

在`selectServiceEndpoint`中添加了调试日志：

```typescript
logger.debug({
  serviceType,
  availableEndpoints: runningEndpoints.map(e => ({ 
    serviceId: e.serviceId, 
    baseUrl: e.baseUrl 
  })),
}, 'Selecting service endpoint');
```

---

## 下一步操作

1. **重新编译节点端**：
   ```bash
   cd electron_node/electron-node
   npm run build
   ```

2. **重启节点端**：
   - 确保新的日志代码生效

3. **重新测试**：
   - 发送测试请求
   - 查看节点端日志中的详细信息

4. **分析日志**：
   - 检查`requestUrl`是否正确
   - 检查`baseUrl`是否正确
   - 检查HTTP状态码和错误详情
   - 检查服务端点选择逻辑

---

## 预期日志输出

### 成功请求
```
[INFO] Routing ASR task to faster-whisper-vad: {
  serviceId: 'faster-whisper-vad',
  baseUrl: 'http://127.0.0.1:6007',