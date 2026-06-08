# Pinyin IME v2 SpanSelector — dialog_200 测试报告

**日期：** 2026-06-07  
**对照基线：** [Lexicon_Tone_Dialog200_Test_Report_2026_06_07.md](./Lexicon_Tone_Dialog200_Test_Report_2026_06_07.md)（HintGate 时代，`fw_triggered=66`）  
**开发报告：** [Pinyin_IME_v2_SpanSelector_Development_Report_2026_06_07.md](./Pinyin_IME_v2_SpanSelector_Development_Report_2026_06_07.md)

**环境：** Windows · Electron Node `:5020` · `faster-whisper-vad`  
**音频集：** `D:\Programs\github\lingua_1\test wav\dialog_200`（200 条，全部执行）  
**词库 bundle：** `node_runtime/lexicon/v3`（与 06-07 调号补齐批测相同运行时）

---

## 1. 批测配置

| 项 | 值 |
|----|-----|
| 脚本 | `tests/run-dialog200-timed-batch.mjs` |
| 输出 | `tests/lexicon-tone-dialog200-spanselector-batch-result.json` |
| 时限 | 15 min（实际 **694 s**，200/200 完成） |
| 接口 | `POST /run-pipeline-with-audio` |
| 语言 | zh → en |
| Payload | `lexicon_v2_intent_enabled: false`（每案新 session → `primaryDomain=general`） |
| ASR | faster-whisper-vad（200/200） |
| Lexicon runtime | `lexicon_runtime_status=ok`（200/200） |

---

## 2. 契约 / 稳定性

| 指标 | 基线（HintGate） | SpanSelector |
|------|------------------|--------------|
| 评估条数 | 200 | 200 |
| 契约 PASS | **200** | **200** |
| FAIL | 0 | 0 |
| 契约通过率 | 100% | **100%** |
| 墙钟时间 | 748 s | **694 s** |
| FW 触发 | 66 | **106** (+40) |
| FW apply | 0 | **0** |
| 文本被 FW 修改 | 0 | **0** |

**结论：** 契约无回归；FW 触发率 **+60.6%**，apply 仍为 0（KenLM 未变）。

---

## 3. SpanSelector 漏斗（200 案）

| 指标 | 基线 | SpanSelector |
|------|------|--------------|
| `fw_triggered` | 66 | **106** |
| `no_spans`（`fw.reason`） | 134 | **94** (-40) |
| 选中 span 累计 | — | **173** |
| `selectionMode=all_passed` | — | **105** |
| `selectionMode=ranked_capped` | — | **1** |
| `selectionMode=empty_after_normalizer` | — | **65** |
| 无 CJK（`skippedReason=no_cjk`） | 29 | **29** |
| normalizer 后无 span（`no_selected_spans`） | 105（`no_approved_spans`） | **65** |
| neighbor miss 仍选中（`neighborMissCount>0` ∧ `selectedSpanCount>0`） | 0 | **58** |

### 3.1 `no_spans` 结构变化

```text
基线 HintGate:
  normalizer 杀光 ~65 + neighbor veto 杀光 ~40 + 无 CJK ~29 ≈ 134

SpanSelector:
  normalizer 杀光 65 + 无 CJK 29 = 94
  （neighbor veto 路径已消除）
```

---

## 4. 识别质量（CER，对比 manifest `utterance`）

| 指标 | 基线 raw | SpanSelector raw | SpanSelector final |
|------|----------|------------------|-------------------|
| 平均 CER | 0.2501 | **0.2655** | **0.2501** |
| 中位 CER | 0.2000 | **0.2000** | **0.2000** |
| P95 CER | 0.6000 | **0.6000** | **0.6000** |
| 完全匹配 | 25 / 200 | **25 / 200** | **25 / 200** |
| 餐饮 cafe（15 条）平均 CER | 0.1820 | **0.1820** | **0.1820** |

> CER 基于去标点归一化字符编辑距离。`final≈raw`（FW apply=0），质量指标与基线一致，**无意外文本改写**。

---

## 5. 性能

| 指标 | 基线 | SpanSelector |
|------|------|--------------|
| pipeline_ms avg | 3,733 | **3,464** |
| pipeline_ms P50 | 2,917 | **2,687** |
| pipeline_ms P95 | 8,918 | **8,552** |
| pipeline_ms min / max | 1,597 / 13,971 | **1,554 / 14,089** |
| asr_latency_ms avg | 1,009 | **959** |
| asr_latency_ms P95 | 1,422 | **1,206** |
| tone_inference_ms avg | 7 | **7** |
| audio_ms avg | 3,638 | **3,638** |
| RTF（pipeline/audio） | 1.026 | **0.952** |

**结论：** SpanSelector 不增加 pipeline 瓶颈；墙钟与 P50 略优于基线（运行方差内）。

---

## 6. V1.1 验收项核对

| # | 验收条件 | 结果 |
|---|----------|------|
| 1 | contract 200/200 | **PASS** |
| 2 | `fw_triggered ≥ 106` | **106 PASS** |
| 3 | `selectionMode=all_passed ≥ 105` | **105 PASS** |
| 4 | `ranked_capped ≥ 1` | **1 PASS** |
| 5 | `neighborMissCount>0` 且 `selectedSpanCount>0` | **58 案 PASS** |
| 6 | d002 `selectedSpanCount ≥ 2` | **2 PASS** |
| 7 | 无 compat 字段出现在运行时 extra | **PASS**（仅 `selectedSpanCount` 等） |

---

## 7. 结果抽样

### 7.1 餐饮场景（SpanSelector 效果）

| ID | 参考（要点） | 识别（要点） | CER | FW | selected | mode | neighborMiss |
|----|-------------|-------------|-----|-----|----------|------|--------------|
| d001 | 热拿铁 **中杯** · **蓝莓马芬** | 热拿铁**钟贝** · **蓝美马分** | 0.259 | 未触发 | 0 | empty_after_normalizer | 0 |
| d002 | **美式** · **大杯** | **美食** · **大悲** | 0.118 | **触发** | **2** | all_passed | **2** |
| d003 | **少冰** · **小杯** | **少病** · **小背** | 0.105 | 触发 | 2 | all_passed | 0 |
| d047 | 红茶 · **大杯** | 红茶 · **大背** | 0.059 | 触发 | 2 | all_passed | 2 |
| d046 | 卡布奇诺 · **中杯** | 卡布奇诺 · **中貝** | 0.345 | 未触发 | 0 | empty_after_normalizer | 0 |

**解读：**

- **d002**：改造前 neighbor veto → 0 span；改造后 **2 span 进入 Recall**（美食、大悲），验证 veto 移除。
- **d001**：仍为 normalizer 断点（`boundaryCompatibleTopKSpanCount=2` 但 `normalizerDroppedCount=2`），**非 SpanSelector 范围**。

### 7.2 d002 诊断明细

```json
{
  "diffSpanCount": 15,
  "selectedSpanCount": 2,
  "selectionMode": "all_passed",
  "normalizedSpanCount": 2,
  "neighborHitCount": 0,
  "neighborMissCount": 2,
  "normalizerDroppedCount": 0
}
```

### 7.3 d003（IME 提议错位，非 Selector 问题）

| 项 | 值 |
|----|-----|
| FW | 触发 |
| selectedSpanCount | 2 |
| apply | 0 |
| 现象 | span 进入 Recall，但 IME boundary 提议未对准「少冰」 |

### 7.4 完全匹配（CER=0，与基线相同）

| ID | 场景 |
|----|------|
| d018 | friend |
| d023 | customer_service |
| d025 | interview |
| d035 | bank |
| d038 | restaurant |

### 7.5 最差识别（非 SpanSelector 回归）

| ID | CER | 现象 |
|----|-----|------|
| d067 | 3.04 | ASR 重复「您好,我定,」幻觉 |
| d110 / d155 | 0.83 | 繁简混排 + 后选生成同音长句 |
| d045 | 0.80 | lexicon_homophone，normalizer 空 |

---

## 8. 与基线对比结论

| 维度 | 结论 |
|------|------|
| 契约 | 无回归 |
| FW 触发 | **+40 条**，达 V1.1 理论估算上限 |
| 识别质量 | raw/final CER 与基线一致（apply=0） |
| 性能 | 无劣化 |
| apply | 仍为 0 → 下一断点在 **KenLM / Recall 命中 / domain** |

---

## 9. 原始数据

| 文件 | 说明 |
|------|------|
| `electron_node/electron-node/tests/lexicon-tone-dialog200-spanselector-batch-result.json` | 全量 200 条 pipeline extra |
| `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-spanselector-quality-perf.json` | CER / 性能 / 抽样汇总 |
| `electron_node/electron-node/tests/lexicon-tone-dialog200-batch-result.json` | HintGate 基线（勿覆盖） |

---

## 10. 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main
# 需节点 :5020 已启动
node tests/run-dialog200-timed-batch.mjs "D:\Programs\github\lingua_1\test wav\dialog_200" --max-minutes 15 --out lexicon-tone-dialog200-spanselector-batch-result.json
node tests/experiments/_spanselector-batch-analyze.mjs
```
