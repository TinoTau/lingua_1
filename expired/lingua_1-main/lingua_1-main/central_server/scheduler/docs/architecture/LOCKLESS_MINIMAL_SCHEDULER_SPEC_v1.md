# LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md
无锁极简调度服务器技术规范（Minimal Lockless Scheduler）
====================================================

> **⚠️ 迁移状态**: 旧方法已标记为废弃，新实现已就绪，待完整迁移  
> **参考**: `docs/implementation/MIGRATION_TO_LOCKLESS.md`

本文档给出的，是一份 **可开发、可落地的"极简无锁版调度服务器"规范**：

- 不依赖任何业务层面的 Mutex/RwLock
- 不维护本地全局状态（节点表 / 任务表 / 会话表）
- 所有共享状态统一存入 Redis
- 所有并发控制统一通过 Redis 原子操作（Lua / 原子指令）完成
- 调度服务器代码逻辑尽可能“直线化”，方便排查问题

目标：  
在开发资源有限的前提下，优先保证 **架构简单、逻辑清晰、易于定位问题**，而不是堆叠复杂保护机制。

---

# 1. 总体架构原则

1. **Redis 是唯一真相源（Single Source of Truth）**

   - 节点信息、节点负载、并发状态
   - 池成员（pool members）、语言索引（lang → pools）
   - 任务（job）、会话（session）的状态

   全部只在 Redis 中保存，调度进程不保存长期共享状态。

2. **调度进程不使用任何业务级锁**

   - 不允许出现 `RwLock<ManagementState>`、`Mutex<JobTable>`、`Mutex<SessionState>` 等结构。
   - Rust 代码使用的全部是：
     - 普通临时局部变量
     - Redis 客户端
     - 纯函数（参数 → 返回值）
   - 并发控制完全靠 Redis 事务。

3. **关键流程全部建模为少数几个 Redis 事务**

   系统只需要 4 条核心业务流，每条业务流对应 1 个 Redis 事务（推荐 Lua 实现）：

   1. 节点注册：`lua_register_node`
   2. 节点心跳：`lua_heartbeat`
   3. 任务调度：`lua_dispatch_task`
   4. 任务完成：`lua_complete_task`

   调度器的核心工作就是：解析 HTTP 请求 → 调用对应 Lua → 返回结果。

---

# 2. Redis Key 设计（极简版）

以下为 **必须的最小 Key 集合**，字段可按实际需要扩展，但结构尽量保持不变。

## 2.1 节点信息（Node Info）

```text
HSET scheduler:node:info:{node_id}
    online: "true" / "false"
    cap_json: string (节点能力 JSON，包含支持语言、服务类型等)
    max_jobs: integer (允许的最大并发任务数)
    last_heartbeat_ts: integer (Unix 时间戳)
```

说明：

- 这里不区分“静态配置”和“动态信息”，统一写在一个 Hash 内，便于查询。

---

## 2.2 节点运行状态（Node Runtime）

```text
HSET scheduler:node:runtime:{node_id}
    current_jobs: integer (当前占用的并发槽数)
```

说明：

- `current_jobs` 只在 Redis 中维护，所有加减通过 HINCRBY 完成。
- Rust 侧不再维护并发计数。

---

## 2.3 池成员（Pool Members）

```text
SADD scheduler:pool:{pool_id}:members {node_id}
SREM scheduler:pool:{pool_id}:members {node_id}
SMEMBERS scheduler:pool:{pool_id}:members
```

说明：

- 每个 pool 代表一种业务维度（例如：某组语义修复能力 + 部署区域）。
- 成员变动只在 Redis 进行。

---

## 2.4 语言索引（Language Index）

```text
HSET scheduler:lang:{src_lang}:{tgt_lang}
    pools_json: string (JSON 数组，列出可以处理该语言对的 pool_id 列表)
```

说明：

- 语言对 → pool 列表 的映射在 Redis 中维护。
- 更新语言能力时，更新对应 key 的 pools_json。

---

## 2.5 任务（Job）

```text
HSET scheduler:job:{job_id}
    node_id: string
    session_id: string
    src_lang: string
    tgt_lang: string
    payload_json: string
    status: string ("created" / "dispatched" / "running" / "finished" / "failed")
    created_ts: integer
```

说明：

- 本设计中允许简单化：Job 记录只用于追踪当前会话/节点状态和基本审计。
- 若后期要做持久化，可以通过 Redis Stream/持久存储扩展。

---

## 2.6 会话（Session，可选）

```text
HSET scheduler:session:{session_id}
    preferred_pool: string (最近一次用于该 session 的 pool_id)
    last_lang_pair: string (例如 "en->zh")
```

说明：

- 仅用于 Sticky Pool（同一个 session 尽量使用同一个 pool），可选。
- 如果不需要 Sticky 行为，可以不使用该 key。

---

# 3. 核心流程 1：节点注册 `lua_register_node`

## 3.1 调用方式（Rust 侧）

```rust
async fn register_node(req: RegisterNodeRequest) -> Result<()> {
    // 不做任何本地状态维护，直接传给 Redis 脚本
    redis.eval::<_, ()>(
        "lua_register_node",
        &[],
        &[ /* node_id, cap_json, max_jobs, pools_json 等 */ ],
    ).await?;
    Ok(())
}
```

## 3.2 Lua 事务逻辑（伪代码）

```lua
-- KEYS: (可为空，使用 ARGV)
-- ARGV: node_id, cap_json, max_jobs, pools_json(可选), pools_for_lang_pairs(可选)

local node_id      = ARGV[1]
local cap_json     = ARGV[2]
local max_jobs     = tonumber(ARGV[3])

-- 1. 写入节点信息
redis.call("HSET", "scheduler:node:info:" .. node_id,
    "online", "true",
    "cap_json", cap_json,
    "max_jobs", max_jobs,
    "last_heartbeat_ts", tostring(redis.call("TIME")[1])
)

-- 2. 初始化运行状态
redis.call("HSET", "scheduler:node:runtime:" .. node_id,
    "current_jobs", 0
)

-- 3. 根据能力更新 pool 成员 / 语言索引
--    实际逻辑视项目配置而定，这里只保留接口位置
--    例如:
--    for each pool_id in pools_for_node:
--        SADD scheduler:pool:{pool_id}:members node_id
--    for each (src,tgt) supported:
--        读 scheduler:lang:{src}:{tgt}.pools_json
--        更新 JSON 数组并写回 HSET

return "OK"
```

说明：

- **不需要任何 Rust 锁**，所有更新由这一个 Lua 脚本完成。
- 若后续 pool / 语言索引逻辑复杂，可以拆出第二个 Lua，但仍然保持“节点注册不依赖本地状态”。

---

# 4. 核心流程 2：心跳 `lua_heartbeat`

## 4.1 调用方式（Rust 侧）

```rust
async fn heartbeat(req: HeartbeatRequest) -> Result<()> {
    redis.eval::<_, ()>(
        "lua_heartbeat",
        &[],
        &[ /* node_id, online_flag, cpu, gpu, mem 等 */ ],
    ).await?;
    Ok(())
}
```

## 4.2 Lua 事务逻辑（伪代码）

```lua
local node_id  = ARGV[1]
local online   = ARGV[2]  -- "true" / "false"
local load     = ARGV[3]  -- 可选，负载或健康信息的 JSON

redis.call("HSET", "scheduler:node:info:" .. node_id,
    "online", online,
    "last_heartbeat_ts", tostring(redis.call("TIME")[1]),
    "cap_json", load  -- 或写入其他运行信息
)

return "OK"
```

说明：

- 心跳只更新节点的状态和最后心跳时间。
- 如需要调整 `max_jobs` 或 health_score，也可以在这里写入。
- **不触发任何本地池重建 / 快照更新逻辑。**

---

# 5. 核心流程 3：任务调度 `lua_dispatch_task`

这是整个架构最重要的一步，目标是：

- 在一个 Redis 脚本里完成：
  - 选择 pool（可利用 session.preferred_pool）
  - 从 pool 里挑一个可用节点
  - 为该节点占用一个并发槽（`current_jobs + 1`）
  - 创建 job 记录

## 5.1 调用方式（Rust 侧）

```rust
async fn dispatch_task(req: DispatchRequest) -> Result<DispatchResponse> {
    let result: (String, String) = redis.eval(
        "lua_dispatch_task",
        &[],
        &[
            &req.session_id,
            &req.src_lang,
            &req.tgt_lang,
            &req.payload_json,
        ],
    ).await?;
    let (node_id, job_id) = result;
    Ok(DispatchResponse { node_id, job_id })
}
```

## 5.2 Lua 事务逻辑（伪代码）

```lua
local session_id = ARGV[1]
local src        = ARGV[2]
local tgt        = ARGV[3]
local payload    = ARGV[4]

-- 1. 读取会话绑定的 preferred_pool（如果存在）
local session_key = "scheduler:session:" .. session_id
local preferred_pool = redis.call("HGET", session_key, "preferred_pool")

-- 2. 若没有 preferred_pool，则根据语言索引选择一个 pool
if not preferred_pool then
    local lang_key = "scheduler:lang:" .. src .. ":" .. tgt
    local pools_json = redis.call("HGET", lang_key, "pools_json")
    if not pools_json then
        return { err = "NO_POOL_FOR_LANG_PAIR" }
    end
    -- 解析 pools_json（此处省略 JSON 解析伪代码）
    -- 选择一个 pool_id（可随机 / 固定顺序）
    preferred_pool = choose_pool_from(pools_json)
    -- 写回 session 绑定（可选）
    redis.call("HSET", session_key,
        "preferred_pool", preferred_pool,
        "last_lang_pair", src .. "->" .. tgt
    )
end

-- 3. 从该 pool 获取节点集合
local pool_key = "scheduler:pool:" .. preferred_pool .. ":members"
local nodes = redis.call("SMEMBERS", pool_key)
if not nodes or #nodes == 0 then
    return { err = "EMPTY_POOL" }
end

-- 4. 在节点集合里挑选一个可用节点
local chosen_node_id = nil
for i = 1, #nodes do
    local node_id = nodes[i]
    local rt_key = "scheduler:node:runtime:" .. node_id
    local current_jobs = tonumber(redis.call("HGET", rt_key, "current_jobs") or "0")
    local max_jobs     = tonumber(redis.call("HGET", "scheduler:node:info:" .. node_id, "max_jobs") or "0")
    if current_jobs < max_jobs then
        chosen_node_id = node_id
        break
    end
end

if not chosen_node_id then
    return { err = "NO_AVAILABLE_NODE" }
end

-- 5. 为该节点占用一个并发槽
local rt_key = "scheduler:node:runtime:" .. chosen_node_id
redis.call("HINCRBY", rt_key, "current_jobs", 1)

-- 6. 创建 job 记录
local job_id = session_id .. ":" .. tostring(redis.call("INCR", "scheduler:job:id_seq"))
local job_key = "scheduler:job:" .. job_id
redis.call("HSET", job_key,
    "node_id", chosen_node_id,
    "session_id", session_id,
    "src_lang", src,
    "tgt_lang", tgt,
    "payload_json", payload,
    "status", "created",
    "created_ts", tostring(redis.call("TIME")[1])
)

return { chosen_node_id, job_id }
```

说明：

- 所有节点选择、并发占用、job 创建都在一个脚本里完成，**无本地锁**。
- 若语言索引中没有 pool 或 pool 为空，会立即返回错误，方便上层逻辑处理。

---

# 6. 核心流程 4：任务完成 `lua_complete_task`

## 6.1 调用方式（Rust 侧）

```rust
async fn complete_task(req: CompleteTaskRequest) -> Result<()> {
    redis.eval::<_, ()>(
        "lua_complete_task",
        &[],
        &[
            &req.job_id,
            &req.node_id,
            &req.status,  // "finished" / "failed"
        ],
    ).await?;
    Ok(())
}
```

## 6.2 Lua 事务逻辑（伪代码）

```lua
local job_id  = ARGV[1]
local node_id = ARGV[2]
local status  = ARGV[3]

local job_key = "scheduler:job:" .. job_id
local job_node_id = redis.call("HGET", job_key, "node_id")

-- 1. 校验 job 是否属于该节点（防止错误回调）
if job_node_id ~= node_id then
    return { err = "NODE_MISMATCH" }
end

-- 2. 更新 job 状态
redis.call("HSET", job_key, "status", status)

-- 3. 释放节点并发槽
local rt_key = "scheduler:node:runtime:" .. node_id
redis.call("HINCRBY", rt_key, "current_jobs", -1)

return "OK"
```

说明：

- 完成逻辑也不依赖本地 job 表。
- 若后续需要做超时重试/重排，可在 Redis 侧单独做后台扫描。

---

# 7. Rust 侧调度器形态（极简版）

在上述设计下，调度器的 Rust 代码可以非常简单，形态类似：

```rust
struct SchedulerService {
    redis: RedisClient,
}

impl SchedulerService {
    async fn register_node(&self, req: RegisterNodeRequest) -> Result<()> {
        self.redis.eval("lua_register_node", &[], &req.to_argv()).await
    }

    async fn heartbeat(&self, req: HeartbeatRequest) -> Result<()> {
        self.redis.eval("lua_heartbeat", &[], &req.to_argv()).await
    }

    async fn dispatch_task(&self, req: DispatchRequest) -> Result<DispatchResponse> {
        let (node_id, job_id): (String, String) =
            self.redis.eval("lua_dispatch_task", &[], &req.to_argv()).await?;
        Ok(DispatchResponse { node_id, job_id })
    }

    async fn complete_task(&self, req: CompleteTaskRequest) -> Result<()> {
        self.redis.eval("lua_complete_task", &[], &req.to_argv()).await
    }
}
```

**没有任何业务级锁，所有逻辑都一眼能看完。**

---

# 8. 后续可选扩展点（可完全忽略，等有需要再做）

在这一版极简规范基础上，如果后续遇到实际瓶颈，再考虑：

1. 增加只读缓存（L1：节点 runtime、本地 pool members）
2. 增加健康评分（health_score）用于节点排序
3. 增加 job TTL 和过期扫描
4. 增加监控（Lua 耗时、Redis QPS 等）

这些扩展都可以在不改变“无锁 + Redis 为真相源”前提下逐步加上。

---

# 9. 总结

这份规范刻意保持：

- **流程数量少**：仅 4 条核心业务流  
- **结构简单**：所有状态都在 Redis，key 结构固定  
- **代码直线**：Rust 侧不管理复杂状态、不使用锁，只负责调用 Redis 事务  

开发部门只要按这份规范实现：

- 一组 Lua 脚本
- 一组极简 Rust API 封装

即可完成一个 **不依赖任何锁的调度服务器**，并且逻辑简单到足以快速排查问题。
