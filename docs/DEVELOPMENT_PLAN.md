# 开发计划

## 阶段一：核心功能实现（4-6 周）

**当前进度**: 
- 阶段一.1 基础功能已完成 ✅（47个单元测试全部通过）
- 负载均衡优化已完成 ✅
- 阶段一.2 客户端消息格式对齐已完成 ✅（7个单元测试全部通过）

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

## 阶段二：移动端和 Electron 客户端（3-4 周）

### 2.1 移动端客户端
- [x] 项目框架搭建
- [x] VAD Hook 框架
- [x] WebSocket Hook 框架
- [ ] 消息格式对齐
- [ ] 麦克风采集
- [ ] 轻量 VAD 实现
- [ ] 手动截断按钮
- [ ] WebSocket 通信完善
- [ ] TTS 音频播放
- [ ] 可选功能选择界面
- [ ] UI 优化

### 2.2 Electron Node 客户端
- [x] Electron 项目初始化
- [x] Node Agent 框架
- [x] Model Manager 框架
- [x] 推理服务接口框架
- [x] UI 界面框架
- [ ] 消息格式对齐
- [ ] 推理服务集成
- [ ] 系统资源监控实现
- [ ] 功能模块管理 UI
- [ ] 模型下载和安装逻辑完善

## 阶段三：模型库与模块化功能（3-4 周）

### 3.1 模型库服务
- [x] Model Registry API 框架
- [x] 模型文件已复制
- [ ] Model Hub REST API 完善
- [ ] 模型下载与安装实现
- [ ] 模型版本管理
- [ ] 模型校验（SHA256）

### 3.2 模块化功能实现
- [x] 模块化架构设计
- [x] 模块管理器实现
- [x] 可选模块框架
- [ ] 音色识别模型集成
- [ ] 音色生成模型集成
- [ ] 语速识别实现
- [ ] 语速控制实现
- [ ] Electron UI 集成

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

