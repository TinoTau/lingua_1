# ASR 模型恢复审计报告（只读）

**审计日期**：2026-05-16  
**范围**：`electron_node/services/asr_sherpa_lm` 及全仓检索；**未修改任何代码**。

---

## 1. 结论

| 项 | 结论 |
|----|------|
| **原先默认模型** | **Sherpa-ONNX Omnilingual ASR**：**1600+ 语言、300M 参数、CTC、int8 量化**；发布包名见 `download_model.py` 中 `URL` / `EXTRACTED_NAME`。 |
| **是否 int8** | **是**（包名与脚本目标文件名 `model.int8.onnx` 一致）。 |
| **是否 ONNX** | **是**（`onnx_runner.py` + `model.int8.onnx` 或 `model.onnx`）。 |
| **下载来源** | **GitHub Release（k2-fsa/sherpa-onnx）**，非 Hugging Face；官方文档链接见 `download_model.py` 注释。 |
| **本地默认路径** | **`<asr_sherpa_lm 服务根目录>/models/omnilingual_ctc_300m_int8`**（与 `config.py` 中 `MODEL_DIR` 一致）。 |
| **是否需要 KenLM** | **否（可选）**；不设 `ASR_SHERPA_LM_KENLM_PATH` 仍可解码并返回 **n-best**；无 KenLM 时 **无** `kenlm_decision` 类 meta（本服务 n-best 条目中主要为 `text`/`score`/`logit_score`/`lm_score`，无 KenLM 时 LM 相关为 beam 内逻辑）。 |
| **`download_model.py` 是否可用于恢复** | **可用**：一键下载官方 tar.bz2、解压并重命名为 `omnilingual_ctc_300m_int8`；**无 CLI 参数**、**无断点续传**、**不支持 `--help`（会仍执行 main）**。 |

---

## 2. 证据（文件与逻辑摘要）

### 2.1 `README.md`

- 默认模型：**Omnilingual CTC 300M int8（1600+ 语言）**。
- 模型目录：**`models/omnilingual_ctc_300m_int8`**（固定）。
- 下载：**`python download_model.py`**。
- KenLM：**可选**，`ASR_SHERPA_LM_KENLM_PATH` 指向 **.arpa**（文档亦写 .bin；**解码器对 `.arpa` 有 UTF-8 补丁**，见 `ctc_decode.py`）。

### 2.2 `download_model.py`

- **URL**：  
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12.tar.bz2`
- 解压目录名：`sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12` → 重命名为 **`omnilingual_ctc_300m_int8`**。
- 「已存在」判断：目标目录下存在 **`model.int8.onnx`** 则跳过下载。
- 下载实现：`urllib.request`，整包写入 `*.tmp` 后 rename；**无分片续传**；下载完成后**删除** tar.bz2 归档。

### 2.3 `config.py`

- `MODEL_DIR = os.path.join(_SERVICE_DIR, "models", "omnilingual_ctc_300m_int8")` — **无环境变量覆盖模型目录**（与 `ServiceTypes.ts` 注释中的「如 `ASR_SHERPA_LM_MODEL_DIR`」仅为类型层举例；**本服务 `config.py` 未读取该变量**）。
- 可覆盖项：`ASR_SHERPA_LM_PORT`、`NUM_THREADS`、`SAMPLE_RATE`、`FEATURE_DIM`、`PROVIDER`（默认 `cuda`）、`BEAM_WIDTH`、`NBEST`、`KENLM_PATH`、`ALPHA`/`BETA` 等。
- `_load_config`：**优先** `model.int8.onnx`，否则 **`model.onnx`**；且必须有 **`tokens.txt`**。

### 2.4 `service.json`

- 仅描述 `exec`：`python service_main.py`，**不含模型路径**；路径完全由 `config.py` 决定。

### 2.5 `service_main.py` + `recognizer.py` + `/health`

- `/health`：`model_loaded` = `recognizer.is_ready()` → `_ready`。
- `_ready` 仅在 **`recognize()` 首次调用**且 **`_init()` 成功**后置为 `True`（**惰性加载**）。
- **重要**：即使磁盘上模型已齐全，**在进程内尚未跑过至少一次会触发 `_init()` 的 `recognize()` 之前**，`/health` 的 `model_loaded` **仍可能为 `false`**。这与「模型缺失」在现象上相同；**请以模型目录文件是否存在 + 首次解码或 `debug_decode.py` 为准**。

### 2.6 `onnx_runner.py`

- **仅支持 `PROVIDER=cuda`** 与 `CUDAExecutionProvider`；CPU 路径会直接 `ValueError`。

### 2.7 `debug_decode.py`

- 用法：`python debug_decode.py [wav_path]`（**无 `--help` 分支**）。
- 依赖 `get_model_config()`；可选使用模型目录下 `test_wavs/*.wav`。

### 2.8 全仓检索说明

- **`omnilingual` / `omnilingual_ctc_300m_int8` / `ASR_SHERPA_LM_*`**：主要出现在 **`asr_sherpa_lm`** 与历史审计文档；**无第二套互斥默认模型**。
- **`asr_sherpa_en`** 使用不同目录 `models/nemo_ctc_en_conformer_small` — **另一服务**，非本 LM 服务默认。

---

## 3. 必需文件清单

| 文件 | 是否必需 | 目标路径（相对模型目录） | 用途 |
|------|----------|---------------------------|------|
| `tokens.txt` | **必需** | `models/omnilingual_ctc_300m_int8/tokens.txt` | CTC 标签 / pyctcdecode 词表 |
| `model.int8.onnx` | **二选一（优先）** | 同上 | int8 ONNX 权重 |
| `model.onnx` | **二选一（备选）** | 同上 | 非 int8 导出时 fallback（`config._load_config` 顺序） |
| `test_wavs/*.wav` | **可选** | `.../test_wavs/` | `debug_decode.py` 无参数时自动找样例 |
| KenLM `.arpa`（或 pyctcdecode 接受的二进制路径） | **可选** | 任意路径，由 `ASR_SHERPA_LM_KENLM_PATH` 指向 | n-best 重打分；**`.arpa` 在 Windows 下有 UTF-8 读取补丁** |

官方 tar 包内通常还含其它元数据/测试文件；**最小运行**以 `config._load_config` 能返回非 `None` 为准（`tokens.txt` + `model.int8.onnx` 或 `model.onnx`）。

---

## 4. `download_model.py` 能力评估

| 能力 | 支持情况 |
|------|----------|
| 自动下载 | **是**（固定 URL） |
| 下载到默认目录 | **是**（`<服务目录>/models/omnilingual_ctc_300m_int8`） |
| 指定 output dir | **否**（硬编码 `TARGET_DIR_NAME`） |
| Hugging Face | **否** |
| 断点续传 | **否**（整包下载；中断可留下不完整 `.tmp`，需人工删后重跑） |
| `--help` | **不支持**；`main()` **不解析** `sys.argv`，**勿执行** `python download_model.py --help` 以免误以为安全（仍会跑完整逻辑） |

---

## 5. 推荐恢复命令（Windows PowerShell）

**前置**：已安装可用的 **Python 3.x**、**CUDA 环境与 onnxruntime-gpu**（见 `README.md` / `requirements.txt`）。在服务目录创建 venv 并安装依赖（**需你自行执行**）：

```powershell
Set-Location 'D:\Programs\github\lingua_1\electron_node\services\asr_sherpa_lm'

# 若尚无 venv（目录名任选 .venv 或 venv）
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

# 下载并解压模型（大文件，可能数 GB 量级，请保证磁盘与网络）
python .\download_model.py

# （可选）KenLM：仅当你已有 .arpa/.bin 且希望参与 rescore
# $env:ASR_SHERPA_LM_KENLM_PATH = "D:\path\to\your.lm.arpa"

# 启动服务（另开终端或后台前确保已 activate 同一 venv）
$env:ASR_SHERPA_LM_PORT = "6011"   # 可选，默认 6011
python .\service_main.py
```

**若无法使用脚本**（例如 GitHub 受限），可手动下载 **同一 URL** 的 `tar.bz2`，解压后将文件夹重命名为 `omnilingual_ctc_300m_int8` 并放到：

`D:\Programs\github\lingua_1\electron_node\services\asr_sherpa_lm\models\`

**Hugging Face 镜像（备选，非仓库脚本）**：官方来源为 GitHub Release；若团队有 HF 镜像，需**自行确认**与 `EXTRACTED_NAME` 内容一致后再拷贝到上述目录（本审计不替代校验哈希）。

---

## 6. 验证命令

```powershell
# 1) 模型目录文件
Get-ChildItem -LiteralPath 'D:\Programs\github\lingua_1\electron_node\services\asr_sherpa_lm\models\omnilingual_ctc_300m_int8'

# 2) 本地解码烟测（需 venv 已激活、CUDA 可用）
Set-Location 'D:\Programs\github\lingua_1\electron_node\services\asr_sherpa_lm'
.\.venv\Scripts\Activate.ps1
# 无参数：尝试模型目录下 test_wavs；或显式 WAV：
python .\debug_decode.py
python .\debug_decode.py 'D:\path\to\sample_16k_mono.wav'

# 3) 单元测试（不启 HTTP，TestClient）
python -m pytest .\test_api.py -q

# 4) 服务健康（需 service_main 已监听 6011）
curl.exe -s http://127.0.0.1:6011/health
```

**`/health` 期望**：

- 服务进程已启动：**`"status":"ok"`** 恒为真（见 `service_main.py`）。
- **`"model_loaded": true`**：在**当前实现**下，通常表示 **`recognize()` 已成功完成 `_init()`**（即至少成功加载 ONNX+decoder 一次）。**仅启动进程、从未请求过 `/utterance` 时，可能仍为 `false` 即使文件已在磁盘** — 建议下载后 **调用一次 `/utterance` 或运行 `debug_decode.py`** 再读 `/health`，或直接以目录文件与 `debug_decode` 输出为准。

若模型文件缺失：`get_model_config()` 为 `None`，`_init()` 不会加载，`model_loaded` 会持续为 `false`，`/utterance` 返回空文本与空 n-best（见 `recognizer.recognize`）。

---

## 7. 风险与注意事项

| 风险 | 说明 |
|------|------|
| **体积大** | tar.bz2 为完整发布包，下载与解压耗时、占磁盘大。 |
| **网络 / 代理** | `urllib` 直连 GitHub；受限环境需代理或改用手动拷贝。 |
| **无断点续传** | 中断后需删除不完整 `.tmp` 或损坏归档后重试。 |
| **KenLM 缺失** | **不阻止** ASR 启动与 **n-best**；仅影响 **LM 重打分质量**及 n-best 中 **LM 相关分数形态**。 |
| **路径空格** | 本服务默认路径无空格；若将 KenLM 放在含空格路径，注意 PowerShell 引号。 |
| **Python / venv** | 须与 `onnxruntime-gpu`、CUDA 版本匹配；错误组合会导致 `load_session` 失败。 |
| **误跑 `download_model.py --help`** | 无 argparse，会执行完整下载逻辑 — **避免**。 |

---

## 8. 问题清单逐条答复（摘要）

1. **原先默认模型**：见上文 §1、§2；**单一默认**，无多模型切换。  
2. **`download_model.py`**：可用；**无 `--help`/无 output dir/无 HF/无续传**。  
3. **`config.py` 路径规则**：固定 `<服务>/models/omnilingual_ctc_300m_int8`；**仅环境变量覆盖端口/线程/beam/KenLM 等，不覆盖模型根目录**；`service.json` **不覆盖**；缺模型时 `get_model_config()` 为 `None`，流水线不就绪。  
4. **KenLM**：**不必需**；无 KenLM 仍可 **n-best**；无 KenLM **无** LM 增强及 README 所述调参收益。  
5. **下载命令**：见 §5。  
6. **验证命令**：见 §6；注意 **`model_loaded` 惰性**语义。

---

*本报告依据仓库当前文件内容生成；若上游更新 Release 文件名，请以 `download_model.py` 内 `URL` 为准或同步更新脚本。*
