# FW Repair V4 — KenLM Phase 01 Baseline Audit (Real Candidate Competition)

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Nature | **READ ONLY** · KenLM scoreBatch on real Runtime kenlmInput |
| Model / Recall / Window / Tone / Assembly | **Unchanged** |
| Verdict | **KENLM_BASELINE_READY** |

---

## 1. Executive Conclusion

Recall 已冻结。本轮不对 KenLM 做优化，只在 **真实 CrossPath → kenlmInput** 且 **distinctText ≥ 2** 的竞争池上，用生产 `scoreBatch` 建立排序基线。

- 真实竞争 Case：**75** / dialog_200 kenlmInput 200  
- 打分候选：**212**  
- Raw Top1 率：**76.0%**（57/75）  
- 非 Raw Top1：**18/75**（分数差可测，中位 |Δ| ≈ 4.68）  
- Runtime：**未阻塞**（warmup ok）

---

## 2. Method

1. 候选来源：`dialog200_all_candidate_sentences.csv` 的 `stage=kenlmInput`（真实 Runtime Trace，非手工拼接）。  
2. 竞争定义：`candidateCount≥2` **且** `distinct candidateText≥2`；其余标 `No Competition` 并排除出排序评价。  
3. 打分：生产 `createKenlmBatchScorer().scoreBatch`（与 Capability Baseline 同模型 sha256 `532a335a…`）。  
4. **不使用** expectedText / Ground Truth 构造候选或评价校正准确率；本轮度量是 **Raw vs 真实交替句** 的排序行为。

禁止项均遵守：无重训、无改 ARPA/Beam、无改 Recall/Window/Tone/Assembly。

---

## 3. Answers

### Q1 — 真实 Competition Case 多少？

**75**

（dialog_200 kenlmInput 共 200；125 为 Raw-only 或同文重复，排除。）

Histogram（竞争池规模）：2→46 · 3→16 · 4→8 · 8→5

### Q2 — KenLM 实际排序了多少 Candidate？

**212** 条竞争池内句（另有排除 Case 不计入评价）。

### Q3 — Raw 是否长期第一？

**否（但多数）。** Raw Top1 = **76%**。  
约 24% 竞争 Case 中，非 Raw 句（常为近音/同域变体）分数更高。

### Q4 — KenLM 有没有明显排序能力？

**有（有条件）。**  
竞争池上存在稳定分数差（avg |ΔvsRaw| ≈ 4.51，median ≈ 4.68，max ≈ 10.80）。  
例如 d007：`九点半` 优于 `酒店半`；部分 Case KenLM 偏好「候选生城/上线计划」类变体而非 Raw 噪声字形。  
这证明 **打分可区分**，不等于 **纠错正确率已达标**（本轮不宣称 correction accuracy）。

### Q5 — 下一步优化模型还是语料？

**先分场景再动模型：**

1. 继续收集 **Raw + 正确修复句** 同进 KenLM 的竞争样本（如 recovery 的 center-01 类），单独做纠错排序基线。  
2. 当前 75 Case 多为近音变体竞争；在未标注「非 Raw 是否应胜出」前，**不宜直接重训**。  
3. 上游若仍大量 Raw-only，优先保证 CrossPath 产生真实竞争，而非先改 KenLM 语料。

---

## 4. Artifacts

| File | Content |
|------|---------|
| `runtime_case_selection.csv` | 入选/排除与原因 |
| `candidate_distribution.csv` | 竞争规模直方图 |
| `kenlm_input.csv` | 送入 KenLM 的句 |
| `kenlm_output.csv` | lmScore / rank / selected / deltaVsRaw |
| `kenlm_score_distribution.csv` | 分数分布行 |
| `candidate_ranking.csv` | 排序明细 |
| `failure_analysis.csv` | 非 Raw Top1 等 |
| `oov_analysis.csv` | OOV（本批 score 对象未稳定导出 oov 时见文件说明） |
| `summary.json` | 机器可读结论 |

---

## 5. Final Verdict

```text
KENLM_BASELINE_READY

Recall 已冻结。

KenLM Baseline 已建立。

真实性能可量化。

下一阶段：
KenLM 优化。
```

（优化前建议先建立 Raw+Correct 修复竞争子集标签，避免只在噪声变体上调参。）
