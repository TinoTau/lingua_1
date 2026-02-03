# 各服务 GPU 使用确认指南

用于在集成测试或日常运行后，通过**节点端日志**与**各服务端输出**确认：ASR、NMT、语义修复、TTS 等是否真正使用了 GPU 进行处理。

---

## 1. 各服务是否使用 GPU（设计）

| 服务 | 是否使用 GPU | 说明 |
|------|--------------|------|
| **ASR (faster_whisper_vad)** | ✅ 是 | 强制 GPU（ASR_DEVICE=cuda），不允许 CPU 回退 |
| **NMT (nmt_m2m100)** | ✅ 是 | 强制 GPU，不允许 CPU 回退 |
| **语义修复 (semantic_repair_en_zh)** | ✅ 是 | LlamaCpp/LLM 使用 n_gpu_layers=-1，Torch 推理走 CUDA |
| **TTS (Piper)** | ✅ 是（可配置） | 需设置 PIPER_USE_GPU=true，否则服务会拒绝启动（若配置为强制 GPU） |
| **同音纠错 (phonetic_correction_zh)** | ❌ 否 | 纯 CPU（KenLM + 混淆集），无 GPU 依赖 |

节点端对 **ASR、NMT、TTS** 会通过 **GPU 仲裁器** 获取 GPU 租约后再调用对应服务；语义修复由独立 Python 服务内部使用 GPU，节点只发 HTTP 请求。

---

## 2. 节点端日志中如何确认「使用了 GPU」

**日志文件**：`electron_node/electron-node/logs/electron-main.log`（启动时控制台会打印 `[Logger] Log file: ...`，以该路径为准）。

### 2.1 启动时：GPU 仲裁器与 GPU 信息

- 搜索：`GpuArbiter initialized`  
  - 若存在且 `enabled: true`、`gpuKeys` 有值，说明节点端 GPU 仲裁已启用，ASR/NMT/TTS 会通过租约使用 GPU。
- 搜索：`Hardware info retrieved` 或 `[1/6] Hardware info`  
  - 会带 `gpus: N`，表示检测到的 GPU 数量。

### 2.2 每次使用 GPU 时：租约获取日志

- 搜索：**`GPU lease acquired (task will run on GPU)`**  
  - 每条表示**一次**任务已获取 GPU 租约，即将在 GPU 上执行。
  - 日志字段：`taskType`（ASR / NMT / TTS 等）、`gpuKey`、`leaseId`、`queueWaitMs`，以及传入的 `trace`（如 `jobId`、`sessionId`、`utteranceIndex`）。
- 按 `job_id` 或 `session_id` 过滤时，可确认该 job 的 ASR 步、NMT 步、TTS 步是否都出现过 `GPU lease acquired`。

**示例（在 electron-main.log 中按 job 查 GPU 使用）：**

```bash
# 看所有 GPU 租约获取记录
grep "GPU lease acquired" logs/electron-main.log

# 看某 job 是否用了 GPU（把 JOB_ID 换成实际 job_id）
grep -E "JOB_ID|GPU lease acquired" logs/electron-main.log
```

若某 job 的 ASR/NMT/TTS 步骤**没有**对应的 `GPU lease acquired`，可能原因：  
- 该步骤未执行（如跳过、失败）；  
- 或 GPU 仲裁器未启用（`GpuArbiter initialized` 里 `enabled: false`），此时不会打租约日志，但服务端仍可能用 GPU。

---

## 3. 各服务端如何确认「本服务用了 GPU」

以下为各服务**启动时或运行中**在**控制台/服务日志**中的典型输出，用于确认该进程确实在使用 GPU。

### 3.1 ASR (faster_whisper_vad)

- 搜索：`ASR_DEVICE`、`device`、`cuda`、`CUDA`  
  - 正常应为：`Using device from environment variable: cuda` 或 `GPU is required: forcing ASR_DEVICE=cuda`。
- 若看到 `CUDA is not available` 或 `ASR_DEVICE=cpu`，说明未使用 GPU（且当前配置下 ASR 会拒绝 CPU，服务可能启动失败）。

### 3.2 NMT (nmt_m2m100)

- 搜索：`[NMT Service]`、`CUDA`、`device`  
  - 典型：`[NMT Service] [OK] CUDA available: True`、`[NMT Service] [OK] GPU name: ...`、`[STEP] Moving model to device: cuda`、`[MEMORY] GPU memory allocated: ...`  
  - 若为 `device: cpu` 或 `CUDA is not available`，则未使用 GPU。

### 3.3 语义修复 (semantic_repair_en_zh)

- 搜索：`[Unified SR]`、`CUDA`、`GPU`  
  - 典型：`[Unified SR] CUDA available: True`、`[Unified SR] CUDA device: ...`  
  - 推理前后可能还有 `[Repair Engine] ... GPU: ... GB` 等内存日志。  
  - 若为 `CUDA available: False`，则未使用 GPU。

### 3.4 TTS (Piper)

- 搜索：`PIPER_USE_GPU`、`GPU`、`CUDA`、`Execution Provider`  
  - 典型：`GPU Acceleration: Enabled (required)`、`✓ GPU acceleration will be used`。  
  - 若配置为强制 GPU 但未设置 `PIPER_USE_GPU=true`，服务会直接报错退出。

### 3.5 同音纠错 (phonetic_correction_zh)

- **设计上不使用 GPU**，无需在日志中查找 GPU/CUDA；只要服务正常返回 `/correct` 结果即可。

---

## 4. 快速检查清单（按顺序做即可）

1. **节点端**  
   - 打开 `electron_node/electron-node/logs/electron-main.log`。  
   - 搜 `GpuArbiter initialized` → 确认 `enabled: true`、`gpuKeys` 非空。  
   - 搜 `GPU lease acquired (task will run on GPU)` → 确认 ASR/NMT/TTS 请求前都有对应 taskType 的租约记录；可按 `job_id` 与 ASR/NMT/TTS 步骤对应起来看。

2. **ASR 服务**  
   - 看 ASR 进程控制台或服务日志 → 搜 `cuda` / `ASR_DEVICE`，确认为 `cuda` 且无 “CUDA not available”。

3. **NMT 服务**  
   - 看 NMT 进程控制台或服务日志 → 搜 `[NMT Service]`、`CUDA`、`device`，确认 `device: cuda` 和 GPU 内存日志。

4. **语义修复服务**  
   - 看语义修复进程控制台或服务日志 → 搜 `[Unified SR] CUDA`，确认 `CUDA available: True` 和 `CUDA device: ...`。

5. **TTS 服务**  
   - 若要求 TTS 用 GPU，看 TTS 进程控制台 → 搜 `PIPER_USE_GPU`、`GPU`，确认 “GPU Acceleration: Enabled” 或 “GPU acceleration will be used”。

6. **同音纠错**  
   - 无需查 GPU，只需确认服务正常、`/correct` 返回合理即可。

按上述步骤即可在**不读代码**的情况下，仅通过日志确认「每个服务都使用了 GPU 进行处理」（同音纠错除外，为 CPU 服务）。
