# 故障排查

## 调度器连接

UI「未连接」= 与调度器 WebSocket 未建立或已断开。

### 行为（已实现）

- 指数退避重连：5s → 10s → … 上限 60s；连上后重置为 5s
- 连接失败**不**退出进程
- UI 重连：`reconnect-node` IPC → `NodeAgent.start()`（`index-ipc.ts`）

### 配置

- 地址仅来自 `electron-node-config.json` 的 `scheduler.url`（或 `SCHEDULER_URL`）
- 默认：`ws://127.0.0.1:5010/ws/node`（避免 IPv6 `::1` 问题）
- 修改配置或主进程代码后需 `npm run build:main` 再 `npm start`

### 主进程日志（`logs/electron-main.log`）

| 日志 | 含义 |
|------|------|
| `NodeAgent.start() 被调用` | 自动连接已触发 |
| `NodeAgent 未创建，无法连接调度器` | 未初始化 NodeAgent |
| `Connecting to scheduler...` | 正在连接 |
| `Connected to scheduler server` | 已连接 |
| `WebSocket error` / `Connection closed` | 失败或断开（ECONNREFUSED = 调度器未监听） |
| `reconnect-node IPC 被调用` | 用户点击重连 |

### 端口占用（调度器重启失败 10048）

1. 从 `scheduler.url` 确认端口（常见 5010）
2. `netstat -ano | findstr <端口>` → `taskkill /PID <pid> /F`
3. 再启调度器，节点自动或手动重连

### 节点池（调度器侧）

- 注册：语言写入 Redis，池在**首次有效心跳**分配
- 节点端用服务语言**交集**上报；调度器用 `asr_langs × semantic_langs` 建池
- 调度器日志：`Redis 心跳成功（TTL 已刷新，节点池已分配）` 表示成功
- Redis：`HGETALL lingua:v1:node:<node_id>:pools`

| 现象 | 可能原因 |
|------|----------|
| 一直未连接 | 调度器未启、URL/端口错误、双实例占端口 |
| 点击重连无效 | 旧版无 handler；或 NodeAgent 为 null |
| 曾连后断开 | 调度器重启；等待退避重连 |

---

## Pipeline 无结果

每个 `(session_id, utterance_index)` **只接受第一个 job**；重复会 `Rejecting duplicate`。

按 `job_id` 搜日志顺序：

1. `Received job_assign`
2. `Rejecting duplicate`
3. `Pipeline mode inferred`
4. `runAsrStep: Audio buffered`（仅缓冲）
5. `Step X failed` / `Pipeline orchestration failed`
6. `SEND_PLAN` / `SEND_ATTEMPT`

Turn 累积：`runAggregationStep: Turn segment accumulated, waiting for finalize` = 非 finalize，defer 翻译。

FW 默认不走 5015 语义修复。见 [pipeline/README.md](../main/src/pipeline/README.md)。

---

## GPU 使用验证

### 节点端（`logs/electron-main.log`）

1. `GpuArbiter initialized` → `enabled: true`，`gpuKeys` 非空
2. `GPU lease acquired (task will run on GPU)` → 按 `taskType`（ASR/NMT/TTS）与 `jobId` 对照

```powershell
Select-String "GPU lease acquired" logs/electron-main.log
```

### 各服务控制台

| 服务 | 期望日志关键词 |
|------|----------------|
| faster_whisper_vad | `cuda`、`ASR_DEVICE=cuda`；无 `CUDA is not available` |
| nmt_m2m100 | `[NMT Service]`、`device: cuda` |
| semantic_repair_en_zh | `[Unified SR] CUDA available: True` |
| piper_tts | `GPU Acceleration: Enabled` |
| phonetic_correction_zh | 无需 GPU |

---

## 高 CPU

- **启动**：大模型首次加载、CUDA kernel 编译 → 短暂正常
- **持续**：查多 workers、重复进程；语义修复应 `workers=1`

---

## 白屏 / 渲染进程

- 开发模式确认 Vite 在跑（`npm run dev`）
- 查 `electron-main.log` 的 preload / IPC 错误

---

## Vite / ESBuild 崩溃

错误：`[plugin:vite:esbuild] The service is no longer running`

1. Ctrl+C 后 `npm run dev`
2. 清缓存：`Remove-Item -Recurse -Force node_modules\.vite, renderer\node_modules\.vite -ErrorAction SilentlyContinue`
3. 结束残留 node/esbuild 进程后重启
4. 仍失败：查内存、`vite.config.ts`（已设 `server.hmr.overlay: false` 等）

---

## 服务启动失败 / 端口冲突

- 以 `service.json` 端口为准，避免多实例同端口
- 查 Python/Rust 依赖、CUDA、venv

---

## 依赖缺失

启动对话框列出缺失项。安装说明见 [CONFIGURATION.md](./CONFIGURATION.md#4-系统依赖)。

| 症状 | 处理 |
|------|------|
| Python 未找到 | 重装并勾选 PATH；`python --version` |
| ffmpeg 未找到 | 通常已打包；否则手动安装或检查 `tools/ffmpeg/bin` |
| CUDA 未检测 | CPU 回退或安装 CUDA；ASR/NMT 可能拒绝 CPU |

实现：`main/src/utils/dependency-checker.ts`、`cuda-env.ts`、`python-service-config.ts`。

---

## 日志位置

| 组件 | 位置 |
|------|------|
| 主进程 | `logs/electron-main.log`（启动时 `[Logger] Log file`） |
| faster_whisper_vad 等 | 各服务目录 `logs/` |
| node-inference | `services/node-inference/logs/` |

---

## Rust 推理服务

1. 开发：`services/node-inference/target/release/inference-service.exe`
2. 生产：安装目录内可执行文件
3. 端口：`INFERENCE_SERVICE_PORT`（默认与历史文档可能不同，以实际配置为准）

---

## 语义修复超时

节点报 `SEM_REPAIR_TIMEOUT: SERVICE_TIMEOUT`：HTTP 30s 内未返回（`task-router-semantic-repair.ts`），**不是** GPU 仲裁超时。长句可加大超时或优化服务端生成长度。

---

## 相关模块文档

- [task-router/README.md](../main/src/task-router/README.md) — TTS 语音、ASR 参数
- [CONFIGURATION.md](./CONFIGURATION.md) — 配置项全集
