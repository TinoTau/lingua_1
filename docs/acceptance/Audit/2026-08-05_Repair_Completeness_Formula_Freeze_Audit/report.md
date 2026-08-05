# FW Repair V4 — Repair Completeness Formula Freeze Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | `FW_V4_FREEZE_2026_08_03` |
| Prior | SentenceCombination ownership freeze — Assembly Sole Owner |
| Nature | READ ONLY formula freeze |
| Verdict | **FORMULA_SCOPE_RENAMED_AND_READY** |

---

## Frozen formula (summary)

```text
Name:  repairSelectionCompleteness
Enum:  RAW | PARTIAL_SELECTION | COMPLETE_SELECTION
Rule:  Formula A — Slot Coverage
Counts: repairPickCount, unrepairedRepairableSlotCount
```

`声`/`城` 无 Recall 选项 ⇒ **Raw-only Slot** ⇒ 不算 unrepaired repairable。

因此 **「候选声城」⇒ COMPLETE_SELECTION（结构）**，不是 PARTIAL。  
语义半修复：`CURRENT_METADATA_INSUFFICIENT_FOR_SEMANTIC_PARTIAL_CLASSIFICATION`。

---

## Q1 — 能否可靠区分 Structural Partial？

**能。** 例：d019 选了 `后选→候选` 但留下可修的 `计化` → `PARTIAL_SELECTION`（见 `formula_case_matrix.csv`）。

---

## Q2 — 能否可靠识别「候选声城」这类 Semantic Partial？

**不能。** Trace：`后选` 为唯一相关 repairable；`声`/`城` budgeted 仅自身、sameDomain/base 空。  
Formula A/B 在选中 `候选` 后给出 **COMPLETE_SELECTION**。  
不得用“声城不是词”补洞。

---

## Q3 — `repairCompleteness` 是否命名过度？

**是。** 暗示语义修完；与可计算能力不符。

---

## Q4 — 最准确字段名？

**`repairSelectionCompleteness`**

---

## Q5 — A/B/C 哪个最好？

**Formula A（Slot Coverage）** — 最简单、确定、无阈值、无新 Detector。

| | A | B | C |
|--|---|---|---|
| 推荐 | **YES** | 可选，无补语义缺口 | **NO**（阈值） |

---

## Q6 — 是否需要 cluster？

**不需要**（MVP）。Formula B 的相邻 repairable 聚类不能把 raw-only `声城` 变成 repairable。

---

## Q7 — 是否需要阈值？

**不需要。** 拒绝 Formula C 作为主合同。

---

## Q8 — 最小 Metadata？

```text
repairSelectionCompleteness
repairPickCount
unrepairedRepairableSlotCount
```

见 `minimal_metadata_contract.md`。

---

## Q9 — 是否完全不依赖 Tone/Recall/Domain/KenLM 重查？

**是。** 只读 Assembly 已有 `spanSets` + `combination.replacements`。  
（Recall 结果已固化在 spanSets 内；公式不重跑 Recall。）

---

## Q10 — 是否改变 Runtime 行为？

**Metadata-only 实现：否。** 不改变候选池 / CrossPath 过滤 / KenLM。

---

## Q11 — 是否形成 Hidden Gate？

**否**（本轮冻结明确：CrossPath 暂不按该字段过滤；KenLM 不读）。

---

## Q12 — 是否足够进入 metadata-only implementation？

**是** — 在重命名与能力边界已冻结的前提下。

---

## 「候选声城」为何不能用结构公式判 PARTIAL？

```text
Repairable: 后选（有 候选）
Selected:   后选 → 候选
声 / 城:    Raw-only（无非 canonical 选项）
⇒ unrepairedRepairableSlotCount = 0
⇒ COMPLETE_SELECTION
```

Tone miss 导致系统 **不知道** “本应可修生成” — 不能伪造 repairableSlot。

---

## Final Verdict

```text
FORMULA_SCOPE_RENAMED_AND_READY

当前 Metadata 只能证明 replacement selection completeness，
不能证明语义修复完整性。

字段和公式已按真实能力重新命名，
可以进入 metadata-only implementation。
```
