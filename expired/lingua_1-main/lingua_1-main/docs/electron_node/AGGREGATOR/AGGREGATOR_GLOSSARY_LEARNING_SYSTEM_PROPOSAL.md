# Glossary 学习系统需求说明

**文档版本**：v1.0  
**日期**：2025-01-XX  
**状态**：📋 提案阶段

---

## 1. 需求概述

### 1.1 背景

当前系统已实现：
- ✅ **NMT Repair**：通过候选生成和打分修复 ASR 识别错误
- ✅ **同音字自动学习**：从修复结果中自动学习错误模式
- ✅ **文本质量评分**：基于语言置信度、文本长度、segments 等信息计算质量分数

**问题**：
- 当前方案是"事后修复"（修复已发生的错误）
- 同音字学习依赖 NMT 修复结果，学习效率有限
- 无法利用高质量的长文本数据来改进短文本识别

### 1.2 目标

**核心目标**：通过积累高质量 ASR 识别数据，构建动态 Glossary 系统，让 ASR 服务能够通过用户的长期使用持续提高准确率。

**关键思路**：
1. **长文本验证短文本**：利用长文本（准确率较高）来验证和校准短文本
2. **质量驱动的学习**：基于文本质量分数筛选高质量数据
3. **Glossary 动态扩充**：将验证后的高质量文本片段加入 Glossary
4. **预防性改进**：通过 Glossary 在识别阶段就避免错误，而非事后修复

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web 客户端                                 │
│                    (用户语音输入)                                 │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      调度服务器 (Scheduler)                        │
│                    (任务分发、Glossary 管理)                        │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        节点端 (Node)                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ASR 服务 (Faster Whisper)                                │  │
│  │  - 使用 Glossary 进行识别                                 │  │
│  │  - 返回识别文本 + 质量分数                                 │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                           │
│                       ▼                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Aggregator 中间件                                        │  │
│  │  - 文本聚合、去重、边界重建                                │  │
│  │  - 质量评分和验证                                         │  │
│  │  - 长文本验证短文本                                       │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                           │
│                       ▼                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Glossary 学习系统 (新增)                                  │  │
│  │  - 高质量文本收集                                         │  │
│  │  - 长文本验证短文本                                       │  │
│  │  - Glossary 候选生成                                      │  │
│  │  - 质量评估和筛选                                         │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                           │
│                       ▼                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  NMT 服务 (M2M100)                                        │  │
│  │  - 翻译识别文本                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Glossary 存储层 (新增)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  本地 Glossary (节点端)                                    │  │
│  │  - 高质量文本片段库                                       │  │
│  │  - 同音字映射表                                           │  │
│  │  - 质量分数历史                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  全局 Glossary (调度服务器)                                │  │
│  │  - 跨节点共享的高质量数据                                  │  │
│  │  - 用户自定义术语                                          │  │
│  │  - 领域特定词汇                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 Glossary 学习系统 (Glossary Learning System)

**位置**：`electron_node/electron-node/main/src/aggregator/glossary-learning-system.ts`

**职责**：
1. **高质量文本收集**：收集质量分数高的长文本
2. **长文本验证短文本**：使用长文本片段验证短文本识别结果
3. **Glossary 候选生成**：从验证结果中提取候选术语
4. **质量评估和筛选**：评估候选术语的质量，筛选高置信度条目
5. **Glossary 更新**：将验证后的条目加入 Glossary

#### 2.2.2 Glossary 管理器 (Glossary Manager)

**位置**：`electron_node/electron-node/main/src/aggregator/glossary-manager.ts`

**职责**：
1. **Glossary 加载**：从本地和全局存储加载 Glossary
2. **Glossary 查询**：快速查询术语和同音字映射
3. **Glossary 更新**：更新本地和全局 Glossary
4. **Glossary 同步**：与调度服务器同步 Glossary

#### 2.2.3 文本质量评估器 (Text Quality Assessor)

**位置**：`electron_node/electron-node/main/src/aggregator/text-quality-assessor.ts`

**职责**：
1. **质量分数计算**：基于多个维度计算文本质量分数
2. **长文本识别**：识别高质量的长文本（> 50 字符，质量分数 > 0.8）
3. **短文本验证**：使用长文本验证短文本识别结果
4. **置信度评估**：评估验证结果的置信度

---

## 3. 业务流程

### 3.1 核心流程：长文本验证短文本

```
┌─────────────────────────────────────────────────────────────────┐
│  1. ASR 识别                                                     │
│     - 输入：音频片段                                             │
│     - 输出：识别文本 + 质量分数                                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 质量评估                                                     │
│     - 计算质量分数（语言置信度、文本长度、segments 等）          │
│     - 判断是否为高质量长文本（> 50 字符，质量分数 > 0.8）       │
└────────────────────┬────────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌─────────────────┐   ┌─────────────────┐
│ 高质量长文本     │   │ 短文本/低质量    │
│ (> 50 字符)      │   │ (< 50 字符)      │
└────────┬────────┘   └────────┬────────┘
         │                      │
         │                      ▼
         │            ┌─────────────────┐
         │            │ 3. 长文本验证    │
         │            │    - 查找匹配的  │
         │            │      长文本片段  │
         │            │    - 验证短文本 │
         │            │      识别结果   │
         │            └────────┬────────┘
         │                     │
         │                     ▼
         │            ┌─────────────────┐
         │            │ 4. 候选生成      │
         │            │    - 提取验证后  │
         │            │      的术语片段  │
         │            │    - 生成同音字  │
         │            │      映射候选    │
         │            └────────┬────────┘
         │                     │
         │                     ▼
         │            ┌─────────────────┐
         │            │ 5. 质量评估      │
         │            │    - 计算置信度  │
         │            │    - 筛选高置信  │
         │            │      度条目      │
         │            └────────┬────────┘
         │                     │
         └─────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Glossary 更新                                               │
│     - 将验证后的条目加入本地 Glossary                            │
│     - 定期同步到全局 Glossary                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 详细流程说明

#### 阶段 1：ASR 识别和质量评估

**输入**：
- 音频片段
- 当前 Glossary（可选）

**处理**：
1. ASR 服务使用 Glossary 进行识别
2. 计算质量分数：
   - 语言置信度（`language_probability`）
   - 文本长度（归一化）
   - Segments 质量（gap、duration 等）
   - 垃圾字符惩罚
   - 重复惩罚

**输出**：
- 识别文本
- 质量分数（0.0-1.0）
- 质量等级（good/suspect/bad）

#### 阶段 2：高质量长文本收集

**条件**：
- 文本长度 > 50 字符
- 质量分数 > 0.8
- 语言置信度 > 0.9

**处理**：
1. 将长文本存入"高质量文本库"
2. 提取关键术语片段（2-10 字符）
3. 记录术语片段的上下文和质量分数

**存储格式**：
```json
{
  "text": "现在让我们来测试一下这个版本的系统",
  "quality_score": 0.92,
  "language_probability": 0.95,
  "length": 18,
  "timestamp": 1234567890,
  "session_id": "s-xxx",
  "terms": [
    {
      "text": "版本",
      "start": 8,
      "end": 10,
      "context": "测试一下这个版本的系统",
      "quality_score": 0.92
    }
  ]
}
```

#### 阶段 3：长文本验证短文本

**触发条件**：
- 短文本（< 50 字符）或低质量文本（质量分数 < 0.7）
- 存在匹配的高质量长文本片段

**处理流程**：
1. **片段匹配**：
   - 在短文本中查找可能错误的片段（2-10 字符）
   - 在高质量文本库中查找相似片段
   - 计算相似度（编辑距离、字符匹配等）

2. **验证逻辑**：
   - 如果找到匹配的高质量片段：
     - 比较短文本片段和长文本片段
     - 如果差异明显（如"硬品" vs "音频"），标记为潜在错误
     - 计算验证置信度（基于匹配度、质量分数差异等）

3. **候选生成**：
   - 如果验证置信度 > 0.7，生成修复候选：
     - 原始片段（短文本中的）
     - 正确片段（长文本中的）
     - 同音字映射（如果适用）

**示例**：
```
短文本："现在有一段硬品被吃掉了"
匹配的长文本片段："现在有一段音频被吃掉了"（质量分数 0.92）
验证结果：
  - 错误片段："硬品"
  - 正确片段："音频"
  - 验证置信度：0.85
  - 生成候选：{"硬品": "音频"}
```

#### 阶段 4：Glossary 候选生成

**输入**：
- 验证结果（错误片段 → 正确片段）
- 验证置信度
- 上下文信息

**处理**：
1. **候选提取**：
   - 提取错误片段和正确片段
   - 提取上下文（前后各 5 个字符）
   - 计算候选质量分数

2. **同音字映射**：
   - 如果错误片段和正确片段是同音字，生成映射
   - 计算同音字置信度

3. **候选存储**：
   - 存入"Glossary 候选库"
   - 记录出现次数、置信度、上下文等

**存储格式**：
```json
{
  "error": "硬品",
  "correct": "音频",
  "confidence": 0.85,
  "count": 1,
  "contexts": [
    {
      "text": "现在有一段硬品被吃掉了",
      "quality_score": 0.65,
      "timestamp": 1234567890
    }
  ],
  "verified_by": [
    {
      "text": "现在有一段音频被吃掉了",
      "quality_score": 0.92,
      "timestamp": 1234567890
    }
  ],
  "last_updated": 1234567890
}
```

#### 阶段 5：质量评估和筛选

**处理**：
1. **置信度累积**：
   - 统计每个候选的出现次数
   - 计算平均置信度
   - 计算上下文一致性

2. **筛选条件**：
   - 出现次数 >= 2
   - 平均置信度 >= 0.75
   - 上下文一致性 >= 0.7

3. **质量评估**：
   - 计算最终质量分数
   - 如果质量分数 >= 0.8，标记为"高置信度"

#### 阶段 6：Glossary 更新

**处理**：
1. **本地 Glossary 更新**：
   - 将高置信度候选加入本地 Glossary
   - 更新同音字映射表
   - 记录更新时间

2. **全局 Glossary 同步**：
   - 定期（如每小时）将本地 Glossary 同步到调度服务器
   - 调度服务器合并多个节点的 Glossary
   - 分发更新的 Glossary 到所有节点

---

## 4. 技术实现

### 4.1 数据结构

#### 4.1.1 高质量文本库

```typescript
interface HighQualityText {
  text: string;                    // 完整文本
  quality_score: number;           // 质量分数 (0.0-1.0)
  language_probability: number;    // 语言置信度
  length: number;                  // 文本长度（字符数）
  timestamp: number;                // 时间戳
  session_id: string;               // 会话 ID
  terms: TermFragment[];           // 提取的术语片段
}

interface TermFragment {
  text: string;                    // 术语文本
  start: number;                   // 起始位置
  end: number;                     // 结束位置
  context: string;                 // 上下文（前后各 5 个字符）
  quality_score: number;           // 质量分数
}
```

#### 4.1.2 Glossary 候选

```typescript
interface GlossaryCandidate {
  error: string;                    // 错误片段
  correct: string;                 // 正确片段
  confidence: number;              // 置信度 (0.0-1.0)
  count: number;                   // 出现次数
  contexts: TextContext[];         // 上下文列表
  verified_by: HighQualityText[];  // 验证来源（长文本）
  last_updated: number;            // 最后更新时间
  is_homophone: boolean;          // 是否为同音字
}

interface TextContext {
  text: string;                    // 完整文本
  quality_score: number;           // 质量分数
  timestamp: number;                // 时间戳
}
```

#### 4.1.3 Glossary 条目

```typescript
interface GlossaryEntry {
  term: string;                    // 术语
  alternatives?: string[];        // 同音字替代（可选）
  confidence: number;              // 置信度
  count: number;                   // 使用次数
  contexts: string[];              // 常见上下文
  last_updated: number;            // 最后更新时间
  source: 'manual' | 'learned';   // 来源（手动/自动学习）
}
```

### 4.2 核心算法

#### 4.2.1 文本质量评分

```typescript
function calculateTextQuality(
  text: string,
  languageProbability: number,
  segments: SegmentInfo[],
  previousText?: string
): number {
  // 基础分：文本长度（归一化到 0-40）
  const lengthScore = Math.min(text.length * 0.8, 40);
  
  // 语言分：语言置信度（归一化到 0-30）
  const langScore = languageProbability * 30;
  
  // Segments 质量分（归一化到 0-20）
  const segScore = calculateSegmentsQuality(segments) * 20;
  
  // 垃圾字符惩罚（每字符 -2 分）
  const garbagePenalty = countGarbageChars(text) * 2;
  
  // 重复惩罚（与上一条高度重复时）
  const dupPenalty = previousText ? calculateDuplicatePenalty(text, previousText) : 0;
  
  // 综合评分
  const totalScore = lengthScore + langScore + segScore - garbagePenalty - dupPenalty;
  
  return Math.max(0, Math.min(100, totalScore)) / 100;  // 归一化到 0-1
}
```

#### 4.2.2 片段匹配算法

```typescript
function findMatchingFragments(
  shortText: string,
  highQualityTexts: HighQualityText[]
): MatchedFragment[] {
  const matches: MatchedFragment[] = [];
  
  // 提取短文本中的潜在错误片段（2-10 字符）
  const potentialErrors = extractPotentialErrors(shortText);
  
  for (const error of potentialErrors) {
    // 在高质量文本库中查找相似片段
    for (const hqText of highQualityTexts) {
      for (const term of hqText.terms) {
        const similarity = calculateSimilarity(error.text, term.text);
        
        if (similarity > 0.7) {  // 相似度阈值
          matches.push({
            error: error,
            correct: term,
            similarity: similarity,
            verified_by: hqText,
          });
        }
      }
    }
  }
  
  // 按相似度排序
  return matches.sort((a, b) => b.similarity - a.similarity);
}
```

#### 4.2.3 验证置信度计算

```typescript
function calculateVerificationConfidence(
  error: string,
  correct: string,
  verifiedBy: HighQualityText,
  shortTextQuality: number
): number {
  // 基础置信度：基于质量分数差异
  const qualityDiff = verifiedBy.quality_score - shortTextQuality;
  const baseConfidence = Math.min(1.0, 0.5 + qualityDiff * 0.5);
  
  // 相似度加成：错误和正确的相似度
  const similarity = calculateSimilarity(error, correct);
  const similarityBonus = similarity * 0.2;
  
  // 上下文一致性加成
  const contextConsistency = calculateContextConsistency(error, correct);
  const contextBonus = contextConsistency * 0.2;
  
  // 语言置信度加成
  const langBonus = verifiedBy.language_probability * 0.1;
  
  return Math.min(1.0, baseConfidence + similarityBonus + contextBonus + langBonus);
}
```

### 4.3 存储设计

#### 4.3.1 本地存储

**位置**：`electron_node/electron-node/data/`

**文件结构**：
```
data/
├── glossary/
│   ├── high-quality-texts.json      # 高质量文本库
│   ├── glossary-candidates.json     # Glossary 候选库
│   ├── local-glossary.json          # 本地 Glossary
│   └── homophone-mappings.json      # 同音字映射表
```

#### 4.3.2 全局存储（调度服务器）

**位置**：`central_server/scheduler/data/glossary/`

**文件结构**：
```
glossary/
├── global-glossary.json             # 全局 Glossary
├── user-glossaries/                  # 用户自定义术语
│   └── {user_id}.json
└── domain-glossaries/                # 领域特定词汇
    ├── conference.json
    └── offline.json
```

---

## 5. 优势分析

### 5.1 相比当前方案的优势

| 维度 | 当前方案（NMT Repair + 同音字学习） | 新方案（Glossary 学习系统） |
|------|-----------------------------------|---------------------------|
| **改进方式** | 事后修复（修复已发生的错误） | 预防性改进（在识别阶段避免错误） |
| **学习效率** | 依赖 NMT 修复结果，效率有限 | 利用高质量长文本，效率更高 |
| **数据来源** | 修复结果（可能不准确） | 高质量识别结果（更可靠） |
| **改进范围** | 主要针对同音字错误 | 涵盖术语、专名、同音字等 |
| **ASR 集成** | 无法直接改进 ASR | 通过 Glossary 直接改进 ASR |
| **长期效果** | 学习速度慢 | 学习速度快，持续改进 |

### 5.2 技术优势

1. **数据质量高**：
   - 使用高质量长文本（质量分数 > 0.8）作为验证来源
   - 避免使用低质量数据污染 Glossary

2. **验证机制可靠**：
   - 长文本验证短文本，利用上下文信息
   - 多重验证（相似度、上下文一致性、质量分数差异）

3. **渐进式学习**：
   - 从高置信度候选逐步提升到 Glossary
   - 出现次数和置信度双重筛选

4. **可扩展性强**：
   - 支持用户自定义术语
   - 支持领域特定词汇
   - 支持跨节点共享

---

## 6. 实施计划

### 6.1 阶段 1：基础框架（2-3 周）

**目标**：实现核心框架和基础功能

**任务**：
1. 实现文本质量评估器
2. 实现高质量文本收集
3. 实现基础 Glossary 管理器
4. 实现本地存储

**交付物**：
- `text-quality-assessor.ts`
- `glossary-manager.ts`
- `glossary-learning-system.ts`（基础版本）

### 6.2 阶段 2：长文本验证（2-3 周）

**目标**：实现长文本验证短文本功能

**任务**：
1. 实现片段匹配算法
2. 实现验证置信度计算
3. 实现候选生成
4. 集成到 Aggregator 中间件

**交付物**：
- 完整的 `glossary-learning-system.ts`
- 集成测试

### 6.3 阶段 3：Glossary 更新和同步（2-3 周）

**目标**：实现 Glossary 更新和全局同步

**任务**：
1. 实现质量评估和筛选
2. 实现 Glossary 更新逻辑
3. 实现调度服务器端 Glossary 管理
4. 实现跨节点同步

**交付物**：
- 完整的 Glossary 更新流程
- 调度服务器端 Glossary 管理 API
- 同步机制

### 6.4 阶段 4：ASR 集成和优化（1-2 周）

**目标**：将 Glossary 集成到 ASR 服务

**任务**：
1. 修改 ASR 服务支持 Glossary
2. 实现 Glossary 查询优化
3. 性能测试和优化
4. 用户测试

**交付物**：
- ASR 服务 Glossary 支持
- 性能优化报告
- 用户测试报告

---

## 7. 风险评估

### 7.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 片段匹配算法不准确 | 高 | 中 | 使用多种相似度算法，设置严格阈值 |
| 高质量文本库过大 | 中 | 高 | 实现 LRU 缓存，定期清理旧数据 |
| Glossary 同步延迟 | 中 | 中 | 实现增量同步，使用消息队列 |
| ASR 服务性能影响 | 高 | 低 | 优化 Glossary 查询，使用索引 |

### 7.2 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 学习速度慢 | 中 | 中 | 设置合理的质量阈值，优化匹配算法 |
| 误学习错误模式 | 高 | 低 | 多重验证，高置信度筛选 |
| 用户隐私问题 | 高 | 低 | 本地存储，可选上传，数据脱敏 |

---

## 8. 成功指标

### 8.1 短期指标（3 个月）

- **Glossary 条目数**：> 1000 条
- **学习速度**：每天新增 > 10 条高置信度条目
- **验证准确率**：> 85%
- **ASR 准确率提升**：> 5%

### 8.2 长期指标（6-12 个月）

- **Glossary 条目数**：> 5000 条
- **ASR 准确率提升**：> 15%
- **同音字错误率下降**：> 50%
- **用户满意度提升**：> 20%

---

## 9. 总结

### 9.1 核心价值

1. **从修复到预防**：从"事后修复错误"转向"预防错误发生"
2. **数据驱动改进**：利用高质量数据持续改进系统
3. **用户参与改进**：通过用户使用自然积累改进数据
4. **长期价值**：系统使用越久，准确率越高

### 9.2 关键决策点

1. **质量阈值设置**：需要平衡学习速度和数据质量
2. **验证置信度阈值**：需要平衡准确率和覆盖率
3. **Glossary 更新频率**：需要平衡实时性和稳定性
4. **ASR 集成方式**：需要平衡性能和准确率

### 9.3 建议

1. **分阶段实施**：先实现基础框架，再逐步完善
2. **充分测试**：每个阶段都要进行充分测试
3. **监控和调整**：持续监控指标，及时调整参数
4. **用户反馈**：收集用户反馈，持续优化

---

## 10. 附录

### 10.1 相关文档

- `AGGREGATOR_NMT_REPAIR_IMPLEMENTATION.md` - NMT Repair 实现文档
- `AGGREGATOR_P1_TASKS_SUMMARY.md` - P1 任务总结
- `AGGREGATOR_OPTIMIZATION_AND_REMAINING_WORK.md` - 优化与剩余工作

### 10.2 参考资料

- Faster Whisper Glossary 文档
- ASR 质量评分算法
- 文本相似度算法

---

**文档状态**：📋 提案阶段，待决策部门审批

