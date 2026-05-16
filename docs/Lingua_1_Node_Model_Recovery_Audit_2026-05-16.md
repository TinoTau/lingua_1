# Lingua_1 节点端模型恢复审计报告（只读）

**审计日期**：2026-05-16  
**仓库根**：`D:\Programs\github\lingua_1`  
**范围**：`electron_node/services/**` 各 Python/Rust 服务、`electron_node/electron-node` 默认 URL；**未修改任何代码**。

**说明**：`node_runtime` 在本仓库快照中**可能不存在**（此前环境审计）；本报告以 **`electron_node/services/<id>`** 为模型主落点。  
**未执行任何大文件下载**；下列命令供你本地按需执行。

---

## 1. 总体结论

| 类别 | 结论 |
|------|------|
| **已存在模型（若你曾按脚本下载过）** | `asr_sherpa_lm`（Omnilingual）、`asr_sherpa_en`（NeMo EN）、`faster_whisper_vad`（可本地 CT2）、`nmt_m2m100`（两套 `m2m100-*` 目录）、`piper_tts`（`models/zh/...`）、部分 `semantic_repair_en_zh/models/*.gguf` 等——**取决于你磁盘是否仍在**；本审计**不扫描磁盘体积**，以**代码默认路径**为准。 |
| **仓库内缺失的「下载脚本」** | `speaker_embedding` 的 README 引用 **`download_speaker_embedding_model.py`**，当前目录下**仅有** `speaker_embedding_service.py`（脚本**缺失**，需按 README 自建流程或从 HF 手动放置到 `models/speaker_embedding/cache/`）。 |
| **仓库中不存在的服务** | **`asr_text_correction_zh`、`candidate_ranker_zh`、端口 `5018` 专用服务**：全仓 `electron_node` **无**对应目录/配置；**5016** 在 `node-config-defaults.ts` 为 **`phonetic_correction_zh`**（同音纠错），**不是** `your_tts`（`service.json` 里 your-tts 也写了 5016，**与 phonetic 端口冲突**，属配置风险）。 |
| **必须恢复（P0，跑通主翻译/朗读链）** | **NMT**（`m2m100-en-zh` / `m2m100-zh-en` + `HF_LOCAL_FILES_ONLY` 启动）、**TTS**（Piper 语音文件 + `onnxruntime-gpu`）、**ASR**（已恢复则略）。 |
| **强烈建议（P1）** | **`semantic_repair_en_zh`**（Qwen GGUF ~4GB）、**`phonetic_correction_zh`**（`zh_char_3gram.trie.bin`，可由 **`addons/char-lm`** 训练产出或拷贝）。 |
| **可选 / 热插拔 / 主链可弱化** | **`punctuation_restore`**（FunASR `ct-punc`，首启会拉模型）、**`speaker_embedding`**、**`your_tts`**、**`node-inference`**（Rust 多模型，独立栈）。 |
| **最小恢复顺序（按当前 JobPipeline 真实依赖）** | 1）**NMT + Piper**（翻译与 TTS）→ 2）**semantic-repair**（节点策略常强制）→ 3）**phonetic** KenLM trie → 4）**punctuation**（若仍启用该步骤）→ 5）**speaker / yourtts**（按产品功能）。 |

---

## 2. 服务模型矩阵（汇总）

> **当前状态**：未自动检测你机器上的文件是否存在；请用「证据路径」下的 `Get-ChildItem` 自查。  
> **端口**：以 **`service.json` / `config.py` / 代码默认值** 为准；与 README 不一致处已标注。

| 服务 | 端口（默认） | 模型 / 类型 | 来源 | 本地默认路径 | 优先级 |
|------|--------------|-------------|------|----------------|--------|
| **asr-sherpa-lm** | 6011 | Omnilingual CTC 300M **int8 ONNX** + 可选 KenLM `.arpa` | GitHub `k2-fsa/sherpa-onnx` release（`download_model.py` URL） | `services/asr_sherpa_lm/models/omnilingual_ctc_300m_int8/` | P0（ASR 主路） |
| **asr-sherpa-en** | 6012 | NeMo CTC EN Conformer small **ONNX** + 可选 KenLM | 同上，`download_model.py` | `services/asr_sherpa_en/models/nemo_ctc_en_conformer_small/` | P1（英文 ASR） |
| **faster-whisper-vad** | 6007 | **CTranslate2** Faster-Whisper（默认 HF `Systran/faster-whisper-base`） | HF / 本地 `models/asr/whisper-base-ct2` | `services/faster_whisper_vad/models/asr/` 下缓存结构 | P1（非 Sherpa 主路时） |
| **phonetic_correction_zh** | 5016 | **KenLM trie** `zh_char_3gram.trie.bin` | **自建**：`addons/char-lm` 训练脚本产出；或 `CHAR_LM_PATH` 指向任意路径 | `services/phonetic_correction_zh/models/zh_char_3gram.trie.bin` | P1 |
| **punctuation_restore** | 5017 | **FunASR** `AutoModel(model="ct-punc", revision="v2.0.4")` | FunASR/ModelScope **首启自动拉取**（缓存目录由库决定） | 无固定「拷贝路径」；需 **GPU `cuda:0`** | P2（主链可关步骤时降级） |
| **semantic_repair_en_zh** | 5015 | **Qwen2.5 3B GGUF**（`llama.cpp`） | **手动**：HF 等获取 `.gguf`；见 `MODELS_SETUP_GUIDE.md` | `services/semantic_repair_en_zh/models/qwen2.5-3b-instruct-{zh,en}-gguf/*.gguf` | P0–P1（与节点「强制语义修复」策略相关） |
| **nmt-m2m100** | 5008 | **Transformers** `facebook/m2m100_418M`（**非** CT2；**非** 1.2B） | `download_models.py` → `from_pretrained` 保存到本地 | `services/nmt_m2m100/models/m2m100-en-zh/` 与 `m2m100-zh-en/` | P0 |
| **piper-tts** | **5009**（`service.json`；README 仍写 5006 为**过时**） | Piper **ONNX** + `.onnx.json` | `download_piper_chinese.py` → HF `rhasspy/piper-voices` | `services/piper_tts/models/zh/zh_CN-huayan-medium/` 等；或 `PIPER_MODEL_DIR` | P0 |
| **speaker-embedding** | 5014 | SpeechBrain **ECAPA**（缓存目录） | README：**首次自动 HF 下载**；下载脚本**仓库内缺失** | `services/speaker_embedding/models/speaker_embedding/cache/` | P2 |
| **your-tts** | **5016**（`service.json`，与 phonetic **冲突**） | YourTTS 资源目录 | 代码提示：**model-hub** 拉取 | `services/your_tts/models/your_tts` 或 `node-inference/models/tts/your_tts` 等 fallback | P2 |
| **node-inference** | （无 HTTP 端口于 `service.json`） | Rust 多模块 ONNX/ASR/VAD… | `cargo run`；模型路径见该 crate 文档 | `services/node-inference/` 下配置与 `central_server/model-hub` 联动 | P2（独立栈） |
| **asr_text_correction / candidate_ranker / 5018** | — | — | **本仓库无此服务** | — | — |

---

## 3. ASR（`asr_sherpa_lm`）— 即使已恢复也记录在案

| 项 | 内容 |
|----|------|
| **模型名** | Omnilingual CTC **300M int8**（release 包名见 `download_model.py`） |
| **类型** | **ONNX**（`model.int8.onnx` 优先，否则 `model.onnx`）+ `tokens.txt` |
| **KenLM** | **可选**；`ASR_SHERPA_LM_KENLM_PATH` → `.arpa` |
| **n-best** | **HTTP 返回 `nbest`**；Node `ctc-asr-strategy` 是否透传见另文审计（此处不展开） |
| **下载** | `python download_model.py`（服务目录） |
| **Health** | `GET http://127.0.0.1:6011/health` |
| **Smoke** | `POST http://127.0.0.1:6011/utterance`（PCM16 base64，见 `README.md`） |

---

## 4. NMT（`nmt_m2m100`）— 实际栈

**代码结论**（`nmt_service.py` + `model_loader.py` + `download_models.py`）：

- 使用 **`M2M100ForConditionalGeneration` + `M2M100Tokenizer`** → **Hugging Face Transformers 原版 M2M100**。  
- **`MODEL_NAME = "facebook/m2m100_418M"`** → **418M**，**不是** 1.2B，**不是** NLLB，**不是** CTranslate2 服务内转换。  
- **启动时**设置 **`HF_LOCAL_FILES_ONLY=1`** → **不会在运行时联网下载**；必须先有本地目录：  
  - `models/m2m100-en-zh/`  
  - `models/m2m100-zh-en/`  
  内为 `save_pretrained` 布局（`config.json`、`pytorch_model.bin` / `model.safetensors` 等，以实际文件为准）。

**下载（PowerShell 示例）**：

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\nmt_m2m100
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# 下载到脚本固定子目录（facebook/m2m100_418M 各一份）
python .\download_models.py
Get-ChildItem .\models\m2m100-en-zh
Get-ChildItem .\models\m2m100-zh-en
```

**启动与验证**：

```powershell
# README 推荐 uvicorn；也可 python -m uvicorn nmt_service:app --host 127.0.0.1 --port 5008
curl.exe -s http://127.0.0.1:5008/health
curl.exe -s -X POST http://127.0.0.1:5008/v1/translate -H "Content-Type: application/json" -d "{\"src_lang\":\"zh\",\"tgt_lang\":\"en\",\"text\":\"你好\",\"num_candidates\":1}"
```

---

## 5. Piper TTS（`piper_tts`）

| 项 | 内容 |
|----|------|
| **默认端口** | **`piper_http_server.py` 默认 5009**；`service.json` 写 **5009**（与 README 5006 **不一致**，以代码/service 为准）。 |
| **文件** | `*.onnx` + `*.onnx.json`（脚本示例：`zh_CN-huayan-medium.onnx`） |
| **来源** | `download_piper_chinese.py`：`huggingface_hub.hf_hub_download`，`repo_id=rhasspy/piper-voices`，子路径 `zh/zh_CN/huayan/medium` |
| **目标路径** | `services/piper_tts/models/zh/zh_CN-huayan-medium/`（或 `PIPER_MODEL_DIR` / `--model-dir`） |

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\piper_tts
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install huggingface_hub piper-tts
python .\download_piper_chinese.py
Get-ChildItem .\models\zh\zh_CN-huayan-medium
$env:PIPER_USE_GPU = "true"
python .\piper_http_server.py --host 127.0.0.1 --port 5009
```

```powershell
curl.exe -s http://127.0.0.1:5009/health
curl.exe -s http://127.0.0.1:5009/voices
# 最小 TTS（返回音频流或 WAV，视实现而定；voice 须与 /voices 中一致，例如 huayan medium）
curl.exe -s -X POST http://127.0.0.1:5009/tts -H "Content-Type: application/json" -d "{\"text\":\"你好\",\"voice\":\"zh_CN-huayan-medium\"}" -o .\smoke_tts.bin
```

---

## 6. 5016 / 中文「纠错」— 实际是 `phonetic_correction_zh`

- **不是**独立 `5018` 服务；**不是** BGE reranker；**不是** LLM。  
- **实现**：KenLM **trie.bin** + 混淆集（Python 服务）。  
- **默认文件**：`models/zh_char_3gram.trie.bin` 或环境变量 **`CHAR_LM_PATH`**。  
- **构建来源**：仓库 **`addons/char-lm`**（`train_and_build.ps1` / `.sh`）生成 `zh_char_3gram.trie.bin`，再复制到 `phonetic_correction_zh/models/`。  
- **GPU**：**非必须**（CPU KenLM 子进程/query）。  
- **无模型时**：README：`/health` 可为 **`degraded`**，纠错可能退回原文。

---

## 7. 5015 `semantic_repair_en_zh`

| 项 | 内容 |
|----|------|
| **模型** | **Qwen2.5 3B Instruct** 的 **GGUF**（`llama.cpp` / `llamacpp_engine.py`），**不是** Mistral/Llama 品牌名。 |
| **路径** | `models/qwen2.5-3b-instruct-zh-gguf/*.gguf`、`models/qwen2.5-3b-instruct-en-gguf/*.gguf`（`config.py` `_find_model`） |
| **是否必须** | 与节点 **「强制语义修复」** 策略强相关：无模型时处理器可能无法启用；见 `MODELS_SETUP_GUIDE.md`。 |
| **下载** | 文档以**复制/链接**为主；公开 GGUF 可从 **Hugging Face** 搜索 `Qwen2.5-3B-Instruct GGUF` 后 **`huggingface-cli download`** 到上述目录（若 gated 需 `huggingface-cli login`）。 |

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\semantic_repair_en_zh
# 安装依赖后，将 .gguf 放入 models/... 子目录
Get-ChildItem .\models -Recurse -Filter *.gguf
python .\service.py
curl.exe -s http://127.0.0.1:5015/health
```

---

## 8. 5017 `punctuation_restore`

| 项 | 内容 |
|----|------|
| **是否需要模型** | **需要**；`core.load_model()` → **`funasr.AutoModel(model="ct-punc", model_revision="v2.0.4", device="cuda:0")`** |
| **类型** | FunASR **预置模型名**（非本地 ONNX 路径写死） |
| **是否值得恢复** | 若 Pipeline **仍包含 `PUNCTUATION_RESTORE` 且 zh/en** 则需要；若你已全局禁用该步骤则 **P2**。 |
| **风险** | **强制 `cuda:0`**；无 GPU 可能无法启动。 |

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\punctuation_restore
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python .\service.py
curl.exe -s http://127.0.0.1:5017/health
curl.exe -s -X POST http://127.0.0.1:5017/punc -H "Content-Type: application/json" -d "{\"text\":\"测试句子\",\"lang\":\"zh\"}"
```

---

## 9. 其他服务 — 证据与命令摘要

### 9.1 `asr_sherpa_en`

- **下载**：`python download_model.py` → `models/nemo_ctc_en_conformer_small/`  
- **URL**：`download_model.py` 内 `sherpa-onnx-nemo-ctc-en-conformer-small.tar.bz2`  
- **Health**：`GET http://127.0.0.1:6012/health`（与 LM 服务同形）  
- **Smoke**：`POST /utterance`（同 LM）

### 9.2 `phonetic_correction_zh`（补充命令）

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\phonetic_correction_zh
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# 将 zh_char_3gram.trie.bin 放入 .\models\ 或设置 $env:CHAR_LM_PATH
python .\service.py
curl.exe -s http://127.0.0.1:5016/health
curl.exe -s -X POST http://127.0.0.1:5016/correct -H "Content-Type: application/json" -d "{\"text_in\":\"测试同音字\",\"lang\":\"zh\"}"
```

### 9.3 `faster_whisper_vad`

- **默认 HF**：`Systran/faster-whisper-base`；本地优先 `models/asr/whisper-base-ct2`（见 `config.py`）  
- **下载**：`python download_model.py`（参数见脚本，可 large-v3）  
- **依赖**：`faster-whisper` + **CTranslate2** 缓存结构

### 9.4 `speaker_embedding`

- **期望路径**：`models/speaker_embedding/cache/`  
- **README**：称可 `python download_speaker_embedding_model.py` —— **脚本当前不在仓库**；可依赖 **首次运行自动 HF 下载**（需联网与 HF 权限）。  
- **Health**：`GET http://127.0.0.1:5014/health`（以实际 `speaker_embedding_service.py` 参数为准）

### 9.5 `your_tts`

- **模型**：`yourtts_service.py` 默认找 `models/your_tts` 或 `node-inference/models/tts/your_tts` 或 `model-hub/models/tts/your_tts`  
- **端口**：`service.json` **5016** 与 **phonetic 5016 冲突** —— 部署时需改其一。

### 9.6 `node-inference`（Rust）

- **启动**：`cargo run --release`（`service.json`）  
- **模型**：分散在 crate 与各 `central_server/model-hub` 文档；本次不展开子模块矩阵。

---

## 10. 风险清单

| 风险 | 说明 |
|------|------|
| **体积** | M2M100 两套、Qwen GGUF ~4GB、Sherpa ONNX、Piper、FW 等合计 **数十 GB 级**可能。 |
| **下载源** | GitHub / HF / FunASR 镜像；国内需代理或镜像站。 |
| **Python / CUDA** | 各服务 `requirements.txt` 版本不一；**onnxruntime-gpu** 与 **CUDA 12 + cuDNN 9** 需对齐。 |
| **显存** | `semantic_repair` `service.json` 估计 **~2GB VRAM**；NMT+M2M100+ASR 同时占用需规划。 |
| **HF 登录** | 多数公开模型不需要；**gated** 模型需 `huggingface-cli login`。 |
| **路径空格** | `Program Files` 等路径在 PowerShell 中请用引号。 |
| **端口文档漂移** | Piper README 端口与 `service.json` / `piper_http_server.py` **不一致** —— **以代码为准**。 |

---

## 11. 证据索引（主文件）

| 服务 | 关键文件 |
|------|----------|
| asr_sherpa_lm | `config.py`, `download_model.py`, `service.json`, `README.md` |
| asr_sherpa_en | `config.py`, `download_model.py`, `service.json` |
| faster_whisper_vad | `config.py`, `download_model.py`, `service.json` |
| phonetic_correction_zh | `config.py`, `README.md`, `addons/char-lm/README.md` |
| punctuation_restore | `core.py`, `service.py`, `config.py`, `service.json` |
| semantic_repair_en_zh | `config.py`, `MODELS_SETUP_GUIDE.md`, `utils/model_loader.py`, `service.json` |
| nmt_m2m100 | `nmt_service.py`, `model_loader.py`, `download_models.py`, `README.md`, `service.json` |
| piper_tts | `download_piper_chinese.py`, `piper_http_server.py`, `service.json`, `README.md` |
| speaker_embedding | `speaker_embedding_service.py`, `README.md`, `service.json` |
| your_tts | `yourtts_service.py`, `service.json` |

---

*本报告仅基于当前仓库文件；若上游 Release 或 HF 仓库变更文件名，请以各 `download_*.py` 内 URL 与 `README` 为准。*
