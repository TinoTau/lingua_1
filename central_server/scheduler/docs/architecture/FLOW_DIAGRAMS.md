# 节点管理和任务管理流程图

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-11
- **用途**: 可视化展示节点管理和任务管理流程
- **格式**: Mermaid 流程图

---

## 一、节点注册流程

### 1.1 流程图

```mermaid
sequenceDiagram
    participant Node as 节点
    participant WS as WebSocket Handler
    participant Handler as handle_node_register<br/>【已废弃】
    participant Service as MinimalSchedulerService
    participant Lua as register_node.lua
    participant Redis as Redis

    Node->>WS: NodeMessage::Register
    WS->>Handler: handle_message()
    Note over Handler: ⚠️ 已废弃，临时返回 Ok(())
    Handler-->>WS: Ok(())
    
    Note over WS,Service: 【待迁移】新实现
    WS->>Service: register_node(req)
    Service->>Lua: EVAL register_node.lua
    Lua->>Redis: HSET scheduler:node:info:{node_id}
    Lua->>Redis: HSET scheduler:node:runtime:{node_id}
    Lua->>Redis: SADD scheduler:pool:{pool_id}:members
    Redis-->>Lua: OK
    Lua-->>Service: "OK"
    Service-->>WS: Ok(())
    WS-->>Node: 注册成功
```

### 1.2 方法调用链

```mermaid
graph TD
    A[WebSocket 收到消息] --> B[handle_message]
    B --> C[handle_node_register<br/>⚠️ 已废弃]
    C --> D[MinimalSchedulerService::register_node<br/>✅ 新实现]
    D --> E[eval_script]
    E --> F[register_node.lua]
    F --> G[Redis 原子操作]
    
    style C fill:#ffcccc
    style D fill:#ccffcc
    style F fill:#ccccff
```

---

## 二、节点心跳流程

### 2.1 流程图

```mermaid
sequenceDiagram
    participant Node as 节点
    participant WS as WebSocket Handler
    participant Handler as handle_node_heartbeat<br/>【已废弃】
    participant Service as MinimalSchedulerService
    participant Lua as heartbeat.lua
    participant Redis as Redis

    Node->>WS: NodeMessage::Heartbeat<br/>(定期发送)
    WS->>Handler: handle_message()
    Note over Handler: ⚠️ 已废弃，临时返回
    Handler-->>WS: 返回
    
    Note over WS,Service: 【待迁移】新实现
    WS->>Service: heartbeat(req)
    Service->>Lua: EVAL heartbeat.lua
    Lua->>Redis: HSET scheduler:node:info:{node_id}<br/>online, last_heartbeat_ts, load_json
    Redis-->>Lua: OK
    Lua-->>Service: "OK"
    Service-->>WS: Ok(())
```

### 2.2 方法调用链

```mermaid
graph TD
    A[WebSocket 收到心跳] --> B[handle_message]
    B --> C[handle_node_heartbeat<br/>⚠️ 已废弃]
    C --> D[MinimalSchedulerService::heartbeat<br/>✅ 新实现]
    D --> E[eval_script]
    E --> F[heartbeat.lua]
    F --> G[Redis 原子操作]
    
    style C fill:#ffcccc
    style D fill:#ccffcc
    style F fill:#ccccff
```

---

## 三、任务调度流程

### 3.1 流程图

```mermaid
sequenceDiagram
    participant Session as Session Actor
    participant Finalize as try_finalize
    participant JobCreator as create_translation_jobs
    participant Dispatcher as JobDispatcher::create_job<br/>【已废弃】
    participant Service as MinimalSchedulerService
    participant Lua as dispatch_task.lua
    participant Redis as Redis

    Session->>Finalize: 检查需要 finalize<br/>(pause/timeout/is_final)
    Finalize->>JobCreator: do_finalize()
    JobCreator->>Dispatcher: create_job(...)
    Note over Dispatcher: ⚠️ 已废弃，返回 todo!()
    Dispatcher-->>JobCreator: todo!()
    
    Note over JobCreator,Service: 【待迁移】新实现
    JobCreator->>Service: dispatch_task(req)
    Service->>Lua: EVAL dispatch_task.lua
    Lua->>Redis: HGET scheduler:session:{session_id}
    Lua->>Redis: HGET scheduler:lang:{src}:{tgt}
    Lua->>Redis: SMEMBERS scheduler:pool:{pool_id}:members
    loop 选择可用节点
        Lua->>Redis: HGET scheduler:node:info:{node_id}
        Lua->>Redis: HGET scheduler:node:runtime:{node_id}
    end
    Lua->>Redis: HINCRBY scheduler:node:runtime:{node_id}<br/>current_jobs 1
    Lua->>Redis: INCR scheduler:job:id_seq
    Lua->>Redis: HSET scheduler:job:{job_id}
    Redis-->>Lua: {node_id, job_id}
    Lua-->>Service: {node_id, job_id}
    Service-->>JobCreator: DispatchResponse
    JobCreator-->>Session: 任务创建成功
```

### 3.2 方法调用链

```mermaid
graph TD
    A[SessionActor::handle_audio_chunk] --> B[try_finalize]
    B --> C[do_finalize]
    C --> D[create_translation_jobs]
    D --> E[JobDispatcher::create_job<br/>⚠️ 已废弃]
    E --> F[MinimalSchedulerService::dispatch_task<br/>✅ 新实现]
    F --> G[eval_script]
    G --> H[dispatch_task.lua]
    H --> I[Redis 原子操作:<br/>Pool选择/节点选择/任务创建]
    
    style E fill:#ffcccc
    style F fill:#ccffcc
    style H fill:#ccccff
```

---

## 四、任务完成流程

### 4.1 流程图

```mermaid
sequenceDiagram
    participant Node as 节点
    participant WS as WebSocket Handler
    participant Processor as process_job_result
    participant Service as MinimalSchedulerService
    participant Lua as complete_task.lua
    participant Redis as Redis

    Node->>WS: NodeMessage::JobResult<br/>(任务完成)
    WS->>Processor: handle_message()
    Processor->>Processor: 去重检查
    Processor->>Processor: 验证任务状态
    Processor->>Processor: 添加到结果队列
    
    Note over Processor,Service: 【待迁移】新实现
    Processor->>Service: complete_task(req)
    Service->>Lua: EVAL complete_task.lua
    Lua->>Redis: HGET scheduler:job:{job_id}<br/>node_id
    alt 节点 ID 不匹配
        Lua-->>Service: {err, "NODE_MISMATCH"}
        Service-->>Processor: Error
    else 节点 ID 匹配
        Lua->>Redis: HSET scheduler:job:{job_id}<br/>status "finished"
        Lua->>Redis: HINCRBY scheduler:node:runtime:{node_id}<br/>current_jobs -1
        Redis-->>Lua: OK
        Lua-->>Service: "OK"
        Service-->>Processor: Ok(())
    end
```

### 4.2 方法调用链

```mermaid
graph TD
    A[WebSocket 收到 JobResult] --> B[handle_message]
    B --> C[process_job_result]
    C --> D[去重检查]
    C --> E[验证任务状态]
    C --> F[MinimalSchedulerService::complete_task<br/>✅ 新实现]
    F --> G[eval_script]
    G --> H[complete_task.lua]
    H --> I{节点 ID 校验}
    I -->|匹配| J[更新任务状态]
    I -->|不匹配| K[返回错误]
    J --> L[释放节点并发槽]
    
    style F fill:#ccffcc
    style H fill:#ccccff
```

---

## 五、完整流程（端到端）

### 5.1 完整流程图

```mermaid
sequenceDiagram
    participant Node1 as 节点 1
    participant Node2 as 节点 2
    participant WS as WebSocket Handler
    participant Service as MinimalSchedulerService
    participant Redis as Redis
    participant Session as Session Actor

    Note over Node1,Redis: 节点管理
    Node1->>WS: Register
    WS->>Service: register_node()
    Service->>Redis: Lua: 注册节点
    Redis-->>Service: OK
    Service-->>Node1: 注册成功
    
    Node1->>WS: Heartbeat (定期)
    WS->>Service: heartbeat()
    Service->>Redis: Lua: 更新心跳
    Redis-->>Service: OK
    
    Note over Session,Redis: 任务管理
    Session->>Service: dispatch_task()
    Service->>Redis: Lua: 选择节点并创建任务
    Redis-->>Service: {node_id, job_id}
    Service-->>Session: DispatchResponse
    Session->>Node2: 分配任务
    
    Note over Node2,Redis: 任务完成
    Node2->>WS: JobResult
    WS->>Service: complete_task()
    Service->>Redis: Lua: 更新状态并释放槽位
    Redis-->>Service: OK
    Service-->>WS: 完成成功
```

---

## 六、Redis 数据结构关系图

### 6.1 数据结构关系

```mermaid
erDiagram
    NODE_INFO ||--|| NODE_RUNTIME : "1:1"
    NODE_INFO ||--o{ POOL_MEMBERS : "1:N"
    NODE_INFO ||--o{ LANG_INDEX : "N:M"
    LANG_INDEX ||--o{ POOL_MEMBERS : "N:1"
    POOL_MEMBERS ||--o{ JOB : "N:M"
    SESSION ||--o{ JOB : "1:N"
    
    NODE_INFO {
        string node_id PK
        string online
        string cap_json
        string max_jobs
        string last_heartbeat_ts
    }
    
    NODE_RUNTIME {
        string node_id PK
        string current_jobs
    }
    
    POOL_MEMBERS {
        string pool_id PK
        set node_ids
    }
    
    LANG_INDEX {
        string src_lang PK
        string tgt_lang PK
        string pools_json
    }
    
    JOB {
        string job_id PK
        string node_id FK
        string session_id FK
        string status
    }
    
    SESSION {
        string session_id PK
        string preferred_pool
    }
```

---

## 七、并发处理流程

### 7.1 并发任务调度

```mermaid
sequenceDiagram
    participant S1 as Session 1
    participant S2 as Session 2
    participant Service as MinimalSchedulerService
    participant Lua as dispatch_task.lua
    participant Redis as Redis

    par 并发任务调度
        S1->>Service: dispatch_task()
        and
        S2->>Service: dispatch_task()
    end
    
    Service->>Lua: EVAL dispatch_task.lua (S1)
    Service->>Lua: EVAL dispatch_task.lua (S2)
    
    Note over Lua: 原子操作保证并发安全
    
    par Redis 原子操作
        Lua->>Redis: 选择节点并占用槽位 (S1)
        and
        Lua->>Redis: 选择节点并占用槽位 (S2)
    end
    
    Redis-->>Lua: {node1, job1} (S1)
    Redis-->>Lua: {node2, job2} (S2)
    Lua-->>Service: 返回结果
    Service-->>S1: DispatchResponse
    Service-->>S2: DispatchResponse
```

---

## 八、错误处理流程

### 8.1 任务调度错误

```mermaid
flowchart TD
    A[dispatch_task] --> B[执行 Lua 脚本]
    B --> C{检查会话绑定}
    C -->|不存在| D{检查语言索引}
    C -->|存在| E[使用 preferred_pool]
    D -->|不存在| F[返回错误:<br/>NO_POOL_FOR_LANG_PAIR]
    D -->|存在| G[选择 Pool]
    E --> H[获取 Pool 成员]
    G --> H
    H --> I{Pool 是否为空?}
    I -->|是| J[返回错误:<br/>EMPTY_POOL]
    I -->|否| K[选择可用节点]
    K --> L{找到可用节点?}
    L -->|否| M[返回错误:<br/>NO_AVAILABLE_NODE]
    L -->|是| N[占用并发槽]
    N --> O[创建任务记录]
    O --> P[返回成功:<br/>{node_id, job_id}]
    
    style F fill:#ffcccc
    style J fill:#ffcccc
    style M fill:#ffcccc
    style P fill:#ccffcc
```

### 8.2 任务完成错误

```mermaid
flowchart TD
    A[complete_task] --> B[执行 Lua 脚本]
    B --> C[读取任务记录]
    C --> D{任务是否存在?}
    D -->|否| E[返回错误]
    D -->|是| F{节点 ID 匹配?}
    F -->|否| G[返回错误:<br/>NODE_MISMATCH]
    F -->|是| H[更新任务状态]
    H --> I[释放节点并发槽]
    I --> J[返回成功: OK]
    
    style G fill:#ffcccc
    style J fill:#ccffcc
```

---

## 九、状态转换图

### 9.1 节点状态转换

```mermaid
stateDiagram-v2
    [*] --> 未注册: 节点启动
    未注册 --> 已注册: register_node()
    已注册 --> 在线: 心跳更新
    在线 --> 离线: 心跳超时
    离线 --> 在线: 心跳更新
    已注册 --> [*]: 节点下线
    
    note right of 已注册
        scheduler:node:info:{node_id}
        online: "true"
    end note
    
    note right of 在线
        scheduler:node:info:{node_id}
        online: "true"
        last_heartbeat_ts: 更新时间戳
    end note
    
    note right of 离线
        scheduler:node:info:{node_id}
        online: "false"
        或 TTL 过期
    end note
```

### 9.2 任务状态转换

```mermaid
stateDiagram-v2
    [*] --> 已创建: dispatch_task()
    已创建 --> 已完成: complete_task(status="finished")
    已创建 --> 已失败: complete_task(status="failed")
    已完成 --> [*]: TTL 过期
    已失败 --> [*]: TTL 过期
    
    note right of 已创建
        scheduler:job:{job_id}
        status: "created"
        node_id: 分配的节点
    end note
    
    note right of 已完成
        scheduler:job:{job_id}
        status: "finished"
        节点并发槽已释放
    end note
    
    note right of 已失败
        scheduler:job:{job_id}
        status: "failed"
        节点并发槽已释放
    end note
```

---

## 十、性能特征

### 10.1 操作复杂度

| 操作 | 时间复杂度 | Redis 调用次数 | Lua 脚本 |
|------|-----------|---------------|---------|
| 节点注册 | O(1) | 1 | ✅ |
| 节点心跳 | O(1) | 1 | ✅ |
| 任务调度 | O(N) | 1 | ✅ (N = Pool 节点数) |
| 任务完成 | O(1) | 1 | ✅ |

### 10.2 并发性能

- **节点注册**: ✅ 支持并发，Lua 脚本保证原子性
- **节点心跳**: ✅ 支持并发，Lua 脚本保证原子性
- **任务调度**: ✅ 支持并发，Lua 脚本保证节点并发槽正确占用
- **任务完成**: ✅ 支持并发，Lua 脚本保证节点并发槽正确释放

---

## 十一、关键代码位置索引

### 11.1 节点管理

| 功能 | 文件路径 | 行号 | 状态 |
|------|---------|------|------|
| WebSocket 消息处理 | `src/websocket/node_handler/message/mod.rs` | 42, 73 | ✅ |
| 节点注册（旧） | `src/websocket/node_handler/message/register.rs` | 10 | ⚠️ 已废弃 |
| 节点心跳（旧） | `src/websocket/node_handler/message/register.rs` | 55 | ⚠️ 已废弃 |
| 节点注册（新） | `src/services/minimal_scheduler.rs` | 125 | ✅ |
| 节点心跳（新） | `src/services/minimal_scheduler.rs` | 155 | ✅ |

### 11.2 任务管理

| 功能 | 文件路径 | 行号 | 状态 |
|------|---------|------|------|
| 任务创建入口 | `src/websocket/session_actor/actor/actor_finalize.rs` | 85 | ✅ |
| 任务创建 | `src/websocket/job_creator.rs` | 10 | ✅ |
| 任务调度（旧） | `src/core/dispatcher/job_creation.rs` | 17 | ⚠️ 已废弃 |
| 任务调度（新） | `src/services/minimal_scheduler.rs` | 180 | ✅ |
| 任务完成（新） | `src/services/minimal_scheduler.rs` | 256 | ✅ |
| 任务结果处理 | `src/websocket/node_handler/message/job_result/job_result_processing.rs` | - | ✅ |

### 11.3 Lua 脚本

| 功能 | 文件路径 | 状态 |
|------|---------|------|
| 节点注册 | `scripts/lua/register_node.lua` | ✅ |
| 节点心跳 | `scripts/lua/heartbeat.lua` | ✅ |
| 任务调度 | `scripts/lua/dispatch_task.lua` | ✅ |
| 任务完成 | `scripts/lua/complete_task.lua` | ✅ |

---

**文档版本**: v1.0  
**最后更新**: 2026-01-11  
**状态**: ✅ 流程图已完成
