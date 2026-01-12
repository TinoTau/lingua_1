# 调度服务器超时错误分析

**日期**: 2025-12-24  
**问题**: 调度服务器出现ERROR，任务超时  
**相关Job**: `job-F2803265`, `job-8E68394C`, `job-B6BD3FB8`, `job-05980598`

---

## 错误现象

### 1. 连接重置错误 (ECONNRESET)

**Job**: `job-F2803265`
```
"error":{"code":"PROCESSING_ERROR","message":"read ECONNRESET"}
"processing_time_ms":4313
```

**分析**：
- 节点端在处理Opus请求时连接被重置
- 这很可能是因为`faster_whisper_vad`服务在处理Opus解码时崩溃
- 与之前发现的Opus解码崩溃问题一致

### 2. 404错误

**Jobs**: `job-8E68394C`, `job-B6BD3FB8`, `job-05980598`
```
"error":{"code":"PROCESSING_ERROR","message":"Request failed with status code 404"}
```

**分析**：
- 节点端无法找到对应的服务端点
- 可能原因：
  1. `faster_whisper_vad`服务已崩溃，无法响应请求
  2. 服务端点路径不正确
  3. 服务未正确启动

### 3. 无可用ASR服务

```
"error":{"code":"PROCESSING_ERROR","message":"No available ASR service"}
```

**分析**：
- 节点端检测到没有可用的ASR服务
- 这可能是因为`faster_whisper_vad`服务崩溃后，节点端将其标记为不可用

### 4. Job Pending超时

```
"Job pending 超时，标记失败"
"pending_timeout_seconds":10
```

**分析**：
- 任务在10秒内没有被成功派发到节点
- 可能原因：
  1. 节点端服务不可用
  2. 节点端资源不足
  3. 节点端服务崩溃

### 5. Result超时

```
"Result timeout, skipping utterance_index"
```

**分析**：
- 结果队列中的结果超时
- 可能原因：
  1. 节点端处理时间过长
  2. 节点端服务崩溃，无法返回结果

---

## 根本原因

**最可能的原因**：`faster_whisper_vad`服务在处理Opus请求时崩溃

**证据**：
1. `job-F2803265`返回`ECONNRESET`，说明连接在处理过程中被重置
2. 后续任务返回404，说明服务已不可用
3. 节点端报告"No available ASR service"
4. 与之前发现的Opus解码崩溃问题一致

---

## 超时配置

从`config.toml`：
- `job_timeout_seconds = 30` - 任务派发后30秒超时
- `pending_timeout_seconds = 10` - 任务pending状态10秒超时

---

## 解决方案

### 1. 立即修复

**已实施**：
- ✅ 增强Opus解码的错误处理
- ✅ 添加数据验证
- ✅ 添加详细日志

**待验证**：
- ⚠️ 重启节点端服务，验证修复是否有效

### 2. 长期改进

1. **进程隔离**：将Opus解码放在独立子进程中，避免崩溃影响主服务
2. **健康检查**：增强节点端对`faster_whisper_vad`服务的健康检查
3. **自动恢复**：节点端检测到服务崩溃后自动重启
4. **超时调整**：根据实际处理时间调整超时配置

---

## 相关日志

- **调度服务器日志**: `central_server/scheduler/logs/scheduler.log`
- **节点端服务日志**: `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log`

---

**状态**: ⚠️ **待验证修复效果**  
**优先级**: 🔴 **高**

