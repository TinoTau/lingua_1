# 语义修复功能文档

## 概述

语义修复功能用于修复 ASR 识别错误，通过 LLM 对 ASR 文本进行语义理解和修复，提高翻译准确度。

## 架构设计

### 服务包机制

语义修复服务作为**独立服务包**，用户可以选择性安装。系统通过**服务发现机制**自动检测已安装的服务，并启用对应的功能。

- 遵循现有的服务注册表机制（`ServiceRegistryManager`）
- 类似 ASR、NMT、TTS 服务的发现和启用方式
- 用户安装服务包 → 系统自动检测 → 自动启用功能
- **无需配置开关**：功能启用由已安装的服务决定

### 服务包结构

#### 中文语义修复服务包
```
semantic-repair-zh/
  ├─ service.json
  ├─ models/
  │   └─ qwen2.5-3b-instruct-zh/  (中文优化模型，INT4量化)
  └─ platforms/
      ├─ windows/
      ├─ linux/
      └─ darwin/
```

#### 英文语义修复服务包
```
semantic-repair-en/
  ├─ service.json
  ├─ models/
  │   └─ qwen2.5-3b-instruct-en/  (英文优化模型)
  └─ platforms/
      ├─ windows/
      ├─ linux/
      └─ darwin/
```

### 推荐模型

- **中文**：Qwen2.5-3B-Instruct（中文优化版本，INT4量化）
  - 显存需求：~2GB
  - 推理速度：50-200ms/句
  - 商用许可：✅
- **英文**：Qwen2.5-3B-Instruct（英文优化版本，INT4量化）
  - 显存需求：~2GB
  - 推理速度：50-200ms/句

## 处理流程

### 阶段位置

语义修复在 **AggregationStage 之后、TranslationStage 之前**执行：

```
ASR → Aggregation → Semantic Repair → Translation → TTS
```

### 处理步骤

1. **文本聚合**：AggregationStage 聚合多个 utterance 的文本
2. **内部重复检测**：检测并移除文本内部重复（叠字叠词）
3. **语义修复**：
   - 获取微上下文（上一句尾部，用于语义修复）
   - 调用语义修复服务
   - 根据修复结果决定是否使用修复后的文本
4. **翻译**：使用修复后的文本进行翻译

### 修复决策

语义修复服务返回以下决策：

- **REPAIR**：文本被修复，使用修复后的文本
- **PASS**：文本无需修复，使用原文
- **REJECT**：文本被拒绝，使用原文

## 评分机制

### 评分因素

1. **质量分**：ASR 质量分数（quality_score）
2. **短句检测**：文本长度 <= 16 字符
3. **非中文比例**：非中文字符比例
4. **句法检查**：基本句法结构
5. **垃圾字符检测**：检测异常字符

### 评分权重

- 质量分权重：0.4
- 短句权重：0.3
- 非中文比例权重：0.15
- 句法权重：0.1
- 垃圾字符权重：0.05

## 热插拔支持

### 版本控制

- 使用版本号确保并发安全
- 重新初始化时，正在进行的任务使用旧版本
- 新任务使用新版本

### 重新初始化

```typescript
await postProcessCoordinator.reinitializeSemanticRepairStage();
```

## GPU 集成

### 忙时降级

- **优先级**：20（低优先级）
- **忙时策略**：SKIP（跳过）
- **GPU 忙碌时**：自动跳过语义修复，不影响主链路

### GPU 租约

语义修复通过 GPU 仲裁器获取 GPU 租约：

```typescript
await withGpuLease(
  'SEMANTIC_REPAIR',
  async (lease) => {
    return await semanticRepairStage.process(...);
  },
  { jobId, sessionId, utteranceIndex, stage: 'SemanticRepair' }
);
```

## 配置

### 服务配置

在 `service.json` 中配置：

```json
{
  "service_id": "semantic-repair-zh",
  "name": "中文语义修复服务",
  "type": "semantic-repair",
  "lang": "zh",
  "model": {
    "name": "qwen2.5-3b-instruct",
    "quantization": "int4"
  }
}
```

### 评分配置

在 `electron-node-config.json` 中配置：

```json
{
  "semanticRepair": {
    "qualityThreshold": 0.70,
    "shortSentenceLength": 16,
    "nonChineseRatioThreshold": 0.3,
    "qualityScoreWeight": 0.4,
    "shortSentenceWeight": 0.3,
    "nonChineseRatioWeight": 0.15,
    "syntaxWeight": 0.1,
    "garbageCharWeight": 0.05
  }
}
```

## 日志记录

### 关键日志

- `SemanticRepairStage: Starting semantic repair`：开始修复
- `SemanticRepairStage: Repair completed`：修复完成
- `SemanticRepairStage: Repair service error`：服务错误

### 日志内容

- `decision`：修复决策（REPAIR/PASS/REJECT）
- `confidence`：修复置信度
- `reasonCodes`：修复原因代码
- `repairTimeMs`：修复耗时

## 相关文档

- `GPU/GPU_ARBITER.md`：GPU 仲裁器文档
- `SEQUENTIAL_EXECUTION_IMPLEMENTATION.md`：顺序执行管理器
