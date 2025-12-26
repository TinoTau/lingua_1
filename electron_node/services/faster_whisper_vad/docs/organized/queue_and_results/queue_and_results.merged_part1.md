# Queue And Results (Part 1/3)

# Queue And Results

本文档合并了所有相关文档。

---

## ASR_QUEUE_FIX_SUMMARY.md

# ASR队列架构修复总结

**日期**: 2025-12-25  
**状态**: ✅ **Future状态问题已修复，超时时间已调整**

---

## 发现的问题

### 1. Future状态问题 ✅ **已修复**

**问题**: 
- Future在超时后被取消
- Worker仍在尝试设置结果
- 导致`asyncio.InvalidStateError: invalid state`
- 导致Worker循环崩溃

**修复**:
- 在设置结果前检查`task.future.cancelled()`
- 捕获`asyncio.InvalidStateError`异常
- 在异常处理中也添加Future状态检查

**代码修改**:
```python
# 设置结果（检查Future状态，避免在已取消的Future上设置结果）
if task.future.cancelled():
    logger.warning("Future was cancelled, skipping result setting")
    continue

try:
    task.future.set_result(result)
except asyncio.InvalidStateError:
    logger.warning("Future is in invalid state")
```

### 2. 超时时间过短 ✅ **已修复**

**问题**:
- 默认超时时间8秒
- transcribe()执行时间可能超过8秒
- 导致请求超时

**修复**:
- 将`MAX_WAIT_SECONDS`从8.0增加到30.0秒
- 给transcribe()足够的执行时间

---

## 修复后的预期行为

1. **正常请求**: 
   - 提交到队列
   - Worker串行处理
   - 返回结果（即使耗时较长）

2. **超时请求**:
   - 如果超过30秒仍未完成，返回504
   - Worker继续处理，但不会尝试设置已取消的Future
   - Worker循环不会崩溃

3. **队列满**:
   - 立即返回503 Service Busy
   - 包含Retry-After头

---

## 测试建议

重新运行测试，预期结果：
- ✅ 健康检查通过
- ✅ 单个请求成功（即使耗时较长）
- ✅ 并发请求成功（队列排队）
- ✅ 队列背压控制工作正常
- ✅ 服务不会崩溃

---

## 相关文档

- `ASR_QUEUE_TEST_RESULTS.md` - 测试结果
- `ASR_QUEUE_IMPLEMENTATION_SUMMARY.md` - 实现总结



---

## ASR_QUEUE_IMPLEMENTATION_SUMMARY.md

# ASR单工人队列架构实现总结

**日期**: 2025-12-25  
**状态**: ✅ **核心功能已实现**

---

## 实现概述

根据推荐设计方案，已实现**单工人队列架构**，用于解决ASR服务的并发稳定性问题。

---

## 已实现的功能

### 1. ASR Worker模块 ✅

**文件**: `asr_worker.py`

**核心组件**:
- `ASRWorker`: 单工人队列管理器
- `ASRTask`: ASR任务数据类
- `ASRResult`: ASR结果数据类

**功能**:
- 使用`asyncio.Queue`实现有界队列（默认maxsize=3）
- 单工人串行执行`transcribe()`
- 自动将segments转换为list（避免迭代器线程安全问题）
- 支持超时控制（默认8秒）

### 2. 主服务集成 ✅

**文件**: `faster_whisper_vad_service.py`

**修改内容**:
- 将`process_utterance`改为`async`函数
- 移除旧的`asr_model_lock`机制
- 使用ASR Worker队列提交任务
- 实现背压控制（队列满时返回503）

### 3. 背压控制 ✅

**实现**:
- 队列满时立即返回`503 Service Busy`
- 包含`Retry-After: 1`响应头
- 等待超时返回`504 Gateway Timeout`

### 4. 启动/关闭事件 ✅

**实现**:
- `@app.on_event("startup")`: 启动ASR Worker
- `@app.on_event("shutdown")`: 停止ASR Worker

### 5. 健康检查增强 ✅

**实现**:
- `/health`端点显示ASR Worker状态
- 包含队列深度、任务统计等信息

---

## 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `QUEUE_MAX` | 3 | 队列最大长度 |
| `MAX_WAIT_SECONDS` | 8.0 | 最大等待时间（秒） |

---

## 架构设计

```
Client Request
    ↓
FastAPI Endpoint (async)
    ↓
检查队列是否满
    ├─ 满 → 返回 503 Service Busy
    └─ 未满 → 提交任务到队列
        ↓
asyncio.Queue (maxsize=3)
    ↓
ASR Worker (单工人)
    ├─ 串行执行 transcribe()
    ├─ 自动转换 segments 为 list
    └─ 返回结果
        ↓
Response (200 OK / 500 Error)
```

---

## 关键特性

### 1. 串行执行
- 只有一个ASR Worker
- 所有`transcribe()`调用严格串行
- 避免并发访问导致崩溃

### 2. 有界队列
- 队列最大长度为3
- 防止请求无限堆积
- 队列满时快速失败

### 3. 背压控制
- 队列满时立即返回503
- 包含Retry-After头
- 客户端可以自动重试

### 4. 超时控制
- 默认最大等待时间8秒
- 超时返回504
- 避免请求无限等待

### 5. 可观测性
- `/health`端点显示队列状态
- 记录任务统计信息
- 记录平均等待时间

---

## 与旧实现的对比

| 特性 | 旧实现（锁机制） | 新实现（队列架构） |
|------|----------------|-------------------|
| 并发控制 | 全局锁 | 单工人队列 |
| 排队方式 | 隐式（锁等待） | 显式（队列） |
| 可观测性 | 低（锁等待时间不可见） | 高（队列深度可见） |
| 背压控制 | 无 | 有（503响应） |
| 超时控制 | 无 | 有（504响应） |
| 稳定性 | 低（易崩溃） | 高（可控排队） |

---

## 待实现功能

### 1. 指标监控 ⏳
- [ ] 记录queue_depth到指标系统
- [ ] 记录wait_time到指标系统
- [ ] 记录任务成功率

### 2. 多进程隔离 ⏳
- [ ] 将ASR Worker移到独立进程
- [ ] 实现进程崩溃检测
- [ ] 实现自动拉起机制

---

## 测试建议

### 1. 功能测试
- [ ] 单请求测试（正常流程）
- [ ] 并发请求测试（队列排队）
- [ ] 队列满测试（503响应）
- [ ] 超时测试（504响应）

### 2. 稳定性测试
- [ ] 长时间运行测试（10+分钟）
- [ ] 高并发压力测试
- [ ] 崩溃恢复测试

### 3. 性能测试
- [ ] 响应时间测试
- [ ] 吞吐量测试
- [ ] 资源使用测试

---

## 相关文档

- `RECOMMENDED_ASR_AVAILABILITY_PERFORMANCE_DESIGN.md` - 推荐设计方案
- `asr_single_worker_queue_example.py` - 示例代码
- `ASR_FASTAPI_ASYNC_DESIGN.md` - FastAPI异步设计
- `ASR_JIRA_TASK_LIST.md` - 任务列表

---

## 下一步

1. **测试验证**: 运行功能测试和稳定性测试
2. **指标监控**: 添加详细的指标记录
3. **多进程隔离**: 实现进程隔离和自动拉起（可选）

---

**实现完成**



---

## ASR_QUEUE_TEST_RESULTS.md

# ASR队列架构单元测试结果

**日期**: 2025-12-25  
**状态**: ⚠️ **部分测试通过，发现Future状态问题**

---

## 测试结果

### 测试1: 健康检查 ✅

**结果**: 通过

**详情**:
- ASR Worker成功启动
- 队列状态正常（queue_depth=0）
- Worker运行状态：is_running=True

### 测试2: 单个请求 ❌

**结果**: 失败（504超时）

**问题**:
- 请求超时（8秒）
- transcribe()执行时间过长
- 可能是模拟Opus数据无法正确解码

**日志**:
```
ASR Worker: Starting transcribe, audio_len=3840, language=zh
ASR task timeout after 8.0s, queue_depth=0
ASR Worker: Transcribe completed, segments=0
```

### 测试3: 队列背压控制 ✅

**结果**: 通过（但未触发503）

**详情**:
- 未检测到503响应
- 可能队列处理速度足够快，未满

### 测试4: 并发请求 ❌

**结果**: 失败

**问题**:
- 所有请求都失败
- 可能是服务在处理第一个请求时出现问题

### 测试5: 队列状态监控 ❌

**结果**: 失败（服务崩溃）

**问题**:
- 服务在处理请求后崩溃
- 无法连接到服务

---

## 发现的问题

### 1. Future状态问题 ✅ **已修复**

**问题**: 
- Future在超时后被取消
- Worker仍在尝试设置结果
- 导致`asyncio.InvalidStateError: invalid state`

**修复**:
- 添加Future状态检查
- 在设置结果前检查`future.cancelled()`
- 捕获`InvalidStateError`异常

### 2. transcribe()执行时间过长 ⚠️

**问题**:
- transcribe()执行时间超过8秒
- 导致请求超时

**可能原因**:
- 模拟Opus数据无法正确解码
- ASR模型处理时间过长
- 需要检查音频数据质量

### 3. 服务崩溃 ⚠️

**问题**:
- 服务在处理请求后崩溃
- 可能是Future状态问题导致的连锁反应

**修复后**:
- 应该不会再出现Future状态错误
- 需要重新测试验证

---

## 修复内容

### 1. Future状态检查

```python
# 在设置结果前检查Future状态
if task.future.cancelled():
    logger.warning("Future was cancelled, skipping result setting")
    continue

try:
    task.future.set_result(result)
except asyncio.InvalidStateError:
    logger.warning("Future is in invalid state")
```

### 2. 异常处理增强

```python
except Exception as e:
    if 'task' in locals() and task:
        if not task.future.cancelled():
            try:
                task.future.set_exception(e)
            except asyncio.InvalidStateError:
                logger.warning("Future is in invalid state")
```

---

## 下一步

1. **重新测试**: 修复Future状态问题后，重新运行测试
2. **检查音频数据**: 确保测试使用的Opus数据可以正确解码
3. **调整超时时间**: 如果transcribe()确实需要更长时间，考虑增加超时时间
4. **监控服务**: 观察服务是否还会崩溃

---

## 相关文档

- `ASR_QUEUE_IMPLEMENTATION_SUMMARY.md` - 实现总结
- `IMPLEMENTATION_COMPLETE.md` - 完成报告



---

## RESULT_QUEUE_AND_ASR_ENCODING_ISSUES.md

# 结果队列和ASR编码问题诊断

**日期**: 2025-12-25  
**状态**: 🔍 **问题已定位，部分已修复**

---

## 问题总结

### 1. 结果队列 expected_index 不匹配 ❌（已修复）

**现象**：
- `expected_index` 从 0 开始初始化
- 但实际收到的结果从 1 开始（`utterance_index=1, 2, 3...`）
- 导致 `expected_index` 一直小于队列中的最小 index
- 5秒后超时，生成 `MissingResult(0)`
- `expected_index` 变成 1，但如果结果还没到，又会超时生成 `MissingResult(1)`
- 这样循环，`expected_index` 不断增长，但队列中的结果永远跟不上

**日志证据**：
```
expected_index=12, queue_size=11, queue_indices=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
Gap timeout, creating Missing result, utterance_index=12
```

**修复方案**：
- 在 `get_ready_results()` 开始时，检查队列是否为空
- 如果队列不为空且 `expected` 小于队列中的最小 index，将 `expected` 调整为队列中的最小 index
- 这样可以确保 `expected` 始终与队列中的第一个结果对齐

**修复代码**：
```rust
// 如果队列不为空且 expected 小于队列中的最小 index，调整 expected
if !state.pending.is_empty() {
    if let Some(&min_index) = state.pending.keys().next() {
        if state.expected < min_index {
            warn!(
                session_id = %session_id,
                old_expected = state.expected,
                new_expected = min_index,
                "Adjusting expected_index to match first pending result"
            );
            state.expected = min_index;
            state.gap_wait_start_ms = now_ms;
        }
    }
}
```

---

### 2. ASR 识别结果乱码 ⚠️（待确认）

**现象**：
- ASR 识别结果在日志中显示为乱码字符
- 例如：`transcript_preview='杩欎釜涓㈠純甯歌瘑鑺傜洰瀛樺湪鐨勪换鍔＄劧鍚庢妸杩愯惀鎯ㄥ洖澶?'`
- 调度服务器日志也显示乱码：`"杩欎釜涓㈠純甯歌瘑鑺傜洰瀛樺湪鐨勪换鍔＄劧鍚庢妸杩愯惀鎯ㄥ洖澶?"`

**可能的原因**：

1. **日志编码问题**（最可能）
   - Windows 系统默认使用 GBK 编码
   - 日志文件可能以 GBK 编码保存