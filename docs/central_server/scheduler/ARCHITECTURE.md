# Scheduler 架构文档

**状态**: ✅ **当前实现**

## 概述

Scheduler（调度服务器）是 Lingua 系统的核心组件，负责管理节点注册、任务分发、会话管理、结果队列等核心功能。

## 核心模块

### 1. Core（核心模块）

#### 1.1 AppState（应用状态）

**文件**: `src/core/app_state.rs`

**职责**: 管理全局应用状态，包含所有管理器和服务

**主要组件**:
- SessionManager: 会话管理
- JobDispatcher: 任务分发器
- NodeRegistry: 节点注册表
- 各种 Manager（Connection、ResultQueue、AudioBuffer 等）

#### 1.2 Config（配置管理）

**文件**: `src/core/config.rs`

**职责**: 加载和管理配置

**配置项**:
- 服务器配置（host、port）
- 调度器配置（最大并发任务、超时时间、负载均衡策略）
- 节点健康检查配置
- Phase 2/3 配置
- 模型中心配置

#### 1.3 Dispatcher（任务分发器）

**文件**: `src/core/dispatcher.rs`

**职责**: 任务分发和节点选择

**功能**:
- 节点选择（基于功能、资源、负载）
- 任务绑定和幂等性
- Phase 2/3 支持

#### 1.4 Session（会话管理）

**文件**: `src/core/session.rs`

**职责**: 会话生命周期管理

**功能**:
- 会话创建和销毁
- 会话状态维护
- 会话查询

#### 1.5 JobIdempotency（任务幂等性）

**文件**: `src/core/job_idempotency.rs`

**职责**: 防止重复创建任务

**功能**:
- 生成 Job Key（基于 tenant_id、session_id、utterance_index 等）
- 检查任务是否已存在
- 任务去重

#### 1.6 JobResultDeduplicator（结果去重）

**文件**: `src/core/job_result_deduplicator.rs`

**职责**: 防止重复处理任务结果

**功能**:
- 按 session_id 和 job_id 去重
- 30秒 TTL 保留期
- 自动清理过期记录

---

### 2. Managers（管理器模块）

#### 2.1 AudioBufferManager（音频缓冲管理器）

**文件**: `src/managers/audio_buffer.rs`

**职责**: 管理会话的音频缓冲区

**功能**:
- 音频块累积
- 音频时长计算
- 缓冲区清理

#### 2.2 ConnectionManager（连接管理器）

**文件**: `src/managers/connection_manager.rs`

**职责**: 管理 WebSocket 连接

**类型**:
- SessionConnectionManager: 会话连接管理
- NodeConnectionManager: 节点连接管理

**功能**:
- 连接注册和注销
- 消息发送
- 连接状态跟踪

#### 2.3 GroupManager（组管理器）

**文件**: `src/managers/group_manager.rs`

**职责**: 管理 Utterance Group（话语组）

**功能**:
- Group 创建和归属判断
- 上下文拼接
- Group 超时管理

#### 2.4 NodeStatusManager（节点状态管理器）

**文件**: `src/managers/node_status_manager.rs`

**职责**: 管理节点健康状态

**功能**:
- 定期扫描节点状态
- 心跳超时检测
- 节点状态转换（warmup → ready → unavailable）

#### 2.5 ResultQueueManager（结果队列管理器）

**文件**: `src/managers/result_queue.rs`

**职责**: 管理会话结果队列，保证顺序

**功能**:
- 结果按 utterance_index 排序
- Gap 检测和补位机制
- 超时处理

#### 2.6 RoomManager（房间管理器）

**文件**: `src/managers/room_manager.rs`

**职责**: 管理会议室模式

**功能**:
- 房间创建和加入
- 成员管理
- 房间过期清理（30分钟无人发言）

---

### 3. NodeRegistry（节点注册表）

**文件**: `src/node_registry/`

**职责**: 节点注册、选择和管理

**核心功能**:
- 节点注册和心跳
- 节点选择（功能匹配、负载均衡、资源过滤）
- Phase 3 两级调度（pool 选择 + 节点选择）
- 节点能力状态管理

**子模块**:
- `core.rs`: 核心节点管理
- `selection.rs`: 节点选择逻辑
- `validation.rs`: 节点验证（功能、资源）
- `phase3_core_cache.rs`: Phase 3 核心服务缓存
- `phase3_pool.rs`: Phase 3 Pool 管理
- `reserved.rs`: 节点预留机制
- `unavailable.rs`: 不可用节点管理

---

### 4. WebSocket 处理

#### 4.1 SessionHandler（会话处理器）

**文件**: `src/websocket/session_handler.rs`

**职责**: 处理会话 WebSocket 连接

**功能**:
- 连接建立和关闭
- 消息路由到 SessionActor
- SessionActor 生命周期管理

#### 4.4 SessionMessageHandler（会话消息处理器）

**文件**: `src/websocket/session_message_handler/`

**职责**: 处理会话消息（在 SessionHandler 中调用）

**消息类型**:
- `session_init`: 会话初始化
- `audio_chunk`: 音频块
- `utterance`: 完整话语
- `client_heartbeat`: 客户端心跳
- `tts_play_ended`: TTS 播放结束
- `session_close`: 会话关闭
- `room_create/join/leave`: 房间管理
- `room_raw_voice_preference`: 原声传递偏好
- `webrtc_offer/answer/ice`: WebRTC 信令

#### 4.2 SessionActor（会话 Actor）

**文件**: `src/websocket/session_actor/actor.rs`

**职责**: 单写者模式处理会话内所有事件

**功能**:
- 音频块处理
- Finalize 处理（手动/自动/异常）
- 任务创建和分发
- 背压控制（最大200个待处理事件）
- 空闲超时管理（60秒）
- 暂停超时检测
- 最大音频时长限制

**Finalize 类型**:
- Manual: 手动截断（is_final=true）
- Auto: 自动 finalize（pause/timeout）
- Exception: 异常保护（MaxLength）

**状态管理**:
- 音频缓冲累积
- Utterance 索引跟踪
- Timer 管理（pause timer、timeout timer）
- 边界稳态化（EDGE-1）

#### 4.3 NodeHandler（节点处理器）

**文件**: `src/websocket/node_handler/`

**职责**: 处理节点 WebSocket 连接

**功能**:
- 节点注册
- 心跳处理
- 任务分配
- 任务结果接收
- 任务进度更新（JobProgress）

**消息处理**:
- `register`: 节点注册
- `heartbeat`: 心跳
- `job_result`: 任务结果
- `job_progress`: 任务进度
- `misc`: 其他消息

#### 4.5 JobCreator（任务创建器）

**文件**: `src/websocket/job_creator.rs`

**职责**: 创建翻译任务

**功能**:
- 根据功能需求创建任务链（ASR → NMT → TTS）
- 模块依赖展开
- 任务ID生成
- 任务绑定和幂等性检查

---

### 5. Phase 2（多实例支持）

**文件**: `src/phase2/`

**职责**: 支持多实例部署和 Redis 状态外置

**核心功能**:
- Redis 连接管理
- Presence 维护（实例在线状态）
- Streams 消息队列（inbox/DLQ）
- 分布式锁
- 会话绑定外置

**关键组件**:
- `redis_handle.rs`: Redis 操作封装
- `runtime_streams.rs`: Streams 队列管理
- `runtime_routing.rs`: 消息路由
- `runtime_job_fsm.rs`: Job 状态机

---

### 6. Phase 3（两级调度）

**文件**: `src/phase3.rs`, `src/node_registry/phase3_*.rs`

**职责**: 实现两级调度（Pool 选择 + 节点选择）

**核心功能**:
- Pool 划分（基于 hash 或 capability）
- Pool 内节点选择
- 核心服务缓存（快速跳过）
- Pool 统计和监控

**API 端点**:
- `/api/v1/phase3/pools`: 查看 Pool 状态
- `/api/v1/phase3/simulate`: 模拟节点选择

---

### 7. Metrics（指标和监控）

**文件**: `src/metrics/`

**职责**: 系统指标收集和监控

**组件**:
- `metrics.rs`: 核心指标收集
- `prometheus_metrics.rs`: Prometheus 指标导出
- `dashboard_snapshot.rs`: Dashboard 快照缓存
- `stats.rs`: 统计信息
- `observability.rs`: 可观测性（锁等待、关键路径）

**API 端点**:
- `/api/v1/stats`: 统计信息（JSON）
- `/api/v1/metrics`: 指标信息（JSON）
- `/metrics`: Prometheus 格式指标

---

### 8. Timeout（超时管理）

**文件**: `src/timeout/job_timeout.rs`

**职责**: 任务超时和重派管理

**功能**:
- 任务超时检测
- 自动重派（failover）
- Best-effort 取消

---

### 9. ModelNotAvailable（模型不可用处理）

**文件**: `src/model_not_available/`

**职责**: 处理模型不可用事件

**功能**:
- 事件入队（主路径不阻塞）
- 后台处理（去抖、限流）
- 节点标记和恢复

---

### 10. Services（服务模块）

**文件**: `src/services/`

**组件**:
- `model_hub.rs`: 模型中心服务（HTTP 客户端）
- `pairing.rs`: 配对服务（配对码管理）
- `service_catalog.rs`: 服务目录缓存（从 ModelHub 获取，本地兜底）

### 11. Utils（工具模块）

**文件**: `src/utils/`

**组件**:
- `logging_config.rs`: 日志配置（模块级日志开关）
- `module_resolver.rs`: 模块依赖解析器（模块依赖展开、模型需求收集）

---

## API 端点

### WebSocket

- `/ws/session`: 会话 WebSocket 连接
- `/ws/node`: 节点 WebSocket 连接

### HTTP API

- `/health`: 健康检查
- `/api/v1/stats`: 统计信息
- `/api/v1/metrics`: 指标信息
- `/api/v1/phase3/pools`: Phase 3 Pool 状态
- `/api/v1/phase3/simulate`: Phase 3 节点选择模拟
- `/api/v1/cluster`: 集群统计（Phase 2）
- `/metrics`: Prometheus 指标

### Dashboard 页面

- `/dashboard`: 主 Dashboard
- `/cluster`: 集群监控（Phase 2）
- `/compute-power`: 算力统计
- `/models`: 模型统计
- `/languages`: 语言统计

---

## 后台任务

### 1. Job 超时检查

- 定期检查任务超时
- 自动重派超时任务
- Best-effort 取消原任务

### 2. 结果队列超时检查

- 每1秒检查一次
- 检测结果 Gap 超时
- 生成 Missing 结果

### 3. 房间过期清理

- 每1分钟扫描一次
- 清理30分钟无人发言的房间
- 通知房间成员

### 4. Dashboard 快照刷新

- 每5秒刷新一次
- 缓存统计信息
- 减少主路径开销

### 5. 服务目录缓存刷新

- 定期从 ModelHub 刷新
- 本地 services_index.json 兜底

### 6. JobResult 去重清理

- 每30秒清理一次
- 移除过期记录

### 7. Phase 2 后台任务

- Presence 续约
- Owner 续约
- Streams inbox 处理

---

## 配置项

主要配置项包括：

- **调度器配置**: 最大并发任务、超时时间、心跳间隔
- **负载均衡**: 策略（least_connections）、资源阈值（25%）
- **节点健康**: 心跳超时、健康检查次数、预热超时
- **Web任务分段**: 暂停阈值（2000ms）、最大时长（30000ms）
- **可观测性**: 锁等待警告阈值、关键路径警告阈值
- **核心服务**: ASR/NMT/TTS 服务ID映射
- **Phase 2**: Redis URL、key前缀、实例ID
- **Phase 3**: Pool数量、hash种子、fallback策略
- **模型不可用**: 去抖时间、限流策略
- **任务绑定**: 预留TTL

详细配置请参考 `config.toml` 文件。

---

## 相关文档

- [任务分发优化方案](./DISPATCHER_OPTIMIZATION_PLAN.md)
- [Dashboard 说明](./DASHBOARD.md)
- [GPU 要求说明](./GPU_REQUIREMENT_EXPLANATION.md)
- [Scheduler 扩展与容量规划](../project/SCHEDULER_CAPACITY_AND_SCALING.md)
- [Phase 2 实现文档](../../scheduler/docs/phase2_implementation.md)

---

**最后更新**: 2025-01-XX

