# 产品启动脚本使用指南

本文档说明如何使用三个产品的启动脚本。

## 三个产品

1. **Web 客户端 (Web App)** - `start_webapp.ps1`
2. **中央服务器 (Central Server)** - `start_central_server.ps1`
3. **Electron 节点客户端 (Electron Node)** - `start_electron_node.ps1`

---

## 🚀 快速启动

### 1. Web 客户端

```powershell
.\scripts\start_webapp.ps1
```

**功能**:
- 启动 Web 客户端开发服务器
- 服务地址: `http://localhost:9001`
- 默认连接调度服务器: `ws://localhost:5010/ws/session`

**配置**:
- 可通过环境变量 `SCHEDULER_URL` 配置调度服务器地址
- 示例: `$env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/session"`

**日志**:
- 日志文件: `webapp/web-client/logs/web-client_<timestamp>.log`

---

### 2. 中央服务器

```powershell
# 仅启动调度服务器（默认）
.\scripts\start_central_server.ps1

# 启动所有服务
.\scripts\start_central_server.ps1 --all

# 启动指定服务
.\scripts\start_central_server.ps1 --scheduler --api-gateway
```

**功能**:
- 调度服务器 (Scheduler): 默认启动，端口 5010
- API 网关 (API Gateway): 可选，端口 8081
- 模型库服务 (Model Hub): 可选，端口 5000

**参数**:
- `--all`: 启动所有服务
- `--scheduler`: 启动调度服务器
- `--api-gateway`: 启动 API 网关
- `--model-hub`: 启动模型库服务
- `--no-scheduler`: 不启动调度服务器
- `--no-api-gateway`: 不启动 API 网关
- `--no-model-hub`: 不启动模型库服务

**服务管理**:
- 查看服务状态: `Get-Job`
- 查看服务输出: `Receive-Job -Id <JobId>`
- 停止所有服务: `Get-Job | Stop-Job; Get-Job | Remove-Job`

**日志**:
- 调度服务器: `central_server/scheduler/logs/scheduler.log`
- API 网关: `central_server/api-gateway/logs/api-gateway.log`
- 模型库服务: `central_server/model-hub/logs/model-hub.log`

---

### 3. Electron 节点客户端

```powershell
.\scripts\start_electron_node.ps1
```

**功能**:
- 启动 Electron 桌面应用
- 自动管理节点推理服务（Rust）
- 自动管理 Python 服务（NMT、TTS、YourTTS）
- 连接到调度服务器

**配置**:
- 可通过环境变量 `SCHEDULER_URL` 配置调度服务器地址
- 示例: `$env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/node"`

**前置条件**:
- Node.js 18+ 已安装
- npm 已安装
- 依赖已安装（首次运行会自动安装）
- 主进程和渲染进程已编译（首次运行会自动编译）

**日志**:
- 主进程日志: `electron_node/electron-node/logs/electron-main_<timestamp>.log`
- 各服务日志: 在各自服务目录的 `logs/` 子目录

---

## 📋 完整启动流程

### 开发环境启动顺序

1. **启动中央服务器**（调度服务器）
   ```powershell
   .\scripts\start_central_server.ps1
   ```

2. **启动 Electron 节点客户端**（提供算力）
   ```powershell
   .\scripts\start_electron_node.ps1
   ```

3. **启动 Web 客户端**（用户界面）
   ```powershell
   .\scripts\start_webapp.ps1
   ```

### 生产环境启动顺序

1. **启动中央服务器**（所有服务）
   ```powershell
   .\scripts\start_central_server.ps1 --all
   ```

2. **启动 Electron 节点客户端**（每个节点）
   ```powershell
   .\scripts\start_electron_node.ps1
   ```

3. **启动 Web 客户端**（可选，如果使用 Web 界面）
   ```powershell
   .\scripts\start_webapp.ps1
   ```

---

## 🔧 环境变量配置

### Web 客户端

```powershell
# 配置调度服务器地址
$env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/session"
.\scripts\start_webapp.ps1
```

### Electron 节点客户端

```powershell
# 配置调度服务器地址
$env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/node"
.\scripts\start_electron_node.ps1
```

### 中央服务器

```powershell
# 配置日志格式
$env:LOG_FORMAT = "json"
.\scripts\start_central_server.ps1
```

---

## 📝 注意事项

1. **端口占用**: 确保以下端口未被占用
   - 9001: Web 客户端
   - 5010: 调度服务器
   - 8081: API 网关（如果启用）
   - 5000: 模型库服务（如果启用）

2. **依赖安装**: 首次运行会自动安装依赖，可能需要几分钟

3. **编译**: Electron 节点客户端首次运行会自动编译主进程和渲染进程

4. **服务顺序**: 建议先启动中央服务器，再启动节点客户端，最后启动 Web 客户端

5. **日志文件**: 所有服务的日志文件都会自动创建，带时间戳

---

## 🐛 故障排除

### Web 客户端无法连接调度服务器

- 检查调度服务器是否已启动
- 检查 `SCHEDULER_URL` 环境变量是否正确
- 检查防火墙设置

### Electron 节点客户端无法启动

- 检查 Node.js 和 npm 是否已安装
- 检查依赖是否已正确安装
- 查看日志文件获取详细错误信息

### 中央服务器服务启动失败

- 检查 Rust/Cargo 是否已安装（调度服务器和 API 网关）
- 检查 Python 是否已安装（模型库服务）
- 检查端口是否被占用
- 查看日志文件获取详细错误信息

---

## 📚 相关文档

- **详细启动指南**: `README_STARTUP.md`
- **Web 客户端文档**: `../webapp/docs/README.md`
- **中央服务器文档**: `../central_server/docs/README.md`
- **Electron 节点客户端文档**: `../electron_node/docs/README.md`
