# 404/400错误分析报告

**日期**: 2025-12-24  
**问题**: 调度服务器报告404错误，服务端报告400错误  
**状态**: 🔍 **问题已定位，需要修复**

---

## 错误现象

### 调度服务器日志
```
job-62962106: 第一次返回404错误，第二次返回400错误
job-249A0BF0: 返回400错误
job-FDC19742: 返回400错误
```

### 服务端日志

#### 第一个请求（job-62962106）- 成功 ✅
```
[INFO] Detected Opus packet format: packet_len=73, total_bytes=8352
[INFO] Using Plan A: Opus packet decoding pipeline
[INFO] Successfully decoded Opus packets: 3840 samples at 16000Hz
[INFO] POST /utterance HTTP/1.1" 200 OK
```

#### 第一个请求（job-62962106）- 第二次请求（同一个job_id）- 失败 ❌
```
[WARN] Opus data is not in packet format
[ERROR] Failed to decode Opus audio (continuous byte stream method)
[INFO] POST /utterance HTTP/1.1" 400 Bad Request
```

#### 后续请求 - 失败 ❌
```
job-249A0BF0: Opus data is not in packet format → 400错误
job-FDC19742: Opus data is not in packet format → 400错误
```

---

## 问题分析

### 1. 数据格式不一致

**现象**：
- 第一个请求的数据格式正确（packet格式）
- 后续请求的数据格式不正确（非packet格式）

**可能原因**：
1. **Web端发送逻辑问题**：第一次发送时使用了`encodePackets()`，后续发送时可能使用了`encode()`方法
2. **数据在传输过程中被修改**：调度服务器或节点端在转发数据时可能修改了数据格式
3. **Base64编码/解码问题**：Base64编码/解码可能导致数据格式变化

### 2. 404错误的原因

**现象**：
- 服务端返回200 OK
- 但调度服务器报告404错误

**可能原因**：
1. **节点端返回结果给调度服务器时出错**：节点端成功处理请求，但在返回结果时出现问题
2. **调度服务器等待超时**：节点端处理时间过长，调度服务器在等待结果时超时
3. **HTTP请求路径错误**：节点端在返回结果时使用了错误的URL

---

## 解决方案

### 方案1: 修复Web端发送逻辑（优先）

**问题**：Web端可能在某些情况下没有使用`encodePackets()`方法

**检查点**：
1. 确认`sendUtterance()`方法始终使用`encodePackets()`
2. 确认`encodePackets()`方法在所有情况下都可用
3. 添加日志记录每次发送时使用的编码方法

**修复建议**：
```typescript
// 在 sendUtterance() 中添加日志
if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
  console.log('Using encodePackets() for Plan A format');
  opusPackets = await encoder.encodePackets(audioData);
} else {
  console.error('encodePackets() not available, falling back to encode()');
  // 应该抛出错误，而不是回退
  throw new Error('Opus encoder does not support encodePackets. Plan A format requires encodePackets().');
}
```

### 方案2: 增强数据格式检测

**问题**：当前的数据格式检测可能不够严格

**修复建议**：
1. 在服务端添加更严格的数据格式验证
2. 如果检测到非packet格式，直接返回明确的错误信息，而不是尝试连续字节流解码
3. 添加数据格式的详细日志

### 方案3: 修复节点端返回结果逻辑

**问题**：节点端可能没有正确返回结果给调度服务器

**检查点**：
1. 检查节点端的`task-router.ts`中的错误处理逻辑
2. 确认节点端在成功处理请求后正确返回结果
3. 添加日志记录节点端返回结果的过程

---

## 立即行动

### 1. 检查Web端发送逻辑

**文件**: `webapp/web-client/src/websocket_client.ts`

**检查**：
- `sendUtterance()`方法是否始终使用`encodePackets()`
- 是否有回退逻辑导致使用`encode()`方法
- 添加日志记录每次发送时使用的编码方法

### 2. 增强服务端日志

**文件**: `electron_node/services/faster_whisper_vad/audio_decoder.py`

**添加**：
- 记录接收到的数据的前几个字节（用于调试）
- 记录数据格式检测的详细过程
- 记录Base64解码后的数据大小

### 3. 检查节点端返回结果逻辑

**文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**检查**：
- 确认在成功处理请求后正确返回结果
- 添加日志记录返回结果的过程
- 检查错误处理逻辑

---

## 调试步骤

### 步骤1: 检查Web端日志

在浏览器控制台中查看：
- 每次发送utterance时使用的编码方法
- 发送的数据大小和格式

### 步骤2: 检查服务端日志

查看`faster-whisper-vad-service.log`：
- 每次请求的数据格式检测结果
- 接收到的数据的前几个字节（用于验证格式）

### 步骤3: 检查节点端日志

查看节点端的控制台输出：
- 服务端点刷新日志
- HTTP请求和响应日志
- 错误处理日志

---

## 预期修复后的行为

1. **所有请求都使用packet格式**：Web端始终使用`encodePackets()`方法
2. **服务端正确检测格式**：所有请求都能检测到packet格式
3. **节点端正确返回结果**：节点端在成功处理请求后正确返回结果给调度服务器
4. **调度服务器不再报告404错误**：所有请求都能正确完成

---

## 相关文件

- `webapp/web-client/src/websocket_client.ts` - Web端发送逻辑
- `electron_node/services/faster_whisper_vad/audio_decoder.py` - 服务端解码逻辑
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 节点端路由逻辑
- `central_server/scheduler/src/websocket/session_message_handler/utterance.rs` - 调度服务器处理逻辑

