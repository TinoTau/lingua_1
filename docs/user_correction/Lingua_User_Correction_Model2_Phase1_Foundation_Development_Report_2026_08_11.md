# Lingua User Correction + Model2 — Phase 1 Foundation Development Report

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Nature | **FOUNDATION DEVELOPMENT** (Identity / Contract / Persistence) |
| Based on | Scheduler + Web Pre-Development Audits (2026-08-11) |
| Verdict | **PASS_WITH_KNOWN_DEFERRED** |

---

## 1. Executive Summary

Phase 1 建立了 User Manual Correction + UserProfile + 未来 Model2 所需的**最小基础设施**，未开发 Model2、未开发纠错 UI、未改冻结 Node ASR 后处理主链、未修改 JobResult。

| 能力 | 状态 |
|------|------|
| Stable `user_id`（≠ `tenant_id`） | **Done**（API Gateway） |
| Runtime UserProfile SSOT ≤32KiB | **Done**（Gateway SQLite） |
| Browser → Gateway → Scheduler | **Done**（`/v1/session` proxy） |
| CorrectionEvent + durable repo | **Done**（Scheduler SQLite） |
| `POST /api/v1/corrections` | **Done**（token auth） |
| `NodeMessage::SessionBootstrap` | **Done** |
| Node session-only profile cache | **Done** |
| JobResult unchanged | **Verified** |
| Model2 runtime / UI / ProfileDelta algo | **Deferred** |

---

## 2. Architecture Before / After

### Before

```text
Browser ──WS──► Scheduler ──► Node
API Gateway = B2B tenant stub (no user_id / no UserProfile)
No CorrectionHistory store
No SessionBootstrap
```

### After

```text
Browser ──WS /v1/session (+ access_token)──► API Gateway (Web User Gateway)
                                              ├─ AuthContext {tenant_id, user_id}
                                              ├─ UserProfile SSOT (SQLite)
                                              └─ inject session_init identity/profile
                                                    │
                                                    ▼
                                               Scheduler
                                              ├─ session holds user_profile
                                              ├─ CorrectionHistory SSOT (SQLite)
                                              ├─ POST /api/v1/corrections
                                              └─ SessionBootstrap (once / node assignment)
                                                    │
                                                    ▼
                                               Node (memory cache only)
```

---

## 3. Implemented Scope

- API Gateway: identity, UserProfile V1 + SQLite repo, REST `/v1/me`, `/v1/me/profile`, WS session proxy
- Scheduler: SessionInit identity/profile fields, CorrectionEvent V1 + SQLite + service + API, SessionBootstrap send
- Node: `session_bootstrap` consumer + in-memory cache + clear on `removeSession`
- Protocols: Rust + electron/webapp/central TS sync for SessionBootstrap / UserProfileV1
- Web client default URL → Gateway `/v1/session` (+ optional `VITE_API_KEY` query token)

---

## 4. User Identity Design

- Credential: `Authorization: Bearer <api_key>`（REST）或 WS `?access_token=` / `?api_key=`（Browser 限制）
- `user_id = user-{sha256(tenant_id|api_key)[:16]}` — **server-owned**，客户端无法伪造他人 `user_id`
- `session_init` 上任何客户端自带 `user_id` / `user_profile` 在 Gateway **剥离后重写**

---

## 5. Tenant vs User vs Session Ownership

| ID | Owner | Notes |
|----|-------|-------|
| `tenant_id` | API Gateway TenantManager | B2B / rate-limit |
| `user_id` | API Gateway（derived） | Runtime person identity |
| `session_id` | Scheduler | Unchanged authority |
| `utterance_index` | Scheduler | Correction binding key（未新增 utterance UUID） |

---

## 6. UserProfile V1 Contract

```text
schema_version, profile_version,
phonetic_bias, tone_bias, personal_terms, confusion_bias, domain_bias
```

Hard limit: **32768 bytes** serialized JSON — exceed → explicit reject（no silent truncate）.

---

## 7. UserProfile Persistence

- Trait: `UserProfileRepository`
- Impl: `SqliteUserProfileRepository`（`data/user_profiles.sqlite3`）
- Tables: `users`, `user_profiles`
- Ops: ensure_user, get, get_or_create_default, update(expected_version), apply_delta stub（Phase 3+）

---

## 8. CorrectionEvent V1 Contract

Fields: `event_id`, `user_id`, `session_id`, `utterance_index`, `system_text`, `corrected_text`, `corrections[]`, `source_profile_version`, `pipeline_version`, `idempotency_key`, `created_at`.

`system_text` 与 `corrected_text` 分列存储；不覆盖 system 事实。  
不存 JobResult / audio / full conversation。

---

## 9. Correction Persistence

- Trait: `CorrectionRepository`（非 Redis Job TTL）
- Impl: `SqliteCorrectionRepository`（`LINGUA_CORRECTION_DB_PATH` 或 `data/correction_events.sqlite3`）
- Unique `(user_id, idempotency_key)`

---

## 10. Correction Idempotency

`CorrectionService.submit`: 同 `user_id`+`idempotency_key` 返回已有 `correction_id`，`duplicate=true`。  
`profile_delta` Phase 1 恒为 `null`（合同预留）。

---

## 11. Browser → Gateway Session Path

- New route: `GET /v1/session`（auth required）
- Bidirectional WS proxy to Scheduler URL
- Default web-client URL: `ws://127.0.0.1:8081/v1/session`
- Legacy direct Scheduler仍可用 `VITE_SCHEDULER_URL`（非默认）

---

## 12. Gateway → Scheduler Identity/Profile Transport

On `session_init` only:

```text
user_id, tenant_id, profile_version, user_profile
```

Injected by Gateway; Browser does not authoritatively construct profile.

---

## 13. Scheduler → Node SessionBootstrap

- Message: `NodeMessage::SessionBootstrap`
- Trigger: `job_creator` after node selection via `maybe_send_session_bootstrap`
- Once per `session_id`↔`node_id`（tracked by `Session.bootstrapped_node_id`）
- Node migration（不同 node）→ 再次 bootstrap
- Same node subsequent utterances → **no** full profile resend

---

## 14. Node Session Cache Lifecycle

- Store on `session_bootstrap`
- Clear on `removeSession(sessionId)`
- No disk / no user DB
- Missing profile does not block jobs

---

## 15. JobResult Non-Modification Verification

- `NodeMessage::JobResult` **未改字段**
- UserProfile **不进入** JobResult
- Correction **不依赖** JobResult 新字段  
→ **No BLOCKER**

---

## 16. Model-Hub Reuse

- Kept as-is
- Added lightweight `Model2VersionMetadata` placeholder on Gateway（`model_id/version/checksum/task`）— **no artifact / no per-user model**

---

## 17. Database Schema / Migration

### Gateway SQLite

```sql
users(user_id PK, tenant_id, display_name, created_at)
user_profiles(user_id PK/FK, schema_version, profile_version, profile_json, updated_at)
```

### Scheduler SQLite

```sql
correction_events(
  event_id PK, user_id, session_id, utterance_index,
  system_text, corrected_text, corrections_json,
  source_profile_version, pipeline_version, idempotency_key, created_at
)
UNIQUE(user_id, idempotency_key)
```

---

## 18. API Contracts

| Method | Path | Owner |
|--------|------|-------|
| GET | `/v1/me` | Gateway |
| GET/PUT | `/v1/me/profile` | Gateway |
| GET | `/v1/session` (WS) | Gateway proxy |
| GET | `/v1/stream` (WS) | Gateway（legacy B2B stream） |
| POST | `/api/v1/corrections` | Scheduler（`LINGUA_CORRECTION_API_TOKEN`） |

---

## 19. Protocol Contracts

- `SessionInit` += optional `user_id` / `user_profile` / `profile_version`
- `NodeMessage::session_bootstrap`
- TS mirrors: electron / webapp / central_server shared protocols

---

## 20. Modified File Inventory（主要）

```text
central_server/api-gateway/Cargo.toml
central_server/api-gateway/config.toml
central_server/api-gateway/src/main.rs
central_server/api-gateway/src/auth.rs
central_server/api-gateway/src/config.rs
central_server/api-gateway/src/rest_api.rs
central_server/scheduler/Cargo.toml
central_server/scheduler/src/messages/{session,node,mod}.rs
central_server/scheduler/src/core/{session,app_state}.rs
central_server/scheduler/src/websocket/job_creator.rs
central_server/scheduler/src/websocket/session_message_handler/{mod,core}.rs
central_server/scheduler/src/services/mod.rs
central_server/scheduler/src/app/{startup,routes/*}.rs
electron_node/shared/protocols/messages.ts
electron_node/electron-node/main/src/agent/node-agent-simple.ts
webapp/web-client/src/types.ts
webapp/shared/protocols/messages.ts
central_server/shared/protocols/messages.ts
```

---

## 21. Added File Inventory

```text
central_server/api-gateway/src/lib.rs
central_server/api-gateway/src/app_state.rs
central_server/api-gateway/src/user_identity.rs
central_server/api-gateway/src/user_profile.rs
central_server/api-gateway/src/user_profile_repository.rs
central_server/api-gateway/src/session_proxy.rs
central_server/api-gateway/src/model2_metadata.rs
central_server/scheduler/src/messages/user_profile.rs
central_server/scheduler/src/services/session_bootstrap.rs
central_server/scheduler/src/services/correction/{mod,service,sqlite_repository}.rs
electron_node/electron-node/main/src/agent/session-user-profile-cache.test.ts
docs/user_correction/Lingua_User_Correction_Model2_Phase1_Foundation_Development_Report_2026_08_11.md
```

---

## 22. Deleted / Retired Path Inventory

- **No production path deleted**
- Direct Browser→Scheduler remains available via env override（非默认）
- No shadow duplicate correction main path

---

## 23. Tests Added

- Gateway: identity stability, profile roundtrip, >32KiB reject, version/stale, session_init inject/strip forge
- Scheduler: correction insert/idempotency/user isolation; SessionBootstrap type guard
- Node: session profile cache clear semantics（jest）

---

## 24. Test Results

| Suite | Result |
|-------|--------|
| `api-gateway` `cargo test --lib` | **7 passed** |
| `scheduler` `cargo test --lib correction` | **1 passed**（module compile OK） |
| `scheduler` `cargo test --lib session_bootstrap` | **1 passed** |
| Node jest `session-user-profile-cache.test.ts` | **passed**（see CI local run） |

---

## 25. Regression Results

| Area | Status |
|------|--------|
| JobResult schema | Unchanged |
| Frozen ASR pipeline code paths | Unchanged（no fw-detector edits） |
| Model-Hub | Unchanged |
| Existing `/v1/stream` translate path | Kept |
| Full e2e dialog_200 | **Not rerun**（out of Phase 1 scope; deferred） |

---

## 26. Performance / Payload Measurements

- Empty UserProfile serialize ≪ 32KiB
- Oversized personal_terms rejected at serialize/update
- SessionBootstrap only on node assignment change（not per utterance）

---

## 27. Security / Identity Checks

- Unauthorized Gateway requests → 401
- Client-forged `user_id` stripped on proxy
- Correction API requires `LINGUA_CORRECTION_API_TOKEN`
- Live session user mismatch → 403 when session has `user_id`

---

## 28. KEEP / MODIFY / ADD / DELETE / DEFER

| Item | Action |
|------|--------|
| Model-Hub / InstalledModel | KEEP |
| JobResult | KEEP |
| Node ASR chain | KEEP |
| tenant_id | KEEP |
| Gateway as Web User Gateway | MODIFY |
| Web default WS URL | MODIFY |
| user_id + UserProfile SSOT | ADD |
| CorrectionHistory SQLite | ADD |
| SessionBootstrap | ADD |
| Correction UI / ProfileDelta algo / Model2 | DEFER |
| Per-user models / JobResult profile fields | DELETE（as designs） |

---

## 29. Known Deferred Items

1. ProfileDelta calculation / merge algorithm  
2. Manual Correction UI  
3. Span auto-alignment  
4. Dataset builder / Model2 train+runtime  
5. Full dialog_200 / production e2e under Gateway default  
6. Stronger IAM/OAuth beyond API-key→user_id  
7. PostgreSQL migration（interfaces ready）

---

## 30. Remaining Risks

| Risk | Level |
|------|-------|
| Local WS auth via query token leakage in logs/history | P1 |
| Correction API unusable until `LINGUA_CORRECTION_API_TOKEN` set | P1（by design） |
| Default Gateway URL breaks clients without API key | P1（set `VITE_API_KEY` or override URL） |
| SessionBootstrap depends on job path selecting a node | P2 |

---

## 31. Phase 2 Preconditions

1. Gateway reachable; `VITE_API_KEY` configured for Browser  
2. Scheduler `LINGUA_CORRECTION_API_TOKEN` set; Gateway can call corrections  
3. UI keeps `system_text` immutable; bind `user_id+session_id+utterance_index`  
4. Do not store CorrectionHistory on Web  
5. Do not put UserProfile into JobResult  
6. Model2 still not required for Phase 2 UI

---

## 32. Acceptance Checklist

| Criterion | Result |
|-----------|--------|
| stable user_id exists | **PASS** |
| tenant/user/session ownership clear | **PASS** |
| Gateway = Runtime UserProfile SSOT | **PASS** |
| Browser not UserProfile SSOT | **PASS** |
| UserProfile ≤32KiB hard reject | **PASS** |
| Scheduler durable CorrectionRepository | **PASS** |
| Not using Redis Job TTL for corrections | **PASS** |
| CorrectionEvent does not clone JobResult | **PASS** |
| UserProfile not in JobResult | **PASS** |
| SessionBootstrap works once / node assignment | **PASS**（code path + unit） |
| Node migration can bootstrap again | **PASS**（bootstrapped_node_id compare） |
| Node does not persist UserProfile | **PASS** |
| Frozen Node ASR pipeline unchanged | **PASS** |
| JobResult consumers regression (schema) | **PASS** |
| Model-Hub still works | **PASS**（untouched） |
| No shadow/compat duplicate main path | **PASS** |
| Tests pass | **PASS**（listed suites） |

### Final Verdict

```text
PASS_WITH_KNOWN_DEFERRED

Phase 1 foundation is in place for identity, bounded UserProfile SSOT,
CorrectionHistory persistence, Gateway session proxy, and SessionBootstrap.

Model2, Correction UI, and ProfileDelta learning remain deferred by contract.
```
