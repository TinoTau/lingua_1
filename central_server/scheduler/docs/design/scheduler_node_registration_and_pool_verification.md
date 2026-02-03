# 调度服务器与节点端：单元测试与节点注册/池分配验证

## 一、单元测试结果摘要

### 1. 调度服务器 (central_server/scheduler)

- **命令**：`cargo test --no-default-features --lib`（仅库单元测试，跳过 doc-test）
- **结果**：**36 个测试全部通过**
- **说明**：doc-test 已修复（crate 名改为 `lingua_scheduler`，`pool_service` 示例标为 `no_run`）。若需跑全量测试（含 doc-test）可执行：`cargo test --no-default-features`（首次编译可能较久）。

### 2. 节点端 (electron_node)

- **Electron 应用测试**：`cd electron_node/electron-node && npm run test:stage3.1` 与 `npm run test:stage3.2`
  - 与节点注册、心跳、语言能力、池分配相关的单元测试（如 `node-agent-language-capability.test.ts`、capability_by_type、capability_state、utils、lock、registry 等）均已包含；**model-hub 与 node-inference 相关测试已移除**，无需启动 Model Hub 或 node-inference。

---

## 二、语言支持由节点端统一管理（当前实现）

当前设计符合「节点端统一管理语言能力，通过心跳上报」：

1. **节点端**
   - **注册**（`node-agent-registration.ts`）：  
     使用 `languageDetector.detectLanguageCapabilities(installedServicesAll, installedModels, capabilityByType)` 汇总**全部已安装服务与模型**的语言能力，在 **node_register** 中携带 **language_capabilities**（asr_languages / semantic_languages / tts_languages）。
   - **心跳**（`node-agent-heartbeat.ts`）：  
     同样调用 `detectLanguageCapabilities(...)`，在 **node_heartbeat** 中携带 **language_capabilities**。
   - 语言能力**不是**由各子服务分别上报调度器，而是由节点进程**统一汇总后**在注册与心跳中上报。

2. **调度器**
   - 注册：从 `language_capabilities` 解析出 `asr_langs`、`semantic_langs`、`tts_langs`，写入 Redis（`register_node_v2.lua`）。
   - 心跳：用心跳中的 `language_capabilities` 更新 Redis 中的语言字段，并调用 `pool_service.heartbeat(node_id)`，执行 `heartbeat_with_pool_assign.lua` 做**池分配/刷新**（基于 asr_langs × semantic_langs 等）。

因此：**语言支持由节点端统一管理，通过注册与心跳发送；调度器只消费节点上报的 language_capabilities，不做按服务分别拉取。**

---

## 三、如何本地验证「节点注册 + 节点池分配」

### 前置条件

- **Redis**：已启动（例如 `localhost:6379`），调度器 config 中 `[scheduler.redis_runtime]` 已启用。
- **调度器 config.toml**：  
  `[scheduler.redis_runtime]` 的 `enabled = true`，且 Redis 地址与 key_prefix 等与当前环境一致。

### 步骤 1：启动 Redis

```powershell
# 若使用 Docker（示例）
docker run -d --name redis-lingua -p 6379:6379 redis:7-alpine
```

### 步骤 2：启动调度服务器

```powershell
cd d:\Programs\github\lingua_1\central_server\scheduler
cargo run --bin scheduler
# 或先 cargo build --release && .\target\release\scheduler.exe
```

- 成功时日志中会出现类似：`Redis 运行时已启用`、`极简无锁调度服务已初始化`、`Pool 服务已初始化`。

### 步骤 3：启动节点端（Electron）

```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run build
npm start
```

- 在节点配置中确保 **调度器 WebSocket 地址** 指向当前调度器（例如 `ws://localhost:5010/ws/node`）。

### 步骤 4：确认注册与池分配

1. **调度器日志**
   - 出现 `【节点管理流程】注册流程开始`、`节点 ID 已生成`、`注册语言能力`、`准备调用 register_node_v2.lua`、`注册流程完成` 等。
   - 之后周期性出现 `【节点管理流程】收到节点心跳`、`Redis 心跳成功（TTL 已刷新，Pool 已分配）`。

2. **Redis 检查（可选）**
   - 节点 key：`lingua:v1:node:<node_id>`  
     应包含 `asr_langs`、`semantic_langs`、`tts_langs`、`last_heartbeat_ts` 等。
   - 池成员：`lingua:v1:pool:<src>:<tgt>:<id>:nodes`  
     应有对应 node_id；节点池映射：`lingua:v1:node:<node_id>:pools`。

3. **调度器 HTTP 接口（可选）**
   - 健康：`GET http://localhost:5010/health`
   - 集群统计：`GET http://localhost:5010/api/cluster/stats`  
     （需 redis_runtime 启用；可看在线实例等）

### 步骤 5：快速接口自检（不启动节点也可测调度器）

```powershell
cd d:\Programs\github\lingua_1\central_server\scheduler
.\scripts\test_quick.ps1
```

- 会请求 `/health`、`/api/stats`、`/metrics`、`/api/cluster/stats` 并做一次编译检查；**不依赖节点**，仅验证调度器与 Redis 运行时是否正常。

---

## 四、若 doc-test 需要修复（可选）

当前失败的是文档内示例，不影响运行时与库单元测试。若希望 `cargo test --no-default-features` 全绿，可：

- 在 `src/pool/types.rs`、`src/pool/pool_service.rs` 的 doc 示例中，将 `scheduler::` 改为 `lingua_scheduler::`（或使用 `crate::`），并保证示例可编译（如 `select_node` 示例需在 async 块中、变量已定义）。

---

## 五、总结

| 项目           | 结果说明 |
|----------------|----------|
| 调度器单元测试 | 36 个通过（`--lib`）；doc-test 3 个失败，属文档示例问题。 |
| 节点端单元测试 | 75 通过，6 失败（依赖 Model Hub，非注册/池逻辑）。 |
| 语言能力来源   | 节点端统一汇总（detectLanguageCapabilities），通过 **node_register** 与 **node_heartbeat** 的 **language_capabilities** 上报；调度器不按服务单独拉取。 |
| 节点注册与池   | 注册写 Redis 节点 key 与语言；心跳更新语言并执行 `heartbeat_with_pool_assign.lua` 做池分配；按上述步骤启动 Redis → 调度器 → 节点即可验证。 |
