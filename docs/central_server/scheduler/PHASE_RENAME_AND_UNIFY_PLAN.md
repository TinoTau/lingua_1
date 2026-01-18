# Phase 重命名和统一方案

## Phase1 和 Phase2 的实际功能

### Phase1（本地模式）
**实际功能**: **单实例模式** / **本地存储模式**

**特点**:
- 只有一个调度服务器实例
- Job 状态存储在**本地内存**（`jobs: HashMap`）
- 幂等性检查在**本地 HashMap**
- **不需要 Redis**
- 适合：开发、测试、单机部署

**代码证据**:
```rust
// job_creation_phase1.rs:7
/// Phase 1: 本地幂等检查
// 但实际上已经在用 Phase2 的 Redis 了（已废弃）
```

### Phase2（跨实例模式）
**实际功能**: **多实例模式** / **分布式模式** / **Redis 存储模式**

**特点**:
- 可以有**多个调度服务器实例**协同工作
- Job 状态存储在**Redis**
- 幂等性检查在**Redis**（跨实例去重）
- **需要 Redis 连接**
- 适合：生产环境、多实例部署、高可用

**代码证据**:
```rust
// phase2.rs:1
//! Phase 2（决策版 v1.0 + 补充 v1.1）最小落地：
//! - Scheduler instance_id + presence（TTL）
//! - node/session owner（TTL）
//! - 跨实例投递：Redis Streams inbox
```

---

## 关键发现

从代码来看，**Phase1 已经基本废弃**：
```rust
// check_phase1_idempotency() 内部注释：
// "Phase1 路径已废弃，改用 Phase2 的 Redis 实现"
// 如果 phase2 可用，使用 phase2 的 request_binding
```

这说明：
- Phase1 和 Phase2 的**核心区别只是存储方式**（本地内存 vs Redis）
- 节点选择逻辑**应该完全一样**
- 当前的两套节点选择逻辑是**历史遗留问题**

---

## 方案对比

### 方案A：增加统一 NodeSelector 层（当前建议）

**结构**:
```
create_job()
├── Phase1 路径 → select_node_for_job_creation() → select_node_unified()
└── Phase2 路径 → select_node_for_phase2() → select_node_unified()
```

**优点**:
- ✅ 改动小，风险低
- ✅ 保留两条路径的独立性

**缺点**:
- ❌ 仍然有两套代码路径需要维护
- ❌ 需要维护统一函数的参数兼容性
- ❌ 代码结构稍复杂（多一层抽象）

---

### 方案B：直接合并 Phase（推荐）

**结构**:
```
create_job_unified()
├── 统一的幂等检查（根据是否有 Redis 选择路径）
├── 统一的节点选择（不再区分 Phase1/Phase2）
└── 统一的 Job 创建
```

**优点**:
- ✅ **只有一套代码路径**，更容易维护
- ✅ 逻辑统一，不会有分叉
- ✅ 代码更简洁
- ✅ 符合当前实际情况（Phase1 已废弃）

**缺点**:
- ❌ 改动较大，需要重构
- ❌ 需要处理 Redis 可选的情况（但代码中已经有 `if let Some(rt) = &self.phase2`）

---

## 推荐方案：合并 Phase + 重命名

### 理由

1. **Phase1 已废弃**：代码中已经明确说明 Phase1 改用 Phase2 的 Redis 实现
2. **维护成本更低**：只有一套代码，不会出现逻辑分叉
3. **项目未上线**：可以大胆重构，不需要考虑向后兼容
4. **代码更清晰**：用功能名称替代 Phase 编号

---

## 实施计划

### 步骤1：重命名 Phase → 功能名称

**重命名映射**:
```rust
// 类型和结构体
Phase2Runtime → CrossInstanceRuntime
Phase2Config → CrossInstanceConfig

// 文件
job_creation_phase1.rs → job_creation_local.rs
job_creation_phase2.rs → job_creation_cross_instance.rs
phase2_idempotency.rs → cross_instance_idempotency.rs
phase2_node_selection.rs → cross_instance_node_selection.rs
phase2_redis_lock.rs → cross_instance_redis_lock.rs
phase2.rs → cross_instance.rs

// 函数和变量
phase2 → cross_instance_runtime
create_job_with_phase2_lock → create_job_with_cross_instance_lock
check_phase2_idempotency → check_cross_instance_idempotency
select_node_for_phase2 → select_node_for_cross_instance
```

### 步骤2：合并节点选择逻辑

**统一函数**:
```rust
// 统一的节点选择（不再区分 local/cross_instance）
pub(crate) async fn select_node_unified(
    &self,
    preferred_node_id: Option<String>,
    exclude_node_id: Option<String>,
    preferred_pool: Option<u16>,
    routing_key: &str,
    src_lang: &str,
    tgt_lang: &str,
    features: &Option<FeatureFlags>,
    pipeline: &PipelineConfig,
    snapshot: &Arc<RuntimeSnapshot>,
    // ... 其他参数
) -> (Option<String>, Option<(&'static str, &'static str)>) {
    // 统一的验证逻辑：
    // 1. preferred_node_id 完整验证（可用性、语言对、模型能力）
    // 2. 统一的 fallback 逻辑
    // 3. 统一的两次尝试策略
}
```

### 步骤3：合并 create_job 逻辑

**统一入口**:
```rust
pub async fn create_job(...) -> Job {
    // 统一的幂等检查（根据是否有 cross_instance_runtime）
    let idempotency_result = if let Some(rt) = &self.cross_instance_runtime {
        // 跨实例幂等（Redis）
        check_cross_instance_idempotency(rt, request_id).await
    } else {
        // 本地幂等（实际上可能不需要，因为 Phase1 已废弃）
        None
    };
    
    // 统一的节点选择（不再区分路径）
    let node_id = select_node_unified(...).await;
    
    // 统一的 Job 创建
    create_job_unified(...).await
}
```

---

## 维护成本对比

| 方案 | 代码路径数 | 维护复杂度 | 逻辑一致性 | 推荐度 |
|------|-----------|-----------|-----------|--------|
| 方案A（统一层） | 2条路径 + 1个统一函数 | 中等 | 较好 | ⭐⭐⭐ |
| 方案B（合并） | 1条路径 | 低 | 最好 | ⭐⭐⭐⭐⭐ |

**结论**: **方案B（合并）更容易维护**

---

## 实施建议

### 立即执行
1. ✅ 重命名 Phase → 功能名称
2. ✅ 统一 NodeSelector（作为合并的第一步）

### 短期执行（1周内）
3. 📋 合并 create_job 逻辑
4. 📋 移除 Phase1/Phase2 的概念

### 长期
5. 📋 完全统一为配置驱动：`deployment_mode: "local" | "cross_instance"`
