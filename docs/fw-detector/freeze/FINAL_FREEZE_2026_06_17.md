# FW Repair V4 — 最终冻结裁决

**日期**：2026-06-17  
**结论**：**Final Freeze Approved**

---

## 1. 冻结模块

| 模块 | 版本 | 文档 |
|------|------|------|
| SameDomain Assembly | V1.2 | [assembly/FROZEN_V1_2.md](../assembly/FROZEN_V1_2.md) |
| Coverage + Compatibility | V1.2 / V1.1 | [compatibility/FROZEN.md](../compatibility/FROZEN.md) |
| Tone-First Recall | V1.0.1 | [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](../recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) |
| Diagnostics Trace | V1.0.2 | [diagnostics/TRACE_FROZEN_V1_0_2.md](../diagnostics/TRACE_FROZEN_V1_0_2.md) |
| KenLM Runtime | batch-only | [kenlm/KENLM_RUNTIME.md](../kenlm/KENLM_RUNTIME.md) |
| Beam Shadow | V4 既有 | 仅 diagnostics |

---

## 2. 代码边界

**主链入口**：`runFwDetectorV4Path` · `pipelinePath = 'v4'`

**已退役**：V2/V3 pipeline · `span-assembly-v3/` · KenLM serial runtime · `fallbackToSerial`

---

## 3. 禁止后续工作（冻结内）

- 修改 Tone-First 查询策略 / composite SQL 语义
- Assembly / Domain Vote / Beam 主链 Silent Change
- 恢复 KenLM serial 或 dual runtime
- Compatibility 层外新增 overlap 判定
- 将 Trace Gate 默认开启或接入业务分支

---

## 4. 允许后续工作

- `phonetic-correction/lm-scorer.ts` 中 `runKenlmQuery` dead code 清理（独立 PR）
- Diagnostics trace 批测（patch 脚本，不改 SSOT 默认）
- KenLM pick 阈值策略调优（须新 Contract，非 Silent Change）

---

## 5. Outstanding（非 Blocker）

| 项 | 说明 |
|----|------|
| d001 `tone_exact` vs `plain_fallback` | 验收口径 / 声学输入，非机制缺陷 |
| Apply=0 | `maxDelta` 未达 `minDeltaToReplace` |
| PreFilter trace 偶发重复行 | 可观测层 |

---

索引：[README.md](../README.md) · [ARCHITECTURE.md](../ARCHITECTURE.md)
