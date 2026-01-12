# 待完成功能列表

本文档列出了所有待完成的功能及其影响评估。概览请参考 [项目状态主文档](./PROJECT_STATUS.md)。

---

## 🔨 进行中 / 待完成

### Web 客户端 Phase 3 开发

#### ✅ 已完成功能

1. **客户端背压与降级机制** ✅
   - **状态**: ✅ **100% 完成并测试**
   - **位置**: `webapp/web-client/src/websocket_client.ts`
   - **完成内容**:
     - ✅ 发送策略调整逻辑（BUSY / PAUSE / SLOW_DOWN）
     - ✅ 发送队列管理（暂停时缓存，恢复时发送）
     - ✅ 背压状态回调通知
     - ✅ 完整的单元测试（全部通过）
   - **测试结果**: 单元测试全部通过 ✅
   - **详细文档**: [Phase 3 实现文档](../web_client/PHASE3_IMPLEMENTATION.md)

2. **Opus 编码集成** ✅
   - **状态**: ✅ **100% 完成并测试**
   - **位置**: `webapp/web-client/src/audio_codec.ts`
   - **完成内容**:
     - ✅ 集成 Opus 库（`@minceraftmc/opus-encoder` 和 `opus-decoder`）
     - ✅ 实现 OpusEncoder 和 OpusDecoder
     - ✅ Opus 编码/解码测试（全部通过）
   - **测试结果**: 单元测试全部通过 ✅
   - **详细文档**: [Phase 2 实现文档](../web_client/PHASE2_IMPLEMENTATION.md)

3. **Session Init 协议增强** ✅
   - **状态**: ✅ **100% 完成并测试**
   - **位置**: `webapp/web-client/src/websocket_client.ts`
   - **完成内容**:
     - ✅ 添加 `trace_id` 字段（自动生成 UUID）
     - ✅ 添加 `tenant_id` 字段（可选，支持多租户）
     - ✅ 移除不支持的字段（`audio_format`, `sample_rate`, `channel_count`, `protocol_version` 等）
     - ✅ 完整的单元测试（全部通过）
   - **测试结果**: 单元测试全部通过 ✅
   - **详细文档**: [Phase 3 实现文档](../web_client/PHASE3_IMPLEMENTATION.md)

4. **Node 端 Opus 解码支持** ✅
   - **状态**: ✅ **100% 完成并测试**
   - **位置**: `electron_node/services/node-inference/src/audio_codec.rs`
   - **完成内容**:
     - ✅ Opus 解码器实现（使用 `opus-rs`）
     - ✅ HTTP/WebSocket 接口中的 Opus 解码集成
     - ✅ 完整的单元测试和集成测试（全部通过）
   - **测试结果**: 17/17 测试通过 ✅
   - **详细文档**: [Phase 3 测试完成报告](../PHASE3_TESTING_COMPLETE_FINAL.md)

#### 🟡 待完成功能

1. **VAD 配置界面** 🔄
   - **状态**: VAD 已实现，但阈值硬编码
   - **影响**: 无法根据环境动态调整，影响静音过滤效果
   - **位置**: `webapp/web-client/src/ui/renderers.ts`
   - **待完成**:
     - ⚠️ 添加 VAD 配置 UI（环境噪音强度选择：弱/中/强）
     - ⚠️ 支持实时调整和保存配置
     - ⚠️ 添加 VAD 可视化（显示当前是否在发送音频）
   - **详细计划**: [Phase 3 实现文档](../web_client/PHASE3_IMPLEMENTATION.md)

### 可能影响联合调试的未完成功能

#### 🟡 中优先级（建议在联合调试时验证）

1. **双向模式集成测试** ⚠️
   - **状态**: 单元测试已完成 ✅（14个测试，全部通过），集成测试待进行
   - **影响**: 需要验证双向模式在实际环境中的工作
   - **建议**: 在联合调试时进行端到端测试
   - **位置**: 阶段 1.4

2. **端到端测试** ⚠️
   - **状态**: 未完成
   - **影响**: 需要验证完整流程
   - **建议**: 在联合调试时进行
   - **位置**: 多个阶段

---

#### 🟢 低优先级（不影响联合调试）

1. **Web 客户端语言检测 UI** ⏸️
   - **状态**: 未完成
   - **影响**: 不影响后端功能，用户可以通过代码设置
   - **位置**: 阶段 1.4

2. **可选模块模型集成** ⏸️
   - **状态**: 未完成
   - **影响**: 不影响核心翻译流程（ASR → NMT → TTS）
   - **位置**: 阶段 3.2
   - 包括：音色识别、音色生成、语速识别、语速控制、情感检测、个性化适配

3. **Utterance Group** ✅
   - **状态**: 所有组件已完成 ✅，需要 Python M2M100 服务端支持上下文参数
   - **完成度**: Scheduler 100%，Node Inference 100%（代码），Web 客户端 100%
   - **影响**: 不影响核心流程（当前实现已支持基础 Group 管理）
   - **位置**: 阶段 2.1.3
   - **待完成**（外部依赖）:
     - ⚠️ Python M2M100 服务端需要支持 `context_text` 参数
     - ⚠️ 流程优化：实现两阶段 NMT 请求，让上下文在 NMT 前生成
   - **详细状态**: 
     - [Utterance Group 完整文档](../webClient/UTTERANCE_GROUP.md)
     - [Utterance Group 实现原理](../UTTERANCE_GROUP_IMPLEMENTATION.md)

4. **Silero VAD 上下文缓冲集成** ⚠️
   - **状态**: 代码已实现 ✅，但未集成到处理流程
   - **完成度**: VAD 引擎 100%，上下文缓冲机制 100%
   - **影响**: 不影响核心流程（当前使用 Web 端 VAD）
   - **位置**: 节点推理服务
   - **待完成**:
     - ⚠️ 在 `inference.rs` 中集成 VAD 进行流式断句
     - ⚠️ 实现音频拼接和 VAD 断句流程
   - **详细状态**: 
     - [VAD 架构分析](../VAD_ARCHITECTURE_ANALYSIS.md)
     - [上下文缓冲功能对比](../CONTEXT_BUFFERING_COMPARISON.md)

4. **高级负载均衡策略** ⏸️
   - **状态**: 未完成
   - **影响**: 不影响基本功能，当前负载均衡已足够
   - **位置**: 阶段 1.1
   - 包括：资源使用率、加权轮询、综合评分、功能匹配优先级排序、方言匹配和模型版本匹配

5. **API Gateway 完善** ⏸️
   - **状态**: 部分完成
   - **影响**: 不影响核心功能（对外 API 网关）
   - 需要：完善错误处理和日志、编写单元测试和集成测试、数据库集成（租户存储）、监控和告警、生产环境优化

6. **移动端客户端** ⏸️
   - **状态**: 框架完成，功能未完成
   - **影响**: 不影响核心功能（已有 Web 客户端替代）
   - 需要：对齐消息格式、实现完整的 VAD 检测、实现音频采集和处理、完善 WebSocket 通信、实现 TTS 音频播放、实现可选功能选择 UI

7. **SDK 开发** ⏸️（可选）
   - **状态**: 未开始
   - **影响**: 不影响核心功能
   - 包括：JS Web SDK、Android SDK、iOS SDK、SDK 文档和示例

---

## 📝 代码中的 TODO 项（不影响联合调试）

### 节点推理服务

1. **可选模块模型集成**（不影响核心流程）
   - `speaker.rs`: 音色识别/生成模型加载
   - `speech_rate.rs`: 语速识别/控制模型加载
   - `inference.rs`: 情感检测和个性化适配模块

2. **NMT ONNX 模式**（不影响当前 HTTP 模式）
   - `nmt.rs`: ONNX 模型加载（当前使用 HTTP 模式）

### 调度服务器

1. **模型列表查询**（不影响核心功能）
   - `model_hub.rs`: 模型列表查询实现
   - `main.rs`: 模型列表查询端点

2. **高级功能**（不影响基本功能）
   - `dispatcher.rs`: 从配置获取具体模型 ID

---

**返回**: [项目状态主文档](./PROJECT_STATUS.md)

