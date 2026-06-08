# Pinyin IME v2 Local Raw-IME Diff — dialog_200 测试报告

**日期：** 2026-06-07  
**对比基线：** SpanSelector 批测（`lexicon-tone-dialog200-spanselector-batch-result.json`）  
**本轮批测：** `lexicon-tone-dialog200-local-raw-ime-batch-result.json`  
**开发报告：** [Pinyin_IME_v2_Local_RawImeDiff_Development_Report_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Development_Report_2026_06_07.md)

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 音频目录 | `D:\Programs\github\lingua_1\test wav\dialog_200` |
| 用例数 | 200（d001–d200） |
| 节点端 | Electron Node，test server **5020** |
| 批测脚本 | `electron_node/electron-node/tests/run-dialog200-timed-batch.mjs` |
| 时间上限 | `--max-minutes 15` |
| payload | `lexicon_v2_intent_enabled: false` → primaryDomain=general |
| 构建 | `npm run build:main` 后 `npm start` |
| 进程 | 测试前已清理旧 node/electron 进程 |

### 1.1 执行摘要

| 指标 | 值 |
|------|-----|
| 完成条数 | **200 / 200** |
| 契约 PASS | **200 / 200** |
| 墙钟时间 | **652 s**（≈ 10.9 min，未触达 15 min 上限） |
| 分析脚本 | `tests/experiments/_local-raw-ime-batch-analyze.mjs` |

---

## 2. FW 触发与 Proposal 指标

### 2.1 与 SpanSelector 基线对比

| 指标 | SpanSelector 基线 | Local Raw-IME Diff 本轮 | Δ |
|------|-------------------|-------------------------|---|
| contract PASS | 200/200 | 200/200 | 0 |
| **fw_triggered** | 106 | **158** | **+52** |
| no_spans | 94 | **42** | **−52** |
| apply > 0 | 0 | 0 | 0 |
| gained vs baseline | — | 56 | — |
| lost vs baseline | — | 4 | — |

> **gained/lost 说明：** gained=56 条基线未触发、本轮触发；lost=4 条基线触发、本轮未触发（Normalizer 清空 selected span）。

### 2.2 Proposal 层统计

| 指标 | 值 |
|------|-----|
| diffSpanCount > 0 | 169 / 200 |
| selectedSpanCount > 0 | 158 / 200 |
| avg diffSpanCount | 4.705 |
| avg selectedSpanCount | 1.58 |

---

## 3. 识别质量（CER）

### 3.1 全量 CER

| 指标 | Raw CER | Final CER | 说明 |
|------|---------|-----------|------|
| avg | **0.265** | **0.250** | final 与基线相同（apply=0） |
| p50 | 0.20 | 0.20 | |
| p95 | 0.60 | 0.60 | |
| exact match (final) | — | **25 / 200** | 与基线相同 |

### 3.2 场景子集

| 场景 | cafe CER avg |
|------|--------------|
| 餐饮 (cafe) | **0.182**（与基线相同） |

### 3.3 质量解读

- **Proposal 层有效：** fw_triggered +52，no_spans −52，d001 等 alignFailed 案已产出 span；
- **Final CER 未变：** KenLM 仍 `pickedIsRaw=true`，`apply=0`，final 文本等于 raw；
- **非退化：** d002/d003 等基线已触发案例保持 fw 与 selected 规模（见 §5）。

---

## 4. 性能

### 4.1 Pipeline 延迟（ms）

| 指标 | SpanSelector 基线 | Local Raw-IME Diff 本轮 | Δ |
|------|-------------------|-------------------------|---|
| avg | 3464 | **3254** | **−210 (−6.1%)** |
| p50 | 2687 | **2823** | +136 |
| p95 | 8552 | **6586** | **−1966** |
| min | 1554 | 1552 | ≈ |
| max | 14089 | 13749 | −340 |

### 4.2 分项延迟

| 环节 | avg (ms) | p95 (ms) |
|------|----------|----------|
| ASR | 961 | 1208 |
| Tone | 7.1 | — |
| IME decode | **6.6** | 13 |
| Pipeline 合计 | 3254 | 6586 |
| 音频时长 avg | 3638 | — |
| **RTF** | **0.89** | 基线 0.95 |

> Local fallback 仅在 alignFailed 全灭时触发，IME decode 增量可忽略；pipeline avg/p95 略优主要受 ASR/调度波动影响，**不能归因于 Proposal 算法本身显著加速**。

---

## 5. 关键案例（d001 / d002 / d003）

| ID | 场景 | 基线 fw | 本轮 fw | diff | selected | applied | final CER |
|----|------|---------|---------|------|----------|---------|-----------|
| **d001** | cafe | false | **true** | 0→**4** | 0→**3** | 0 | 0.259 |
| d002 | cafe | true | true | 15 | 2 | 0 | 0.118 |
| d003 | cafe | true | true | 0→**4** | 2→**3** | 0 | 0.105 |

### d001 抽样（核心验收案）

| 字段 | 内容 |
|------|------|
| 参考 | 你好，我想点一杯热拿铁，**中杯**，少糖。顺便问一下今天有**蓝莓马芬**吗？ |
| ASR raw | 你好,我想点一杯热拿铁**钟贝**少糖 深便温 以下今天有**蓝美马分**吗? |
| final | 与 raw 相同（apply=0） |
| pipeline | 5656 ms |
| selectionMode | all_passed |

**结论：** d001 从「零 span」变为 diff=4 / selected=3，验证 Local Raw-IME Diff 对 alignFailed 场景的 Proposal 修复目标达成。

---

## 6. 测试结果抽样

### 6.1 新增 fw 触发（相对基线，节选 8 条）

| ID | 场景 | raw 片段（示意） | diff | selected | CER |
|----|------|------------------|------|----------|-----|
| d001 | cafe | 钟贝 / 蓝美马分 | 4 | 3 | 0.259 |
| d009 | taxi | 望金斯赫 / 赌不赌 | 4 | 1 | 0.381 |
| d010 | hospital | 歇常規 | 2 | 2 | 0.550 |
| d012 | hospital | 请家休息 | 3 | 3 | 0.417 |
| d016 | friend | （语义偏移句） | 1 | 1 | 0.130 |
| d021 | tech_deploy | 炼鹿 / 剑口 | 5 | 3 | 0.333 |
| d026 | interview | 夸团队 / 边更 | 1 | 1 | 0.136 |
| d034 | bank | 证件相关 | 1 | 1 | 0.267 |

### 6.2 fw 回退（4 条，Normalizer 清空）

| ID | 基线 selected | 本轮 selected | selectionMode | 说明 |
|----|---------------|---------------|---------------|------|
| d014 | 2 | 0 | empty_after_normalizer | diff=6 但 normalizer 后为空 |
| d043 | 1 | 0 | empty_after_normalizer | 同形 |
| d064 | 1 | 0 | empty_after_normalizer | 同形 |
| d133 | 1 | 0 | empty_after_normalizer | 同形 |

### 6.3 Final CER 最差（节选 3 条）

| ID | 场景 | final CER | fw | selected | 备注 |
|----|------|-----------|-----|----------|------|
| d067 | customer_service | **3.04** | true | — | ASR 重复 hallucination |
| d110 | tech_deploy | 0.833 | false | 0 | align 未全灭，未走 local |
| d155 | tech_deploy | 0.833 | false | 0 | 同 d110 变体 |

---

## 7. 结论与后续

### 7.1 本轮结论

| 维度 | 结论 |
|------|------|
| **Proposal span 发现** | ✅ 显著改善：fw +52，no_spans −52 |
| **d001 验收** | ✅ diff 4 / selected 3 |
| **识别质量 (final CER)** | ➖ 无变化（apply=0） |
| **性能** | ➖ 基本持平，RTF 0.89 vs 0.95 |
| **契约** | ✅ 200/200 PASS |
| **回归** | ⚠ 4 条 fw 回退（Normalizer 侧，非 Proposal 激活误触） |

### 7.2 建议后续

1. **KenLM minDelta / domain profile**：打通 apply>0，才能反映 final CER；
2. **Normalizer 4D 单字 span**：分析 d014/d043 等回退案；
3. **restaurant profile 批测**：验证「钟贝→中杯」「蓝美马分→蓝莓马芬」Recall 路径。

---

## 8. 原始数据路径

| 文件 | 说明 |
|------|------|
| `tests/lexicon-tone-dialog200-local-raw-ime-batch-result.json` | 本轮全量批测 |
| `tests/experiments/lexicon-tone-dialog200-local-raw-ime-quality-perf.json` | CER/性能/抽样汇总 |
| `tests/lexicon-tone-dialog200-spanselector-batch-result.json` | 对比基线 |
| `tests/experiments/lexicon-tone-dialog200-spanselector-quality-perf.json` | 基线 CER/性能 |
| `tests/local-raw-ime-dialog200-run.log` | 运行日志 |
