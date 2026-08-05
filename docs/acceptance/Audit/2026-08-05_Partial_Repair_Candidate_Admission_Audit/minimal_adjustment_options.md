# Minimal Adjustment Options (READ ONLY — no code change)

Baseline: `FW_V4_FREEZE_2026_08_03`  
Constraint: no Tone / Recall / Domain / KenLM / Lexicon changes.

## Option A — Assembly 标记，不过滤

为每个 `SentenceCombination` 增加审计字段（如 `repairCompleteness=PARTIAL|COMPLETE|RAW`），**仍全部**进入 CrossPath。

| 维度 | 评估 |
|------|------|
| 候选质量 | 不提升（池不变） |
| 误删风险 | 无 |
| 性能 | 几乎无影响 |
| 复杂度 | 低 |
| 偏离冻结 | 低（诊断扩展） |
| 隐藏 Gate | 无 |

**用途：** 仅可观测性；**不能**解决预算被 Partial 占用。

---

## Option B — CrossPath Admission（推荐方向）

在 `mergeCrossPathSentenceCandidates`（或紧前）按完整性做预算：

- 有 COMPLETE 时：Partial 降优先或限配额
- 无 COMPLETE 时：仍可保留 Partial（避免空池）

| 维度 | 评估 |
|------|------|
| 候选质量 | 中高 — Top16 更偏向完整/混合合法句 |
| 误删风险 | 中 — 需保守：无 COMPLETE 时不硬删 Partial |
| 性能 | 低成本（文本级规则） |
| 复杂度 | 中 |
| 偏离冻结 | 中 — CrossPath 职责从「纯 dedupe+cap」扩展到 admission |
| 隐藏 Gate | 需显式合同，避免静默语义黑名单 |

**对齐冻结意图：** KenLM 仍是唯一流畅度裁判；CrossPath 只做 **结构完整性预算**，不做 LM。

---

## Option C — Assembly Admission

对明显 incomplete replacement cluster（如 repair 邻接仍保留已知损坏 Raw 片段簇）**不登记**为正式 `SentenceCombination`，但 Path/诊断仍保留。

| 维度 | 评估 |
|------|------|
| 候选质量 | 高 — 从源头少产 Partial |
| 误删风险 | 中高 — cluster 定义错误会丢有用半修复 |
| 性能 | 减少枚举输出 |
| 复杂度 | 中高（需 cluster 定义，禁止二字黑名单） |
| 偏离冻结 | 中 — Assembly 增加 admission |
| 隐藏 Gate | 风险高于 B |

---

## Option D — 保持现状

全部局部 replacement 继续进 KenLM。

| 维度 | 评估 |
|------|------|
| 候选质量 | 维持现状（本审计认定不足） |
| 误删风险 | 无新增 |
| 性能 | 无 |
| 复杂度 | 无 |
| 偏离冻结 | 无 |
| 隐藏 Gate | 无 |

---

## 比较结论（审计建议，非实施）

```text
优先考虑 Option B（CrossPath Admission / 预算优先级）
次选 Option C（若能用不含词面黑名单的 cluster 规则精确定义）
Option A 仅作诊断前置
Option D 不解决已确认缺陷
```

不得：生城/声城黑名单、恢复 Plain Recall、改 Tone SQL、加「候选生成」词条。
