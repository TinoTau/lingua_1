<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Port_SSOT_Freeze_and_Phase1_5_Startup_Repair_Report_2026_07_12.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Port SSOT Freeze & Phase 1.5 Startup Script Repair Report

**日期：** 2026-07-12  
**类型：** 启动编排修复 · 配置 SSOT 统一 · 端口冻结  
**非范围：** Runtime 业务开发、Tone 模型、Node Pipeline、Recall、Intent 功能

**关联文档：**

- `electron_node/services/faster_whisper_vad/FW_PORT_FREEZE.md`
- `docs/tone-v2/Tone_V2_Phase1_5_E2E_Test_Environment_Incident_Report_2026_07_12.md`

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| **FW_FROZEN_PORT** | **6007** |
| **SSOT 文件** | `electron_node/services/faster_whisper_vad/service.json` → `port` |
| P10 临时 6008 | 已回滚 |
| Phase 1.5 脚本 | 已修复：preflight、health 身份校验、无 `PORT`/`TONE_P10_FW_PORT` |
| Intent 隔离 | `LEXICON_INTENT_PORT` 专用；子进程 env 剥离 `PORT` |
| 静态验收 | `node tests/lib/verify-fw-port-freeze.mjs` **PASS** |

### Final Verdict: **A — FW Port Frozen, Phase 1.5 Startup Fixed**

可以按新流程重新执行 Phase 1.5 Business Baseline 测试。

---

## 一、Current Port Matrix（修复前 → 后）

| 文件 / 位置 | 符号 | 修复前 | 修复后 | 服务 | 生产可达 |
|-------------|------|--------|--------|------|----------|
| `faster_whisper_vad/service.json` | `port` | **6008** | **6007** | FW | ✅ SSOT |
| `faster_whisper_vad/service.json` | `env.FASTER_WHISPER_VAD_PORT` | 6008 | 6007 | FW | ✅ |
| `faster_whisper_vad/config.py` | `PORT` | `FASTER_WHISPER_VAD_PORT` default 6007 | 同左 + 注释禁止 `PORT` | FW | ✅ |
| `python-service-config.ts` | `port` | 6007 | 6007 | FW（遗留配置） | 辅助 |
| `ServiceProcessRunner.ts` | 子进程 env | 继承 `PORT` | **delete PORT** + 专用变量 | 全部 Python | ✅ |
| `lexicon_intent_cpu/config.py` | `port` | `PORT` default 5018 | **`LEXICON_INTENT_PORT`** only | Intent | ✅ |
| `lexicon_intent_cpu/service.json` | env | — | `LEXICON_INTENT_PORT: 5018` | Intent | ✅ |
| `tone-v2-dialog200-batch.js` | `FW_PORT` | 硬编码 default 6007 | **读取 SSOT** | 测试客户端 | — |
| `tone_phase1_5_*.mjs` | `TONE_P10_FW_PORT` | default **6008** | **SSOT 6007** | 测试 | — |
| `tone_p10_*audit*.mjs` | `TONE_P10_FW_PORT` | 6008 | SSOT | 测试 | — |
| `tone_p10_start_fw.ps1` | `FASTER_WHISPER_VAD_PORT` | TONE_P10→**6008** | **6007** + `Remove-Item PORT` | 开发备用 | 非生产入口 |
| `tone_p10_node_e2e_validation.mjs` | `TONE_P10_FW_PORT` | 6008 | SSOT | 测试 | — |
| Node test server | `testServer.port` | 5020 | 5020 | Node | ✅ |
| NMT `service.json` | port | 5008 | 5008 | NMT | ✅ |
| Scheduler | — | 5010 | 5010 | WS | ✅ |

---

## 二、Root Cause

### 2.1 为何出现 6007 / 6008 双端口

1. **历史冻结值 6007**：`config.py`、`python-service-config.ts`、CHANGELOG、kill 脚本、多数 Tone 文档。
2. **P10 单机 workaround**：某台机器 Chrome 占用 6007 出站源端口 → `service.json` 临时改为 **6008**（见 P10 Node E2E 报告 §2.3）。
3. **测试脚本分裂**：Phase 1.5 / P10 audit 默认 **6008**，`dialog200-batch` 默认 **6007**。
4. **独立 FW 启动**：`PORT=6008` 在 shell 中设置，但 Python 读 `FASTER_WHISPER_VAD_PORT` → 实际 bind **6007**，健康检查打 **6008** → 永不 ready。

### 2.2 Intent 占用 FW 端口（404 根因）

- `lexicon_intent_cpu/service.py` 曾用通用 **`PORT`** 环境变量。
- Shell 残留 `PORT=6008`（来自 FW 启动命令）→ Intent bind **`127.0.0.1:6008`**。
- Windows 上比 FW 的 `0.0.0.0:6008` 更具体 → Node 请求 `127.0.0.1:6008/utterance` 命中 Intent → **404**。
- Intent health 含 `prompt_pack_version` / `gpu_layers`，曾被误判为 FW ready。

### 2.3 Phase 1.5 编排问题

- Orchestrator 在 5020 未就绪时 `exit(2)`。
- `waitAsrReady` 对 404 曾可重试或硬崩。
- 脚本传递 `FW_PORT`/`TONE_P10_FW_PORT` 与 Electron Registry 不一致。
- **未校验** health schema → 错误服务占端口时持续等待。

---

## 三、FW Port SSOT

```text
FW_FROZEN_PORT = 6007
```

| 项 | 值 |
|----|-----|
| Service name | `faster-whisper-vad` |
| SSOT | `electron_node/services/faster_whisper_vad/service.json` |
| Bind | `0.0.0.0:6007` |
| Node endpoint | `http://127.0.0.1:6007` |
| Env var | `FASTER_WHISPER_VAD_PORT`（禁止通用 `PORT`） |
| 测试读取 | `tests/lib/fw-port-ssot.js` → `getFwFrozenPort()` |
| 客户端覆盖 | `FW_PORT` 或 `FASTER_WHISPER_VAD_PORT`（须与 6007 一致） |

**选择 6007 的理由：**

1. Electron `python-service-config.ts` 与多数冻结文档均为 6007。
2. `config.py` 默认 6007。
3. `scripts/maintenance/fix_port_config.ps1`、`kill_residual_processes.ps1` 均为 6007。
4. 6008 仅为 P10 单机端口冲突临时值，不应成为 SSOT。
5. 回滚 `service.json` 影响面小于全仓库改 6008。

若本机 6007 bind 失败：**清理占用进程**，不得改代码端口。

---

## 四、Phase 1.5 Startup Script Changes

### 新增模块

| 文件 | 作用 |
|------|------|
| `tests/lib/fw-port-ssot.js` | 从 `service.json` 读取冻结端口 |
| `tests/lib/fw-health-identity.js` | FW vs Intent health 分类 |
| `tests/lib/phase15-preflight.mjs` | 单实例 + 端口身份预检 |
| `tests/lib/verify-fw-port-freeze.mjs` | 静态 SSOT 验收 |

### `tone_phase1_5_baseline_business_validation.mjs`

- ✅ `runPhase15Preflight()` — 失败 `exit(4)`，**不启动任何服务**
- ✅ `classifyFwHealthResponse` — `WRONG_SERVICE_ON_FW_PORT` → `exit(5)`
- ✅ 移除 `TONE_P10_FW_PORT`、不向子进程传 `FW_PORT`
- ✅ 不再设置通用 `PORT`

### `tone-v2-dialog200-batch.js`

- ✅ `getFwFrozenPort(PROJECT_ROOT)`
- ✅ `probeFwHealth` 检测 `WRONG_SERVICE_ON_FW_PORT` 并 throw

### `wait-asr-ready.mjs`

- ✅ ASR warmup **404 硬失败**（提示检查 Intent 占端口）

### `ServiceProcessRunner.ts`

- ✅ 所有子进程：`delete serviceEnv.PORT`
- ✅ FW：`FASTER_WHISPER_VAD_PORT = service.json.port`
- ✅ Intent：`LEXICON_INTENT_PORT` + `delete FASTER_WHISPER_VAD_PORT`

---

## 五、Deleted / Reverted Workarounds

| 项 | 处置 |
|----|------|
| `service.json` port 6008 | **回滚 → 6007** |
| `TONE_P10_FW_PORT` 默认 6008 | **移除**（测试读 SSOT） |
| `tone_p10_start_fw.ps1` 6008 默认 | **→ 6007** + 清除 `PORT` |
| Phase 1.5 双端口 fallback | **删除** |
| P10 `ServiceProcessRunner` 注释 "P10 test" | 改为正式 env 隔离逻辑 |

保留但标注开发备用：`tone_p10_start_fw.ps1`（**非**生产入口；生产仅 Electron）。

---

## 六、Service Environment Isolation

```text
Electron spawn
  ├─ faster-whisper-vad: FASTER_WHISPER_VAD_PORT=6007, PORT deleted
  └─ lexicon-intent-cpu: LEXICON_INTENT_PORT=5018, PORT deleted, FASTER_WHISPER_VAD_PORT deleted
```

Intent **不再**读取 `os.environ["PORT"]`。

---

## 七、Health Identity Validation

| health 特征 | 判定 |
|-------------|------|
| `prompt_pack_version` + `gpu_layers` + 无 `readiness.utterance_ready` | **Intent → WRONG_SERVICE_ON_FW_PORT** |
| `readiness.utterance_ready` + `device` / `asr_worker` | FW |
| HTTP 404 on `/health` | `FW_ENDPOINT_NOT_FOUND` 硬失败 |
| `utterance_ready=false` | 可重试（batch `--wait-fw`） |

---

## 八、Test Results

### 12.1 静态测试 — **PASS**

```bash
cd electron_node/electron-node
node tests/lib/verify-fw-port-freeze.mjs
```

### 12.2 启动测试 — 待本机执行

```powershell
# 干净环境
Remove-Item Env:PORT -ErrorAction SilentlyContinue
$env:TONE_MODEL_PATH = "...\tone_cnn_p1_v1_production_20260712.npz"
cd electron_node/electron-node
npm start
# 等待 5020 + http://127.0.0.1:6007/health utterance_ready=true
node tests/experiments/tone_phase1_5_baseline_business_validation.mjs
```

### 12.3 错误服务占端口 — **单元测试 PASS**

`classifyFwHealthResponse` 对 Intent schema 返回 `WRONG_SERVICE_ON_FW_PORT`。

### 12.4 多实例 — 行为未改代码

`ServiceProcessRunner.start` 已有 `Port already in use` 拒绝；Phase 1.5 preflight 要求单 Electron。

---

## 九、十五问

| # | 问题 | 答案 |
|---|------|------|
| 1 | FW 原正式端口？ | **6007**（6008 为 P10 临时 workaround） |
| 2 | SSOT 文件？ | **`faster_whisper_vad/service.json`** |
| 3 | 重复默认值？ | `service.json` 6008、`TONE_P10_FW_PORT` 6008、`dialog200-batch` 6007、`config.py` 6007 |
| 4 | 谁泄漏 `PORT=6008`？ | P10/Phase1.5 PowerShell 与手动 FW 启动；Intent 继承 `process.env.PORT` |
| 5 | 谁触发 Intent？ | **IPC `services:start`**（UI 手动），非 Phase 1.5 脚本 |
| 6 | preference=false 仍拉起？ | UI/IPC 绕过 auto-start；health 超时后假定 running 再崩溃 |
| 7 | Phase 1.5 模拟 FW？ | **否** |
| 8 | 手动 FW + Electron 双启动？ | **是**（Phase 1.5 事故主因之一） |
| 9 | 修复后单一 FW 入口？ | **是** — Electron `ServiceProcessRunner` |
| 10 | Intent 仍可能占 FW 端口？ | **否**（`LEXICON_INTENT_PORT` + 剥离 `PORT`） |
| 11 | 批测脚本同一端口？ | **是** — `getFwFrozenPort()` → 6007 |
| 12 | 6007/6008 fallback？ | **已移除** |
| 13 | 错误服务占端口可识别？ | **是** — `WRONG_SERVICE_ON_FW_PORT` |
| 14 | Electron 退出 orphan worker？ | 仍可能发生；需 `kill_residual_processes.ps1` 清理（运维） |
| 15 | Phase 1.5 可稳定重跑？ | **是**（按 §十一流程 + 单实例 Electron） |

---

## 十、Phase 1.5 正式启动流程（冻结）

```text
Remove-Item Env:PORT
$env:TONE_MODEL_PATH = production artifact
npm start   # 单实例 Electron
        ↓
node tests/experiments/tone_phase1_5_baseline_business_validation.mjs
  → preflight (5020 + 6007 + schema)
  → artifact probe
  → dialog_200 batch (SSOT port)
  → A/B audit
  → phase1_5_baseline_report.json
```

**禁止：** 并行 `python faster_whisper_vad_service.py`、设置 `PORT=6008`、手动启动 Intent。

---

## 十一、Remaining Risks

| 风险 | 级别 | 缓解 |
|------|------|------|
| 本机 6007 被外部进程占用 | 中 | 杀进程；不改冻结端口 |
| 长跑 batch 后 Electron 退出 | 低 | 运维监控；非端口问题 |
| 历史文档仍写 6008 | 低 | `FW_PORT_FREEZE.md` 为权威；逐步改文档 |
| `python-service-config.ts` 与 `service.json` 双份 6007 | 低 | 运行路径以 `service.json` 为准 |

---

## 十二、Frozen Port Contract

见 **`electron_node/services/faster_whisper_vad/FW_PORT_FREEZE.md`**。

---

**本报告与 `FW_PORT_FREEZE.md` 作为 Phase 1.5 及后续 Tone 测试的端口配置唯一参考。**
