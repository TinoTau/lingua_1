# Scheduler 架构文档

**版本**: v3.0（MinimalScheduler + Lua Pool）  
**状态**: ✅ 当前实现

---

## 一、总体架构

Scheduler是Lingua系统的核心调度服务，负责：
- 节点注册和生命周期管理
- 任务分发和节点选择
- 会话管理
- 多实例协调（可选）

### 1.1 架构原则

**Redis直查（SSOT）**:
- Redis是唯一真相源（Single Source of Truth）
- 所有状态存储在Redis
- Lua脚本驱动业务逻辑
- 无本地锁和状态

**Lua脚本驱动**:
- 所有Pool操作在Lua中完成
- 原子性保证
- 性能优化（减少网络往返）

---

## 二、核心模块

### 2.1 MinimalSchedulerService

**文件**: `services/minimal_scheduler.rs`

**职责**: Lua脚本加载和执行

**主要方法**:
```rust
// 节点注册
pub async fn register_node(&self, req: RegisterNodeRequest) -> Result<()>
```

**Lua脚本**:
- `register_node_v2.lua` - 节点注册

**注意**: 
- `complete_task()` 方法已删除（complete_task.lua 是空实现，无需调用）
- 节点选择已移至 PoolService.select_node()，使用 `select_node.lua`

### 2.2 PoolService

**文件**: `pool/pool_service.rs`

**职责**: Pool管理和节点选择

**主要方法**:
```rust
// 节点心跳（自动分配Pool）
pub async fn heartbeat(&self, node_id: &str) -> Result<()>

// 节点选择
pub async fn select_node(
    &self,
    src_lang: &str,
    tgt_lang: &str,
    job_id: Option<&str>,  // 用于timeout finalize绑定
) -> Result<String>

// 节点下线（从Pool移除）
pub async fn node_offline(&self, node_id: &str) -> Result<()>
```

**Lua脚本**:
- `heartbeat_with_pool_assign.lua` - 心跳和Pool分配
- `select_node.lua` - 节点选择
- `node_offline.lua` - 节点清理

### 2.3 NodeRegistry

**文件**: `node_registry/core.rs`

**职责**: 节点信息查询（Redis直查）

**主要方法**:
```rust
// 列出所有在线节点
pub async fn list_sched_nodes(&self) -> Result<Vec<SchedNodeInfo>>

// 查询节点详细信息
pub async fn get_node_data(&self, node_id: &str) -> Result<Option<NodeData>>

// 节点选择（内部使用，委托PoolService）
pub async fn select_node_redis_direct(...) -> (Option<String>, NoAvailableNodeBreakdown)
```

**特点**:
- 无本地状态
- Redis直查
- 委托PoolService选择节点

### 2.4 Redis Runtime（Phase2Runtime）

**文件**: `redis_runtime/` 模块

**职责**: 多实例协调（可选）

**主要功能**:
- **实例存在**: Presence心跳
- **Ownership**: 节点/会话所有权
- **消息路由**: Redis Streams跨实例通信
- **Job状态机**: Job FSM管理

**启用条件**: `config.toml: phase2.enabled = true`

---

## 三、关键流程

### 3.1 节点注册流程

#### 详细调用链路

```
WebSocket连接
  └→ handle_node() [websocket/node_handler/connection.rs]
      └→ handle_node_message() [message/mod.rs]
          └→ handle_node_register() [message/register.rs]
              ├─ 步骤1: 生成 node_id
              │   └→ format!("node-{}", uuid::Uuid::new_v4())
              ├─ 步骤2: extract_asr_and_semantic_langs()
              │   └→ 验证语言能力（ASR + Semantic）
              │   └→ Semantic语言必需，不能为空
              ├─ 步骤3: MinimalScheduler.register_node()
              │   └→ eval_script(register_node_v2.lua)
              │       └→ Redis操作（3次，原子执行）:
              │           ├─ HMSET lingua:v1:node:{node_id}
              │           ├─ EXPIRE lingua:v1:node:{node_id} 3600
              │           └─ SADD lingua:v1:nodes:all {node_id}
              ├─ 步骤4: node_connections.register()
              │   └→ 本地WebSocket连接映射
              └─ 步骤5: 发送 node_register_ack
                  └→ 状态: "registering"
```

#### Lua脚本: register_node_v2.lua

**输入参数**:
- `ARGV[1]`: node_id
- `ARGV[2]`: asr_langs_json (例如: `["zh","en","de"]`)
- `ARGV[3]`: semantic_langs_json (例如: `["zh","en"]`)

**Redis操作**:
1. `HMSET lingua:v1:node:{node_id}` - 写入节点信息
2. `EXPIRE lingua:v1:node:{node_id} 3600` - 设置过期时间
3. `SADD lingua:v1:nodes:all {node_id}` - 添加到全局集合

**时间复杂度**: O(1)  
**网络往返**: 1次

#### 后续心跳

```
Node定期心跳（30-60秒）
  └→ handle_node_heartbeat() [message/register.rs]
      └→ PoolService.heartbeat()
          └→ eval_script(heartbeat_with_pool_assign.lua)
              ├─ 更新心跳时间戳
              ├─ 读取语言能力
              ├─ 生成笛卡尔积（ASR × Semantic）
              └─ 为每个语言对分配Pool
                  └→ 写入: lingua:v1:pool:{src}:{tgt}:{pool_id}:nodes
```

### 3.2 任务分发流程

```
1. Session → 发送音频数据
2. create_job_with_minimal_scheduler()
   └→ 生成 pair_key = "{src}:{tgt}"
3. PoolService.select_node(src, tgt, job_id)
   └→ select_node.lua
       ├─ 检查是否已绑定（timeout finalize）
       ├─ 查找非空Pool
       ├─ 随机选择Pool
       ├─ 随机选择节点（SRANDMEMBER）
       └─ 记录绑定（如有job_id）
4. 返回 node_id
5. 投递任务到节点（WebSocket）
```

### 3.3 任务完成流程

```
1. Node → 返回任务结果
2. Scheduler → 接收结果
3. Dispatcher → 更新Job状态（本地）
   └→ jobs.write().await - 更新状态为 Completed/Failed
4. Scheduler → 推送结果到Session
   └→ session_connections.get() + WebSocket发送
```

**注意**: 
- `complete_task()` 调用已删除（complete_task.lua 是空实现）
- 节点槽位由节点端的GPU仲裁器管理，Scheduler不参与

---

## 四、Pool系统

### 4.1 Pool架构

**有向语言对Pool**:
- Key: `lingua:v1:pool:{src}:{tgt}:{pool_id}:nodes`
- 分片: 每个语言对0-999个Pool
- 容量: 每个Pool最多100个节点

**详细说明**: 参考 [POOL_ARCHITECTURE.md](./POOL_ARCHITECTURE.md)

### 4.2 自动分配

**触发**: 节点心跳时自动

**算法**: 
1. 生成笛卡尔积（ASR × Semantic）
2. 为每个语言对查找非满Pool
3. 添加节点到Pool
4. 记录映射关系

---

## 五、配置管理

### 5.1 核心配置

**config.toml**:
```toml
[server]
host = "0.0.0.0"
port = 5010

[scheduler.phase2]
enabled = true  # 必需：启用MinimalScheduler
instance_id = "auto"

[scheduler.phase2.redis]
url = "redis://localhost:6379"
# 或集群模式
# cluster_urls = ["redis://node1:6379", ...]
```

### 5.2 Phase2配置（多实例）

如需多实例部署，启用Phase2：
```toml
[scheduler.phase2]
enabled = true
instance_id = "scheduler-01"  # 或 "auto"
heartbeat_ttl_seconds = 180
owner_ttl_seconds = 300
stream_block_ms = 1000
```

**详细说明**: 参考 [MULTI_INSTANCE_DEPLOYMENT.md](./MULTI_INSTANCE_DEPLOYMENT.md)

---

## 六、数据存储

### 6.1 Redis数据

**唯一真相源**: 所有状态存储在Redis

**Key前缀**: `lingua:v1:*`

**详细说明**: 参考 [REDIS_DATA_MODEL.md](./REDIS_DATA_MODEL.md)

### 6.2 本地状态（极少）

**WebSocket连接**:
```rust
// managers/connection_manager.rs
NodeConnectionManager  // 节点WebSocket连接映射
SessionConnectionManager  // 会话WebSocket连接映射
```

**Job状态（Redis SSOT）**:
```rust
// core/dispatcher/job_redis_repository.rs
JobRedisRepository {
    redis: Arc<RedisHandle>  // Redis连接
}

// Redis Key: lingua:v1:job:{job_id}
// 存储格式: JSON（Job元数据，不包含audio_data）
// TTL: 3600秒
```

**说明**: 
- Job状态存储在Redis中，是SSOT
- audio_data不存储在Job中，从AudioBufferManager获取
- 支持多实例部署，Job状态可跨实例共享

---

## 七、性能特性

### 7.1 Lua脚本优化

**原子性**:
- 单次Lua执行原子
- 无race condition
- 无需应用层锁

**性能**:
- 减少网络往返（多个Redis命令合并为1次）
- O(1)操作（SCARD, SRANDMEMBER）
- 连续空Pool提前退出

### 7.2 TTL自动清理

- 无需手动扫描清理
- 无后台GC任务
- Redis自动过期

### 7.3 随机负载均衡

- 无需维护负载状态
- Pool级随机 + Node级随机
- 自然分布，无热点

---

## 八、监控和可观测性

### 8.1 Prometheus指标

```rust
// metrics/prometheus_metrics.rs
node_registration_total{status}
node_heartbeat_latency_ms
pool_query_total{success}
node_selection_total{result}
```

### 8.2 结构化日志

```rust
// 使用 tracing 框架
info!(step = "register_start", "节点注册开始");
debug!(node_id = %node_id, "节点选择成功");
warn!(error = %e, "Pool选择失败");
```

### 8.3 Dashboard

**Web UI**: `http://localhost:5010/dashboard`

**展示内容**:
- 节点列表和状态
- Pool分布统计
- 任务统计
- 系统健康度

---

## 九、故障处理

### 9.1 节点故障

**检测**: TTL过期（无心跳）

**清理**: Redis自动删除

**恢复**: 节点重启后重新注册

### 9.2 Redis故障

**单机模式**:
- Redis重启 → 所有节点重新注册
- 数据丢失 → 自动恢复（节点心跳）

**集群模式**:
- 节点故障转移
- 数据持久化（AOF/RDB）

### 9.3 Scheduler故障

**单实例**:
- Scheduler重启 → 节点保持注册（Redis中）
- WebSocket断开 → 节点重连

**多实例**:
- 实例下线 → Ownership自动失效
- 客户端重连到其他实例

---

## 十、系统边界

### 10.1 Scheduler职责

✅ **负责**:
- 节点注册和生命周期
- Pool管理（通过Lua）
- 节点选择
- 任务路由
- WebSocket连接管理

❌ **不负责**:
- 任务执行（节点端）
- 模型加载（节点端）
- 容量控制（节点端GPU仲裁器）
- 音频处理（节点端）

### 10.2 节点职责

✅ **负责**:
- 注册到Scheduler
- 定期心跳
- 执行任务
- GPU仲裁（容量控制）
- 模型管理

---

**参考文档**:
- [Pool架构](./POOL_ARCHITECTURE.md)
- [节点注册](../node_registry/node_registration.md)
- [Redis数据模型](./REDIS_DATA_MODEL.md)
- [多实例部署](./MULTI_INSTANCE_DEPLOYMENT.md)
