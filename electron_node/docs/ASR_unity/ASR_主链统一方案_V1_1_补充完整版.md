# ASR 主链统一方案 V1.1（补充完善版）

版本：V1.1
日期：2026-05-30
状态：P0 架构冻结候选

## 执行摘要

本版本基于 V1 方案与代码审计补充清单进行合并。

核心结论：

- 保留 `rawAsrText` 作为 immutable ASR 原文。
- `segmentForJobResult` 成为节点端唯一业务真值（SSOT）。
- 删除 `repairedText` 主链语义。
- FW Detector、Aggregation、Dedup、Semantic Repair、NMT、Result Builder 全部统一到 `segmentForJobResult`。
- 删除 `syncRepairedTextBaseline`。
- 重写 freeze-contract 与 pipeline 契约测试。
- turn finalize 场景以“完整 turn 文本”为唯一输出。

---

# 一、最终字段架构

## 保留字段

```ts
interface PipelineContext {
  rawAsrText?: string;
  asrText?: string;
  segmentForJobResult?: string;
}
```

### rawAsrText

职责：

```text
ASR immutable 原文
```

用途：

- 审计
- 批测
- extra.raw_asr_text
- Detector 原始检测基准

禁止：

```text
任何 Step 覆盖
任何 Repair 修改
NMT 使用
```

---

### asrText

职责：

```text
多 batch 拼接观测字段
```

用途：

- diagnostics
- 调试

禁止：

```text
NMT 输入
最终结果输出
```

---

### segmentForJobResult

职责：

```text
唯一业务真值
Single Source Of Truth
```

用途：

- FW Detector 输出
- Aggregation 输出
- Dedup 输入
- Semantic Repair 输入输出
- Translation 输入
- Result Builder 输出

---

# 二、Detector 输入决策

冻结决策：

```text
D1 = rawAsrText
```

实现：

```ts
const detectInput = ctx.rawAsrText;
```

原因：

```text
rawAsrText 不可变
不会受到后续 Step 污染
便于审计和回放
```

Detector 输出：

```ts
ctx.segmentForJobResult = repaired;
```

禁止：

```ts
ctx.repairedText = ...
```

---

# 三、完整链路

```text
ASR
 ↓
rawAsrText
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
Dedup
 ↓
segmentForJobResult
 ↓
Semantic Repair(可选)
 ↓
segmentForJobResult
 ↓
Translation
 ↓
segmentForJobResult
 ↓
Result Builder
```

---

# 四、Turn 流式约束

## non-finalize

```ts
appendTurnSegment(
  ctx.segmentForJobResult
);

ctx.shouldDeferTranslation = true;
```

禁止：

```ts
ctx.segmentForJobResult = "";
```

禁止：

```ts
ctx.repairedText = "";
```

---

## finalize

```ts
ctx.segmentForJobResult =
    accumulatedFullTurnText;
```

要求：

```text
NMT 输入 = 完整 turn
text_asr = 完整 turn
```

---

# 五、必须删除的逻辑

## syncRepairedTextBaseline

直接删除：

```text
post-asr-routing.ts
semantic-repair-step.ts
相关测试
```

原因：

```text
其存在目的就是复制 repairedText
与 SSOT 架构冲突
```

---

## repairedText

删除：

```text
PipelineContext
Result Builder
Dedup
Semantic Repair
FW Detector
Session Runtime
Replay Patch
Intent Warmup
```

---

# 六、写锁机制

保留：

```ts
asrRepairApplied
```

重命名建议：

```ts
isSegmentWriteLocked()
```

语义：

```text
segmentForJobResult 已被修复
后续 Step 不允许覆盖
```

适用：

- FW Detector
- 5015
- 5016

5017：

默认 OFF

未来开启时：

```text
respect lock
```

---

# 七、接口样例

## Translation Input

```json
{
  "source": "segmentForJobResult",
  "text": "今天讨论 Lingua 项目下一阶段开发计划"
}
```

## Result

```json
{
  "text_asr": "今天讨论 Lingua 项目下一阶段开发计划",
  "translation": "Today we discuss the next development phase of Lingua."
}
```

---

# 八、代码修改清单

## P0

### post-asr-routing.ts

- 删除 syncRepairedTextBaseline
- getTextForTranslation 只读 segmentForJobResult

### aggregation-step.ts

- 删除 repaired 分支
- append segmentForJobResult
- finalize 写回 segmentForJobResult

### complete-aggregation.ts

- 不同步 repairedText
- 仅处理 routing flag

### asr-step.ts

初始化：

```ts
ctx.segmentForJobResult = asrText;
```

### fw-detector-step.ts

只写：

```ts
segmentForJobResult
```

### fw-detector-orchestrator.ts

输入：

```ts
rawAsrText
```

输出：

```ts
segmentForJobResult
```

### dedup-step.ts

只读：

```ts
segmentForJobResult
```

### semantic-repair-step.ts

输入输出统一：

```ts
segmentForJobResult
```

### result-builder.ts

输出：

```ts
text_asr = segmentForJobResult
```

删除：

```text
text_asr_repaired
```

---

# 九、外围改造

## Session Runtime

修改：

```text
RollingTurn.repairedText
```

改为：

```text
RollingTurn.finalText
```

## Replay Patch

统一读取：

```text
segmentForJobResult
```

## Intent Warmup

统一读取：

```text
segmentForJobResult
```

---

# 十、架构决策

## D1

Detector 输入

```text
rawAsrText
```

冻结

## D2

多 Batch

短期：

```text
文档限制
Detector 不保证跨 batch
```

中期：

```text
finalize 全 turn detect
```

## D3

5017

默认关闭

开启时遵守写锁

## D4

pipeline-job-flow

旧契约：

```text
仅末 chunk
```

废弃

新契约：

```text
完整 turn
```

## D5

Recover

保留代码时：

```text
统一写 segmentForJobResult
```

---

# 十一、Target List

| Priority | Target |
|----------|----------|
| P0 | 消除双真值源 |
| P0 | 删除 syncRepairedTextBaseline |
| P0 | NMT 统一读取 segmentForJobResult |
| P0 | Result Builder 统一读取 segmentForJobResult |
| P0 | Aggregation 统一读写 segmentForJobResult |
| P0 | Dedup 统一读取 segmentForJobResult |
| P0 | Semantic Repair 统一读写 segmentForJobResult |
| P1 | 删除 repairedText 字段 |
| P1 | Session/Replay/Intent 对齐 |
| P1 | Freeze Contract 重写 |
| P2 | 多 batch detect 架构升级 |

---

# 十二、Check List

## 架构

- [ ] segmentForJobResult 为唯一真值
- [ ] repairedText 已删除
- [ ] syncRepairedTextBaseline 已删除
- [ ] 不存在第三文本源

## Detector

- [ ] 输入 rawAsrText
- [ ] 输出 segmentForJobResult
- [ ] 不写 repairedText

## Aggregation

- [ ] non-finalize append segment
- [ ] finalize 输出完整 turn
- [ ] defer 不清 segment

## Translation

- [ ] NMT 只读 segmentForJobResult

## Result Builder

- [ ] text_asr == NMT input
- [ ] text_asr_repaired 已删除

## Session

- [ ] RollingTurn 不再依赖 repairedText

## 回归

- [ ] freeze-contract.test PASS
- [ ] fw-detector-gate PASS
- [ ] pipeline tests PASS
- [ ] dialog_200 PASS
- [ ] multi-chunk finalize PASS
