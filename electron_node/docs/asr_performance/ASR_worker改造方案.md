````markdown
# NODE_ASR_DISTRIBUTED_REDESIGN_SEMANTIC_CENTRIC.md  
分布式节点端 ASR 架构重设计（以语义修复为中心）

版本：2026-01-21  
面向：调度服务器 / 节点端 / ASR Worker 开发与维护人员  

---

## 1. 设计背景与目标

### 1.1 当前约束与现状

- 系统为 **分布式节点设计**：调度服务器会将来自 Web 端的音频任务分配给多个节点。
- 调度目前是**随机分配**或近似随机负载均衡。  
- 业务侧要求：  
  - **跨 job 合并非常常见**，需要在会话粒度做 ASR 结果的连续优化与语义修复。  
  - 语义修复是翻译/识别质量的核心环节。

在现状下：
- 同一个会话的任务可能被分配到不同节点；
- 上下文如果放在单个节点或单个 Worker 内，容易丢失或难以维护；
- ASR Worker 长时间运行后存在性能退化风险（长命进程不可控）。

### 1.2 本次重设计目标

在“不考虑兼容、没有线上用户、优先保证代码简洁易懂”的前提下，本次重设计的目标是：

1. **以语义修复为中心**，保证会话级连续性和语义一致性；
2. 通过 **调度层的会话粘性** 保证同一会话的任务尽量落在同一节点；
3. 在 **节点内维护会话上下文**，实现跨 job 合并逻辑；
4. 将 ASR Worker 设计为 **无跨请求状态 + 有明确寿命** 的纯执行器；
5. 用简单、可读的架构设计替代复杂补丁和临时监控。

---

## 2. 高层架构概览

重设计后的整体结构：

```text
Web Client
    │
    │  (session_id, audio_chunk)
    ▼
Scheduler
    │  ① 会话粘性：session_id → node_id
    │
    ▼
Node (per node process)
    ├─ SessionContextStore (per-session 上下文，含语义修复所需信息)
    ├─ Node ASR Frontend (接调度请求，做上下文合并/切分)
    └─ ASR Worker Pool (多进程，无状态 + 有寿命)
            └─ Whisper / Semantic-centric ASR pipeline
````

关键设计点：

* **Scheduler**：不再纯随机，而是对每个 `session_id` 做“粘到某个 node”的映射；
* **Node**：负责管理 `SessionContext`，执行跨 job 合并与语义修复前/后的上下文维护；
* **Worker**：只处理「音频 + 可选提示 → 当前 job 的局部识别结果」，不存会话状态。

---

## 3. Scheduler 调度伪代码（会话级粘性）

### 3.1 核心数据结构

```pseudo
// 会话到节点的映射表，保存在调度服务器内存
session_node_map: Map<SessionId, NodeId>

// 节点健康信息（可选）
node_status: Map<NodeId, NodeHealth>  // NodeHealth: { alive: bool, load: number, ... }
```

### 3.2 调度主流程

```pseudo
function handle_incoming_job(session_id: string, audio_chunk: AudioData, meta: JobMeta):
    // 1. 按会话分配节点（会话粘性）
    node_id = find_or_assign_node_for_session(session_id)

    // 2. 构造发送给节点的任务载荷
    job_payload = {
        session_id: session_id,
        audio: audio_chunk,
        meta: meta  // 包含语言信息、时间戳等
    }

    // 3. 将任务推送给选定节点
    send_job_to_node(node_id, job_payload)
```

### 3.3 节点选择逻辑

```pseudo
function find_or_assign_node_for_session(session_id: string) -> NodeId:
    if session_node_map.contains(session_id):
        node_id = session_node_map[session_id]
        if is_node_alive(node_id):
            return node_id
        else:
            // 节点宕机，清理映射，重新分配
            session_node_map.remove(session_id)

    // 走到这里，说明是新会话或原节点不可用
    node_id = pick_node_by_policy()  // 可以是轮询、最小负载等简单策略

    session_node_map[session_id] = node_id
    return node_id

function is_node_alive(node_id: NodeId) -> bool:
    status = node_status.get(node_id)
    return status != null && status.alive == true

function pick_node_by_policy() -> NodeId:
    // 不用复杂策略，初期可以简单轮询或随机
    return pick_random_alive_node()
```

说明：

* 会话首次出现时，随机分配一个节点并绑定；
* 后续该会话所有 job 都发往同一节点；
* 当节点不可用时，清理映射，让会话“重新绑定”。

---

## 4. Node 的 SessionContext 接口设计

### 4.1 目标

Node 内要维护一个**会话级上下文存储**，用于：

* 聚合同一会话的多条 ASR 结果；
* 支持语义修复服务进行上下文感知；
* 控制哪些文本已经“final”，哪些仍处于“pending 合并”状态。

### 4.2 TypeScript 接口定义（示意）

```ts
// 单次 ASR 结果的最小单元
export interface AsrSegment {
  text: string;
  startSec: number;
  endSec: number;
  confidence?: number;
}

// 会话级上下文
export interface SessionContext {
  sessionId: string;

  // 已确认的文本（可直接用于翻译或展示）
  finalizedText: string;

  // 当前聚合中的“未完全确认”片段
  pendingSegments: AsrSegment[];

  // 上一次 ASR 的最终时间戳（便于新段对齐）
  lastEndSec?: number;

  // 最近一次更新时间（Unix 时间戳 ms）
  updatedAt: number;

  // 与语义修复相关的元信息（可选）
  semanticMeta?: {
    lastRepairedText?: string;
    language?: string;   // 例如 'zh', 'en'
  };
}

// Node 内存中的上下文存储
export interface SessionContextStore {
  get(sessionId: string): SessionContext | undefined;
  upsert(ctx: SessionContext): void;
  remove(sessionId: string): void;
  cleanupExpired(nowMs: number): void;
}
```

示例实现（简化）：

```ts
export class InMemorySessionContextStore implements SessionContextStore {
  private store = new Map<string, SessionContext>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 30 * 60 * 1000) { // 30 分钟
    this.ttlMs = ttlMs;
  }

  get(sessionId: string): SessionContext | undefined {
    return this.store.get(sessionId);
  }

  upsert(ctx: SessionContext): void {
    ctx.updatedAt = Date.now();
    this.store.set(ctx.sessionId, ctx);
  }

  remove(sessionId: string): void {
    this.store.delete(sessionId);
  }

  cleanupExpired(nowMs: number = Date.now()): void {
    for (const [sessionId, ctx] of this.store.entries()) {
      if (nowMs - ctx.updatedAt > this.ttlMs) {
        this.store.delete(sessionId);
      }
    }
  }
}
```

### 4.3 Node 内处理一个 ASR job 的逻辑

伪代码：

```ts
async function handleAsrJobFromScheduler(payload: AsrJobPayload) {
  const { sessionId, audio, meta } = payload;

  // 1. 取会话上下文
  let ctx = ctxStore.get(sessionId);
  if (!ctx) {
    ctx = {
      sessionId,
      finalizedText: "",
      pendingSegments: [],
      updatedAt: Date.now()
    };
  }

  // 2. 构造发给 Worker 的请求
  const workerReq: AsrWorkerRequest = {
    sessionId,
    audio,
    // 为 Worker 提供可选提示（例如：拼接已有 finalizedText 或 pending 文本）
    prompt: buildPromptFromContext(ctx),
    language: meta.language
  };

  // 3. 调用 Worker
  const workerResp = await asrWorkerPool.invoke(workerReq);

  // 4. Node 内合并本次结果与上下文
  const updatedCtx = mergeWorkerResultIntoContext(ctx, workerResp);

  // 5. 写回上下文存储
  ctxStore.upsert(updatedCtx);

  // 6. 返回给调度端 / Web 端需要的部分（如新产生的 final 文本）
  return {
    sessionId,
    finalizedTextDelta: extractNewFinalText(ctx, updatedCtx),
    pendingPreview: buildPendingPreview(updatedCtx)
  };
}
```

合并逻辑中，可以调用语义修复服务（semantic repair）对文本进行调整，关键是：
**语义修复依赖的上下文都在 `SessionContext` 中，不在 Worker 内。**

---

## 5. ASR Worker 请求 / 响应结构定义

Worker 的职责应尽量简单：

> 接收「音频 + 可选语义提示」，输出该 job 对应的识别结果（文本 + 分段）。

### 5.1 请求结构：`AsrWorkerRequest`

```jsonc
{
  "session_id": "string",          // 会话 ID，用于日志追踪（不用于状态）
  "audio": "<base64-encoded PCM>", // or binary payload
  "sample_rate": 16000,
  "language": "zh",                // 输入语言（可选）
  "prompt": "string | null",       // 来自 Node 的语义提示（finalizedText / pending 片段拼成）
  "options": {
    "max_new_tokens": 256,         // 可选，初期可固定
    "beam_size": 5,                // 可选，初期可固定
    "temperature": 0.0             // 可选
  }
}
```

Worker 不维护 `session_id → context` 映射，只把 `prompt` 当作一次性的提示信息。

### 5.2 响应结构：`AsrWorkerResponse`

```jsonc
{
  "session_id": "string",
  "request_id": "string",   // Node 生成的 trace id
  "segments": [
    {
      "text": "string",
      "start_sec": 0.00,
      "end_sec": 1.23,
      "confidence": 0.98
    }
  ],
  "raw_text": "string",     // segments 拼接文本
  "model_info": {
    "name": "whisper-large-v3",
    "language": "zh"
  },
  "timing": {
    "t_decode_ms": 100,
    "t_transcribe_ms": 4800,
    "t_segments_list_ms": 800,
    "t_total_ms": 5900
  }
}
```

说明：

* Worker 不做任何 final/pending 判定；
* 不做跨 job 合并；
* 只负责把当前音频翻译成一组 segments；
* 语义修复可以在 Worker 内部或 Node 调用外部服务，但上下文均由 Node 传入。

---

## 6. 对现有代码的改造 Task List（按组件拆分）

### 6.1 Scheduler 侧改造任务

**文件范围：** 调度服务（Scheduler Service）

1. **添加 `session_node_map`：**

   * [ ] 定义 `Map<SessionId, NodeId>` 存储；
   * [ ] 初始化时加载空表；重启即可清空，无需持久化。
2. **实现 `find_or_assign_node_for_session(session_id)`：**

   * [ ] 检查已有映射；
   * [ ] 判断节点是否健康；
   * [ ] 不健康则删除映射并重新选择节点；
   * [ ] 新会话按简单策略（随机/轮询）选择节点并写入映射。
3. **请求处理改造：**

   * [ ] 在接收 Web job 时，要求带 `session_id`；
   * [ ] 调用 `find_or_assign_node_for_session`，确定 `node_id`；
   * [ ] 将 `{session_id, audio, meta}` 转发到该节点。
4. **节点下线处理：**

   * [ ] 在 Node 心跳检测中加入 `alive: boolean` 状态；
   * [ ] 当 Node 被标记为 down 时，清理所有 `session_node_map` 中指向该 Node 的键（可批处理或定期清理）。

---

### 6.2 Node 主进程改造任务

**文件范围：** 节点进程主代码（Electron 主进程 / Node backend 部分）

1. **引入 `SessionContextStore`：**

   * [ ] 定义 `SessionContext` / `SessionContextStore` 接口；
   * [ ] 实现 `InMemorySessionContextStore`，支持 `get / upsert / remove / cleanupExpired`；
   * [ ] 在 Node 启动时初始化一个全局实例。
2. **改造 ASR Job 入口：**

   * [ ] 将当前接收到的 job 按 `{sessionId, audio, meta}` 形式处理；
   * [ ] 在处理函数中先从 `SessionContextStore` 获取/创建上下文；
   * [ ] 构造 `AsrWorkerRequest` 时填入 `prompt`（基于上下文构造）；
   * [ ] 调用 Worker，并将响应合并回 `SessionContext`；
   * [ ] 将新的 `SessionContext` 写回存储。
3. **合并逻辑与语义修复调用：**

   * [ ] 实现 `mergeWorkerResultIntoContext(ctx, workerResp)`，以最简单可解释的方式合并 segments；
   * [ ] 如需语义修复，在此函数中统一调用，不在 Worker 内维护状态；
   * [ ] 保持逻辑清晰：

     * 现有 finalizedText + new segments → new finalizedText + pendingSegments。
4. **过期清理（可选）：**

   * [ ] 定时调用 `SessionContextStore.cleanupExpired()`，清理长时间不活跃的会话。

---

### 6.3 Worker 进程改造任务

**文件范围：** ASR Worker / Whisper 服务

1. **API 层：**

   * [ ] 调整 HTTP/IPC 接口，使之接收 `AsrWorkerRequest`、返回 `AsrWorkerResponse`；
   * [ ] 移除与 session map / 全局 context 相关的逻辑；
   * [ ] 保留 `session_id` 仅用于日志追踪。
2. **生命周期管理：**

   * [ ] 引入 `MAX_JOBS_PER_WORKER`（例如 50）；
   * [ ] 在主循环中计数，每处理一个 job +1，超过上限后正常退出；
   * [ ] Node 负责检测退出并重启新 Worker。
3. **内部状态精简：**

   * [ ] 确认模型加载（WhisperModel）只在 Worker 启动时进行一次；
   * [ ] 不维护任何 `sessionId → context` 的映射；
   * [ ] 不缓存 pending results/past segments（这些移交给 Node）。
4. **日志与诊断（保持简单）：**

   * [ ] 保留 `t_transcribe`, `t_segments_list`, `t_total` 的日志输出；
   * [ ] 不构建复杂监控系统，只作为离线排查依据。

---

### 6.4 合同与测试

1. **契约定义：**

   * [ ] 把 `AsrWorkerRequest` / `AsrWorkerResponse` / `SessionContext` 等结构集中写入一个 `contracts` 文件（TypeScript 或 JSON schema）；
   * [ ] Scheduler / Node / Worker 均引用同一路径的定义。
2. **基本集成测试：**

   * [ ] 单节点、单会话：连续多条音频 → 确认上下文正确合并；
   * [ ] 多会话：不同 sessionId 应被粘到不同 Node / 不互相污染；
   * [ ] Worker 寿命：处理超过 `MAX_JOBS_PER_WORKER` 后进程退出，并被 Node 成功重启；新 Worker 不影响已有 SessionContext。

---

## 7. 总结

本重设计方案通过以下几个核心决策，让分布式节点 ASR 在“语义修复为核心”的前提下保持结构简单、易于排查：

1. **Scheduler 以会话为中心进行节点粘性分配**，避免上下文在节点间漂移；
2. **Node 内维护 SessionContext**，承担所有会话级合并与语义修复上下文管理；
3. **ASR Worker 无跨请求状态 + 有有限寿命**，只专注当前 job 的 ASR 推理；
4. 借助清晰的接口定义和局部化逻辑，使任何问题都能在有限的文件和函数范围内定位，而无需依赖复杂补丁或监控系统。

在没有兼容性和存量用户压力的情况下，这一方案是当前阶段最“干净”和可演进的架构路径。

```
```
