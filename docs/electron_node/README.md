# Electron Node 技术文档

**版本**: v2.0  
**更新日期**: 2026年1月18日  
**维护者**: Lingua团队

---

## 📚 文档结构

当前文档目录：

```
docs/electron_node/
├── README.md                              # 本文档（总览，300行）
├── ASR_MODULE_FLOW_DOCUMENTATION.md      # ASR模块流程详解（264行）
├── AUDIO_AGGREGATOR_DATA_FORMAT.md       # 音频聚合器数据格式（143行）
└── LONG_UTTERANCE_JOB_CONTAINER_POLICY.md # 长语音Job容器策略（132行）

总计：4个核心文档，约840行
```

**源代码架构文档**：

```
electron-node/main/src/
├── pipeline-orchestrator/
│   └── AUDIO_AGGREGATOR_ARCHITECTURE.md  # 音频聚合器架构设计
├── agent/
│   └── AGGREGATOR_MIDDLEWARE_ARCHITECTURE.md # 聚合中间件架构
└── aggregator/
    └── README.md                          # 聚合器README
```

---

## 🏗️ 系统架构概览

### 核心组件

```
┌─────────────────────────────────────────────────┐
│                  Electron Node                   │
├─────────────────────────────────────────────────┤
│  1. Pipeline Orchestrator（管道编排器）        │
│     ├─ AudioAggregator（音频聚合）            │
│     ├─ ASR Handler（ASR处理）                  │
│     └─ Result Dispatcher（结果分发）           │
│                                                   │
│  2. Agent（节点代理）                           │
│     ├─ NodeAgent（节点主控）                   │
│     ├─ Aggregator Middleware（聚合中间件）    │
│     └─ Result Sender（结果发送）               │
│                                                   │
│  3. Task Router（任务路由）                     │
│     ├─ ASR Router（ASR任务路由）              │
│     ├─ NMT Router（NMT任务路由）              │
│     └─ TTS Router（TTS任务路由）              │
│                                                   │
│  4. Service Manager（服务管理）                │
│     ├─ Python Service Manager                   │
│     ├─ Rust Service Manager                     │
│     └─ Model Manager（模型管理）               │
└─────────────────────────────────────────────────┘
```

---

## 🎯 核心功能

### 1. 音频聚合与流式处理

**功能**: 在ASR之前聚合音频，避免识别不完整的短句

**关键特性**:
- ✅ 音频聚合：根据finalize标识聚合完整句子
- ✅ 流式切分：长音频按能量切分成~5秒批次
- ✅ Session隔离：不同session的缓冲区完全隔离
- ✅ Session Affinity：超时finalize时记录session到node的映射

**相关文档**:
- `ASR_MODULE_FLOW_DOCUMENTATION.md` - 完整流程说明
- `AUDIO_AGGREGATOR_ARCHITECTURE.md` - 架构设计
- `AUDIO_AGGREGATOR_DATA_FORMAT.md` - 数据格式

**处理流程**:

```
1. 超时finalize (is_timeout_triggered):
   音频 → 缓存到pendingTimeoutAudio → 等待下一个job合并

2. 手动/Pause finalize (is_manual_cut/is_pause_triggered):
   音频 → 合并pendingTimeoutAudio → 按能量切分 → 发送ASR

3. 正常累积:
   音频 → 添加到缓冲区 → 继续等待finalize标识
```

**关键参数**:
- `MAX_BUFFER_DURATION_MS`: 20000ms (最大缓冲时长)
- `MIN_AUTO_PROCESS_DURATION_MS`: 10000ms (最短自动处理时长)
- `SPLIT_HANGOVER_MS`: 600ms (分割点hangover)
- `MIN_ACCUMULATED_DURATION_FOR_ASR_MS`: 5000ms (最小批次时长)
- `PENDING_TIMEOUT_AUDIO_TTL_MS`: 10000ms (超时音频TTL)

---

### 2. ASR结果分发与批次累积

**功能**: 按originalJobId分发ASR结果，累积多个批次后触发后续处理

**关键特性**:
- ✅ 批次累积：等待所有ASR批次完成后再触发SR
- ✅ 文本合并：按batchIndex排序后合并文本
- ✅ 生命周期管理：20秒超时自动清理
- ✅ 防重复触发：isFinalized标志防止双回调

**相关文档**:
- `ASR_MODULE_FLOW_DOCUMENTATION.md` - 分发逻辑详解
- `ASR_RESULT_DATA_STRUCTURE_AND_FLOW.md` - 数据结构说明

**处理策略**:

```
expectedSegmentCount设置：
- finalize时：设置为batchCount（等待所有batch完成）
- 非finalize时：undefined（累积等待）

触发时机：
- 达到expectedSegmentCount时：立即触发callback
- forceComplete调用时：强制完成（fallback路径）
```

---

### 3. 长语音Job容器策略

**功能**: 将多个job的音频合并后切分成多个ASR批次，确保每个job得到完整的识别结果

**关键特性**:
- ✅ 头部对齐策略：每个批次分配到其起始位置所在的job
- ✅ 容器装满切换：根据expectedDurationMs判断容器是否装满
- ✅ 批次累积：等待所有批次处理完成后合并文本

**相关文档**:
- `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` - 容器策略详解
- `ASR_MODULE_FLOW_DOCUMENTATION.md` - 实现细节

**示例场景**:

```
35秒长语音场景：
- Job0: 10秒（预期10秒）
- Job1: 10秒（预期10秒）
- Job2: 10秒（预期10秒）
- Job3: 5秒（预期5秒）

切分成5个batch：
- B0: 6秒 → 分配给Job0
- B1: 7秒 → 分配给Job0（容器装满）
- B2: 7秒 → 分配给Job1
- B3: 6秒 → 分配给Job1（容器装满）
- B4: 9秒 → 分配给Job2

最终输出：
- Job0的ASR结果 = B0 + B1的文本合并
- Job1的ASR结果 = B2 + B3的文本合并
- Job2的ASR结果 = B4的文本
- Job3的ASR结果 = 空（没有足够音频）
```

---

### 4. UtteranceIndex差值检查（BUG修复）

**功能**: 修复pendingTimeoutAudio被错误清除的问题

**问题**: 超时finalize后，下一个job的utteranceIndex不同，导致pending音频被清除

**修复逻辑**:

```typescript
const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;

// 连续utteranceIndex（差值≤2）：允许合并
if (utteranceIndexDiff === 1 || utteranceIndexDiff === 2) {
  // 合并pendingTimeoutAudio
}

// 跳跃太大（差值>2）：清除
if (utteranceIndexDiff > 2) {
  // 清除pendingTimeoutAudio
}

// 重复job（差值=0）：清除
if (utteranceIndexDiff === 0) {
  // 清除pendingTimeoutAudio
}
```

**影响的handler**:
- `audio-aggregator-finalize-handler.ts` (3个方法)
- `audio-aggregator-timeout-handler.ts` (1个方法)
- `audio-aggregator-pause-handler.ts` (1个方法)

---

### 5. Hotfix：合并音频场景禁用流式切分

**功能**: 合并pendingTimeoutAudio或pendingPauseAudio后，整段音频作为单个批次

**原因**: 避免合并后的音频被错误切分，导致句头丢失

**实现**:

```typescript
// 合并pending音频时设置标志
let hasMergedPendingAudio = false;

if (buffer.pendingTimeoutAudio || buffer.pendingPauseAudio) {
  hasMergedPendingAudio = true;
}

// 根据标志决定是否切分
if (hasMergedPendingAudio) {
  audioSegments = [audioToProcess]; // 整段音频，不切分
} else {
  audioSegments = splitAudioByEnergy(...); // 正常切分
}
```

---

## 🚀 快速导航

### 新开发者

1. **了解整体架构**
   - 阅读本文档（README.md）- 系统架构总览
   - 查看 `ASR_MODULE_FLOW_DOCUMENTATION.md` - ASR模块完整流程

2. **深入核心模块**
   - 音频聚合数据格式：`AUDIO_AGGREGATOR_DATA_FORMAT.md`
   - 音频聚合架构设计：`src/pipeline-orchestrator/AUDIO_AGGREGATOR_ARCHITECTURE.md`
   - Job容器策略：`LONG_UTTERANCE_JOB_CONTAINER_POLICY.md`

### 架构评审

1. 阅读 `ASR_MODULE_FLOW_DOCUMENTATION.md` - 了解完整流程调用链
2. 查看 `AUDIO_AGGREGATOR_DATA_FORMAT.md` - 了解数据结构
3. 参考 `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` - 了解长语音处理策略

### 问题排查

1. **音频丢失问题**
   - 检查 utteranceIndex 差值检查逻辑
   - 检查 pendingTimeoutAudio 是否被错误清除
   - 查看日志：`AudioAggregator: 连续utteranceIndex，允许合并`

2. **ASR结果重复/丢失**
   - 检查 isFinalized 标志
   - 检查 expectedSegmentCount 设置
   - 查看日志：`OriginalJobResultDispatcher: Merged ASR batches text`

3. **Session混淆**
   - 检查 sessionId 是否正确传递
   - 检查缓冲区是否隔离
   - 查看日志：每个操作都应包含 sessionId

---

## 📐 设计原则

### 1. 单一职责

每个模块只负责一个职责：
- `AudioAggregator`: 音频聚合
- `OriginalJobResultDispatcher`: 结果分发
- `PipelineOrchestratorASRHandler`: ASR处理

### 2. 依赖注入

使用依赖注入而不是单例，支持：
- 热插拔：服务重启不影响其他session
- 测试隔离：每个测试都有独立实例
- 清晰的依赖关系

### 3. Session隔离

不同session的数据完全隔离：
- 使用 `Map<sessionId, data>` 存储
- 避免session间数据混淆
- 支持并发处理

### 4. 防御性编程

关键路径都有防御性检查：
- `isFinalized` 防止双回调
- `utteranceIndex` 差值检查防止错误清除
- `TTL` 机制防止内存泄漏

---

## 🧪 测试

### 单元测试

核心模块都有完整的单元测试：
- `audio-aggregator.test.ts`: 39个测试用例（100%通过）
- `original-job-result-dispatcher.test.ts`: 完整的分发逻辑测试
- `session-affinity-manager.test.ts`: Session Affinity测试

### 集成测试

建议的集成测试场景：
1. 短句场景（<5秒）
2. 长句场景（>10秒）
3. 超时finalize场景
4. 连续utterance合并场景
5. 多session并发场景

---

## 📊 性能指标

### 音频处理

- **聚合延迟**: <10ms
- **切分延迟**: <50ms
- **内存占用**: 每个session约1-5MB

### ASR结果分发

- **分发延迟**: <5ms
- **文本合并延迟**: <1ms
- **清理间隔**: 5秒

---

## 🔄 版本历史

### v2.0 (2026-01-18)

**重大更新**:
- ✅ 修复 utteranceIndex 差值检查逻辑（防止句子前半部分丢失）
- ✅ 添加 Hotfix：合并音频场景禁用流式切分
- ✅ 完成代码模块化重构（audio-aggregator.ts 从1507行降至486行）
- ✅ 添加完整的单元测试（39个测试用例，100%通过）
- ✅ 清理文档，移除过期的测试报告和分析文档

**模块拆分**:
- `audio-aggregator-timeout-handler.ts` - 超时处理
- `audio-aggregator-pause-handler.ts` - Pause处理
- `audio-aggregator-finalize-handler.ts` - Finalize处理
- `audio-aggregator-merger.ts` - 音频合并
- `audio-aggregator-stream-batcher.ts` - 流式批次
- `audio-aggregator-job-container.ts` - Job容器
- `audio-aggregator-utils.ts` - 工具函数
- `audio-aggregator-types.ts` - 类型定义

### v1.0 (2025-12-15)

**初始版本**:
- 实现音频聚合和流式切分
- 实现ASR结果分发和批次累积
- 实现长语音Job容器策略
- 实现Session Affinity机制

---

## 📞 联系与支持

如有问题或建议，请参考相关文档或联系团队。

**文档维护原则**:
1. 核心文档控制在500行以内
2. 删除过期的测试报告和分析文档
3. 合并相关的实现总结
4. 保持文档与代码同步

---

**最后更新**: 2026年1月18日  
**维护者**: Lingua团队
