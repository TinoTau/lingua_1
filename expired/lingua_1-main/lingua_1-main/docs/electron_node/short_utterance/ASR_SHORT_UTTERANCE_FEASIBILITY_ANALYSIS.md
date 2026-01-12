# ASR 短句识别准确率提升方案可行性分析

**日期**：2025-01-XX  
**文档**：`ASR_SHORT_UTTERANCE_ACCURACY_CONTEXT_BIASING_AND_RESCORING_DESIGN.md`  
**状态**：✅ **高度可行**

---

## 1. 总体评估

### 1.1 可行性结论

**✅ 高度可行** - 方案设计合理，技术栈支持良好，实施难度适中。

**核心优势**：
1. **技术栈匹配**：当前系统已具备大部分基础设施
2. **渐进式实施**：可以分阶段实施，风险可控
3. **成本可控**：S1 成本极低，S2 可条件触发
4. **效果可预期**：基于成熟技术，效果可预期

---

## 2. S1：上下文偏置（Contextual Biasing）可行性分析

### 2.1 技术基础 ✅

**当前系统已具备**：
- ✅ **`context_text` 参数支持**：`task-router.ts` 已支持传递 `context_text` 到 ASR 服务
- ✅ **`use_text_context` 控制**：已实现动态开关（基于质量分数）
- ✅ **`condition_on_previous_text` 控制**：已实现（当前默认关闭）
- ✅ **Aggregator 状态管理**：已有 `lastCommittedText` 字段，可扩展为 `recent_committed_text`

**代码证据**：
```typescript
// electron_node/electron-node/main/src/task-router/task-router.ts:723
context_text: task.context_text,

// electron_node/electron-node/main/src/task-router/task-router.ts:755-796
let useTextContext = false;  // 默认关闭上下文
// P0.5-CTX-1: qualityScore < 0.4 → 禁用上下文 prompt
if (tempBadSegmentDetection.qualityScore < 0.4) {
  useTextContext = false;
  conditionOnPreviousText = false;
}
```

### 2.2 实施难度评估

| 任务 | 难度 | 工作量 | 风险 | 备注 |
|------|------|--------|------|------|
| **S1-1: PromptBuilder** | 🟡 中 | 3-5 天 | 🟢 低 | 需要实现关键词提取、上下文压缩 |
| **S1-2: ASR 接入 prompt** | 🟢 低 | 1-2 天 | 🟢 低 | 已有基础，只需扩展 |
| **Prompt 长度控制** | 🟢 低 | 1 天 | 🟢 低 | 简单截断和压缩逻辑 |
| **多语言夹杂处理** | 🟡 中 | 2-3 天 | 🟡 中 | 需要处理混合语言场景 |

**总体评估**：🟢 **低-中难度**，预计 1-2 周完成

### 2.3 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| Prompt 过长导致性能下降 | 中 | 中 | 严格长度限制（400-800 字符），压缩算法 |
| Prompt 污染识别结果 | 高 | 低 | 基于质量分数动态开关，低质量禁用 |
| 多语言夹杂处理不当 | 中 | 中 | 只提供短语/专名，不强制语言指令 |

**总体风险**：🟢 **低-中风险**，有成熟的缓解措施

---

## 3. S2：双通道解码 + 复核（Rescoring）可行性分析

### 3.1 技术基础 ✅

**当前系统已具备**：
- ✅ **质量评分机制**：已有 `quality_score` 计算（`bad-segment-detector.ts`）
- ✅ **坏段检测**：已有 `detectBadSegment` 函数
- ✅ **Aggregator 集成点**：已有中间件架构，可在 Aggregator 之后触发
- ✅ **Beam Search 支持**：ASR 服务已支持 `beam_size`（默认 10）

**代码证据**：
```typescript
// electron_node/electron-node/main/src/task-router/bad-segment-detector.ts
export function detectBadSegment(
  asrResult: ASRResult,
  audioDurationMs?: number,
  previousText?: string
): BadSegmentDetectionResult {
  // 返回 qualityScore
}

// electron_node/services/faster_whisper_vad/config.py:135
BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "10"))
```

### 3.2 需要实现的功能

#### 3.2.1 N-best 输出支持 ⚠️

**当前状态**：
- ❌ **Faster Whisper 不直接支持 N-best**：需要检查是否可以通过 `return_sequences` 获取
- ⚠️ **需要验证**：Faster Whisper 的 `transcribe()` 方法是否支持返回多个候选

**实施难度**：🟡 **中**（如果 Faster Whisper 不支持，需要二次解码）

**备选方案**：
- **方案 A**：使用 Faster Whisper 的 `return_sequences` 参数（如果支持）
- **方案 B**：二次解码（使用不同配置）

#### 3.2.2 二次解码支持 ✅

**当前状态**：
- ✅ **ASR 服务支持**：可以多次调用 `/utterance` 接口
- ✅ **配置灵活**：可以传递不同的 `beam_size`、`temperature` 等参数

**实施难度**：🟢 **低**，只需：
1. 保存音频引用（AudioRef）
2. 条件触发二次解码
3. 并发控制（避免 GPU 过载）

#### 3.2.3 Rescorer 实现 ✅

**当前状态**：
- ✅ **质量评分基础**：已有 `quality_score` 计算逻辑
- ✅ **规则打分基础**：已有数字保护、重复检测等逻辑
- ✅ **上下文信息**：Aggregator 已有 `lastCommittedText`

**实施难度**：🟢 **低-中**，需要：
1. 扩展质量评分逻辑（RuleScore）
2. 实现上下文一致性评分（ContextScore）
3. 可选：NMT 打分（NmtScore）

### 3.3 实施难度评估

| 任务 | 难度 | 工作量 | 风险 | 备注 |
|------|------|--------|------|------|
| **S2-1: NeedRescore 判定** | 🟢 低 | 2-3 天 | 🟢 低 | 基于现有质量评分 |
| **S2-2: 候选结构** | 🟢 低 | 1-2 天 | 🟢 低 | 数据结构定义 |
| **S2-3: Rescorer v1** | 🟡 中 | 3-5 天 | 🟡 中 | 规则打分 + 上下文打分 |
| **S2-4: result_queue 扩展** | 🟢 低 | 1 天 | 🟢 低 | 字段扩展 |
| **S2-5: N-best 接入** | 🟡 中 | 2-3 天 | 🟡 中 | 需要验证 Faster Whisper 支持 |
| **S2-6: 二次解码 worker** | 🟡 中 | 3-5 天 | 🟡 中 | 并发控制、音频缓存 |
| **S2-7: 音频缓存** | 🟡 中 | 2-3 天 | 🟡 中 | Ring buffer + TTL |

**总体评估**：🟡 **中难度**，预计 2-3 周完成（P0 部分）

### 3.4 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| Faster Whisper 不支持 N-best | 中 | 中 | 使用二次解码作为备选 |
| 二次解码 GPU 过载 | 高 | 低 | 并发上限（每 GPU 1 个），超载降级 |
| Rescorer 抖动 | 中 | 中 | Δscore margin，优势不足不替换 |
| 音频缓存内存占用 | 低 | 中 | Ring buffer，TTL 10 秒 |

**总体风险**：🟡 **中风险**，有成熟的缓解措施

---

## 4. 与现有系统集成分析

### 4.1 Aggregator 集成 ✅

**当前架构**：
```
JobAssignMessage
  → NodeAgent.handleJob()
    → InferenceService.processJob()
      → PipelineOrchestrator.processJob()
        → ASR → NMT → TTS
      → AggregatorMiddleware.process()  ← 中间件处理
      → JobResultMessage
```

**S2 集成点**：
- ✅ **位置合适**：在 Aggregator 之后触发，文本已稳定
- ✅ **已有基础**：`AggregatorState` 已有 `lastCommittedText`
- ✅ **扩展容易**：可以添加 `recent_committed_text` 和 `recent_keywords`

**需要扩展的字段**：
```typescript
// aggregator-state.ts
private recentCommittedText: string[] = [];  // 最近 N 条已提交文本
private recentKeywords: string[] = [];       // 用户配置 + 上下文抽取的关键词
private lastCommitAudioRef?: AudioRef;       // 仅二次解码需要
```

### 4.2 ASR 服务集成 ✅

**当前支持**：
- ✅ `context_text` 参数（用于 S1）
- ✅ `beam_size` 参数（用于 S2 二次解码）
- ✅ `use_text_context` 控制（用于 S1 动态开关）

**需要扩展**：
- ⚠️ N-best 输出（需要验证 Faster Whisper 支持）
- ✅ 二次解码接口（已有，只需条件调用）

### 4.3 音频缓存实现 ⚠️

**当前状态**：
- ❌ **无音频缓存**：当前系统不保存音频数据
- ⚠️ **需要实现**：Ring buffer + TTL 机制

**实施难度**：🟡 **中**
- 需要修改 `NodeAgent` 或 `PipelineOrchestrator` 保存音频
- 需要实现 TTL 清理机制
- 内存占用可控（TTL 10 秒，ring buffer 大小限制）

---

## 5. 性能影响分析

### 5.1 S1 性能影响 ✅

**成本**：
- **CPU 成本**：Prompt 拼接（几乎可忽略）
- **GPU 成本**：几乎无（Prompt 只是文本输入）
- **延迟影响**：< 5ms（Prompt 拼接时间）

**结论**：✅ **性能影响极小**，可以默认启用

### 5.2 S2 性能影响 ⚠️

**成本**：
- **N-best**：无额外推理（如果 Faster Whisper 支持）
- **二次解码**：额外 GPU 推理（必须条件触发）
- **Rescorer**：CPU 后处理（很小）

**控制措施**：
- ✅ **条件触发**：仅短句/低置信/高风险触发
- ✅ **并发上限**：每 GPU 最多 1 个二次解码任务
- ✅ **目标触发率**：≤ 5%

**预期延迟增加**：
- **N-best 路径**：+10-20ms（Rescorer 处理）
- **二次解码路径**：+200-500ms（取决于音频长度）

**结论**：⚠️ **性能影响可控**，通过条件触发和并发控制

---

## 6. 实施建议

### 6.1 分阶段实施

#### 阶段 1：S1 基础实现（1-2 周）

**优先级**：🔴 **高**

**任务**：
1. ✅ S1-1: PromptBuilder（关键词提取、上下文压缩）
2. ✅ S1-2: ASR 接入 prompt（扩展 `context_text` 构建）
3. ✅ 测试和调优

**预期效果**：
- 短句专名/术语错误下降 10-20%
- 几乎无性能影响

#### 阶段 2：S2 基础实现（2-3 周）

**优先级**：🟡 **中**

**任务**：
1. ✅ S2-1: NeedRescore 判定函数
2. ✅ S2-2: 候选结构和 trace 字段
3. ✅ S2-3: Rescorer v1（RuleScore + ContextScore）
4. ✅ S2-4: result_queue 扩展
5. ✅ 测试和调优

**预期效果**：
- 短句错误下降 20-30%
- 延迟增加可控（P95 +50-100ms）

#### 阶段 3：S2 增强（2-3 周）

**优先级**：🟢 **低**

**任务**：
1. ⚠️ S2-5: N-best 接入（如果 Faster Whisper 支持）
2. ✅ S2-6: 二次解码 worker
3. ✅ S2-7: 音频缓存
4. ✅ 测试和调优

**预期效果**：
- 短句错误进一步下降 10-15%
- 延迟增加（P95 +100-200ms，但触发率低）

### 6.2 关键技术决策

#### 决策 1：N-best vs 二次解码

**建议**：
- **优先尝试**：验证 Faster Whisper 是否支持 N-best
- **备选方案**：如果不支持，使用二次解码
- **权衡**：N-best 成本低，但可能不够准确；二次解码成本高，但更准确

#### 决策 2：Rescorer 打分权重

**建议**：
- **初始权重**：RuleScore 60%，ContextScore 30%，NmtScore 10%（可选）
- **调优方式**：A/B 测试，根据实际效果调整
- **保守策略**：Δscore margin = 1.5，避免抖动

#### 决策 3：触发阈值

**建议**：
- **初始阈值**：
  - 短文本：CJK < 18，EN < 9 words
  - 低质量：quality_score < 0.45（offline）/ 0.50（room）
- **调优方式**：根据触发率和效果调整
- **目标**：触发率 ≤ 5%，错误下降 ≥ 20%

---

## 7. 风险评估总结

### 7.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 | 总体评估 |
|------|------|------|---------|---------|
| Prompt 过长 | 中 | 中 | 长度限制 + 压缩 | 🟢 低 |
| Faster Whisper 不支持 N-best | 中 | 中 | 二次解码备选 | 🟢 低 |
| 二次解码 GPU 过载 | 高 | 低 | 并发上限 + 降级 | 🟢 低 |
| Rescorer 抖动 | 中 | 中 | Δscore margin | 🟢 低 |

**总体技术风险**：🟢 **低**

### 7.2 业务风险

| 风险 | 影响 | 概率 | 缓解措施 | 总体评估 |
|------|------|------|---------|---------|
| 效果不明显 | 中 | 低 | 分阶段实施，及时调整 | 🟢 低 |
| 延迟增加过多 | 高 | 低 | 条件触发 + 并发控制 | 🟢 低 |
| 用户感知不明显 | 低 | 中 | 指标监控 + 用户反馈 | 🟢 低 |

**总体业务风险**：🟢 **低**

---

## 8. 成功指标

### 8.1 短期指标（1-2 个月）

- ✅ **触发率**：S2 触发率 ≤ 5%
- ✅ **错误下降**：短句专名/术语错误下降 ≥ 20%
- ✅ **延迟影响**：P95 延迟增加 ≤ 100ms
- ✅ **稳定性**：无抖动，无性能问题

### 8.2 长期指标（3-6 个月）

- ✅ **错误下降**：短句错误总体下降 ≥ 30%
- ✅ **用户满意度**：用户反馈改善 ≥ 15%
- ✅ **系统稳定性**：无重大故障

---

## 9. 结论

### 9.1 可行性总结

**✅ 高度可行** - 方案设计合理，技术栈支持良好，实施难度适中。

**关键优势**：
1. **技术基础扎实**：当前系统已具备大部分基础设施
2. **渐进式实施**：可以分阶段实施，风险可控
3. **成本可控**：S1 成本极低，S2 可条件触发
4. **效果可预期**：基于成熟技术，效果可预期

### 9.2 建议

1. **立即开始 S1**：成本低，效果明显，风险小
2. **分阶段实施 S2**：先实现基础版本，再逐步增强
3. **充分测试**：每个阶段都要进行充分测试
4. **持续监控**：监控指标，及时调整参数

### 9.3 与 Glossary 学习系统的对比

| 维度 | 本方案（S1+S2） | Glossary 学习系统 |
|------|----------------|------------------|
| **实施难度** | 🟢 低-中 | 🟡 中-高 |
| **实施周期** | 4-6 周 | 7-11 周 |
| **技术风险** | 🟢 低 | 🟡 中 |
| **效果预期** | ✅ 可预期 | ⚠️ 需验证 |
| **成本** | 🟢 低 | 🟡 中 |
| **长期价值** | 🟡 中 | 🟢 高 |

**建议**：
- **短期**：优先实施本方案（S1+S2），快速见效
- **长期**：可以考虑 Glossary 学习系统，但需要更多验证

---

## 10. 附录

### 10.1 相关文档

- `ASR_SHORT_UTTERANCE_ACCURACY_CONTEXT_BIASING_AND_RESCORING_DESIGN.md` - 原始设计文档
- `AGGREGATOR_GLOSSARY_LEARNING_SYSTEM_PROPOSAL.md` - Glossary 学习系统提案

### 10.2 代码位置

- **ASR 路由**：`electron_node/electron-node/main/src/task-router/task-router.ts`
- **质量评分**：`electron_node/electron-node/main/src/task-router/bad-segment-detector.ts`
- **Aggregator 状态**：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
- **ASR 服务**：`electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

---

**文档状态**：✅ **可行性分析完成，建议立即开始实施**

