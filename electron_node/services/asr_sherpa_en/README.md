# ASR Sherpa English CTC 服务

英文 CTC（NeMo Conformer small），支持 Beam Search、N-best、可选 KenLM。

- **默认模型**：sherpa-onnx-nemo-ctc-en-conformer-small（16k）
- **API**：`POST /utterance` PCM16 base64；响应含 `text`、`nbest`、`meta.decode_ms`、`segments`、`duration`；`GET /health` 健康检查

## 架构

音频 → fbank(80 维) → CTC ONNX → log_probs → pyctcdecode(beam) → text + nbest

## 运行

- 端口：6012（`ASR_SHERPA_EN_PORT`）
- 模型目录：`models/nemo_ctc_en_conformer_small`
- 下载模型：`python download_model.py`
- 可选 KenLM：`ASR_SHERPA_EN_KENLM_PATH`、`ASR_SHERPA_EN_ALPHA`、`ASR_SHERPA_EN_BETA`
- `ASR_SHERPA_EN_BEAM_WIDTH`（默认 4）、`ASR_SHERPA_EN_NBEST`（默认 4）
- 解码问题（如输出出现数字「4」）：见 [docs/CTC_Decode.md](docs/CTC_Decode.md)

## 依赖

见 `requirements.txt`（onnxruntime-gpu、pyctcdecode、librosa）。**GPU 运行**需在服务目录下创建 venv 并安装依赖：

```powershell
cd 本服务目录
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

需已安装 CUDA 12.x 与 cuDNN，节点启动时会注入 CUDA 环境变量。
