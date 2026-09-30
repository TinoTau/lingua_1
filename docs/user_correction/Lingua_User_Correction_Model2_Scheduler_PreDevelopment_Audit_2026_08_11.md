# Lingua User Correction + Model2 — Scheduler 开发前代码审计

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Nature | **READ_ONLY PRE-DEVELOPMENT AUDIT** |
| Scope | `central_server/scheduler` + Model-Hub / API-Gateway / Web 边界 |
| Design SSOT | [`Lingua_Model2_User_Correction_Design_and_Audit_Prompts_2026_08_11.md`](./Lingua_Model2_User_Correction_Design_and_Audit_Prompts_2026_08_11.md) |
| Code changed | **No** |
| Verdict | **READY_WITH_GAPS** |

---

## 1. Executive Summary

Scheduler 当前是**实时会话调度 + Job 派发 + 结果转发**服务，以 **Redis（TTL）为运行时状态**，**不执行**冻结节点端 ASR 后处理主链（Tone / Exact Recall / Domain Vote / Assembly / KenLM）。

对「用户手动纠错 + Model2」所需的 Scheduler 职责：

| 目标职责 | 现状 |
|----------|------|
| CorrectionHistory / Training Source SSOT | **缺失**（无 CorrectionEvent API / 无长期库） |
| ProfileDelta 计算并返回 Web | **缺失** |
| session start 转发 bounded UserProfile → Node | **缺失**（无 Node session bootstrap） |
| 不作为 Runtime UserProfile SSOT | **合规**（Scheduler 无长期 UserProfile） |
| Global Model2 运营分发边界 | **可复用** Model-Hub + `InstalledModel` + `MODEL_NOT_AVAILABLE` |

**结论：** Phase 1 **合同冻结可行**；实现 Correction / Profile 传输前必须补齐持久化、`user_id`、SessionBootstrap。**不得**把整份 JobResult 作为纠错历史；**不得**引入第二条 ASR 后处理链。

---

## 2. Current Scheduler Architecture

| 组件 | 路径 | 职责 |
|------|------|------|
| Axum Router | `central_server/scheduler/src/app/routes/mod.rs` | `/ws/session`, `/ws/node`, health/stats/dashboard |
| Session WS | `websocket/session_handler.rs` → `session_message_handler/` | 客户端会话生命周期 |
| Node WS | `websocket/node_handler/` | 注册 / 心跳 / JobAssign / JobResult |
| Session | `core/session.rs` | 内存 Session；`session_id` 由 Scheduler 生成 |
| Job | `core/dispatcher/job.rs` + `job_redis_repository.rs` | Redis `lingua:v1:job:{id}`，TTL ≈ 1h |
| Affinity | `services/session_affinity.rs` | Redis session → assigned_node |
| Pool | `pool/pool_service.rs` | `(src,tgt)` 选节点 |
| Model NA | `model_not_available/` | 缺模型入队（与纠错无关） |

**现有主数据面：**

```text
Browser / API-Gateway
  → WS /ws/session (session_init / audio / utterance)
  → Scheduler (finalize → create_translation_jobs)
  → Pool + session affinity
  → WS JobAssign → Node
  → JobResult → Scheduler 转发 TranslationResult → Session WS
```

仓库中**无独立 Operator Server**；运营边界落在 `scheduler` + `model-hub` +（设计中的）Web Server。

---

## 3. Web → Scheduler Call Chain

### 入口

- **Web Client**：直连 `ws://…/ws/session`（`webapp/web-client`），`session_init`。
- **API-Gateway**：`scheduler_client.rs` 另开 WS，`platform: "api-gateway"`。
- **无**独立 REST Web Server 作为 UserProfile SSOT。

### Auth / Identity

| 层 | 现状 |
|----|------|
| Scheduler `/ws/session` | **无** JWT / API Key 校验 |
| API-Gateway | Bearer API Key → `tenant_id`（非 `user_id`） |
| `user_id` | **全链路缺失**（Scheduler `src` grep 无匹配） |
| `session_id` | Scheduler 生成（权威） |
| `utterance_index` | Session 内递增；**无**独立 `utterance_id` UUID |
| `tenant_id` | 可选透传 |

### Feedback / Correction APIs

`SessionMessage`（`messages/session.rs`）**无** `feedback` / `correction` / `submit_correction`。  
Router **无** `/api/v1/corrections`。

### 幂等 / 错误

- Job 幂等：`make_job_key(tenant, session, utterance_index, …)`（`job_idempotency.rs`）— **可借鉴**给 Correction。
- JobResult 去重已存在。
- 错误：`SessionMessage::Error` + `ErrorCode`。

### submitCorrection 自然落点（建议，不实现）

1. **优先**：Scheduler HTTP `POST /api/v1/corrections`（与实时 WS 分离）。
2. **次选**：`SessionMessage` 增补（不宜作训练 SSOT 唯一入口）。
3. API-Gateway 可代理，但 **CorrectionHistory 持久化必须在 Scheduler**。

---

## 4. Scheduler Persistence Architecture

| 项 | 现状 |
|----|------|
| DB | **仅 Redis**；sqlx/sqlite 在 Cargo 中注释未用 |
| Session | 进程内存 |
| Job | Redis Hash，**TTL 3600s** |
| Correction / Training | **无** |
| JobResult 持久化 | **无**（只转发）→ 与「不存整份 JobResult」方向一致 |

**缺口：** CorrectionHistory 需要**新长期库**（Postgres/SQLite 等），不能复用 Job Redis TTL。

纠错存储应仅为最小 `CorrectionEvent`（ids + texts + 版本/上下文指针），**禁止**克隆 `NodeMessage::JobResult` 全包。

---

## 5. Scheduler → Node Session Call Chain

| 步骤 | 证据 / 结论 |
|------|-------------|
| 选节点 | `PoolService` + Lua |
| Affinity | `SessionAffinityService.bind_session_node` |
| Session bootstrap → Node | **不存在**独立 `session_start` 消息 |
| 首触达 | 多为每 utterance 的 `JobAssign` |
| Session end → Node | **无**显式 teardown |
| domain prior | Node 侧可消费；**Scheduler JobAssign 未下发**（先例缺口） |
| 每 utterance 重复 | 语言 / pipeline / audio **每 Job 重复** |

**UserProfile 一次/session：** 现网**做不到**。需新增例如：

```text
NodeMessage::SessionBootstrap { session_id, user_profile, … }
```

在 **首次 bind 节点时**发送一次；迁移时按策略重发。

**禁止：** 把 UserProfile 塞进冻结 JobResult；**不宜**默认每条 JobAssign 重复全量 Profile。

---

## 6. User / Session / Utterance Identity Ownership

| ID | Owner | 生成 | 备注 |
|----|-------|------|------|
| `user_id` | **缺失**（设计：Web） | — | Phase 1 必须定义 |
| `tenant_id` | Client / Gateway | 可选 | 非用户画像 |
| `session_id` | Scheduler | `SessionManager` | 权威 |
| `utterance_index` | Scheduler | finalize 递增 | 纠错可关联；可另加 `utterance_id` |
| `job_id` | Scheduler | job 创建 | 一对多（多目标语） |
| `trace_id` | Client 或 Scheduler | SessionInit | 观测用 |

---

## 7. Current Context / Domain Prior Transport

- Group / NMT：`GroupManager` 内存 `context_text`（**非** UserProfile）。
- `FeatureFlags.persona_adaptation`：可选布尔，**不是** UserProfile blob。
- Node `domainPriors`：Electron/fw-detector 有消费迹象；Scheduler `JobAssign` **未接通**。
- 结论：存在「session/job 上下文下发」的**结构先例缺口**，UserProfile 应走**独立 SessionBootstrap**，不要混进 domain prior 临时补丁。

---

## 8. JobResult Consumer Audit

**Producer：** Node → `NodeMessage::JobResult`（`messages/node.rs`）。

**Scheduler consumer：** `job_result_processing.rs` → 去重 → 更新 Job → 组装 `TranslationResult` → Session WS。

**主要使用字段：** `job_id`, `attempt_id`, `session_id`, `utterance_index`, `success`, `text_asr`, `text_translated`, `tts_*`, `extra`, `trace_id`, group 字段等。

**下游：**

- Web：展示 ASR / 译文 / TTS
- NMT/TTS：在 **Node 内**完成，Scheduler 不二次决策
- Scheduler：**不**把 JobResult 当内部领域对象

**纠错 / UserProfile 是否必须改 JobResult？**  
**否。** Correction 用展示文本 + ids 提交；UserProfile 走 session bootstrap。**优先不修改 JobResult 合同。**

若未来被迫修改 JobResult，须先枚举全部 producer/consumer/序列化/Web/Scheduler/Node/NMT/TTS/tests — 本轮**不建议**。

---

## 9. Proposed CorrectionEvent Ownership

| 项 | 提案 |
|----|------|
| SSOT | **Scheduler**（CorrectionHistory / Training Source） |
| API | `POST /api/v1/corrections`（推荐） |
| 持久化 | 新 Repository（非 Redis Job TTL） |
| 最小字段 | `event_id`, `user_id`, `session_id`, `utterance_index`/`utterance_id`, `asr_text`/`system_text`, `corrected_text`, spans/context 指针, `pipeline/model version`, `idempotency_key`, `created_at` |
| ProfileDelta | 同请求响应返回 Web；**不**在 Scheduler 存 Runtime UserProfile |
| 训练 | 离线 Dataset Builder 读 CorrectionEvent（后续 Phase） |
| **禁止** | 整份 JobResult / 完整音频 blob 作为 history 默认字段 |

---

## 10. Proposed UserProfile Transport Path

```text
Web Server (Runtime UserProfile SSOT, ≤32KB)
  → session start
  → Scheduler (SessionInit 携带或等价 bootstrap 请求)
  → assigned Node
  → Node session memory（session end 删除）
```

| 要求 | 现状匹配 |
|------|----------|
| 一次 / session | 需新 bootstrap；现仅 per-job |
| Scheduler 非 Profile SSOT | 已满足（无长期 Profile） |
| 不进 JobResult | 必须坚持 |
| 失败不影响 Exact Recall | Node 侧 Model2 空源策略（本轮不改 Node） |

---

## 11. Model Distribution Reuse Analysis

| 能力 | 位置 | Model2 复用 |
|------|------|-------------|
| Model Hub | `central_server/model-hub` | `task`/`model_id`/version/checksum/Range 下载 |
| 节点上报 | `InstalledModel` | 可报告 Global Model2 |
| MODEL_NOT_AVAILABLE | Scheduler | 缺模型时可复用 |
| Per-user model | **无** | 符合「禁止每用户模型」 |

建议独立 `Model2VersionMetadata` 合同，复用 Hub manifest/hash；**禁止** per-user 权重分发基础设施。

---

## 12. Data SSOT Analysis

| 目标 SSOT | 现状 | 判定 |
|-----------|------|------|
| Scheduler = CorrectionHistory | 未实现 | **ADD** |
| Web Server = Runtime UserProfile | 未实现（Browser 直连） | **ADD**（Web 审计详述） |
| Node = session-only cache | 无 UserProfile；无长期 Node profile | **无冲突** |
| Scheduler 长期 UserProfile | 无 | **KEEP 空缺（正确）** |
| 多份 correction history | 无 | **无冲突** |

---

## 13. Conflict / Redundancy / Legacy Findings

| 发现 | 分类 |
|------|------|
| Redis Job TTL / Session 内存 / Affinity | **KEEP** |
| Job 幂等 / JobResult 去重 | **KEEP**（纠错可借鉴） |
| Model-Hub 分发 | **KEEP** |
| Session WS 无认证 | **MODIFY**（纠错 API 必须鉴权） |
| 无 Correction 持久化 | **ADD** |
| 无 SessionBootstrap | **ADD** |
| 无 `user_id` | **ADD** |
| domainPriors Scheduler 未下发 | **DEFER**（非本功能阻塞，但是先例） |
| 用 JobResult 当纠错库 | **CONFLICT / DELETE（设计禁止）** |
| 每 JobAssign 塞全量 Profile | **CONFLICT** |
| 第二条 ASR 后处理链 / Shadow | **未发现压力；禁止引入** |
| sqlx 注释残留 | **DEFER**（死路径） |
| `persona_adaptation` flag | **KEEP**；勿与 UserProfile 混名 |

---

## 14. KEEP / MODIFY / ADD / DELETE / DEFER Matrix

| 项 | 动作 |
|----|------|
| 实时 WS 调度 / JobAssign / JobResult 转发 | KEEP |
| 冻结节点 ASR 主链（Scheduler 不执行） | KEEP |
| Model-Hub Global 模型分发 | KEEP |
| Job 幂等键模式 | KEEP（模式）→ MODIFY 应用到 Correction |
| Session WS 匿名接入 | MODIFY（至少 Correction HTTP 鉴权） |
| CorrectionEvent API + DB | ADD |
| ProfileDelta 响应 | ADD |
| SessionBootstrap → Node | ADD |
| `user_id` 合同 | ADD |
| Model2VersionMetadata | ADD |
| JobResult 扩字段塞 Profile | DELETE（方案） |
| Per-user Model2 | DELETE（方案） |
| domainPriors 接通 | DEFER |
| Operator 独立服务拆分 | DEFER |

---

## 15. Target File List（后续实现锚点，本轮不改）

```text
central_server/scheduler/src/app/routes/mod.rs
central_server/scheduler/src/app/routes/routes_api.rs
central_server/scheduler/src/messages/session.rs
central_server/scheduler/src/messages/node.rs
central_server/scheduler/src/websocket/mod.rs
central_server/scheduler/src/services/session_affinity.rs
central_server/scheduler/src/core/job_idempotency.rs
central_server/scheduler/src/websocket/node_handler/message/job_result/*
# NEW: correction service + repository + schema migrations
central_server/model-hub/src/main.py
central_server/api-gateway/src/scheduler_client.rs  # 可选代理
```

---

## 16. Target Interface List

```text
POST /api/v1/corrections                  # submitCorrection
SessionInit (+ user_id?, user_profile?)   # Web→Scheduler
NodeMessage::SessionBootstrap             # Scheduler→Node（建议新增）
GET  Model-Hub model metadata             # Model2VersionMetadata 复用
```

---

## 17. Target Data Structure List

```text
CorrectionEvent V1
UserProfile V1          # ≤32KB；Scheduler 只转发，不 SSOT
ProfileDelta V1
Model2VersionMetadata V1
SessionBootstrap V1
Identity: user_id + session_id + utterance_index|utterance_id
```

---

## 18. Risks

| ID | 风险 | 等级 |
|----|------|------|
| R1 | 无长期库导致用 Redis/Job 误存纠错 | P0 |
| R2 | 无 `user_id` / Web Profile SSOT，纠错无法归属 | P0 |
| R3 | 无 bootstrap，Profile 被迫每 Job 重复 | P0 |
| R4 | Session WS 无鉴权，纠错被滥用 | P0 |
| R5 | 误改 JobResult 引发跨服务兼容雪崩 | P0 |
| R6 | utterance_index 稳定性 vs 显式 utterance_id | P1 |
| R7 | domainPriors 与 UserProfile 通道混淆 | P1 |

---

## 19. Development Preconditions

1. Phase 1 冻结：`CorrectionEvent` / `UserProfile` / `ProfileDelta` / `Model2VersionMetadata` / `SessionBootstrap`。
2. 明确 `user_id` ownership（Web Server）。
3. 选定 Correction 持久化引擎（非 Job Redis TTL）。
4. 确认 **不修改** JobResult；UserProfile **不进** JobResult。
5. 纠错 HTTP API 鉴权方案。
6. 与 Web 审计对齐：Browser 不得继续作为 Profile 权威来源。

---

## 20. Recommended Development Sequence

```text
Phase 1  Freeze contracts（本审计后立即）
Phase 2  Web Manual Correction UI + submit（依赖 Web Server）
Phase 3  Scheduler Correction persistence + ProfileDelta
Phase 4  Dataset Builder
Phase 5–7 Model2 train / condition / acceptance
Phase 8  Node Fine Span 并行 candidate source（不动主链其余部分）
Phase 9  E2E regression / freeze
```

Scheduler 可并行开工：**Correction DB + REST** 与 **SessionBootstrap 合同**，但 Runtime UserProfile 内容依赖 Web Server。

---

## 21. Acceptance Checklist

| # | 检查项 | 结果 |
|---|--------|------|
| A | Scheduler 未耦合冻结 ASR 后处理链 | **PASS** |
| B | Ownership 目标清晰且无错误长期 Profile SSOT | **PARTIAL**（目标对；Correction/Web Profile 未实现） |
| C | Web→Scheduler 具备 correction API / user_id / 鉴权 | **FAIL** |
| D | Persistence 可承载 CorrectionEvent 且不存整份 JobResult | **FAIL**（无纠错库；未存 JobResult → 方向对） |
| E | 可一次/session 转发 UserProfile → Node | **FAIL** |
| F | JobResult 消费者清晰；纠错可不改 JobResult | **PASS** |
| G | User data SSOT 无冲突副本 | **PARTIAL**（无错误副本；缺正确 Web SSOT） |
| H | Model 分发可复用给 Global Model2 | **PASS** |
| I | 最小合同插入点明确 | **PASS** |
| J | 无 Shadow/第二链路压力；缺口以缺失为主 | **PASS_WITH_GAPS** |

### Final Verdict

```text
READY_WITH_GAPS

Scheduler 作为实时调度与结果中转健康，未侵入冻结 ASR 主链，
具备 Global Model2 分发与 Correction API 挂载面。

作为 CorrectionHistory SSOT 与 UserProfile 会话下发枢纽仍缺：
长期持久化、user_id、SessionBootstrap、纠错鉴权 API。

可进入 Phase 1 合同冻结；不可声称运行时已就绪。
```

---

## Evidence Index（关键路径）

```text
central_server/scheduler/src/app/routes/mod.rs
central_server/scheduler/src/messages/session.rs      # SessionInit 无 user_profile
central_server/scheduler/src/messages/node.rs         # JobAssign / JobResult
central_server/scheduler/src/core/session.rs
central_server/scheduler/src/core/dispatcher/job_redis_repository.rs
central_server/scheduler/src/core/job_idempotency.rs
central_server/scheduler/src/services/session_affinity.rs
central_server/scheduler/src/websocket/node_handler/message/job_result/
central_server/model-hub/src/main.py
central_server/api-gateway/src/auth.rs
central_server/api-gateway/src/scheduler_client.rs
webapp/web-client/src/websocket/connect_handlers.ts
```
