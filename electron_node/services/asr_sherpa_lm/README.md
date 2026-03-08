# ASR Sherpa-LM 服务

ONNX 取 logits + pyctcdecode 解码，输出 **N-best**。

- **默认模型**：Omnilingual CTC 300M int8（**1600+ 语言**）
- `POST /utterance`：PCM16 base64；响应含 `text`、`nbest`、`meta.decode_ms`、`segments`、`duration`
- `GET /health`：健康检查

## 架构

```
音频 -> fbank(80 维) -> CTC ONNX -> log_probs -> pyctcdecode(beam) -> text + nbest
```

- **features.py**：波形 -> fbank（16k, 80 维）
- **onnx_runner.py**：加载 ONNX，输出 log_probs，与 sherpa-onnx CTC 输入/输出兼容
- **ctc_decode.py**：tokens.txt 建解码器，decode_beams 得 n-best
- **recognizer.py**：串联上述三步

## 运行

- 端口：6011（`ASR_SHERPA_LM_PORT`）
- 模型目录：`models/omnilingual_ctc_300m_int8`（固定，不提供多模型切换）
- 下载模型：`python download_model.py`
- **KenLM（可选）**：设 `ASR_SHERPA_LM_KENLM_PATH` 指向 .arpa 或 .bin 时，beam 解码用 KenLM 参与 n-best 打分；不设则仅 beam 解码。可选 `ASR_SHERPA_LM_ALPHA` / `ASR_SHERPA_LM_BETA`（默认 0.5 / 1.0）。
- `ASR_SHERPA_LM_BEAM_WIDTH`（默认 4）、`ASR_SHERPA_LM_NBEST`（默认 4）

## 依赖

见 `requirements.txt`（onnxruntime-gpu、pyctcdecode、librosa）。**GPU 运行**需在服务目录下创建 venv 并安装依赖：

```powershell
cd 本服务目录
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

需已安装 CUDA 12.x 与 cuDNN，节点启动时会注入 CUDA 环境变量。

## 终端中文/多语言显示

Windows 控制台默认非 UTF-8 会乱码。可先执行 `chcp 65001` 或使用 UTF-8 终端。接口 JSON 为 UTF-8。

---

## 提高中文识别准确率

当前 **Omnilingual** 面向 1600+ 语言，中文未专门优化，易出现同音字/近音字错误。可按需采用以下方式提升中文准确率：

| 方式 | 说明 |
|------|------|
| **加大 LM 权重** | 提高 KenLM 在综合分中的权重：**`ASR_SHERPA_LM_ALPHA=0.4`**、**`ASR_SHERPA_LM_BETA=1.2`**。可小步调观察 n-best 变化。 |
| **使用更大的 KenLM** | 用更多中文语料训练 4-gram/5-gram 或词级 KenLM，并设 **`ASR_SHERPA_LM_KENLM_PATH`**，可明显提升 rescore 效果。 |
| **增大 beam** | **`ASR_SHERPA_LM_BEAM_WIDTH=8`**、**`ASR_SHERPA_LM_NBEST=8`**。会略增延迟。 |
| **保证输入质量** | 确保音频为 **16kHz、单声道、PCM16**；环境噪声会拉低准确率。 |
