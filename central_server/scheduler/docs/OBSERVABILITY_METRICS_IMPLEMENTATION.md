# Observability 指标实现总结

## 日期
2026-01-XX

## ✅ 一、已实现的指标

### 1. reserve_success_rate（reserve 成功率）✅
**指标名称**: `reserve_attempt_total`
- **类型**: Counter（按 result 分类）
- **Labels**: `result` (success|fail|error)
- **记录位置**: `src/phase2/runtime_routing.rs` - `reserve_node_slot`
- **计算方式**: `reserve_success_rate = reserve_attempt_total{result="success"} / reserve_attempt_total`

**实现细节**:
- 成功时调用 `on_reserve_attempt(true)`
- 失败时调用 `on_reserve_attempt(false)`（节点已满、不健康等）
- Redis 错误时调用 `on_reserve_error()`

---

### 2. pool_empty_rate（pool 空率）✅
**指标名称**: `pool_query_total`
- **类型**: Counter（按 result 分类）
- **Labels**: `result` (found|empty)
- **记录位置**: `src/node_registry/selection/selection_phase3.rs` - Pool 查询逻辑
- **计算方式**: `pool_empty_rate = pool_query_total{result="empty"} / pool_query_total`

**实现细节**:
- 找到节点时调用 `on_pool_query(true)`
- Pool 为空时调用 `on_pool_query(false)`

---

### 3. dispatch_latency（派发延迟）✅
**指标名称**: `dispatch_latency_seconds`
- **类型**: Histogram
- **Buckets**: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0]
- **记录位置**: 
  - `src/websocket/session_message_handler/utterance.rs` - 正常派发
  - `src/websocket/session_message_handler/audio.rs` - 音频任务派发
  - `src/timeout/job_timeout.rs` - 超时重派
- **计算方式**: 从 `create_job_assign_message` 开始到 `send_node_message_routed` 完成的耗时

**实现细节**:
- 使用 `std::time::Instant` 记录开始时间
- 派发成功后计算延迟并调用 `observe_dispatch_latency(seconds)`

---

### 4. ack_timeout_rate（ACK 超时率）✅
**指标名称**: `ack_timeout_total`
- **类型**: Counter（按 job_id 前缀分类，限制基数）
- **Labels**: `job_prefix` (job_id 的前8个字符)
- **记录位置**: `src/timeout/job_timeout.rs` - 超时检测逻辑
- **计算方式**: `ack_timeout_rate = ack_timeout_total / (dispatched_jobs_total)`

**实现细节**:
- 检测到 ACK 超时时调用 `on_ack_timeout(job_id)`
- 使用 job_id 前缀限制 label 基数，避免 label 爆炸

---

### 5. node_overload_reject_rate（node 过载拒绝率）✅
**指标名称**: `node_overload_reject_total`
- **类型**: Counter（按 node_id 和 reason 分类）
- **Labels**: `node_id`, `reason` (full|not_ready|other)
- **记录位置**: `src/phase2/runtime_routing.rs` - `reserve_node_slot`
- **计算方式**: `node_overload_reject_rate = node_overload_reject_total / reserve_attempt_total`

**实现细节**:
- `status == 2` (FULL) 时调用 `on_node_overload_reject(node_id, "full")`
- `status == 3` (NOT_READY) 时调用 `on_node_overload_reject(node_id, "not_ready")`
- 其他失败原因调用 `on_node_overload_reject(node_id, "other")`

---

## 📊 二、指标使用示例

### Prometheus 查询示例

```promql
# reserve 成功率
rate(reserve_attempt_total{result="success"}[5m]) / rate(reserve_attempt_total[5m])

# pool 空率
rate(pool_query_total{result="empty"}[5m]) / rate(pool_query_total[5m])

# 派发延迟 P95
histogram_quantile(0.95, rate(dispatch_latency_seconds_bucket[5m]))

# ACK 超时率
rate(ack_timeout_total[5m]) / rate(dispatched_jobs_total[5m])

# 节点过载拒绝率（按节点）
rate(node_overload_reject_total[5m]) / rate(reserve_attempt_total[5m])
```

---

## 📝 三、日志增强

### 关键路径日志

1. **Reserve 操作**:
   - 成功：记录节点 ID、任务 ID、attempt_id
   - 失败：记录失败原因（FULL / NOT_READY / ERROR）

2. **Pool 查询**:
   - 记录 Pool ID、Pool 名称、节点数量、是否为空

3. **派发操作**:
   - 记录派发延迟、任务 ID、节点 ID、trace_id

4. **ACK 超时**:
   - 记录超时时间、任务 ID、节点 ID、已用重试次数

5. **节点过载**:
   - 记录节点 ID、拒绝原因、任务 ID

---

## ✅ 四、完成状态

### 指标实现
- ✅ `reserve_success_rate` - 100% 完成
- ✅ `pool_empty_rate` - 100% 完成
- ✅ `dispatch_latency` - 100% 完成
- ✅ `ack_timeout_rate` - 100% 完成
- ✅ `node_overload_reject_rate` - 100% 完成

### 日志增强
- ✅ Reserve 操作日志
- ✅ Pool 查询日志
- ✅ 派发操作日志
- ✅ ACK 超时日志
- ✅ 节点过载日志

**总体完成度**: **100%**

---

## 📚 五、参考文档

- `SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md` - 设计文档（第3.1节、第11节）
- `REMAINING_FEATURES.md` - 剩余功能清单
