# Lingua User Correction + Model2 — Phase 2 Manual Correction Development Report

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Nature | **MANUAL CORRECTION DATA LOOP DEVELOPMENT** |
| Based on | `Lingua_User_Correction_Model2_Phase1_Foundation_Development_Report_2026_08_11.md` |
| Verdict | **PASS_WITH_KNOWN_DEFERRED** |

---

## 1. Executive Summary

Phase 2 建立了真实用户纠错数据闭环：

```text
System ASR text (immutable)
  → Manual Edit / Draft
  → Explicit Confirm
  → Browser POST Gateway /v1/corrections
  → Gateway AuthContext.user_id + server-side Scheduler token
  → Scheduler CorrectionHistory (SQLite)
```

未开发 Model2、Training Dataset Builder、ProfileDelta 算法；未改冻结 Node ASR 主链；未扩 JobResult。

| 能力 | 状态 |
|------|------|
| Gateway 默认 Browser production path | **Done**（已移除 `VITE_SCHEDULER_URL`） |
| Gateway default session transport smoke | **PASS**（init → ack → end） |
| Manual Correction UI | **Done** |
| `system_text` immutable / `corrected_text` 分离 | **Done** |
| Browser → Gateway only correction submit | **Done** |
| Gateway injects authoritative `user_id` | **Done** |
| Scheduler durable CorrectionEvent + idempotency | **Verified** |
| ProfileDelta | **null / deferred** |
| Full voice ASR/NMT E2E via Gateway | **Deferred**（本环境无 Node；见 §22） |

---

## 2. Phase 1 Preconditions Verification

对照 Phase 1 报告与当前代码：

| Phase 1 声明 | 实测 | 处置 |
|--------------|------|------|
| Browser 默认 `API Gateway /v1/session` | 确认；曾保留 `VITE_SCHEDULER_URL` override | Phase 2 **删除**正式 override |
| Gateway auth + stable `user_id` + UserProfile | 确认（`/v1/me` E2E 返回 `user-*`） | 保持 |
| Scheduler CorrectionRepository + `/api/v1/corrections` | 确认 | 保持；加强 no-op 校验 |
| Node SessionBootstrap / JobResult 不变 | 未改 Node ASR / JobResult | 保持 |
| `config.toml` 缺 `[tenant]` 导致 Gateway 启动失败 | **发现** | **修复**：补 `[tenant]` |

无 P0 与 Phase 1 架构冲突项。

---

## 3. Gateway Default E2E Result

### 3.1 Session transport smoke（本轮执行）

脚本：`docs/user_correction/scripts/phase2_gateway_session_smoke.py`

```text
Browser WS → Gateway /v1/session?access_token=…
  → session_init (含伪造 user_id / user_profile)
  → session_init_ack (session_id=s-1075F2D0)
  → session_end
PASS
```

验证点：Gateway 可完成 session init/close；伪造身份不会阻断传输。

### 3.2 Full voice (audio → ASR → translation)

本轮环境：

* Redis 需手动 `redis-server`（Windows Service 启动失败）
* Scheduler 可起，但 **无 Node / Model-Hub**
* 因此 **未** 跑完整 audio→ASR→translation→close

`dialog_200` 仍是 Node pipeline fixture，**未**为接 Gateway 改写。

层级说明：

| 层级 | 结果 |
|------|------|
| Gateway session transport | PASS |
| Correction REST E2E | PASS（§22） |
| Full voice via Gateway | DEFERRED（需 Node） |

---

## 4. Architecture Before / After

### Before (Phase 1 end)

```text
Browser ──WS /v1/session──► Gateway ──► Scheduler ──► Node
         (legacy VITE_SCHEDULER_URL 仍可直连 Scheduler)
No Manual Correction UI
Correction API 仅 Scheduler 内部可达
```

### After (Phase 2)

```text
Browser ──WS /v1/session──► Gateway ──► Scheduler ──► Node
   │
   └── POST /v1/corrections ──► Gateway
                                  ├─ AuthContext.user_id (authoritative)
                                  ├─ ignore forged body.user_id
                                  └─ Bearer LINGUA_CORRECTION_API_TOKEN
                                        │
                                        ▼
                                   Scheduler POST /api/v1/corrections
                                        │
                                        ▼
                                   CorrectionHistory SQLite SSOT
```

正式 Web Client runtime **仅** Gateway；无 dual-path / fallback 配置。

---

## 5. Manual Correction UX

每个已完成 utterance 在 `#correction-panel` 卡片中：

1. 展示 **系统原文 (immutable)**
2. **编辑纠错** → textarea draft
3. **确认纠错** / **取消**
4. 成功后显示「已确认纠正」，仍保留 system text
5. **再次纠错** = 新一次显式确认（新 `client_correction_id`）

UI state：`idle | editing | submitting | submitted | error`（仅前端）。

---

## 6. Browser Correction State Model

`webapp/web-client/src/correction.ts`：

* `systemText` — 不可变系统事实
* `correctedTextDraft` — 编辑草稿
* `correctionState` — UI 状态
* `clientCorrectionId` — 幂等键；失败重试复用；成功后再编辑清空

`TranslationResult` 仅增最小 metadata：`sessionId` / `utteranceIndex` / `systemText`（不存整份 JobResult）。

---

## 7. Utterance Binding

绑定键：`session_id` + `utterance_index`。

* `user_id`：Gateway AuthContext
* **不**用 `job_id` 作主绑定

---

## 8. Browser → Gateway Correction Contract

`POST /v1/corrections`

```json
{
  "session_id": "s-…",
  "utterance_index": 1,
  "system_text": "…",
  "corrected_text": "…",
  "client_correction_id": "<uuid>",
  "source_profile_version": null,
  "pipeline_version": null
}
```

Browser **不**提交权威 `user_id`（若带上则被 Gateway 忽略）。

---

## 9. Gateway → Scheduler Correction Contract

Gateway 转发：

```json
{
  "user_id": "<AuthContext>",
  "session_id": "…",
  "utterance_index": N,
  "system_text": "…",
  "corrected_text": "…",
  "corrections": [],
  "source_profile_version": <from profile repo if omitted>,
  "pipeline_version": <optional>,
  "idempotency_key": "<client_correction_id>"
}
```

鉴权：`Authorization: Bearer <LINGUA_CORRECTION_API_TOKEN>`（仅 server-side）。

响应归一化为：`accepted` / `correction_id` / `duplicate` / `profile_delta`（可为 null）。

---

## 10. Authentication / User Identity

* Browser → Gateway：Bearer / WS query `access_token`（现有）
* Gateway → Scheduler correction：server token
* `user_id` 生成 ownership **仅** Gateway identity layer（`user-{sha256(tenant|api_key)[:16]}`）
* 派生细节不扩散到 Browser / Scheduler / Node；下游只消费 opaque `user_id`
* **不得**把 `tenant_id` 当 `user_id`

Known deferred：当前 API-key-derived `user_id` 仅适用本 identity phase；未来一 credential 多终端用户时必须换成真实 Web account identity。

---

## 11. CorrectionEvent Persistence

Scheduler SQLite `correction_events` 继续为 SSOT。字段：

`event_id, user_id, session_id, utterance_index, system_text, corrected_text, corrections[], source_profile_version, pipeline_version, idempotency_key, created_at`

本轮 `corrected_text` 是主事实；`corrections[]` 允许 empty（未建 span aligner）。

Gateway / Browser **不**存 CorrectionHistory。

---

## 12. Idempotency

* Browser：`client_correction_id`
* Gateway → Scheduler：`idempotency_key`
* Scheduler：`UNIQUE(user_id, idempotency_key)` + service duplicate 短路

E2E：同 payload 二次提交 → `duplicate: true`，同一 `correction_id`。

---

## 13. Re-edit Same Utterance Semantics

V1：**每一次显式 Confirm = 独立 CorrectionEvent**。

* `system_text` 始终指向原始系统事实 A
* `corrected_text` 可为 B、C、…
* **不** silent overwrite 历史 Event

---

## 14. Error / Retry Semantics

* 校验失败 / 上游失败：保留 draft；`error` 状态可重试
* 重试用**相同** `client_correction_id`
* 失败**不**重跑 ASR / 翻译 / Node pipeline

---

## 15. ProfileDelta Deferred Verification

* Scheduler response `profile_delta: null`
* Gateway 兼容 absent/null
* 未实现画像学习 / UserProfile update-from-delta

---

## 16. Legacy Direct Scheduler Path Audit / Removal

### Audit: `VITE_SCHEDULER_URL`

| 位置 | 角色 | 处置 |
|------|------|------|
| `webapp/web-client/src/types.ts` | 正式 Browser override | **DELETED** |
| `scripts/start_webapp.ps1` | 曾提示/设置 `SCHEDULER_URL` | **改为** `VITE_GATEWAY_SESSION_URL` |
| web-client **tests** 硬编码 `5010` | 单元 harness | **保留**（非产品 runtime） |
| `webapp/mobile-app` `SCHEDULER_URL` / 直连 Scheduler | **独立客户端** | **未盲删**；记录为真实消费者，待后续 Gateway 化 |
| Electron Node / 脚本 `SCHEDULER_URL` | Node↔Scheduler | **不属** Browser 产品路径 |

正式 Web Client：仅 `VITE_GATEWAY_SESSION_URL` 或默认 `ws://127.0.0.1:8081/v1/session`。

未新增 `legacy_mode` / `dual_ws` / `fallback_to_scheduler`。

---

## 17. Modified File Inventory

* `central_server/api-gateway/src/lib.rs`
* `central_server/api-gateway/src/config.rs`
* `central_server/api-gateway/config.toml`（`[tenant]` + scheduler HTTP/token fields）
* `central_server/api-gateway/src/rest_api.rs`（`POST /v1/corrections`）
* `central_server/api-gateway/src/main.rs`（secret redaction）
* `central_server/api-gateway/Cargo.toml`（reqwest；Phase1 已引入则保持）
* `central_server/scheduler/src/services/correction/mod.rs`（no-op validation）
* `central_server/scheduler/src/services/correction/sqlite_repository.rs`（tests）
* `webapp/web-client/src/types.ts`
* `webapp/web-client/src/app.ts`
* `webapp/web-client/src/app/message_handler.ts`
* `webapp/web-client/src/app/translation_display.ts`
* `scripts/start_webapp.ps1`

---

## 18. Added File Inventory

* `central_server/api-gateway/src/correction_proxy.rs`
* `central_server/scheduler/src/services/correction/service_test.rs`
* `webapp/web-client/src/correction.ts`
* `webapp/web-client/src/correction_ui.ts`
* `webapp/web-client/tests/correction/correction_model_test.ts`
* `docs/user_correction/scripts/phase2_correction_gateway_e2e.py`
* `docs/user_correction/scripts/phase2_gateway_session_smoke.py`
* 本报告

---

## 19. Deleted File / Path Inventory

* 无整文件删除
* **删除路径能力**：Browser production `VITE_SCHEDULER_URL` 消费分支

---

## 20. Tests Added

### Web

* edit starts with system_text copy
* cancel leaves system_text unchanged
* confirm payload fields / no-op block
* failed submit keeps draft + retry same `client_correction_id`
* submitted state model
* gateway HTTP base derivation

### Gateway

* validate no-op / size / session format
* response 无 token 字段
* proxy injects AuthContext `user_id`，忽略 forged
* proxy 使用 server-side Bearer
* Scheduler unavailable → controlled `BAD_GATEWAY`

### Scheduler

* insert + duplicate idempotency
* same utterance multiple explicit corrections（system_text 不变）
* factory rejects empty / no-op

### E2E scripts

* Gateway correction REST → Scheduler SQLite
* Gateway session transport smoke

---

## 21. Test Results

| Suite | Result |
|-------|--------|
| Gateway `cargo test --lib`（含 correction_proxy） | **11+ proxy tests PASS**（本地 `CARGO_TARGET_DIR`） |
| Scheduler `cargo test correction` | **6 PASS** |
| Web `vitest tests/correction/correction_model_test.ts` | **7 PASS** |

---

## 22. E2E Results

### Correction loop（PASS）

```text
unauthorized → 401
/v1/me → user-eb2858d7f169cbf5
submit → accepted, correction_id=corr-5b68c945-…
duplicate → same correction_id, duplicate=true
noop → 400 NO_OP_CORRECTION
SQLite row: user_id/session_id/utterance_index/system_text/corrected_text persisted
profile_delta=null
```

### Session transport（PASS）

见 §3.1。

### Full voice Gateway E2E（DEFERRED）

缺 Node；不通过直连 Scheduler 掩盖。

---

## 23. Regression Results

| 检查 | 结果 |
|------|------|
| ordinary voice without correction | 代码路径未强制纠错；UI 可选 |
| correction 不改 translation 执行 | submit 独立 REST；message_handler 仅 register UI |
| JobResult 字段 | **未修改** `NodeMessage::JobResult` |
| Node ASR pipeline | **未改** |
| SessionBootstrap | **未改** |
| UserProfile persistence | **未改契约**；Gateway 仍 SSOT |
| Model-Hub | **未改** |
| dialog_200 | 未强行改 Gateway（fixture 层） |

---

## 24. JobResult Non-Modification Verification

`central_server/scheduler/src/messages/node.rs` `JobResult { … }` 无 UserProfile / Correction 字段；本轮 diff 未触及该变体。

---

## 25. Frozen Node Pipeline Verification

未修改 Fine Span / Lexicon / Domain Vote / SameDomain / Sentence Assembly / KenLM；无 Candidate Merge；无 shadow/compatibility correction chain；无 Model2 inference。

---

## 26. Security Checks

| 项 | 状态 |
|----|------|
| Browser 不知 `LINGUA_CORRECTION_API_TOKEN` | **OK** |
| Browser 不能直调 Scheduler `/api/v1/corrections`（产品路径） | **OK** |
| forged `user_id` 忽略 | **OK**（E2E + unit） |
| Gateway 启动日志 redaction（api_key / config secrets） | **MODIFY** |
| WS query token 日志泄漏 | 仍为 Known Deferred P1（未建大型 auth） |

---

## 27. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | CorrectionHistory SSOT = Scheduler |
| KEEP | UserProfile SSOT = Gateway |
| KEEP | JobResult / Node ASR freeze |
| KEEP | SessionBootstrap |
| KEEP | mobile-app 直连 Scheduler（独立客户端，待另立项） |
| MODIFY | Web default URL 仅 Gateway；start_webapp 提示 |
| MODIFY | Scheduler no-op validation；Gateway secret logging |
| ADD | `/v1/corrections` proxy + Web UI + tests + E2E scripts |
| DELETE | `VITE_SCHEDULER_URL` production override |
| DEFER | ProfileDelta / TrainingSample / Model2 / full voice Gateway E2E / real account IAM / mobile Gateway 化 |

---

## 28. Known Deferred Items

1. Full Browser→Gateway→Node voice E2E（需 Node + 健康 Model-Hub）
2. ProfileDelta algorithm + UserProfile learning
3. Span auto-alignment / TrainingSample Builder
4. Real Web account identity（替换 API-key-derived `user_id`）
5. mobile-app Gateway 化
6. WS query `access_token` 全面 redaction / 非 query 鉴权升级
7. Scheduler soft session ownership：session 已结束后仍可写 correction（训练友好；若需硬绑定需 utterance 存证）

---

## 29. Remaining Risks

* 本机 8081 可能权限拒绝（E2E 用 18081 验证）；部署需确认端口策略
* Redis Windows Service 不可用时需手动 `redis-server`
* 旧 Redis 无 `XGROUP` 仅影响 Phase2 stream worker，本轮 correction 路径不依赖
* mobile-app 仍直连 Scheduler，与 Web 正式路径不一致

---

## 30. Phase 3 Preconditions

Phase 3 可开始的前提：

1. Phase 2 CorrectionEvent 可持续写入（本轮已满足）
2. 明确 TrainingSample 归一化合同（system_text + corrected_text → spans）
3. ProfileDelta schema + Gateway apply API（仍禁止 Node 存 CorrectionHistory）
4. 不触碰冻结 Node ASR 主链；Model2 仍仅候选源设计位

---

## 31. Acceptance Checklist

| Criterion | Status |
|-----------|--------|
| Browser production path via Gateway | **PASS** |
| obsolete direct Scheduler Web path removed（无 Web 正式消费者） | **PASS**（mobile 另记） |
| Gateway default voice session E2E | **PARTIAL** → transport smoke PASS；full ASR DEFERRED |
| Manual Correction UI | **PASS** |
| system_text immutable / corrected_text separate | **PASS** |
| bind session_id + utterance_index | **PASS** |
| Browser 不权威 user_id | **PASS** |
| Browser 只提交 Gateway | **PASS** |
| Gateway injects AuthContext user_id | **PASS** |
| Gateway server-side Scheduler credential | **PASS** |
| durable CorrectionEvent | **PASS** |
| idempotent duplicate | **PASS** |
| failed correction 不影响 voice pipeline | **PASS** |
| ProfileDelta optional/null | **PASS** |
| Gateway 非 CorrectionHistory SSOT | **PASS** |
| Node 不收 CorrectionHistory | **PASS** |
| JobResult unchanged | **PASS** |
| frozen Node ASR unchanged | **PASS** |
| no Model2 / shadow chain | **PASS** |
| tests + correction E2E | **PASS** |

### Final Verdict

**PASS_WITH_KNOWN_DEFERRED**

唯一未闭合验收项为「完整语音 ASR/翻译 Gateway E2E」，因环境缺 Node，**未**用直连 Scheduler 掩盖；session transport + correction 闭环已 PASS。
