# Pinyin IME v2 SpanSelector 开发方案

版本：V1.0
日期：2026-06-07
性质：冻结架构调整方案

---

# 一、项目目标

将当前：

```text
Pinyin IME v2
↓
HintGate
↓
Recall
```

调整为：

```text
Pinyin IME v2
↓
SpanSelector
↓
Recall
```

恢复原始设计原则：

```text
IME负责发现Span

Recall负责召回候选

Tone负责排序

KenLM负责句级裁决

Apply负责最终替换
```

---

# 二、问题分析

## 当前实现

```text
raw ASR
↓
Proposal
↓
Normalizer
↓
HintGate
    support veto
    neighbor veto
↓
approved spans
↓
Recall
```

当前存在：

```text
diffSpanCount > 0
approvedSpanCount = 0
```

典型案例：

```text
d002

美食 → 美式
大悲 → 大杯
```

IME 已发现：

```text
diffSpanCount = 15
```

但：

```text
gateDroppedNoNeighbor = 2
approvedSpanCount = 0
```

导致：

```text
Recall 未运行
KenLM 未运行
Apply 未运行
```

---

## 根因

HintGate 当前承担：

```text
证明Span值得修
```

而不是：

```text
选择Span进入Recall
```

造成：

```text
Recall职责前移
```

违反冻结设计。

---

# 三、目标架构

## 旧架构

```text
Proposal
↓
Normalizer
↓
HintGate
↓
Recall
```

---

## 新架构

```text
Proposal
↓
Normalizer
↓
SpanSelector
↓
Recall
```

---

# 四、职责划分

## Proposal

负责：

```text
diff span
boundary span
instability span
```

输出：

```typescript
SpanProposal[]
```

---

## Normalizer

负责：

```text
结构过滤
```

规则：

```text
单字过滤
长度限制
音节限制
边界修正
```

保留。

---

## SpanSelector

负责：

```text
排序
裁剪
数量控制
```

不再负责：

```text
neighbor veto
support veto
```

---

## Recall

负责：

```text
候选生成
```

---

## Tone

负责：

```text
候选排序
```

---

## KenLM

负责：

```text
句级判断
```

---

## Apply

负责：

```text
最终替换
```

---

# 五、命名改造

## 文件

旧：

```text
pinyin-ime-v2-hint-gate.ts
```

新：

```text
pinyin-ime-v2-span-selector.ts
```

---

## 函数

旧：

```typescript
runPinyinImeV2HintGate()
```

新：

```typescript
selectPinyinImeV2Spans()
```

---

## 类型

旧：

```typescript
PinyinImeV2ApprovedSpan
```

新：

```typescript
PinyinImeV2SelectedSpan
```

---

## Diagnostics

旧：

```typescript
approvedSpanCount
```

新：

```typescript
selectedSpanCount
```

---

# 六、核心逻辑

## 旧逻辑

```typescript
for span in normalized:

    if support < minSupport:
        reject

    if !neighbor:
        reject

    if approved >= maxApproved:
        reject

    approved.push(span)
```

---

## 新逻辑

```typescript
if normalized.length <= maxSelectedSpans:

    selected = normalized

else:

    ranked = rank(normalized)

    selected =
        ranked.slice(0,maxSelectedSpans)
```

---

# 七、排序逻辑

neighbor

由：

```text
硬门控
```

改为：

```text
排序信号
```

---

support

由：

```text
硬门控
```

改为：

```text
排序信号
```

---

示例：

```typescript
score =
    supportWeight
    +
    neighborWeight
    +
    boundaryWeight
```

仅用于：

```text
超额裁剪
```

---

# 八、数据结构

## SelectedSpan

```typescript
interface SelectedSpan {

    rawSpan:string

    start:number

    end:number

    supportCount:number

    neighborHit:boolean

    score:number

}
```

---

## Diagnostics

```typescript
interface SpanSelectorDiagnostics {

    normalizedSpanCount:number

    selectedSpanCount:number

    selectionMode:
        | "all_passed"
        | "ranked_capped"
        | "empty_after_normalizer"

    neighborHitCount:number

    neighborMissCount:number

    cappedByMaxSpansCount:number

}
```

---

# 九、兼容层

保留一轮：

```typescript
approvedSpanCount
```

映射：

```typescript
selectedSpanCount
```

---

保留：

```typescript
gateDroppedNoNeighbor
```

映射：

```typescript
legacyGateDroppedNoNeighbor
```

---

保留：

```typescript
no_approved_spans
```

映射：

```typescript
no_selected_spans
```

---

# 十、Target List

## Core

* [ ] SpanSelector 文件创建
* [ ] HintGate 重命名
* [ ] SelectedSpan 类型创建
* [ ] Diagnostics 扩展

---

## Runtime

* [ ] resolve-pinyin-ime-v2-spans 更新
* [ ] map-selected-span-to-fw 更新
* [ ] index export 更新

---

## Compatibility

* [ ] alias 字段保留
* [ ] 旧测试兼容

---

## Docs

* [ ] ARCHITECTURE.md 更新
* [ ] README.md 更新
* [ ] 冻结文档更新

---

# 十一、Check List

## 编译

* [ ] TypeScript 编译通过
* [ ] 无循环依赖

---

## Contract

* [ ] contract PASS 200/200

---

## dialog_200

目标：

```text
fw_triggered ≥ 106
```

```text
no_spans ≤ 94
```

---

## d001

确认：

```text
仍卡在 proposal / normalizer
```

---

## d002

确认：

```text
selectedSpanCount >= 2
```

---

## d003

确认：

```text
行为不退化
```

---

## Runtime

* [ ] Tone 路径无变化
* [ ] Recall 路径无变化
* [ ] KenLM 路径无变化
* [ ] Apply 路径无变化

---

# 十二、验收标准

必须满足：

```text
contract PASS
```

```text
Span <= 4
```

```text
fw_triggered 显著提升
```

```text
no_spans 显著下降
```

```text
KenLM / Apply 无代码修改
```

```text
Tone 无代码修改
```

```text
Recall 无代码修改
```

通过后进入：

```text
PrimaryDomain
General → AllDomainWeakRecall
```

下一阶段开发。
