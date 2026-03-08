# LID 二选一功能测试说明

## 完整 Pipeline（LID → ASR → NMT → TTS）

需先**在配置中设置 LID 模型路径**并**启动 ASR 服务**，再启动节点。

### 1. 配置 LID（必须）

在配置文件中设置 `lid.modelPath` 指向 **Sherpa-ONNX** 模型目录（含 `tiny-encoder.int8.onnx`、`tiny-decoder.int8.onnx`）。本机需已安装 `pip install sherpa-onnx`。配置文件路径：

- Windows: `%APPDATA%\lingua-electron-node\electron-node-config.json`
- macOS: `~/Library/Application Support/lingua-electron-node/electron-node-config.json`

示例：`"lid": { "enabled": true, "modelPath": "models/sherpa-onnx-lid" }`（相对 electron-node 工作目录）。

### 2. 启动节点

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

等待控制台出现 `✅ Test server 已启动: http://127.0.0.1:5020`，以及日志中的 `LID model loaded`。

### 3. 在节点界面中确认 ASR 已启动（或已手动启动 CTC）

### 4. 跑完整 pipeline（带 LID）

```powershell
# 中文音频 → 结果中 extra.lid / extra.router 应为 zh
node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\expired\chinese.wav" --lid

# 英文音频
node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\expired\english.wav" --lid
```

响应中的 `extra.lid`、`extra.router` 会包含 LID 预测与 Router 选出的 `selected_src_lang`，用于验证 zh/en 二选一。

---

## 说明

- **LID 模型**：由配置 `lid.modelPath` 指定 Sherpa-ONNX 目录，通过子进程调用 `scripts/lid_sherpa.py` 做语种识别并映射到调度下发的二选一候选。
- **必须加载**：未正确配置或加载失败时，带 LID 的 job 会报错；需确保本机 Python 已安装 `sherpa-onnx`。
