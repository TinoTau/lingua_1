<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase1_5_E2E_Test_Environment_Incident_Report_2026_07_12.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 1.5 — E2E 测试环境问题报告

**日期：** 2026-07-12  
**类型：** Production Baseline Business Validation — 环境与编排问题记录  
**范围：** Phase 1.5 E2E 启动、服务编排、端口冲突、验证脚本失败  
**非范围：** Runtime / Node / Loader / Feature 代码修改（本轮禁止）

**关联任务：**

- Artifact：`tone_module/models/production/tone_cnn_p1_v1_production_20260712.npz`
- 编排脚本：`electron_node/electron-node/tests/experiments/tone_phase1_5_baseline_business_validation.mjs`
- 批测脚本：`electron_node/electron-node/tests/tone-v2-dialog200-batch.js`
- 采集目录：`tmp/tone_phase1_5_business_baseline/`

---

## 1. Executive Summary

Phase 1.5 业务基线验证在 **2026-07-12 上午** 多次启动失败，根因集中在 **本地服务编排与端口冲突**，而非 Production Artifact 或 Runtime 协议问题。

| 维度 | 结论 |
|------|------|
| Production Artifact | ✅ 本地 probe 通过（`trainingVersion=production_baseline_20260712`） |
| 失败主因 | 服务未就绪、端口被占、FW 与 Intent 服务混绑 |
| Lexicon Intent | 非本轮必需，但误启动会拖垮/干扰环境 |
| 验证脚本 | orchestrator 在 ASR warmup 404 时硬失败并触发 Node 崩溃 |
| 恢复后状态 | 清理进程 + 单实例 Electron 启动后，dialog_200 batch 可正常运行 |

### 处置结论

> **环境问题已定位并绕过；批测在恢复环境后继续执行。**  
> 正式 Business Baseline 报告待 batch + A/B audit 完成后单独产出。

---

## 2. 时间线与失败记录

| 时间（约） | 任务 | Exit | 现象 |
|------------|------|------|------|
| 09:22 | 独立启动 FW（`PORT=6008`） | -1 | 实际监听 **6007**（`FASTER_WHISPER_VAD_PORT` 默认覆盖 `PORT`） |
| 09:24 | Electron `npm start`（第一次） | -1 | 5020 `EADDRINUSE` 或进程异常退出 |
| 09:27 | `tone_phase1_5_baseline_business_validation.mjs` | **2** | `Node test server not ready on 5020`（等待 5020 超时） |
| 09:32 | Electron `npm start`（第二次） | ✅ | Test server 5020 启动成功 |
| 09:39 | Phase 1.5 orchestrator（+90s sleep） | **3221226505** | ASR warmup `404` → `waitAsrReady` 抛错 → Node `UV_HANDLE_CLOSING` 断言崩溃 |
| 09:41–10:00 | 多次健康检查 / 诊断 | 混合 | 6008 health 返回 **非 FW schema**；6007 为真 FW |
| 10:00+ | 进程清理 | — | 杀掉 Intent `service.py@127.0.0.1:6008`、orphan FW worker、残留 Electron |
| 10:01 | 清理后健康检查 | **1** | 5020 / 6008 均为 down（预期） |
| 10:02 | Electron 第三次启动 + 单实例 FW | ✅ | 5020 / 6008 / 5008 就绪，`utterance_ready=True` |
| 10:10 | 直接跑 `tone-v2-dialog200-batch.js` | 进行中 | d001+ 正常，`tone=true`，无 `model_error` |

---

## 3. 问题清单（按严重度）

### P0 — 端口 6008 被 Lexicon Intent 劫持（导致 ASR 404）

**现象**

- Node pipeline 返回：`{"error":"Request failed with status code 404"}`
- `http://127.0.0.1:6008/health` 返回 schema：

```json
{
  "status": "ok",
  "model_loaded": true,
  "gpu_layers": 0,
  "prompt_pack_version": "v2",
  "warmup_done": false
}
```

此为 **`lexicon_intent_cpu/service.py`** 的 health 格式，**不是** `faster_whisper_vad`（后者含 `readiness.utterance_ready`、`device=cuda` 等字段）。

**根因**

- `lexicon_intent_cpu/service.py` 以 `PORT` 环境变量绑端口（默认 5018）。
- Shell 中若残留 `PORT=6008`（来自 FW 启动命令），手动或 IPC 拉起 Intent 时会绑到 **127.0.0.1:6008**。
- Windows 上 `127.0.0.1:6008` 比 `0.0.0.0:6008` 更具体，**localhost 流量被 Intent 抢走**，Electron 注册的 FW endpoint `http://127.0.0.1:6008/utterance` 得到 404。

**进程证据**

| PID | 命令 | 端口 |
|-----|------|------|
| 35656 | `python.exe service.py`（lexicon_intent_cpu） | 127.0.0.1:6008 |
| 32908 | `python.exe faster_whisper_vad_service.py` | 0.0.0.0:6008 |

**修复**

- `Stop-Process` 杀掉 PID 35656 后，`127.0.0.1:6008/utterance` 恢复为 FW，`pipeline 200` 验证通过。

---

### P0 — Electron Test Server 未就绪即跑验证

**现象**

```text
Node test server not ready on 5020
exit_code: 2
```

**根因**

- `tone_phase1_5_baseline_business_validation.mjs` 在 `waitTestServerHealth(5020)` 失败时直接 `process.exit(2)`。
- Electron 冷启动需 1–3 分钟完成服务注册；FW 模型加载更久。
- 并行启动了多个 Electron / 验证实例，加剧端口竞争。

**修复**

- 确保 **单一** `npm start` 实例，待 `✅ Test server 已启动: http://127.0.0.1:5020` 后再跑批测。
- 或拉长 `waitTestServerHealth` 超时（当前 300s，多实例冲突时仍可能不够）。

---

### P1 — FW 端口约定不一致（6007 vs 6008）

**现象**

| 组件 | 默认 / 实际端口 |
|------|----------------|
| `python-service-config.ts` | Electron 管理 FW → **6007** |
| `tone-v2-dialog200-batch.js` | `FW_PORT` 默认 **6007** |
| `tone_phase1_5_baseline_business_validation.mjs` | `TONE_P10_FW_PORT` 默认 **6008** |
| 用户文档 / P10 脚本 | 常写 **6008** |
| 独立 `faster_whisper_vad_service.py` + `PORT=6008` | 日志仍显示 **6007**（`FASTER_WHISPER_VAD_PORT` 优先） |

**影响**

- 健康检查打错端口 → 误判 FW 未就绪。
- 独立 FW 与 Electron 子进程 FW 并存，GPU 显存双份占用。

**建议（运维，非代码）**

- Phase 1.5 统一：**仅通过 Electron 拉起 FW，使用 6008**（与当前 Electron 注册一致）。
- 批测与 A/B audit 均设：`FW_PORT=6008`、`TONE_P10_FW_PORT=6008`。
- **不要**再手动 `python faster_whisper_vad_service.py` 与 Electron 并存。

---

### P1 — Lexicon V2 CPU Intent Service 频繁「自动关闭」

**现象**

- UI 或 IPC 启动后，5018 长期 `fetch failed`，约 3 分钟后 health 超时假定 running，随后进程 `exit code 4294967295`（-1）。

**根因（组合）**

1. **配置关闭但仍被手动拉起**：`servicePreferences.lexicon-intent-cpu: false`，`lexiconV2.enabled: false`，但日志有 `IPC: services:start`。
2. **2GB GGUF 冷加载失败**：`qwen2.5-3b-instruct-q4_k_m.gguf` 在 `Loading CPU model...` 阶段被杀死，从未 bind 5018。
3. **资源争抢**：与 FW（CUDA）+ NMT 同时启动时 RAM/CPU 压力大。
4. **Recovery 不重启**：`recoveryRestartService: false`，崩溃后不会自动恢复。

**与 Phase 1.5 关系**

- **非阻塞**：`lexiconV2.enabled=false`，batch 设 `lexicon_v2_intent_enabled: false`。
- **建议测试期间不要启动 Intent**，避免占端口、抢内存。

---

### P2 — `waitAsrReady` warmup 404 导致 orchestrator 崩溃

**现象**

```text
Error: Request failed with status code 404
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
exit_code: 3221226505
```

**根因**

- `wait-asr-ready.mjs` 仅将 503/504/`No available ASR` 视为可重试；**404 直接 throw**。
- 404 由 P0 端口劫持引起；修复端口后 warmup 可通过。
- 崩溃为 Node 在异常路径上的 Windows libuv 断言（非业务逻辑错误）。

**绕过**

- 直接运行 `tone-v2-dialog200-batch.js`（内置 `--wait-fw`，不依赖 orchestrator warmup）。
- 或将 404 纳入 retryable（诊断脚本改动，非 Runtime）。

---

### P2 — 错误 WAV 路径导致 pipeline 500

**现象**

```json
{"error":"ENOENT: no such file or directory, open '...\\d001_cafe_order.wav'"}
```

**根因**

- 手动 probe 使用了不存在的文件名；manifest 正确文件为 `dialog_d001.wav`。

**修复**

- 一律从 `test wav/dialog_200/cases.manifest.json` 取 `file` 字段。

---

### P3 — 多实例遗留 Orphan 进程

**现象**

- FW 父进程退出后，多个 `multiprocessing.spawn` worker 残留。
- 多次 Electron / FW 启动叠加，端口与 GPU 状态不可预测。

**清理命令（本次使用）**

```powershell
# 杀掉 FW worker、lexicon intent、独立 FW 主进程
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'multiprocessing.spawn|faster_whisper_vad_service|lexicon_intent_cpu|service\.py' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 4. 诊断决策树（简版）

```text
Pipeline 500/404?
  ├─ ENOENT wav → 检查 manifest 文件名（dialog_dXXX.wav）
  ├─ 404 on ASR → curl 127.0.0.1:6008/health
  │     ├─ 有 prompt_pack_version、无 utterance_ready → Intent 占端口，杀 service.py@6008
  │     └─ 有 utterance_ready → 查 Electron FW 注册与 orphan worker
  └─ No available ASR → Electron 未将 faster-whisper-vad 标为 running，重启 npm start

5020 not ready?
  └─ 等待 Electron 启动完成；确认无 EADDRINUSE；单实例

Intent 自动关？
  └─ 本轮不需要；保持 servicePreferences=false；勿手动启动
```

---

## 5. 推荐启动规程（Phase 1.5 复现用）

```powershell
# 0. 清理（若曾失败过）
#    …见 §3 P3…

# 1. 仅设置 TONE_MODEL_PATH；不要 export PORT=6008
$env:TONE_MODEL_PATH = "d:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\production\tone_cnn_p1_v1_production_20260712.npz"
Remove-Item Env:PORT -ErrorAction SilentlyContinue

# 2. 单实例 Electron
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
# 等待：Test server 5020 + FW utterance_ready@6008 + NMT 5008

# 3. 探活
Invoke-RestMethod http://127.0.0.1:6008/health | Select-Object device, readiness
# 必须看到 device=cuda 与 readiness.utterance_ready=True

# 4. 批测（绕过 orchestrator warmup）
$env:FW_PORT = "6008"
$env:PROJECT_ROOT = "d:\Programs\github\lingua_1"
node tests/tone-v2-dialog200-batch.js `
  --session phase1_5_baseline_d200 `
  --out d:\Programs\github\lingua_1\tmp\tone_phase1_5_business_baseline\dialog200_batch.json `
  --max-minutes 22 --wait-fw

# 5. A/B audit
$env:TONE_P10_FW_PORT = "6008"
node tests/experiments/tone_p10_business_effect_acceptance_audit.mjs
```

---

## 6. 恢复后验证快照

清理并第三次启动 Electron 后：

| 检查项 | 结果 |
|--------|------|
| `5020/health` | 200 |
| `6008/health` → `utterance_ready` | **True** |
| `6008/health` → `device` | **cuda**（确认为 FW，非 Intent） |
| `5008` NMT | LISTENING |
| Pipeline probe `dialog_d001.wav` | **200**，`asr=faster-whisper-vad`，`tone_slices=12` |
| Batch 前 15 条 | `tone=true`，`model_err=false` |

Artifact probe（独立 Python）：

```json
{
  "trainingVersion": "production_baseline_20260712",
  "featureVersion": "p1-frame-mel-f0-v1",
  "backend": "numpy_p1",
  "ready": true
}
```

---

## 7. 对 Phase 1.5 验收的影响评估

| 验收项 | 是否被环境问题阻塞 | 说明 |
|--------|-------------------|------|
| Production Artifact 部署 | 否 | `TONE_MODEL_PATH` 加载正确 |
| Runtime 真正加载 Production | 否 | 端口修复后 FW 带 tone |
| Node 无需修改 | 是 | 协议未改；问题在环境 |
| Business 统计 / Case Study | **部分延迟** | 需等 batch + audit 跑完 |
| 作为 Phase 2 比较基准 | **待定** | 取决于完整 batch 结果 |

---

## 8. 后续改进建议（记录，本轮不实施）

| 优先级 | 建议 | 类型 |
|--------|------|------|
| P1 | 统一 FW 端口文档与脚本默认值为 **6008**（或全部改 6007，二选一） | 文档 / 脚本 |
| P1 | `wait-asr-ready.mjs` 将 **404** 纳入可重试 | 测试工具 |
| P2 | Intent `service.py` 启动时强制 `PORT=5018`，忽略继承的 `PORT` | 服务加固 |
| P2 | Electron 启动前检测 `127.0.0.1:6008` 是否被非 FW 占用 | 运维 |
| P3 | Phase 1.5 orchestrator 在 warmup 失败时 **warn 继续**（与 batch `--wait-fw` 对齐） | 测试工具 |

---

## 9. Verdict

**环境问题报告 — Resolved with Workaround**

- 根因已定位：**端口劫持 + 多实例编排 + 验证脚本过早/过硬失败**。
- Production Baseline Artifact 与 Runtime 加载 **无结构性问题**。
- 恢复单实例环境后，dialog_200 batch **已恢复执行**。
- 正式 `Tone_V2_Phase1_5_Production_Baseline_Business_Validation_Report_2026_07_12.md` 应在 batch 与 A/B 完成后基于 `tmp/tone_phase1_5_business_baseline/` 数据生成。

---

*本报告记录 Phase 1.5 E2E 测试环境问题，不作为 Phase 2 Runtime Audio Alignment Training 业务比较基准；业务基准以 Business Validation Report 为准。*
