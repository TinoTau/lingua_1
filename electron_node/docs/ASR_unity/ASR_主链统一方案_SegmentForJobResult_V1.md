# ASR 后处理主链统一方案（SegmentForJobResult 单真值源）

版本：V1.0
日期：2026-05-30
状态：P0 架构修复方案

---

# 一、背景

当前节点端存在两个可能被视为“最终文本”的字段：

```ts
ctx.repairedText
ctx.segmentForJobResult
```

审计发现：

```text
Aggregation finalize 后：

segmentForJobResult = accumulated full turn text

repairedText = last chunk detector output
```

而当前部分链路仍优先读取：

```ts
ctx.repairedText
```

导致：

- NMT 输入可能不完整
- text_asr 可能不完整
- summary/context 可能读取不同文本
- turn 流式场景可能出现文本分叉

本方案目标：

建立唯一文本事实源（Single Source Of Truth）。

---

# 二、设计原则

## 原则 1

节点端 ASR 后只允许一个主链字段：

```ts
ctx.segmentForJobResult
```

---

## 原则 2

任何业务逻辑不得同时依赖：

```ts
ctx.repairedText
ctx.segmentForJobResult
```

二者只能保留一个。

---

## 原则 3

NMT、Aggregation、ResultBuilder 必须读取同一个字段。

---

## 原则 4

不考虑向后兼容。

项目未上线。

允许：

- 删除旧逻辑
- 删除旧字段
- 删除兼容层

禁止增加新的中间字段。

---

# 三、目标架构

## 改造前

```text
ASR
 ↓
rawAsrText
 ↓
FW Detector
 ↓
repairedText

Aggregation
 ↓
segmentForJobResult

Translation
 ↓
repairedText > segmentForJobResult > asrText
```

存在双真值源。

---

## 改造后

```text
ASR
 ↓
segmentForJobResult
 ↓
FW Detector
 ↓
segmentForJobResult
 ↓
Aggregation
 ↓
segmentForJobResult
 ↓
Translation
 ↓
segmentForJobResult
 ↓
Result Builder
 ↓
segmentForJobResult
```

唯一真值源：

```ts
ctx.segmentForJobResult
```

---

# 四、数据结构

## PipelineContext（目标）

```ts
interface PipelineContext {

  rawAsrText?: string;

  asrText?: string;

  segmentForJobResult?: string;

  deferTranslation?: boolean;

  aggregationMetrics?: AggregationMetrics;

}
```

---

## 删除字段

```ts
repairedText
```

目标：

```text
全仓不再引用 repairedText
```

---

# 五、各阶段职责

## ASR Step

输入：

```text
ASR Result
```

输出：

```ts
ctx.rawAsrText = rawResult;
ctx.asrText = rawResult;

ctx.segmentForJobResult = rawResult;
```

职责：

初始化唯一文本源。

---

## FW Detector

输入：

```ts
ctx.segmentForJobResult
```

输出：

```ts
ctx.segmentForJobResult = repairedText;
```

职责：

修改文本。

不产生第二份文本。

---

## Aggregation

输入：

```ts
ctx.segmentForJobResult
```

### non-finalize

```ts
appendTurnSegment(
    ctx.segmentForJobResult
);

ctx.deferTranslation = true;
```

---

### finalize

```ts
ctx.segmentForJobResult =
    accumulatedFullTurnText;

ctx.deferTranslation = false;
```

职责：

生成最终 turn 文本。

---

## Translation

输入：

```ts
ctx.segmentForJobResult
```

实现：

```ts
function getTextForTranslation(
    ctx: PipelineContext
) {

  return ctx.segmentForJobResult
      || ctx.asrText
      || "";
}
```

禁止读取：

```ts
ctx.repairedText
```

---

## Result Builder

实现：

```ts
result.text_asr =
    ctx.segmentForJobResult
    || ctx.asrText
    || "";
```

保证：

```text
text_asr
=
NMT input
```

---

# 六、接口样例

## Translation Input

```json
{
  "source": "segmentForJobResult",
  "text": "今天讨论 Lingua 项目下一阶段开发计划"
}
```

---

## Job Result

```json
{
  "text_asr": "今天讨论 Lingua 项目下一阶段开发计划",
  "text_translation": "Today we discuss the next development phase of Lingua."
}
```

---

# 七、代码修改清单

## P0

### post-asr-routing.ts

修改：

```ts
getTextForTranslation()
```

变更：

```text
只读取 segmentForJobResult
```

---

### translation-step.ts

确认：

```text
只能通过 getTextForTranslation 获取输入
```

---

### aggregation-step.ts

修改：

```text
Aggregation 统一读写 segmentForJobResult
```

---

### complete-aggregation.ts

修改：

```text
Finalize 后写回 segmentForJobResult
```

---

### fw-detector-step.ts

修改：

```text
Detector 输出直接覆盖 segmentForJobResult
```

---

### fw-detector-orchestrator.ts

修改：

```text
不再写 repairedText
```

---

### result-builder.ts

修改：

```text
text_asr 只读取 segmentForJobResult
```

---

### pipeline-context.ts

修改：

```text
删除 repairedText
```

---

# 八、Target List

| Priority | Target |
|----------|----------|
| P0 | 消除 repairedText / segmentForJobResult 双真值源 |
| P0 | NMT 统一读取 segmentForJobResult |
| P0 | Result Builder 统一读取 segmentForJobResult |
| P0 | Aggregation 统一读写 segmentForJobResult |
| P0 | FW Detector 统一输出 segmentForJobResult |
| P1 | 删除 repairedText 字段 |
| P1 | 删除所有 repairedText 引用 |
| P2 | 更新架构文档与冻结契约 |

---

# 九、Check List

## 架构

- [ ] segmentForJobResult 成为唯一文本事实源
- [ ] repairedText 已删除
- [ ] 不存在第三个最终文本字段

---

## ASR

- [ ] ASR 初始化 segmentForJobResult
- [ ] rawAsrText 保持 freeze 语义

---

## FW Detector

- [ ] Detector 输入为 segmentForJobResult
- [ ] Detector 输出为 segmentForJobResult
- [ ] 不生成 repairedText

---

## Aggregation

- [ ] non-finalize 正确 append
- [ ] finalize 正确生成 accumulated full turn text
- [ ] finalize 后写回 segmentForJobResult

---

## Translation

- [ ] NMT 输入来自 segmentForJobResult
- [ ] 不读取 repairedText

---

## Result Builder

- [ ] text_asr == segmentForJobResult
- [ ] text_asr 与 NMT 输入一致

---

## 回归检查

- [ ] freeze-contract.test PASS
- [ ] fw-detector-gate PASS
- [ ] pipeline tests PASS
- [ ] manual_cut PASS
- [ ] turn finalize PASS
- [ ] multi-chunk PASS

---

# 十、验收标准

满足以下条件即可验收：

1. 全仓不存在 repairedText 主链读取。
2. NMT 输入唯一来源为 segmentForJobResult。
3. text_asr 与 NMT 输入一致。
4. turn finalize 输出完整 accumulated text。
5. FW Detector 不再维护第二份最终文本。
6. 节点端内部只有一个文本事实源。
