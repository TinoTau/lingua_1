# Pinyin IME V1 Single Char Dictionary Import — Test Report

**Date:** 2026-06-03  
**Batch:** Dialog200 subset (117/200 cases, stoppedReason=deadline)  
**Backend:** `dict_dp` local (`--no-kenlm`, KenLM query.exe unavailable)

---

## 1. Test Commands

```bash
cd electron_node/electron-node
npm run spike:pinyin-ime-v1:import:single-char   # validate + copy TSV
# export:all skipped — base_dictionary.txt already present in tmp/
node tests/spike/run-pinyin-ime-v1-dialog200.mjs --local --no-kenlm
npm run spike:pinyin-ime-v1:analyze
```

Artifacts:

- Results: `tests/spike/pinyin-ime-v1-dialog200-results.json`
- Summary: `tests/spike/pinyin-ime-v1-report-summary.json`
- Auto report: `docs/pinyin-v1/pinyin-ime-v1-report-latest.md`

---

## 2. Single Char Dictionary Metrics

| 指标 | 值 |
|------|-----|
| single_char_dictionary 行数 | **2510** |
| function_single_char 行数 | **79** |
| content_single_char 行数 | **698** |
| content_single_char_fallback 行数 | **1617** |
| 主 Beam 单字行数 | 166 |
| Fallback 单字行数 | 2344 |
| singleCharLoaded | **true** |

---

## 3. Fallback / Beam Recovery

| 指标 | 值 | 说明 |
|------|-----|------|
| fallbackTriggeredCount（事件） | 119 | 全局 next=0 触发次数 |
| beamBreakRecoveredCount（事件） | 21945 | fallback 扩展次数（非 case 级） |
| contentFallbackUsedCount | 21945 | fallback 单字被选用次数 |
| functionSingleCharUsedCount | 18356 | 主 Beam 功能单字使用次数 |
| **casesWithFallback** | **57 / 117** | 至少触发一次 fallback 的样本 |
| **casesWithRecovery** | **57 / 117** | fallback 成功扩展 beam 的样本 |

---

## 4. candidateCount 改善（核心验收）

### 4.1 导入前（三层词典，无 single_char）

来源：`pinyin-ime-v1-report-summary.json`（2026-06-02 基线）

| 指标 | 基线 |
|------|------|
| 有拼音 CJK 样本 (lexicon_missing) | 87 |
| candidateCount > 0 | **0 / 87 (0%)** |
| top1 / top3 / top5 / top10 | 0% |
| refInDiff | 0% |

### 4.2 导入后（+ single_char_dictionary）

| 指标 | 结果 | Δ |
|------|------|---|
| 评估样本 | 117 | — |
| candidateCount > 0 | **84 / 117 (71.8%)** | +84 |
| 有拼音 CJK 非空候选 | **84 / 87 (96.6%)** | +84 |
| 仍为 candidate=0（有拼音） | **3** (d004 等) | −84 |
| candidate=0（空 raw / 504） | 30 | 无变化 |
| **0→非空 样本数** | **84** | — |

剩余 3 条有拼音但无法完成全句解码，典型原因：早期音节无匹配 + fallback 仍无法贯通全链（如 `jie kou bao cuo` 等 ASR 错误音节）。

---

## 5. Quality Metrics (topK / refInDiff)

| 指标 | all (n=117) | lexicon_missing (n=87) | detector_miss (n=78) |
|------|-------------|------------------------|----------------------|
| top1 | 0% | 0% | 0% |
| top3 | 0% | 0% | 0% |
| top5 | 0% | 0% | 0% |
| **top10** | **0.85%** (1/117) | **1.15%** (1/87) | 0% |
| **refInDiff** | **9.4%** | **12.6%** | 5.1% |
| kenlmWouldApply | 0% | — | — (KenLM skipped) |

topK 仍接近 0，但 refInDiff 从 0% 升至 9.4%，说明候选已开始覆盖 reference 片段（非 exact match）。

---

## 6. Performance

| 指标 | 值 | 门槛 | 结果 |
|------|-----|------|------|
| decode P50 | **4 ms** | — | ✅ |
| decode P95 | **12 ms** | < 200 ms | ✅ PASS |
| decode avg | 5 ms | — | ✅ |
| beam 爆炸 | 否 | — | ✅ P95 稳定 |

Fallback 未导致 decode 延迟失控；BEAM_WIDTH=48 保持不变。

---

## 7. Failure Breakdown

| failureClass | count |
|--------------|-------|
| diff_fail | 66 |
| ok | 21 |
| english_mixed | 30 |

`diff_fail` 上升是因为 84 条样本现在有候选但 diff 对齐失败（预期行为，非 regression）。

---

## 8. Sample Cases

### 8.1 断链恢复成功（fallback）

| id | raw (trunc) | top1 (trunc) | fallbackUsed |
|----|-------------|--------------|--------------|
| d001 | 你好,我想点一杯热拿铁… | 你好我向点以被热拿铁中杯… | 348 |
| d002 | 麻烦帮我做一杯美食带走… | 麻烦帮我做以北美式带走大杯… | 624 |
| d007 | 市富曲仲觀村軟件… | 师父去中观寸软件远走机场… | 540 |

### 8.2 仍为 candidate=0（需 unknown/gap）

| id | 原因 |
|----|------|
| d004 | 有拼音流，全链无法贯通（`jie kou bao cuo` 等） |
| d048 | 繁体 ASR + 长链断裂 |
| d049 | 同 d004 模式 |

### 8.3 唯一 top10 hit

1/117 样本 top10 命中 reference（详见 results JSON）。

---

## 9. Acceptance Summary

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 单字词表成功加载 | ✅ PASS |
| 2 | Dialog200 不再全部 candidate=0 | ✅ PASS (84/87 CJK 非空) |
| 3 | decode P95 < 200ms | ✅ PASS (12ms) |
| 4 | fallback 未导致 beam 爆炸 | ✅ PASS |
| 5 | 出现非空候选 | ✅ PASS (84 cases) |

**Freeze Gate:** detector_miss top5 / recall_empty top3 仍 FAIL（topK 未达标）— 符合 spike 预期，**不推荐入主链**。

---

## 10. Conclusions

1. **Single char dictionary 有效解除 dict_dp 长句断链**：candidateCount 从 0% 升至 96.6%（有拼音子集）。
2. **Function/time/place/measure 单字主 Beam + content fallback 策略按 spec 工作**；57 条样本触发断链恢复。
3. **质量仍不足**：top1~top5=0%，需 unknown/gap/partial decode + KenLM 重排才能进一步提升。
4. **建议下一步**：实现 unk/gap/partial 通道处理剩余 3 条全链失败 + 修复 KenLM 环境后完整 analyze。

---

## 11. Compliance Confirmation

- ❌ 未导入 production lexicon.sqlite  
- ❌ 未视为 Lexicon V3.1 正式资产  
- ❌ 未接入 FW Detector 主链  
- ✅ 本轮为 pinyin-ime-v1 offline spike only  

---

*Test report generated from `pinyin-ime-v1-dialog200-results.json` and `pinyin-ime-v1-report-summary.json`.*
