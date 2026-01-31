# 调度服务器 Turn 内 Job 亲和 — 可行性结论

**依据**：`调度服务器_turn内job亲和_最小patch与tasklist.md`（决策部门回复）  
**结论**：**可行**。可按决策执行，无新增控制流、无兼容/兜底链；唯一必要扩展为 turn_id 的生成与传递（架构级状态，非补丁）。

---

## 1. 与决策原则的对照

| 决策要求 | 实际代码对接 | 结论 |
|----------|--------------|------|
| 不引入 TTL | 当前 actor_finalize 写 affinity 时有 `EXPIRE 5*60`，需**删除** | 改一处即可 |
| 不增加新控制流路径 | 选节点仍为「有 affinity 用 affinity，否则随机」；清除仍为「manual/timeout 时清除」 | 无新增分支 |
| 不做兼容、不做兜底链 | 统一字段 `affinity_node_id`，key 改为 `scheduler:turn:{turn_id}`，不再使用 timeout_node_id / max_duration_node_id | 无兜底 |
| 亲和仅覆盖同一 turn 内 | 写入/读取/清除均以 turn_id 为 key，manual/timeout 清除后下次发言用新 turn_id | 语义一致 |

---

## 2. 不可避免的改动（架构级）

- **turn_id 的生成与传递**：决策约定 Redis key 为 `scheduler:turn:{turn_id}`，故调度端必须在「本轮 finalize 创建 job」时生成并持有 turn_id。
  - **生成**：在 `do_finalize` 内、调用 `create_translation_jobs` 前生成一次（如 `uuid::Uuid::new_v4().to_string()`），同一批 job 共用一个 turn_id。
  - **传递**：`do_finalize` → `create_translation_jobs` → `create_job_with_minimal_scheduler` → `pool_service.select_node` → Lua；Lua 用该值拼 key `scheduler:turn:{turn_id}` 做读。
  - **清除时**：manual/timeout 需清除「当前 turn」的 affinity，故需知道「当前 turn_id」。在**写入** affinity 时顺带把 `scheduler:session:{session_id}` 的字段 `current_turn_id` 设为该 turn_id；**清除**时先 HGET 该字段得到 turn_id，再 HDEL `scheduler:turn:{turn_id}` 的 `affinity_node_id`，并 HDEL session 的 `current_turn_id`。不引入新 key，仅用已有 session hash 存一个字段，逻辑简单。

---

## 3. 具体改动清单（与 tasklist 一致）

- **actor_finalize.rs**  
  - 清除（manual/timeout）：先 HGET `scheduler:session:{session_id}` 的 `current_turn_id`，若有则 HDEL `scheduler:turn:{turn_id}` 的 `affinity_node_id`，并 HDEL session 的 `current_turn_id`；再生成本轮的 `turn_id`，传入 `create_translation_jobs`。  
  - 写入（MaxDuration）：HSET `scheduler:turn:{turn_id}` 的 `affinity_node_id`，**不设 EXPIRE**；并 HSET `scheduler:session:{session_id}` 的 `current_turn_id` = turn_id。  
  - fallback 清除（manual/timeout 后）：同「清除」逻辑，用 session 的 `current_turn_id` 清除对应 turn 的 affinity。
- **job_creator.rs**  
  - `create_translation_jobs` 增加参数 `turn_id: &str`，三处调用 `create_job_with_minimal_scheduler` 时传入 `Some(turn_id)`。  
  - `create_job_with_minimal_scheduler` 增加参数 `turn_id: Option<&str>`，调用 `select_node(..., turn_id)`。
- **pool_service.rs**  
  - `select_node` 第 4 个参数语义改为「affinity 用 turn_id」（仍为 `Option<&str>`），传给 Lua 的 ARGV[3]。
- **select_node.lua**  
  - ARGV[3] 为 turn_id；key 为 `scheduler:turn:{turn_id}`，HGET 字段 `affinity_node_id`；注释与变量名从 session/timeout_node_id 改为 turn/affinity_node_id。
- **minimal_scheduler.rs**（若有 fallback 日志引用 timeout_node_id）  
  - 仅文案改为 affinity_node_id/turn，不增加分支。

---

## 4. 不做的内容（与决策一致）

- 不设 TTL（删除写 affinity 时的 EXPIRE）。
- 不扫描 session/room 级 key（仅按 turn_id 读单个 key）。
- 不跨 turn 继承（清除后 current_turn_id 去掉，下次用新 turn_id）。
- 不引入 fallback/多级 affinity（Lua 只读一次 affinity_node_id）。

---

## 5. 单元测试（本次补充）

- **pool_service**：`test_select_node_lua_turn_affinity_contract` — 断言 `select_node.lua` 使用 key 前缀 `scheduler:turn:` 与字段 `affinity_node_id`，且不再使用 `timeout_node_id`/`max_duration_node_id`。
- **job_creator**：`test_should_bind_job_to_node_manual_no_bind`、`test_should_bind_job_to_node_max_duration_bind`、`test_should_bind_job_to_node_timeout_no_bind` — 断言 manual/timeout 不绑定、MaxDuration 绑定。
- **执行**：`cargo test --lib` 共 36 例通过（含上述 4 例）。依赖 Redis 的 examples 未纳入默认测试。

---

## 6. 小结

决策文档与当前实现可对齐，改动限于：统一 key/字段、去掉 TTL、引入 turn_id 生成与传递及 session 存 current_turn_id 用于清除。无新增控制流、无兼容或兜底链，符合「代码简洁、易排查」的要求。按上述清单实施即可。
