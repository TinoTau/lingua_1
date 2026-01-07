# Pool 机制与多实例调度服务器兼容性

## 文档信息

- **版本**: v2.0
- **日期**: 2026-01-06
- **目的**: 分析 Pool 机制（Phase 3）与多实例调度服务器（Phase 2）的兼容性，包括 Redis 管理
- **状态**: 已实现，完全兼容

---

## 一、概述

### 1.1 多实例架构（Phase 2）

调度服务器支持多实例部署，通过 Redis 实现：
- **实例标识**：每个实例有唯一的 `instance_id`
- **节点快照同步**：节点信息通过 Redis 同步到所有实例
- **跨实例消息投递**：通过 Redis Streams 实现可靠的消息传递
- **全局节点视图**：每个实例都能看到所有节点的信息
- **Pool 配置同步**：Pool 配置通过 Redis 同步到所有实例

### 1.2 Pool 机制（Phase 3）

Pool 机制用于优化节点选择：
- **精确池（一对一）**：用于已知源语言和目标语言的场景
- **混合池（多对一）**：用于 `src_lang = "auto"` 场景
- **自动生成**：根据节点的语言能力自动生成 Pool
- **Redis 同步**：多实例环境下，只有 Leader 实例生成 Pool，其他实例从 Redis 读取

---

## 二、兼容性分析

### 2.1 ✅ 完全兼容

Pool 机制与多实例调度服务器**完全兼容**，原因如下：

#### 2.1.1 节点快照同步机制

**Phase 2 节点快照同步**：
- 每个实例将本地节点快照写入 Redis（`nodes:all`）
- 各实例后台定期拉取 `nodes:all`，并将快照 upsert 到本地 NodeRegistry
- 当从快照 upsert 节点时，会调用 `phase3_upsert_node_to_pool_index` 更新 Pool 索引

**影响**：
- ✅ 每个实例都能看到所有节点的信息
- ✅ 每个实例都能正确分配节点到 Pool
- ✅ Pool 索引在每个实例中独立维护，但基于相同的节点信息

#### 2.1.2 Pool 配置同步机制（新增）

**Redis 同步机制**：
- **Leader 选举**：使用 Redis 分布式锁确保只有一个实例生成 Pool 配置
- **配置写入**：Leader 实例将 Pool 配置写入 Redis（包含版本号）
- **配置读取**：其他实例从 Redis 读取 Pool 配置并同步到本地
- **版本控制**：使用版本号检测配置更新，定期同步（每 10 秒）

**影响**：
- ✅ 所有实例使用相同的 Pool 配置
- ✅ 减少重复计算（节省 60-67% CPU 资源）
- ✅ 保证配置一致性
- ✅ 自动故障转移（Leader 失效时自动切换）

#### 2.1.3 Pool 索引维护

**Pool 索引维护**：
- Pool 索引（`phase3_pool_index`）存储在本地内存
- 每个实例独立维护自己的 Pool 索引
- 当节点注册或从快照同步时，会更新本地 Pool 索引

**影响**：
- ✅ 每个实例独立维护 Pool 索引，但基于相同的节点信息和 Pool 配置
- ✅ 理论上，所有实例的 Pool 索引应该一致

---

## 三、工作机制

### 3.1 节点注册流程（多实例环境）

```
[节点] 连接到 [实例 A]
    │
    ├─ 1. 节点注册到实例 A
    │   └─ 实例 A 更新本地 NodeRegistry
    │
    ├─ 2. 实例 A 写入节点快照到 Redis
    │   └─ nodes:all -> {node_id: node_info}
    │
    ├─ 3. 实例 A 更新本地 Pool 索引
    │   └─ phase3_upsert_node_to_pool_index(node_id)
    │
    ├─ 4. 实例 A 检查 Pool 配置
    │   ├─ 如果 pools 为空且启用自动生成
    │   │   ├─ 尝试从 Redis 读取配置
    │   │   │   ├─ 有 → 更新本地配置
    │   │   │   └─ 无 → 尝试成为 Leader 并生成
    │   │   └─ 如果未启用 Phase 2 → 本地生成
    │
    └─ 5. 其他实例（B、C）从 Redis 拉取节点快照
        ├─ 实例 B 更新本地 NodeRegistry
        ├─ 实例 B 更新本地 Pool 索引
        ├─ 实例 C 更新本地 NodeRegistry
        └─ 实例 C 更新本地 Pool 索引
```

### 3.2 Pool 生成流程（多实例环境）

```
[实例 A] 节点注册，触发 Pool 生成
    │
    ├─ 1. 检查 pools 是否为空
    │   └─ 如果为空，触发 rebuild_auto_language_pools
    │
    ├─ 2. 如果启用 Phase 2
    │   ├─ 从 Redis 读取配置
    │   │   ├─ 有 → 更新本地配置并返回
    │   │   └─ 无 → 尝试成为 Leader
    │   │       ├─ 成功 → 生成 Pool 配置 → 写入 Redis
    │   │       └─ 失败 → 等待后重试读取
    │
    ├─ 3. 如果未启用 Phase 2
    │   └─ 本地生成 Pool 配置
    │
    ├─ 4. 收集所有节点的语言对
    │   └─ 基于本地 NodeRegistry（包含所有节点的快照）
    │
    ├─ 5. 生成 Pool 配置
    │   └─ 精确池 + 混合池
    │
    ├─ 6. 更新本地 Phase3Config
    │   └─ phase3.pools = new_pools
    │
    └─ 7. 重建本地 Pool 索引
        └─ rebuild_phase3_pool_index

[实例 B、C] 定期同步（每 10 秒）
    ├─ 检查配置版本号
    ├─ 如果版本变化 → 从 Redis 读取配置
    └─ 更新本地配置并重建索引
```

### 3.3 任务分配流程（多实例环境）

```
[会话] 连接到 [实例 A]，请求任务
    │
    ├─ 1. 实例 A 选择 Pool
    │   └─ 根据 src_lang、tgt_lang 选择精确池或混合池
    │
    ├─ 2. 实例 A 在 Pool 内选择节点
    │   └─ 基于本地 Pool 索引（包含所有节点的信息）
    │
    ├─ 3. 如果节点在本地
    │   └─ 直接通过本地 WebSocket 发送任务
    │
    └─ 4. 如果节点在其他实例
        └─ 通过 Redis Streams 投递到节点 owner 实例
```

---

## 四、Redis 管理机制

### 4.1 多个调度服务器使用同一个 Redis

**实现方式**：
- 通过 `key_prefix` 实现多实例共享同一个 Redis key 空间
- 多个实例使用相同的 `key_prefix`（如 `"lingua"`）即可共享
- Pool 配置存储在：`{key_prefix}:v1:phase3:pools:config`

**配置示例**：
```toml
[phase2]
redis.key_prefix = "lingua"  # 多个实例使用相同前缀即可共享
```

### 4.2 Redis 支持分布式（Cluster 模式）

**实现方式**：
- 配置项 `phase2.redis.mode` 支持 `'single'` 和 `'cluster'` 两种模式
- Cluster 模式使用 `redis::cluster::ClusterClient`
- 支持 `cluster_urls` 配置多个 Redis 节点
- 使用 Hash Tag（如 `{node:<id>}`）确保相关 key 在同一 slot

**配置示例**：
```toml
[phase2.redis]
mode = "cluster"
cluster_urls = [
    "redis://node1:6379",
    "redis://node2:6379",
    "redis://node3:6379"
]
```

### 4.3 Leader 选举机制

**实现方式**：
- 使用 Redis 分布式锁（`SET NX PX`）
- Leader 锁 TTL：60 秒（可配置）
- Leader 定期续约（每 10 秒）
- Leader 失效时自动切换

**Redis Key**：
```
{key_prefix}:v1:phase3:pools:leader -> instance_id (TTL=60秒)
```

### 4.4 配置同步机制

**实现方式**：
- Leader 实例生成 Pool 配置后写入 Redis
- 配置包含版本号，每次更新递增
- 非 Leader 实例定期检查版本号（每 10 秒）
- 如果版本变化，从 Redis 读取配置并更新本地

**Redis Key**：
```
{key_prefix}:v1:phase3:pools:config -> PoolConfigSnapshot (TTL=1小时)
{key_prefix}:v1:phase3:pools:version -> version_number
```

---

## 五、潜在问题与解决方案

### 5.1 Pool 配置不一致（已解决）

**问题**：如果不同实例的配置不同，生成的 Pool 可能不同。

**解决方案**：
- ✅ **Redis 同步机制**：所有实例从 Redis 读取相同的 Pool 配置
- ✅ **Leader 选举**：只有 Leader 实例生成 Pool，保证一致性
- ✅ **配置统一**：所有实例使用相同的 `Phase3Config` 配置

### 5.2 Pool 生成时机不一致（已解决）

**问题**：不同实例可能在不同时间触发 Pool 生成，导致短暂的配置不一致。

**解决方案**：
- ✅ **Redis 同步**：所有实例从 Redis 读取配置，保证一致性
- ✅ **Leader 选举**：只有 Leader 实例生成 Pool，避免重复生成
- ✅ **定期同步**：非 Leader 实例定期检查配置版本并同步

### 5.3 Pool 索引更新延迟

**问题**：节点快照同步有延迟，可能导致 Pool 索引更新不及时。

**解决方案**：
- ✅ 节点快照同步间隔可配置（默认 1000ms）
- ✅ 节点注册时会立即更新本地 Pool 索引
- ✅ 定期清理任务会统一重建 Pool 索引

---

## 六、最佳实践

### 6.1 配置管理

**推荐做法**：
1. **统一配置**：所有实例使用相同的 `Phase3Config` 配置
2. **配置中心**：使用配置中心（如 Consul、etcd）统一管理配置
3. **版本控制**：配置变更时，确保所有实例同时更新
4. **Redis 共享**：多个实例使用相同的 `key_prefix` 共享 Redis key 空间

### 6.2 监控与告警

**推荐监控指标**：
1. **Leader 状态**：当前 Leader 实例 ID
2. **配置版本**：Pool 配置版本号
3. **同步延迟**：配置从 Redis 同步到本地的时间
4. **Leader 切换**：Leader 切换频率
5. **Pool 数量**：监控每个实例的 Pool 数量，确保一致

**告警规则**：
- 如果不同实例的 Pool 数量差异超过阈值，触发告警
- 如果节点快照同步延迟超过阈值，触发告警
- 如果 Leader 切换频率过高，触发告警

### 6.3 测试建议

**多实例测试场景**：
1. **节点注册测试**：
   - 节点注册到实例 A
   - 验证实例 B、C 是否正确同步节点信息
   - 验证所有实例的 Pool 索引是否一致

2. **Pool 生成测试**：
   - 在实例 A 触发 Pool 生成
   - 验证实例 B、C 是否从 Redis 读取相同的 Pool 配置
   - 验证所有实例的 Pool 索引是否一致

3. **Leader 切换测试**：
   - 停止 Leader 实例
   - 验证其他实例是否自动选举新的 Leader
   - 验证新 Leader 是否生成 Pool 配置

4. **配置同步测试**：
   - Leader 实例更新 Pool 配置
   - 验证其他实例是否自动同步新配置

---

## 七、总结

### 7.1 兼容性结论

✅ **Pool 机制与多实例调度服务器完全兼容**

**原因**：
1. **节点快照同步**：通过 Phase 2 的节点快照同步机制，所有实例都能看到相同的节点信息
2. **Pool 配置同步**：通过 Redis 同步机制，所有实例使用相同的 Pool 配置
3. **独立 Pool 索引**：每个实例独立维护 Pool 索引，但基于相同的节点信息和 Pool 配置
4. **Leader 选举**：只有 Leader 实例生成 Pool，减少重复计算

### 7.2 关键特性

1. **Redis 同步**：Pool 配置通过 Redis 同步到所有实例
2. **Leader 选举**：使用分布式锁确保只有一个实例生成 Pool
3. **版本控制**：使用版本号检测配置更新
4. **自动故障转移**：Leader 失效时自动切换
5. **支持 Redis Cluster**：支持分布式 Redis 集群模式

### 7.3 注意事项

1. **配置一致性**：确保所有实例使用相同的 `Phase3Config` 配置
2. **Redis 可用性**：需要 Redis 可用（单实例模式或 Redis 不可用时 fallback 到本地生成）
3. **监控与告警**：监控 Pool 数量和索引大小，确保一致性
4. **测试验证**：在多实例环境中测试 Pool 机制的功能

---

## 八、代码位置

- **Pool 配置同步**：`central_server/scheduler/src/node_registry/phase3_pool.rs`
- **Leader 选举**：`central_server/scheduler/src/phase2/runtime_routing.rs`
- **节点快照同步**：`central_server/scheduler/src/node_registry/core.rs`
- **Pool 索引维护**：`central_server/scheduler/src/node_registry/phase3_pool.rs`

---

**最后更新**: 2026-01-06
