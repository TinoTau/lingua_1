# 节点注册与 Pool 生成流程

## 文档信息
- **版本**: v3.0
- **日期**: 2026-01-XX
- **状态**: 已实现（语言集合设计）

---

## 一、节点注册完整流程

### 1.1 节点发送注册消息

**节点端行为**：
- 通过 WebSocket 发送 `NodeMessage::NodeRegister` 消息
- 包含以下信息：
  - `node_id`: 可选，如果提供则使用，否则服务器生成
  - `version`: 节点版本
  - `capability_schema_version`: 必须为 "2.0"（ServiceType 模型）
  - `platform`: 平台信息
  - `hardware`: 硬件信息（**必须包含 GPU**）
  - `installed_models`: 已安装的模型列表
  - `installed_services`: 已安装的服务列表（ServiceType）
  - `capability_by_type`: 按服务类型的能力信息（**注意：已迁移到 Redis，不再存储在 Node 结构体中**）
  - `language_capabilities`: 语言能力信息（支持的语言对）

### 1.2 服务器接收并验证

**文件**: `central_server/scheduler/src/websocket/node_handler/message/register.rs`

**步骤 1: 验证 capability_schema_version**
```rust
if capability_schema_version != Some("2.0") {
    return Error::InvalidCapabilitySchema
}
```

**步骤 2: 调用 `register_node_with_policy`**
```rust
state.node_registry.register_node_with_policy(
    provided_node_id,
    generated_name,
    version,
    platform,
    hardware,
    installed_models,
    installed_services,
    capability_by_type,
    language_capabilities,
).await
```

### 1.3 节点注册处理（`register_node_with_policy`）

**文件**: `central_server/scheduler/src/node_registry/core.rs`

#### 步骤 1: 创建或更新节点

```rust
let node = Node {
    node_id: final_node_id.clone(),
    version,
    platform,
    hardware,
    installed_models,
    installed_services,
    // 注意：capability_by_type 已从 Node 结构体中移除，能力信息存储在 Redis
    language_capabilities,
    // ...
};
```

#### 步骤 2: 更新语言能力索引

```rust
if let Some(ref lang_caps) = language_capabilities {
    self.language_capability_index
        .write()
        .await
        .update_node_capabilities(&final_node_id, lang_caps);
}
```

#### 步骤 3: 同步节点能力到 Redis（如果启用 Phase 2）

```rust
if let Some(rt) = phase2_runtime {
    // 同步节点能力信息（capability_by_type）到 Redis
    if let Some(ref caps) = capability_by_type {
        rt.sync_node_capabilities_to_redis(&node.node_id, caps).await;
    }
}
```

#### 步骤 4: 同步节点快照到 Redis（如果启用 Phase 2）

```rust
if let Some(rt) = phase2_runtime {
    rt.sync_node_snapshot_to_redis(&node).await;
}
```

#### 步骤 5: 同步节点容量到 Redis（如果启用 Phase 2）

```rust
if let Some(rt) = phase2_runtime {
    rt.sync_node_capacity_to_redis(
        &node.node_id,
        node.max_concurrent_jobs,
        node.current_jobs,
        health,
    ).await;
}
```

#### 步骤 6: 分配节点到 Pool（如果启用 Phase 3）

```rust
if cfg.enabled && cfg.mode == "two_level" {
    // 尝试为节点创建或匹配 Pool
    if let Some(pool_id) = self.try_create_pool_for_node(&final_node_id, phase2_runtime).await {
        info!("节点已分配到 Pool {}", pool_id);
    }
    
    // 更新 Pool 索引
    self.phase3_upsert_node_to_pool_index(&final_node_id).await;
    
    // 同步 Pool 成员索引到 Redis
    if let Some(rt) = phase2_runtime {
        let pool_ids = self.phase3_node_pool_ids(&final_node_id).await;
        if !pool_ids.is_empty() {
            rt.sync_node_pools_to_redis(
                &final_node_id,
                &pool_ids,
                &cfg.pools,
                &pool_index,
            ).await;
        }
    }
}
```

### 1.4 动态 Pool 创建（`try_create_pool_for_node`）

**文件**: `central_server/scheduler/src/node_registry/phase3_pool.rs`

**流程**：
1. 获取节点的语义修复服务支持的语言集合
2. 排序语言集合，生成 Pool 名称（如 `en-zh`）
3. 检查 Pool 是否存在
4. 如果不存在，创建新 Pool：
   - 更新本地配置
   - 如果启用 Phase 2，同步到 Redis（Leader 写入）

---

## 二、节点心跳流程

### 2.1 节点发送心跳

**节点端行为**：
- 定期（例如每 2 秒）发送 `NodeMessage::NodeHeartbeat` 消息
- 包含：
  - `resource_usage`: CPU/GPU/内存使用率
  - `installed_models`: 可选的模型更新
  - `installed_services`: 可选的服务更新
  - `capability_by_type`: 能力信息
  - `language_capabilities`: 语言能力信息

### 2.2 服务器处理心跳

**文件**: `central_server/scheduler/src/websocket/node_handler/message/register.rs`

#### 步骤 1: 更新节点心跳信息

```rust
state.node_registry.update_node_heartbeat(
    node_id,
    cpu_percent,
    gpu_percent,
    mem_percent,
    installed_models,
    installed_services,
    running_jobs,
    capability_by_type,
    processing_metrics,
    language_capabilities,
).await;
```

#### 步骤 2: 检测语言能力变化

**内部处理** (`update_node_heartbeat`):
1. 更新节点资源使用率
2. 如果 `installed_services` 或 `capability_state` 变化，触发 Pool 重新分配：
   ```rust
   if language_capabilities_changed {
       // 更新语言能力索引
       self.language_capability_index
           .write()
           .await
           .update_node_capabilities(node_id, &new_lang_caps);
       
       // 重新分配节点到 Pool
       self.phase3_upsert_node_to_pool_index(node_id).await;
       
       // 同步 Pool 成员索引到 Redis
       if let Some(rt) = phase2_runtime {
           // ...
       }
   }
   ```

#### 步骤 3: 同步节点能力到 Redis（如果启用 Phase 2）

```rust
if let Some(rt) = phase2_runtime {
    // 同步节点能力信息（capability_by_type）到 Redis
    if let Some(ref caps) = capability_by_type {
        rt.sync_node_capabilities_to_redis(&node_id, caps).await;
    }
}
```

#### 步骤 4: 同步节点容量到 Redis

```rust
if let Some(rt) = phase2_runtime {
    rt.sync_node_capacity_to_redis(
        &node.node_id,
        node.max_concurrent_jobs,
        node.current_jobs,
        health,
    ).await;
}
```

---

## 三、Pool 生成流程

### 3.1 Pool 生成的触发时机

Pool 生成在以下情况下触发：

1. **节点注册时**（主要时机）
   - 条件：节点的语言集合不在现有 Pool 中
   - 说明：自动为节点创建对应的 Pool

2. **配置更新时**
   - 条件：调用 `set_phase3_config` 且满足自动生成条件

3. **定期清理任务**
   - 条件：检测到空 Pool 时触发重建

### 3.2 Pool 生成详细流程

**文件**: `central_server/scheduler/src/node_registry/auto_language_pool.rs`

**步骤**：

1. **收集所有节点的语言集合**
   ```rust
   let language_sets = self.collect_language_sets(&auto_cfg).await;
   ```
   - 遍历所有节点
   - 获取节点的语义修复服务支持的语言集合
   - 去重并排序

2. **统计每个语言集合的节点数**

3. **过滤语言集合**
   - 只保留节点数 >= `min_nodes_per_pool` 的语言集合

4. **排序**
   - 按节点数降序排序（优先创建节点数多的 Pool）

5. **限制 Pool 数量**
   - 如果语言集合数量 > `max_pools`，只保留前 `max_pools` 个

6. **生成 Pool 配置**
   - 为每个语言集合创建 Pool 配置（名称按字母顺序排序）

7. **更新配置并重建索引**
   ```rust
   phase3.pools = new_pools;
   self.rebuild_phase3_pool_index().await;
   ```

### 3.3 Redis 同步（多实例环境）

如果启用了 Phase 2（多实例模式），Pool 生成会同步到 Redis：

1. **优先从 Redis 读取配置**
   - 如果 Redis 中有配置，直接使用并更新本地配置

2. **尝试成为 Leader**
   - 如果 Redis 中没有配置，尝试获取 Leader 锁

3. **Leader 生成配置**
   - Leader 实例生成 Pool 配置
   - 写入 Redis（包含版本号）
   - 更新本地配置

4. **Follower 同步配置**
   - 非 Leader 实例等待后从 Redis 读取配置
   - 更新本地配置

---

## 四、节点分配到 Pool

### 4.1 分配逻辑

**文件**: `central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`

**步骤**：

1. **检查 Phase 3 是否启用**

2. **自动生成模式**
   ```rust
   if cfg.auto_generate_language_pools {
       let language_index = self.language_capability_index.read().await;
       let pool_id = determine_pool_for_node_auto_mode_with_index(&cfg, n, &language_index);
       // ...
   }
   ```

3. **获取节点的语言集合**
   - 基于语义修复服务支持的语言集合
   - 排序后生成 Pool 名称

4. **匹配 Pool**
   - 查找名称匹配的 Pool
   - 如果不存在，创建新 Pool

5. **更新 Pool 索引**
   - 将节点添加到 Pool 的成员索引中

### 4.2 语言能力要求

**重要说明**：节点端的语言可用性以语义修复服务的能力为准。

**节点匹配规则**：
- 源语言和目标语言都必须在节点的语义修复服务支持的语言列表中
- 同时满足 ASR、TTS、NMT 的语言要求

---

## 五、多实例环境下的同步

### 5.1 节点快照同步

**Phase 2 节点快照同步**：
- 每个实例将本地节点快照写入 Redis（`nodes:all`）
- 各实例后台定期拉取 `nodes:all`，并将快照 upsert 到本地 NodeRegistry
- 当从快照 upsert 节点时，会调用 `phase3_upsert_node_to_pool_index` 更新 Pool 索引

**影响**：
- ✅ 每个实例都能看到所有节点的信息
- ✅ 每个实例都能正确分配节点到 Pool
- ✅ Pool 索引在每个实例中独立维护，但基于相同的节点信息

### 5.2 Pool 配置同步

**Redis 同步机制**：
- **Leader 选举**：使用 Redis 分布式锁确保只有一个实例生成 Pool 配置
- **配置写入**：Leader 实例将 Pool 配置写入 Redis（包含版本号）
- **配置读取**：其他实例从 Redis 读取 Pool 配置并同步到本地
- **版本控制**：使用版本号检测配置更新，定期同步（每 10 秒）

---

## 六、代码位置

- **节点注册处理**：`central_server/scheduler/src/node_registry/core.rs`
- **节点心跳处理**：`central_server/scheduler/src/websocket/node_handler/message/register.rs`
- **Pool 生成逻辑**：`central_server/scheduler/src/node_registry/auto_language_pool.rs`
- **节点分配逻辑**：`central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`
- **动态 Pool 创建**：`central_server/scheduler/src/node_registry/phase3_pool.rs`
- **Redis 同步**：`central_server/scheduler/src/phase2/runtime_routing.rs`

---

**最后更新**: 2026-01-XX
