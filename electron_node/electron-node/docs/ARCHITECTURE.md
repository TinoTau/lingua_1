# 节点端架构说明

本文档描述 `electron-node` 的架构要点，以当前代码为准。详细实现见 `main/src/` 对应模块。

## 1. 整体划分

- **主进程**：`main/src/` — 窗口、NodeAgent、服务/模型管理、IPC
- **渲染进程**：`renderer/src/` — React UI，通过 `window.electronAPI` 调用主进程
- **共享协议**：`shared/protocols/messages.ts` — JobAssign、JobResult 等消息类型

## 2. 服务发现与单例（Single Source of Truth）

- **ServiceDiscovery** 扫描 `services/` 目录，读取各服务下的 `service.json`，构建 **ServiceRegistry**（Map）
- **ServiceRegistrySingleton** 持有唯一 Registry 实例；`setServiceRegistry()` / `getServiceRegistry()` 供全局使用
- **ServiceProcessRunner**、NodeAgent、IPC handlers 均从同一 Registry 读写，无重复数据源、无补丁式状态

数据流概览：

```
ServiceDiscovery.scanServices() → ServiceRegistrySingleton → ServiceProcessRunner / IPC / UI
```

## 3. 节点能力上报（与调度器对接）

- 能力以**有向语言对**上报：`asr_languages`、`tts_languages`、`semantic_languages`（Semantic 为必需）
- 调度端按 `(src, tgt)` 池化节点；节点端在必需服务就绪后才上报，能力变化时重连
- 实现见 `main/src/agent/node-agent-*.ts`、`language-capability/`

## 4. 生命周期与启动

- 应用就绪后：加载配置 → 初始化 ServiceRegistry（扫描 services）→ 注册 IPC → 启动 NodeAgent（连接 Scheduler）
- 服务启停通过 **ServiceProcessRunner** 执行，状态写回 Registry，UI 与 IPC 仅消费 Registry
- 开发模式：主进程依赖 Vite Dev Server（默认 5173），可通过 `VITE_PORT` 覆盖

## 5. 配置与路径

- **配置**：`electron-node-config.json`（userData）或环境变量；优先级：配置文件 > 环境变量 > 默认值
- **服务目录**：`SERVICES_DIR` 或开发时向上查找含 `services/installed.json` 的 `services/`，生产默认 `userData/services`
- **模型目录**：默认 `userData/models`，可由 `USER_DATA` 覆盖
- **日志**：主进程 `logs/electron-main.log`（见 `main/src/logger.ts`）

## 6. Aggregator（聚合中间件）

- 位于 **NodeAgent** 与 **JobResult** 发送之间：`InferenceService.processJob()` 产出结果后，经 **AggregatorMiddleware** 处理再发送
- 功能：ASR 文本聚合、去重、边界重建（Text Incompleteness + Language Gate 等）
- 实现：`main/src/agent/aggregator-middleware.ts`、`main/src/aggregator/`
- 详细设计见同目录 `AGGREGATOR.md`

## 7. GPU 与推理服务

- **Rust 推理服务**（node-inference）：主进程通过子进程/HTTP 调用；端口、模型路径等见配置与 `main/src/inference/`
- **GPU**：由 gpu-arbiter 等模块管理占用与分配；语义修复/TTS 等 Python 服务可单独配置 CUDA/workers
- 各子服务（NMT、TTS、VAD、语义修复等）见 `electron_node/services/` 下各自文档

---

*文档合并自原 `docs/architecture` 与 `docs/electron_node` 中与当前代码一致的部分；若与代码冲突以代码为准。*
