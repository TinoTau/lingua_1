# FW Repair V4 — 最终冻结裁决

**日期**：2026-06-17  
**结论**：**A — Final Freeze Approved**  
**KenLM 审计**：**允许进入**（Recall 基线已稳定）

---

## 1. 执行摘要

| 维度 | 结论 |
|------|------|
| 设计漂移 | PASS |
| Contract Closure | PASS |
| Mechanism Zero Diff | PASS |
| Trace / Summary 可观测 | PASS |
| 最终冻结 | **A — Approved** |

**说明**：d001 批测中 `toneLookupStage` 可为 `plain_fallback`（非 `tone_exact`），属验收口径/声学输入问题，**不是**机制或 V1.0.2 缺陷；Trace 已如实报告。

---

## 2. 冻结模块矩阵

| 模块 | 版本 | 状态 |
|------|------|------|
| SameDomain Assembly | V1.2 | **FROZEN** — 见 [assembly/FROZEN_V1_2.md](../assembly/FROZEN_V1_2.md) |
| Coverage Merge | V1.2 | **FROZEN** — 见 [compatibility/COVERAGE_MERGE_FROZEN_V1_2.md](../compatibility/COVERAGE_MERGE_FROZEN_V1_2.md) |
| Compatibility Authority | V1.1 | **FROZEN** — 见 [compatibility/AUTHORITY_REDUCTION_FROZEN_V1_1.md](../compatibility/AUTHORITY_REDUCTION_FROZEN_V1_1.md) |
| Tone-First Recall | V1.0.1 | **FROZEN** — 见 [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](../recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) |
| Diagnostics Trace | V1.0.2 | **FROZEN** — 见 [diagnostics/TRACE_FROZEN_V1_0_2.md](../diagnostics/TRACE_FROZEN_V1_0_2.md) |
| Tone Module（声学） | V4 既有 | **FROZEN**（本轮未改） |
| Domain Vote | V4 既有 | **FROZEN** |
| Beam Shadow | V4 既有 | **FROZEN** |
| KenLM Interface | V4 rerank | **FROZEN**（Apply=0 为门槛策略，非本冻结范围） |

---

## 3. 代码边界（本轮）

### Tone-First V1.0.1（机制）

```text
lexicon/phonetic/tone-pinyin.ts
lexicon/tone-recall-sort.ts
lexicon-v2/tone-first-tier-collector.ts
lexicon-v2/lexicon-runtime-v2.ts
lexicon-v2/recall-span-topk-v2.ts
```

### Diagnostics V1.0.2（plumbing）

```text
fw-detector/fw-detector-v4-path.ts
lexicon-v2/recall-span-topk-v2.ts
lexicon-v2/recall-span-topkv3.ts
fw-detector/span-assembly-v4/recall-topk-for-windows.ts
fw-detector/span-assembly-v4/v4-diagnostics-*
fw-detector/span-assembly-shared/types.ts
```

---

## 4. 验证结论（摘要）

| 验证项 | 结果 |
|--------|------|
| freeze-contract / freeze-config-ssot | PASS |
| dialog200 Stage A contract | 81/81 PASS |
| 机制零 diff | PASS |
| Trace Gate Stage B | PASS |
| d048 烧饼 plain_fallback + incompatible | PASS |
| d001 中杯/蓝莓马芬 KenLM 命中 | PASS |
| Diagnostics 污染 KenLM | **否** |

---

## 5. 允许后续工作

- **KenLM 审计**（`docs/KenLM Audit/` P1–P6）
- Diagnostics trace 批测复现（patch 脚本，不改 SSOT 默认）

---

## 6. 禁止后续工作（冻结内）

- 修改 `tone-first-tier-collector` 查询策略
- 修改 composite SQL / cache 语义
- 为通过 d001 `tone_exact` 门禁而改 Recall 或声学对齐
- 将 Trace Gate 默认开启或接入业务分支
- Assembly / Domain Vote / Beam 主链 Silent Change

---

## 7. Outstanding（非 Blocker）

| ID | 项 | 严重度 |
|----|-----|--------|
| M1 | d001 trace 期望 `tone_exact` vs 实际 `plain_fallback` | Medium（验收口径） |
| L1 | 分析脚本硬编码 tone_exact 期望 | Low |
| L2 | PreFilter trace 偶发重复行 | Low |
| L3 | Apply=0 → final CER=raw CER | Low（KenLM 门槛） |

**不构成**机制或 Contract 漂移，**不阻断** KenLM 审计。

---

## 8. KenLM Readiness

| 问题 | 答案 |
|------|------|
| KenLM 审计是否需要再改 Recall？ | **不需要** |
| Diagnostics 是否污染 KenLM 输入？ | **否** |
| 是否允许进入 KenLM Audit？ | **是** |

**KenLM Readiness：PASS**

---

## 9. 文档 SSOT

本目录仅保留模块冻结合约 + 架构/配置索引。历史开发方案、PreDev 审计、测试/开发报告已移除或合并入各模块 `FROZEN*.md`。

索引：[README.md](../README.md) · 架构：[ARCHITECTURE.md](../ARCHITECTURE.md)
