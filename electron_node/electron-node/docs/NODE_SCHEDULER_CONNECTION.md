# 节点端「未连接调度服务器」排查说明

节点端 UI 显示「未连接」表示与调度服务器的 WebSocket 未建立或已断开。

## 推荐行为（已实现）

- **节点先于调度器启动**：节点会持续尝试连接，采用指数退避（5s → 10s → 20s → … 上限 60s）；调度器启动后，下一次重试即可连上，连上后退避间隔重置为 5s。
- **调度器重启**：连接断开后，节点会自动按上述退避间隔重连，无需用户操作；连上后恢复正常。
- **进程不退出**：连接失败或断开仅打日志并重试，不会导致节点进程退出。

## 1. 确认调度服务器已启动并监听

- 节点连接地址 **仅来自配置**（见下），代码中无硬编码。常见部署下调度器监听端口为 **5010**，对应 URL 为 `ws://127.0.0.1:5010/ws/node`（若你改了端口或主机，以配置为准）。
- 若调度器在本机：先确认配置里 `scheduler.url` 中的端口有进程在监听（如 `netstat -ano | findstr 5010` 或任务管理器）。
- 若调度器在远程：确认防火墙/安全组放行对应端口，且节点配置中的 URL 与调度器实际地址一致。

## 2. 确认节点端使用的调度 URL（无硬编码）

- 节点只从 **electron-node-config.json** 读取调度地址：`scheduler.url`。未配置时使用内置默认（典型 `ws://127.0.0.1:5010/ws/node`）。localhost 在 getSchedulerUrl() 中规范为 127.0.0.1。
- 配置路径：Electron `userData` 目录（如 `%APPDATA%\lingua-electron-node\electron-node-config.json`）。修改端口或远程调度器时改 `scheduler.url` 即可。

## 3. 看主进程日志（排查「无反应」必看）

**日志位置**：启动节点端时控制台会打印 `[Logger] Log file: ...`，或直接看项目根下 `logs/electron-main.log`。用终端 `npm start` 时，主进程日志也会打在终端。

**按顺序看这几条，可判断问题出在哪一环：**

| 日志内容 | 含义 |
|----------|------|
| `NodeAgent.start() 被调用（自动连接调度器）` | 自动连接流程已执行，NodeAgent 存在 |
| `NodeAgent 未创建，无法连接调度器` | 初始化未创建 NodeAgent，不会自动连 |
| `Connecting to scheduler...` | 正在发起 WebSocket 连接 |
| `Connected to scheduler server` | 已连上调度器 |
| `WebSocket error` / `Connection to scheduler server closed` | 连接失败或断开（如 ECONNREFUSED 表示调度器未开） |
| `reconnect-node IPC 被调用` | **点击「未连接」后**，主进程收到了重连请求 |
| `reconnect-node: NodeAgent 未初始化` | 点击时 NodeAgent 仍为 null，重连不会执行 |
| `reconnect-node: 已执行 stop + start` | 重连逻辑已执行，连接由 WebSocket 异步结果决定 |

- 若**自动连接**无反应：看是否出现 `NodeAgent.start() 被调用` 和 `Connecting to scheduler...`；若没有，说明启动链未执行到 NodeAgent.start()。
- 若**点击重连**无反应：看是否出现 `reconnect-node IPC 被调用`；若没有，说明点击未到达主进程（渲染进程或 preload 问题）。

## 4. 使用「重连」按钮

- UI 上点击「未连接」旁的**重连**（或点击未连接状态区域），会调用 `reconnect-node` IPC，重新执行一次 `NodeAgent.start()`。
- 若之前缺少 `reconnect-node` 的 IPC 注册，重连会无效；当前已在 `index-ipc.ts` 中注册该 handler，重连会真正触发再次连接。

## 5. 调度器「重启失败」：端口已被占用

若重启调度器时出现 **「通常每个套接字地址(协议/网络地址/端口)只允许使用一次」(os error 10048)**，说明 **配置中 scheduler.url 使用的端口（常见为 5010）已被占用**，新启动的调度器进程并未真正监听，节点会一直 ECONNREFUSED。

**处理步骤：**

1. 从 `electron-node-config.json` 的 `scheduler.url` 中确认端口（如 5010），执行 `netstat -ano | findstr <端口>`，记下最后一列 PID。
2. 结束该进程：`taskkill /PID <PID> /F`（或任务管理器中结束对应进程）。
3. 再启动调度器：`cargo run --release --bin scheduler`（在 `central_server/scheduler` 目录下）。

确认调度器启动日志中有「服务器监听地址」且无报错后，节点端会自动或手动重连即可连上。

## 6. 常见原因小结

| 现象 | 可能原因 |
|------|----------|
| 一直未连接 | 调度服务器未启动，或配置中的 `scheduler.url` 端口与调度器实际监听端口不一致 |
| 一直未连接 | 调度器「重启」时端口被占用，新进程未绑定成功（见上文第 5 节） |
| 一直未连接 | 节点配置里 `scheduler.url`（或环境变量 `SCHEDULER_URL`）与调度器地址/端口不一致；或 **未重新构建 main**（修改代码后必须执行 `npm run build:main` 再 `npm start`，否则 dist 中仍是旧代码，可能连到 IPv6 ::1） |
| 曾连接后断开 | 调度器重启或崩溃，节点会按指数退避自动重连（5s → 10s → … 上限 60s） |
| 点击重连无反应 | 旧版本缺少 `reconnect-node` handler，需更新到包含该 IPC 的版本 |

按上述顺序检查：**先确认配置中 `scheduler.url` 的端口有且仅有一个调度器在监听** → 节点配置 URL 正确 → 看主进程日志确认报错 → 必要时点击重连或重启节点端。

---

## 7. 确认调度器是否成功生成节点池（按语言最大公约数分配）

节点连上调度器后，**节点池**在**首次有效心跳**时生成并分配，池按**有向语言对**（如 zh:en、en:zh）组织；语言能力由节点端按**各服务支持语言的最大公约数（交集）**计算后上报，调度器只存储并使用，不重复计算。

### 7.1 最大公约数（谁算、谁用）

- **节点端**：用所有**已运行服务**支持的语言求交集，得到 `asr_languages` / `semantic_languages` / `tts_languages`（三者当前实现为同一交集），在注册和心跳的 `language_capabilities` 里上报。
- **调度器**：只接收并写入 Redis（`asr_langs`、`semantic_langs`、`tts_langs`）；池分配时用 **asr_langs × semantic_langs** 生成有向语言对，把节点加入对应池。因此「按语言种类的最大公约数分配」体现在：池只使用节点上报的、已为交集的 asr/semantic 列表。

### 7.2 池何时生成、如何分配

- **注册**：只写入节点信息和语言到 Redis，并打日志「Pool 将在首次心跳时分配」。
- **心跳**：若 `asr_langs` 与 `semantic_langs` 均非空，则先更新 Redis 中的语言，再执行 Lua `heartbeat_with_pool_assign.lua`：  
  - 为该节点生成所有有向对 `(src ∈ asr_langs, tgt ∈ semantic_langs)`；  
  - 对每个有向对（如 zh:en）找一个未满的池（pool_id 0..MAX_POOL_ID），把节点 SADD 进该池，并记录 `node:pools` 映射；  
  - 刷新节点 key 的 TTL（被动清理未心跳节点）。

### 7.3 调度器侧要看的日志（确认池已分配）

在**调度器**日志（如运行 `cargo run --release --bin scheduler` 的终端或配置的日志输出）中按顺序看：

| 日志内容 | 含义 |
|----------|------|
| `【节点管理流程】注册流程开始` → … → `register_complete`（…Pool 将在首次心跳时分配） | 节点注册成功，池尚未分配 |
| `【节点管理流程】收到节点心跳` | 收到该节点的心跳 |
| `【节点管理流程】Redis 心跳成功（TTL 已刷新，节点池已分配）` | **池已成功分配**（Lua 返回 `OK:n_pairs`） |
| `【节点管理流程】Redis 心跳失败` | 心跳或池分配失败，需看后续 `error=`（如 `ERROR:NODE_NOT_REGISTERED`、`ERROR:MISSING_LANG_CAPABILITIES`、`ERROR:NO_DIRECTED_PAIRS`） |

若能看到某节点在心跳后出现 **「Redis 心跳成功（TTL 已刷新，节点池已分配）」**，即表示调度器已成功为该节点生成/更新节点池，并按该节点上报的 asr×semantic 有向语言对分配到了对应池。

### 7.4 可选：用 Redis 验证池与节点映射

- 节点所属池的映射：`HGETALL lingua:v1:node:<node_id>:pools`（得到若干 `pair_key -> pool_id`）。
- 某有向对的某池内节点：`SMEMBERS lingua:v1:pool:<pair_key>:<pool_id>:nodes`（如 `lingua:v1:pool:zh:en:0:nodes`）。
