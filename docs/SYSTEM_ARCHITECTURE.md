# Lingua 系统架构设计文档

## 系统概述

Lingua 是一个分布式实时语音翻译系统，采用客户端-调度服务器-节点端的三层架构，支持实时语音识别（ASR）、机器翻译（NMT）和语音合成（TTS）。

## 整体架构

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  Web Client │ ◄─────► │   Scheduler  │ ◄─────► │    Node     │
│  (前端)     │         │  (调度服务器) │         │  (节点端)   │
└─────────────┘         └──────────────┘         └─────────────┘
     │                        │                        │
     │                        │                        │
     └────────────────────────┴────────────────────────┘
                    Redis (可选，多实例支持)
```

## Web 客户端架构

### 核心模块

#### 1. **App (主应用类)**
- **职责**：整合所有模块，协调各组件工作
- **功能**：
  - 状态管理（通过 StateMachine）
  - 音频处理流程控制
  - 会话管理（单向/双向模式）
  - 房间管理（会议室模式）
  - WebRTC 连接管理

#### 2. **StateMachine (状态机)**
- **职责**：管理应用状态转换
- **状态**：
  - `INPUT_READY`: 准备就绪
  - `INPUT_RECORDING`: 正在录音
  - `OUTPUT_PLAYING`: 正在播放
  - `SESSION_ACTIVE`: 会话激活

#### 3. **Recorder (录音模块)**
- **职责**：音频采集和静音检测
- **功能**：
  - 麦克风权限请求
  - 音频流采集（16kHz, 单声道）
  - 实时静音检测
  - 音频帧回调

#### 4. **WebSocketClient (WebSocket 客户端)**
- **职责**：与调度服务器通信
- **功能**：
  - WebSocket 连接管理
  - 音频块发送（PCM16, base64 编码）
  - 服务器消息接收和处理
  - 会话初始化

#### 5. **TtsPlayer (TTS 播放器)**
- **职责**：播放服务器返回的 TTS 音频
- **功能**：
  - 流式音频播放
  - PCM16 音频解码
  - 播放状态管理

#### 6. **AsrSubtitle (ASR 字幕)**
- **职责**：显示实时语音识别结果
- **功能**：
  - 部分结果更新
  - 最终结果显示
  - 字幕界面渲染

#### 7. **AudioMixer (音频混控器)**
- **职责**：音频混合处理（会议室模式）
- **功能**：
  - 多路音频混合
  - WebRTC 音频处理

### 音频处理流程

```
麦克风输入
    ↓
Recorder (音频采集)
    ↓
静音检测 (RMS 值检测，阈值 0.01)
    ↓
[静音] → 丢弃，不发送
    ↓
[非静音] → 缓存到 audioBuffer
    ↓
累积到 100ms (10 帧) → 发送到调度服务器
    ↓
WebSocketClient.sendAudioChunk()
```

### 静音过滤机制

- **检测方法**：RMS (Root Mean Square) 值计算
- **阈值**：默认 0.01（可配置）
- **过滤位置**：
  1. 单帧检测：在 `onAudioFrame` 中检测每个音频帧
  2. 块级检测：在发送音频块前再次检测整个块
  3. 剩余数据检测：在 `onSilenceDetected` 和 `sendCurrentUtterance` 中检测

### 支持的模式

1. **单向模式**：源语言 → 目标语言
2. **双向模式**：自动识别语言方向
3. **会话模式**：持续输入+输出
4. **会议室模式**：WebRTC 原声传递

## 调度服务器架构

### 核心组件

#### 1. **SessionManager (会话管理器)**
- **职责**：管理客户端会话
- **功能**：
  - 会话创建和销毁
  - 会话状态维护
  - Session Actor 管理

#### 2. **NodeRegistry (节点注册表)**
- **职责**：管理节点注册和状态
- **功能**：
  - 节点注册和注销
  - 节点状态管理（Registering → Ready → Degraded → Offline）
  - 节点能力查询
  - 负载均衡节点选择

#### 3. **JobDispatcher (任务调度器)**
- **职责**：任务创建和分发
- **功能**：
  - Job 创建和管理
  - 节点选择（负载均衡）
  - 任务分发
  - 任务状态跟踪

#### 4. **SessionActor (会话 Actor)**
- **职责**：处理会话内的事件
- **功能**：
  - 音频块接收和缓冲
  - 停顿检测（pause_ms）
  - 任务创建触发
  - 事件队列管理

#### 5. **AudioBufferManager (音频缓冲区管理器)**
- **职责**：管理会话的音频缓冲区
- **功能**：
  - 音频块累积
  - 停顿检测
  - 音频数据提取

#### 6. **ResultQueueManager (结果队列管理器)**
- **职责**：管理翻译结果队列
- **功能**：
  - 结果排序（按 utterance_index）
  - 结果就绪检查
  - 结果发送

#### 7. **NodeStatusManager (节点状态管理器)**
- **职责**：节点健康检查和状态转换
- **功能**：
  - 定期健康检查
  - 状态自动转换
  - 心跳超时检测

#### 8. **GroupManager (组管理器)**
- **职责**：管理 Utterance Group
- **功能**：
  - Group 创建和管理
  - TTS 播放结束跟踪
  - 上下文管理

#### 9. **RoomManager (房间管理器)**
- **职责**：会议室模式管理
- **功能**：
  - 房间创建和加入
  - 成员管理
  - WebRTC 信令

### 任务处理流程

```
Web Client 发送 AudioChunk
    ↓
SessionActor 接收并缓冲
    ↓
检测停顿 (pause_ms = 2000ms)
    ↓
[停顿超过阈值] → 触发 finalize
    ↓
创建 Translation Job
    ↓
JobDispatcher 选择节点
    ↓
分发任务到 Node
    ↓
Node 处理 (ASR → NMT → TTS)
    ↓
返回 JobResult
    ↓
ResultQueueManager 排序
    ↓
发送结果到 Web Client
```

### 节点状态管理

1. **Registering**：节点刚注册，等待健康检查
   - 要求：`installed_services` 非空，所有服务在 `capability_state` 中为 `Ready`
   - 转换：通过 3 次健康检查后转为 `Ready`

2. **Ready**：节点就绪，可以接收任务
   - 要求：至少一个服务在 `capability_state` 中为 `Ready`
   - 转换：健康检查失败转为 `Degraded`，心跳超时转为 `Offline`

3. **Degraded**：节点降级，仍可接收任务但优先级降低
   - 转换：恢复后转为 `Ready`，心跳超时转为 `Offline`

4. **Offline**：节点离线
   - 转换：重新连接后转为 `Registering`

### Phase 2 多实例支持

#### Redis 集成
- **Instance Presence**：实例存在性标记（TTL）
- **Owner 绑定**：节点/会话与实例的绑定关系
- **跨实例投递**：使用 Redis Streams 进行可靠消息传递
- **Job FSM**：Job 生命周期状态外置 Redis
- **节点快照同步**：跨实例节点状态同步

#### 关键特性
- **横向扩展**：支持多个调度服务器实例
- **高可用性**：实例故障自动切换
- **一致性保证**：关键状态外置 Redis，避免并发冲突

### 网络时序追踪

系统支持详细的网络传输时序追踪：

- **web_to_scheduler_ms**：Web 客户端到调度服务器的传输时间
- **scheduler_to_node_ms**：调度服务器到节点的传输时间
- **node_to_scheduler_ms**：节点到调度服务器的传输时间
- **scheduler_to_web_ms**：调度服务器到 Web 客户端的传输时间

这些时序信息帮助识别系统瓶颈和性能问题。

## 节点端架构

### 核心服务

#### 1. **ASR Engine (语音识别引擎)**
- **模型**：Whisper
- **功能**：
  - 音频转录
  - 流式识别（部分结果）
  - 语言检测
  - **文本过滤**（多层过滤机制）

#### 2. **NMT Engine (机器翻译引擎)**
- **模型**：M2M100
- **功能**：
  - 多语言翻译
  - 上下文支持
  - HTTP 服务调用

#### 3. **TTS Engine (语音合成引擎)**
- **模型**：Piper TTS / YourTTS
- **功能**：
  - 文本转语音
  - 多语言支持
  - 音色克隆（可选）

### ASR 文本过滤机制

#### 过滤层级

1. **片段级过滤**（Segment Level）
   - 在 ASR 识别过程中，对每个音频片段进行过滤
   - 使用 `is_meaningless_transcript()` 检查
   - 无意义片段直接跳过，不参与拼接

2. **结果级过滤**（Result Level）
   - 对最终拼接的完整文本进行过滤
   - 使用 `filter_asr_text()` 进行更严格的过滤
   - 包括括号内容提取和智能过滤

#### 过滤规则

- **括号过滤**：所有包含括号的文本（人类说话不可能出现括号）
- **精确匹配**：配置的精确匹配模式（如 "(空)"、"謝謝大家收看" 等）
- **部分匹配**：配置的部分匹配模式（如 "介紹哨音" 等）
- **空文本过滤**：空字符串和空白文本
- **叠词过滤**：无意义的重复词（如"谢谢谢谢"）

#### 配置文件

- **路径**：`config/asr_filters.json`
- **格式**：JSON
- **加载**：服务启动时自动加载，固定路径 `config/asr_filters.json`

#### 空结果处理

当 ASR 识别结果为空或全部被过滤后：
- 跳过 NMT 处理
- 跳过 TTS 处理
- 直接返回空结果

### 音频聚合机制

#### 调度服务器Finalize机制

**触发条件**：
1. **立即Finalize（IsFinal）**：收到`is_final=true`的audio_chunk
2. **Pause检测Finalize（Pause）**：chunk间隔 > `pause_ms`（默认2000ms）
3. **超时Finalize（Timeout）**：`pause_ms`时间内没有收到新chunk（最后一句话场景）
4. **异常保护Finalize（MaxLength）**：累积音频超过500KB
5. **最大时长限制（MaxDuration）**：累积音频时长超过`max_duration_ms`（默认20000ms）

**执行流程**：
- 获取累积的音频数据（`take_combined()`）
- 设置标识（`is_manual_cut`、`is_pause_triggered`、`is_timeout_triggered`）
- 创建`JobAssignMessage`（包含完整的utterance音频）
- 发送给节点端

**详细文档**：参见 [音频聚合完整机制文档](../electron_node/docs/short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md)

#### 节点端AudioAggregator机制

**设计目标**：将多个短句utterance聚合成完整的长句后再进行ASR识别

**立即处理条件**：
1. 手动截断（`isManualCut`）
2. 3秒静音（`isPauseTriggered`）
3. 超时Finalize（`isTimeoutTriggered`）- **修复：即使时长小于10秒也处理**
4. 超过最大缓冲时长（20秒）
5. 达到最短自动处理时长（10秒）且不是超时触发

**超时切割机制**：
- 如果`isTimeoutTriggered`为true，找到最长停顿并分割
- 前半句：立即进行ASR识别
- 后半句：保留在`pendingSecondHalf`，等待后续utterance合并

**详细文档**：参见 [音频聚合完整机制文档](../electron_node/docs/short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md)

### NMT提取机制

#### 三段式提取流程

**阶段1：哨兵序列提取（SENTINEL）**
- 在完整翻译中查找分隔符（` ^^ `及其变体）
- 最准确的方法，开销最小，置信度最高

**阶段2：上下文翻译对齐切割（ALIGN_FALLBACK）**
- 如果找不到分隔符，单独翻译`context_text`
- 在完整翻译中查找`context_translation`的位置
- 提取`context_translation`之后的部分

**阶段3：最终不为空兜底（SINGLE_ONLY / FULL_ONLY）**
- 如果阶段2提取结果为空，尝试单独翻译当前文本
- 如果仍然失败，使用完整翻译（虽然包含context，但至少保证有结果）

**空context处理（Job0场景）**：
- 如果`context_text`为空，直接使用当前文本翻译
- 不需要拼接，不需要提取

**详细文档**：参见 [音频聚合完整机制文档](../electron_node/docs/short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md) 和 [NMT哨兵序列设计](../electron_node/docs/short_utterance/nmt_sentinel_sequence_design.md)

## 数据流

### 完整流程

```
1. Web Client 采集音频
   ↓
2. 静音检测和过滤（Web 端）
   ↓
3. 发送 AudioChunk 到 Scheduler
   ↓
4. Scheduler 缓冲音频块
   ↓
5. 检测停顿，触发任务创建
   ↓
6. 选择可用节点
   ↓
7. 分发任务到 Node
   ↓
8. Node 执行 ASR 及相关处理（PipelineOrchestrator）
   ├─ 音频聚合（AudioAggregator）- 8秒阈值，延迟3秒等待合并
   ├─ ASR 识别（ASRHandler）- 调用 ASR 服务
   ├─ ASR 结果处理（ASRResultProcessor）- 空文本检查、无意义文本检查
   ├─ 文本聚合（AggregationStage）- 处理跨utterance的边界重复
   ├─ 合并处理（MergeHandler）- 取消被合并的 GPU 任务
   ├─ 文本过滤（TextFilter）- shouldDiscard、shouldWaitForMerge
   ├─ 内部重复检测（detectInternalRepetition）- 检测并移除文本内部重复
   ├─ 语义修复（SemanticRepairStage）- 修复 ASR 识别错误
   └─ 去重检查（DedupStage）- 基于 job_id，30秒 TTL
   ↓
9. Node 执行 NMT（PostProcessCoordinator，如果 should_send=true 且 use_nmt !== false）
   ├─ 如果 use_asr=false，使用 job.input_text
   ├─ 否则使用 PipelineOrchestrator 处理后的文本
   └─ 调用 NMT 服务
   ↓
10. Node 执行 TTS（PostProcessCoordinator，如果 use_tts !== false）
    └─ 调用 TTS 服务
    ↓
11. Node 执行 TONE（PostProcessCoordinator，如果 use_tone === true）
    └─ 调用 TONE 服务
    ↓
12. 返回结果到 Scheduler
    ↓
13. Scheduler 排序和发送结果
    ↓
14. Web Client 接收并播放
```

## 性能优化

### Web 端优化
- **静音过滤**：在客户端直接过滤静音，减少网络传输
- **音频缓冲**：累积 100ms 音频后发送，减少消息数量
- **状态管理**：使用状态机管理复杂的状态转换

### 调度服务器优化
- **任务队列**：使用队列管理任务，支持并发处理
- **负载均衡**：智能节点选择，避免节点过载
- **结果排序**：确保结果按顺序发送到客户端
- **健康检查**：定期检查节点状态，及时发现问题

### 节点端优化
- **文本过滤**：多层过滤机制，减少无效处理
- **空结果跳过**：空 ASR 结果直接跳过后续处理
- **流式处理**：支持流式 ASR，提供实时反馈

## 扩展性

### 水平扩展
- **调度服务器**：支持多实例部署（Phase 2）
- **节点端**：支持多个节点，自动负载均衡
- **Redis**：支持分布式状态管理

### 功能扩展
- **模块化设计**：各模块独立，易于扩展
- **配置驱动**：通过配置文件控制行为
- **插件机制**：支持可选功能模块

## 监控和调试

### 日志系统
- **结构化日志**：使用 tracing 框架
- **日志级别**：支持 DEBUG、INFO、WARN、ERROR
- **日志格式**：支持 pretty 和 JSON 格式

### 性能指标
- **网络时序**：详细的传输时间追踪
- **服务耗时**：ASR、NMT、TTS 各阶段耗时
- **节点状态**：实时节点状态监控

### 调试工具
- **Dashboard**：统计信息展示
- **日志查询**：支持日志过滤和搜索
- **状态检查**：节点和会话状态查询

