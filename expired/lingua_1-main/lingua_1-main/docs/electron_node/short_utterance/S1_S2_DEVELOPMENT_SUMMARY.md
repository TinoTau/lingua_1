# S1/S2 开发内容总结

## 概述

S1 和 S2 是为了提升短句 ASR 识别准确率而开发的两套技术方案：

- **S1 (Prompt Bias)**: 上下文偏置，在 ASR 解码时注入关键词和最近上下文
- **S2 (Rescoring)**: 双通道解码与复核，对短句/低质量文本生成候选并选择最优

---

## S1: Prompt Bias（上下文偏置）

### 目标
在 ASR 解码时给模型一个"软提示"，让它更倾向输出领域词、专名、用户最近出现的词。

### 实现内容

#### 1. PromptBuilder（`src/asr/prompt-builder.ts`）
**功能**：构建包含关键词和最近上下文的 prompt 文本

**主要方法**：
- `buildPrompt()`: 构建 prompt
  - 提取用户配置的关键词（专名、术语、产品名）
  - 从最近文本中提取高频词和专名
  - 提取最近 2 条 committed 文本（每行最多 120 字符）
  - 质量门控：如果 `qualityScore < 0.4`，只启用 keywords，禁用 recent context
  - 长度控制：offline 模式最多 600 字符，room 模式最多 500 字符

**Prompt 格式**：
```
[CONTEXT]
Keywords:
- <keyword1>
- <keyword2>
Recent:
<recent_line1>
<recent_line2>
[/CONTEXT]
```

#### 2. PipelineOrchestrator 集成
**位置**：`src/pipeline-orchestrator/pipeline-orchestrator.ts`

**功能**：
- 在 `processJob()` 中构建 prompt
- 从 `AggregatorManager` 获取 session state（`recentCommittedText`, `recentKeywords`）
- 使用 `PromptBuilder` 构建 prompt
- 将 prompt 设置到 `ASRTask.context_text`
- 传递给 `TaskRouter.routeASRTask()`

**集成点**：
- `processJob()`: 主要处理流程
- `processASROnly()`: 仅 ASR 处理
- `processASRStreaming()`: 流式 ASR（通过 processJob 创建的 asrTask 已包含 prompt）

#### 3. InferenceService 集成
**位置**：`src/inference/inference-service.ts`

**功能**：
- 添加 `aggregatorManager` 字段
- 提供 `setAggregatorManager()` 方法用于动态更新
- 将 `aggregatorManager` 传递给 `PipelineOrchestrator`

#### 4. NodeAgent 集成
**位置**：`src/agent/node-agent.ts`

**功能**：
- 在构造函数中，从 `AggregatorMiddleware` 获取 `AggregatorManager`
- 调用 `InferenceService.setAggregatorManager()` 传递 manager

### 数据流

```
NodeAgent
  ↓ (初始化时)
AggregatorMiddleware.manager
  ↓
InferenceService.setAggregatorManager()
  ↓
PipelineOrchestrator (构造函数)
  ↓ (处理job时)
1. 从 AggregatorManager 获取 session state
2. 提取 recentCommittedText 和 userKeywords
3. 使用 PromptBuilder 构建 prompt
4. 将 prompt 设置到 ASRTask.context_text
5. 传递给 TaskRouter.routeASRTask()
6. ASR服务使用 prompt 进行识别
```

### 配置参数

- `maxChars`: offline 600, room 500
- `maxKeywords`: 30
- `maxRecentLines`: 2
- `maxRecentLineChars`: 120
- `enableRecentContext`: 根据 qualityScore 动态控制（qualityScore < 0.4 时禁用）

### 状态
✅ **100% 完成，已启用**

---

## S2: Rescoring（复核）

### 目标
对"短句 + 低置信/高风险"的文本块运行第二通道生成候选，再复核选择最优文本。

### 实现内容

#### 1. NeedRescoreDetector（`src/asr/need-rescore.ts`）
**功能**：检测是否需要 rescoring

**触发条件**（满足任一）：
- **短句条件**：
  - CJK：`len_chars < 12-18`
  - EN：`word_count < 6-10`
- **低置信条件**：
  - offline：`quality_score < 0.45`
  - room：`quality_score < 0.50`
- **高风险特征**（命中任一）：
  - 含数字/单位/金额/时间（12、30%、3点、$ 等）
  - 命中用户关键词中的专名/术语
  - 命中"小型风险词表"（静态表）
  - dedup 裁剪量异常高（边界抖动信号）

**跳过条件**：
- 文本过长且质量高
- 同一 commit 已复核（幂等）

#### 2. Rescorer（`src/asr/rescorer.ts`）
**功能**：对候选进行打分，选择最优文本

**打分规则**：
- **RuleScore**（必须）：
  - 数字保护（数字/单位保持合理）
  - 专名保护（命中用户关键词更多者优先）
  - 重复惩罚（我们我们、and and）
  - 字符集合理性（CJK/Latin 协调）
  - 长度合理性（只有语气词/极短扣分）
- **ContextScore**（推荐）：
  - 与 `recent_committed_text` 的关键词重合度
  - 与上文一致性（弱约束）
- **NmtScore**（可选，受限）：
  - 仅用于择优打分，不改写文本
  - 只对 top2 候选计算，避免影响吞吐

**最终分数**：
```
Score = w_rule*RuleScore + w_ctx*ContextScore + w_nmt*NmtScore(optional)
```

**回退机制**：
- 如果最佳候选的分数提升 < `delta_margin`，保持使用 primary 文本

#### 3. CandidateProvider（`src/asr/candidate-provider.ts`）
**功能**：生成候选文本

**当前状态**：
- ⚠️ **只返回 primary 候选**，没有真正的候选（N-best 或二次解码）
- 原因：
  - Faster-Whisper 不支持 N-best（已验证）
  - 二次解码已禁用（GPU 占用过高）

**预期功能**（未实现）：
- **S2-A：ASR N-best**（一次解码输出 3-5 个候选）- 不可行
- **S2-B：二次解码**（同一音频再跑一次更保守解码）- 已实现但已禁用

#### 4. 二次解码（已实现但已禁用）

**组件**：
- `AudioRingBuffer`（`src/asr/audio-ring-buffer.ts`）：音频 ring buffer，缓存最近 5-15 秒音频
- `SecondaryDecodeWorker`（`src/asr/secondary-decode-worker.ts`）：二次解码 worker

**配置**：
- `beamSize`: 15（比 primary 的 10 更大）
- `patience`: 2.0（比 primary 的 1.0 更高）
- `temperature`: 0.0（更确定）
- `bestOf`: 5
- `maxConcurrency`: 1（串行执行）
- `maxQueueLength`: 3（超过则降级）

**禁用原因**：
- GPU 占用过高（约 2.5 倍），导致"没有可用节点"的错误

#### 5. AggregatorMiddleware 集成
**位置**：`src/aggregator/aggregator-middleware.ts`

**功能**：
- 在 commit 后触发 S2 rescoring
- 集成 `NeedRescoreDetector`、`Rescorer`、`CandidateProvider`
- 添加 trace 信息（`rescoreApplied`, `rescoreReasons`, `rescoreAddedLatencyMs`）

**当前行为**：
1. `NeedRescoreDetector` 检测到需要 rescoring
2. `CandidateProvider` 只返回 primary 文本（没有 N-best 或二次解码）
3. 如果只有 primary，跳过 rescoring（避免无意义的处理）
4. 记录日志：`S2: Rescoring skipped, no actual candidates generated`

#### 6. AggregatorState 扩展
**位置**：`src/aggregator/aggregator-state.ts`

**功能**：
- 添加 `recentCommittedText`、`recentKeywords`、`lastCommitQuality` 字段
- 提供获取/更新方法
- 用于 S1 Prompt 构建和 S2 ContextScore 计算

### 数据流

```
1. Job 到达
   ↓
2. Aggregator 处理（文本聚合、去重）
   ↓
3. Aggregator commit（文本稳定）
   ↓
4. NeedRescoreDetector.detect() - 判断是否需要 rescoring
   ↓
5. 如果需要 rescoring:
   - CandidateProvider.provide() - 生成候选
     - primary 候选（当前只有这个）
     - secondary_decode 候选（已禁用）
   ↓
6. Rescorer.rescore() - 对候选打分
   ↓
7. 选择最佳候选（如果分数提升 > delta_margin）
   ↓
8. 返回最终文本
```

### 状态
⚠️ **60% 完成，框架已实现但实际 rescoring 未启用**

**已完成**：
- ✅ NeedRescoreDetector（触发条件检测）
- ✅ Rescorer（打分逻辑）
- ✅ AggregatorMiddleware 集成
- ✅ Trace/埋点

**未完成/已禁用**：
- ❌ CandidateProvider（只返回 primary，没有真正的候选）
- ❌ 二次解码（已实现但已禁用，GPU 占用过高）
- ❌ N-best（Faster-Whisper 不支持）

---

## 总结

### S1: Prompt Bias
- **完成度**：✅ **100%**
- **状态**：✅ **已启用**
- **功能**：在 ASR 解码时注入关键词和最近上下文，提升识别准确率
- **影响**：延迟增加 < 10ms，内存增加约几KB/session

### S2: Rescoring
- **完成度**：⚠️ **60%**
- **状态**：⚠️ **框架已实现，但实际 rescoring 未启用**
- **功能**：对短句/低质量文本生成候选并选择最优
- **问题**：缺少真正的候选生成（N-best 不支持，二次解码已禁用）

### 当前效果
- **S1**: ✅ 正常工作，应该能提升识别准确率
- **S2**: ⚠️ 无法真正工作，因为缺少候选生成

### 下一步
如果要启用 S2，需要：
1. 实现真正的候选生成（但 N-best 不支持，二次解码 GPU 占用过高）
2. 或者优化二次解码的 GPU 占用
3. 或者寻找其他候选生成方案

