# NMT重复翻译第一句话问题分析

**日期**: 2025-12-30  
**问题**: 所有utterance的NMT翻译结果都是第一句话的翻译

---

## 问题现象

- **ASR识别**: 每个utterance的文本都不同，识别正确 ✅
- **合并结果**: 每个utterance的文本都不同，合并正确 ✅
- **NMT翻译**: 所有utterance的翻译结果都是第一句话的翻译 ❌

**示例**：
- Utterance 0: "现在让我们来测试一下这个版本的系统..." → "Now let's test this version of the system..."
- Utterance 1: "第二句话 我们会测试使用三秒自然停盾..." → "Now let's test this version of the system..." ❌
- Utterance 2: "三句话 我们会持续说" → "Now let's test this version of the system..." ❌
- Utterance 3: "说大概10秒钟以上开始进行这个操作..." → "Now let's test this version of the system..." ❌

---

## 根本原因分析

### 问题1：`context_text` 的使用方式

**位置**: `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

**代码**:
```typescript
// 获取上下文文本（用于缓存键生成）
let contextText = this.aggregatorManager?.getLastTranslatedText(job.session_id) || undefined;
```

**问题**：
- `contextText` 是**上一个utterance的翻译文本**（translated text，英文）
- 而不是上一个utterance的原文（ASR文本，中文）

### 问题2：NMT服务的拼接逻辑

**位置**: `electron_node/services/nmt_m2m100/nmt_service.py`

**代码**:
```python
if req.context_text:
    # 简单拼接：上下文 + 当前文本
    input_text = f"{req.context_text} {req.text}"
```

**问题**：
- NMT服务将 `context_text`（英文翻译）和 `text`（中文原文）拼接在一起
- 例如：`"Now let's test this version of the system... 第二句话 我们会测试使用三秒自然停盾..."`
- 这会导致NMT模型混淆，因为：
  1. `context_text` 是英文（上一个utterance的翻译）
  2. `text` 是中文（当前utterance的原文）
  3. 拼接后的输入是混合语言，可能导致模型只翻译了context_text部分

### 问题3：可能的缓存或状态问题

如果NMT服务有某种缓存或状态管理机制，可能会因为：
- `context_text` 相同（都是第一句话的翻译）
- 或者某种内部状态没有正确更新
- 导致返回相同的翻译结果

---

## 解决方案

### 方案1：不使用 `context_text`（推荐）

**修改**: `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

```typescript
// 不传递context_text，避免NMT服务混淆
const nmtTask: NMTTask = {
  text: aggregatedText,
  src_lang: job.src_lang,
  tgt_lang: job.tgt_lang,
  context_text: undefined, // 不传递context_text
  job_id: job.job_id,
};
```

**理由**：
- M2M100模型本身不支持真正的上下文参数
- 当前的简单拼接方式会导致混合语言输入，影响翻译质量
- 不使用context_text可以确保每个utterance独立翻译

### 方案2：修改NMT服务的拼接逻辑

**修改**: `electron_node/services/nmt_m2m100/nmt_service.py`

```python
if req.context_text:
    # 检查context_text是否是目标语言（英文）
    # 如果是目标语言，不应该拼接，因为会导致混合语言输入
    # 只使用当前文本
    if is_target_language(req.context_text, req.tgt_lang):
        input_text = req.text  # 不使用context_text
    else:
        # context_text是源语言（中文），可以拼接
        input_text = f"{req.context_text} {req.text}"
else:
    input_text = req.text
```

**理由**：
- 如果 `context_text` 是目标语言（英文），不应该拼接
- 因为会导致混合语言输入（英文 + 中文），影响翻译质量

### 方案3：传递原文作为context_text（不推荐）

**修改**: `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

```typescript
// 获取上一个utterance的原文（ASR文本），而不是翻译文本
let contextText = this.aggregatorManager?.getLastCommittedText(job.session_id) || undefined;
```

**问题**：
- 需要添加 `getLastCommittedText` 方法
- 仍然会导致NMT服务拼接两个中文文本，可能影响翻译质量

---

## 推荐方案

**推荐使用方案1**：不传递 `context_text`

**原因**：
1. **简单有效**：不需要修改NMT服务
2. **避免混淆**：不会导致混合语言输入
3. **独立翻译**：每个utterance独立翻译，不会相互影响
4. **符合M2M100特性**：M2M100本身不支持真正的上下文参数

---

## 实施步骤

1. **修改 `TranslationStage.process()`**：
   - 将 `context_text: contextText` 改为 `context_text: undefined`
   - 或者完全移除 `context_text` 的获取逻辑

2. **测试验证**：
   - 重新编译并测试
   - 确认每个utterance的翻译结果都不同
   - 确认翻译质量正常

---

## 相关文件

- `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts` - TranslationStage实现
- `electron_node/services/nmt_m2m100/nmt_service.py` - NMT服务实现
- `electron_node/docs/short_utterance/ASR_AND_AGGREGATION_RESULTS.md` - ASR和合并结果分析

