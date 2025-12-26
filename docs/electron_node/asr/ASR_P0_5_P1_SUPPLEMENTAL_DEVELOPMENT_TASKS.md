
# ASR 准确率提升补充开发方案与 Task List（P0.5 / P1）
## 基于：当前实现结果报告 + 既有 ASR_MULTILINGUAL_TURN_TAKING_ACCURACY_STRATEGY

> 本文档用于明确：在已完成 P0 的前提下，还需要补充哪些开发内容，
> 才能让系统从“可诊断”迈入“可自愈”，并为 P1 语义级优化铺路。
> 不涉及推翻现有实现，仅为增量补强。

---

## 一、当前状态回顾（结论性摘要）

### 已完成（P0，已验收）
- 边界稳态化：Hangover / Padding / Short-merge
- segments 时间戳提取与断裂检测
- 坏段判定器（结构性、置信度、重复、异常字符）
- qualityScore / reasonCodes 全链路透传
- 指标与测试报告完整

### 当前不足（非缺陷）
1. 坏段仅被识别，未触发自动补救
2. qualityScore 尚未参与运行时决策
3. 同音错词（语义级错误）未覆盖（明确属于 P1）

---

## 二、必须补充的开发内容（P0.5）

### P0.5-1：坏段 → Top-2 语言强制重跑

**触发条件（保守）：**
- isBad == true
- language_probability < 0.60
- audioDurationMs >= 1500
- rerun_count == 0

**动作：**
- 取 language_probabilities 的 top-2
- 对当前音频执行一次强制语言 ASR
- 使用 qualityScore 择优
- 记录 rerun_count 与 rerun_reason

---

### P0.5-2：qualityScore 参与决策（防上下文污染）

- qualityScore < 0.4 → 禁用上下文 prompt
- 连续 2 次低质量 → reset 会话上下文

---

## 三、P1：同音错词（语义级）补充能力

### P1-1：同音错词触发器
- glossary 命中但拼写异常
- 高歧义同音词
- 用户短时间内重复表达

### P1-2：同音候选生成
- 仅替换 1 个 span
- 候选 ≤ 10
- 来源：glossary / 高频词库

### P1-3：候选重排
- 规则 + glossary 评分（先不引入 LM）
- 可选 GPU LM rerank

---

## 四、补充 Task List（JIRA）

### EPIC-ASR-P0_5-SELFHEAL

| Key | 任务 | 工期 |
|---|---|---|
| SH-1 | 坏段触发条件封装 | 0.5d |
| SH-2 | Top-2 强制语言重跑 | 1.0d |
| SH-3 | qualityScore 择优 | 0.5d |
| SH-4 | rerun 限频与超时 | 0.5d |
| SH-5 | rerun 指标埋点 | 0.5d |

### EPIC-ASR-P0_5-CONTEXT

| Key | 任务 | 工期 |
|---|---|---|
| CTX-1 | 低质量禁用 context | 0.5d |
| CTX-2 | 连续低质量 reset context | 0.5d |

### EPIC-ASR-P1-SEMANTIC

| Key | 任务 | 工期 |
|---|---|---|
| SEM-1 | glossary 接口 | 1.0d |
| SEM-2 | 同音候选生成 | 2.0d |
| SEM-3 | 候选重排（无 LM） | 1.0d |
| SEM-4 | 语义级指标与回放 | 1.0d |
| SEM-5 | （可选）LM rerank | 2.0d |

---

## 五、实施顺序建议
1. P0.5 自愈闭环（SH + CTX）
2. 稳定运行与指标观测
3. P1 同音错词模块

---

## 六、管理侧一句话总结
当前系统已能稳定诊断 ASR 结构性失败；
补充 P0.5 后将具备有限自愈能力，
P1 将专注解决同音错词等语义级问题。
