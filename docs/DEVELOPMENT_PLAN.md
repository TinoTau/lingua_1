# 开发计划

## 阶段一：核心功能实现（4-6 周）

**当前进度**: 
- 阶段一.1 基础功能已完成 ✅（47个单元测试全部通过）
- 负载均衡优化已完成 ✅
- 阶段一.2 客户端消息格式对齐已完成 ✅（7个单元测试全部通过）
- 阶段 2.2 Electron Node 客户端核心功能已完成 ✅（编译测试全部通过）
- 阶段 3.1 模型库服务已完成 ✅（ModelManager 核心功能测试 12/12 通过）

### 1.1 调度服务器核心功能
- [x] 项目框架搭建
- [x] 核心模块结构
- [x] 消息协议定义
- [x] 数据结构扩展（支持多租户、功能感知）
- [x] **WebSocket 消息处理实现**（高优先级，模块化设计）
  - [x] 会话端消息处理（`websocket/session_handler.rs`）- session_init, utterance, heartbeat, session_close
  - [x] 节点端消息处理（`websocket/node_handler.rs`）- node_register, node_heartbeat, job_result
  - [x] 公共辅助函数（`websocket/mod.rs`）- 消息发送、错误处理等
  - [x] 结果聚合和排序（按 utterance_index 顺序）
  - [x] WebSocket 连接管理（SessionConnectionManager, NodeConnectionManager）
- [x] **单元测试**（阶段一.1）
  - [x] 会话管理测试（7个测试）
  - [x] 任务分发测试（6个测试）
  - [x] 节点注册表测试（10个测试）
  - [x] 配对服务测试（6个测试）
  - [x] 连接管理测试（8个测试）
  - [x] 结果队列测试（9个测试）
  - [x] 测试报告和文档
- [x] **任务分发算法优化（基础负载均衡）** ✅
  - [x] 完善功能能力检查（所有 6 个功能位）
  - [x] 实现最少连接数（Least Connections）策略
  - [x] 引入负载均衡配置入口
  - [x] 添加负载均衡单元测试
  - 详细方案请参考 [任务分发算法优化方案](./DISPATCHER_OPTIMIZATION_PLAN.md)
- [ ] 高级负载均衡策略（资源使用率、加权轮询、综合评分）
- [ ] 功能匹配优先级排序和方言匹配

### 1.2 客户端消息格式对齐 ✅
- [x] 移动端消息格式对齐协议规范
  - [x] session_init 消息格式对齐（client_version, platform, dialect, features）
  - [x] utterance 消息格式对齐（audio_format, sample_rate, dialect, features）
- [x] Electron Node 消息格式对齐协议规范
  - [x] node_register 消息格式对齐（version, platform, hardware, installed_models, features_supported）
  - [x] node_heartbeat 消息格式对齐（timestamp, resource_usage 结构）
  - [x] job_result 消息格式对齐（完整的错误处理结构）
- [x] 单元测试（7个测试，全部通过）
  - [x] 消息格式验证测试
  - [x] 功能标志完整性测试

### 1.3 节点推理服务 ✅
- [x] ASR 引擎实现（Whisper）
  - [x] 模型加载（支持 GGML 格式）
  - [x] 音频转录（PCM 16-bit 和 f32 格式）
  - [x] 语言设置和自动检测
  - [x] GPU 加速支持（whisper-rs with CUDA）
- [x] NMT 引擎实现（M2M100）
  - [x] HTTP 客户端（调用 Python M2M100 服务）
  - [x] 多语言翻译支持
  - [x] 自定义服务 URL 配置
- [x] TTS 引擎实现（Piper TTS）
  - [x] HTTP 客户端（调用 Piper TTS 服务）
  - [x] 多语言语音合成
  - [x] 自定义配置支持
- [x] VAD 引擎实现（Silero VAD）
  - [x] ONNX Runtime 模型加载（ort 1.16.3）
  - [x] 语音活动检测（Level 2，用于节点端断句）
  - [x] 自适应阈值调整（根据语速动态调整）
  - [x] 边界检测逻辑（冷却期、最小话语时长）
  - [x] 帧缓冲区管理
  - [x] 状态重置功能
  - [x] GPU 加速支持（ort with CUDA，待验证）
- [x] 推理服务核心实现
  - [x] `InferenceService` 统一接口
  - [x] 模块化设计（可选模块支持）
  - [x] 完整推理流程（ASR → NMT → TTS）
- [x] **单元测试**
  - [x] ASR 测试（3个测试，全部通过，支持本地模型调用）
  - [x] NMT 测试（3个测试，需要外部服务）
  - [x] TTS 测试（3个测试，需要外部服务）
  - [x] VAD 测试（7个测试，全部通过，支持本地模型调用）
  - [x] 集成测试（1个测试，需要所有模型和服务）
  - [x] 测试报告（`node-inference/tests/stage1.3/TEST_REPORT.md`）
  - [x] 本地模型测试说明（`node-inference/tests/LOCAL_MODEL_TESTING.md`）

### 1.4 自动语种识别与双向模式 ✅（核心功能已完成）
- [x] **LanguageDetector 模块实现** ✅
  - [x] 创建 `language_detector.rs` 模块
  - [x] 定义 `LanguageDetector` 结构体和配置
  - [x] 定义 `LanguageDetectionResult` 结果类型
  - [x] 实现实际的语言检测逻辑（使用 Whisper + 文本特征推断）✅
  - [x] 参考 `D:\Programs\github\lingua` 中的实现方式
- [x] **扩展消息协议** ✅
  - [x] `InferenceRequest` 添加 `mode`、`lang_a`、`lang_b`、`auto_langs` 字段
  - [x] `SessionInit` 消息扩展（调度服务器）
  - [x] `Session` 结构扩展
  - [x] `Job` 和 `JobAssign` 消息扩展
  - [x] TypeScript 消息类型扩展
  - [x] 新增 `LanguageDetected` 消息类型
- [x] **推理流程修改** ✅
  - [x] `InferenceService` 集成语言检测逻辑
  - [x] 支持 `src_lang="auto"` 自动检测
  - [x] 实现双向模式翻译方向判断
  - [x] ASR 引擎共享 Whisper 上下文给 LanguageDetector ✅
- [ ] **客户端 UI 支持**
  - [ ] 添加模式选择界面（one_way / two_way_auto）
  - [ ] 添加语言对配置界面
  - [ ] 可选显示语言检测结果
- [x] **单元测试** ✅
  - [x] 语言检测单元测试（7个测试，全部通过）✅
  - [x] [测试报告](./node-inference/tests/stage1.4/TEST_REPORT.md)
  - [ ] 双向模式集成测试
  - [ ] 端到端测试
- 详细设计请参考 [自动语种识别与双向模式设计](./AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md)

## 阶段二：客户端开发（3-4 周）

### 2.1 Web 客户端（iOS 开发设备替代方案）✅（阶段 2.1 核心功能已完成）

**背景**: 由于没有 iOS 开发设备，开发了 Web 客户端作为替代方案，采用半双工实时语音翻译设计。

- [x] **项目框架搭建**
  - [x] TypeScript + Vite 项目结构
  - [x] 模块化设计（state_machine, recorder, websocket_client, tts_player, asr_subtitle）
- [x] **阶段 2.1：核心功能实现** ✅
  - [x] 半双工状态机（4 个状态：INPUT_READY → INPUT_RECORDING → WAITING_RESULT → PLAYING_TTS）
  - [x] Send 按钮和静音自动结束（1000ms 阈值 + 250ms 尾部缓冲）
  - [x] 播放期间关麦逻辑（彻底关闭浏览器麦克风）
  - [x] 基础 WebSocket 通信（音频上传和消息接收）
  - [x] 完整 UI 界面
- [x] **阶段 2.1.1：单元测试** ✅
  - [x] 状态机模块测试（14 个测试，全部通过）
  - [x] ASR 字幕模块测试（8 个测试，全部通过）
  - [x] 测试报告（`web-client/tests/stage2.1/TEST_REPORT.md`）
- [x] **阶段 2.1.2：ASR 字幕** ✅
  - [x] 扩展节点推理服务支持 partial 结果
  - [x] 扩展调度服务器转发 partial 结果
  - [x] 扩展 WebSocket 协议（asr_partial 消息）
  - [x] 前端实时字幕显示（已实现框架）
  - [x] 单元测试（调度服务器：12个测试全部通过 ✅，节点推理服务：5个测试（2个通过 ✅，3个跳过 ⏸️，需要模型文件））
  - [x] 测试报告：
    - [调度服务器测试报告](./../scheduler/tests/stage2.1.2/TEST_REPORT.md)
    - [节点推理服务测试报告](./../node-inference/tests/stage2.1.2/TEST_REPORT.md)
- [ ] **阶段 2.1.3：Utterance Group**（需要后端支持）
  - [ ] 扩展调度服务器支持 Group 管理
  - [ ] 扩展节点推理服务支持上下文拼接
  - [ ] 扩展 NMT 引擎支持上下文输入
- 详细设计请参考 [Web 端实时语音翻译统一设计方案 v3](./webClient/Web_端实时语音翻译_统一设计方案_v3.md)
- 项目位置：`web-client/`

### 2.2 移动端客户端（React Native）
- [x] 项目框架搭建
- [x] VAD Hook 框架
- [x] WebSocket Hook 框架
- [x] 消息格式对齐（阶段一.2 已完成）
- [ ] **音频采集服务实现**（参考 `docs/IOS/IOS_AUDIO_VAD_PIPELINE.md`）
  - [ ] 使用 expo-av 或 react-native-audio-recorder-player
  - [ ] 配置采样率 16kHz、PCM 16-bit、单声道
  - [ ] 实现 20ms 帧采集
- [ ] **轻量 VAD 实现**（参考 iOS RMS 能量阈值算法）
  - [ ] RMS 能量计算
  - [ ] 静音阈值判定（-50dB）
  - [ ] 连续静音过滤（>200ms）
- [ ] **AudioChunk 打包器**
  - [ ] 每 200-250ms 打包一次
  - [ ] 包含 sequence、timestampMs、pcmData、droppedSilenceMs
- [ ] **WebSocket 通信完善**
  - [ ] 心跳机制（每 20-30 秒）
  - [ ] 自动重连（指数退避）
  - [ ] 错误恢复
- [ ] **TTS 音频播放**（参考 `docs/IOS/IOS_CLIENT_DESIGN_AND_INTERFACES.md`）
  - [ ] 使用 expo-av 播放 PCM16
  - [ ] Base64 解码
  - [ ] AEC 协作（避免回声）
- [ ] 手动截断按钮
- [ ] 可选功能选择界面
- [ ] UI 优化
- [ ] 多会话管理（可选，参考 `docs/IOS/IOS_MULTI_SESSION_DESIGN.md`）
- [ ] 调试与监控（可选，参考 `docs/IOS/IOS_DEBUG_MONITORING.md`）

### 2.2 Electron Node 客户端
- [x] Electron 项目初始化
- [x] Node Agent 框架
- [x] Model Manager 框架
- [x] 推理服务接口框架
- [x] UI 界面框架
- [x] **推理服务集成** ✅（HTTP 服务方式）
- [x] **系统资源监控实现** ✅（CPU、GPU、内存）
- [x] **模型管理 UI** ✅（模型下载、安装、管理，不提供功能开关）
- [x] **流式 ASR 支持** ✅（部分结果回调）
- [x] **模型存储路径配置** ✅（非 C 盘）
- [x] **单元测试** ✅（编译测试全部通过）
  - [测试报告](./electron-node/tests/stage2.2/TEST_REPORT.md)
- [x] **消息格式对齐** ✅（所有消息已对齐协议规范）
- [x] **模型下载和安装逻辑完善** ✅（阶段 3.1）
  - [x] 详细的进度显示（总体进度、文件进度、下载速度、剩余时间）
  - [x] 完善的错误处理（错误分类、可重试判断、用户提示）
  - [x] 自动重试机制（网络错误自动重试，指数退避）
  - [x] 验证阶段增强（文件存在性、大小、SHA256 校验）
  - [x] UI 样式优化（进度显示、错误提示）
  - [x] **单元测试** ✅（16/16 通过，100%）

## 阶段三：模型库与模块化功能（3-4 周）

### 3.1 模型库服务 ✅
- [x] Model Registry API 框架
- [x] 模型文件已复制
- [x] **Model Hub REST API 完善** ✅
  - [x] `/api/models` 接口（v3 格式，支持多版本嵌套）
  - [x] `/api/models/{model_id}` 接口
  - [x] `/storage/models/{model_id}/{version}/{file_path}` 文件下载接口（支持 Range 请求）
  - [x] `/api/model-usage/ranking` 热门模型排行接口
  - [x] 路径遍历攻击防护
- [x] **模型下载与安装实现** ✅
  - [x] 断点续传（Range 请求）
  - [x] 流式下载
  - [x] 多文件并发下载（限制并发数为 3）
  - [x] SHA256 校验
  - [x] 任务锁和文件锁机制
  - [x] registry.json 原子写入
  - [x] ModelNotAvailableError 错误处理
  - [x] IPC 进度事件推送
- [x] **模型版本管理** ✅
  - [x] 多版本共存支持
  - [x] 默认版本选择
- [x] **模型校验（SHA256）** ✅
- [x] **模型管理 UI** ✅
  - [x] 模型列表展示（可下载/已安装）
  - [x] **下载进度显示完善** ✅
    - [x] 总体进度和文件进度
    - [x] 下载速度和剩余时间
    - [x] 当前文件信息
    - [x] 文件计数显示
    - [x] 验证阶段进度
  - [x] **错误提示和重试功能完善** ✅
    - [x] 错误分类显示（网络、磁盘、校验、未知）
    - [x] 详细的错误信息
    - [x] 可重试按钮（仅网络错误）
    - [x] 错误提示和建议
  - [x] 热门模型排行榜展示
- [x] **单元测试** ✅
  - [x] ModelManager 核心功能测试（12/12 通过）
  - [x] **模型下载进度显示测试** ✅（6/6 通过）
  - [x] **模型下载错误处理测试** ✅（6/6 通过）
  - [x] **模型验证功能测试** ✅（4/4 通过）
  - [x] 模型库服务 API 测试（需要服务运行）
  - [x] [测试报告](./electron-node/tests/stage3.1/TEST_REPORT.md)
  - [x] **总体测试结果**: 39/44 通过（88.6%）

### 3.2 模块化功能实现
- [x] 模块化架构设计
- [x] 模块管理器实现
- [x] 可选模块框架
- [x] **核心数据结构实现** ✅
  - [x] ModuleMetadata 结构（SSOT）
  - [x] ModelRequirement 结构
  - [x] PipelineContext 统一上下文
  - [x] MODULE_TABLE 模块配置表
- [x] **ModuleManager 增强** ✅
  - [x] 依赖循环检测（DFS 算法）
  - [x] 冲突检查
  - [x] 依赖检查
  - [x] 模型可用性检查
  - [x] 完整的 enable_module 流程
- [x] **capability_state 机制** ✅
  - [x] ModelStatus 枚举定义
  - [x] 节点注册/心跳消息扩展
  - [x] 节点能力状态上报
- [x] **PipelineContext 集成** ✅
  - [x] InferenceService 使用 PipelineContext
  - [x] 所有模块输出写入 PipelineContext
- [x] **调度服务器模块依赖展开** ✅
  - [x] ModuleResolver 实现
  - [x] 递归依赖展开算法
  - [x] 模型需求收集
  - [x] 基于 capability_state 的节点选择
- [x] **模块启用流程** ✅
  - [x] 模型加载逻辑
  - [x] 状态管理
- [x] **单元测试** ✅
  - [x] 模块管理器测试（8/8 通过）
  - [x] 模块依赖解析器测试（10/10 通过）
  - [x] capability_state 测试（4/4 通过）
  - [x] 节点选择测试（6/6 通过）✅
  - [x] Web 客户端功能选择测试（17/17 通过）✅
  - [x] [测试报告](./electron-node/tests/stage3.2/TEST_REPORT.md)
  - [x] [调度服务器节点选择测试报告](./scheduler/tests/stage3.2/TEST_REPORT.md)
  - [x] [Web客户端功能选择测试报告](./web-client/tests/stage3.2/TEST_REPORT.md)
  - [x] **总体测试结果**: 45/45 通过（100%）
- [ ] **可选模块模型集成**（待具体模型实现）
  - [ ] 音色识别模型集成
  - [ ] 音色生成模型集成
  - [ ] 语速识别模型集成
  - [ ] 语速控制模型集成
  - [ ] 情感检测模型集成
  - [ ] 个性化适配模型集成
- [x] **客户端功能选择 UI**（Web/移动端）✅
  - [x] Web 客户端功能选择界面 ✅
  - [x] 移动端功能选择界面 ✅（已在 mobile-app 中实现）
  - [x] 功能选择与任务请求的集成 ✅
  - [x] 兼容性检查 ✅（与之前所有功能完全兼容，详见 [LINGUA 完整技术说明书 v2 - 附录 D](../modular/LINGUA_完整技术说明书_v2.md#14-附录-d阶段-32-功能选择模块兼容性检查报告)）
- [x] **Electron 节点端模型管理** ✅（仅模型下载和管理，不提供功能开关）
  - [x] 模型下载和安装（已完成）
  - [x] 模型管理 UI（已完成，仅提供模型下载/安装，不提供功能开关）
  - [x] 根据任务需求动态启用/禁用模块（运行时，无需 UI 开关）✅

## 阶段四：对外开放 API（2-3 周）

### 4.1 API Gateway 完善
- [x] 项目框架搭建
- [x] 核心模块实现（租户管理、鉴权、限流、REST/WebSocket API）
- [x] Scheduler 扩展（tenant_id 支持）
- [ ] 错误处理和日志完善
- [ ] 单元测试和集成测试
- [ ] 数据库集成（租户存储）

### 4.2 SDK 开发（可选）
- [ ] JS Web SDK
- [ ] Android SDK
- [ ] iOS SDK
- [ ] SDK 文档和示例

## 阶段五：联调与优化（2-3 周）
- [ ] 全链路联调
- [ ] 性能优化
- [ ] 稳定性测试
- [ ] 模块化功能测试
- [ ] API Gateway 生产环境优化
- [ ] 监控和告警系统

## 相关优化方案

- [任务分发算法优化方案](./DISPATCHER_OPTIMIZATION_PLAN.md) - 负载均衡和功能感知节点选择的详细优化方案
- [自动语种识别与双向模式设计](./AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md) - 自动语种识别功能的设计文档（包含可行性分析）

