# Domain-Constrained Recall P2 冻结开发方案

版本：P2 Freeze
日期：2026-06-03

---

# 一、目标

在不修改冻结主链的前提下：

```text
rawAsrText
↓
Pinyin-IME-V2
↓
HintGate
↓
Recall
↓
Candidate Builder
↓
KenLM
↓
Apply
```

新增：

```text
SentenceDomainProfile
```

用于约束：

```text
Recall Candidate Pool
```

保证：

```text
同一句话内部

所有 Span Candidate

尽可能属于同领域
```

---

# 二、明确不做的事情

本阶段禁止：

* 修改 IME
* 修改 ApprovedSpan
* 修改 Apply
* 修改 KenLM
* 修改 Builder 组合逻辑
* 修改 SegmentForJobResult
* 修改 FW
* 引入 Session Topic Lock
* 引入 CPU LLM 阻塞推理

---

# 三、核心思想

旧模型：

```text
Span1
↓
独立 Recall

Span2
↓
独立 Recall

Span3
↓
独立 Recall
```

导致：

```text
烧饼
哨兵
角马
筋斗
```

进入候选池。

---

新模型：

```text
rawAsrText
↓
SentenceDomainProfile
↓
Span Recall
```

所有 Span 共用：

```ts
SentenceDomainProfile
```

---

# 四、架构

## 新增模块

```text
infer-sentence-domain-profile.ts
```

位置：

```text
runFwSentenceRerankPipeline
入口
```

不进入 IME。

---

## 调用链

```text
runFwSentenceRerankPipeline

↓
inferSentenceDomainProfile

↓
recallSpanTopK

↓
buildSentenceCandidates

↓
KenLM
```

---

# 五、数据结构

## SentenceDomainProfile

```ts
export interface SentenceDomainProfile {
  primaryDomain?: string;

  domainCandidates: Array<{
    id: string;
    score: number;
    matchedTerms: string[];
  }>;

  safeBaseAllowed: boolean;

  source:
    | "routing"
    | "enabledDomains"
    | "fallback";
}
```

---

## Recall Candidate Metadata

新增：

```ts
recallDomainId?: string;

recallTier?:
  | "domain"
  | "base_safe"
  | "base"
  | "idiom";

sentenceDomainMatchScore?: number;
```

注意：

仅用于：

```text
ranking
diagnostics
```

禁止进入：

```text
Apply
```

---

# 六、Recall 策略

采用：

```text
方案 B + 方案 C
```

禁止：

```text
纯 SQL 强过滤
```

---

## Candidate Weight

排序：

```text
sameDomain
>
enabledDomain
>
base_safe
>
unrelated_base
```

---

## Candidate Filter

允许：

```text
sameDomain

base_safe
```

---

降权：

```text
unrelated_base
```

---

必要时过滤：

```text
military

animal

food

tech

travel
```

跨域候选。

---

# 七、base_safe

新增：

```text
base_safe
```

层。

---

包含：

```text
常见口语

常见连接词

常见动作词

高频业务词
```

例如：

```text
上线
文档
进度
评审
检查
提交
发布
确认
```

---

禁止包含：

```text
烧饼
哨兵
角马
筋斗
```

这类跨领域实体。

---

# 八、词库结构

Phase 2 不改表。

使用：

```text
source
```

临时表达：

```text
base_safe

domain
```

---

后续：

```text
Phase 3

subdomain

cluster
```

再扩展字段。

---

# 九、Builder

禁止修改组合算法。

仅允许：

```ts
candidateScore +=
sentenceDomainMatchScore;
```

用于排序。

---

禁止：

```text
改变组合空间

改变 Top16

改变 KenLM 输入
```

---

# 十、Target List

## Runtime

* [ ] SentenceDomainProfile
* [ ] profile 推断器
* [ ] profile diagnostics

---

## Recall

* [ ] Candidate metadata
* [ ] domain match score
* [ ] domain filter
* [ ] base_safe support

---

## Lexicon

* [ ] base_safe 导入规则
* [ ] domain source 导入规则

---

## Diagnostics

* [ ] sentenceDomainProfile
* [ ] candidateDomain
* [ ] candidateTier
* [ ] domainFilteredCount

---

# 十一、Check List

## 架构

* [ ] 不修改 IME
* [ ] 不修改 ApprovedSpan
* [ ] 不修改 Apply
* [ ] 不修改 KenLM

---

## 性能

* [ ] Recall ms 无明显增加
* [ ] Builder count 不增加
* [ ] KenLM query 不增加

---

## 功能

* [ ] 烧饼被降权
* [ ] 哨兵被降权
* [ ] 角马被降权
* [ ] 筋斗被降权

---

## 安全

* [ ] base_safe fallback 存在
* [ ] 无 Recall 空洞
* [ ] 无 Builder 空组合

---

# 十二、验收标准

Dialog200：

```text
Recall Width
不变

Builder Count
不变

KenLM Query
不变
```

同时：

```text
跨领域候选数量下降

Domain Match 候选比例上升
```

即可验收通过。
