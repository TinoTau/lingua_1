# Lingua_1 环境完整性审计报告（只读）

**审计日期**：2026-05-16  
**机器**：Windows（PowerShell）  
**仓库根路径**：`D:\Programs\github\lingua_1`  

**约束**：未修改代码；未执行 `npm install` / `pip install`；未删除文件；未启动 Electron GUI 或常驻 Python 服务；未杀进程。

---

## 1. 总体结论

| 项 | 结论 |
|----|------|
| **环境完整性** | **不完整** |
| **能否启动 Electron 节点端** | **当前不能可靠启动**：`electron_node/electron-node` 下 **`node_modules` 不存在**；`npx tsc --noEmit -p tsconfig.main.json` **失败**（缺少 `@types/node`、`@types/ws` 等，通常由依赖安装提供） |
| **能否启动 ASR CTC（asr-sherpa-lm）** | **当前不能**：本机 **Python 解释器不可用**（`py -3` 指向的 `D:\Python\Python313\python.exe` 无法创建进程）；且 **`models/omnilingual_ctc_300m_int8` 目录不存在**（ONNX 权重缺失） |
| **能否跑 JobPipeline WAV smoke** | **不能**：集成测试文件 `tests/integration/jobpipeline-wav-batch.integration.test.ts` **不在仓库中**（与代码审计一致）；且 Node/Python/模型链均未就绪 |
| **能否跑 E2E 翻译** | **不能**（同上 + NMT/TTS 依赖与 Python 环境未验证） |
| **最大 Blocker（P0）** | 1）**Node 依赖未安装**（无 `node_modules`）2）**Python 运行时损坏/缺失** 3）**ASR 本地模型目录缺失** 4）**Git / FFmpeg 不在 PATH**（影响克隆、媒体处理与部分脚本） |

---

## 2. 基础工具版本与路径

| tool | version | path | status |
|------|---------|------|--------|
| node | v22.22.0 | `d:\Program Files\cursor\resources\app\resources\helpers\node.exe`（`where.exe node` 首条） | **存在**；注意为 **Cursor 捆绑 Node**，未必与独立安装的 Node 一致 |
| npm | 11.4.2 | `C:\Users\tinot\AppData\Roaming\npm\npm.cmd` 等 | **存在** |
| pnpm | — | — | **missing**（命令未识别） |
| yarn | — | — | **missing** |
| python | — | `C:\Users\tinot\AppData\Local\Microsoft\WindowsApps\python.exe` | **不可用/存根风险**（此前 `python --version` 非零退出） |
| py | — | `C:\Windows\py.exe` | **broken**：执行时报 *Unable to create process using `D:\Python\Python313\python.exe`*；`Test-Path D:\Python\Python313\python.exe` → **False** |
| pip | — | — | **missing**（未在 PATH 中解析为可执行文件） |
| git | — | — | **missing**（`where.exe git` 无文件） |
| rustc | 1.92.0 | `C:\Users\tinot\.cargo\bin\rustc.exe` | **存在** |
| cargo | 1.92.0 | `C:\Users\tinot\.cargo\bin\cargo.exe` | **存在** |
| ffmpeg | — | — | **missing** |
| npx tsc | 5.8.3 | 由 npm 调用 | **可调用** |

**说明**：未单独安装于 `C:\Program Files\nodejs\node.exe`（检测为不存在）；若需稳定工具链，建议安装 **独立 Node LTS** 并调整 PATH 优先级。

---

## 3. GPU / CUDA 状态

**`nvidia-smi`（摘录）**：

| 项 | 值 |
|----|-----|
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU |
| 显存 | 约 **996 MiB / 8188 MiB** 已用（审计时刻） |
| Driver | **591.74** |
| **CUDA Version（驱动声明）** | **13.1** |

**Python GPU / 库探测**：

| 检查 | 结果 |
|------|------|
| `py -3 -c "import torch; ..."` | **未执行成功**（Python 启动失败） |
| onnxruntime / ctranslate2 | **未执行成功**（同上） |

**status**：硬件与驱动 **可用**；**Python ML 栈无法在本机验证**。

---

## 4. 仓库与目录完整性

| path | exists | notes |
|------|--------|-------|
| `D:\Programs\github\lingua_1` | 是 | 根目录存在 |
| `D:\Programs\github\lingua_1\electron_node\electron-node` | 是 | Electron 工程存在 |
| `D:\Programs\github\lingua_1\node_runtime` | **否** | 用户期望的 `node_runtime` **不存在** |
| `D:\Programs\github\lingua_1\node_runtime\lexicon\current` | **否** | 词库 bundle 路径 **不存在** |
| `D:\Programs\github\lingua_1\expired\test wav` | **否** | 根下列表 **无** `expired` 目录 |
| `D:\Programs\github\lingua_1\electron_node\services` | 是 | Python 服务目录集合存在 |

---

## 5. Node / Electron 状态

| 检查项 | 结果 |
|--------|------|
| `package.json` | **存在** |
| `node_modules` | **不存在** → **node dependencies missing** |
| `npm ls --depth=0` | **未执行**（无 `node_modules` 时无意义；避免冗长错误输出） |
| `npx tsc --noEmit -p tsconfig.main.json` | **失败**：`TS2688` 找不到类型库 **`node`**、**`ws`**（典型原因：未 `npm install`） |

**`npm run` 列出的脚本（摘录）**：

- `start` → `electron .`
- `dev` → cleanup + concurrently main/renderer
- `dev:main` / `dev:renderer`
- `build` / `build:main` / `build:renderer`
- `test` → `jest`
- `test:integration`、`test:pipeline`、`test:aggregator` 等

---

## 6. 服务状态矩阵（配置 / 目录 / 端口 / 健康）

**说明**：未启动任何服务；健康检查为 **Invoke-WebRequest** 到 `127.0.0.1` 对应端口（2s 超时），超时记为 **未运行/不可达**。

**仓库内未发现**：`asr-text-correction-zh`、`candidate-ranker-zh` 独立服务目录或 `5018` 端口配置（全仓库 `electron_node` 内关键词检索无匹配）。

| service | port（配置） | 配置文件 | 目录存在 | 服务内 venv | health（本机探测） |
|---------|--------------|-----------|----------|-------------|---------------------|
| asr-sherpa-lm | **6011** | `electron_node/services/asr_sherpa_lm/service.json` + `config.py` | 是 | 无（`.venv`/`venv` 均无） | **不可达**（连接超时） |
| asr-sherpa-en | **6012**（`config.py` 默认） | `service.json` | 是 | 无 | 未逐项探测（默认未运行） |
| faster-whisper-vad | **6007**（`config.py`） | `service.json` | 是 | 无 | 未探测 |
| phonetic-correction-zh（拼音/同音纠错） | **5016** | `service.json` + `node-config-defaults.ts` URL | 是 | 无 | 未探测 |
| punctuation-restore | **5017** | `service.json` + `node-config-defaults.ts` | 是 | 无 | 未探测 |
| semantic-repair-en-zh | **5015** | `service.json` | 是 | 无 | 未探测 |
| nmt-m2m100 | **5008** | `service.json` | 是 | 无 | 未探测 |
| piper-tts | **5009**（`service.json`；*非* 5011） | `service.json` | 是 | 无 | 未探测 |
| speaker_embedding / your_tts / node-inference | 见各自 `service.json` | 是 | 无 | 未探测 |

**启动命令（来自 `service.json`，未执行）**：

- 多数服务：`python` + 入口脚本（如 `service_main.py`、`service.py`），`cwd` 为服务目录 `.`
- 需先修复 **Python 可执行路径** 并安装 `requirements.txt` 中依赖

**模型路径（asr-sherpa-lm）**：

- `config.py`：`MODEL_DIR = .../models/omnilingual_ctc_300m_int8`，需 `tokens.txt` + `model.int8.onnx` 或 `model.onnx`
- **审计时该目录不存在** → **模型未就绪**

**KenLM（可选）**：

- 环境变量 `ASR_SHERPA_LM_KENLM_PATH` 指向 `.arpa` 时启用；未检测到你已放置的 arpa 文件（未搜索全盘，仅逻辑说明）

---

## 7. 端口占用（`netstat -ano | findstr :PORT`）

审计端口：**6011, 5018, 5017, 5015, 5008, 5011, 5009, 6012, 6007**

| 结论 |
|------|
| 上述端口在审计时刻均为 **free**（无监听行匹配）→ **无端口冲突**；同时说明 **相关服务均未在本机监听** |

（未对 PID 反查 `tasklist`，因无监听进程。）

---

## 8. ASR / KenLM / n-best（代码与文件层面）

| 项 | 状态 |
|----|------|
| 服务目录 | **存在** |
| CTC + `decode_beams` + `nbest` | **代码存在**（`ctc_decode.py`、`service_main.py` 等） |
| `lm_score` / `logit_score` | **存在于 n-best 字典条目中**（代码层） |
| `kenlm_decision` | **未在 services 内检索到该字段名** |
| HTTP `/health` | **FastAPI 提供**（`service_main.py`）；本机 **无响应**（服务未起） |
| **Blocker** | **ONNX 模型目录缺失** + **Python 不可运行** |

---

## 9. 词库 bundle / SQLite

| 项 | 状态 |
|----|------|
| `node_runtime/lexicon/current` | **路径不存在** |
| `manifest.json` / `*.sqlite` / terms 等 | **无法审计**（目录缺失） |
| bundle 完整性 | **视为缺失** |

---

## 10. 测试集 WAV（conversion1–4）

| 路径 | 状态 |
|------|------|
| `D:\Programs\github\lingua_1\expired\test wav\conversion1` … `conversion4` | **父目录不存在**；仓库内 **Glob `*.wav` 为 0 个** |
| WAV 数量统计 | **0**（当前工作区树内未发现用户所述测试集） |

---

## 11. Blocker 清单（按优先级）

### P0

1. **`node_modules` 缺失** → Electron/TS 无法编译与运行。
2. **Python 解释器损坏**（`py` 指向不存在的 `D:\Python\Python313\python.exe`）→ **所有 Python 微服务无法启动**。
3. **asr-sherpa-lm 模型目录缺失**（`models/omnilingual_ctc_300m_int8`）→ ASR 即使修复 Python 也会 `is_ready()` 失败。

### P1

4. **Git 不在 PATH** → 克隆/子模块/版本管理不便（若仅本地拷贝可暂缓）。
5. **FFmpeg 不在 PATH** → 依赖 ffmpeg 的脚本/转码可能失败。

### P2

6. **pnpm/yarn 缺失** → 若团队文档要求 pnpm，则需对齐；当前 npm 可用。
7. **未配置独立 Node** → 当前默认 `node` 来自 Cursor 目录，长期建议安装系统 Node 并校正 PATH。

---

## 12. 最小重装 / 恢复建议（仅建议，未执行）

### A. 修复 Python（P0）

1. 安装或修复 **Python 3.10+**（与项目 `requirements` 对齐的版本），确保 `py -3` 与 `python` 指向真实 `python.exe`。
2. 对每个服务目录：`python -m venv .venv` → `.\.venv\Scripts\activate` → `pip install -r requirements.txt`（**自行执行**，本次未做）。
3. 再运行：`python -m pip check`。

### B. Node / Electron（P0）

```bat
cd /d D:\Programs\github\lingua_1\electron_node\electron-node
npm install
npx tsc --noEmit -p tsconfig.main.json
```

### C. ASR 模型与 KenLM（P0–P1）

1. 按 `asr_sherpa_lm/README.md` / 团队模型清单，将 **Omnilingual CTC int8** 文件放入  
   `electron_node\services\asr_sherpa_lm\models\omnilingual_ctc_300m_int8\`  
   （至少 `tokens.txt` + `model.int8.onnx` 或 `model.onnx`）。
2. 可选：设置环境变量 `ASR_SHERPA_LM_KENLM_PATH` 指向 `.arpa`。

### D. 词库与测试音频（按项目约定）

1. 若需要 `node_runtime/lexicon/current`：从备份或制品库恢复 **manifest + sqlite**。
2. 恢复 `expired\test wav\conversion*` 数据集到用户指定路径（当前仓库内无）。

### E. 建议服务启动顺序（仅概念）

1. 调度 / ModelHub（若节点需连）  
2. **ASR**（6011/6012）→ **phonetic 5016** → **punctuation 5017** → **semantic 5015** → **NMT 5008** → **TTS 5009**（以 `service.json` 为准）  
3. 最后启动 **Electron**（`npm run dev` 或 `npm start`）

---

## 13. Smoke / E2E 建议命令（未执行）

与此前代码审计一致：**`jobpipeline-wav-batch.integration.test.ts` 当前不在仓库**，下列命令仅作「环境就绪后」参考：

```bat
cd /d D:\Programs\github\lingua_1\electron_node\electron-node
set RUN_JOBPIPELINE_WAV=1
set JOBPIPELINE_WAV_MAX=1
set "JOBPIPELINE_WAV_ROOT=D:\Programs\github\lingua_1\expired\test wav\conversion1"
set JOBPIPELINE_DISABLE_PUNCTUATION=1
set JOBPIPELINE_REPORT_BASENAME=environment_smoke.json
npx jest tests/integration/jobpipeline-wav-batch.integration.test.ts --runInBand --testTimeout=300000 --forceExit
```

E2E 翻译（需 NMT/TTS 已起且端口一致）：

```bat
set JOBPIPELINE_E2E_TRANSLATION=1
set JOBPIPELINE_NMT_PORT=5008
set JOBPIPELINE_TTS_PORT=5009
```

（**注意**：本仓库 `piper-tts` 的 `service.json` 端口为 **5009**，若脚本硬编码 5011 需对齐。）

---

## 14. 健康检查原始结果摘要

| URL | 结果 |
|-----|------|
| `http://127.0.0.1:6011/health` | **失败**（约 2s 超时 → 服务未监听或防火墙/代理问题） |

未对其余端口重复探测（均为 free netstat）。

---

*本报告为只读审计；环境变更后请重新采集版本与路径。*
