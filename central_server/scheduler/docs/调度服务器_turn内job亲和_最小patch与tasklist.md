# 调度服务器：Turn 内 Job 亲和
## 最小 Patch 清单与 Tasklist（执行版）

> 本文档用于指导开发部门 **按已冻结决策** 落地 Job 亲和（Affinity）逻辑。
> 原则：
> - **不引入 TTL / 超时机制**
> - **不增加新的控制流路径**
> - **不做兼容、不做兜底链**
> - 亲和仅覆盖 **同一 turn 内的连续 Job**

---

## 1. 冻结决策（前置共识）

### 1.1 Turn 边界

Turn 的开始与结束由以下事件唯一决定：

- **开始**：调度服务器创建 turnId（第一次 dispatch Job）
- **结束**（满足任一）：
  - `isManualFinalize == true`
  - `timeoutFinalize == true`

> 不引入额外超时 TTL，不通过时间窗口猜测 turn 边界。

---

### 1.2 Affinity 作用域

- `affinity_node_id` **只在同一个 turn 内生效**
- 不跨 turn 继承
- 不对整个 session 生效

---

## 2. 设计目标

- 确保同一 turn 内被切分的连续 Job **优先路由到同一节点**
- 避免多人抢话时错误路由
- 修复现有“写 A / 读 B 导致 affinity 失效”的确定性问题

---

## 3. 数据模型（最小约定）

### Redis Key

```text
scheduler:turn:{turn_id}
```

### 字段

```text
affinity_node_id : <node_id>
```

说明：
- 不再使用 `timeout_node_id`
- 不再使用 `max_duration_node_id`

---

## 4. Affinity 写入 / 使用 / 清除规则（无 TTL）

### 4.1 写入（Write）

- **触发点**：
  - turn 内 **第一个 Job 分配节点后立即写入**（必须在同 turn 内后续 Job 调用 select_node 之前完成）
- **动作**：
  - `HSET scheduler:turn:{turn_id} affinity_node_id <node_id>`
  - `HSET scheduler:session:{session_id} current_turn_id <turn_id>`

> 只写一次；后续 Job 不覆盖、不更新。

**重要（2026-01 修复）**：原先在 `actor_finalize` 中于 **全部 Job 创建并返回后** 才写入 affinity，导致同一 turn 内第 2、3… 个 Job 在 `create_translation_jobs` 内调用 `select_node(turn_id)` 时 Redis 中尚无 affinity，被随机派到不同节点，出现「前半句丢失」。现已在 `job_creator.rs` 中于 **第一个 Job 分配后、循环创建下一个 Job 前** 调用 `write_turn_affinity_after_first_job` 写入 affinity。

---

### 4.2 使用（Read）

在 `select_node.lua` 中：

1. 读取 `affinity_node_id`
2. 若存在，且：
   - node 在线
   - node 属于当前 Job 的候选节点池（语言对 pool）
3. 则直接选用该 node
4. 否则：
   - 直接走原有随机选 node 逻辑
   - **不写回、不降级、不尝试其他字段**

---

### 4.3 清除（Delete）

- **触发点**：
  - `isManualFinalize == true`
  - `timeoutFinalize == true`
- **动作**：
  - `HDEL scheduler:turn:{turn_id} affinity_node_id`

> 清除后，下一次发言将创建新 turnId，自然不再继承 affinity。

---

## 5. 最小 Patch 清单（逐文件）

### P0（必须）

#### 5.1 统一字段名（修复现有 bug）

**文件**：
- `actor_finalize.rs`

**修改**：
- 所有 `HSET ... max_duration_node_id` → `HSET ... affinity_node_id`
- 所有 `HDEL ... timeout_node_id` → `HDEL ... affinity_node_id`

---

#### 5.2 select_node.lua 读取字段对齐

**文件**：
- `scripts/lua/select_node.lua`

**修改**：
- `HGET ... "timeout_node_id"` → `HGET ... "affinity_node_id"`

---

### P1（推荐，仍属最小改动）

#### 5.3 写入时机前移（符合 turn 语义）

**文件**：
- Job dispatch 成功回调处（具体文件以实际工程为准）

**修改**：
- 将 `affinity_node_id` 的写入时机从 finalize 阶段
- 调整为 **turn 内第一个 Job dispatch 成功时**

> 不新增分支，仅移动写入位置。

---

## 6. Tasklist（执行顺序）

1. 确认 turnId 已在调度服务器生成并可用 ✅（do_finalize 内生成，create_translation_jobs / select_node 传递）
2. 统一 Redis 字段名为 `affinity_node_id`，key 为 `scheduler:turn:{turn_id}` ✅
3. 修改 `actor_finalize.rs`（写 / 删）✅
4. 修改 `select_node.lua`（读）✅
5. 若执行 P1：移动 affinity 写入时机（未做，保持 finalize 阶段写）
6. 添加最小单测 ✅
   - **pool_service**：`test_select_node_lua_turn_affinity_contract`（Lua 使用 `scheduler:turn:` 与 `affinity_node_id`，不使用 `timeout_node_id`/`max_duration_node_id`）
   - **job_creator**：`test_should_bind_job_to_node_manual_no_bind`、`test_should_bind_job_to_node_max_duration_bind`、`test_should_bind_job_to_node_timeout_no_bind`（Turn 内亲和绑定逻辑）
   - 执行：`cargo test --lib` 共 36 例通过（含上述 4 例）
7. 回归测试：
   - 多人插话时不发生错误继承（可选，需 Redis 环境）

**可行性结论与实施说明**：见《调度服务器_turn内job亲和_可行性结论_2026_01.md》。

---

## 7. 明确不做事项（防止复杂化）

- 不设置 TTL
- 不扫描 session / room 级 key
- 不跨 turn 继承 affinity
- 不引入 fallback / 多级 affinity
- 不在 Lua 中增加额外判断分支

---

## 8. 交付结论

该 Patch 在 **不增加任何控制流复杂度** 的前提下：

- 修复 affinity 不生效的确定性问题
- 精确对齐 turn 内连续 Job 的真实语义
- 为会议室与多人抢话场景提供稳定基础

执行完成后，可视为 **调度服务器 Job 亲和逻辑冻结版实现**。

