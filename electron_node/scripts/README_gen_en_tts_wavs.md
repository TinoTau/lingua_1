# 生成英文 TTS 测试 WAV（gen_en_tts_wavs.py）

用 NMT（中→英）和 Piper TTS 将固定中文说明文本生成多段约 10 秒的英语 WAV，保存为 16kHz 单声道 PCM，供英语 CTC ASR 稳定性测试使用。

## 前置条件

- **NMT**（端口 5008）与 **Piper TTS**（端口 5009）已启动。  
  建议：在 `electron_node/electron-node` 下执行 `npm start`，在界面中启动 NMT 与 Piper TTS。
- Python 依赖：`pip install requests numpy`

## 用法

```bash
cd electron_node
python scripts/gen_en_tts_wavs.py --out-dir "D:\Programs\github\lingua_1\expired"
```

- 若 NMT 未启动或长文本超时，可加 `--no-nmt`，使用脚本内预译英文，仅需 TTS：
  ```bash
  python scripts/gen_en_tts_wavs.py --out-dir "D:\Programs\github\lingua_1\expired" --no-nmt
  ```
- 输出文件：`en_tts_1.wav`, `en_tts_2.wav`, ...（约 7 段，每段约 26 词/约 10 秒）。

## 测试英语 CTC

生成完成后，对每个 WAV 跑 pipeline（需节点与 asr-sherpa-en 已启动）：

```bash
cd electron_node/electron-node
node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\expired\en_tts_1.wav" --en
node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\expired\en_tts_2.wav" --en
# ... 依此类推
```

或写循环批量测：

```powershell
1..7 | ForEach-Object {
  node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\expired\en_tts_$_.wav" --en
}
```
