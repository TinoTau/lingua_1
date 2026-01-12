# 超时问题澄清说明

**日期**: 2025-12-25  
**状态**: ✅ **问题已澄清**

---

## 用户误解

**误解**: "Web端由于过滤机制过于严格，并没有发送请求，导致调度服务器主动断开连接"

**实际情况**: ❌ **不是这样的**

---

## 实际情况分析

### 1. Web端确实发送了请求 ✅

**证据**:
- ASR服务端日志显示收到了多个请求：
  - `job-A46AD500`: Received utterance request
  - `job-B132ABD8`: Received utterance request
  - `job-209EAC28`: Received utterance request
  - `job-9202BC86`: Received utterance request

**结论**: Web端正常发送了请求，不是过滤机制阻止了发送。

### 2. ASR服务端返回了空响应 ⚠️

**原因**: 音频质量检查过滤了所有请求

**日志**:
```
Audio quality too poor, skipping ASR and returning empty response
issues=duration too short (0.240s < 0.3s), RMS too low, std too low
```

**结果**: 所有请求都返回空文本（`text=""`）

### 3. 节点端正确处理了空响应 ✅

**日志**:
```
"ASR result is empty, skipping NMT and TTS" ✅
"Job processing completed successfully" ✅
"Sending job_result to scheduler" ✅
"Job result sent successfully" ✅
```

**结果**: 节点端发送了job_result给调度服务器（包含空文本）

### 4. Web端没有收到返回结果 ❌

**问题**: Web端没有收到job_result消息

**可能原因**:
1. 调度服务器没有转发job_result给Web端
2. Web端没有正确处理job_result消息
3. 消息格式不匹配

---

## Session idle timeout 的真正原因

**不是**: Web端没有发送请求

**实际是**:
1. Web端发送了请求 ✅
2. 收到了空响应（或没有收到响应）❌
3. Web端可能认为服务有问题，停止了发送新请求
4. 66秒内没有新请求，调度服务器认为会话空闲
5. 调度服务器主动断开连接

---

## Job pending timeout 的真正原因

**问题**: `job-966BC189` 超时，`node_id=None`

**原因**:
- 节点端日志中**没有** `job-966BC189` 的任何记录
- 说明节点端**没有收到**这个job_assign消息
- 调度服务器等待10秒后超时

**可能原因**:
1. WebSocket连接在发送该消息时断开
2. 消息在传输过程中丢失
3. 节点端消息处理逻辑有问题（但其他job正常）

---

## 问题流程总结

### 正常流程（其他job）

```
Web端 → 发送请求 → 调度服务器 → 节点端 → ASR服务
                                                      ↓
Web端 ← 返回结果 ← 调度服务器 ← 节点端 ← 空响应（被过滤）
```

### 问题流程（job-966BC189）

```
Web端 → 发送请求 → 调度服务器 → [消息丢失/连接断开]
                                                      ↓
调度服务器等待10秒 → 超时 → node_id=None
```

### Session idle timeout 流程

```
Web端发送请求 → 收到空响应（或没收到） → 停止发送新请求
                                                      ↓
66秒内没有新请求 → 调度服务器认为会话空闲 → 断开连接
```

---

## 修复优先级

### 高优先级（立即修复）

1. ✅ **调整音频质量检查阈值** - 已修复
   - 允许0.24秒的音频通过
   - 降低RMS、std、dynamic_range阈值

2. ⚠️ **检查Web端消息处理**
   - 验证Web端是否正确处理job_result消息
   - 检查消息格式是否匹配

### 中优先级（尽快修复）

3. ⚠️ **增强节点端日志**
   - 记录所有收到的job_assign消息
   - 记录WebSocket连接状态

4. ⚠️ **检查调度服务器消息转发**
   - 验证调度服务器是否正确转发job_result给Web端

---

## 澄清总结

**❌ 错误理解**: Web端没有发送请求

**✅ 实际情况**:
1. Web端**正常发送了请求**
2. ASR服务端**返回了空响应**（被音频质量检查过滤）
3. 节点端**正确处理了空响应**，发送了job_result
4. Web端**没有收到结果**（可能是调度服务器没有转发）
5. Web端**停止了发送新请求**（因为没有收到结果）
6. 调度服务器**检测到会话空闲**，主动断开连接

**根本问题**:
- 音频质量检查阈值太严格（已修复）
- Web端没有收到job_result消息（需要检查调度服务器和Web端）

---

**澄清完成时间**: 2025-12-25  
**状态**: ✅ **问题已澄清，不是Web端没有发送请求**

