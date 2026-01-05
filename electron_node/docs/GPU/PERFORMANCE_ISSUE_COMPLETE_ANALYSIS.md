# 性能问题完整分析报告

## 已修复的问题

### ✅ 问题1：短句等待时间过长

**现象**：
- Job 9：第一次job_assign后等待9秒才收到第二次
- Job 12：第一次job_assign后等待32秒才收到第二次
- 节点端处理时间正常（Job 9约3秒，Job 12约5秒）

**根本原因**：
- 短句延迟合并机制等待时间过长（5秒+延长等待）
- 如果等待超时后音频仍然很短（<3秒），会继续等待（最多10秒）

**修复**：
- ✅ 减少等待时间：5秒 → 3秒
- ✅ 移除延长等待逻辑：不再继续等待过短音频
- ✅ 修改文件：`audio-aggregator.ts`

**预期效果**：
- Job 9和Job 12的等待时间从9-32秒减少到3秒以内
- 用户感觉系统更快

## 待修复的问题

### ⚠️ 问题2：Job 12文本丢失（NMT服务截断）

**现象**：
- ToTranslate完整："提高了一点,那我希望接下来可以做到更好更快 也就是说我们需要把这个 事情继续做下去 然后这个架构也没有太大的问题,只是需要再提升一点点速度"
- Translated不完整："improved a little, then i hope that the next can do better fasters."
- 丢失了后半句："也就是说我们需要把这个事情继续做下去 然后这个架构也没有太大的问题,只是需要再提升一点速度"

**可能原因**：
1. **max_new_tokens限制**：
   - NMT服务使用动态计算的`max_new_tokens`（最大512）
   - 计算公式：`estimated_output_tokens = total_input_tokens * ratio * safety_margin`
   - 如果输入文本很长，加上context_text，可能导致`max_new_tokens`不够

2. **extract_translation逻辑问题**：
   - 当提供`context_text`时，NMT服务会返回完整翻译（包含context和当前句）
   - `extract_translation`需要从完整翻译中提取只当前句的翻译部分
   - 如果提取逻辑有问题，可能导致文本丢失

3. **翻译被截断检测不够准确**：
   - NMT服务有截断检测逻辑，但可能不够准确
   - 如果检测到截断，会尝试增加`max_new_tokens`并重新生成，但仅当没有`context_text`时

**建议修复**：
1. 增加`max_new_tokens`上限：从512增加到768或1024
2. 改进动态计算逻辑：对于长文本，使用更大的`max_new_tokens`
3. 改进截断检测：更准确地检测截断，并在有`context_text`时也能重试
4. 改进`extract_translation`逻辑：确保正确提取当前句的翻译

**需要检查**：
- NMT服务的日志，确认`max_new_tokens`的值
- `extract_translation`的提取过程，确认是否在提取阶段丢失文本

### ⚠️ 问题3：Job 13和14文本被截断（文本聚合阶段）

**现象**：
- Job 13 ASR: "再提高了一点速度 然后再提高了一点速度"
- Job 13 Aggregated: "再提高了一点速度 然后"（被截断）
- Job 14 ASR: "再提高了一点速度 再提高了一点速度"
- Job 14 Aggregated: "再提高了一点速度"（被截断）

**可能原因**：
1. **Tail Buffer处理**：
   - `AggregatorStateCommitHandler.extractCommitText`会使用`removeTail`移除尾部
   - 对于CJK文本，`removeTail`会移除最后6个字符（`tailCarryCjkChars=6`）
   - 如果文本很短，可能被截断

2. **去重逻辑问题**：
   - `AggregatorStateTextProcessor.processText`会进行去重
   - 如果去重逻辑误判，可能导致文本被截断

3. **文本处理流程**：
   - 文本经过多个处理阶段：去重 -> tail处理 -> 提交
   - 如果某个阶段有问题，可能导致文本丢失

**建议修复**：
1. 检查`tailCarryConfig`配置：确保tail长度合理
2. 检查`removeTail`逻辑：确保不会截断重要文本
3. 添加日志：记录tail buffer的处理过程
4. 改进去重逻辑：避免误判导致文本丢失

**需要检查**：
- 文本聚合的日志，确认文本在哪个阶段被截断
- `removeTail`的处理过程，确认是否在tail处理阶段丢失文本

### ⚠️ 问题4：Job 13和14重复Job 12（Context_text问题）

**现象**：
- Job 13的`context_text`是Job 12的完整文本
- Job 14的`context_text`是"再提高了一点速度"
- 导致NMT服务混淆，重复翻译

**可能原因**：
1. **getLastCommittedText逻辑**：
   - `getLastCommittedText`应该返回上一句，而不是当前句
   - 如果逻辑有问题，可能返回错误的文本

2. **文本提交时机**：
   - 如果文本提交时机不对，可能导致`context_text`获取错误

3. **文本相似度检查不够严格**：
   - 如果`context_text`和当前文本相似度很高，应该不使用`context_text`
   - 当前的检查可能不够严格

**建议修复**：
1. 检查`getLastCommittedText`逻辑：确保返回正确的上一句
2. 添加更严格的检查：如果`context_text`和当前文本相似度很高，不使用`context_text`
3. 添加日志：记录`context_text`的获取过程

**需要检查**：
- `context_text`的获取逻辑，确认为什么Job 13使用了Job 12的完整文本
- 文本提交时机，确认是否在提交阶段有问题

## 各服务耗时（节点端处理时间）

- **Job 9**: ASR 1.16s + Semantic 0.33s + NMT 1.13s + TTS 0.4s ≈ **3秒**
- **Job 12**: ASR 2s + Semantic 0.6s + NMT 1.99s + TTS 0.4s ≈ **5秒**

**结论**：节点端处理时间正常，主要延迟来自等待下一个音频chunk到达（已修复）

## 下一步行动

1. **立即修复**（已完成）：
   - ✅ 优化短句等待机制

2. **高优先级修复**：
   - ⚠️ 检查NMT服务的`max_new_tokens`配置，增加上限
   - ⚠️ 检查`extract_translation`逻辑，确保正确提取文本
   - ⚠️ 检查`removeTail`逻辑，确保不会截断重要文本
   - ⚠️ 检查`getLastCommittedText`逻辑，确保返回正确的上一句

3. **中优先级修复**：
   - ⚠️ 改进截断检测，更准确地检测截断
   - ⚠️ 添加更详细的日志，便于调试

4. **测试验证**：
   - 重新运行集成测试，验证修复效果
   - 检查Job 12、13、14的文本是否完整
   - 检查`context_text`是否正确
