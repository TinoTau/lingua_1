# Pool 架构设计文档

## 文档信息
- **版本**: v3.0
- **日期**: 2026-01-XX
- **状态**: 已实现（语言集合设计）

---

## 一、架构概述

### 1.1 设计目标

Pool 机制用于优化节点选择，基于**语言集合（Language Set）**而非语言对：

1. **语言集合 Pool**：节点支持的语言集合（如 `{zh, en}` → `en-zh` Pool）
2. **动态创建**：节点注册时根据其语言集合自动创建或匹配 Pool
3. **灵活搜索**：任务分配时搜索所有包含源语言和目标语言的 Pool

### 1.2 核心优势

- ✅ **Pool 数量减少**：从 N*(N-1) 降到 1（N 种语言）
- ✅ **符合实际场景**：用户选择的是语言集合，不是语言对
- ✅ **任务分配灵活**：可以充分利用所有可用节点
- ✅ **注册逻辑简单**：直接根据语言集合创建 Pool

---

## 二、Pool 生成逻辑

### 2.1 语言集合 Pool 生成

**生成步骤**：

1. **收集语言集合**：遍历所有节点，收集每个节点的语义修复服务支持的语言集合
2. **统计节点数**：统计每个语言集合的节点数
3. **过滤**：只保留节点数 >= `min_nodes_per_pool` 的语言集合
4. **排序**：按节点数降序排序，优先创建节点数多的 Pool
5. **生成配置**：为每个语言集合创建 Pool 配置（名称按字母顺序排序）

**Pool 命名规则**：
- 语言集合按字母顺序排序，用 `-` 连接
- 例如：`{zh, en}` → `en-zh`
- 例如：`{zh, en, de}` → `de-en-zh`

### 2.2 动态 Pool 创建

**触发时机**：
- 节点注册时，如果节点的语言集合不在现有 Pool 中
- 节点心跳时，如果语言集合变化

**流程**：
1. 获取节点的语义修复服务支持的语言集合
2. 排序语言集合，生成 Pool 名称
3. 检查 Pool 是否存在
4. 如果不存在，创建新 Pool 并同步到 Redis（如果启用 Phase 2）

---

## 三、节点分配逻辑

### 3.1 节点到 Pool 的分配

**分配规则**：
- 一个节点只属于一个 Pool（基于其语言集合）
- 例如：节点支持 `{zh, en}` → 只属于 `en-zh` Pool

**匹配逻辑**：
```rust
// 获取节点的语言集合（基于 semantic_langs）
let semantic_langs: HashSet<String> = ...;
let mut sorted_langs: Vec<String> = semantic_langs.into_iter().collect();
sorted_langs.sort();
let pool_name = sorted_langs.join("-");

// 查找匹配的 Pool
cfg.pools.iter()
    .find(|p| p.name == pool_name)
    .map(|p| p.pool_id)
```

### 3.2 语言能力要求

**重要说明**：节点端的语言可用性以语义修复服务的能力为准。

**节点匹配规则**：
- 源语言和目标语言都必须在节点的语义修复服务支持的语言列表中
- 同时满足 ASR、TTS、NMT 的语言要求

---

## 四、任务分配流程

### 4.1 Pool 搜索逻辑

**任务请求**：`src_lang`, `tgt_lang`

**搜索策略**：
```rust
// 搜索所有包含源语言和目标语言的 Pool
let eligible_pools: Vec<u16> = cfg.pools.iter()
    .filter(|p| {
        let pool_langs: HashSet<&str> = p.name.split('-').collect();
        pool_langs.contains(src_lang.as_str()) && 
        pool_langs.contains(tgt_lang.as_str())
    })
    .map(|p| p.pool_id)
    .collect();
```

**示例**：
- 任务需要 `zh→en`
- 匹配的 Pool：`en-zh`（中英池）、`de-en-zh`（中英德池）

### 4.2 节点选择逻辑

**两级调度（Two-level）**：

1. **第一级：Pool 选择**
   - 根据 `routing_key`（通常是 `session_id`）使用 hash 选择 preferred pool
   - 如果 preferred pool 没有可用节点，fallback 到其他 pool

2. **第二级：节点选择**
   - 在选定的 Pool 内，随机采样或按负载排序选择节点
   - 负载计算：`effective_jobs = max(current_jobs, reserved_jobs)`
   - **节点能力校验**：从 Redis 读取 `sched:node:{node_id}:capabilities`，检查节点是否具备所需服务类型（ASR/NMT/TTS/Semantic）

---

## 五、Redis 同步机制

### 5.1 Pool 配置同步

**多实例环境**：
- **Leader 选举**：使用 Redis 分布式锁确保只有一个实例生成 Pool 配置
- **配置写入**：Leader 实例将 Pool 配置写入 Redis（包含版本号）
- **配置读取**：其他实例从 Redis 读取 Pool 配置并同步到本地
- **版本控制**：使用版本号检测配置更新，定期同步（每 10 秒）

**Redis Key**：
```
{prefix}:v1:phase3:pools:config      -> Pool 配置（JSON，TTL=1小时）
{prefix}:v1:phase3:pools:leader     -> Leader 实例 ID（TTL=60秒）
{prefix}:v1:phase3:pools:version     -> 配置版本号（递增）
```

### 5.2 Pool 成员索引同步

**Redis Set**：
```
{prefix}:v1:pool:{pool_name}:members -> node_id 列表（TTL=1小时）
```

**同步时机**：
- 节点注册/心跳时同步
- Pool 重建时同步

**节点选择时**：
- 如果启用 Phase 2，从 Redis 读取 Pool 成员（保持原子性）
- 如果未启用 Phase 2，从内存读取（向后兼容）

### 5.3 节点能力信息同步

**Redis Hash**：
```
{prefix}:node:{node_id}:capabilities -> 节点服务能力（asr/nmt/tts/tone/semantic）
```

**同步时机**：
- 节点注册时：将 `capability_by_type` 同步到 Redis
- 节点心跳时：如果 `capability_by_type` 变化，更新 Redis

**节点选择时**：
- 从 Redis 读取节点能力信息，检查节点是否具备所需服务类型
- 确保多实例间的一致性

---

## 六、配置结构

### 6.1 AutoLanguagePoolConfig

```rust
pub struct AutoLanguagePoolConfig {
    pub min_nodes_per_pool: usize,  // 默认：1
    pub max_pools: usize,            // 默认：50（仅精确池）
    pub pool_naming: String,         // 默认："set"（语言集合）
    pub require_semantic: bool,      // 默认：true
    pub enable_mixed_pools: bool,    // 默认：true（已废弃，保留兼容）
}
```

### 6.2 配置示例

```toml
[phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true

[phase3.auto_pool_config]
min_nodes_per_pool = 1
max_pools = 50
require_semantic = true
pool_naming = "set"
```

---

## 七、优势与限制

### 7.1 优势

1. **Pool 数量大幅减少**：从 N*(N-1) 降到 1（N 种语言）
2. **更符合实际场景**：用户选择的是语言集合，不是语言对
3. **任务分配更灵活**：可以充分利用所有可用节点
4. **注册逻辑更简单**：不需要全量重建，直接创建 Pool

### 7.2 限制

1. **Pool 数量可能仍然较多**：如果节点支持的语言集合差异很大
2. **需要确保任务分配时不会重复选择同一个节点**：通过去重机制解决

---

## 八、代码位置

- **Pool 生成逻辑**：`central_server/scheduler/src/node_registry/auto_language_pool.rs`
- **Pool 选择逻辑**：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`
- **节点分配逻辑**：`central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`
- **Redis 同步**：`central_server/scheduler/src/phase2/runtime_routing.rs`
- **配置结构**：`central_server/scheduler/src/core/config/config_types.rs`

---

**最后更新**: 2026-01-XX
