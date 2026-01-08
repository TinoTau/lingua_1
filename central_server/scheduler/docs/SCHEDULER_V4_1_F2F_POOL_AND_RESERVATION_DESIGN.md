# Scheduler v4.1（面对面模式）任务分配与节点池管理技术方案  
（多实例 + Redis 同步；随机分配；预留指定节点路径；语义修复必选）

> 适用范围：**面对面模式（两种语言互译）**，每个 utterance 形成一个任务，任务方向为 `A->B` 或 `B->A`。  
> 关键约束：  
> - **语义修复（Semantic Repair）为硬门槛**，语言可用性以 `semantic_langs` 为准。  
> - **调度服务多实例**，通过 **Redis** 同步状态与并发控制。  
> - **默认不做会话粘性**：同一 session 尽量随机选择节点，避免用户信息长期固定落在同一节点。  
> - 预留“用户指定节点处理”的流程路径（暂不实现 UI/产品，但接口与校验路径要留好）。  

---

## 1. 设计目标

1. **正确性与安全性**  
   - 不超卖节点：节点不会因被多个池/多个实例同时选中而超过 `max_concurrent_jobs`。  
   - 默认**随机**选择节点（无 session 固定绑定）。  
   - 预留“用户指定节点”能力，并提供严格校验与回退。

2. **工程可落地与可扩展**  
   - 节点注册后可快速加入多个池（池可重叠）。  
   - 多实例调度依赖 Redis 做一致性预留（reservation）。

3. **低复杂度（面对面 MVP）**  
   - 池规模仅涉及 `A->B` 与 `B->A`（或更通用 `src->tgt`），无需引入 `src=auto` 混合池。

---

## 2. 核心思想

- **Pool（节点池）是索引，不是并发控制点。**  
  节点可属于多个池（重叠）。  
- **并发控制必须在 Node 级别全局生效。**  
  通过 `try_reserve(node_id)` 做原子预留，保证跨调度实例一致。  
- **随机选择 + 原子预留 = 安全且不粘性。**  
  从候选集随机采样若干节点，依次尝试 `try_reserve`，成功即派发。

---

## 3. 模块划分（Scheduler 服务端）

### 3.1 模块清单

1. **NodeRegistry**
   - 处理节点注册/心跳
   - 维护节点能力（semantic/nmt/tts 等）与健康状态
   - 更新池成员关系（pool membership）

2. **PoolIndex**
   - 维护 `pool_members[(src,tgt)] -> set(node_id)`  
   - 支持查询候选节点集合、随机采样

3. **ReservationManager（关键）**
   - 提供 `try_reserve / commit / release`  
   - 使用 Redis Lua 实现跨实例并发安全
   - 维护 reservation TTL 防止泄漏

4. **Dispatcher**
   - 向节点下发任务（HTTP/WS）
   - 处理 ACK、超时、重试、回收 reservation

5. **JobManager**
   - 生成 `job_id`、记录任务状态
   - 状态机驱动重试/失败返回

6. **PolicyEngine**
   - 默认随机策略（无 session affinity）
   - 指定节点策略（预留路径）
   - 黑名单/降级策略（可选）

7. **Observability**
   - 指标：reserve 成功率、pool 空、派发延迟、ACK 超时、node 过载拒绝等
   - 日志：job_id / node_id / attempt_id / reason

---

## 4. 数据结构与 Redis Key 设计

> 说明：Redis 作为共享状态存储与并发控制基础设施。  
> 建议所有 key 加统一前缀，例如 `sched:`。

### 4.1 节点能力与状态

**Redis Hash：节点元数据（可选持久化）**
- Key：`sched:node:{node_id}:meta`
- Fields（示例）：
  - `health` = `ready|degraded|draining|offline`
  - `semantic_langs` = JSON array / comma string（建议 JSON）
  - `nmt_pairs` = JSON（或 any-to-any 标记）
  - `tts_langs` = JSON
  - `max_concurrent_jobs` = int
  - `last_heartbeat_ms` = epoch ms

**Redis Hash：节点服务能力（新增，v4.1 设计）**
- Key：`sched:node:{node_id}:capabilities`
- Fields：
  - `asr` = `"true"` | `"false"`（字符串格式）
  - `nmt` = `"true"` | `"false"`
  - `tts` = `"true"` | `"false"`
  - `tone` = `"true"` | `"false"`
  - `semantic` = `"true"` | `"false"`
- TTL：1 小时（与节点容量信息一致）

> **重要变更（v4.1）**：
> - 节点服务能力信息（`capability_by_type`）已从内存中的 `Node` 结构体迁移到 Redis
> - 所有节点能力查询都从 Redis 读取，确保多实例间的一致性
> - 节点注册和心跳时，能力信息会同步到 Redis
> - 这样可以减少内存占用，避免序列化处理，并保证多实例间的一致性

### 4.2 Node 并发计数（Reservation / Running）

**Redis Hash：节点并发计数（并发安全的单点来源）**
- Key：`sched:node:{node_id}:cap`
- Fields：
  - `max` = int
  - `running` = int
  - `reserved` = int

> `effective_load = running + reserved`  
> `effective_load < max` 才允许 reserve。

### 4.3 Reservation 记录（防泄漏 / 可追踪）

**Redis String（或 Hash）：单个 reservation**
- Key：`sched:resv:{resv_id}`
- Value：JSON（建议）：
  - `node_id`
  - `job_id`
  - `attempt_id`
  - `created_ms`
  - `ttl_ms`

并设置 **TTL**（例如 3000–8000ms，取决于派发 ACK 时延）。

> `resv_id` 建议格式：`{job_id}:{attempt_id}:{node_id}` 或 UUID。

### 4.4 Pool 成员索引

**Redis Set：池成员集合**
- Key：`sched:pool:{src}:{tgt}:members`
- Members：`node_id`

> 面对面只会涉及少量池，但设计保持通用。

### 4.5 Job 状态（可选）

**Redis Hash：任务状态**
- Key：`sched:job:{job_id}`
- Fields：
  - `state`（见状态机）
  - `room_id/session_id`
  - `src` / `tgt`
  - `node_id`（若已分配）
  - `attempt`（当前 attempt_id）
  - `updated_ms`

> 如果你已有独立 Job 存储，可不使用 Redis 存 job，只用来做“派发幂等”。

---

## 5. 接口设计（HTTP 示例）

### 5.1 节点注册与心跳

**POST** `/v1/node/register`
```json
{
  "node_id": "node-123",
  "health": "ready",
  "semantic_langs": ["en","zh"],
  "nmt_pairs": [["en","zh"],["zh","en"]],
  "tts_langs": ["en","zh"],
  "max_concurrent_jobs": 2
}
```

**POST** `/v1/node/heartbeat`
```json
{
  "node_id": "node-123",
  "health": "ready",
  "current_load": {"gpu": 0.52, "cpu": 0.33},
  "semantic_langs": ["en","zh"],
  "nmt_pairs": [["en","zh"],["zh","en"]],
  "tts_langs": ["en","zh"],
  "max_concurrent_jobs": 2
}
```

**返回**
```json
{"ok": true}
```

### 5.2 面对面任务派发（Scheduler 对外）

**POST** `/v1/dispatch/f2f`
```json
{
  "session_id": "room-888",
  "src_lang": "en",
  "tgt_lang": "zh",
  "audio_ref": "blob://...", 
  "options": {
    "require_tts": false,
    "preferred_node_id": null
  }
}
```

> `preferred_node_id` 预留：用户指定节点处理路径。  
> 暂不实现 UI，但服务端必须支持校验与 fallback。

**返回（成功）**
```json
{
  "job_id": "job-abc",
  "node_id": "node-123",
  "attempt_id": 1
}
```

**返回（失败）**
```json
{
  "error": "NO_CAPABLE_NODE",
  "detail": "No node supports semantic(en) + nmt(en->zh)."
}
```

### 5.3 节点 ACK 与结果回传（Scheduler 内部）

**POST** `/v1/job/ack`
```json
{"job_id":"job-abc","attempt_id":1,"node_id":"node-123"}
```

**POST** `/v1/job/done`
```json
{"job_id":"job-abc","attempt_id":1,"node_id":"node-123","status":"ok"}
```

**POST** `/v1/job/fail`
```json
{"job_id":"job-abc","attempt_id":1,"node_id":"node-123","status":"error","reason":"MODEL_LOAD_FAILED"}
```

---

## 6. 节点池生成与维护策略

### 6.1 入池条件（以语义修复为准）

节点 N 进入池 `(src,tgt)` 的必要条件：

- `src ∈ semantic_langs(N)`  （必选）
- `nmt_supports(N, src->tgt)`（必选）
- 如果面对面需要 TTS：`tgt ∈ tts_langs(N)`

> 面对面模式的语言对 `{A,B}` 固定，因此注册时只需判断两条方向：`A->B` 与 `B->A`。

### 6.2 更新时机

- **register**：
  - 写入 `sched:node:{node_id}:meta`（节点元数据）
  - 写入 `sched:node:{node_id}:capabilities`（节点服务能力，从 `capability_by_type` 同步）
  - 写入 `sched:node:{node_id}:cap`（节点并发计数）
  - 计算入池并 `SADD` 到对应 `pool members`
- **heartbeat**：若能力发生变化（semantic/nmt/tts/max_concurrent/health），更新 Redis 并调整 membership：
  - 更新 `sched:node:{node_id}:capabilities`（如果 `capability_by_type` 变化）
  - 更新 `sched:node:{node_id}:meta`（如果元数据变化）
  - 更新 `sched:node:{node_id}:cap`（如果并发计数变化）
  - 需要入池：`SADD`
  - 需要出池：`SREM`
- **offline/draining**：可保留在 pool 中（不影响正确性），但建议在 `health != ready` 时：
  - either：直接 `SREM` 出所有池（简单但要维护反向索引）
  - or：保留 membership，仅在选节点时过滤 `health`（更简单，推荐）

> **重要**：节点服务能力信息（`capability_by_type`）在注册和心跳时都会同步到 Redis 的 `sched:node:{node_id}:capabilities`，所有能力查询都从 Redis 读取，确保多实例间的一致性。  
> 推荐：**membership 不因短暂 health 抖动频繁修改**；选节点时通过 `health` 与 `try_reserve` 自然过滤。

---

## 7. 任务状态机（Job State Machine）

### 7.1 状态定义

- `NEW`：创建任务
- `SELECTING`：候选选择中
- `RESERVED`：已对某节点预留成功（reserved+1）
- `DISPATCHED`：已向节点发送任务请求
- `ACKED`：节点确认接收（reserved->running）
- `DONE`：完成（running-1）
- `FAILED`：失败（running/reserved 回收完成）
- `RETRYING`：准备重试（attempt_id +1）

### 7.2 状态转换（简化图）

`NEW -> SELECTING -> RESERVED -> DISPATCHED -> ACKED -> DONE`

异常路径：
- `RESERVED -> FAILED`（发送失败/超时，释放 reserved）
- `DISPATCHED -> RETRYING`（ACK 超时，释放 reserved，再选新节点）
- `ACKED -> RETRYING`（节点 fail 回传，running-1，再选新节点，有限次数）

---

## 8. 节点选择策略（默认随机 + 指定节点路径）

### 8.1 默认随机策略（满足“不固定节点”的安全诉求）

- 从池成员集合中做**随机采样**：`sample_k`（例如 10～30，视池大小）
- 对采样结果做轻量排序（可选）：
  - 首要：`effective_load`（running+reserved）
  - 次要：`last_heartbeat` 新鲜度
- 依次尝试 `try_reserve`，成功即选中

> 该策略不会让同一 session 固定落在同一节点。  
> “尽量随机”通过采样实现，同时保留负载最小化的倾向。

### 8.2 指定节点路径（预留）

当 `preferred_node_id` 不为空：
1. 校验该节点是否在对应池中（或是否满足能力约束）
   - 从 Redis 读取节点能力：`sched:node:{node_id}:capabilities`
   - 检查节点是否具备所需服务类型（ASR/NMT/TTS/Semantic）
2. 尝试 `try_reserve(preferred_node_id)`
3. 成功则派发；失败则：
   - 若 `strict=true`（未来扩展）：直接返回错误
   - 默认：fallback 到随机策略

> **重要**：节点能力校验从 Redis 读取，确保多实例间的一致性。  
> 当前阶段可固定 fallback 行为为"失败则随机"，并在日志记录 reason。

---

## 9. try_reserve 并发安全实现（核心）

### 9.1 单实例（单机）实现要点
如果 Scheduler 单实例：
- `NodeState` 放内存
- `try_reserve` 用互斥锁/原子计数保护：
  - 读 `running/reserved/max`
  - 若可用则 `reserved++`
  - 返回成功
- 需要 TTL 清理：保留一个本地定时器表，超时释放 `reserved`

**伪代码（单机）**
```pseudo
function try_reserve_local(node_id, resv_id, ttl_ms):
  lock node_mutex[node_id]
  cap = node_caps[node_id]
  if cap.health != READY: unlock; return FAIL
  if cap.running + cap.reserved >= cap.max: unlock; return FAIL
  cap.reserved += 1
  schedule_timer(ttl_ms, release_if_not_committed(resv_id))
  unlock
  return OK
```

> 但你当前是多实例，因此以下 Redis Lua 才是最终方案。

### 9.2 多实例（Redis）实现：Lua 原子脚本（推荐）

#### 9.2.1 关键约束
- **跨实例必须原子**：检查容量 + 增加 reserved + 写 reservation 记录必须在一个原子事务里完成。  
- **必须带 TTL**：避免实例 crash 后 reservation 泄漏造成“永久占坑”。  

#### 9.2.2 Redis Lua：TRY_RESERVE

输入：
- `node_cap_key = sched:node:{node_id}:cap`
- `node_meta_key = sched:node:{node_id}:meta`
- `resv_key = sched:resv:{resv_id}`
- `ttl_ms`
- `resv_value_json`

Lua 逻辑：
1) 读取 `health`，不是 ready 则失败  
2) 读取 `max/running/reserved`  
3) 若 `running+reserved >= max` 失败  
4) `HINCRBY reserved +1`  
5) `SET resv_key value PX ttl_ms NX`  
6) 若 NX 失败（同 resv_id 冲突）：回滚 reserved-1 并失败  
7) 返回 OK

**Lua（示例）**
```lua
-- KEYS[1]=node_cap_key, KEYS[2]=node_meta_key, KEYS[3]=resv_key
-- ARGV[1]=ttl_ms, ARGV[2]=resv_value_json

local health = redis.call('HGET', KEYS[2], 'health')
if health ~= 'ready' then
  return {0, 'NOT_READY'}
end

local maxv = tonumber(redis.call('HGET', KEYS[1], 'max') or '0')
local running = tonumber(redis.call('HGET', KEYS[1], 'running') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')

if maxv <= 0 then
  return {0, 'NO_CAPACITY'}
end

if (running + reserved) >= maxv then
  return {0, 'FULL'}
end

redis.call('HINCRBY', KEYS[1], 'reserved', 1)

local ok = redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[1], 'NX')
if not ok then
  redis.call('HINCRBY', KEYS[1], 'reserved', -1)
  return {0, 'RESV_EXISTS'}
end

return {1, 'OK'}
```

#### 9.2.3 COMMIT（reserved -> running）
在节点 ACK 后调用：

- 校验 resv_key 是否存在且 node_id/job_id 匹配（解析 JSON 或在 key 中编码）  
- `HINCRBY reserved -1`
- `HINCRBY running +1`
- 删除 resv_key（避免泄漏）

> 若 resv_key 已过期：返回失败，视为 ACK 迟到；上层按异常路径处理。

#### 9.2.4 RELEASE（释放预留）
发送失败或 ACK 超时调用：

- 若 resv_key 存在：`reserved -=1` 并删除 resv_key  
- 若 resv_key 不存在（已过期）：不做 reserved--（避免负数），直接返回

> 建议在 Lua 中增加 reserved 下限保护：release 时若 reserved 已是 0，不再减。

#### 9.2.5 为什么不用 WATCH/MULTI
WATCH/MULTI 在高并发下会频繁失败重试，延迟不可控。Lua 更适合短小原子操作。

---

## 10. 任务分配伪代码（面对面）

```pseudo
function dispatch_f2f(session_id, src, tgt, audio_ref, options):
  pool_key = "sched:pool:{src}:{tgt}:members"

  if options.preferred_node_id != null:
    node_id = options.preferred_node_id
    if !node_is_member_of_pool(node_id, pool_key):
      return error("PREFERRED_NODE_NOT_CAPABLE")
    resv = try_reserve_redis(node_id, job_id, attempt=1, ttl_ms=5000)
    if resv.ok:
      return send_to_node_and_track(job_id, node_id, attempt=1)
    else:
      log("preferred reserve failed", reason=resv.reason)
      -- fallback to random

  candidates = random_sample_from_set(pool_key, k=20)
  if candidates empty:
    return error("NO_CAPABLE_NODE")

  shuffle(candidates)  -- 保证随机性
  attempt = 1

  for node_id in candidates:
    resv_id = make_resv_id(job_id, attempt, node_id)
    ok = try_reserve_redis(node_id, resv_id, ttl_ms=5000, payload=...)
    if ok:
      sent = send_job_to_node(node_id, job_id, attempt, audio_ref, src, tgt)
      if sent:
        mark_job_state(job_id, "DISPATCHED", node_id, attempt)
        return {job_id, node_id, attempt}
      else:
        release_reserve_redis(node_id, resv_id)
        continue

  return error("ALL_CANDIDATES_FULL_OR_FAILED")
```

### ACK 处理
```pseudo
on node_ack(job_id, attempt, node_id):
  resv_id = make_resv_id(job_id, attempt, node_id)
  ok = commit_reserve_redis(node_id, resv_id)
  if !ok:
    log_warn("ACK after reservation expired", job_id, node_id)
```

### DONE/FAIL 处理
```pseudo
on node_done(job_id, attempt, node_id, status):
  dec_running(node_id)
  if status == ok:
    mark_job_done(job_id)
  else:
    if attempt < MAX_RETRY:
      retry(job_id, attempt+1)
    else:
      mark_job_failed(job_id)
```

---

## 11. 异常路径与处理策略（必须实现）

### 11.1 池为空 / 无可用节点
- 返回 `NO_CAPABLE_NODE`
- 记录 `pool_empty_rate` 指标

### 11.2 try_reserve 失败（FULL / NOT_READY）
- 继续尝试下一个候选节点
- 若全部失败：返回 `ALL_CANDIDATES_FULL_OR_FAILED`

### 11.3 派发失败（网络错误/节点不通）
- 立即 `release_reserve`
- 继续下一个候选节点
- 若耗尽：失败返回

### 11.4 ACK 超时
- 超时触发 `release_reserve`（如果尚未 commit）
- 进行重试：选择新节点、attempt+1
- 记录指标：`ack_timeout_rate`

### 11.5 Reservation 过期但节点仍在执行
- 可能出现：节点 ACK 迟到或丢失  
- 处理：记录日志；如支持取消任务，可发 cancel；否则让节点执行完成后回报 done，服务端按幂等处理（不采纳/不二次计数）。

### 11.6 Redis 不可用
- 调度无法保证并发安全  
- 建议策略：直接拒绝新任务（fail closed），返回 `SCHEDULER_DEPENDENCY_DOWN`  
- 同时告警

---

## 12. 会议室（Route2）占位设计（仅文档占位，不实现）

> 会议室模式将复用本方案的核心：**pool 重叠 + node-level reservation**。  
> 差异仅在于：同一 utterance 会并行产生多个 `(src->tgt)` 任务（按目标语言分组），并通过 WebRTC 原音直达同语种用户。

占位模块：
- RoomManager：维护 room 对象与语言分组
- FanoutRouter：将节点返回的 `tgt` 结果分发给对应成员
- JobBatcher：对同一 utterance 的多语言任务做并行派发与超时治理

---

## 13. 建议默认参数（可调）

- `sample_k`：20  
- `reservation_ttl_ms`：5000（根据节点 ACK 时延调整）  
- `max_retry`：2（面对面实时场景不宜过多）  
- `candidate_shuffle`：true（保证随机性）  
- `health_filter`：`ready` 必须  
- `heartbeat_stale_ms`：15000（可选过滤）

---

## 14. 交付清单（开发任务拆分）

1) NodeRegistry：注册/心跳、写 Redis meta/cap/capabilities  
   - ✅ 节点能力信息（`capability_by_type`）已迁移到 Redis：`sched:node:{node_id}:capabilities`
   - ✅ 所有节点能力查询从 Redis 读取，确保多实例间的一致性
2) PoolIndex：入池计算、写 Redis set、随机采样接口  
   - ✅ Pool 成员索引已完全迁移到 Redis
   - ✅ 所有 Pool 相关查询从 Redis 读取
3) ReservationManager：Lua 脚本（try/commit/release/dec_running）+ 单测  
   - ✅ 所有 Lua 脚本已实现
4) Dispatcher：派发、ACK 超时、释放预留、重试  
   - ✅ 已实现
5) JobManager：状态机、幂等、日志与指标  
   - ✅ 已实现
6) PolicyEngine：默认随机、指定节点路径（仅后端能力）  
   - ✅ 节点能力校验从 Redis 读取：`sched:node:{node_id}:capabilities`
   - ✅ 随机选择策略已实现
7) Observability：指标与告警面板
   - ✅ 已实现

---

## 附录 A：Redis Lua 脚本接口清单

- `TRY_RESERVE(node_cap_key, node_meta_key, resv_key, ttl_ms, resv_value_json)`  
- `COMMIT_RESERVE(node_cap_key, resv_key)`  
- `RELEASE_RESERVE(node_cap_key, resv_key)`  
- `DEC_RUNNING(node_cap_key)`（任务完成时 running--，带下限保护）

---

## 附录 B：语言对池的最小实现（面对面）

面对面房间选择 `{A,B}` 后，系统只需要确保存在：
- `pool(A->B)`
- `pool(B->A)`

节点注册后根据能力判断加入对应池；任务方向由客户端明确提供 `src/tgt`，无需 `src=auto`。

---

（完）
