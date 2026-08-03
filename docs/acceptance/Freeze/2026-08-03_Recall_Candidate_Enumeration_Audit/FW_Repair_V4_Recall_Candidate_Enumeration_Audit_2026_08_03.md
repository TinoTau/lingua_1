# FW Repair V4 — Recall Candidate Enumeration Audit (Pre-KenLM Final)

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **READ ONLY** · Final Pre-KenLM |
| Freeze | **FW_V4_FREEZE_2026_08_03** |
| Changed | **None** |
| Verdict | **ENUMERATOR_CORRECT** |

> 正式目录：`docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Enumeration_Audit/`  
> 完整正文见同目录 `report.md`。

---

## Verdict

```text
ENUMERATOR_CORRECT

SQLite Result 符合合同；Enumerator 过滤链已完整 Trace。
正确 Candidate 未进入 SQLite Result（噪声 Tone/Plain Query Key），
而非 Enumerator 中途 DROP。
```

## Q1–Q5（摘要）

| Q | 答 |
|---|----|
| Q1 SQLite 返回？ | 焦点非空：消失 / 出发 / 闷蒸；多数窗 0 行。见 `sqlite_result_set.csv` |
| Q2 进入 Recall？ | 与上一致；空 SQL → 空 Recall |
| Q3 DROP？ | 本批焦点无 SQL→Recall 中途 DROP；正确词不在 SQL |
| Q4 DROP 位置？ | 合同：merge / score / TopK slice / minPrior；本批未杀正确词 |
| Q5 隐藏过滤？ | 无额外隐藏杀手；链路已 Trace |

## Call chain

```text
lookupBaseByPinyinAndToneKey
  → collectTierCandidatesToneFirst → mergeSpanCandidatesCombined
  → scoreHotword → sortRecallHitsByToneCompatibility (no drop)
  → hits.slice(perSpanLimit) → bindLexiconHitsToWindow(minPrior)
```
