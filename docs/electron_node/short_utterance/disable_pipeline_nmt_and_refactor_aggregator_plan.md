# 停用 Pipeline NMT 并拆分 AggregatorMiddleware 技术方案

## 1. 目的与结论

本方案用于指导节点端架构改造，核心目标如下：

1. **停用 PipelineOrchestrator 中的 NMT 调用**，避免 ASR 后的临时翻译在文本被聚合时被废弃，从而减少重复 GPU 计算。
2. **拆分 AggregatorMiddleware 的职责**，将“文本聚合 / 翻译决策 / 去重 / 发送决策”拆解为清晰、可维护、可扩展的阶段（Stage）。

本方案不改变系统的核心能力（ASR、聚合、翻译、去重），属于**结构性优化**，目标是提升性能、可维护性与后续模型扩展能力。

---

## 2. 当前问题概述

### 2.1 重复 NMT 调用

当前流程中存在以下路径：

- PipelineOrchestrator：
  - ASR → **NMT（第一次翻译）**
- AggregatorMiddleware：
  - 文本发生 MERGE / COMMIT / flush 后 → **再次 NMT（最终翻译）**

当文本被聚合时，Pipeline 阶段的翻译结果不会被发送给调度服务器，属于**高概率废弃计算**。

### 2.2 AggregatorMiddleware 职责过重

当前 AggregatorMiddleware 同时承担：

- 文本聚合（AggregatorManager）
- 去重（lastSentText）
- 翻译缓存（TranslationCache）
- NMT Repair（同音字 / 候选评分）
- 是否发送结果的最终决策

职责过于集中，不利于后续维护与策略演进。

---

## 3. 设计原则

- **最终文本驱动**：所有对外发送的翻译结果，只能由“最终聚合文本”生成
- **职责拆分**：聚合、翻译、去重、发送决策解耦
- **可回滚**：通过 Feature Flag 分阶段启用
- **行为可观测**：具备指标与日志，验证收益与正确性

---

## 4. 新流程总览（目标态）

```
NodeAgent
  → InferenceService
    → PipelineOrchestrator
        - ASR（可选 TTS）
        - 不再执行 NMT
  → PostProcessCoordinator
        → AggregationStage
        → TranslationStage
        → DedupStage
  → NodeAgent 发送 job_result
```

---

## 5. PipelineOrchestrator 改造方案

### 5.1 停用 NMT

- 移除或禁用以下逻辑：
  - 创建 `NMTTask`
  - 调用 `TaskRouter.routeNMTTask()`
- Pipeline 输出中不再包含 `text_translated`

### 5.2 Pipeline 输出示意

```ts
type PipelineResult = {
  text_asr: string;
  quality_score?: number;
  segments?: any;
  lang_probs?: any;
  tts_audio?: Buffer; // 是否保留由策略决定
}
```

---

## 6. 新的后处理结构设计

### 6.1 PostProcessCoordinator（新增）

**职责**：
- 串联各 Stage
- 管理 session / trace / context
- 汇总最终输出

### 6.2 AggregationStage

**职责**：
- 调用 AggregatorManager.processUtterance()
- 决定：MERGE / NEW_STREAM / COMMIT
- 输出 `aggregatedText` 与 `aggregation_changed`

不包含任何翻译逻辑。

### 6.3 TranslationStage（唯一 NMT 入口）

**职责**：
- TranslationCache 查询
- NMT 调用
- 可选 NMT Repair（低质量分数 / 同音字检测）

**触发条件建议**：
- aggregatedText 非空
- src_lang / tgt_lang 有效
- 可配置为：仅 COMMIT 时翻译，或 FINAL 时翻译

### 6.4 DedupStage

**职责**：
- 基于最终文本决定是否发送
- 维护 lastSentText

**推荐去重 Key**：
```
normalize(aggregatedText) + '|' + normalize(translatedText || '')
```

---

## 7. TTS 位置调整建议

### 推荐方案（默认）

- TTS 下沉到 TranslationStage 之后：
  - ASR → 聚合 → 翻译 → TTS

优点：
- 使用最终翻译文本
- 避免临时翻译导致的 TTS 冗余

---

## 8. 迁移步骤（分阶段）

### Phase 0：准备阶段

- 增加 Feature Flag：
  - ENABLE_PIPELINE_NMT
  - ENABLE_POSTPROCESS_TRANSLATION
- 新增指标但不改变行为

### Phase 1：并行验证

- 启用 PostProcess 翻译
- Pipeline NMT 保留但不作为最终输出
- 对比 pipeline 翻译与 postprocess 翻译结果（仅日志 / metrics）

### Phase 2：正式切换

- 关闭 Pipeline NMT
- 最终 job_result 完全由 PostProcess 输出

### Phase 3：清理

- 删除 Pipeline NMT 相关 dead code
- 简化 TranslationCache 使用语义

---

## 9. 风险与对策

| 风险 | 对策 |
|----|----|
| TTS 时序变化 | 明确采用“翻译后 TTS”作为默认策略 |
| 下游依赖旧字段 | Phase 1 保持 message shape 不变 |
| 延迟增加 | 仅在 COMMIT / FINAL 时触发翻译 |
| 去重语义变化 | 使用 aggregated+translated 组合 key |

---

## 10. 验收标准

- 聚合场景下，**NMT 调用次数显著下降**
- 最终发送文本与当前行为一致
- 无重复发送、无漏发送
- GPU 峰值与平均负载下降

---

## 11. 总结

本方案通过：

- 停用 Pipeline NMT
- 将翻译决策统一下沉到聚合之后
- 拆分 AggregatorMiddleware 为清晰的处理阶段

实现更低的计算浪费、更清晰的架构边界，并为未来多模型、多策略翻译打下稳定基础。

**该改造可分阶段上线、可回滚，适合作为当前节点端的下一步结构性优化。**
