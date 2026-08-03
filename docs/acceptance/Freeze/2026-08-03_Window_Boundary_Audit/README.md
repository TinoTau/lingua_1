# README — 2026-08-03 Window Boundary Audit

## 目标

READ ONLY 审计：ASR Raw → Pinyin → Syllable → Sliding Window 是否对齐。  
**不**审计 Tone 模型准确率。

## 输入

- Freeze: `FW_V4_FREEZE_2026_08_03`
- Cases: 6 个失败 Case（nn-train-01/01b, snack-01, sync-01, trigger-01, threshold-01）
- Runtime: `node_runtime/lexicon/v3`（只读）

## 结论

```text
WINDOW_ALIGNMENT_CORRECT
```

- 音节按 **ASR Raw** 切分；关键 plain-key Window **均已生成**。
- 6 Case `blockedWindowCount=0`；失败主因不在 Window 剪枝，而在后续 Tone/Query Key（见 Query Builder 审计）。

## 本目录文件

| File | 内容 |
|------|------|
| `README.md` | 本文件 |
| `report.md` | 完整报告 + Q1–Q5 |
| `summary.json` | 机器可读结论 |
| `window_trace.csv` | 全部 Window |
| `window_pruning.csv` | 剪枝阶段 |
| `syllable_alignment.csv` | 字符↔音节 |
| `window_callgraph.md` | 调用链 |
| `boundary_contract.md` | 边界合同 |

## 规范（自本轮起）

后续审计/开发产物统一：

```text
docs/acceptance/Freeze/YYYY-MM-DD_<TaskName>/
  README.md
  report.md
  summary.json
  *.csv
  *.md
```
