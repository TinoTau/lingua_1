# P3.2 KenLM Span Gate（FW-only）补充开发方案 V1.1

日期：2026-05-30

本文件为《P3_2_KenLM_Span_Gate_FW_only_开发方案》的补充冻结文档。
依据补充审计清单整理。

## 一、必须修正的设计项

### 1. FwSpanDiagnostics 映射

禁止新增 source 字段。

必须映射：

```ts
{
  text,
  start,
  end,
  domain: 'general',
  riskScore,
  signals: ['kenlm_local_low_prob'],
  candidates: [],
  applied: false
}
```

新增：

```ts
FwDetectorSignal += 'kenlm_local_low_prob'
```

---

### 2. SSOT 约束

KenLM Span Gate 输入只能来自：

```ts
ctx.rawAsrText
```

禁止：

```ts
ctx.segmentForJobResult
```

原因：

```text
segmentForJobResult 是 FW 输出字段
不是输入字段
```

---

### 3. 配置加载链

除 node-config 外必须修改：

```text
fw-detector/fw-config.ts
fw-detector/types.ts
fw-detector/fw-detector-orchestrator.ts
```

新增：

```ts
spanGateMode
kenlmSpanGate
```

并进入 configSnapshot。

---

### 4. 删除 Fail Open

删除：

```ts
failOpenToLegacyDetector
```

统一策略：

```text
KenLM 不可用
→ 0 spans
→ Skip FW
→ 不回退 Legacy Detector
```

---

### 5. Mode 定义

保留配置名：

```text
kenlm_gate_filter
```

但实现语义定义为：

```text
KenLM Span Gate
完全替代 Legacy Detector
```

不是二次过滤模式。

---

## 二、KenLM 实现约束

### 1. Scorer 创建

当前代码：

```ts
enableKenLMGate ? createKenlmBatchScorer() : null
```

必须改为：

```ts
enableKenLMGate || spanGateEnabled
```

保证：

```text
Gate 开启
Veto 关闭
```

仍然可以创建 scorer。

---

### 2. KenLM 能力边界

允许：

```text
整句评分
scoreBatch
单例模型复用
```

禁止假设：

```text
token score
局部分数
ngram 局部分数
```

必须使用：

```text
delete-span pseudo candidate
```

计算 delta。

---

### 3. 性能统计拆分

新增：

```text
kenlmSpanGateMs
kenlmSpanGateQueryCount
kenlmVetoMs
kenlmVetoQueryCount
```

禁止继续只统计：

```text
kenlmTiming
```

---

## 三、窗口枚举约束

### 1. CJK 枚举

禁止修改：

```text
suspicious-span-detector-v1.ts
```

实现方式：

```text
复制同等 CJK_RUN 逻辑
或新增共享模块
```

确保与 Legacy 一致。

---

### 2. Span 长度

固定：

```text
2~4 字
```

禁止：

```text
1 字 span
```

---

### 3. Recall 对齐

保持兼容：

```text
Recall 音节数
2~5
```

无需修改 Recall。

---

## 四、PreFilter 规则（新增）

开发方案原文缺失。

统一定义：

```text
Step1
枚举窗口

Step2
Stopword Filter

Step3
长度优先

Step4
保留 Top N

Step5
KenLM scoreBatch
```

默认：

```json
{
  "preFilterMaxWindows": 20
}
```

禁止：

```text
Lexicon 命中反推 Span
```

---

## 五、0 Span 早退路径

必须实现：

```text
Gate
↓
0 spans
↓
不调用 Recall
↓
不调用 Pipeline
↓
直接输出 rawText
```

结果：

```json
{
  "reason": "no_spans",
  "spanCount": 0,
  "appliedCount": 0
}
```

---

## 六、冻结边界

允许修改：

```text
kenlm-span-selector.ts
fw-detector-orchestrator.ts
fw-config.ts
types.ts
node-config-types.ts
node-config-defaults.ts
批测脚本
```

禁止修改：

```text
kenlm-span-gate.ts
fw-topk-decision-pipeline.ts
suspicious-span-detector-v1.ts
apply-span-replacements.ts
Recover
CTC
Pipeline 顺序
```

---

## 七、批测配置

必须固定：

```json
{
  "spanGateMode": "kenlm_gate_filter",
  "useLexiconRuntimeV2Recall": true,
  "useIndustryRouting": false,
  "maxBaseCandidates": 2,
  "maxDomainCandidates": 3,
  "maxIdiomCandidates": 0
}
```

---

## 八、Target List（补充版）

### P0

- 新增 kenlm-span-selector.ts
- 新增 diagnostics 类型
- 新增 signal 类型
- 新增 fw-config 配置加载
- 新增 scorer 独立创建逻辑
- 新增 orchestrator 0 span 早退
- 新增 gate diagnostics 输出
- 新增 configSnapshot 字段

### P1

- 单元测试
- freeze-contract 测试
- fw-gate 测试
- dialog_200 全量批测
- gate/veto 性能拆分

### P2

- minLocalDelta 调参
- stopword 调参
- preFilterMaxWindows 调参
- cafe case 验证
- span/job ≤2 验证

---

## 九、验收标准

全部满足：

```text
dialog_200 PASS

span/job ≤ 2

recall ↓ ≥80%

FW apply ≤ 20

fw_degrade = 0

CER ≤ Phase2

KenLM 总耗时 < Phase3 Hotfix

CTC 无引用
```

---

## 十、特别风险

当前审计已经确认：

```text
V2 repair_target
几乎全开
```

因此：

```text
KenLM Span Gate
只能解决 Span Explosion

不能单独解决
Repair Explosion
```

如果：

```text
span/job ≤ 2
但 FW apply 仍然偏高
```

则进入：

```text
P3.3 RepairTarget / Candidate Quality
```

而不是继续修改 Span Gate。
