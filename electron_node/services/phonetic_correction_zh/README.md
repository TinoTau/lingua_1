# 中文同音纠错服务 (phonetic_correction_zh)

独立 HTTP 服务：对**简体中文**文本做同音/近音纠错（KenLM + 同音混淆集选优）。  
默认端口 **5016**。

## 依赖

- Python 3.10+
- KenLM 模型：`models/zh_char_3gram.trie.bin`（见 `models/README.md`）

## 安装与启动

```bash
cd electron_node/services/phonetic_correction_zh
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
# 将 zh_char_3gram.trie.bin 放入 models/
python service.py
```

## API

- **GET /health**  
  返回 `status`: `healthy`（有模型）或 `degraded`（无模型，纠错仍返回原文）。

- **POST /correct**  
  Body: `{ "text_in": "简体中文句子" }`  
  返回: `{ "text_out": "纠错后句子", "process_time_ms": 0.12 }`

## 与语义修复服务的关系

合并语义修复服务（semantic_repair_en_zh，端口 5015）可选调用本服务：  
在配置中设置 `phonetic_service_url`（如 `http://127.0.0.1:5016`）后，中文修复流程为：繁→简 → **调用本服务纠错** → LLM 语义修复。  
不配置或服务不可用时，语义修复仅做繁→简 + LLM。
