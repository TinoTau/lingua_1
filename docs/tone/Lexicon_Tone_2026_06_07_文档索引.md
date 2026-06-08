# Lexicon Tone 2026-06-07 审计文档索引

**主题：** 词库 `tone_pinyin_key` 补齐、ToneModule 接通、dialog_200 批测与 apply=0 根因分析  
**状态：** 只读审计完成；词库已重建并加载  
**bundle：** `node_runtime/lexicon/v3`（checksum `84a1ed29…`，build `2026-06-07T03:23:11Z`）

---

## 阅读顺序建议

| 顺序 | 文档 | 内容 |
|------|------|------|
| 1 | [Lexicon_Tone_Seed_Rebuild_Dev_Report_2026_06_07.md](./Lexicon_Tone_Seed_Rebuild_Dev_Report_2026_06_07.md) | 四份 seed 补齐、`parse-rows` 修复、离线 rebuild、DB 调号验收 |
| 2 | [Lexicon_Tone_Dialog200_Test_Report_2026_06_07.md](./Lexicon_Tone_Dialog200_Test_Report_2026_06_07.md) | dialog_200 全量批测（**HintGate 基线**，`fw_triggered=66`） |
| 3 | [Pinyin_IME_v2_SpanSelector_Development_Report_2026_06_07.md](./Pinyin_IME_v2_SpanSelector_Development_Report_2026_06_07.md) | **SpanSelector 开发**：HintGate 废止、无兼容层、代码清单 |
| 4 | [Pinyin_IME_v2_SpanSelector_Dialog200_Test_Report_2026_06_07.md](./Pinyin_IME_v2_SpanSelector_Dialog200_Test_Report_2026_06_07.md) | **SpanSelector 批测**：`fw_triggered=106`、质量/性能/抽样 |
| 5 | [Lexicon_Tone_Apply0_Root_Cause_Audit_2026_06_07.md](./Lexicon_Tone_Apply0_Root_Cause_Audit_2026_06_07.md) | **apply=0 根因**：span 发现 + KenLM 门控 + profile 未注入 |
| 6 | [Lexicon_Tone_Field_Full_Chain_Audit_Report_2026_06_07.md](./Lexicon_Tone_Field_Full_Chain_Audit_Report_2026_06_07.md) | 全链路字段/schema/Recall/IME 行为（补齐前基线） |
| 7 | [Pinyin_IME_v2_Proposal_Normalizer_Audit_2026_06_07.md](./Pinyin_IME_v2_Proposal_Normalizer_Audit_2026_06_07.md) | d001 Proposal→Normalizer 断链（4D 单字 span 被删） |
| 8 | [Pinyin_IME_v2_Proposal_Deep_Audit_2026_06_07.md](./Pinyin_IME_v2_Proposal_Deep_Audit_2026_06_07.md) | **Proposal 深度审计**：alignFailed、4D 设计偏差、d001 根因 |
| 9 | [Pinyin_IME_v2_Local_RawImeDiff_Proposal_Audit_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Proposal_Audit_2026_06_07.md) | **Local Raw-vs-IME Diff 开发前审计**：可行性、门控策略、d001 探针 |
| 10 | [Pinyin IME v2 Local Raw-IME Diff Proposal 开发方案.md](./Pinyin%20IME%20v2%20Local%20Raw-IME%20Diff%20Proposal%20开发方案.md) | **Local Raw-IME Diff 开发方案** V1.0 |
| 11 | [Pinyin_IME_v2_Local_RawImeDiff_Proposal_DevPlan_Supplement_Checklist_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Proposal_DevPlan_Supplement_Checklist_2026_06_07.md) | 开发方案 vs 代码对照 **补充清单** |
| 12 | [Pinyin_IME_v2_Local_RawImeDiff_Development_Report_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Development_Report_2026_06_07.md) | **Local Raw-IME Diff 开发报告**：实现、单测 146/146 |
| 13 | [Pinyin_IME_v2_Local_RawImeDiff_Dialog200_Test_Report_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Dialog200_Test_Report_2026_06_07.md) | **Local Raw-IME Diff 批测**：fw 158/200、质量/性能/抽样 |
| 14 | [FW_Quality_Post_LocalRawImeDiff_Audit_2026_06_07.md](./FW_Quality_Post_LocalRawImeDiff_Audit_2026_06_07.md) | **真实识别质量只读审计**：Recall/Tone/KenLM/apply=0 根因 |
| 15 | [Weak_Domain_Priority_Fuzzy_Recall_Audit_2026_06_07.md](./Weak_Domain_Priority_Fuzzy_Recall_Audit_2026_06_07.md) | **Weak Domain + Fuzzy Recall 开发前审计** |
| 16 | [Weak Domain Priority + Fuzzy Span Recall 开发方案（冻结版 V1.0）.md](./Weak%20Domain%20Priority%20+%20Fuzzy%20Span%20Recall%20开发方案（冻结版%20V1.0）.md) | **Weak Domain + Fuzzy Pinyin Recall 冻结方案 V1.1** |
| 17 | [Weak_Domain_Priority_Fuzzy_Recall_DevPlan_Supplement_Checklist_2026_06_07.md](./Weak_Domain_Priority_Fuzzy_Recall_DevPlan_Supplement_Checklist_2026_06_07.md) | **冻结方案 vs 代码 补充清单** |

---

## 一页结论

### 已完成

- 四个 `entries.jsonl` 100% 含 `tonePinyin` / `tonePinyinKey`
- SQLite 三表 100% 数字调号：`base 50k` / `idiom 22,192` / `domain 25`
- Node 已加载新 bundle；dialog_200 **200/200 契约 PASS**
- ToneModule **200/200** `toneEnabled=true`；**45** 案有 `acousticTonePattern`；**11** 次 tone-compatible recall

### 未完成（端到端修词）

- **FW apply = 0**（全批）
- 餐饮同音错词（钟贝/大悲/美食等）**部分仍未进 span**（normalizer；SpanSelector 后 d002 等已进 span）
- 测试 **未注入 restaurant profile** → `domain_lexicon` 未参与 Recall
- 已触发案例 **66/66** KenLM `pickedIsRaw=true`（`maxDelta` < `minDeltaToReplace=0.03`）

### apply=0 双断点（详见根因审计）

```
ToneModule ✅
  → IME Span 发现 △  (94/200 no_spans；SpanSelector 后 106/200 触发)
  → Recall + tone sort △  (66/200; domain 未查)
  → KenLM minDelta ❌  (66/66)
  → Apply = 0
```

---

## 原始数据

| 文件 | 说明 |
|------|------|
| `electron_node/electron-node/tests/lexicon-tone-dialog200-batch-result.json` | HintGate 基线批测 JSON |
| `electron_node/electron-node/tests/lexicon-tone-dialog200-spanselector-batch-result.json` | SpanSelector 批测 JSON |
| `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-quality-perf.json` | 基线 CER / 性能汇总 |
| `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-spanselector-quality-perf.json` | SpanSelector CER / 性能汇总 |
| `electron_node/electron-node/tests/lexicon-tone-dialog200-local-raw-ime-batch-result.json` | Local Raw-IME Diff 批测 JSON |
| `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-local-raw-ime-quality-perf.json` | Local Raw-IME Diff CER / 性能汇总 |
| `electron_node/electron-node/tests/experiments/lexicon-tone-db-audit.json` | SQLite 调号覆盖率 |
| `electron_node/electron-node/tests/experiments/lexicon-tone-apply0-audit-data.json` | apply=0 统计抽取 |

---

## 关键代码路径（审计引用）

| 环节 | 路径 |
|------|------|
| Span 发现 | `main/src/fw-detector/pinyin-ime-v2/resolve-pinyin-ime-v2-spans.ts` |
| SpanSelector | `main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-span-selector.ts` |
| Domain recall 解析 | `main/src/lexicon-v2/domain-recall-merge.ts` |
| Tone 排序 | `main/src/lexicon/tone-recall-sort.ts` |
| 句级 rerank + apply | `main/src/fw-detector/fw-sentence-rerank-pipeline.ts` |
| KenLM 门控 | `main/src/fw-detector/rerank-fw-sentences.ts` |
| dialog_200 批测 | `tests/run-dialog200-timed-batch.mjs` |
| restaurant profile 批测 | `tests/run-p4-freeze-batch.js` |

---

## 复现命令（只读参考）

```powershell
# 词库 rebuild（已完成）
cd electron_node\electron-node
npm run lexicon:build:v2-shadow -- --input D:\Programs\github\lingua_1\electron_node\docs\lexicon-assets\p1_3_generic_zh_lexicon_v2_fw_domains\p1_3_lexicon_zh_v2
Remove-Item -Recurse -Force ..\..\node_runtime\lexicon\v3
npm run lexicon:prepare:v3-runtime
npm run lexicon:gate:v3-runtime

# dialog_200 批测（general profile，无 migration）
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
node tests/run-dialog200-timed-batch.mjs "D:\Programs\github\lingua_1\test wav\dialog_200" --max-minutes 15

# 餐饮 profile 对比（freeze 脚本，本次未用）
node tests/run-p4-freeze-batch.js --profile restaurant --max-minutes 15
```
