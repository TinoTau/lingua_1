# Lexicon V2 CPU Intent 模型目录

将 **GGUF Instruct** 模型放在此目录（仅 CPU 推理，默认 `n_gpu_layers=0`）。

## 推荐文件名（默认配置会优先查找）

```
qwen2.5-3b-instruct-q4_k_m.gguf
```

## 备选

- 任意其他 `*.gguf`（若 canonical 文件名不存在，会自动扫描本目录）

## 配置

节点配置 `features.lexiconV2.cpuWorker.modelPath`（相对 `electron-node/` 工作目录）：

```json
{
  "features": {
    "lexiconV2": {
      "enabled": true,
      "intentMode": "cpu_llm",
      "cpuWorker": {
        "modelPath": "models/lexicon-intent/qwen2.5-3b-instruct-q4_k_m.gguf",
        "serviceUrl": "http://127.0.0.1:5018"
      }
    }
  }
}
```

## 注意

- `.gguf` 文件已被 gitignore，需本地下载
- 启动 `lexicon_intent_cpu` 服务（端口 5018）后，`GET /health` 应显示 `model_loaded: true`
