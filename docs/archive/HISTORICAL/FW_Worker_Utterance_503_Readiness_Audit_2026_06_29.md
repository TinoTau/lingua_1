<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Worker_Utterance_503_Readiness_Audit_2026_06_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Worker Utterance 503 Readiness Audit

**Run ID:** `fw_ready_audit_20260629_085823`  
**Date:** 2026-06-29  
**Scope:** 只读审计 — 定位 `GET /health=200` 但 `POST /utterance=503` 根因  
**Verdict:** **CONDITIONAL PASS**

---

## Executive Summary

| 问题 | 结论 |
|------|------|
| `/health=200` 是否代表 `/utterance ready`？ | **否** |
| `/utterance=503` 根因 | **ASR 单槽队列满（`QUEUE_MAX=1`）+ Worker 卡住/超时后队列未恢复** |
| 责任层 | **FW Worker / ASR Worker 队列** — 非 Tone、非 VAD、非 CUDA、非语料、非主链 |
| 是否需要修改 Tone V2？ | **否** |
| 是否需要修改主链？ | **否**（本轮禁止项内） |
| 修复后能否重跑 `audit_runtime_acceptance --part all`？ | **是**（需先重启 FW、串行请求） |
| 能否继续 Tone V2 Phase 1？ | **是** |

**一句话：** 503 的 HTTP body 为 `"ASR service is busy, please retry later"`，由 `utterance_asr.perform_asr()` 在 `manager.is_queue_full()` 时抛出；VAD 已通过，**Tone 未到达**。Health 仍返回 `status=ok`，存在 **Health Contract Gap**。

重启 FW Worker 后，同一 Run ID 下 **d001 + 4 条随机 case 全部 HTTP 200**，ASR 与 Tone 均正常执行。

---

## Run ID 统一说明

本轮所有探测、日志摘录、命令输出均使用：

```text
fw_ready_audit_20260629_085823
```

- **Pre-restart 探测（5 条）：** 全部 503  
- **Post-restart 探测（5 条）：** 全部 200  
- **不混用** `_audit_full_corpus.json`（2026-06-29 08:31:19，20/20 503）与 post-restart PASS — 后者属于同一 Run ID 的修复验证阶段

---

## 1. Service Startup Matrix

| 项 | 值 |
|----|-----|
| **cwd** | `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad` |
| **Python（必须）** | `.venv\Scripts\python.exe` |
| **command** | `.venv\Scripts\python.exe faster_whisper_vad_service.py` |
| **port** | `6007` (`FASTER_WHISPER_VAD_PORT`) |
| **Pre-restart PID** | 43676 |
| **Post-restart PID** | 47440（Worker PID 42636） |
| **CUDA** | 可用；`CUDA_PATH=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4` |
| **venv onnxruntime** | TensorrtExecutionProvider, CUDAExecutionProvider, CPUExecutionProvider |
| **venv ctranslate2 cuda** | int8_float16, float16, float32 等 |
| **系统 Python** | `D:\Python\Python310\python.EXE` — 仅 Azure+CPU EP，**不可用于 FW Worker** |
| **ASR model** | `models/faster-whisper-medium` |
| **VAD model** | `models/vad/silero/silero_vad_official.onnx` |
| **TONE_MODEL_PATH** | `tone_module/models/tone_cnn_p0.npz`（默认，文件存在） |
| **PYTHONUTF8** | `1` |
| **ASR_DEVICE / COMPUTE** | cuda / int8_float16 |
| **QUEUE_MAX** | **1**（`asr_worker_manager.py`） |
| **MAX_WAIT_SECONDS** | 30.0 |

---

## 2. Health Endpoint Analysis

### Pre-restart（503 窗口）

```json
{
  "status": "ok",
  "asr_model_loaded": true,
  "vad_model_loaded": true,
  "asr_worker": {
    "is_running": true,
    "worker_state": "running",
    "worker_pid": 16040,
    "queue_depth": 1,
    "pending_results": 0,
    "total_tasks": 26,
    "completed_tasks": 21
  }
}
```

### Post-restart（验证）

```json
{
  "status": "ok",
  "asr_worker": {
    "queue_depth": 0,
    "total_tasks": 5,
    "completed_tasks": 5,
    "pending_results": 0
  }
}
```

### Health Contract Gap（只记录，不改接口）

| 应有信号 | 当前 health | 缺口 |
|----------|-------------|------|
| 进程存活 | ✓ implied | — |
| Whisper 已加载 | `asr_model_loaded` | **实际 = `worker_pid != null`** |
| VAD 已加载 | `vad_model_loaded: true` | **硬编码，无运行时探测** |
| 队列可接受任务 | ✗ | **无 `queue_full` / `utterance_ready`** |
| 最近错误 | ✗ | 无 `last_error` |
| CUDA/Provider | 部分（device/compute_type） | 无 onnxruntime provider 列表 |

**标记：Health Contract Gap** — `status=ok` + `queue_depth=1` + `QUEUE_MAX=1` 时，所有新 `/utterance` 立即 503。

---

## 3. Utterance Endpoint Analysis

**URL:** `POST http://127.0.0.1:6007/utterance`  
**正确格式:** JSON `UtteranceRequest`（pcm16 base64），**非** raw `audio/wav` upload（后者返回 500）。

### Pre-restart（Run ID 探测）

| Case | HTTP | Latency | detail | Tone |
|------|------|---------|--------|------|
| d001 | 503 | 5359ms | ASR service is busy | **Tone not reached** |
| d025 | 503 | 4317ms | ASR service is busy | **Tone not reached** |
| d141 | 503 | 5396ms | ASR service is busy | **Tone not reached** |
| d040 | 503 | 3484ms | ASR service is busy | **Tone not reached** |
| d126 | 503 | 3023ms | ASR service is busy | **Tone not reached** |

503 分类：**worker queue unavailable**（`is_queue_full`）— 非模型缺失、非 VAD、非 CUDA、非音频格式、非 Tone。

### Post-restart（同一 Run ID 验证）

| Case | HTTP | Latency | ASR text（preview） | Tone |
|------|------|---------|---------------------|------|
| d001 | 200 | 9643ms | 你好,我想點一杯熱拿鐵… | Tone reached |
| d025 | 200 | 7374ms | 请简单介绍一下… | Tone reached |
| d141 | 200 | 6933ms | 跟会员系统相关的需求… | Tone reached |
| d040 | 200 | 5294ms | 自教课还剩几次… | Tone reached |
| d126 | 200 | 4419ms | 请问理财产品的风险… | Tone reached（log: slices=16） |

---

## 4. Log Evidence

**Log:** `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log`  
**`queue is full` 出现次数:** 512+

### 503 触发链（2026-06-29 08:14–08:47）

1. **08:14:29** `tone-audit-d190` — Worker 收到任务，`transcribe()` 17ms 返回 generator  
2. **08:14:57** `tone-audit-d190` — **`ASR task timeout after 30.0s`**（segments 未在超时窗口内完成回传）  
3. **08:15:30** `tone-audit-d071` — 超时，`queue_depth=1`（队列槽被占用）  
4. **08:15:34** `tone-audit-d063` — **`ASR queue is full, returning 503`** — 此后 audit 批量 503  
5. **08:59:17** `fw_ready_audit_...-d001` — VAD/validation 正常 → 503 queue full  
6. **09:07:11** post-restart `d126` — ASR 完成 → **`ToneModule Phase3: slices=16 inference_ms=8`**

**Failing component:** `ASRWorkerManager` / `utterance_asr.perform_asr`  
**Failing function:** `is_queue_full()` → `HTTPException(503, "ASR service is busy, please retry later")`  
**Exception type:** 预期内 HTTPException，非未捕获栈

### 503 时代码路径

```67:77:electron_node/services/faster_whisper_vad/utterance_asr.py
    if manager.is_queue_full():
        stats = manager.get_stats()
        logger.warning(
            f"[{trace_id}] ASR queue is full, returning 503 Service Busy. "
            f"queue_depth={stats['queue_depth']}"
        )
        raise HTTPException(
            status_code=503,
            detail="ASR service is busy, please retry later",
            headers={"Retry-After": "1"}
        )
```

```395:402:electron_node/services/faster_whisper_vad/asr_worker_manager.py
    def is_queue_full(self) -> bool:
        """检查队列是否已满"""
        if not self.task_queue:
            return True
        try:
            return self.task_queue.full()
        except Exception:
            return True
```

---

## 5. Config Analysis

| 配置项 | 状态 | 与 503 关系 |
|--------|------|-------------|
| `QUEUE_MAX=1` | 已确认 | **直接原因** — 单槽队列 |
| `MAX_WAIT_SECONDS=30` | 30s | d190 超时后队列进入 stuck 状态 |
| FW disabled | 否 | — |
| Port 6007 | 正确 | — |
| ASR/VAD/Tone 模型路径 | 存在 | 非 503 原因 |
| cuda + int8_float16 | 匹配 | 非 503 原因 |
| Node `servicePreferences.faster-whisper-vad` | 未在本轮改 | Node 并发 `audio-test-*` 与 audit 叠加加剧争用 |

**区分：**

- **FW Worker 自身：** 队列容量 + stuck 状态 → 503  
- **Test Harness：** `audit_runtime_acceptance` 在 VAD 阶段仍串行发下一请求，与 ASR 处理重叠  
- **语料：** 无问题  
- **Tone：** 503 阶段未到达

---

## 6. Audio Asset Validation

| 项 | 结果 |
|----|------|
| Manifest | `restored_full_v1`, caseCount=200 |
| WAV 文件 | 200/200 存在 |
| 格式 | 16kHz, mono, PCM — wave 可读 |
| d001 | 6.095s, 195092 bytes |
| 随机 d046/d007/d128/d194 | 均可读 |

**结论：语料不是 503 原因。**

---

## 7. Tone vs ASR Boundary

| 场景 | 判定 |
|------|------|
| Pre-restart 503 | **Tone not reached** — VAD 通过后 `perform_asr` 队列拒绝 |
| Post-restart 200 | **Tone reached** — log 显示 `run_tone_inference` / `ToneModule Phase3` |
| Tone fail-closed | 本轮 503 不涉及 Tone fail-closed |
| Tone V2 架构问题 | **否** |

`_audit_full_corpus.json` 中 `toneEnabledCount=0`、`utteranceCount=0` 是因为 **全部在 ASR 阶段 503**，不是 Tone 回归。

---

## 8. Expected / Actual / Impact / Severity

| ID | Expected | Actual | Impact | Severity | Owner | Required Action |
|----|----------|--------|--------|----------|-------|-----------------|
| F01 | health 反映 utterance 就绪 | status=ok 且 queue_depth=1 仍拒绝对外服务 | 假绿 health；batch 全 503 | HIGH | FW Worker | 记录 Health Contract Gap |
| F02 | 503 仅服务不可用 | busy = queue full | audit 20/20 失败 | HIGH | FW Worker | 重启 + 串行 audit |
| F03 | 单槽队列可恢复 | d190 超时后队列永久满至重启 | 长时间 503 | HIGH | ASR model | 重启；后续单独查 segment generator hang |
| F04 | asr_model_loaded 表模型 | = worker_pid | health 误导 | MEDIUM | FW Worker | KEEP（本轮不改） |
| F05 | dialog_200 可读 | 200/200 OK | 无 | INFO | Test Corpus | KEEP |
| F06 | 503 与 Tone 无关 | ASR 阶段拒绝 | Tone V2 被误疑 | INFO | Tone Module | 无需改 Tone V2 |

---

## 9. Required Repair Matrix

### KEEP

- FW Worker 进程隔离 ASR 架构  
- `/utterance` JSON 契约  
- `dialog_200` restored_full_v1  
- Tone 在 ASR 之后、`dedup` 之前的主链顺序  
- Health 接口（本轮不改）

### MODIFY

- （本轮禁止改主链/接口 — 无）

### RESTORE

- **FW Worker 干净进程状态** — 重启清空 stuck queue

### DELETE

- （无 — 不得 RESTORE 已删 Tone V2 shadow/offline 内容）

---

## 10. 修复步骤（运维，非代码）

```powershell
# 1. 停止占用 6007 的进程
Stop-Process -Id (Get-NetTCPConnection -LocalPort 6007).OwningProcess -Force

# 2. 启动 FW Worker（必须用 venv）
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe faster_whisper_vad_service.py

# 3. 确认 health：queue_depth=0
Invoke-RestMethod http://127.0.0.1:6007/health

# 4. 串行跑 audit（避免 Node 并发 flood）
cd tone_module
..\ .venv\Scripts\python.exe audit_runtime_acceptance.py --part all
```

**Batch 前检查：** `queue_depth=0`，`pending_results=0`，无并行 Node ASR 压测。

---

## 11. Acceptance Criteria 对照

| 条件 | 状态 |
|------|------|
| /health 与 /utterance 关系解释清楚 | ✓ |
| 503 根因定位到具体组件 | ✓ ASR queue full / stuck worker |
| ≥5 条 wav 成功或说明原因 | ✓ Post-restart 5/5 成功；Pre-restart 5/5 503（stuck queue） |
| 环境/启动修复步骤 | ✓ 见 §10 |
| 非 Tone V2 架构问题 | ✓ |
| 能否重跑 audit + dialog_200 batch | ✓ CONDITIONAL（重启后） |
| 能否继续 Tone V2 Phase 1 | ✓ |

---

## 12. Final Verdict

### **CONDITIONAL PASS**

**理由：**

1. 根因已定位：**ASR 单槽队列饱和/卡住**，非 Tone V2、非主链、非语料。  
2. Health Contract Gap 已记录：`/health=200` **不等于** `/utterance ready`。  
3. 重启后 5 条 case 证明 FW Worker **可正常处理 utterance**（ASR + Tone）。  
4. 重跑 full audit 的**前置条件**：重启 FW、确保 `queue_depth=0`、audit 串行、避免 Node 并发 ASR。

**下一步建议：**

1. 在干净 FW 状态下重跑 `audit_runtime_acceptance --part all`  
2. 再跑 dialog_200 200-case batch  
3. （后续轮次，非本轮）可考虑 health 暴露 `queue_full` / `utterance_ready` — 本轮仅审计记录

---

## 附录：只读诊断命令

```powershell
# 环境探测（Run ID 作用域）
$env:FW_AUDIT_RUN_ID = "fw_ready_audit_20260629_085823"
.\.venv\Scripts\python.exe tone_module\_audit_env_probe.py
```

**关联 JSON：** [fw_worker_utterance_503_readiness_audit_2026_06_29.json](./fw_worker_utterance_503_readiness_audit_2026_06_29.json)
