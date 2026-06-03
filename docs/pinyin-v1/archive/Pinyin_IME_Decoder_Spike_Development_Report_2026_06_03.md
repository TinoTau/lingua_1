# Pinyin IME Decoder Spike — 开发报告

**日期**：2026-06-03  
**范围**：本轮「离线 Spike」交付（未接入 `main/src` 冻结主链）  
**对照文档**：[Pinyin_IME_Decoder_Spike_V1_Architecture_Supplement.md](./Pinyin_IME_Decoder_Spike_V1_Architecture_Supplement.md)、[Pinyin_IME_Decoder_Spike_Implementation_Notes.md](./Pinyin_IME_Decoder_Spike_Implementation_Notes.md)

---

## 1. 目标与边界

| 项 | 说明 |
|----|------|
| 目标 | 验证「拼音流 → 候选生成 → Diff → KenLM 门控」在 Dialog200 子集上的**离线**可行性 |
| 冻结边界 B-01~B-10 | 代码仅位于 `electron_node/electron-node/tests/spike/`，不改 AudioAggregator、Text Chain、Lexicon V3.1 Runtime、Patch、Scheduler |
| 评估文本 | 使用批测 JSON 中 `extra.raw_asr_text`，不与 `text_asr` 混为 SSOT |
| 主链接入 | Freeze Gate 未通过前**禁止**改 `fw-detector/` |

---

## 2. 交付清单

| 组件 | 路径 | 职责 |
|------|------|------|
| P1 词表导出 | `tests/spike/export-lexicon-v3-ime-dict.mjs` | Lexicon V3 SQLite → `tmp/ime_dict.txt`（`pinyin_key` + 词条） |
| P2 Sidecar（可选） | `tests/spike/ime-sidecar-server.mjs` | HTTP `POST /decode`，默认 `dict_dp` |
| P3 批测 | `tests/spike/run-pinyin-ime-dialog200-spike.mjs` | 读 `fw-detector-dialog-200-batch-result.json` + manifest |
| P4 分析 | `tests/spike/analyze-pinyin-ime-spike.mjs` | Freeze Gate + 子集指标 → `spike-report-latest.md` |
| 库 | `tests/spike/lib/*` | `pinyin-stream`、`ime-dict-decoder`、`diff-align`、`kenlm-spike`、`subsets`、`metrics` 等 |

**npm scripts**（`electron-node/package.json`）：`spike:ime:export`、`spike:ime:export:repair`、`spike:ime:sidecar`、`spike:ime:dialog200`、`spike:ime:analyze`。

---

## 3. 本轮会话内修复

| 问题 | 修复 |
|------|------|
| `paths.mjs` 中 `REPO_ROOT` 少一层，manifest 解析到 `D:\Programs\github\test wav\...` | `REPO_ROOT` 改为 `electron-node/../../..`；`defaultManifestPath()` 使用 `PROJECT_ROOT` + `test wav/dialog_200` |
| `repair-target-index.mjs` 缺少 `wouldApplyWithRepairTarget` 导出 | 补充 KenLM 模拟门控：diff span 的 `target` 须命中 `repair_target=1` 词表项 |
| 系统 Node 跑 Spike 导出/索引 | 测试前执行 `npm rebuild better-sqlite3`（与 Electron ABI 的 `lexicon:rebuild-sqlite` 分离） |

---

## 4. 架构对应（补充文档 §）

| 补充项 | 实现 |
|--------|------|
| L-01~L-09 词库导出 | `export-lexicon-v3-ime-dict.mjs`，schema `lexicon-v3-four-table-v1` |
| P-01~P-06 拼音流 | `lib/pinyin-stream.mjs`（无声调 + CJK 段切分） |
| D-01~D-06 Diff | `lib/diff-align.mjs`（字符级对齐 → replacement spans） |
| K-02 KenLM | `lib/kenlm-spike.mjs` 镜像主链 scorer 路径，**不 import** `main/src` |
| §10 Dialog200 子集 | `lib/subsets.mjs`（detector_miss / recall_empty / lexicon_missing） |
| §16 Freeze Gate | `analyze-pinyin-ime-spike.mjs`（top5 / top3 / P95） |

**解码后端**：默认 `dict_dp`（词典 beam，非 libpinyin 二进制）。可选 `PINYIN_IME_DECODE_CMD` 切换 `libpinyin_cli`。

---

## 5. 词表导出状态（本次测试前）

```json
{
  "mode": "repair-only",
  "rowCount": 72217,
  "distinctPinyinKeys": 58539,
  "outPath": "electron_node/electron-node/tests/spike/tmp/ime_dict.txt"
}
```

说明：`--repair-only` 仅含 `repair_target=1` 词条，用于快速联调；**整句 beam 解码需全量** `npm run spike:ime:export`。本次离线 Spike 在 repair 词表下对 184 条 ASR 拼音流**未产出非空 candidates**（见测试报告）。

---

## 6. 已知限制与后续

1. **dict_dp 与 ASR 噪声**：ASR 文本经 CJK→拼音 后与词典 syllable 链难以对齐，repair-only 词表下候选为空属预期，需全量词表 + 更宽松的 span 切分或 libpinyin 实验。
2. **better-sqlite3 ABI**：Electron 需 `npm run lexicon:rebuild-sqlite`；系统 Node 需 `npm rebuild better-sqlite3`。本次节点端批测因 Electron 加载词库失败（MODULE 127 vs 119）导致 Lexicon/FW 路径未执行。
3. **配置**：日志显示 `lexiconRecall.enabled: false`，即使 ABI 修复也需确认 `electron-node-config.json` 与 manifest 路径。
4. **主链接入**：当前 Freeze Gate **不推荐** 入主链；见 [Dialog200 测试报告](./Pinyin_IME_Decoder_Dialog200_Test_Report_2026_06_03.md)。

---

## 7. 回滚

删除 `tests/spike/` 与 `package.json` 中 `spike:ime:*` 即可，无 `main/src` 改动需回滚。

---

## 8. 产物索引

| 文件 | 说明 |
|------|------|
| `tests/spike/spike-dialog200-results.json` | P3 离线 Spike 原始结果 |
| `electron_node/docs/pinyin-v1/spike-report-latest.md` | P4 自动报告（路径待统一到 `docs/pinyin-v1/`） |
| `tests/fw-detector-dialog-200-batch-result.json` | Dialog200 节点端批测 |
| `tests/fw-detector-dialog-200-quality-perf.json` | CER/RTF 汇总 |
