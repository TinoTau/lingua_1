<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Worker_Readiness_Queue_Recovery_Repair_Report_2026_06_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Worker Readiness & Queue Recovery Repair Report

**Date:** 2026-06-29  
**Run ID (validation):** `fw_queue_recovery_validate_20260629`  
**Verdict:** **PASS**

---

## Executive Summary

本轮在 **不修改 Tone V2 / 主链 / JSON required schema** 的前提下，修复 FW Worker 两类问题：

1. **Health 假绿** — `GET /health` 新增 optional `readiness` 字段，可明确 `utterance_ready=false` 当队列满时。  
2. **ASR 单槽队列卡死** — 任务 `timeout` 后自动 **kill Worker + 重建 task queue + 重启 Worker**，避免 `queue_depth=1` 永久 503。

修复后验证：

| 验证项 | 结果 |
|--------|------|
| 单测 readiness / recovery / 503 reason | 13/13 PASS |
| Tone fail-closed 回归 | 4/4 PASS |
| 随机 5 条 `/utterance` | 5/5 HTTP 200 |
| 连续 20 条 `/utterance` | 20/20 HTTP 200 |
| `validate-dialog200-full.py` | manifestOk + 5 FW samples OK |
| `audit_runtime_acceptance --part all` | 20/20 sample + **200/200 performance** |
| `d001-timestamp-tone-probe.mjs` | **SKIP** — 需 Electron Node 运行（非 FW 直连） |

---

## Root Cause Confirmation

与审计一致：

- `QUEUE_MAX=1` 单槽队列在 task timeout / worker hang 后槽位残留 → `is_queue_full()` 永久 true  
- `/health` 原仅 `status=ok`，无法表达 utterance 不可接受  
- **非 Tone / 语料 / CUDA / VAD 问题**

触发链（日志已证实）：`tone-audit-d190` timeout → `queue_depth=1` → 后续全部 `503 ASR service is busy`

---

## Modified Files

| 文件 | 变更 |
|------|------|
| `asr_worker_manager.py` | timeout recovery、readiness、`last_error`、队列重建 |
| `utterance_asr.py` | 503/504 machine-readable `reason`、recovery 等待 |
| `api_routes.py` | health `readiness` 字段、ASR 失败 `toneReached=false` 日志 |
| `asr_readiness.py` | **新增** readiness 快照 helper |
| `asr_errors.py` | **新增** 结构化 HTTP 错误 |
| `tests/test_asr_worker_readiness.py` | **新增** A/B/C/D 测试 |
| `tone_module/_validate_queue_recovery.py` | **新增** 只读运行时验证脚本 |
| `README.md` | readiness / 503 语义 / 运维说明 |

---

## Health Contract Changes

**保留全部现有字段**，新增 optional：

```json
"readiness": {
  "process_alive": true,
  "worker_running": true,
  "worker_accepting_tasks": true,
  "queue_depth": 0,
  "queue_max": 1,
  "queue_full": false,
  "utterance_ready": true,
  "worker_restarting": false,
  "last_error": null
}
```

**规则：** 当 `queue_depth >= queue_max` → `queue_full=true`, `utterance_ready=false`，即使 `status=ok`。

---

## Queue Recovery Logic

`submit_task` 发生 `asyncio.TimeoutError` 时：

1. 清理 timed-out job 的 `pending_results`  
2. 记录 `last_error`（reason=`task_timeout`）  
3. `_recover_worker()`：  
   - 状态 → `RESTARTING`  
   - fail 其余 pending futures  
   - kill Worker（`discard_task_queue=True`，不往满队列写 shutdown）  
   - **新建** `mp.Queue(maxsize=1)`  
   - 重启 Worker 子进程  
4. 抛出 `TimeoutError` → utterance 层返回 **504** `reason=timeout_recovery`  
5. 后续请求经 `wait_until_accepting()` 可继续处理

**未扩大 `QUEUE_MAX`**，未新增第二套 Worker。

---

## 503 Reason Contract

`/utterance` 错误 `detail` 现为对象（保留人类可读 `message`）：

| HTTP | reason | 场景 |
|------|--------|------|
| 503 | `queue_full` | 单槽队列满 |
| 503 | `worker_not_ready` | Worker 不可用 |
| 503 | `worker_restarting` | recovery 进行中 |
| 504 | `timeout_recovery` | ASR 超时且已触发 recovery |

示例：

```json
{"detail": {"message": "ASR service is busy, please retry later", "reason": "queue_full"}}
```

ASR 阶段失败日志含 `toneReached=false`。

---

## Test Result

```text
python -m unittest tests.test_asr_worker_readiness -q  → Ran 13 tests OK
python -m unittest tone_module.test_classifier_fail_closed -q → Ran 4 tests OK
```

覆盖：Health readiness、timeout recovery mock、503 reason、Tone 调用顺序未变。

---

## Runtime Validation Result

### Health（修复后）

`readiness.utterance_ready=true`, `queue_full=false`

### 随机 5 条

`ok200=5`, `err503=0`, 全部 `toneEnabled=true`

### 连续 20 条（d001–d020）

`ok200=20`, `err503=0`, 无 stuck queue

### audit_runtime_acceptance --part all

输出：`docs/tone-v2/_audit_post_recovery.json`

- `toneTokenSample20`: **20/20 httpOk**, `toneEnabledCount=20`  
- `performanceDialog200`: **`utteranceCount=200`**

对比修复前 `_audit_full_corpus.json`：20/20 503 → **完全恢复**。

---

## Dialog200 Validation Result

`validate-dialog200-full.py`:

- `manifestOk=true`, `wavCount=200`  
- 5 个 FW 样本全部 `httpOk=true`, `toneEnabled=true`

---

## Tone Boundary Verification

- `perform_asr` **未**调用 `run_tone_inference`（单测断言）  
- `process_utterance` 仍在 ASR 成功后、dedup 前调用 Tone（单测断言顺序）  
- fail-closed 单测未回归  
- 修复后 probe 全部 `toneEnabled=true`（ASR 成功路径）

**未触碰 Tone V2 设计 / 模型 / 主链。**

---

## Architecture Compliance

| 约束 | 合规 |
|------|------|
| 不改 Tone V2 / Recall / Assembly / KenLM / Node 主链 | ✓ |
| 不改 JSON required schema | ✓（health 仅新增 optional `readiness`） |
| 不新增 shadow / mock / fallback / 第二条链路 | ✓ |
| 不扩大队列掩盖问题 | ✓（QUEUE_MAX 仍为 1） |
| Tone 位置不变 | ✓ |

---

## KEEP / MODIFY / RESTORE / DELETE

| 动作 | 项 |
|------|-----|
| **KEEP** | 单槽队列架构、Tone 调用顺序、utterance JSON 契约 |
| **MODIFY** | `asr_worker_manager` recovery、health readiness、503 reason |
| **RESTORE** | — |
| **DELETE** | — |

---

## Remaining Risks

1. **`status=ok` 仍可能误导** — 需查看 `readiness.utterance_ready`；顶层 status 未改（schema 约束）。  
2. **Watchdog crash 重启** 仍复用旧 task queue（与 timeout recovery 不同路径）；极端 crash+满队列场景可能仍需手动重启 FW。  
3. **`d001-timestamp-tone-probe.mjs`** 依赖 Electron Node ASR 注册，非 FW 单独可验。  
4. **并发 Node + audit** 仍会在单槽队列上产生 `queue_full` 503（语义正确，非 stuck）。

---

## Final Answers

| 问题 | 答案 |
|------|------|
| `/health=200` 是否仍可能误导 `/utterance ready`？ | **是（顶层 status）**，但 **`readiness.utterance_ready` 已可正确表达** |
| queue stuck 后是否仍会永久 503？ | **否** — timeout 触发 recovery；验证 20 连续 + 200 batch 无 stuck |
| 503 是否能区分原因？ | **是** — `detail.reason` |
| 修复是否触碰 Tone V2？ | **否** |
| 修复是否触碰主链？ | **否** |
| 可否重跑 full dialog_200 Runtime audit？ | **是** — 已 PASS（200/200） |
| 可否继续 Tone V2 Phase 1？ | **是** |

---

## Verdict: **PASS**

FW Worker readiness 与 queue recovery 目标已达成；Runtime acceptance 与 dialog_200 批量验证通过；Tone 边界与 fail-closed 未回归。
