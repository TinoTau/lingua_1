<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_P5_Production_AudioChunk_DualTurn_E2E_Report_2026_07_23.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — P5 Production AudioChunk Dual-Turn E2E Report

**Date:** 2026-07-23  
**Task:** Production AudioChunk 双 Turn E2E  
**Nature:** Focused runtime acceptance（真实生产链）  
**Code changes this round:** none

---

## 1. Executive Summary

本轮未能跑通 Web → Scheduler → Job → JobAssign → Node 的真实双 Turn AudioChunk 闭环。

**第一阻断位置：** 本机生产运行时基础设施未就绪——Redis 不可用，Scheduler（:5010）与 Node 未监听，Docker Desktop 未运行，无法拉起 `redis-lingua`。在禁止 Mock / 手工 Job 注入 / 绕过 WebSocket 的约束下，无法采集场景 A–C 的端到端证据矩阵。

```text
Production AudioChunk Dual-Turn E2E
INCOMPLETE
```

---

## 2. Development Goal

证明真实生产主链中：

```text
ConversationDomainState
→ AudioSender utterance snapshot
→ AudioChunk.domainPriors
→ Scheduler Actor
→ Job.domain_priors
→ JobAssign.domainPriors
→ Node ctx.domainPriors
```

完整传递，并满足「一句一不可变 snapshot」。  
本轮不验证识别率 / Tone / KenLM / LTR / Span 质量，不修 Audio Payload Ordering。

---

## 3. Runtime Environment

| Check | Result |
|-------|--------|
| Scheduler `:5010` listen | **No** |
| Node / Electron listen (`5020` / FW `6008`) | **No** |
| Web client (Vite `5173` / production bundle) | **Not running** |
| Windows service `Redis` | **Stopped** |
| `redis-cli ping` | connection refused |
| Docker Desktop / `redis-lingua` | **Docker API unavailable**（daemon not running） |
| Cursor/local `node` processes | IDE helpers only — not Lingua Node |
| `use_binary_frame=false` (code/nego) | Known from prior verification audit; **not re-confirmed live** this round |

**Builds used:** N/A — stack not started; no live session artifacts collected.

---

## 4. Production Chain Used

**Intended (not executed):**

```text
Web client JSON AudioChunk
→ ws://…/ws/session
→ Scheduler SessionActor
→ Job / JobAssign
→ paired Node
→ ctx.domainPriors
```

**Actually exercised this round:** environment pre-check only.  
**Not used:** Mock AudioSender, constructed SessionEvent/Job/JobAssign, ctx 直写, sendUtterance fallback, binary transport, test-only prior injection.

---

## 5. Scenario A — Non-empty Cross-Turn

**Status:** NOT RUN

| Layer | Evidence |
|-------|----------|
| Web Session State | — |
| AudioSender snapshot | — |
| Wire AudioChunk | — |
| Scheduler / Actor / Job / JobAssign / Node | — |

无法形成 Turn 1 真实 `DOMAIN_A`，也无法采集 Turn 2 全链。

---

## 6. Scenario B — Immutable Turn Snapshot

**Status:** NOT RUN  
依赖场景 A 的存活会话与中途 `ConversationDomainState` 更新观测。

---

## 7. Scenario C — Explicit Empty

**Status:** NOT RUN  
无法发送真实 AudioChunk 并验证 Wire `"domainPriors":[]` 与 Actor `FROZEN_EMPTY`。

---

## 8. Scenario D — Missing

**Status:** NOT APPLICABLE / NOT RUN  
生产 Web 当前每包显式携带字段；在无协议测试入口 + 无存活 Scheduler 时未执行 missing 包。

---

## 9. End-to-End Evidence Matrix

| Layer | Required | Collected |
|-------|----------|-----------|
| Web Session State | sessionId, domains, weights | **missing** |
| AudioSender snapshot | utterance snapshot | **missing** |
| Wire AudioChunk | seq, isFinal, domainPriors | **missing** |
| Scheduler Handler | Option presence, cleaned | **missing** |
| SessionActor | UNSET / FROZEN_EMPTY / FROZEN_NON_EMPTY | **missing** |
| Job | jobId, domain_priors | **missing** |
| JobAssign | domainPriors | **missing** |
| Node received / ctx | domainPriors | **missing** |

---

## 10. First Failure Boundary

```text
最后一个正确层: （无）环境预检前无生产会话
第一个错误层 / 阻断: Runtime Infrastructure

输入: 执行 Dual-Turn E2E 前置检查
期望: Redis + Scheduler:5010 + Node 注册 + Web JSON AudioChunk 会话可用
实际: Redis 停、Docker 不可用、5010/5020/6008 未监听
第一错误层: Redis / Scheduler 启动门槛（host）
对应位置: scripts/start_redis.ps1、scripts/start_scheduler.ps1、config.toml redis_runtime.enabled=true
是否 P5 Ordering Contract 内: 否（环境阻断，非 Ordering 逻辑失败）
最小修复范围: 启动 Docker Desktop 或可用 Redis → start_scheduler → start_electron_node → start_webapp → 人工/脚本驱动双 Turn 再测
```

本轮**未**对 Ordering Contract 代码提出修复方案（无代码断点证据）。

---

## 11. Audio Payload Ordering Observation

**Status:** NOT OBSERVED（无多 chunk 存活会话）

若后续 E2E 发现 final 越过 in-flight chunk 且划入 pending-next：记为独立 **Audio Payload Ordering P1**，不覆盖 Domain Prior Ordering 结论。

---

## 12. SSOT / Shadow Compliance

| Question | Answer |
|----------|--------|
| 是否使用 ConversationDomainState 作为唯一输入来源 | **未验证（未跑）** |
| 是否经过 AudioChunk 主链 | **未验证（未跑）** |
| 手工 prior 注入 | **未使用** |
| Job / Node 直写 | **未使用** |
| sendUtterance fallback | **未使用** |
| binary 替代 | **未使用** |
| feature flag / 双环境 / Shadow | **未引入** |

本轮无无效“假 PASS”捷径；亦无完整合规闭环证据。

---

## 13. Remaining P1

- **Runtime bring-up：** Redis + Scheduler + Node + Web 联调窗口  
- **本任务未完成项：** 场景 A/B/C 全层证据矩阵；Node ctx 闭环  
- **Audio Payload Ordering P1：** 仍独立，本轮未观察  

---

## 14. Final Verdict

```text
Production AudioChunk Dual-Turn E2E
INCOMPLETE
```

| 项 | 说明 |
|----|------|
| 未完成层级 | Web Session → Wire → Scheduler → Actor → Job → JobAssign → **Node ctx**（全部） |
| 阻断原因 | 本机 Redis/Docker/Scheduler/Node 生产栈未运行；无法在禁止 Mock 条件下采集真实值 |
| 第一阻断位置 | Redis unavailable → Scheduler cannot serve `:5010` → Node/Web session chain cannot start |

**不得解释为 PASS。** 亦非 Ordering Contract 逻辑 FAIL（无运行时反证）。

---

## 15. Next Step

1. 启动 Docker Desktop（或可用 Redis）→ `scripts/start_redis.ps1` / `redis-lingua`  
2. `scripts/start_scheduler.ps1` + `scripts/start_electron_node.ps1` + `scripts/start_webapp.ps1`  
3. 确认 `use_binary_frame=false`、节点已注册、日志可关联 `sessionId` / `jobId`  
4. **重跑本任务同一四场景**（真实会话 Turn 1 形成 `DOMAIN_A`，再测跨 Turn / 不可变 / 显式空）  
5. 仅当 Node ctx 证据齐全后，才可裁决 PASS/FAIL；PASS 后进入 **P5 Final Compliance / Freeze Audit**（仍勿直接 dialog_200）
