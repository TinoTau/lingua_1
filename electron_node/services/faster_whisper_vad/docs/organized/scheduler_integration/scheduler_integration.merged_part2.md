# Scheduler Integration (Part 2/2)

3. **自动恢复**：节点端检测到服务崩溃后自动重启
4. **超时调整**：根据实际处理时间调整超时配置

---

## 相关日志

- **调度服务器日志**: `central_server/scheduler/logs/scheduler.log`
- **节点端服务日志**: `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log`

---

**状态**: ⚠️ **待验证修复效果**  
**优先级**: 🔴 **高**



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

