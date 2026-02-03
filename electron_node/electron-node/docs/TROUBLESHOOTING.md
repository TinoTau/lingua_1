# 故障排查

## 调度器连接（未连接 / 重连）

- UI 显示「未连接」表示与调度器 WebSocket 未建立或已断开。
- **行为**：节点会按指数退避重连（5s → 10s → 20s → … 上限 60s）；调度器启动或恢复后会自动连上。
- **配置**：调度地址仅来自 `electron-node-config.json` 的 `scheduler.url`，无硬编码。配置路径为 Electron userData（如 `%APPDATA%\lingua-electron-node\electron-node-config.json`）。
- **日志**：主进程日志在 `logs/electron-main.log` 或启动控制台。关键日志：`NodeAgent.start() 被调用`、`Connecting to scheduler...`、`Connected to scheduler server`、`WebSocket error` / `Connection closed`。
- **重连按钮**：点击 UI 上的重连会触发 `reconnect-node` IPC，重新执行 `NodeAgent.start()`。
- 若调度器重启报端口占用（如 10048），说明 `scheduler.url` 所用端口被占用，需先释放端口再启调度器。

详见同目录 `NODE_SCHEDULER_CONNECTION.md`。

## 高 CPU 占用

**启动阶段**：语义修复等服务首次加载大模型（如 2–4GB）时会有较高 CPU/IO，属正常；PyTorch 首次编译 CUDA kernels 时也会短暂升高。

**持续高占用**：  
- 语义修复：已通过 uvicorn `workers=1`、`model.eval()`、`torch.cuda.empty_cache()` 等降低；若仍高，可检查是否有后台轮询或重复加载。  
- 其他 Python 服务：确认未开多 workers 或重复进程。  

**验证**：可用 `python check_cpu_usage.py`（若服务提供）或任务管理器观察进程。

## 白屏 / 渲染进程报错

- 检查主进程是否正常启动、Vite 开发服务是否在运行（开发模式默认 5173，可设 `VITE_PORT`）。
- 查看控制台与 `logs/electron-main.log` 中的 IPC/import 错误；常见为 preload 或 API 未暴露。

## 服务启动失败 / 端口冲突

- 端口由配置或服务发现（`service.json`）决定，避免多实例同端口。  
- 日志中会有端口占用或服务启动失败信息；可查 `SERVICES_DIR` 下各服务的 `service.json` 与运行环境（Python/Rust 依赖、CUDA 等）。

## 日志位置

- 主进程：`logs/electron-main.log`（或启动时控制台输出的路径）。
- Rust 推理：见主进程配置/脚本中写入的 node-inference 日志路径。
- 各 Python 服务：见各服务目录下的日志配置。
