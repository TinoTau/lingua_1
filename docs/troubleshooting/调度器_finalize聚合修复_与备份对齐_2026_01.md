# 调度器 Finalize：仅 3 种类型 + 与备份对齐（2026-01）

**约定**：调度服务器只产生 **3 种 finalize**：手动 finalize、Timeout finalize、MaxDuration finalize。内部还有 MaxLength（异常保护 500KB）、SessionClose（会话关闭 flush），按 Auto/Exception 处理，不单独算一种类型。

---

## 1. 三种 finalize 的触发与逻辑（与备份对齐）

| 类型 | 触发条件 | 逻辑（与备份一致） |
|------|----------|--------------------|
| **手动 (IsFinal)** | Web 端发送 `is_final=true` | 清除 turn affinity；使用 `padding_manual_ms`、`hangover_manual_ms`；不记录 affinity。 |
| **Timeout** | ① 定时器：连续 `pause_ms` 未收到 chunk 触发<br>② 间隔超阈值：收到新 chunk 时与上一 chunk 间隔 > `pause_ms` | 清除 turn affinity；使用 `padding_auto_ms`、`hangover_auto_ms`；不记录 affinity。② 保证「停顿后第一个 chunk」与停顿前聚成一句，与备份一致。 |
| **MaxDuration** | 当前句累计音频时长 ≥ `max_duration_ms` | 不清除；使用 `padding_auto_ms`、`hangover_auto_ms`；**记录** turn affinity（本 turn 后续 job 路由到同一节点）。 |

- **MaxLength**：buffer 超过 500KB 异常保护时触发，按 Exception（无 hangover/padding），不单独算一种 finalize 类型。
- **SessionClose**：会话关闭时 flush 剩余 buffer，按 Auto 处理。

---

## 2. 修复内容（与备份对齐）

1. **只产生 3 种 finalize**
   - 不再使用 `"Pause"` 作为 reason。间隔超过 pause 时统一传 **`"Timeout"`**，与定时器 Timeout 同类型。
   - `FinalizeType::from_reason` 只映射：IsFinal → Manual；Timeout、MaxDuration、SessionClose → Auto；MaxLength → Exception。

2. **`audio_buffer.rs`**
   - `record_chunk_and_check_pause(session_id, now_ms, pause_ms) -> bool`：与备份一致，用于「收到 chunk 时判断间隔 > pause_ms」并更新 `last_chunk_at_ms`。

3. **`actor_event_handling.rs`**
   - 收到 chunk 且 `chunk_size > 0` 时调用 `record_chunk_and_check_pause`；若间隔 > pause_ms 且非 TTS 播放期间，则 `finalize_reason = "Timeout"`（不再用 `"Pause"`），触发 finalize，当前 buffer 已含本 chunk，聚合完整。

4. **`group_manager.rs`**
   - 恢复 `get_active_group_id`、`is_tts_playing`，TTS 播放期间不触发 Timeout finalize（与备份一致）。

5. **`actor_finalize.rs`**
   - `is_manual_cut = reason == "IsFinal"`；`is_timeout_triggered = reason == "Timeout"`；`is_max_duration_triggered = reason == "MaxDuration"`。
   - 手动 / Timeout：清除 turn affinity；MaxDuration：记录 turn affinity。
   - 指标：IsFinal → by_send；Timeout、MaxDuration → by_timeout。

---

## 3. 预期效果

- 只对外暴露 3 种 finalize：手动、Timeout、MaxDuration。
- 间隔超过 pause 时用 Timeout 类型触发，与备份语义一致，正常音频聚成一句，减少 260ms 级短 Job。
- 各类型逻辑与备份对齐：手动/Timeout 清除 affinity，MaxDuration 记录 affinity；padding/hangover 与备份一致。
- **长语音同节点**：同一 turn 内（多个 MaxDuration job + 最后一个手动/Timeout job）会落到同一节点，不丢上下文（turn affinity 对应备份 session affinity 的升级）。

---

## 4. 测试验证（2026-01）

- **调度器**（`central_server/scheduler`）：`cargo test --lib` 共 **36 例通过**（含 `job_creator::test_should_bind_job_to_node_*`、`pool_service::test_select_node_lua_turn_affinity_contract`、`audio_duration`、`job_idempotency` 等），与 finalize / turn affinity 相关逻辑由单元测试覆盖。
- **节点端**（`electron_node/electron-node`）：
  - **TextForwardMergeManager**：`npx jest main/src/agent/postprocess/text-forward-merge-manager.test.ts` 共 **34 例通过**（与 forward merge 修复相关）。
  - **stage3.1**：`npm run test:stage3.1` 共 94 例中 93 通过；1 例失败为 `model-hub-api.test.ts` 的「应该支持 Range 请求」（依赖外部 Model Hub API 返回 404，与本次逻辑无关）。
  - **stage3.2**：部分用例依赖 Opus 动态加载（需 `--experimental-vm-modules`）或外部服务，环境未满足时会有失败；与 finalize/聚合相关的核心单元测试（如 TextForwardMergeManager）已通过。

**参考**：备份见 `expired/lingua_1-main/central_server/scheduler` 下 `actor_event_handling.rs`、`actor_finalize.rs`、`audio_buffer.rs`。
