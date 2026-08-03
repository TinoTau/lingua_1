# README — 2026-08-03 Recall Candidate Enumeration Audit

## 目标

READ ONLY：证明 SQLite Result → Recall Candidate 的全部过滤链。  
不重复审计 Window / Query Builder / Tone Query Contract。

## 结论

```text
ENUMERATOR_CORRECT
```

正确修复词在噪声 Query 下 **从未进入 SQLite Result**（Tone WHERE 不匹配）。  
Enumerator 未对“本该存在的正确词”做隐藏 DROP。

## 本目录

| File | 内容 |
|------|------|
| `README.md` | 本文件 |
| `report.md` | 完整报告 |
| `FW_Repair_V4_Recall_Candidate_Enumeration_Audit_2026_08_03.md` | 同报告归档名 |
| `summary.json` | 机器可读 |
| `sqlite_result_set.csv` | SQLite 原始行 |
| `enumeration_trace.csv` | Query→Result→Recall 汇总 |
| `candidate_filter_trace.csv` | 每条 KEEP/DROP |
| `candidate_callgraph.md` | 调用链 |
| `candidate_contract.md` | 合同 |
