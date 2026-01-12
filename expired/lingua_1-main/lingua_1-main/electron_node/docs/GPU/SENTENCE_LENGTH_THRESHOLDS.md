# 各服务短句/长句判断标准汇总

## ✅ 统一标准（已统一为16字符）

**统一标准**: 所有服务统一使用 **16字符** 作为短句/长句的判断标准（与SemanticRepairScorer保持一致）

### 统一后的标准：

- **< 6字符**: 直接丢弃（太短，无意义）
- **6-16字符**: 短句，等待与下一句合并（3秒超时）
- **> 16字符**: 长句，发送给语义修复服务进行输出

---

## 历史标准（已废弃，仅供参考）

### 1. TextForwardMergeManager (PostASR向前合并) ✅ 已统一
- **MIN_LENGTH_TO_KEEP = 6字符** (最小保留长度)
- **MIN_LENGTH_TO_SEND = 16字符** (最小发送长度，统一使用SemanticRepairScorer的标准)
- **< 6字符**: 直接丢弃
- **6-16字符**: 等待与下一句合并（3秒超时）
- **> 16字符**: 发送给语义修复服务

**位置**: `electron_node/electron-node/main/src/agent/postprocess/text-forward-merge-manager.ts`

### 2. AggregatorStateTextProcessor (文本去重) ✅ 已统一
- **text.length <= 16**: 认为是短句，避免误判为重复（统一使用SemanticRepairScorer的标准）

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state-text-processor.ts`

### 3. AggregationStage (检测不完整句子) ✅ 已统一
- **trimmed.length < 16**: 可能是不完整句子（统一使用SemanticRepairScorer的标准）

**位置**: `electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`

### 4. TranslationStage (翻译阶段) ✅ 已统一
- **trimmed.length < 16**: 可能是不完整句子（统一使用SemanticRepairScorer的标准）

**位置**: `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

### 5. SemanticRepairScorer (语义修复评分器)
- **shortSentenceLength = 16字符** (短句长度阈值，默认值)

**位置**: `electron_node/electron-node/main/src/agent/postprocess/semantic-repair-scorer.ts`

### 6. SemanticRepairStageZH (语义修复阶段)
- **SHORT_SENTENCE_LENGTH = 16字符**

**位置**: `electron_node/electron-node/main/src/agent/postprocess/semantic-repair-stage-zh.ts`

### 7. AggregatorDecision (聚合决策)
- **shortCjkChars**: room模式=9字符, offline模式=10字符 (CJK短句阈值)
- **veryShortCjkChars**: 4字符 (CJK极短句阈值)
- **shortEnWords**: room模式=5词, offline模式=6词 (英文短句阈值)
- **veryShortEnWords**: 3词 (英文极短句阈值)

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-decision.ts`

### 8. NeedRescore (ASR重评分) ✅ 已统一
- **shortCjkChars**: 16字符（统一使用SemanticRepairScorer的标准）
- **shortEnWords**: 9词

**位置**: `electron_node/electron-node/main/src/asr/need-rescore.ts`

### 9. BadSegmentDetector (坏段检测) ✅ 已统一
- **text.trim().length < 16**: 短文本（统一使用SemanticRepairScorer的标准）

**位置**: `electron_node/electron-node/main/src/task-router/bad-segment-detector.ts`

## ✅ 统一完成

所有服务已统一使用 **16字符** 作为短句/长句的判断标准，与SemanticRepairScorer保持一致。

### 统一后的影响：

- **TextForwardMergeManager**: 6-16字符的文本会等待与下一句合并，> 16字符才发送给语义修复
- **SemanticRepairScorer**: <= 16字符认为是短句，增加修复评分
- **NeedRescore**: < 16字符(CJK)触发重评分
- 所有服务现在使用一致的标准，避免了10-16字符文本的处理不一致问题

## 历史建议（已实施）

### 方案1：统一使用10字符作为短句阈值
- **优点**: 与大部分服务一致（TextForwardMergeManager, AggregatorStateTextProcessor, AggregationStage, TranslationStage, BadSegmentDetector）
- **缺点**: 需要修改 SemanticRepairScorer (16 -> 10) 和 NeedRescore (18 -> 10)

### 方案2：统一使用16字符作为短句阈值
- **优点**: 与语义修复服务一致
- **缺点**: 需要修改 TextForwardMergeManager (10 -> 16) 和其他多个服务

### 方案3：保持当前标准，但明确各服务的职责
- **TextForwardMergeManager**: 6/10字符（用于决定是否等待合并）
- **SemanticRepairScorer**: 16字符（用于语义修复评分）
- **NeedRescore**: 18字符（用于ASR重评分）
- **AggregatorDecision**: 9-10字符（用于聚合决策）

## 当前实际使用的标准

根据代码分析，当前系统实际使用的标准：

1. **PostASR阶段（TextForwardMergeManager）**:
   - < 6字符: 丢弃
   - 6-10字符: 等待合并
   - > 10字符: 发送给语义修复

2. **语义修复阶段（SemanticRepairScorer）**:
   - <= 16字符: 认为是短句，增加修复评分
   - > 16字符: 正常处理

3. **ASR重评分（NeedRescore）**:
   - < 18字符(CJK) 或 < 9词(EN): 触发重评分

4. **聚合决策（AggregatorDecision）**:
   - < 9-10字符(CJK) 或 < 5-6词(EN): 认为是短句，增加合并倾向

## 统一后的标准说明

所有服务已统一使用 **16字符** 作为短句/长句的判断标准：

1. **统一标准的好处**：
   - 避免不同服务对同一文本做出不同的判断
   - 简化维护和理解
   - 确保整个系统的行为一致性

2. **具体实现**：
   - **TextForwardMergeManager**: 6-16字符等待合并，> 16字符发送给语义修复
   - **SemanticRepairScorer**: <= 16字符认为是短句，增加修复评分
   - **NeedRescore**: < 16字符(CJK)触发重评分
   - **其他服务**: 统一使用16字符作为短句判断标准

3. **保留的特殊情况**：
   - **< 6字符**: 所有服务都认为太短，直接丢弃
   - **AggregatorDecision**: 仍然使用CJK字符数和英文单词数，因为这是基于语言特性的判断
