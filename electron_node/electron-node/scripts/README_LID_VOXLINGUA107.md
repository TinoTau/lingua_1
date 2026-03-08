# LID VoxLingua107 节点内运行（ONNX）【已废弃】

> **现状**：节点端 LID 已改用 **Sherpa-ONNX**（Whisper 语种识别），本文档仅保留为 VoxLingua107 导出与历史配置参考。当前使用说明见 `models/sherpa-onnx-lid/README.md` 及配置 `lid.modelPath`（默认 `models/sherpa-onnx-lid`）。

---

SpeechBrain VoxLingua107（107 语种）以 ONNX 形式在节点进程内运行，无需单独起 LID 服务。

## 预训练模型维度说明：**用 60 维**

- **应使用 60 维**：当前 HuggingFace 预训练图内 `mean_var_norm` 的 mean 与 embedding 首层均为 **60 维**。导出脚本与节点默认均为 **n_mels=60**。
- **已知问题**：导出时图中 mean_var_norm 前某处可能仍带 98 维（trace 写死），导致即使用 60 维输入仍报 “60 by 98”。若遇此情况，需对 ONNX 做图手术（如在输入后加 Slice 取前 60 维）或换用其他 LID 模型/方案。

## 1. 一次性导出 ONNX

在 electron-node 目录执行：

```bash
pip install torch speechbrain onnx huggingface_hub
cd electron-node
python scripts/export_lid_voxlingua107_onnx.py [输出目录]
```

示例（导出到 `models`）：

```bash
python scripts/export_lid_voxlingua107_onnx.py models
```

导出后可检查图中与 60/98 相关的维度：

```bash
python scripts/inspect_lid_onnx_dims.py models/model.onnx
```

默认输出目录为 `lid_voxlingua107_onnx`。脚本会：

- 从 HuggingFace 下载 `speechbrain/lang-id-voxlingua107-ecapa`（Windows 下自动用 COPY 避免 symlink 权限问题）
- 导出 ONNX 子图：**Fbank 特征 → 107 维 logits**（不含 STFT）；**n_mels=60** 与图内 mean、embedding 首层一致，节点端默认配置与之对齐
- 生成 `model.onnx`、`labels.txt`（107 行）、`fbank_config.txt`（供核对）

得到目录结构示例：

```
models/   # 或你指定的输出目录
  model.onnx   # 输入 feats [1, n_mels, T]，输出 logits [1, 107]
  labels.txt
  fbank_config.txt
  sb_cache/    # SpeechBrain 缓存，可保留或删
```

## 2. 节点配置（必须启动）

LID 由**配置文件**控制，默认**必须启动**。配置文件路径（首次启动后自动生成）：

- Windows: `%APPDATA%\lingua-electron-node\electron-node-config.json`
- macOS: `~/Library/Application Support/lingua-electron-node/electron-node-config.json`

在配置文件中设置 `lid`（以下均为可选，未填则用默认值）：

```json
{
  "lid": {
    "enabled": true,
    "modelPath": "models",
    "modelFile": "model.onnx",
    "labelsFile": "labels.txt",
    "labelsCount": 107,
    "featureConfig": {
      "n_mels": 60,
      "n_fft": 512,
      "win_length": 400,
      "hop_length": 160,
      "pre_emphasis": 0,
      "cmvn": true,
      "sample_rate": 16000
    }
  }
}
```

- **enabled**：是否启用 LID（默认 `true`）。
- **modelPath**：ONNX 模型目录，相对 electron-node 工作目录或绝对路径。
- **modelFile**：模型文件名（默认 `model.onnx`），与 modelPath 拼接。
- **labelsFile**：标签文件名（默认 `labels.txt`）。
- **labelsCount**：标签行数（默认 107，VoxLingua107），用于校验文件。
- **featureConfig**：特征提取参数，须与 ONNX 导出一致；**n_mels** 须为 **60**（与当前导出一致），其余一般无需改。

节点启动时从配置读取上述项，加载 `modelPath/modelFile` 与 `modelPath/labelsFile`；调度下发的 `lid.candidates` 二选一由节点映射到 logits 结果。

模型路径仅来自配置 `lid.modelPath`。

## 3. 当前一致性（推荐版本）

| 来源 | 要求/实际 |
|------|-----------|
| 导出脚本 | n_mels=60（与图内 mean、embedding 首层一致），输出 `model.onnx`、`labels.txt`（107 行）、`fbank_config.txt` |
| 节点默认配置 | `lid.modelPath: "models"`，`lid.featureConfig.n_mels: 60`，`lid.labelsCount: 107`，`lid.modelFile/labelsFile` 与导出文件名一致 |
| models 目录 | 使用 `python scripts/export_lid_voxlingua107_onnx.py models` 导出后，与上述默认配置相符，**无需改配置即可使用** |

## 4. “60 by 98” 报错来源与定位

### 报错是谁返回的？

- **来自 ONNX Runtime（模型执行引擎）**，不是节点端业务代码。
- 报错发生在运行计算图里的 **`/mean_var_norm/Sub`** 节点时：做减法时两个张量在某一维上一个是 **60**、一个是 **98**，无法广播。
- 含义：送进 Sub 的张量维数须与 mean 常量一致。当前图内 mean 为 60 维，故用 **60 维** 输入即可，不会 60 by 98。

### 维数从哪里来？

- **当前使用 60 维**。节点端默认 **n_mels=60**，与导出图内 mean、embedding 首层一致；配置 **`lid.featureConfig.n_mels`** 保持 60 即可，**不会**再报 60 by 98。

### 若出现维度错误的排查步骤

1. 确认配置中 **`lid.featureConfig.n_mels`** 为 **60**（可删该字段用默认）。
2. **只保留一个节点进程**：完全退出 Electron 后结束所有 `electron.exe`，再 `npm run build` 与 `npm start`。
3. 看日志 **`LID: feats shape sent to ONNX`** 的 `featsShape`，应为 `[1, 60, T]`。
