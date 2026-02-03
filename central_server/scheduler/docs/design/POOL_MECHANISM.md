# Scheduler Pool 机制文档

## 概述

Pool（调度池）是 Scheduler Phase 3 的核心功能，用于实现**两级调度**（Two-level scheduling）机制。通过将节点分配到不同的 Pool，可以：

- **提升调度性能**：在节点规模增大时，将"全量遍历选节点"收敛为"先选 pool，再在 pool 内选 node"
- **实现强隔离**：按服务能力将节点分组，确保特定任务只分配给具备相应能力的节点
- **提供可观测性**：通过 Pool 级别的统计，更好地监控和运维调度系统

---

## Pool 建立机制

### 1. Pool 定义：固定配置（静态）

Pool 的定义是**静态配置**，通过配置文件定义：

- **配置文件位置**：`central_server/scheduler/config.toml`
- **配置方式**：通过 `[[scheduler.phase3.pools]]` 配置块定义
- **每个 Pool 包含**：
  - `pool_id`：Pool ID（固定，u16 类型）
  - `name`：Pool 名称（可选，用于标识）
  - `required_services`：该 Pool 要求的服务列表（固定）

#### 配置示例

```toml
[scheduler.phase3]
enabled = true
mode = "two_level"
pool_count = 16
hash_seed = 0
fallback_scan_all_pools = true

# 示例：一个"全核心链路" pool
[[scheduler.phase3.pools]]
pool_id = 10
name = "core_all"
required_services = ["faster-whisper-vad", "nmt-m2m100", "piper-tts"]

# 示例：一个"仅 ASR" pool
[[scheduler.phase3.pools]]
pool_id = 11
name = "asr_only"
required_services = ["faster-whisper-vad"]
```

### 2. 节点分配：动态计算（运行时）

虽然 Pool 定义是固定的，但**节点分配到哪个 Pool 是动态的**：

- **触发时机**：每次心跳更新时（`update_node_heartbeat`）
- **计算逻辑**：`determine_pool_for_node` 根据节点的 `installed_services` 匹配 Pool
- **动态移动**：当节点服务状态变化时，节点会自动在不同 Pool 之间移动

#### 分配流程

1. 节点发送心跳，包含 `installed_services` 和 `capability_state`
2. 调度服务器更新节点信息
3. 调用 `phase3_upsert_node_to_pool_index` 重新计算 Pool 归属
4. 节点被分配到匹配的 Pool（或从旧 Pool 移除，加入新 Pool）

---

## 两种模式

### 模式 A：简单 Hash 分配（`pools` 为空）

当 `pools` 配置为空时，使用简单的 Hash 分配：

- **分配方式**：使用 `pool_count`（默认 16）和 `hash_seed` 通过 hash 将节点分配到固定数量的 Pool
- **计算公式**：`pool_id = hash(node_id) % pool_count`
- **特点**：
  - 节点分配均匀
  - 不依赖服务能力
  - 适合简单的负载均衡场景

#### 配置示例

```toml
[scheduler.phase3]
enabled = true
mode = "two_level"
pool_count = 16        # Pool 数量
hash_seed = 0          # Hash 种子
# pools = []           # 不配置 pools，使用简单 Hash 分配
```

### 模式 B：按能力分配（`pools` 非空，强隔离模式）

当 `pools` 配置非空时，启用**按能力分 pool 的强隔离模式**：

- **匹配规则**：节点的 `installed_services` 必须包含 Pool 的所有 `required_services`
- **优先级选择**：
  1. 如果只有一个 Pool 匹配，直接分配
  2. 如果有多个 Pool 匹配，选择**最具体的**（`required_services` 数量最多的）
  3. 如果多个 Pool 的 specificity 相同，使用 `node_id` 的稳定 hash 分配（避免热点倾斜）
- **通配 Pool**：`required_services` 为空的 Pool 只有在没有更具体匹配时才会被选中

#### 配置示例

```toml
[scheduler.phase3]
enabled = true
mode = "two_level"
pool_count = 16
hash_seed = 0
fallback_scan_all_pools = true
pool_match_scope = "core_only"      # "core_only" | "all_required"
pool_match_mode = "contains"         # "contains" | "exact"
strict_pool_eligibility = false

# 全核心链路 Pool
[[scheduler.phase3.pools]]
pool_id = 10
name = "core_all"
required_services = ["faster-whisper-vad", "nmt-m2m100", "piper-tts"]

# 仅 ASR Pool
[[scheduler.phase3.pools]]
pool_id = 11
name = "asr_only"
required_services = ["faster-whisper-vad"]

# 通配 Pool（兜底）
[[scheduler.phase3.pools]]
pool_id = 12
name = "default"
required_services = []  # 空列表表示通配
```

---

## 节点分配算法

### `determine_pool_for_node` 算法

```rust
fn determine_pool_for_node(cfg: &Phase3Config, n: &Node) -> Option<u16> {
    // 1. 收集所有匹配的 pools
    let mut matching: Vec<(u16, usize)> = Vec::new(); // (pool_id, specificity_len)
    
    for p in cfg.pools.iter() {
        if p.required_services.is_empty() {
            // 通配 pool：specificity=0
            matching.push((p.pool_id, 0));
            continue;
        }
        
        // 检查节点是否包含该 pool 的所有 required_services
        let ok = p.required_services.iter()
            .all(|rid| n.installed_services.iter().any(|s| s.service_id == *rid));
        
        if ok {
            matching.push((p.pool_id, p.required_services.len()));
        }
    }
    
    if matching.is_empty() {
        return None;
    }
    
    if matching.len() == 1 {
        return Some(matching[0].0);
    }
    
    // 2. 多个 pool 都匹配：选择最具体的
    let max_spec = matching.iter().map(|(_, s)| *s).max().unwrap_or(0);
    let mut best: Vec<u16> = matching
        .into_iter()
        .filter(|(_, s)| *s == max_spec)
        .map(|(pid, _)| pid)
        .collect();
    
    if best.len() == 1 {
        return Some(best[0]);
    }
    
    // 3. specificity 相同：使用 node_id 稳定 hash 分配
    best.sort();
    let idx = pick_index_for_key(best.len(), cfg.hash_seed, &n.node_id);
    Some(best[idx])
}
```

### 分配示例

假设有以下配置：

```toml
[[scheduler.phase3.pools]]
pool_id = 10
required_services = ["faster-whisper-vad", "nmt-m2m100", "piper-tts"]

[[scheduler.phase3.pools]]
pool_id = 11
required_services = ["faster-whisper-vad"]

[[scheduler.phase3.pools]]
pool_id = 12
required_services = []
```

**场景 1**：节点安装了 `["faster-whisper-vad", "nmt-m2m100", "piper-tts"]`
- 匹配 Pool 10（specificity=3）和 Pool 11（specificity=1）
- 选择 Pool 10（最具体）

**场景 2**：节点只安装了 `["faster-whisper-vad"]`
- 匹配 Pool 11（specificity=1）和 Pool 12（specificity=0）
- 选择 Pool 11（更具体）

**场景 3**：节点安装了 `["speaker-embedding"]`
- 只匹配 Pool 12（通配）
- 选择 Pool 12

---

## 心跳更新与 Pool 重新分配

### 心跳更新流程

1. **节点发送心跳**：包含 `installed_services` 和 `capability_state`
2. **更新节点信息**：`update_node_heartbeat` 更新节点的服务列表和状态
3. **触发 Pool 重新分配**：调用 `phase3_upsert_node_to_pool_index`
4. **更新 Pool 索引**：从旧 Pool 移除，加入新 Pool

### 代码实现

```rust
pub async fn update_node_heartbeat(
    &self,
    node_id: &str,
    // ... 其他参数
    installed_services: Option<Vec<InstalledService>>,
    capability_state: Option<CapabilityState>,
) -> bool {
    // 更新节点信息
    if let Some(services) = installed_services {
        node.installed_services = services;
    }
    if let Some(cap_state) = capability_state {
        node.capability_state = cap_state;
    }
    
    // Phase 3：installed_services/capability_state 可能变化，需更新 pool 归属
    self.phase3_upsert_node_to_pool_index(node_id).await;
    self.phase3_core_cache_upsert_node(n).await;
}
```

### 服务热插拔效果

当节点端服务热插拔时：

1. **服务启动/停止** → 节点端立即发送心跳（最多 2 秒延迟，带防抖）
2. **调度服务器收到心跳** → 更新 `installed_services` 和 `capability_state`
3. **自动触发 Pool 重新分配** → `phase3_upsert_node_to_pool_index`
4. **节点被分配到匹配的 Pool**（或从旧 Pool 移除，加入新 Pool）

---

## Pool 匹配模式

### `pool_match_scope`：匹配范围

- **`"core_only"`**（默认）：只对 ASR/NMT/TTS 核心服务做 pool 级过滤
  - 兼容性最好
  - 适合大多数场景
- **`"all_required"`**：对 `required_model_ids` 全量做 pool 级过滤
  - 更强隔离
  - 需要 pool 的 `required_services` 覆盖完整

### `pool_match_mode`：匹配模式

- **`"contains"`**（默认）：包含匹配
  - `required ⊆ pool.required_services`
  - 节点的服务包含 Pool 要求的所有服务即可
- **`"exact"`**：精确匹配
  - `set(required) == set(pool.required_services)`
  - 用于"强隔离"，避免更大/更全的 pool 兜底更小的任务集合

### `strict_pool_eligibility`：严格模式

- **`false`**（默认）：eligible 为空时回退到"遍历所有配置 pools"（兼容模式）
- **`true`**：eligible 为空时直接返回 `NO_AVAILABLE_NODE`（强隔离）

---

## Tenant 绑定

支持将特定 tenant 绑定到特定 Pool：

```toml
[[scheduler.phase3.tenant_overrides]]
tenant_id = "tenant-A"
pool_id = 10
```

- 当 `routing_key == tenant_id` 时生效
- 目前 `routing_key` 优先使用 `tenant_id`，否则使用 `session_id`
- 用于强隔离/容量规划场景

---

## 配置更新

### 当前机制

- **启动时**：从 `config.toml` 加载配置
- **运行时**：有 `set_phase3_config` 方法，但目前只在启动时调用
- **修改配置**：需要修改配置文件并重启服务（目前没有 HTTP API 动态修改）

### 配置更新影响

修改以下配置会导致 Pool 映射变化：

- `pool_count`：Pool 数量变化
- `hash_seed`：Hash 种子变化
- `pools`：Pool 定义变化

**建议**：只在可控窗口调整，避免运行时频繁变更。

---

## 核心服务缓存（Core Cache）

Pool 机制还维护了**核心服务缓存**（`phase3_core_cache`），用于：

- 统计各 Pool 中 ready 的节点数
- 快速判断 Pool 是否具备核心服务能力（ASR/NMT/TTS）
- 支持 Pool 级别的健康检查

### 核心服务状态计算

```rust
fn compute_node_state(n: &Node, pool_id: u16, core: &CoreServicesConfig) -> NodeCoreState {
    let ready = n.online && n.status == NodeStatus::Ready;
    
    let asr_ready = ready
        && !asr_id.is_empty()
        && n.capability_state.get(asr_id).map(|s| s == &ModelStatus::Ready).unwrap_or(false);
    
    // ... 类似地计算 nmt_ready, tts_ready
    
    NodeCoreState {
        pool_id,
        online,
        ready,
        asr_installed,
        asr_ready,
        // ...
    }
}
```

---

## 运维与调试

### Pool 状态查询

可以通过以下方法查询 Pool 状态：

- `phase3_pool_sizes()`：返回各 Pool 的节点数
- `phase3_node_pool_id(node_id)`：查询节点所属的 Pool
- `phase3_pool_sample_node_ids(pool_id, limit)`：返回 Pool 内示例节点 ID

### 调度 dry-run

支持调度 dry-run（Phase3），用于验证 routing_key/required_services 会落到哪个 pool：

```
GET /api/v1/phase3/simulate?routing_key=tenant-A&required=faster-whisper-vad&required=nmt-m2m100&required=piper-tts
```

---

## 最佳实践

### 1. Pool 设计原则

- **按服务能力分组**：将具备相同服务能力的节点分配到同一 Pool
- **避免过度细分**：Pool 数量过多会导致调度复杂度增加
- **保留通配 Pool**：作为兜底，确保所有节点都能被分配

### 2. 配置建议

- **`pool_match_scope = "core_only"`**：适合大多数场景
- **`pool_match_mode = "contains"`**：提供灵活性
- **`strict_pool_eligibility = false`**：提供兼容性，避免任务无法分配

### 3. 监控指标

- 各 Pool 的节点数
- 各 Pool 的 ready 节点数
- 各 Pool 的核心服务覆盖情况（ASR/NMT/TTS）
- Pool 分配失败率

---

## 相关代码位置

- **配置定义**：`central_server/scheduler/src/core/config.rs`
- **Pool 分配逻辑**：`central_server/scheduler/src/node_registry/phase3_pool.rs`
- **心跳更新**：`central_server/scheduler/src/node_registry/core.rs`
- **核心服务缓存**：`central_server/scheduler/src/node_registry/phase3_core_cache.rs`
- **配置文件**：`central_server/scheduler/config.toml`

---

## 总结

- **Pool 定义**：固定配置（配置文件，需重启生效）
- **节点分配**：动态计算（根据心跳实时更新，节点可在 Pool 间移动）
- **两种模式**：简单 Hash 分配 vs 按能力分配（强隔离）
- **服务热插拔**：节点服务状态变化时，自动重新分配到合适的 Pool
- **配置更新**：目前需要重启服务（没有运行时 API）

Pool 机制实现了灵活且高效的节点分组和调度，支持从简单的负载均衡到强隔离的多种场景。

