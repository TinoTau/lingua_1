# 404错误分析报告

**日期**: 2025-12-24  
**问题**: job-556E716C返回404错误，但服务端返回200 OK  
**状态**: 🔍 **问题已定位**

---

## 错误现象

### 调度服务器日志

```
{"timestamp":"2025-12-24T15:12:23.7117437Z","level":"INFO","fields":{"message":"Received node message (length: 308): {\"type\":\"job_result\",\"job_id\":\"job-556E716C\",\"attempt_id\":1,\"node_id\":\"node-6D149F8E\",\"session_id\":\"s-BAFEA97F\",\"utterance_index\":1,\"success\":false,\"processing_time_ms\":1243,\"error\":{\"code\":\"PROCESSING_ERROR\",\"message\":\"Request failed with status code 404\"},\"trace_id\":\"dff4fb04-7c98-4b61-a983-faa35f6f9842\"}"}
```

**关键信息**:
- job_id: `job-556E716C`
- 错误: `Request failed with status code 404`
- 处理时间: 1243ms

### 服务端日志

```
2025-12-24T15:12:21.590Z [INFO] INFO:__main__:[job-556E716C] Received utterance request: job_id=job-556E716C, audio_format=opus, sample_rate=16000
2025-12-24T15:12:21.590Z [INFO] INFO:audio_decoder:[job-556E716C] Detected Opus packet format (Plan A): packet_len=47, total_bytes=8978
2025-12-24T15:12:21.628Z [INFO] INFO:audio_decoder:[job-556E716C] Successfully decoded Opus packets: 3840 samples at 16000Hz
2025-12-24T15:12:22.790Z [INFO] INFO:     127.0.0.1:64175 - "POST /utterance HTTP/1.1" 200 OK
```

**关键信息**:
- 服务端成功接收请求
- 成功检测到packet格式
- 成功解码
- **返回200 OK** ✅

---

## 问题分析

### 矛盾点

1. **服务端返回200 OK**，但**节点端报告404错误**
2. 这说明问题出在**节点端和服务端之间的通信**，而不是服务端处理

### 可能的原因

1. **节点端请求URL错误**：
   - 节点端可能请求了错误的端点
   - 例如：`/utterance` vs `/utterances` vs `/api/utterance`

2. **节点端处理响应时出错**：
   - 服务端返回200 OK，但响应体格式不正确
   - 节点端解析响应时出错，误报404

3. **HTTP客户端配置问题**：
   - Axios配置错误
   - baseURL设置不正确
   - 请求路径拼接错误

---

## 需要检查

### 1. 节点端task-router代码

**文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**检查点**:
- `routeASRTask()`方法中的URL构建
- `httpClient.post()`的URL参数
- baseURL和requestUrl的拼接

### 2. 节点端日志

**需要查看**:
- 节点端的HTTP请求日志
- 请求的完整URL
- 响应的状态码和内容

### 3. 服务端端点定义

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**检查点**:
- `/utterance`端点的定义
- FastAPI路由配置

---

## 下一步行动

1. **检查节点端task-router代码**，确认URL构建逻辑
2. **查看节点端日志**，确认实际请求的URL
3. **检查服务端端点定义**，确认端点路径
4. **对比URL**，找出不匹配的地方

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 节点端路由逻辑
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 服务端端点定义
- `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log` - 服务端日志
- `central_server/scheduler/logs/scheduler.log` - 调度服务器日志

