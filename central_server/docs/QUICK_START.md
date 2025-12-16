# 中央服务器快速开始指南

## 启动顺序

建议按以下顺序启动服务：

1. **Model Hub** (模型库服务)
2. **Scheduler** (调度服务器)
3. **API Gateway** (API 网关)

## 启动服务

### 1. Model Hub (模型库服务)

```bash
cd central_server/model-hub
python -m venv venv
.\venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
python src/main.py
```

**默认端口**: 根据配置（通常在 8000 或 8080）

### 2. Scheduler (调度服务器)

**使用启动脚本（推荐）**:
```powershell
.\scripts\start_scheduler.ps1
```

**手动启动**:
```bash
cd central_server/scheduler
cargo build --release
cargo run --release
```

**默认端口**: 5010

**配置**: 编辑 `config.toml` 修改端口和其他设置

### 3. API Gateway (API 网关)

```bash
cd central_server/api-gateway
cargo build --release
cargo run --release
```

**默认端口**: 8081

**配置**: 编辑 `config.toml` 修改端口和调度服务器地址

## 运行测试

### Scheduler 测试

```bash
cd central_server/scheduler
cargo test                    # 运行所有测试
cargo test --test stage1_1   # 运行阶段 1.1 测试
cargo test --test stage3_2   # 运行阶段 3.2 测试
```

详细测试指南请参考 `../TEST_GUIDE.md`。

## 验证服务

### 检查 Scheduler

```bash
# 健康检查
curl http://localhost:5010/health

# WebSocket 连接测试
# 使用 WebSocket 客户端连接到 ws://localhost:5010/ws/session
```

### 检查 API Gateway

```bash
# 健康检查
curl http://localhost:8081/health

# API 测试（需要 API Key）
curl -X POST http://localhost:8081/v1/speech/translate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "audio=@audio.wav" \
  -F "src_lang=zh" \
  -F "tgt_lang=en"
```

### 检查 Model Hub

```bash
# 健康检查
curl http://localhost:8000/health

# 获取模型列表
curl http://localhost:8000/api/v1/models
```

## 配置说明

### Scheduler 配置

编辑 `central_server/scheduler/config.toml`:

```toml
[server]
port = 5010
host = "0.0.0.0"

[logging]
level = "info"
format = "pretty"  # 或 "json"
```

### API Gateway 配置

编辑 `central_server/api-gateway/config.toml`:

```toml
[server]
port = 8081
host = "0.0.0.0"

[scheduler]
url = "ws://localhost:5010/ws/session"
```

### Model Hub 配置

通过环境变量配置：

```bash
export MODELS_DIR="./models"
python src/main.py
```

## 日志

### Scheduler 日志

- **位置**: `central_server/scheduler/logs/scheduler.log`
- **格式**: 根据配置（pretty 或 json）
- **轮转**: 5MB，带时间戳后缀

### API Gateway 日志

输出到控制台，可以重定向到文件。

### Model Hub 日志

输出到控制台，可以重定向到文件。

## 故障排除

### 端口被占用

检查端口占用：
```powershell
# Windows
netstat -ano | findstr :5010
netstat -ano | findstr :8081

# Linux/Mac
lsof -i :5010
lsof -i :8081
```

### 依赖问题

**Rust 项目**:
```bash
cargo clean
cargo build
```

**Python 项目**:
```bash
pip install -r requirements.txt --upgrade
```

### 连接问题

确保服务按正确顺序启动，并且端口配置正确。

## 相关文档

- **项目完整性**: `../PROJECT_COMPLETENESS.md`
- **测试指南**: `../TEST_GUIDE.md`
- **文档索引**: `README.md`
