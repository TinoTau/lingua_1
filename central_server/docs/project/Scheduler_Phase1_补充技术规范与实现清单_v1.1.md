
# Scheduler Phase 1 补充技术规范与实现清单（v1.1）

> 状态：补充规范（用于开发部门评审与实施）  
> 适用阶段：Phase 1（单实例 / 轻状态 Scheduler）  
> 目标：在不引入 Redis / 集群复杂度的前提下，最大化 Scheduler 稳定性、可扩展性与 Phase 2 可迁移性

---

## 0. 文档定位与使用方式

本补充文档 **不是推翻既有 Phase 1 决策**，而是：

- 将已识别但未完全落地的技术细节 **固化为工程规范**
- 明确 **哪些行为是“允许的”，哪些是“禁止的”**
- 给出 **可直接实施的步骤**，避免开发过程中反复争论

本文件建议：

- 与《Scheduler 当前架构与 Phase 1 拆分优化说明（决策版）》一并评审
- 作为 Phase 1 完成验收的 **约束清单**

---

## 1. stats 冷启动兜底生成（SingleFlight + 频率约束）

### 1.1 问题背景

- stats 快照在冷启动或缓存失效时需要现场生成
- 若并发请求同时触发生成，会造成：
  - CPU 峰值
  - 锁争用
  - 调度主线程抖动

### 1.2 规范约束（必须遵守）

1. **SingleFlight**
   - 同一时间最多允许 1 个 stats 兜底生成任务
2. **频率上限**
   - 在时间窗口 T 内（建议 30s）最多生成 1 次
3. **退化返回**
   - 其他请求必须：
     - 返回最近一次成功快照（即使是 stale）
     - 或返回明确的 `stats_not_ready` 状态
4. **禁止行为**
   - ❌ 禁止在请求路径中阻塞等待兜底生成完成
   - ❌ 禁止每个请求都独立生成

### 1.3 实现步骤（参考）

1. 增加全局状态：
   - `is_generating: AtomicBool`
   - `last_generated_at: AtomicU64`
2. 请求进入时：
   - 若缓存有效 → 直接返回
   - 若缓存无效：
     - CAS 尝试置 `is_generating = true`
     - 成功者触发后台生成
3. 后台生成完成：
   - 更新缓存
   - 更新 `last_generated_at`
   - 重置 `is_generating`

---

## 2. ServiceCatalogCache（stale-while-revalidate + 熔断）

### 2.1 问题背景

- ModelHub 不可用不应影响 Scheduler 核心功能
- 缓存刷新失败若处理不当，会造成服务能力“闪断”

### 2.2 规范约束

1. **stale-while-revalidate**
   - 刷新失败时必须继续使用旧缓存
2. **失败退避**
   - 连续失败 N 次（建议 3）后，延长刷新间隔
3. **缓存元数据必须存在**
   - `fetched_at`
   - `last_success_at`
   - `fail_count`
4. **禁止行为**
   - ❌ 禁止刷新失败时清空缓存
   - ❌ 禁止在 stats 主路径调用 ModelHub HTTP

### 2.3 实现步骤

1. 定义 CacheState：
   - `data`
   - `fetched_at`
   - `fail_count`
2. 后台定时刷新：
   - 成功 → 更新 data + 重置 fail_count
   - 失败 → fail_count++，延长下次刷新间隔
3. 读取路径：
   - 永远只读缓存，不触发网络请求

---

## 3. MODEL_NOT_AVAILABLE 事件处理（异步 + 去抖 + 预算）

### 3.1 问题背景

- 热门模型缺失可能引发“调度风暴”
- 同步处理会拖垮 Scheduler 主路径

#### 为什么“仅靠心跳”仍不足以覆盖该问题（必须理解）

即便节点端会通过心跳上报自身状态（包括 installed_services / capability_state），仍然需要额外处理 `MODEL_NOT_AVAILABLE`，原因是：

1. **心跳是快照且有间隔**
   - 心跳一般是 5–15 秒级别，Scheduler 做调度时看到的是“上一次心跳的状态快照”
   - 但 Job 下发与执行发生在后续的某一时刻，期间节点状态可能已变化（卸载/切换版本/进程崩溃/磁盘异常等）
2. **“声明可用” ≠ “运行时一定可用”**
   - 节点上报的 installed_services/capability_state 更多是“意图/配置/已安装”
   - 运行时仍可能因：服务未启动、依赖未就绪、文件缺失、校验失败、GPU/内存资源不足等导致实际加载失败
3. **故障反馈需要更快的闭环**
   - `MODEL_NOT_AVAILABLE` 是 Job 执行时的真实失败信号
   - 若不对该信号做快速纠偏（例如 TTL 黑名单），Scheduler 可能持续把同类请求调度到同一问题节点，形成“失败→重试→再次失败”的风暴

> 结论：心跳用于“慢路径状态同步”；`MODEL_NOT_AVAILABLE` 用于“快路径失败纠偏”，两者必须同时存在。

#### 节点在什么情况下会上报 MODEL_NOT_AVAILABLE（典型场景）

以下为节点端可能触发 `MODEL_NOT_AVAILABLE` 的常见情况（以服务包/模型为例）：

- **未安装**：请求需要的 service_id/model_id 不存在（首次部署/漏装/被清理）
- **安装/下载/校验中**：服务包已记录但尚未 ready（downloading/verifying/installing）
- **版本不一致**：Scheduler 认为可用的版本与节点当前激活版本不一致（滚动升级/回滚）
- **运行时不可用**：服务进程未启动/崩溃、文件损坏、依赖丢失、加载失败（error）
- **状态漂移**：心跳间隔内发生了服务切换或目录变更，Scheduler 仍看到旧快照

### 3.2 规范约束（硬约束）

1. **主路径仅允许：**
   - 事件入队（channel）
2. **后台处理必须：**
   - 按 `(model_id, version)` 去抖（3–10s）
   - 每窗口最多触发 1 次昂贵操作
3. **节点级限流**
   - 单节点上报频率必须受限
4. **禁止行为**
   - ❌ 禁止在调度主路径重算全局状态
   - ❌ 禁止每个事件都触发重调度

### 3.3 实现步骤

1. 定义事件结构 `ModelNotAvailableEvent`
2. 主路径：`send(event)` → 立即返回
3. 后台 worker：
   - 维护 debounce map（带 TTL）
   - 仅首次触发昂贵操作
4. 昂贵操作完成后记录时间戳

#### Phase 1 推荐默认昂贵操作（你已确认采用）

- **对该节点的该 service_id（可带 version 信息）做短 TTL “不可用标记”**（例如 30–120s）
- 调度过滤时优先跳过该节点，避免短时间内重复失败
- 说明：Phase 1 通常无法按“版本”路由请求（请求侧不携带版本约束），因此版本信息更多用于观测；过滤以 service_id 为主。

> 落地要求：TTL、去抖窗口、节点级限流窗口/阈值应做成配置项（config.toml），以便不同环境调参。

---

## 4. 会话绑定 lease 与幂等 request_id 规范

### 4.1 规范定义

> 说明：本项目 Phase 1 采用 **任务级绑定**（不做 session 级粘滞），用于“将会话打散”以提升通话安全性。

1. **request_id 幂等（任务级）**
   - 同一 request_id 的重试必须复用同一 Job（避免重复创建/重复派发）
   - 若该 Job 已分配节点，则必须返回同一 node_id
2. **lease 生命周期**
   - request_id 的 lease 未过期前禁止被覆盖（除非进入 failover 路径）
3. **抢占规则**
   - Phase 1：默认禁止抢占（除非明确进入 failover 路径，例如已失败并释放租约）

### 4.2 实现步骤（Phase 1）

1. 在 Job 结构中记录：
   - `request_id`
2. 在内存绑定表中记录：
   - `request_id -> (job_id, lease_expire_at)`
3. 新请求到来时：
   - 若 request_id 存在且 lease 有效 → 直接返回同一个 Job（不再重复创建/派发）
4. 释放路径（Phase 1 默认）：
   - Job 完成/失败后清理 request_id 绑定，避免内存增长
5. 配置项（必须可配置）：
   - `scheduler.task_binding.lease_seconds`
   - `scheduler.task_binding.spread_enabled`（可选：任务级打散开关，默认关闭）
   - `scheduler.task_binding.spread_window_seconds`（打散窗口）

---

## 5. 绑定与节点并发计数的一致性约束

### 5.1 问题背景

- 绑定成功 ≈ 占用 1 个并发槽
- 若两者语义不一致，会导致：
  - 超卖
  - 资源泄漏

### 5.2 规范约束

1. **绑定成功必须伴随并发计数增加**
2. **失败/回滚必须释放并发计数**
3. **释放操作必须幂等**

### 5.3 Phase 1 实现要求

- 单实例内保证：
  - “绑定成功 ≈ 占用 1 个并发槽（reserve）”的语义一致性
  - 派发失败/收到结果必须释放并发槽（幂等）
- 文档明确：
  - Phase 2 使用 Lua 脚本合并原子性

#### Phase 1 推荐实现（你当前代码的落地方式）

- 维护 `reserved_jobs`（按 `node_id -> job_id -> expire_at`）
- 节点选择时使用：
  - `effective_jobs = max(heartbeat_current_jobs, reserved_jobs_count)`
  - 避免心跳滞后导致的超卖
- 配置项（必须可配置）：
  - `scheduler.task_binding.reserved_ttl_seconds`

---

## 5.4 Web 端任务边界（AudioChunk）

> 目的：对 Web 端流式音频（`audio_chunk`）定义“任务结束”的判定，避免必须依赖用户点击 send 才能生成任务。

### 5.4.1 规则（必须遵守）

1. **send 按钮/手动截断**
   - `audio_chunk.is_final == true` 视为任务结束（立即封口生成 Job）
2. **停顿自动切句**
   - 若超过 **1 秒**无新的 `audio_chunk`（可配置），视为任务结束（自动封口生成 Job）

### 5.4.2 配置项（必须可配置）

- `scheduler.web_task_segmentation.pause_ms`（默认 1000ms）

---

## 6. Phase 1 验收与观测指标（必须补齐）

### 6.1 必须提供的指标

- `/api/v1/stats` P95 / P99 延迟
- Scheduler 主路径 QPS
- 锁等待时间 / contention
- stats stale 比例
- ModelHub 不可用时调度成功率

### 6.3 Phase 1 最小可落地采集方式（建议）

在不引入 Prometheus 依赖的前提下，Phase 1 可先提供：

- `/api/v1/metrics`（JSON）：
  - stats 请求总数、stale 总数、快照更新时间
  - ModelHub ServiceCatalog 的 fail_count/last_error/last_success_at
  - MODEL_NOT_AVAILABLE 处理量（接收、限流丢弃、标记次数）
  - Web AudioChunk 自动切句 vs send 结束的任务次数

> 后续若接入 Prometheus/Grafana，可在 Phase 2 再替换为标准指标体系。

### 6.4 方向A：采样日志（锁等待/关键路径）

#### 目标

- 不引入 Prometheus 依赖
- 先用“**超阈值 warn 日志 + 计数**”定位 contention 与慢路径

#### 做法

- 对关键 `RwLock` 获取做计时：`await` 前记录时间，获取后算等待毫秒
- 超过阈值则：
  - `warn` 一条日志（包含 lock 名称、wait_ms、threshold）
  - `/api/v1/metrics` 中的 slow 计数器累加

#### 配置项（可调参）

- `scheduler.observability.lock_wait_warn_ms`（默认 10ms）
- `scheduler.observability.path_warn_ms`（默认 50ms）

### 6.5 按原因拆分（定位问题用）

为避免“测试时问题太多、无法快速定位”，Phase 1 建议将关键计数做 **按原因拆分** 并在 `/api/v1/metrics` 中暴露：

- MODEL_NOT_AVAILABLE：
  - `by_service_top`：按服务包 id 聚合（Top-K）
  - `by_reason_top`：按原因聚合（Top-K，带归一化/截断，避免高基数）
  - `rate_limited_by_node_top`：限流丢弃按 node 聚合（Top-K）
  - `marked_by_node_top`：标记次数按 node 聚合（Top-K）
- DispatchExcludeReason：
  - `dispatch_exclude.by_reason`：每种排除原因的累计次数 + 示例节点列表

### 6.6 方向B：Prometheus / Grafana（标准监控）

Phase 1 可先提供一个标准的 Prometheus 指标出口：

- `GET /metrics`：Prometheus text format（可直接被 Prometheus 抓取）

#### 建议关注的指标（示例）

- stats：
  - `scheduler_stats_requests_total`
  - `scheduler_stats_stale_total`
  - `scheduler_stats_request_duration_seconds`（直方图，用于 P95/P99）
- MODEL_NOT_AVAILABLE（带容量限制，避免 label 爆炸）：
  - `scheduler_model_na_received_total`
  - `scheduler_model_na_by_service_total{service_id="..."}`
  - `scheduler_model_na_by_reason_total{reason="..."}`
  - `scheduler_model_na_rate_limited_by_node_total{node_id="..."}`
  - `scheduler_model_na_marked_by_node_total{node_id="..."}`
- 观测（方向A 的 slow 事件也会进入 Prometheus）：
  - `scheduler_slow_lock_wait_total{lock="..."}`
  - `scheduler_slow_path_total{path="..."}`
 - 调度失败（NO_AVAILABLE_NODE，按原因拆分）：
  - `scheduler_no_available_node_total{selector="models|features|reserve", reason="..."}`

### 6.2 验收标准（示例）

- stats 延迟不影响调度延迟
- ModelHub 不可用时，调度功能仍可用
- 高频刷新下 Scheduler CPU 稳定

---

## 7. 实施顺序建议（最小风险）

1. stats SingleFlight + 频率限制
2. ServiceCatalogCache 完善
3. MODEL_NOT_AVAILABLE 异步化 + 去抖
4. lease / 幂等规范补齐
5. 并发计数一致性
6. 验收指标补齐

---

## 8. 总结

本补充文档将 Phase 1 中**隐含但关键的技术决策显式化**，其价值在于：

- 防止调度风暴与锁抖动
- 降低未来 Phase 2 的返工成本
- 提供明确的工程“不可踩线”

> 若本文件内容全部落实，可认为 Phase 1 已达到“可稳定规模化”的工程水平。
