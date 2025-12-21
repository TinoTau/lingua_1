## Scheduler Phase2/Phase3 阶段改造摘要与验证入口

本文件用于在**仓库根目录**汇总 Scheduler 在近期阶段内落地的关键改造点，并给出“可复制”的验证入口（便于研发交付与上线前验收）。

---

## 1. Phase 2（多实例 + Redis 外置）本阶段改造点

### 1.1 维护性：`phase2.rs` 大文件拆分（已完成）

为降低误改风险与提升可读性，已将 `central_server/scheduler/src/phase2.rs` 拆分为模块目录：

- 入口：`central_server/scheduler/src/phase2.rs`（小入口，使用 `include!` 组合）
- 实现：`central_server/scheduler/src/phase2/*.rs`
- 测试：`central_server/scheduler/src/phase2/tests/*.rs`

约束：
- **每个 Rust 源文件 < 500 行**
- **对外 API 不变**：仍以 `crate::phase2::*` 作为入口使用

### 1.2 验收（通过）

在目录 `central_server/scheduler` 下：

```powershell
cd D:\Programs\github\lingua_1\central_server\scheduler
cargo test -q
```

Phase2/Redis 相关测试在 Redis 不可用时会 `skip`，不会导致整套测试失败。

更详细的 Phase2 文档与运维指引：
- `central_server/scheduler/docs/phase2_implementation.md`
- `central_server/scheduler/docs/phase2_streams_ops.md`

---

## 2. Phase 3（两级调度 / 能力池强隔离）本阶段改造点

### 2.1 能力池匹配：新增 `pool_match_mode`（已完成）

在 `central_server/scheduler/config.toml` 的 `[scheduler.phase3]`：

- `pool_match_scope = "core_only" | "all_required"`
- `pool_match_mode = "contains" | "exact"`
  - `contains`：包含匹配（兼容默认）
  - `exact`：精确匹配（按集合相等，忽略顺序、去重），用于**强隔离**（避免“能力更全的 pool”兜底“更小的任务集合”）

同时，为避免“能力更全的节点”被分配到更通用的 pool，节点归属策略支持：
- **更具体 pool 优先**：当一个节点匹配多个 pools 时，优先进入 `required_services` 更长的 pool；同长度再稳定 hash。

### 2.2 调度 dry-run：`/api/v1/phase3/simulate`（已完成）

用途：不跑真实 WS/音频，直接验证某个 `routing_key + required_services` 会落到哪个 pool/节点，以及 fallback 的原因。

示例：

`GET /api/v1/phase3/simulate?routing_key=tenant-A&required=node-inference&required=nmt-m2m100&required=piper-tts`

相关运维接口：
- `GET /api/v1/phase3/pools`（查看每个 pool 的 total/online/ready + 核心服务 installed/ready 覆盖）

---

## 3. 对应项目级文档

- `docs/central_server/project/Scheduler_Phase2_开发进度记录_2025-12-19.md`
- `central_server/docs/project/Scheduler_扩展与容量规划说明_含Redis设计.md`


