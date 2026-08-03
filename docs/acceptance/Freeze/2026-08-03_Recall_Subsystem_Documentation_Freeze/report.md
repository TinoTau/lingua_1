# FW Repair V4 — Recall Subsystem Documentation Update and Freeze Registration

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Nature | Documentation Update · Freeze Registration · SSOT Consolidation |
| Code / Lexicon / SQLite / Config | **Unchanged this round** |
| Verdict | **RECALL_SUBSYSTEM_DOCUMENTATION_FROZEN** |

---

## 1. Executive Conclusion

截至 `FW_V4_FREEZE_2026_08_03`，Syllable、Window、Mandatory Tone Gate、Mode C Composite Query、SQLite Result、Candidate Enumerator 与 Raw Fallback 合同已写入 CURRENT / Snapshot / Supporting，并登记为日期节点恢复基线。

Tone 参数缺失 = 协议错误 → Fail Closed。  
Tone 预测错误 = 允许的模型能力边界（`ACCEPTED_MODEL_LIMITATION`）。

下一阶段：从真实 Runtime 收集 `candidateCount >= 2` 竞争 Case，建立 KenLM 排序能力基线。

---

## 2. Task Scope

只更新文档与 Acceptance 归档；禁止业务逻辑 / 源码 / 词库 / SQLite / 配置 / Tone 模型 / Recall / KenLM / 测试数据修改。

---

## 3. Freeze Baseline

`FW_V4_FREEZE_2026_08_03` — date-node recovery baseline（非永久不可修改）。旧 Tag **未移动**。

---

## 4. Documents Updated

见 `updated_document_inventory.csv`。

---

## 5. Recall Subsystem Frozen Scope

```text
ASR Raw → Syllable → Window → Hard Block → Tone Mapping → Readiness
→ Mode C SQL → SQLite Result → Merge/Score/TopK → WindowCandidate → LexicalEdge
```

Status: `FROZEN_AT_2026_08_03`

Not included: Assembly/CrossPath quality · KenLM ranking capability · Tone model uplift · open-domain coverage.

---

## 6. Window / Syllable Contract

ASR Raw is Syllable SSOT. Windows must not be built from expectedText. Lattice 1–5 full sliding; critical plain-key windows verified present; blocked critical = 0.

---

## 7–8. Mandatory Tone Gate Purpose · Protocol vs Model Error

Gate = protocol integrity. Protocol errors Fail Closed. Model digit errors Accepted Limitation. Do not restore Plain Fallback to chase 100% Tone accuracy.

---

## 9–10. Recall Query · Plain Fallback

Mode C: `pinyin_key` ∧ `tone_pinyin_key` in SQL WHERE. No Plain Fallback on Mandatory path.

---

## 11. Candidate Enumerator Contract

```text
SQLite → merge → scoreHotword → tone-rank (no hard drop) → TopK → minPrior bind
```

Domain preferred in merge when active — not TopK-then-Domain hard filter.

---

## 12–13. Allowed Failure Modes · Raw-Only

Tone prediction error · pronunciation deformation · Raw-only pool · conversation repair — see Supporting Contract / Runtime SSOT §31.

---

## 14. KenLM Boundary

Score / Rank / Pick only. No candidate generation. Only competition cases (count≥2) evaluate ranking.

---

## 15. Change Policy

See `FRAMEWORK_FREEZE_SUMMARY.md` — Impact Audit required; new Snapshot; never rewrite old Snapshot as “corrected”.

---

## 16–18. CURRENT Inventory · Supporting · Acceptance

- CURRENT: `docs/current/INDEX.md` + Sole Authorities  
- Supporting: `Recall_Subsystem_Frozen_Contract_2026_08_03.md`  
- Acceptance: dated packs listed in `acceptance_record_index.csv`

---

## 19. Duplicate Cleanup

See `document_cleanup_actions.csv`. Unique probes retained under `_audit_scratch/*.mjs`.

---

## 20–21. Known Limitations · Recovery Guide

Updated in Snapshot `12` / `13`. Recovery steps use real `npm` / Electron probe commands.

---

## 22. Git Action

Create documentation commit:

```text
docs: freeze Recall subsystem contracts at FW_V4_FREEZE_2026_08_03
```

Do **not** move tag `FW_V4_FREEZE_2026_08_03`. Optional docs tip tag not required.

---

## 23. Target List

T1–T24: addressed in this pack (documentation registration complete).

---

## 24. Check List

```text
[x] 未修改业务代码
[x] 未修改 Tone 模型 / 词库 / SQLite / 配置 / Recall 参数
[x] 未恢复 Plain Fallback
[x] 已更新 CURRENT SSOT / Snapshot / KenLM Boundary / Change Policy
[x] 已记录 Mandatory Tone 目的与模型误差边界
[x] 已冻结 Window / Query / Enumerator 合同
[x] 已归档 Acceptance Records
[x] 已清理重复副本并保留唯一探针证据
[x] 单一正式产物目录
[x] 已更新 Known Limitations / Recovery Guide
[x] 已生成本轮全部产物
[x] documentation commit（本轮执行）
```

---

## 25. Final Verdict

```text
RECALL_SUBSYSTEM_DOCUMENTATION_FROZEN

截至 FW_V4_FREEZE_2026_08_03，
Syllable、Window、Mandatory Tone Gate、
Composite Recall Query、SQLite Result、
Candidate Enumerator 和 Raw Fallback 合同
已完成文档更新与日期节点冻结。

Tone 参数缺失属于协议错误并执行 Fail Closed；
Tone 预测错误属于允许的模型能力边界。

Recall 子系统可作为当前恢复基线。

下一阶段：
从真实 Runtime 中收集 candidateCount >= 2 的竞争 Case，
建立 KenLM 排序能力基线。
```
