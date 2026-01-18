# 调度服务器优化实现总结

**日期**: 2026-01-16  
**状态**: ✅ **中优先级优化已实现**

---

## 一、已实现的优化

### 1. timeout_node_id TTL调整 ✅

**文件**: `central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs`

**变更**:
- **修改前**: TTL = 30分钟
- **修改后**: TTL = 5分钟

**原因**:
- 符合"Pause ≈ 用户思考超过3秒 → 新句子"的业务逻辑
- 足够保护AudioAggregator的连续性
- 避免Session已结束时仍保留旧的节点affinity
- 减少Redis中累积的session key数量

**影响**:
- 减少Redis内存占用
- 降低节点扩容/缩容后的遗留affinity问题
- 不影响正常的长语音流式处理（5分钟足够保护连续性）

---

### 2. Lua节点选择逻辑中固定化pools和nodes遍历顺序 ✅

**文件**: `central_server/scheduler/scripts/lua/dispatch_task.lua`

**变更**:
- 对pools数组按字符串排序（保证多实例一致性）
- 对nodes数组按字符串排序（保证多实例一致性）

**实现细节**:
```lua
-- 优化：对pools按字符串排序，保证多实例一致性和行为稳定
local pools_str = {}
for i = 1, #pools do
    pools_str[i] = tostring(pools[i])
end
table.sort(pools_str)
pools = {}
for i = 1, #pools_str do
    table.insert(pools, tonumber(pools_str[i]) or pools_str[i])
end

-- 优化：对nodes按字符串排序，保证多实例一致性
table.sort(nodes)
```

**影响**:
- 保证多实例环境下行为一致
- pool结构变化时仍行为稳定
- 不额外引入随机因素
- 便于Debug和问题排查

---

### 3. MinimalScheduler异常分支日志补充 ✅

**文件**: `central_server/scheduler/src/services/minimal_scheduler.rs`

**变更**:
- 在`dispatch_task`方法中添加异常分支日志记录
- 检测AffinityFallback、PoolEmpty、PoolCorrupt三种情况

**实现细节**:
```rust
// 检测AffinityFallback
if let Some(ref expected_node_id) = expected_timeout_node_id {
    if !expected_node_id.is_empty() && expected_node_id != &node_id {
        warn!(
            "[AffinityFallback] timeout_node_id not usable → fallback to other node"
        );
    }
}

// 检测PoolEmpty和PoolCorrupt（在错误处理中）
if err_msg == "NO_POOL_FOR_LANG_PAIR" {
    warn!("[PoolCorrupt] invalid pools_json / Redis record missing");
} else if err_msg == "NO_AVAILABLE_NODE" {
    warn!("[PoolEmpty] no online nodes in pool");
}
```

**影响**:
- 提升可观测性，便于问题排查
- 不改变现有行为，仅增加日志记录
- 帮助识别Session Affinity fallback场景
- 帮助识别pool配置或节点状态问题

---

## 二、优化效果

### 2.1 内存优化
- **Redis session key数量减少**: TTL从30分钟降低到5分钟，减少约83%的过期key数量
- **内存占用降低**: 特别是在高并发场景下，效果明显

### 2.2 行为一致性
- **多实例一致性**: pools和nodes排序确保多实例环境下的行为一致
- **可预测性**: 排序后的遍历顺序稳定，便于Debug

### 2.3 可观测性提升
- **AffinityFallback日志**: 帮助识别Session Affinity无法使用的情况
- **PoolEmpty日志**: 帮助识别pool配置问题
- **PoolCorrupt日志**: 帮助识别Redis数据损坏问题

---

## 三、未实现的优化（可选）

以下优化项优先级较低，可根据实际需求选择性实现：

### 3.1 节点选择策略优化（轮询/随机/最少任务）

**当前状态**: 使用"第一个在线节点"，不是真正的随机分配

**可选方案**:
- 轮询（Round-robin）
- 真正随机选择
- 最少任务优先（Least Tasks）

**优先级**: 中

---

### 3.2 元数据增强（sequence_id）

**建议**: 在Job内增加`sequence_id`字段，用于排序和日志追踪

**优先级**: 低（可选）

---

### 3.3 跨实例路由追踪（instance_id）

**建议**: 在JobAssign消息中记录`dispatch_instance_id`和`deliver_instance_id`

**优先级**: 低（可追踪性增强）

---

## 四、文件清单

### 修改文件
1. ✅ `central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs` - TTL调整
2. ✅ `central_server/scheduler/scripts/lua/dispatch_task.lua` - pools和nodes排序
3. ✅ `central_server/scheduler/src/services/minimal_scheduler.rs` - 异常分支日志

---

## 五、测试建议

1. **测试TTL优化**：
   - 记录timeout_node_id后，等待5分钟
   - 验证映射是否自动过期（应该过期）

2. **测试排序优化**：
   - 在多个调度服务器实例环境下测试
   - 验证相同session的job是否选择相同的节点（在fallback场景下）

3. **测试日志记录**：
   - 模拟timeout_node_id节点离线场景，验证AffinityFallback日志
   - 模拟pool为空场景，验证PoolEmpty日志
   - 模拟pool配置损坏场景，验证PoolCorrupt日志

---

**审核状态**: ✅ **中优先级优化已实现，等待测试**
