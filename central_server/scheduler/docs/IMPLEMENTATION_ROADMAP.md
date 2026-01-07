# 实现路线图：设计文档对齐

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-07
- **目的**: 详细说明如何将当前实现对齐到 `SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md` 设计文档
- **状态**: 规划阶段

---

## 一、总体目标

将当前调度服务器实现对齐到设计文档，主要完成以下任务：

1. **节点选择策略改为随机**（高优先级）
2. **Reservation 机制统一**（中优先级）
3. **多实例支持增强**（中优先级，可选）

**预估总工作量**：7-11 天（不含测试）

---

## 二、阶段划分

### 阶段 1：节点选择策略改为随机（高优先级）
**工作量**：2-3 天  
**目标**：实现随机采样节点选择，移除 session affinity

### 阶段 2：Reservation 机制统一（中优先级）
**工作量**：3-5 天  
**目标**：统一使用 Redis Lua 实现，实现完整的 COMMIT 机制

### 阶段 3：多实例支持增强（中优先级，可选）
**工作量**：2-3 天  
**目标**：Pool 成员索引和节点并发计数同步到 Redis

---

## 三、详细实施步骤

### 阶段 1：节点选择策略改为随机

#### 步骤 1.1：添加随机采样函数

**目标**：实现从 Pool 成员中随机采样 `k` 个节点的函数

**文件**：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

**任务**：
1. 添加 `random_sample_nodes` 函数
   ```rust
   fn random_sample_nodes(
       candidates: &[String],
       sample_size: usize,
   ) -> Vec<String>
   ```
2. 使用 `rand` crate 实现随机采样
3. 如果候选节点数 <= sample_size，返回全部节点

**依赖**：
- 确认 `Cargo.toml` 中已包含 `rand` crate

**测试**：
- 单元测试：测试采样结果的数量和随机性
- 边界测试：候选节点数 < sample_size 的情况

**验收标准**：
- ✅ 函数能正确采样指定数量的节点
- ✅ 采样结果具有随机性（多次调用结果不同）
- ✅ 边界情况处理正确

---

#### 步骤 1.2：修改节点选择逻辑

**目标**：将 hash-based 选择改为随机采样 + 负载排序

**文件**：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

**任务**：
1. 修改 `select_node_with_types_two_level_excluding_with_breakdown` 函数
2. 在 Pool 选择后，从 Pool 成员中随机采样 `k` 个节点（默认 20）
3. 对采样结果按负载排序（`effective_jobs` 升序）
4. 依次尝试 `try_reserve`，成功即选中
5. 移除或弱化 `routing_key` hash 的影响（保留作为可配置选项）

**代码修改位置**：
```rust
// 当前实现（需要修改）
let preferred_idx = crate::phase3::pick_index_for_key(eligible.len(), cfg.hash_seed, routing_key);
let preferred_pool = eligible[preferred_idx];

// 改为随机采样
let sample_size = 20; // 可配置
let sampled_nodes = random_sample_nodes(&candidate_ids, sample_size);
let sorted_nodes = sort_by_load(sampled_nodes, &nodes, &reserved_counts);
for node_id in sorted_nodes {
    // 尝试 reserve
}
```

**配置项**：
- 添加 `random_sample_size` 配置项（默认 20）
- 添加 `enable_session_affinity` 配置项（默认 false）

**测试**：
- 单元测试：测试随机采样和负载排序
- 集成测试：测试任务分配是否随机
- 性能测试：采样性能影响

**验收标准**：
- ✅ 节点选择具有随机性（同一 session 不固定节点）
- ✅ 负载均衡仍然有效（优先选择负载低的节点）
- ✅ 性能影响可接受（采样开销 < 1ms）

---

#### 步骤 1.3：更新配置结构

**目标**：添加随机采样相关配置项

**文件**：
- `central_server/scheduler/src/core/config/config_types.rs`
- `central_server/scheduler/src/core/config/config_defaults.rs`

**任务**：
1. 在 `Phase3Config` 中添加：
   ```rust
   /// 随机采样节点数量（默认 20）
   #[serde(default = "default_random_sample_size")]
   pub random_sample_size: usize,
   
   /// 是否启用 session affinity（默认 false，随机选择）
   #[serde(default = "default_enable_session_affinity")]
   pub enable_session_affinity: bool,
   ```
2. 添加默认值函数

**测试**：
- 配置加载测试
- 默认值测试

**验收标准**：
- ✅ 配置项能正确加载
- ✅ 默认值符合设计文档要求

---

#### 步骤 1.4：更新文档和日志

**目标**：更新相关文档，添加日志

**文件**：
- `central_server/scheduler/docs/POOL_ARCHITECTURE_AND_TASK_DISPATCH.md`
- `central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

**任务**：
1. 更新文档说明节点选择策略
2. 添加日志记录采样过程和结果
3. 添加指标：`node_selection_random_sample_size`、`node_selection_attempts`

**验收标准**：
- ✅ 文档更新完整
- ✅ 日志清晰可追踪
- ✅ 指标正确上报

---

### 阶段 2：Reservation 机制统一

#### 步骤 2.1：分析当前 Reservation 使用情况

**目标**：确认哪些路径使用内存实现，哪些使用 Redis 实现

**文件**：
- `central_server/scheduler/src/core/dispatcher/job_creation_phase1.rs`
- `central_server/scheduler/src/core/dispatcher/job_creation_phase2.rs`

**任务**：
1. 检查 Phase 1 路径是否使用 `reserve_job_slot`（内存）
2. 检查 Phase 2 路径是否使用 `reserve_node_slot`（Redis）
3. 确认 Phase 2 是否已启用
4. 记录所有使用 Reservation 的地方

**输出**：
- Reservation 使用情况报告
- 需要修改的文件列表

**验收标准**：
- ✅ 清楚了解当前 Reservation 使用情况
- ✅ 确定统一方案（全部使用 Redis 或保留两套）

---

#### 步骤 2.2：实现完整的 COMMIT 机制

**目标**：实现 `reserved -> running` 的 COMMIT 操作

**文件**：
- `central_server/scheduler/src/phase2/redis_handle.rs`
- `central_server/scheduler/src/phase2/runtime_routing.rs`

**任务**：
1. 实现 `commit_reserve` Redis Lua 脚本
   ```lua
   -- 校验 resv_key 是否存在
   -- reserved -= 1
   -- running += 1
   -- 删除 resv_key
   ```
2. 在节点 ACK 时调用 `commit_reserve`
3. 处理 resv_key 过期的情况（ACK 迟到）

**代码位置**：
```rust
pub async fn commit_node_reservation(
    &self,
    node_id: &str,
    resv_id: &str,
) -> bool {
    // 调用 Redis Lua 脚本
}
```

**测试**：
- 单元测试：测试 COMMIT 逻辑
- 集成测试：测试 ACK 流程
- 异常测试：测试 resv_key 过期的情况

**验收标准**：
- ✅ COMMIT 操作原子执行
- ✅ reserved 和 running 计数正确
- ✅ 异常情况处理正确

---

#### 步骤 2.3：实现 RELEASE 机制增强

**目标**：增强 RELEASE 机制，添加下限保护

**文件**：`central_server/scheduler/src/phase2/redis_handle.rs`

**任务**：
1. 修改 `release_node_slot` 的 Redis Lua 脚本
2. 添加 reserved 下限保护（reserved 不能 < 0）
3. 处理 resv_key 不存在的情况（已过期）

**代码修改**：
```lua
-- 如果 resv_key 存在
if redis.call('EXISTS', KEYS[2]) == 1 then
    local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
    if reserved > 0 then
        redis.call('HINCRBY', KEYS[1], 'reserved', -1)
    end
    redis.call('DEL', KEYS[2])
end
```

**测试**：
- 单元测试：测试 RELEASE 逻辑
- 边界测试：测试 reserved = 0 的情况
- 异常测试：测试 resv_key 不存在的情况

**验收标准**：
- ✅ RELEASE 操作正确
- ✅ reserved 不会变成负数
- ✅ 异常情况处理正确

---

#### 步骤 2.4：统一 Reservation 接口

**目标**：统一 Phase 1 和 Phase 2 的 Reservation 接口

**文件**：
- `central_server/scheduler/src/core/dispatcher/job_creation_phase1.rs`
- `central_server/scheduler/src/node_registry/reserved.rs`

**任务**：
1. 如果启用 Phase 2，统一使用 Redis 实现
2. 如果单实例，可以保留内存实现（但需要确保一致性）
3. 添加配置项控制使用哪种实现

**方案选择**：
- **方案 A**：全部使用 Redis（推荐，保证一致性）
- **方案 B**：根据配置选择（单实例用内存，多实例用 Redis）

**推荐方案 A**，原因：
- 保证单实例和多实例行为一致
- 简化代码逻辑
- 便于未来扩展

**测试**：
- 单元测试：测试统一接口
- 集成测试：测试任务分配流程
- 性能测试：Redis 调用性能

**验收标准**：
- ✅ Reservation 接口统一
- ✅ 单实例和多实例行为一致
- ✅ 性能影响可接受

---

#### 步骤 2.5：更新任务派发流程

**目标**：确保任务派发流程正确使用 Reservation

**文件**：
- `central_server/scheduler/src/core/dispatcher/job_creation_phase1.rs`
- `central_server/scheduler/src/core/dispatcher/job_creation_phase2.rs`

**任务**：
1. 检查任务派发流程中的 Reservation 使用
2. 确保 ACK 时调用 COMMIT
3. 确保超时/失败时调用 RELEASE
4. 添加错误处理和日志

**流程检查**：
```
任务分配
  └─> reserve_node_slot (原子预留)
  └─> 派发任务
  └─> 节点 ACK
      └─> commit_node_reservation (reserved -> running)
  └─> 任务完成
      └─> dec_running (running -= 1)
  └─> 超时/失败
      └─> release_node_slot (释放预留)
```

**测试**：
- 集成测试：测试完整任务流程
- 异常测试：测试超时、失败场景
- 并发测试：测试多任务并发分配

**验收标准**：
- ✅ 任务流程正确
- ✅ Reservation 状态正确转换
- ✅ 异常情况处理正确

---

### 阶段 3：多实例支持增强（可选）

#### 步骤 3.1：Pool 成员索引同步到 Redis

**目标**：将 Pool 成员索引同步到 Redis Set

**文件**：
- `central_server/scheduler/src/node_registry/phase3_pool.rs`
- `central_server/scheduler/src/phase2/runtime_routing.rs`

**任务**：
1. 添加 Redis Set 操作函数
   ```rust
   pub async fn sync_pool_members_to_redis(
       &self,
       pool_name: &str,
       node_ids: &HashSet<String>,
   ) -> bool
   ```
2. 节点注册/心跳时更新 Redis Set
3. 节点选择时从 Redis Set 读取候选节点（如果启用多实例）

**Redis Key 设计**：
```
sched:pool:{src}:{tgt}:members  -> Redis Set
```

**测试**：
- 单元测试：测试 Redis Set 操作
- 集成测试：测试多实例同步
- 性能测试：Redis 操作性能

**验收标准**：
- ✅ Pool 成员索引正确同步到 Redis
- ✅ 多实例能看到相同的 Pool 成员
- ✅ 性能影响可接受

---

#### 步骤 3.2：节点并发计数同步到 Redis

**目标**：将节点并发计数（max/running/reserved）同步到 Redis

**文件**：
- `central_server/scheduler/src/node_registry/core.rs`
- `central_server/scheduler/src/phase2/runtime_routing.rs`

**任务**：
1. 添加 Redis Hash 操作函数
   ```rust
   pub async fn sync_node_capacity_to_redis(
       &self,
       node_id: &str,
       max: usize,
       running: usize,
       reserved: usize,
   ) -> bool
   ```
2. 节点注册/心跳时更新 Redis Hash
3. 节点选择时从 Redis Hash 读取（如果启用多实例）

**Redis Key 设计**：
```
sched:node:{node_id}:cap  -> Redis Hash
  - max: int
  - running: int
  - reserved: int
```

**测试**：
- 单元测试：测试 Redis Hash 操作
- 集成测试：测试多实例同步
- 性能测试：Redis 操作性能

**验收标准**：
- ✅ 节点并发计数正确同步到 Redis
- ✅ 多实例能看到相同的节点状态
- ✅ 性能影响可接受

---

#### 步骤 3.3：更新节点选择逻辑使用 Redis

**目标**：节点选择时从 Redis 读取 Pool 成员和节点状态

**文件**：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

**任务**：
1. 如果启用 Phase 2，从 Redis 读取 Pool 成员
2. 如果启用 Phase 2，从 Redis 读取节点并发计数
3. 保持向后兼容（单实例仍使用内存）

**测试**：
- 集成测试：测试多实例节点选择
- 性能测试：Redis 读取性能
- 兼容性测试：单实例仍正常工作

**验收标准**：
- ✅ 多实例节点选择正确
- ✅ 单实例兼容性保持
- ✅ 性能影响可接受

---

## 四、实施顺序和依赖关系

### 依赖关系图

```
阶段 1：节点选择策略改为随机
  └─> 步骤 1.1：添加随机采样函数
  └─> 步骤 1.2：修改节点选择逻辑（依赖 1.1）
  └─> 步骤 1.3：更新配置结构（依赖 1.2）
  └─> 步骤 1.4：更新文档和日志（依赖 1.2）

阶段 2：Reservation 机制统一
  └─> 步骤 2.1：分析当前 Reservation 使用情况
  └─> 步骤 2.2：实现完整的 COMMIT 机制
  └─> 步骤 2.3：实现 RELEASE 机制增强
  └─> 步骤 2.4：统一 Reservation 接口（依赖 2.2, 2.3）
  └─> 步骤 2.5：更新任务派发流程（依赖 2.4）

阶段 3：多实例支持增强（可选）
  └─> 步骤 3.1：Pool 成员索引同步到 Redis
  └─> 步骤 3.2：节点并发计数同步到 Redis
  └─> 步骤 3.3：更新节点选择逻辑使用 Redis（依赖 3.1, 3.2）
```

### 建议实施顺序

1. **先完成阶段 1**（高优先级，影响用户体验）
2. **然后完成阶段 2**（中优先级，影响多实例正确性）
3. **最后完成阶段 3**（可选，根据实际需求决定）

---

## 五、测试策略

### 5.1 单元测试

**目标**：测试每个函数/模块的正确性

**覆盖范围**：
- 随机采样函数
- Reservation 操作（try/commit/release）
- Redis 同步操作
- 配置加载

**工具**：
- Rust 单元测试框架
- Mock Redis（如果需要）

---

### 5.2 集成测试

**目标**：测试完整流程的正确性

**测试场景**：
1. 任务分配流程（随机选择节点）
2. Reservation 流程（预留、COMMIT、RELEASE）
3. 多实例并发分配（防止超卖）
4. 异常场景（超时、失败）

**工具**：
- 集成测试框架
- 真实 Redis（或 Redis 容器）

---

### 5.3 性能测试

**目标**：确保性能影响可接受

**测试指标**：
- 节点选择延迟（随机采样开销）
- Reservation 操作延迟（Redis Lua 脚本）
- 多实例同步延迟

**基准**：
- 节点选择延迟 < 1ms
- Reservation 操作延迟 < 5ms
- 多实例同步延迟 < 10ms

---

### 5.4 兼容性测试

**目标**：确保向后兼容

**测试场景**：
- 单实例仍正常工作
- 现有配置仍能加载
- 现有任务流程不受影响

---

## 六、风险评估和缓解措施

### 6.1 风险识别

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **随机采样性能影响** | 中 | 低 | 限制采样数量，使用高效随机算法 |
| **Reservation 统一导致单实例性能下降** | 中 | 中 | 保留内存实现作为选项，或优化 Redis 调用 |
| **多实例同步延迟** | 高 | 中 | 使用 Redis Pipeline，批量操作 |
| **配置变更导致兼容性问题** | 中 | 低 | 保持向后兼容，提供迁移指南 |
| **Redis 不可用导致功能失效** | 高 | 低 | 提供降级方案，单实例模式 |

### 6.2 回滚方案

**如果阶段 1 出现问题**：
- 保留原有 hash-based 选择逻辑
- 通过配置开关切换

**如果阶段 2 出现问题**：
- 保留原有内存实现
- 通过配置选择使用哪种实现

**如果阶段 3 出现问题**：
- 阶段 3 是可选的，可以暂时不启用
- 单实例模式不受影响

---

## 七、验收标准

### 7.1 功能验收

- ✅ 节点选择具有随机性（同一 session 不固定节点）
- ✅ Reservation 机制统一，支持多实例
- ✅ 节点不会被分配超过容量的任务
- ✅ 多实例场景下状态同步正确

### 7.2 性能验收

- ✅ 节点选择延迟 < 1ms
- ✅ Reservation 操作延迟 < 5ms
- ✅ 多实例同步延迟 < 10ms
- ✅ 整体任务分配延迟无明显增加

### 7.3 兼容性验收

- ✅ 单实例仍正常工作
- ✅ 现有配置仍能加载
- ✅ 现有任务流程不受影响

---

## 八、时间估算

### 阶段 1：节点选择策略改为随机
- 步骤 1.1：0.5 天
- 步骤 1.2：1 天
- 步骤 1.3：0.5 天
- 步骤 1.4：0.5 天
- **小计**：2.5 天

### 阶段 2：Reservation 机制统一
- 步骤 2.1：0.5 天
- 步骤 2.2：1 天
- 步骤 2.3：0.5 天
- 步骤 2.4：1.5 天
- 步骤 2.5：1 天
- **小计**：4.5 天

### 阶段 3：多实例支持增强（可选）
- 步骤 3.1：1 天
- 步骤 3.2：1 天
- 步骤 3.3：1 天
- **小计**：3 天

### 测试和文档
- 单元测试：1 天
- 集成测试：1 天
- 文档更新：0.5 天
- **小计**：2.5 天

### 总计
- **阶段 1 + 2**：7 天
- **阶段 1 + 2 + 3**：10 天
- **含测试和文档**：12.5 天

---

## 九、下一步行动

### 立即开始

1. **确认实施范围**
   - 是否包含阶段 3（多实例支持增强）？
   - 是否有其他优先级调整？

2. **准备开发环境**
   - 确认 Redis 环境可用
   - 准备测试环境

3. **开始阶段 1**
   - 从步骤 1.1 开始
   - 逐步完成每个步骤

### 每周检查点

- **周 1**：完成阶段 1
- **周 2**：完成阶段 2
- **周 3**：完成阶段 3（如果包含）+ 测试

---

**文档结束**
