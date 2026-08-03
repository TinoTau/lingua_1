---
status: SUPPORTING_CONTRACT
baseline: FW_V4_FREEZE_2026_08_03
classified_by: 2026-08-04_Documentation_Governance_Residual_Backlog_Closure
---

# Context Prior / Soft Demotion

| 字段 | 值 |
|------|-----|
| Status | **CURRENT**（diagnostics-only） |
| Date | 2026-07-20 |
| Owner | Runtime Domain diagnostics |
| Depends On | [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md) · [Runtime_SSOT_Contract_Freeze.md](../tone-v2/Runtime_SSOT_Contract_Freeze.md) |

---

## 冻结结论

Context Prior **不参与正式决策**：

```text
applied = false
不参与 Domain Vote
不参与 Domain Rerank（已删除）
不修改 Candidate score
不修改 Assembly membership
不修改 KenLM 输入或分值
```

代码：`fw-detector/span-assembly-shared/context-prior.ts`（diagnostics stub only）。

正式主链：

```text
Recall → Fine-Span Presence Vote → Multi-Bucket Assembly → KenLM
```

---

## 已删除 / 禁止引用

以下内容 **不再是权威**：

- `domain-rerank.ts`（已删除）
- Domain Rerank Penalty / soft multiplier 决策
- `computeContextPriorMultiplier` 决策函数

历史文档中关于「Vote 之后 Domain ReRank / Context Prior 乘分」的描述一律 **SUPERSEDED**。

---

## 允许保留

| 项 | 说明 |
|----|------|
| `ContextPriorStats` | 诊断字段 |
| runtime diag `applied: false` | 明确未施加 |
| skip reason 枚举 | 仅日志 |

禁止旁路：`Recall → Context Prior` 作为控制面 · CP 修改 KenLM。
