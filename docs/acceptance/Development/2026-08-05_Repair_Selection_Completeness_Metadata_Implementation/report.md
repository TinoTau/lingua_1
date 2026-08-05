# FW Repair V4 — Repair Selection Completeness Metadata-Only Implementation

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | `FW_V4_FREEZE_2026_08_03` |
| Nature | DEVELOPMENT · metadata-only |
| Verdict | **METADATA_IMPLEMENTATION_COMPLETE** |

---

## Q1 — 新 Metadata 是否由 Assembly 唯一计算？

**是。** Sole Owner = `buildSentenceCandidates`；计算委托 Assembly-local pure helper `deriveRepairSelectionCompleteness`（`derive-repair-selection-completeness.ts`）。CrossPath / KenLM / orchestrator / JobResult mapper 无重算。

---

## Q2 — 是否严格实现 Formula A？

**是。** Slot Coverage：

```text
repairPickCount = count(non-canonical replacements)
unrepairedRepairableSlotCount = repairable slots not covered by any repair pick
IF repairPickCount == 0 → RAW
ELSE IF unrepairedRepairableSlotCount == 0 → COMPLETE_SELECTION
ELSE → PARTIAL_SELECTION
```

Canonical：`source == 'canonical_exact' OR word == span.text`。无第四状态、无 cluster、无阈值。

---

## Q3 — 是否使用唯一稳定 slot identity？

**是。** Slot identity = `spanSets[i]` 对齐的 `coarseRanges[i]` / `{start,end}` 字符区间。覆盖判定：`pick.span` 与 slot range 区间重叠。禁止仅按 surface / 数组顺序猜测。Case 7 覆盖同 surface 不同 range。

---

## Q4 — Raw-only slot 是否正确排除？

**是。** 无非 canonical option 的 slot 不增加 `unrepairedRepairableSlotCount`。能力边界 Case 4（候选声城）与 75-case 导出中 `d043/d088/d133/d178` 的 `候选声城` 均为 `COMPLETE_SELECTION`。

---

## Q5 — CrossPath 是否完全不重算、不筛选？

**是。** `mergeCrossPathSentenceCandidates` 仍仅 exact-text first-wins + cap≤16；对象原样 push，不读三字段。

---

## Q6 — KenLM 是否完全不读取？

**是。** 静态搜索：`repairSelectionCompleteness` 不出现在 `fw-detector/kenlm/**` 与 `rerank-fw-sentences.ts` 生产代码。`accept:domain-multibucket-kenlm` → `ACCEPTANCE_PASS`。

---

## Q7 — JobResult 是否保持不变？

**是。** 本轮未修改 JobResult；metadata 保留在 `SentenceCombination` / CombinationTrace 可选观测字段。

---

## Q8 — Candidate text / count / ID / order 是否完全不变？

**是（按设计 + 测试证明）。** 生成/排序/dedupe/cap 路径未读取新字段；仅 DTO 附加三字段。Jest：`build-sentence-candidates` / CrossPath / rerank / freeze-contract 通过。

---

## Q9 — dialog_200 最终输出是否完全不变？

**Metadata-only 合同下最终 pick 路径不变。** 本轮未改 KenLM / cap / admission。完整 dialog_200 音频 E2E 需节点服务；本轮以：

- Formula A 单元测试
- freeze-contract + CrossPath + Assembly 测试
- `accept:domain-multibucket-kenlm` PASS
- 静态证明无 Hidden Gate

作为行为不变证据。冻结基线仍为 dialog_200 **200/200**（`FW_V4_FREEZE_2026_08_03`）。

---

## Q10 — 75 个 Competition Case 的 Metadata 分布？

对 `KENLM_BENCHMARK_V1` 的 **75** case / **212** kenlmInput 候选，用正式 Formula A helper 对 Assembly Trace 重算：

| Enum | Count | Ratio |
|------|------:|------:|
| RAW | 75 | 35.4% |
| PARTIAL_SELECTION | 52 | 24.5% |
| COMPLETE_SELECTION | 85 | 40.1% |

详见 `metadata_distribution.csv`。

---

## Q11 — “候选声城”是否按能力边界标为 COMPLETE_SELECTION？

**是。** 例：`d043:k0` / `d088:k0` / `d133:k0` / `d178:k0`：

```text
repairSelectionCompleteness = COMPLETE_SELECTION
repairPickCount = 1
unrepairedRepairableSlotCount = 0
```

**说明：这是结构完整（replacement selection completeness），不代表语义正确。** `声`/`城` 为 raw-only slot，不计未修复。

---

## Q12 — CURRENT SSOT 是否已更新？

**是。** 更新唯一 CURRENT 路径：

- `docs/fw-detector/INTERFACE_FREEZE.md`（SentenceCombination Data Contract）
- `docs/fw-detector/assembly/FROZEN_V1_2.md`（Assembly Contract）
- `docs/fw-detector/ARCHITECTURE.md`（Ownership）
- `docs/fw-detector/diagnostics/FROZEN.md`（Diagnostics）
- `docs/fw-detector/freeze/FROZEN.md`（registry pointer）
- Snapshot `04_Data_Contract.md` 同步字段表

未创建 FINAL / LATEST / V2 平行权威。`docs:check` ok。

---

## Q13 — 是否存在任何 Hidden Gate？

**否。** 无按 completeness 过滤、排序、预算调整、KenLM 输入改变。Admission 留给后续独立审计。

---

## Q14 — 是否可以冻结 metadata-only implementation？

**是 → `METADATA_IMPLEMENTATION_COMPLETE`。**

---

## 最终结论

```text
METADATA_IMPLEMENTATION_COMPLETE

repairSelectionCompleteness 已按 Formula A
由 Sentence Assembly 唯一计算并写入 SentenceCombination。

CrossPath 仅传递、不重算、不筛选；
KenLM 完全无感知；
Runtime 候选、排序和最终输出完全不变。

Metadata-only Contract 已完成实现，
可作为后续诊断与结构性候选预算研究的 SSOT。
```
