# NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md
调度服务器节点与任务管理（Lockless 架构合并版）技术规范  
============================================================

本文档整合：

- NODE_AND_JOB_MANAGEMENT_FLOW.mdfileciteturn11file0  
- LOCKLESS_ARCHITECTURE_DESIGN.mdfileciteturn10file1  
- LOCKLESS_REFACTOR_ACTION_PLAN_v1.mdfileciteturn10file2  

并补齐所有缺失内容，形成一份**可直接交给开发部门落地的技术规范 + 任务清单**。

---

# 1. 架构总览（Lockless V3 最终形态）

核心目标：  
调度路径真正做到 **无锁（Lockless）**，所有共享状态不再落在本地内存，而由 Redis 作为唯一真相源，调度器使用 L1/L2 缓存实现高性能查询。

```
Redis —— 单一真相源（强一致写入）
L1 Cache —— 5s TTL（超高速）
L2 Cache —— 30s TTL（降级与容灾）
```

旧结构（ManagementRegistry / SnapshotManager / Phase3PoolIndex / mutex）全部移除。

---

# 2. Redis Schema（完整规范）

## 2.1 Node 信息
```
HSET scheduler:node:info:{node_id}
    online:bool
    cap:json
    cpu:int
    gpu:int
    mem:int
    last_heartbeat_ts:int
    version:int
```

## 2.2 Node runtime（并发控制）
```
HSET scheduler:node:runtime:{node_id}
    current_jobs:int
    max_jobs:int
    health_score:int
```

## 2.3 Pool 成员
```
SMEMBERS scheduler:pool:{pool_id}:members
```

## 2.4 语言索引
```
HSET scheduler:lang:{src}:{tgt}
    pools:json
    version:int
```

## 2.5 Job 信息
```
HSET scheduler:job:{job_id}
    node_id
    session_id
    payload
    status
    created_ts
    ttl
```

## 2.6 Session 状态
```
HSET scheduler:session:{session_id}
    preferred_pool
    lang_pair
    version
```

---

# 3. 节点注册（Lockless 替代流程）

旧流程：  
ManagementRegistry.state.write() 更新节点 → 更新 poolIndex → 更新 snapshot

新流程（完全 Redis）：

```
1. Redis HSET node:info:{node_id}
2. Redis HSET node:runtime:{node_id}
3. SADD pool:{pool_id}:members {node_id}
4. HSET lang:{src}:{tgt}.pools
5. PUBLISH node:update
6. L1/L2 缓存更新
```

无任何锁竞争。

---

# 4. 心跳（Lockless 替代流程）

```
节点 → heartbeat → 调度服务器 → Redis

Redis:
    HSET node:info
    HINCRBY node:runtime current_jobs
    HSET capability
    PUBLISH node:update
```

无 snapshot，无 ManagementRegistry。

---

# 5. PoolIndex（事件驱动）

node/pool 改变 → Redis 更新 → Pub/Sub 通知 → Cache 更新。

替代旧 Phase3PoolIndex / CoreCache / SnapshotManager。

---

# 6. 调度流程（最终版）

```
dispatch(session_id, lang_pair):

1) L1Cache.get(lang_pair) → pool list
       miss → L2 → Redis
2) L1Cache.get(pool:members)
       miss → L2 → Redis
3) L1Cache.get(node:runtime)
4) 过滤 unhealthy 节点
5) Lua try_reserve（并发原子控制）
6) HSET job → Redis
7) 返回 node
```

调度路径不使用任何 Mutex 或 RwLock。

---

# 7. Job FSM（Lockless）

```
Created → Dispatched → Running → Finished → Cleanup
                    ↘
                     Failed / Requeue / Timeout
```

Redis 是全部状态的唯一真相源。

---

# 8. L1/L2 Cache 设计（状态一致性）

## L1 Cache（高频）
- TTL 5 秒  
- 随机偏移 ±15% 防雪崩  
- 命中率目标：95%+

## L2 Cache（降级层）
- TTL 30 秒  
- Redis 故障时使用  
- 定时刷新机制  

## empty-tag（穿透保护）
Redis 不存在 → 写入 empty-tag TTL=1s

---

# 9. Pub/Sub 自动重连机制

必须实现：

```
disconnect → 重连 → 拉取版本 diff → 更新 L1/L2 cache
```

避免 stale cache。

---

# 10. Node HealthScore（建议）

```
health_score = weighted(cpu, gpu, mem, fail_rate, job_latency)
```

调度优先选择健康节点。

---

# 11. 旧结构移除要求（代码清理清单）

**必须移除：**
- ManagementRegistry
- SnapshotManager
- NodeState 本地副本
- Phase3PoolIndex
- SessionMutex
- JobRegistry 本地写锁

调度服务器将不再维护本地“真相”。

---

# 12. 必须补充的内容（之前文档缺失）

### 12.1 Redis 降级策略（必须）
```
Redis timeout → 使用 L2  
Redis 持续失败 → 使用 local-only fallback  
Redis 恢复 → 自动恢复 L1/L2
```

### 12.2 current_jobs 同步规范（必须）
所有并发以 Redis 为准：

```
try_reserve → HINCRBY +1
release → HINCRBY -1
调度路径只读 Redis 或 L1/L2 缓存
```

不再写 NodeRegistry。

### 12.3 Pool 成员增量更新  
只拉取新的 diff，而不是全量。

### 12.4 冷启动预加载  
启动时加载：

- 全体节点  
- 全体 pool   
- 全体 lang-index  

避免启动后 100–300 ms 的抖动。

---

# 13. Lockless 调度路径全流程图

```
          ┌──────────────┐
          │  Web/Client  │
          └──────┬───────┘
                 │
                 ▼
       ┌──────────────────┐
       │ dispatch request │
       └──────┬──────────┘
              ▼
      L1Cache.get(lang_pair)
              │ miss
              ▼
      L2Cache.get(lang_pair)
              │ miss
              ▼
            Redis
              │
              ▼
      池 → 节点列表
              ▼
      节点 runtime 信息(L1/L2/Redis)
              ▼
      try_reserve(Lua)
              ▼
         Redis 写 Job
              ▼
         返回 node_id
```

---

# 14. 开发 Tasklist（分阶段实施）

## Phase 1：基础 Redis 架构  
- [ ] 部署 Redis Cluster  
- [ ] 设计 Redis schema  
- [ ] 实现 Lua 脚本（reserve/release/atomic-write）  
- [ ] Pub/Sub + 自动重连  

## Phase 2：节点与心跳  
- [ ] 注册 → Redis-only  
- [ ] 心跳 → Redis-only  
- [ ] current_jobs → Redis-only  
- [ ] PUBLISH node:update  

## Phase 3：缓存层  
- [ ] L1 Cache  
- [ ] L2 Cache  
- [ ] empty-tag  
- [ ] 缓存 TTL + 随机偏移  
- [ ] 冷启动预加载  

## Phase 4：Pool 与 LangIndex  
- [ ] PoolIndex → Redis  
- [ ] LangIndex → Redis  
- [ ] Diff-based 更新  
- [ ] Pub/Sub 同步  

## Phase 5：Session & Job  
- [ ] Session state → Redis  
- [ ] 移除 SessionMutex  
- [ ] Job FSM → Redis  
- [ ] remove JobRegistry  

## Phase 6：调度器重写  
- [ ] 全部使用 L1/L2 → Redis  
- [ ] try_reserve 集成  
- [ ] 选择器（健康度、current_jobs）  

## Phase 7：监控 / 灰度  
- [ ] cache_hit_rate  
- [ ] redis_failure_rate  
- [ ] pool_consistency_delay  
- [ ] multi-instance consistency  
- [ ] 灰度发布  

---

# 15. 上线 Checklist（必须全部通过）

### Redis
- [ ] 所有写入使用 Lua 原子脚本  
- [ ] 所有 key 使用统一 hash tag  
- [ ] TTL 正常  

### 缓存
- [ ] L1 命中率 >= 95%  
- [ ] L2 可用  
- [ ] 冷启动预加载成功  

### 调度路径
- [ ] 无 Mutex  
- [ ] 无地方访问 SnapshotManager  
- [ ] 调度延迟 P99 < 50ms  
- [ ] try_reserve/release 状态正确（无负 current_jobs）  

### Pool / LangIndex
- [ ] 更新延迟 < 1s  
- [ ] diff-based 更新正确  

---

# 16. 结语

该文档已整合你所有已有设计，并补全所有缺失内容，形成一份可直接用于开发落地的 Lockless 调度架构规范。

