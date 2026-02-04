# 节点端标点 / 断句恢复（CT-Transformer）落地方案

> **目的**：在 ASR + KenLM 同音纠错之后、语义修复与翻译之前，引入稳定、低风险的中文标点 / 断句恢复能力，显著提升长句结构完整性与 NMT 翻译质量。

> **设计原则**：
> - 不重构现有主流程，仅新增一个 Step
> - 不引入词面改写（只插标点，不替换词）
> - GPU 可选，模型体积 < 3GB
> - 可独立 Python 服务，按需启动，与节点端现有 Service Manager 风格一致

---

## 1. 总体架构位置

### 1.1 Pipeline 插入点（推荐且已验证）

```
ASR
 → Aggregation
 → PhoneticCorrection（KenLM，同音纠错）
 → PunctuationRestore（CT-Transformer，本方案）
 → SemanticRepair
 → Translation (NMT)
 → TTS
```

**为什么放在这里**：
- KenLM 先解决“运营识别 / 精英判定”等词面错误
- 标点 / 断句恢复只处理结构问题，不与词面修复冲突
- SemanticRepair 与 NMT 吃到的是结构化句子，而不是词流

---

## 2. 模型选型

### 2.1 使用模型

- **CT-Transformer 中文标点恢复模型**
- 模型标识（推荐）：

```
damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch
```

### 2.2 能力范围

- 输入：无标点 / 弱标点的 ASR 中文文本（可含少量英文）
- 输出：
  - 自动插入：`， 。 ？ ！`
  - 恢复句子边界（以 `。！？` 为主）

### 2.3 体积与性能

- 模型文件：百 MB 级（远低于 3GB）
- 推理方式：ONNXRuntime GPU（可回退 CPU）
- 延迟：适合长句（10s+ 音频转写文本）后处理

---

## 3. Python 推理服务设计

### 3.1 服务职责

- **只做一件事**：
  - 输入 ASR 文本 → 输出加标点文本 + 断句结果
- 不做：
  - 语义改写
  - 同义替换
  - 摘要 / 扩写

### 3.2 API 契约（最小可用）

#### POST /punc

**Request**
```json
{
  "text": "string",
  "lang": "zh"
}
```

**Response**
```json
{
  "text_punc": "string",
  "sentences": ["string", "string"],
  "meta": {
    "model": "punc_ct_transformer",
    "elapsed_ms": 12
  }
}
```

### 3.3 断句规则

- 模型先输出带标点文本
- 服务侧仅用正则按以下字符 split：

```
。！？
```

- 保留标点
- 不引入额外 NLP 逻辑

---

## 4. Python 服务实现要点

### 4.1 依赖建议

```txt
python>=3.9
onnxruntime-gpu
funasr-onnx
fastapi
uvicorn
```

> 若节点端无 GPU，可将 `onnxruntime-gpu` 替换为 `onnxruntime`

### 4.2 服务启动流程

1. 启动时加载模型（常驻内存）
2. 接收文本请求
3. 推理 → 返回结果

> **禁止**：每次请求重复加载模型

---

## 5. 节点端 Pipeline 改造（TypeScript）

### 5.1 新增 Step 名称

```ts
PUNCTUATION_RESTORE
```

### 5.2 Step 注册

- 文件：`pipeline-step-registry.ts`
- 注册新 step，映射到 `runPunctuationRestoreStep`

### 5.3 Step 执行逻辑（伪代码）

```ts
async function runPunctuationRestoreStep(job, ctx, services) {
  if (!ctx.finalText || ctx.finalText.length < 5) return;

  const resp = await fetch(PUNCT_SERVICE_URL, {
    method: 'POST',
    body: JSON.stringify({ text: ctx.finalText, lang: 'zh' })
  });

  const { text_punc, sentences } = await resp.json();

  ctx.finalText = text_punc;
  ctx.sentences = sentences;
}
```

### 5.4 Pipeline Mode 配置

- 文件：`pipeline-mode-config.ts`
- 在包含 Translation 的模式中插入：

```
... PhoneticCorrection
→ PunctuationRestore
→ SemanticRepair
```

---

## 6. Translation 阶段的推荐最小改造（强烈建议）

### 6.1 原问题

- NMT 直接吃“长段落 + 复杂从句”
- 在 ASR 噪声场景下极不稳定

### 6.2 改造策略

- 若 `ctx.sentences` 存在：
  - 按句逐条送入 NMT
  - 翻译完成后拼接

```ts
const inputs = ctx.sentences ?? [ctx.finalText];
```

> 这是**翻译质量跃升的关键点**，改动很小，但收益巨大

---

## 7. 失败与降级策略

| 场景 | 行为 |
|---|---|
| 标点服务不可用 | 直接跳过该 Step |
| 推理超时 | 使用原文本 |
| 返回为空 | 使用原文本 |

> 标点恢复 **永远不应阻断 Job**

---

## 8. 验收标准（给开发 / 测试）

- 长句不再被 NMT 翻译成词流
- 英文输出不再出现大量无意义对齐词
- 同一段 ASR 文本：
  - 加标点前后，SemanticRepair 命中率明显提升

---

## 9. 关键认知结论（务必保留）

> **翻译质量的上限由“ASR 后处理语言结构恢复”决定，而不是 NMT 本身。**

本方案解决的是结构问题，不与 KenLM / SemanticRepair 冲突，是当前节点端最低风险、最高性价比的增强步骤。

---

**文档状态**：可直接进入开发阶段

