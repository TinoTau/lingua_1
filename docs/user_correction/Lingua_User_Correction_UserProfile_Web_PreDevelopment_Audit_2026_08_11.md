# Lingua User Correction + UserProfile — Web 开发前代码审计

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Nature | **READ_ONLY PRE-DEVELOPMENT AUDIT** |
| Scope | `webapp/web-client` + `webapp/mobile-app` + `central_server/api-gateway`（候选 Web Server）+ Scheduler 边界 |
| Design SSOT | [`Lingua_Model2_User_Correction_Design_and_Audit_Prompts_2026_08_11.md`](./Lingua_Model2_User_Correction_Design_and_Audit_Prompts_2026_08_11.md) |
| Companion | [`Lingua_User_Correction_Model2_Scheduler_PreDevelopment_Audit_2026_08_11.md`](./Lingua_User_Correction_Model2_Scheduler_PreDevelopment_Audit_2026_08_11.md) |
| Code changed | **No** |
| Verdict | **NOT_READY** |

---

## 1. Executive Summary

设计要求：

```text
Browser → Web Server (Runtime UserProfile SSOT)
       → Scheduler (CorrectionHistory SSOT)
       → Node (session-only profile cache)
```

**现状主路径：**

```text
Browser (web-client) → Scheduler WS 直连 → Node
```

| 能力 | 现状 |
|------|------|
| 稳定 `user_id` | **无**（匿名 `session_id`） |
| Runtime UserProfile SSOT（≤32KB） | **不存在** |
| Manual Correction UI | **无**编辑/确认 |
| `submitCorrection` → Scheduler | **无** |
| session start 附带 UserProfile | 协议**无字段** |
| ProfileDelta merge | **无** |
| 禁止边界（Model2/Vote/全量训练数据） | **被动合规**（能力缺失） |

API Gateway 是 B2B 租户网关雏形（内存租户 + API Key），**不是**终端用户 Web Server；**web-client 未使用它**。

**结论：** 在建立 Web Server 用户身份与 bounded UserProfile 之前，**不应**宣称 Phase 2 Web 手动纠错可开发就绪。

---

## 2. Current Browser/Web Architecture

| 组件 | 路径 | 技术 | 角色 |
|------|------|------|------|
| Web Client（主） | `webapp/web-client` | TypeScript + Vite，原生 DOM（无 React/Vue） | 实时语音翻译 UI |
| Mobile App | `webapp/mobile-app` | React Native | 同样直连 Scheduler |
| Shared protocols | `webapp/shared/protocols` | TS 消息类型 | 与 Scheduler 对齐 |
| API Gateway | `central_server/api-gateway` | Rust + Axum | 对外 REST/WS；**非 web-client 默认路径** |
| Scheduler | `central_server/scheduler` | Rust | Session / Job / 结果回推 |

客户端模块骨架：

- UI：`main.ts`, `ui/session_mode*.ts`, `ui/room_mode.ts`
- 会话/音频：`app/session_manager.ts`, `recorder.ts`, `websocket/*`
- 结果：`app/message_handler.ts`, `app/translation_display.ts`, `asr_subtitle.ts`
- **无** auth / user / profile / correction 模块

文档确认直连与匿名 Session：`webapp/docs/webClient/PRODUCT_ARCHITECTURE_AND_SESSION_MANAGEMENT.md`（其中 `user_id` 仅为**未来示意**，未实现）。

---

## 3. Current Result Rendering Flow

```text
audio
  → WS utterance / chunks
  → Scheduler
  → Node
  → translation_result / asr_partial
  → message_handler.ts
  → TranslationDisplayManager + AsrSubtitle
  → DOM: #translation-original / #translation-translated / #asr-subtitle
```

| 字段 | UI 是否保留 | 纠错可用性 |
|------|-------------|------------|
| `session_id` | 连接层有 | 可用 |
| `utterance_index` | Map key；可展示 | **主绑定键** |
| `job_id` / `trace_id` | 处理时用，**未写入** `TranslationResult` | 需补存 |
| `text_asr` / `text_translated` | `originalText` / `translatedText` | 有 |

`TranslationResult`（`translation_display.ts`）仅含原文、译文、时延——**无** immutable `system_text` 副本、**无** `corrected_text`、**无** `job_id`。

ASR/原文/译文均为**只读** `textContent`；无 contenteditable、无纠错确认按钮。  
`textarea#text-input` 属于文本翻译模式，**不是** ASR 纠错 UI。

**风险：** 若直接改 DOM 覆盖原文，会丢失系统事实；纠错模式必须**保留 system_text，另存 corrected_text**。

---

## 4. Current Session Lifecycle

1. `connect*` → WS open  
2. `buildSessionInitMessage` → `session_init`  
3. Scheduler `handle_session_init` → 内存 Session  
4. `session_init_ack`（`session_id`, `trace_id`, codec 协商）  
5. 音频 / utterance 循环  
6. `session_close`

`SessionInit`（Scheduler `messages/session.rs`）含：`client_version`, `platform`, langs, `features`, `pairing_code`, `tenant_id`, mode/langs, streaming, `trace_id`。  
**无** `user_id` / `user_profile` / `profile_version`。

`session_init` **天然一次性**，是挂载 UserProfile 的最佳位置——但必须由 **Web Server** 注入，而非 Browser 自造权威画像。

---

## 5. Current User Persistence

| 存储 | 内容 | 可否作 UserProfile SSOT |
|------|------|-------------------------|
| Scheduler 内存 Session | 会话元数据 | 否 |
| Redis（Scheduler） | Job / affinity | 否 |
| API Gateway 内存 Tenant | API Key → tenant | 否（无用户表、无 DB） |
| Browser localStorage | `logConfig`, `tts_auto_play` | **禁止作权威** |
| IndexedDB | 客户端日志 | 否 |
| 用户表 / profile 表 | **不存在** | — |

**V1 32KB 上限：** 现状无处可落；新建存储时必须应用层/DB 约束拒绝超限增长。

---

## 6. Existing Feedback/Correction Features

| 能力 | 现状 |
|------|------|
| Transcript edit | **无** |
| Explicit correction confirm | **无** |
| Feedback API | **无** |
| Retry/rewrite ASR utterance | **无**专用纠错；仅通用错误 `alert` |
| Room `raw_voice_preferences` | 房间原声偏好，**非**语言画像 |
| `persona_adaptation` FeatureFlag | 布尔能力位，**非** UserProfile |

---

## 7. Proposed Manual Correction UI Location

**推荐落点：** `#translation-original` 按 `utterance_index` 分段旁路「编辑并确认」。

规则：

```text
KEEP system_text（系统识别事实，不可覆盖）
ADD  corrected_text（用户确认后提交）
BIND utterance_index (+ 建议补存 job_id / trace_id)
UX   显式确认；非自动纠错；非 alert-only 错误态
```

不要设计自动纠错 UI；不要在 Browser 做 Profile 参数抽取复杂规则。

---

## 8. Correction API Integration Point

| 层 | 建议 |
|----|------|
| Browser | `POST` **Web Server**（禁止默认直打 Scheduler） |
| Web Server | 校验用户与 session 归属 → `submitCorrection` → Scheduler |
| Scheduler | CorrectionHistory SSOT；返回 `ProfileDelta` |
| Web Server | version check → merge → persist UserProfile |

**幂等：** 借鉴 Scheduler `JobIdempotencyManager`；使用 `client_correction_id` 或 `(user_id, session_id, utterance_index, content_hash)`。

**并发：** 多 tab / 多设备依赖 `profile_version` 乐观锁；冲突返回可理解错误（`stale_profile` / `duplicate`）。

---

## 9. UserProfile Storage Location

| 位置 | 判定 |
|------|------|
| **Web Server DB** `user_profiles` | **目标 SSOT** |
| Browser Cookie / localStorage / IndexedDB | **禁止权威** |
| Scheduler | **禁止** Runtime Profile SSOT |
| Node | session-only cache only |

建议最小表：

```text
users(user_id, …)
user_profiles(
  user_id PK,
  schema_version,
  profile_version,
  profile_json,   -- ≤ 32768 bytes
  updated_at
)
```

---

## 10. ProfileDelta Update Flow

目标流：

```text
current UserProfile (Web Server)
  + ProfileDelta (Scheduler 响应)
  → validate expected profile_version
  → merge (server-side)
  → persist new UserProfile
  → return new_profile_version
```

| 步骤 | 现状 |
|------|------|
| Scheduler 返回 ProfileDelta | 无 |
| Web Server merge | 无 |
| stale / duplicate 处理 | 无 |
| Browser 参与 merge 规则 | **禁止**（应保持 UI-only） |

---

## 11. Session Bootstrap Integration

目标：

```text
Browser → Web Server → Scheduler → Node
UserProfile 仅 session start 发送一次
```

| 项 | 现状 | 动作 |
|----|------|------|
| Web Client 直连 Scheduler | 冲突 ownership | **MODIFY** 默认路径 |
| Gateway `SchedulerClient` 每次新建短 WS | 粘性脆弱 | **MODIFY** 长会话 |
| `session_init` 无 profile 字段 | 缺口 | **ADD** 合同 |
| 每 utterance 重复全量 profile | 尚未发生 | **禁止引入** |
| Web→Node 旁路 | **未发现** | **KEEP（合规）** |
| domain prior / Top-K | Web 不生成 | **KEEP**（属 Node/Model2） |

---

## 12. Multi-device / Version Handling

| 议题 | 现状 | 要求 |
|------|------|------|
| `profile_version` | 无 | 每次 merge 递增 |
| 多设备同时纠错 | 无 | 乐观并发；冲突可重拉 profile |
| 多 tab | 无 | 同 user 共享 server SSOT |
| Room 多成员纠错归属 | 未定义 | Phase 2 需明确 `user_id` 归属发言 utterance |

---

## 13. Data Ownership / SSOT Check

| 角色 | 设计 | 现状 | 判定 |
|------|------|------|------|
| Web Server | Runtime UserProfile SSOT | **缺失** | FAIL |
| Scheduler | CorrectionHistory SSOT | **缺失**（见 Scheduler 审计） | FAIL |
| Node | session-only cache | 无长期 profile | PASS（空缺正确） |
| Browser | UI state only | 直连 + localStorage UI prefs | **CONFLICT**（直连） |
| Global Model2 | 运营统一 | Web 无 per-user model | PASS |

---

## 14. Conflict / Redundancy / Legacy Findings

| 发现 | 分类 |
|------|------|
| Browser→Scheduler 直连 | **CONFLICT** |
| API Gateway 短连接 client | **MODIFY** |
| 内存 Tenant、无用户 DB | **ADD** |
| `tenant_id` vs `user_id` | **KEEP** tenant + **ADD** user |
| `persona_adaptation` flag | **KEEP / DEFER**（勿混名） |
| `raw_voice_preferences` | **KEEP** |
| localStorage TTS/log | **KEEP**（禁止升格为 profile） |
| 文档「未来 user_id」 | **ADD**（对齐实现） |
| 文本翻译 textarea | **KEEP**（非 correction） |
| 节点 Lexicon sqlite | **KEEP**（非 Web） |
| 全量 CorrectionHistory 存 Web | **DELETE（方案禁止）** |
| Cookie 作 Profile SSOT | **DELETE（方案禁止）** |

---

## 15. KEEP / MODIFY / ADD / DELETE / DEFER Matrix

| 项 | 动作 |
|----|------|
| 只读 transcript 展示 / `utterance_index` 绑定 | KEEP |
| 无 Web→Node 旁路 | KEEP |
| localStorage 仅 UI 偏好 | KEEP |
| 默认 Browser 直连 Scheduler | MODIFY |
| Gateway 会话客户端 | MODIFY |
| Web Server 用户鉴权 + DB | ADD |
| UserProfile CRUD + 32KB 门禁 | ADD |
| Manual Correction UI | ADD |
| `submitCorrection` + ProfileDelta apply | ADD |
| `session_init` 由 Server 注入 profile | ADD |
| TranslationResult 补 job/system 元数据 | ADD |
| Browser 权威 Profile / 全量训练史 | DELETE（方案） |
| 自动纠错 UI | DELETE（方案） |
| Room 多用户纠错策略细化 | DEFER（需产品定义） |
| `persona_adaptation` 语义清理 | DEFER |

---

## 16. Target File List（后续实现锚点，本轮不改）

```text
webapp/web-client/src/app/translation_display.ts
webapp/web-client/src/app/message_handler.ts
webapp/web-client/src/asr_subtitle.ts
webapp/web-client/src/ui/session_mode_template.ts
webapp/web-client/src/websocket/connect_handlers.ts
webapp/web-client/src/types.ts
webapp/shared/protocols/messages.ts
central_server/api-gateway/src/main.rs
central_server/api-gateway/src/auth.rs
central_server/api-gateway/src/tenant.rs
central_server/api-gateway/src/scheduler_client.rs
central_server/api-gateway/src/rest_api.rs
central_server/api-gateway/src/ws_api.rs
# NEW: user/profile/correction modules + DB migrations（Web Server）
```

---

## 17. Target Component List

```text
CorrectionEditor (per utterance_index)
CorrectionConfirmAction
SystemTextReadonlyView
CorrectedTextDraftView
ProfileStatusBadge (version only; optional)
SessionBootstrapViaWebServer (replace direct WS default)
```

---

## 18. Target API List

```text
GET  /v1/me/profile
PUT/PATCH internal apply_profile_delta(expected_version)
POST /v1/corrections                 # Browser → Web Server
     └─→ Scheduler POST /api/v1/corrections
WS/session via Web Server proxy
     session_init includes user_id + bounded user_profile (once)
```

---

## 19. Target Data Structures

### UserProfile V1（Web Server SSOT）

```text
schema_version
profile_version
phonetic_bias
tone_bias
personal_terms        # bounded Top-K
confusion_bias        # bounded Top-K
domain_bias           # bounded Top-K
```

**禁止字段：** 年龄/性别/职业/地理；完整 correction list；与 fuzzy recall 无关画像。

### CorrectionSubmitRequest / Response（示意）

```text
Request:
  user_id, session_id, utterance_index,
  job_id?, trace_id?,
  system_text, corrected_text,
  client_correction_id,
  source_profile_version?

Response:
  accepted, correction_id,
  profile_delta?,
  new_profile_version?,
  conflict?: stale_profile | duplicate | …
```

---

## 20. Risks

| ID | 风险 | 等级 |
|----|------|------|
| W1 | 无 Web Server / user_id，无法建立 Profile SSOT | P0 |
| W2 | 继续直连导致 Browser 变成事实 Profile 源 | P0 |
| W3 | 无纠错 UI / 元数据，无法绑定 utterance | P0 |
| W4 | 覆盖 system_text 丢失审计事实 | P0 |
| W5 | Gateway 短 WS 导致 session 粘性失败 | P1 |
| W6 | 多设备无 version 冲突处理 | P1 |
| W7 | `persona_adaptation` / preferences 命名混淆 | P2 |
| W8 | 为赶工把全量 CorrectionHistory 存 Web | P0（治理） |

---

## 21. Development Preconditions

1. **确立 Web Server**（扩展 API Gateway 或新服务）+ 用户鉴权 + DB。
2. Phase 1 冻结 `UserProfile` / `ProfileDelta` / `CorrectionSubmit` 合同（与 Scheduler 审计对齐）。
3. 默认会话路径改为 Browser → Web Server → Scheduler。
4. Browser **禁止**权威持久化 UserProfile / 全量纠错训练集。
5. UI 合同：system_text 不可覆盖；显式确认提交。
6. Scheduler Correction API 与 SessionBootstrap 可用（或并行排期但 Web 不假称已通）。

---

## 22. Recommended Development Sequence

```text
Phase 1  Web Server + user_id + UserProfile store（≤32KB）+ 合同冻结
Phase 2  Manual Correction UI + submitCorrection + idempotency
Phase 3  ProfileDelta merge（依赖 Scheduler Correction persistence）
Phase 4+ Model2 数据/训练（Web 不参与 recall）
```

Web **不**实现 Model2、Candidate Recall、Domain Vote、Assembly、KenLM。

---

## 23. Acceptance Checklist

| # | 检查项 | 结果 |
|---|--------|------|
| 默认不经 Browser 直连 Scheduler（或非生产默认） | **FAIL** |
| 存在稳定 `user_id` 鉴权 | **FAIL** |
| DB bounded UserProfile，>32KB 拒绝 | **FAIL** |
| Browser 非权威 Profile / 非全量 CorrectionHistory | **PASS**（空缺；需防未来误用） |
| session_init 由 Web Server 附带一次 UserProfile | **FAIL** |
| 每 utterance 不重复全量 Profile | **PASS**（尚未实现错误路径） |
| UI：编辑 + 显式确认；system_text 保留 | **FAIL** |
| submitCorrection 幂等 + 冲突错误 | **FAIL** |
| ProfileDelta merge + profile_version | **FAIL** |
| 无 Model2 / recall / vote / 节点状态 / ASR 后处理复制 | **PASS** |
| 身份链 Browser→Web Server→Scheduler→Node | **FAIL**（缺 Web Server 环） |
| 无 Web→Node 旁路 | **PASS** |
| localStorage 与 UserProfile 隔离 | **PASS**（当前仅 UI prefs） |

### Final Verdict

```text
NOT_READY

Web 实时翻译展示链路可用，但 User Manual Correction
与 Runtime UserProfile SSOT 所需的 Web Server、用户身份、
协议字段与纠错 UI 均未就位。

禁止边界目前因能力缺失而被动合规。
补齐 Phase 1 ownership 之前，不应开始 Phase 2 功能开发宣称就绪。
```

---

## Evidence Index（关键路径）

```text
webapp/web-client/src/types.ts
webapp/web-client/src/websocket/connect_handlers.ts
webapp/web-client/src/app/message_handler.ts
webapp/web-client/src/app/translation_display.ts
webapp/web-client/src/asr_subtitle.ts
webapp/web-client/src/ui/session_mode_template.ts
webapp/web-client/src/app.ts
webapp/web-client/src/main.ts
webapp/shared/protocols/messages.ts
webapp/docs/webClient/PRODUCT_ARCHITECTURE_AND_SESSION_MANAGEMENT.md
webapp/docs/api_gateway/PUBLIC_API_STATUS.md
central_server/api-gateway/src/scheduler_client.rs
central_server/api-gateway/src/auth.rs
central_server/api-gateway/src/rest_api.rs
central_server/scheduler/src/messages/session.rs
central_server/scheduler/src/app/routes/mod.rs
webapp/mobile-app/App.tsx
```
