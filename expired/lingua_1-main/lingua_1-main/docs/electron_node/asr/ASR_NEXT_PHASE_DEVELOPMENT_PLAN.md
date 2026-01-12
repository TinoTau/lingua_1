# ASR 准确率提升 - 下一阶段开发计划

## 当前阶段完成情况

### ✅ P0 功能已完成（当前阶段）

1. **边界稳态化（EDGE）** ✅
   - EDGE-1: 统一 finalize 接口
   - EDGE-2/3: Hangover 延迟（自动/手动）
   - EDGE-4: Padding（尾部补静音）
   - EDGE-5: Short-merge（短片段合并）

2. **置信度与 Segments 时间戳（CONF）** ✅
   - CONF-1: 语言置信度分级逻辑
   - CONF-2: Segment 时间戳提取
   - CONF-3: 基于 segments 时间戳的断裂/异常检测

3. **坏段判定器（RERUN-1）** ✅
   - 低置信 + 短文本检测
   - 乱码检测
   - 与上一段高度重叠检测
   - 整合 CONF-3 检测结果

---

## 下一阶段开发内容

### 阶段 1: P0 补充功能（建议优先完成）

#### EPIC-ASR-P0-OBS：指标与日志（P0）

**目标**: 为后续优化提供观测数据，支持 A/B 测试和效果评估

##### OBS-1: 埋点指标 ✅ 待实现
- **功能**: 添加关键指标埋点
- **指标列表**:
  - `asr_e2e_latency`: ASR 端到端延迟（p50/p95/p99）
  - `lang_prob_distribution`: 语言置信度分布统计
  - `bad_segment_rate`: 坏段检测率
  - `rerun_trigger_rate`: 重跑触发率（为后续 RERUN-2 准备）
- **实现位置**:
  - 节点端: `electron_node/electron-node/main/src/task-router/task-router.ts`
  - 调度服务器: `central_server/scheduler/src/websocket/session_actor/actor.rs`
- **预计工期**: 0.5 天

##### OBS-2: reason_codes 与 quality_score 透传 ✅ 待实现
- **功能**: 将坏段检测结果透传到 Web 客户端
- **数据流**: Node → Scheduler → Web Client
- **新增字段**:
  ```typescript
  interface TranslationResultMessage {
    // ... 现有字段
    asr_quality_level?: 'good' | 'suspect' | 'bad';
    reason_codes?: string[];
    quality_score?: number;  // 0.0-1.0
    rerun_count?: number;
    segments_meta?: {
      count: number;
      max_gap: number;  // 最大间隔（秒）
      avg_duration: number;  // 平均时长（秒）
    };
  }
  ```
- **实现位置**:
  - 节点端: `electron_node/electron-node/main/src/task-router/task-router.ts`
  - 调度服务器: `central_server/scheduler/src/websocket/node_handler/message/job_result.rs`
  - Web 客户端: `webapp/web-client/src/types.ts`
- **预计工期**: 0.5 天

##### OBS-3: 限频/超时机制 ✅ 待实现
- **功能**: 限制重跑次数和超时，防止性能问题
- **配置项**:
  ```rust
  // config.toml
  [scheduler.asr_rerun]
  max_rerun_count = 2  // 最多重跑 2 次
  rerun_timeout_ms = 5000  // 单次重跑超时 5 秒
  conference_mode_strict = true  // 会议室模式更严格
  ```
- **实现位置**:
  - 调度服务器: `central_server/scheduler/src/core/config.rs`
  - 节点端: `electron_node/electron-node/main/src/task-router/task-router.ts`
- **预计工期**: 0.5 天

**总计**: 1.5 天

---

### 阶段 2: P1 核心功能（自动补救机制）

#### EPIC-ASR-P1-RERUN：Top-2 语言重跑（P1）

**目标**: 当检测到坏段时，自动使用 Top-2 语言重跑 ASR，提高准确率

##### RERUN-2: Top-2 强制语言重跑 ✅ 待实现
- **功能**: 当 `badSegmentDetection.isBad === true` 时，使用 Top-2 语言强制重跑
- **触发条件**:
  - `badSegmentDetection.isBad === true`
  - `rerun_count < max_rerun_count`（默认 2）
  - `language_probabilities` 存在且 Top-2 语言不同
- **实现逻辑**:
  ```typescript
  // 伪代码
  if (badSegmentDetection.isBad && rerunCount < 2) {
    const top2Langs = getTop2Languages(asrResult.language_probabilities);
    for (const lang of top2Langs) {
      if (lang !== asrResult.language) {
        const rerunResult = await rerunASR(audio, lang, forced=true);
        if (rerunResult.qualityScore > asrResult.qualityScore) {
          return rerunResult;  // 选择质量更高的结果
        }
      }
    }
  }
  ```
- **实现位置**:
  - 节点端: `electron_node/electron-node/main/src/task-router/task-router.ts`
  - ASR 服务: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`
- **预计工期**: 1.0 天

##### RERUN-3: 质量评分选择器 ✅ 待实现
- **功能**: 完善 `quality_score` 计算公式，用于选择最佳 ASR 结果
- **公式**:
  ```typescript
  qualityScore = 
    baseScore * 0.3 +           // 基础分（文本长度）
    langProbScore * 0.3 +       // 语言置信度分
    garbagePenalty * 0.2 +      // 乱码惩罚
    segmentPenalty * 0.1 +      // segments 异常惩罚
    overlapPenalty * 0.1        // 重叠惩罚
  ```
- **实现位置**:
  - 节点端: `electron_node/electron-node/main/src/task-router/bad-segment-detector.ts`
- **预计工期**: 0.5 天

**总计**: 1.5 天

---

### 阶段 3: P1 高级功能（可选，根据效果决定）

#### EPIC-ASR-P1-WORD：Word-level 置信度（P1，可选）

**目标**: 在坏段触发时启用词级别置信度，定位低置信词

##### WORD-1: 在坏段触发时启用 `word_timestamps=True` ✅ 待实现
- **功能**: 当检测到坏段时，使用 `word_timestamps=True` 重新识别
- **触发条件**: `badSegmentDetection.isBad === true`
- **性能影响**: 增加 10-20% 处理时间（需实测）
- **实现位置**:
  - ASR 服务: `electron_node/services/faster_whisper_vad/asr_worker_process.py`
- **预计工期**: 0.5 天

##### WORD-2: 低置信词比例与低置信词列表计算 ✅ 待实现
- **功能**: 计算低置信词比例，生成低置信词列表
- **输出**:
  ```typescript
  interface WordConfidenceInfo {
    lowConfidenceWordRatio: number;  // 低置信词比例
    lowConfidenceWords: Array<{
      word: string;
      probability: number;
      start: number;
      end: number;
    }>;
  }
  ```
- **实现位置**:
  - ASR 服务: `electron_node/services/faster_whisper_vad/asr_worker_process.py`
  - 节点端: `electron_node/electron-node/main/src/task-router/task-router.ts`
- **预计工期**: 0.5 天

**总计**: 1.0 天

---

#### EPIC-ASR-P1-HOMOPHONE：同音候选生成与重排（中文）（P1）

**目标**: 针对中文同音词错误，生成候选并重排择优

##### HMP-1: Glossary 接口 ✅ 待实现
- **功能**: 提供术语表接口，支持会议室/线下模式配置
- **配置**:
  ```toml
  [scheduler.asr_glossary]
  enabled = true
  conference_mode_words = ["会议室", "项目", "方案"]
  offline_mode_words = ["线下", "面对面"]
  ```
- **实现位置**:
  - 调度服务器: `central_server/scheduler/src/core/config.rs`
  - 节点端: `electron_node/electron-node/main/src/task-router/task-router.ts`
- **预计工期**: 1.0 天

##### HMP-2: 同音/近音候选生成器 ✅ 待实现
- **功能**: 对疑似低置信词生成 3-10 个同音/近音替换候选
- **触发条件**:
  - 检测到疑似关键字 span（低置信词或 glossary 词写错）
  - 且该 span 属于中文（CJK 占比高）
- **限制**:
  - 只替换 1 个 span（一次只改一个词）
  - 候选数上限 10
- **实现位置**:
  - 节点端: `electron_node/electron-node/main/src/task-router/homophone-candidate-generator.ts`（新建）
- **依赖库**: 需要调研中文同音词库（如 `pypinyin`、`jieba` 等）
- **预计工期**: 2.0 天

##### HMP-3: 候选重排：规则/术语综合打分 ✅ 待实现
- **功能**: 对每个候选计算综合分数，选择最高者
- **打分规则**:
  ```typescript
  candidateScore = 
    baseScore * 0.3 +           // 基础分
    langProbScore * 0.2 +       // 语言置信度
    glossaryBonus * 0.3 +       // Glossary 命中奖励
    glossaryPenalty * 0.2       // Glossary 词写错惩罚
  ```
- **实现位置**:
  - 节点端: `electron_node/electron-node/main/src/task-router/candidate-reranker.ts`（新建）
- **预计工期**: 1.0 天

##### HMP-4: （可选）引入轻量 LM 打分 ✅ 待实现
- **功能**: 使用轻量语言模型对候选打分
- **性能要求**: GPU 批处理、超时保护
- **实现位置**:
  - 节点端: `electron_node/electron-node/main/src/task-router/lm-scorer.ts`（新建）
- **预计工期**: 2.0 天

**总计**: 6.0 天（HMP-4 可选）

---

### 阶段 4: 测试与优化（P0/P1）

#### EPIC-ASR-QA：A/B 与压测

##### QA-1: A/B 分桶 ✅ 待实现
- **功能**: 按 sessionId/roomId hash 进行 A/B 分桶
- **实现位置**:
  - 调度服务器: `central_server/scheduler/src/core/config.rs`
- **预计工期**: 0.5 天

##### QA-2: 回放用例 ✅ 待实现
- **功能**: 手动截断/停顿/多语切换场景的回放测试
- **测试用例**:
  - 手动截断场景
  - 长停顿场景
  - 多语言切换场景
  - 低置信度场景
- **预计工期**: 1.0 天

##### QA-3: 会议室压测 ✅ 待实现
- **功能**: 测试吞吐、p95 延迟、rerun 触发率
- **指标**:
  - 吞吐量（QPS）
  - p95 延迟
  - rerun 触发率
  - 坏段检测率
- **预计工期**: 1.0 天

**总计**: 2.5 天

---

## 建议实施顺序

### 最短路径（推荐）

1. **第一阶段（1.5 天）**: P0 补充功能
   - OBS-1/2/3: 指标与日志、透传、限频机制
   - **目标**: 为后续优化提供观测数据

2. **第二阶段（1.5 天）**: P1 核心功能
   - RERUN-2/3: Top-2 语言重跑 + 质量评分选择器
   - **目标**: 实现自动补救机制

3. **第三阶段（可选，根据效果决定）**:
   - **选项 A**: WORD-1/2（词级别置信度，1.0 天）
   - **选项 B**: HMP-1/2/3（同音候选生成，4.0 天）
   - **选项 C**: 先做 A/B 测试，根据数据决定

4. **第四阶段（2.5 天）**: 测试与优化
   - QA-1/2/3: A/B 分桶、回放用例、压测

### 完整路径（如果资源充足）

1. **第一阶段**: P0 补充功能（1.5 天）
2. **第二阶段**: P1 核心功能（1.5 天）
3. **第三阶段**: P1 高级功能（7.0 天）
   - WORD-1/2（1.0 天）
   - HMP-1/2/3（4.0 天）
   - HMP-4（可选，2.0 天）
4. **第四阶段**: 测试与优化（2.5 天）

**总计**: 12.5 天（不含 HMP-4）或 14.5 天（含 HMP-4）

---

## 关键依赖关系

### 必须按顺序实现

1. **OBS-2** → **RERUN-2**: 需要先透传 `reason_codes` 和 `quality_score`
2. **RERUN-2** → **RERUN-3**: 需要质量评分选择器来选择最佳结果
3. **WORD-1** → **WORD-2**: 需要先启用 `word_timestamps`
4. **HMP-1** → **HMP-2/3**: 需要先有 Glossary 接口
5. **HMP-2** → **HMP-3**: 需要先有候选生成器

### 可以并行实现

- OBS-1 和 OBS-2 可以并行
- RERUN-2 和 RERUN-3 可以并行（但建议先 RERUN-2）
- WORD-1/2 和 HMP-1/2/3 可以并行（但建议先 WORD）

---

## 风险评估

### 技术风险

| 功能 | 风险等级 | 风险描述 | 缓解措施 |
|-----|---------|---------|---------|
| RERUN-2 | 中 | 重跑可能增加延迟 | 限频机制、超时保护 |
| WORD-1 | 中 | 性能开销 10-20% | 仅坏段触发，限频 |
| HMP-2 | 高 | 中文同音词库依赖 | 提前调研，准备备选方案 |
| HMP-4 | 高 | LM 模型资源占用 | 可选功能，先做规则版 |

### 业务风险

| 功能 | 风险等级 | 风险描述 | 缓解措施 |
|-----|---------|---------|---------|
| 重跑机制 | 中 | 可能影响用户体验（延迟） | A/B 测试验证效果 |
| 同音候选 | 低 | 可能误判 | 严格触发条件，质量评分 |

---

## 验收标准

### 阶段 1（P0 补充功能）

- [ ] OBS-1: 埋点指标正确记录
- [ ] OBS-2: `reason_codes` 和 `quality_score` 正确透传到 Web
- [ ] OBS-3: 限频机制正确工作，超时保护生效

### 阶段 2（P1 核心功能）

- [ ] RERUN-2: 坏段触发时自动重跑 Top-2 语言
- [ ] RERUN-3: 质量评分选择器正确选择最佳结果
- [ ] 重跑次数限制正确工作
- [ ] 重跑超时保护生效

### 阶段 3（P1 高级功能）

- [ ] WORD-1: 坏段触发时正确启用 `word_timestamps`
- [ ] WORD-2: 低置信词比例和列表正确计算
- [ ] HMP-1: Glossary 接口正确配置和使用
- [ ] HMP-2: 同音候选生成器正确生成候选
- [ ] HMP-3: 候选重排器正确打分和选择

### 阶段 4（测试与优化）

- [ ] QA-1: A/B 分桶正确工作
- [ ] QA-2: 回放用例全部通过
- [ ] QA-3: 压测指标符合预期

---

## 总结

### 下一阶段重点

1. **优先完成 P0 补充功能**（指标与日志），为后续优化提供数据支撑
2. **实现 P1 核心功能**（Top-2 语言重跑），实现自动补救机制
3. **根据效果决定**是否实现 P1 高级功能（词级别置信度、同音候选生成）

### 预计工作量

- **最短路径**: 5.5 天（P0 补充 + P1 核心 + 测试）
- **完整路径**: 12.5-14.5 天（包含所有 P1 功能）

### 建议

1. **先完成阶段 1 和阶段 2**，验证自动补救机制的效果
2. **进行 A/B 测试**，根据数据决定是否继续实现阶段 3
3. **优先实现 WORD-1/2**（词级别置信度），为同音候选生成提供基础

---

**文档版本**: v1.0  
**最后更新**: 2024年12月

