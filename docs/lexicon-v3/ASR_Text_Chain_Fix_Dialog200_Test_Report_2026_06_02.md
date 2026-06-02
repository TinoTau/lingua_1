# ASR 多段文本链修复 — dialog_200 开发与测试报告

**日期**：2026-06-02  
**范围**：ASR Multi-Segment Text Chain Fix（Final）回归 + dialog_200 限时批测  
**环境**：Electron 节点端 + test server `:5020` + `faster-whisper-vad`  
**原始数据**：`electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json`、`fw-detector-dialog-200-quality-perf.json`

---

## 1. 开发摘要

### 1.1 问题与修复

多段 ASR 合并后 `ctx.asrText` 已是全文，但 `rawAsrText` 仅在 `i===0` 写入，导致 FW 模式下 `segmentForJobResult`（来自 `rawAsrText`）及 `extra.raw_asr_text` 可能只有首段，业务/NMT/统计与诊断不一致。

**改动（未动切片 / Aggregator / FW Python / Detector 算法）：**

| 文件 | 变更 |
|------|------|
| `pipeline/steps/asr-step.ts` | 循环结束后 `mergedAsrText` 写入 `rawAsrText`、`asrMergeProbeText`；FW 下 `segmentForJobResult` 同步为全文 |
| `pipeline/context/job-context.ts` | 新增诊断字段 `asrMergeProbeText` |
| `pipeline/result-builder-core.ts` | `extra.asr_merge_probe_text` |
| 单测 / freeze-contract / 批测脚本 | 多段断言与 merge probe 指标 |

### 1.2 单元与门禁（批测前已通过）

- `npm run build:main`
- `asr-step.test.ts`（8）
- `test:fw-detector`（88）
- `test:lexicon`（70）
- `lexicon:gate:v3-runtime`

---

## 2. 测试执行

| 项 | 值 |
|----|-----|
| 命令 | `node tests/run-dialog200-timed-batch.mjs --max-minutes 15` |
| 语料 | `test wav/dialog_200`（manifest 200 条） |
| 截止原因 | `deadline`（墙钟 15 分钟） |
| 实际完成 | **69 / 200** |
| 墙钟 | **903 s**（≈15.1 min） |

---

## 3. 契约与流水线

| 指标 | 值 |
|------|-----|
| 评估条数 | 69 |
| 契约 PASS | 68 |
| FAIL / ERROR | 1（`d067` HTTP **504**，无 ASR 文本） |
| 跳过 | 0 |
| 流水线 OK 率 | **98.6%** |
| ASR 服务 | `faster-whisper-vad` ×68；失败案 `unknown` ×1 |
| Lexicon runtime ok | 68 |
| FW `triggered` | 17 |
| FW `applied` | **0** |
| `text_changed`（raw→final） | 0 |

**文本链一致性（本轮修复验收点）**：在 68 条成功样本中，`raw_asr_text` === `asr_merge_probe_text` === `text_asr_preview`（**0 条不一致**）。其中 **28 条** `node_audio_segment_count > 1`，合并后 `raw` 均为多段拼接全文（非首段截断）。

---

## 4. 识别质量（相对 manifest `utterance`，归一化 CER）

| 指标 | raw | final | merge_probe |
|------|-----|-------|-------------|
| 平均 CER | 0.250 | 0.250 | 0.250 |
| 中位 CER | 0.214 | 0.214 | 0.214 |
| P95 CER | 0.600 | 0.600 | 0.600 |
| 完全匹配条数 | 7 | 7 | 7 |

说明：本轮 FW **未 apply**，故 raw/final/probe 质量指标相同；指标反映 **ASR+FW 当前整体水平**，非仅文本链修复的增量（修复目标是字段语义一致，而非直接降 CER）。

### 4.1 CER 最差 Top 5（final）

| id | scenario | CER | 参考（摘要） | 识别（摘要） |
|----|----------|-----|--------------|--------------|
| d067 | customer_service | 1.00 | 物流三天没更新… | （504 空） |
| d045 | lexicon_homophone | 0.80 | 后选生成/上线计划… | 後,學生成為學生… |
| d065 | tech_deploy | 0.67 | 对齐上线计划窗口… | 現對期…後選生 成模快… |
| d043 | lexicon_homophone | 0.60 | 后选声城/候选生成… | 後 選生成方安線… |
| d010 | hospital | 0.55 | 头痛开药血常规… | 頭痛…歇常規 |

---

## 5. 性能

| 指标 | avg | p50 | p95 | min | max |
|------|-----|-----|-----|-----|-----|
| pipeline_ms | 12,831 | 10,523 | 18,772 | 5,996 | 32,743 |
| asr_latency_ms | 6,786 | 6,555 | 8,775 | 3,062 | 21,704 |
| audio_ms | 3,631 | 3,880 | 4,900 | — | — |

| RTF | 值 |
|-----|-----|
| pipeline / audio | **3.53** |
| asr / audio | **1.87** |

68 条成功样本 pipeline 累计 CPU 时间约 **873 s**，墙钟 903 s → 基本串行跑满 15 分钟预算。

---

## 6. 结果抽样

### 6.1 多段合并 + 文本链一致（d001，2 段）

| 字段 | 内容 |
|------|------|
| 参考 | 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？ |
| raw / final / probe | 你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗? |
| node_audio_segment_count | 2 |
| pipeline_ms | 14,935 |
| fw_triggered | true |

### 6.2 单段 + FW 触发未 apply（d002）

| 字段 | 内容 |
|------|------|
| 参考 | 麻烦帮我做一杯美式带走，大杯就行，谢谢。 |
| 识别 | 麻烦帮我做一杯美食带走大悲就行谢 |
| pipeline_ms | 5,996 |
| fw_triggered | true |

### 6.3 词典同音场景（d043，FW 触发）

| 字段 | 内容 |
|------|------|
| 参考 | 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。 |
| 识别 | 我們下午討論後 選生成方安線吧,後選生成的接口文當補期。 |
| pipeline_ms | 17,008 |
| fw_triggered | true |

### 6.4 失败样例（d067）

- **错误**：`Request failed with status code 504`（网关/超时，非契约字段问题）
- **建议**：单条重跑或拉长 `run-pipeline-with-audio` 超时后再计入质量统计

---

## 7. 结论

| 验收项 | 结果 |
|--------|------|
| 多段后 `rawAsrText` / `segmentForJobResult` / `extra.raw_asr_text` 为全文 | **通过**（28 条多段 + 0 条链不一致） |
| 诊断 `asr_merge_probe_text` 与 raw 对齐 | **通过** |
| 未引入第二套业务字段 | **通过** |
| dialog_200 限时批测 | **69 条**，契约 98.6%，1×504 |
| FW apply / CER 改善 | **本轮无**（triggered 17，applied 0） |

**后续可选**：在节点保持运行前提下续跑 `d070`–`d200`（或提高并行/超时），并对比修复前批测 JSON（若存在）做多段场景的 raw 长度/CER 差分。

---

## 8. 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT='D:\Programs\github\lingua_1'
node tests/run-dialog200-timed-batch.mjs --max-minutes 15 "D:\Programs\github\lingua_1\test wav\dialog_200"
node tests/analyze-dialog200-quality-perf.mjs
```
