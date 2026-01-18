# Phase1 和 Phase2 说明文档

## 核心区别

### Phase1（本地模式 / 单实例模式）
**实际功能名称建议**: `LocalMode` 或 `SingleInstanceMode`

**特点**:
- **单实例运行**：只有一个调度服务器实例
- **本地存储**：Job 状态存储在内存中（`jobs: HashMap<String, Job>`）
- **本地幂等**：使用本地 HashMap 检查 `request_id` 是否已存在
- **无需 Redis**：不依赖外部存储
- **简单快速**：适合开发、测试或小规模部署

**使用场景**:
- 开发环境
- 单机部署
- 测试环境
- 不需要高可用性的场景

**代码位置**:
- `job_creation_phase1.rs` → `create_job_phase1()`
- `job_creation.rs` → `check_phase1_idempotency()` （本地 HashMap 检查）

---

### Phase2（跨实例模式 / 多实例模式）
**实际功能名称建议**: `CrossInstanceMode` 或 `MultiInstanceMode` 或 `DistributedMode`

**特点**:
- **多实例运行**：可以有多个调度服务器实例协同工作
- **Redis 存储**：Job 状态存储在 Redis 中（`request_binding`）
- **跨实例幂等**：使用 Redis 检查 `request_id`，支持跨实例去重
- **需要 Redis**：依赖 Redis 连接
- **高可用性**：支持水平扩展、故障转移

**使用场景**:
- 生产环境
- 多实例部署
- 需要高可用性的场景
- 需要负载均衡的场景

**代码位置**:
- `job_creation_phase2.rs` → `create_job_with_phase2_lock()`
- `phase2_idempotency.rs` → `check_phase2_idempotency()` （Redis 检查）
- `phase2_redis_lock.rs` → Redis 分布式锁

---

## 为什么有两个路径？

### 历史原因
- Phase1 是最初的实现（单实例）
- Phase2 是为了支持多实例而添加的（使用 Redis）

### 当前设计
- 代码中通过 `if self.phase2.is_some()` 判断是否启用 Phase2
- 如果启用 Phase2，优先使用 Phase2 路径
- 否则回退到 Phase1 路径

---

## 命名建议

### 推荐的重命名方案

#### 方案1：按功能命名（推荐）
```rust
// 旧名称 → 新名称
Phase1 → LocalMode / SingleInstanceMode
Phase2 → CrossInstanceMode / MultiInstanceMode

// 文件重命名
job_creation_phase1.rs → job_creation_local.rs
job_creation_phase2.rs → job_creation_cross_instance.rs
phase2_idempotency.rs → cross_instance_idempotency.rs
phase2_node_selection.rs → cross_instance_node_selection.rs
phase2_redis_lock.rs → cross_instance_redis_lock.rs
```

#### 方案2：按部署模式命名
```rust
Phase1 → StandaloneMode
Phase2 → ClusterMode
```

#### 方案3：保持 Phase 但添加注释
```rust
// Phase1: 本地模式（单实例）
// Phase2: 跨实例模式（多实例，使用 Redis）
```

---

## 统一 NodeSelector vs 合并 Phase

### 方案A：增加一层统一 NodeSelector（当前建议）

**优点**:
- ✅ 改动小，风险低
- ✅ 保留两条路径的独立性
- ✅ 向后兼容性好

**缺点**:
- ❌ 仍然有两套代码路径
- ❌ 需要维护统一函数的参数兼容性
- ❌ 代码结构稍复杂

**实现方式**:
```rust
// 统一函数
pub async fn select_node_unified(...) -> (Option<String>, ...) {
    // 统一的节点选择逻辑
}

// Phase1 调用
select_node_for_job_creation() {
    select_node_unified(...)
}

// Phase2 调用
select_node_for_phase2() {
    select_node_unified(...)
}
```

---

### 方案B：直接合并两个 Phase（更彻底）

**优点**:
- ✅ **只有一套代码路径**，更容易维护
- ✅ 逻辑统一，不会有分叉
- ✅ 代码更简洁

**缺点**:
- ❌ 改动较大，需要重构
- ❌ 需要处理 Redis 可选的情况

**实现方式**:
```rust
// 合并后的统一函数
pub async fn create_job_unified(
    &self,
    // ... 参数
    redis_runtime: Option<&CrossInstanceRuntime>, // 如果为 None，使用本地模式
) -> Job {
    // 统一的幂等检查（根据 redis_runtime 是否存在选择路径）
    let idempotency_result = if let Some(rt) = redis_runtime {
        // 跨实例幂等（Redis）
        check_cross_instance_idempotency(rt, request_id).await
    } else {
        // 本地幂等（HashMap）
        check_local_idempotency(request_id).await
    };
    
    // 统一的节点选择（不再区分 Phase1/Phase2）
    let node_id = select_node_unified(...).await;
    
    // 统一的 Job 创建
    create_job(...).await
}
```

---

## 推荐方案

### 对于统一 NodeSelector
**建议**: 使用方案A（增加统一层）
- 改动小，风险可控
- 可以逐步重构

### 对于 Phase 命名
**建议**: 重命名为功能名称
- `Phase1` → `LocalMode` 或 `SingleInstanceMode`
- `Phase2` → `CrossInstanceMode` 或 `MultiInstanceMode`
- 更清晰，更容易理解

### 对于长期维护
**建议**: 考虑方案B（合并 Phase）
- 如果项目没有上线，可以大胆重构
- 合并后只有一套代码，维护成本更低
- 通过 `Option<CrossInstanceRuntime>` 控制是否使用 Redis

---

## 实施建议

### 短期（立即）
1. ✅ 统一 NodeSelector（方案A）
2. 📋 重命名 Phase → 功能名称

### 中期（1-2周）
3. 📋 考虑合并 Phase1 和 Phase2（方案B）
4. 📋 统一所有幂等性检查逻辑

### 长期
5. 📋 完全移除 Phase1/Phase2 的概念
6. 📋 使用配置驱动：`mode: "local" | "cross_instance"`
