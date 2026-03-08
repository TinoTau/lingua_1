# 运维与排错（部署 / 维护 / 故障排查 / 性能）

**服务**: semantic-repair-en-zh | **端口**: 5015

---

## 1. 部署前检查

- **环境**：Python 3.8+，pip；若用 GPU 需 CUDA 与 GPU 版 `llama-cpp-python`。
- **依赖**：`pip install -r requirements.txt`（fastapi、uvicorn、pydantic、llama-cpp-python 等）。
- **模型**：本目录下 `models/qwen2.5-3b-instruct-zh-gguf/*.gguf` 与 `models/qwen2.5-3b-instruct-en-gguf/*.gguf`；缺失时参考 [MODELS_SETUP_GUIDE.md](../MODELS_SETUP_GUIDE.md)。
- **端口**：5015 未被占用（如 Windows：`netstat -ano | findstr :5015`）。

### 启动与健康检查

```bash
cd electron_node/services/semantic_repair_en_zh
python service.py
# 预期：Service ready with 3 processor(s)，监听 5015

curl http://localhost:5015/health
# 预期：status: "healthy"，各 processors.*.status: "healthy"
```

### 快速 API 测试

```bash
# 中文修复
curl -X POST http://localhost:5015/zh/repair -H "Content-Type: application/json" -d "{\"job_id\":\"t1\",\"session_id\":\"s1\",\"text_in\":\"你号\"}"

# 英文修复
curl -X POST http://localhost:5015/en/repair -H "Content-Type: application/json" -d "{\"job_id\":\"t2\",\"session_id\":\"s1\",\"text_in\":\"helo\"}"

# 英文标准化
curl -X POST http://localhost:5015/en/normalize -H "Content-Type: application/json" -d "{\"job_id\":\"t3\",\"session_id\":\"s1\",\"text_in\":\"HELLO\"}"
```

---

## 2. 日常维护

- **状态**：通过节点端服务管理器或 `GET /health` 查看各处理器 `status`、`initialized`、`model_loaded`/`rules_loaded`。
- **重启**：由节点端 stop → 等待数秒 → start；或手动结束进程后重新 `python service.py`。
- **日志**：启动日志见控制台（如 `[Unified SR] Service ready...`）；请求日志格式 `[zh_repair] INPUT/OUTPUT/ERROR | request_id=...`。
- **模型**：模型在 `models/` 下；更新时先停服务 → 备份 → 替换 GGUF → 启动并跑上述 API 测试。
- **备份**：建议定期备份 `service.json`、`config.py` 及模型目录；配置或代码变更后备份一次。

---

## 3. 故障排查

### 服务无法启动

- **模型未找到**：确认 `models/.../` 下存在 `.gguf`；按 [MODELS_SETUP_GUIDE.md](../MODELS_SETUP_GUIDE.md) 安装或从旧服务复制。
- **端口占用**：更换进程或改 `PORT` 环境变量（不推荐，需与节点端一致）。
- **依赖缺失**：`ModuleNotFoundError` → `pip install -r requirements.txt`。

### GPU 未使用（响应很慢）

- **现象**：响应 >2s，CPU 高、GPU 利用率接近 0。
- **检查**：启动日志中是否出现 `assigned to device CUDA`；若为 `device CPU` 则未用 GPU。
- **处理**：安装 CUDA 版 llama-cpp-python，例如：
  ```bash
  pip uninstall llama-cpp-python -y
  pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121
  ```
  或从源码编译：`CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python --no-cache-dir`。
- **显存不足**：在 config 中将 `n_gpu_layers` 从 -1 改为较小值（如 20），或设为 0 使用 CPU。

### 503 / 处理器不可用

- **原因**：对应处理器未初始化或初始化失败。
- **操作**：查 `GET /health` 中该处理器 `status`；查启动日志是否有模型加载错误；确认模型路径与文件完整后重启。

### 请求超时

- **原因**：处理超过 30 秒（如 CPU 模式或首次冷启动）。
- **操作**：启用 GPU；或适当增大 `config.py` 中 `timeout`（如 60）；冷启动后会有预热，后续请求应加快。

### 422 校验错误

- **原因**：请求体缺少必填字段或类型不对（如缺少 `job_id`、`session_id`、`text_in`，或 `/repair` 缺少 `lang`）。
- **操作**：对照 [Reference.md](Reference.md) 中请求体格式修正。

---

## 4. 性能优化

- **启用 GPU**：最重要，通常可带来约 10 倍提速；确保安装 CUDA 版 llama-cpp-python 且日志显示 CUDA。
- **n_gpu_layers**：显存充足用 -1；不足则减小（如 24 或 20）；显存紧张可 0 用 CPU。
- **n_ctx**：短文本可改为 512/1024 以省显存、略提速；长文本保留 2048 或更大。
- **超时**：GPU 建议 30s；纯 CPU 可 60s。
- **仅用标准化**：若只需英文标准化，可 `ENABLE_ZH_REPAIR=false`、`ENABLE_EN_REPAIR=false`，减少启动时间与内存。

### 性能参考

| 场景 | GPU | CPU |
|------|-----|-----|
| 首次请求（含加载） | ~30s | ~30s |
| 后续 zh/en repair | 200–500ms | 2–4s |
| en/normalize | <10ms | <10ms |

---

## 5. 相关文档

- 本服务 [README](../README.md)、[MODELS_SETUP_GUIDE.md](../MODELS_SETUP_GUIDE.md)、[ASR_COMPATIBILITY.md](../ASR_COMPATIBILITY.md)。
- 架构/API/配置/引擎详见 [Reference.md](Reference.md)。
