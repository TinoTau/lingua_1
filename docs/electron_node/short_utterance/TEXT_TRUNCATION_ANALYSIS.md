# 文本截断问题分析报告

**日期**: 2025-12-30  
**状态**: 🔧 **已修复 NMT 提取逻辑，ASR 截断需进一步调查**

---

## 问题描述

集成测试中发现原文（ASR）和译文（NMT）都有截断问题：

### 原文（ASR）截断示例

```
[0] 现在让我们来测试一下这个版本的系统 ✅ 完整
[1] 一样的我还是会持续说话,然后看有没有音频被解断,然后还有一些重复的语音呢,它会被自动删除我们要解决这个问题 ✅ 完整
[2] 然后呢,语音的反回速度现在还是比较慢的,因为现在已经过去了十几秒钟,才有第一段回来 ✅ 完整
[3] 语音的反回速度现在已经过去了十几秒钟 ❌ 截断（缺少开头"然后呢,"）
[4] 我觉得这还是可以的 ✅ 完整
[5] 然后我们需要继续说一些东西让它能够法会东西这过程可能要等十几秒钟左右以后我们模式可能会改成持续输入就不太终断了 ✅ 完整
[6] 那明显就 ❌ 截断（缺少结尾）
[7] 这个音频的内容还是会解断的 ✅ 完整
```

### 译文（NMT）截断示例

```
[0] Now let's test this version of the system. ✅ 完整
[1] I'm still going to keep talking, then see if there's any audio dissolved... ✅ 完整
[2] e this problem and then, the reversal speed of the sound is still slower now... ❌ 截断（开头缺少"Solv"）
[3] ssed a dozen seconds, until there's the first step back. ❌ 截断（开头缺少"Pa"）
[4] ew seconds I think it's still right. ❌ 截断（开头缺少"F"）
[5] then we need to keep saying something so that it can do things... ✅ 完整
[6] s input and it is not too ended. ❌ 截断（开头缺少"Continuou"）
[7] that the content of this audio will be resolved. ❌ 截断（开头缺少"Then"）
```

---

## 根本原因分析

### 1. NMT 翻译截断问题 ✅ **已修复**

**问题位置**: `electron_node/services/nmt_m2m100/nmt_service.py` (第650-668行)

**原因**:
- 当有 `context_text` 时，NMT 服务会先单独翻译 `context_text`，然后从完整翻译中提取只当前句的翻译部分
- 提取逻辑使用"length ratio"方法时，估算的 context 翻译长度不准确
- 例如：Utterance 3 的完整翻译是 147 字符，context 翻译是 138 字符，但估算的 context 长度是 91 字符
- 所以提取时从 91 字符位置开始，导致开头被截断："ssed a dozen seconds..."

**修复方案**:
1. **方法1（最准确）**: 如果完整翻译以 context 翻译开头，直接提取剩余部分
2. **方法2（次准确）**: 查找 context 翻译在完整翻译中的位置，提取之后的部分
3. **方法3（备选）**: 使用实际 context 翻译长度（而不是估算），加 5% 缓冲

**修复代码**:
```python
# 方法1：如果完整翻译以 context 翻译开头，提取剩余部分（最准确的方法）
if out.startswith(context_translation):
    final_output = out[context_translation_length:].strip()
# 方法2：查找 context 翻译在完整翻译中的位置（处理翻译不一致的情况）
elif context_end_pos != -1:
    final_output = out[context_end_pos + context_translation_length:].strip()
# 方法3：使用实际context翻译长度（最可靠的方法）
else:
    estimated_context_translation_length = int(context_translation_length * 1.05)
    final_output = out[estimated_context_translation_length:].strip()
```

---

### 2. ASR 原文截断问题 ⚠️ **需进一步调查**

**问题位置**: 可能是 ASR 服务本身或音频分割逻辑

**可能原因**:

1. **音频被分割**:
   - 同一个句子被分割成多个 utterance
   - 例如：Utterance 2 和 Utterance 3 是同一个句子的不同部分
   - Utterance 2: "然后呢,语音的反回速度现在还是比较慢的,因为现在已经过去了十几秒钟,才有第一段回来"
   - Utterance 3: "语音的反回速度现在已经过去了十几秒钟"（缺少开头）

2. **ASR 识别不完整**:
   - ASR 服务本身识别不完整（可能是音频质量问题）
   - 或者 VAD（语音活动检测）过早截断了音频

3. **聚合逻辑问题**:
   - 聚合逻辑在提取 tail 时可能有问题
   - 但从代码看，聚合逻辑应该是正常的

**需要检查**:
- [ ] ASR 服务日志，确认识别是否完整
- [ ] 音频分割逻辑，确认是否有重复分割
- [ ] VAD 配置，确认是否过早截断

---

## 修复状态

### ✅ NMT 翻译截断 - **已修复**

- **修复文件**: `electron_node/services/nmt_m2m100/nmt_service.py`
- **修复内容**: 改进提取逻辑，使用实际 context 翻译长度而不是估算值
- **测试状态**: 待集成测试验证

### ⚠️ ASR 原文截断 - **需进一步调查**

- **问题**: ASR 原文有截断，可能是音频分割或 ASR 识别问题
- **下一步**: 检查 ASR 服务日志和音频分割逻辑

---

## 建议

1. **立即验证**: 运行集成测试，验证 NMT 翻译截断是否已修复
2. **深入调查**: 检查 ASR 服务日志，确认原文截断的具体原因
3. **监控**: 添加更详细的日志，记录 ASR 识别和 NMT 翻译的完整过程

---

## 相关文件

- `electron_node/services/nmt_m2m100/nmt_service.py` - NMT 服务提取逻辑
- `electron_node/electron-node/main/src/aggregator/aggregator-state.ts` - 聚合逻辑
- `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts` - 翻译阶段

