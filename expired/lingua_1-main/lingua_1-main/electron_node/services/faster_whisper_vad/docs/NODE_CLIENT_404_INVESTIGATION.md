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

### 失败请求
```
[ERROR] faster-whisper-vad request failed: {
  serviceId: 'faster-whisper-vad',
  requestUrl: 'http://127.0.0.1:6007/utterance',
  baseUrl: 'http://127.0.0.1:6007',
  status: 404,
  statusText: 'Not Found',
  errorMessage: 'Request failed with status code 404',
  errorCode: undefined,
  jobId: 'job-XXX',
  responseData: { ... }
}
```

---

## 可能的问题原因

基于当前分析，可能的原因包括：

1. **服务端点未正确刷新**：
   - `TaskRouter.refreshServiceEndpoints()`可能未及时调用
   - 服务状态更新延迟

2. **端口配置问题**：
   - 服务实际运行在不同端口
   - 端口映射配置错误

3. **HTTP客户端配置问题**：
   - baseURL配置错误
   - 请求路径拼接错误

4. **时序问题**：
   - 服务在请求发送时暂时不可用
   - 服务重启导致请求失败

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts`
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`
- `electron_node/electron-node/main/src/agent/node-agent.ts`

