# 启动脚本使用指南

本文档说明如何使用各个启动脚本来进行联调。

---

## 📋 启动顺序

**推荐启动顺序**：

1. **模型库服务** (可选，如果使用模型库)
2. **M2M100 NMT 服务** (必需)
3. **Piper TTS 服务** (必需)
4. **节点推理服务** (必需)
5. **调度服务器** (必需)
6. **Web 客户端** (必需)

---

## 🚀 快速启动

### 方式一：一键启动所有服务

```powershell
.\scripts\start_all.ps1
```

这会启动所有后端服务（模型库、NMT、TTS、节点推理、调度服务器、API Gateway）。

### 方式二：分步启动（推荐用于联调）

#### 1. 启动 M2M100 NMT 服务

```powershell
.\scripts\start_nmt_service.ps1
```

**服务地址**: `http://127.0.0.1:5008`

#### 2. 启动 TTS 服务

**方式 A：启动所有 TTS 服务（推荐）**

```powershell
.\scripts\start_all_tts_services.ps1
```

这会同时启动：
- **Piper TTS** (端口 5006): 用于中文/常规 TTS
- **YourTTS** (端口 5004): 用于 zero-shot 音色克隆

**方式 B：单独启动**

启动 Piper TTS 服务：
```powershell
.\scripts\start_tts_service.ps1
```
**服务地址**: `http://127.0.0.1:5006`

启动 YourTTS 服务：
```powershell
.\scripts\start_yourtts_service.ps1
```
**服务地址**: `http://127.0.0.1:5004`

#### 3. 启动节点推理服务

```powershell
.\scripts\start_node_inference.ps1
```

**服务地址**: `http://127.0.0.1:5009`

**环境变量**（可选）:
- `MODELS_DIR`: 模型目录路径（默认: `node-inference\models`）
- `INFERENCE_SERVICE_PORT`: 服务端口（默认: `5009`）
- `NMT_SERVICE_URL`: NMT 服务地址（默认: `http://127.0.0.1:5008`）
- `TTS_SERVICE_URL`: TTS 服务地址（默认: `http://127.0.0.1:5006`）
- `LOG_FORMAT`: 日志格式（`pretty` 或 `json`，默认: `pretty`）

**示例**:
```powershell
$env:MODELS_DIR = "D:\models"
$env:LOG_FORMAT = "json"
.\scripts\start_node_inference.ps1
```

#### 4. 启动调度服务器

```powershell
.\scripts\start_scheduler.ps1
```

**服务地址**: `http://localhost:5010`
- WebSocket (会话): `ws://localhost:5010/ws/session`
- WebSocket (节点): `ws://localhost:5010/ws/node`

**环境变量**（可选）:
- `LOG_FORMAT`: 日志格式（`pretty` 或 `json`，默认: `pretty`）

**配置文件**: `scheduler/config.toml`

#### 5. 启动 Web 客户端

```powershell
.\scripts\start_web_client.ps1
```

**开发服务器**: `http://localhost:9001`

**环境变量**（可选）:
- `SCHEDULER_URL`: 调度服务器 WebSocket 地址（默认: `ws://localhost:5010/ws/session`）

**示例**:
```powershell
$env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/session"
.\scripts\start_web_client.ps1
```

---

## 🔧 环境变量配置

### 节点推理服务

```powershell
# 设置模型目录
$env:MODELS_DIR = "D:\lingua_models"

# 设置服务端口
$env:INFERENCE_SERVICE_PORT = "5009"

# 设置 NMT 服务地址
$env:NMT_SERVICE_URL = "http://127.0.0.1:5008"

# 设置 TTS 服务地址
$env:TTS_SERVICE_URL = "http://127.0.0.1:5006"

# 设置日志格式
$env:LOG_FORMAT = "pretty"  # 或 "json"
```

### 调度服务器

```powershell
# 设置日志格式
$env:LOG_FORMAT = "pretty"  # 或 "json"
```

### Web 客户端

```powershell
# 设置调度服务器地址
$env:SCHEDULER_URL = "ws://localhost:5010/ws/session"
```

---

## 📊 服务端口列表

| 服务 | 端口 | 协议 | 说明 |
|------|------|------|------|
| 模型库服务 | 5000 | HTTP | 可选 |
| M2M100 NMT | 5008 | HTTP | 必需 |
| Piper TTS | 5006 | HTTP | 必需 |
| 节点推理服务 | 5009 | HTTP | 必需 |
| 调度服务器 | 5010 | HTTP/WebSocket | 必需 |
| API Gateway | 8081 | HTTP/WebSocket | 可选 |
| Web 客户端 | 9001 | HTTP | 开发服务器 |

---

## ✅ 健康检查

### 检查 NMT 服务

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:5008/health" -Method Get
```

### 检查 TTS 服务

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:5006/health" -Method Get
```

### 检查节点推理服务

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:5009/health" -Method Get
```

### 检查调度服务器

```powershell
Invoke-WebRequest -Uri "http://localhost:5010/health" -Method Get
```

---

## 🐛 常见问题

### 1. 端口被占用

**错误**: `Address already in use`

**解决**:
- 检查是否有其他进程占用端口
- 修改配置文件或环境变量更改端口

### 2. 模型文件未找到

**错误**: `Model not found`

**解决**:
- 检查 `MODELS_DIR` 环境变量是否正确
- 确保模型文件已正确放置

### 3. 依赖服务未启动

**错误**: `Connection refused`

**解决**:
- 确保 NMT 和 TTS 服务已启动
- 检查服务地址是否正确

### 4. Web 客户端无法连接调度服务器

**错误**: `WebSocket connection failed`

**解决**:
- 检查调度服务器是否已启动
- 检查 `SCHEDULER_URL` 环境变量是否正确
- 检查防火墙设置

---

## 📝 日志格式

### Pretty 格式（开发调试）

默认使用 `pretty` 格式，便于阅读：

```
2025-01-XX 10:00:00 INFO 启动 Lingua 调度服务器...
2025-01-XX 10:00:01 INFO 配置加载成功: Config { ... }
```

### JSON 格式（生产环境）

设置 `LOG_FORMAT=json` 使用 JSON 格式：

```json
{"timestamp":"2025-01-XXT10:00:00Z","level":"INFO","message":"启动 Lingua 调度服务器..."}
```

---

## 🔗 相关文档

- [快速开始指南](../docs/GETTING_STARTED.md)
- [系统架构文档](../docs/ARCHITECTURE.md)
- [端到端测试指南](../docs/testing/END_TO_END_TESTING_GUIDE.md)

---

**最后更新**: 2025-01-XX

