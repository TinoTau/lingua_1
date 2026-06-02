# FW / ASR 主链质量审计 — 综合报告

> **报告日期：** 2026-06-02  
> **审计类型：** 只读质量审计（未改代码、配置、阈值、词库、Patch）  
> **数据集：** dialog_200（200 条 TTS WAV，`faster-whisper-vad`，`is_manual_cut=true`）  
> **批测结果：** `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json`  
> **参考文本：** `test wav/dialog_200/cases.manifest.json`

---

## 1. 报告说明

本报告汇总本轮针对 **Faster-Whisper（FW）主链** 的三项只读专项审计结论，供质量评估与后续优先级讨论使用。**不包含**实现建议 Patch，**不替代** 各专项文档中的逐条证据与 TOP 案例表。

| 专项报告 | 文件 | 焦点 |
|----------|------|------|
| **全链质量** | [FW_Quality_Pipeline_Audit_2026_06_02.md](./FW_Quality_Pipeline_Audit_2026_06_02.md) | Trigger/Apply、Recall、KenLM、词库 ROI |
| **Detector 漏检** | [FW_Detector_Metadata_Gate_Audit_2026_06_02.md](./FW_Detector_Metadata_Gate_Audit_2026_06_02.md) | `fw_metadata_gate` 为何漏检、A–G 分类 |
| **截断问题** | [FW_Truncation_Pipeline_Audit_2026_06_02.md](./FW_Truncation_Pipeline_Audit_2026_06_02.md) | 半句 ASR 发生在哪一层 |

---

## 2. 执行摘要

### 2.1 批测总览

| 指标 | 值 | 说明 |
|------|-----|------|
| 契约 | **200/200 PASS** | 运行时与 FW 契约未破 |
| 平均 CER（Raw / Final） | **0.3619 / 0.3617** | Final 几乎等于 Raw |
| FW `triggered` | **39（19.5%）** | Metadata Gate 选出 ≥1 span |
| FW `applied` | **1（0.5%）** | 仅 d043 繁简字符归一 |
| `no_spans` | **161（80.5%）** | 全部 `all_signals_normal` |

**一句话：** 当前瓶颈在 **ASR 原始输出质量** 与 **进入 FW 修复漏斗的比例过低**；进入漏斗后 **KenLM 句级 rerank 几乎不采纳候选**（38/39 保留 Raw）。**扩词库 / Patch 对本批 CER 直接收益极低。**

### 2.2 失败样本归因（Final CER > 0.15，n=124）

| 归因 | 条数 | 占失败样本 | 与专项报告对应 |
|------|------|------------|----------------|
| **ASR 过差（含严重截断）** | 34 | 27% | 全链 §失败分类 A |
| **Detector 漏检（未触发 FW）** | 66～92* | 53%～74%* | Detector §3；*见注 |
| **Recall 空（已触发无候选）** | 8 | 6% | 全链 §Recall |
| **KenLM / delta 不足（有候选未 apply）** | 16 | 13% | 全链 §KenLM |
| **词库缺失** | ~0 | — | 非主因 |

**注：** 「Detector 漏检」在全链审计中为 **66**（Raw CER∈(0.15,0.75) 且未触发）；Detector 专项按「Final 失败且未触发」统计为 **92**。差异来自 severe 截断（Raw CER≥0.75）是否并入 Detector 桶。**截断型失败与 Detector 漏检高度重叠**（见 §2.3）。

### 2.3 截断（半句 ASR）— 独立结论

| 指标 | 值 |
|------|-----|
| 前缀截断型样本（全量 200） | **49（24.5%）** |
| 截断样本 `node_audio_segment_count=2` | **49/49** |
| 截断样本首批 `audio_ms` 均值 | **~1980 ms**（非截断 ~4176 ms） |

**机制（dialog_200）：**

1. `AudioAggregator.splitAudioByEnergy` 在 **句中停顿** 处切成 2 段 → **两次** `/utterance`  
2. **`rawAsrText` 仅在第一批 ASR 写入并冻结**（`asr-step.ts`）  
3. 指标中的 `raw_asr_text` / `text_asr` 常 **只有前半句**；第二批文本未合并落盘  

**FW 单次请求：** 输出与 **该次送入的音频** 一致，**不是** Whisper 在同一段 5s 音频上无故停写。

用户示例「今天下午我们去皇后镇…」**不在** dialog_200 manifest，机制与 **句中停顿 + 首批冻结** 同类。

---

## 3. 分模块结论

### 3.1 ASR / FW 原始输出（全链）

| Raw CER 分布 | 条数 | 占比 |
|--------------|------|------|
| 完全匹配 | 22 | 11% |
| 中度（0.05～0.35） | 84 | 42% |
| 同音/替换（0.35～0.75） | 53 | 26.5% |
| 严重截断（≥0.75） | 34 | 17% |

FW 后处理 **仅改善 1 条**（0.5%），与 Raw 分布一致。

### 3.2 Metadata Detector（`fw_metadata_gate`）

| 项 | 结论 |
|----|------|
| 主信号 | `low_word_probability`（&lt;0.65）+ `alias_exact_hit` |
| 漏检侧低置信 token | **0**（100% 漏检样本 Gate 侧 `lowConfidenceWordCount=0`） |
| 漏检形态 TOP | **截断 40%**、**短语级 &gt;4 字 40%**、**数字/日期 15%** |
| 仅调低 prob 阈值 | **无法** 覆盖漏检（错误 token 已高置信） |
| `maxSpanChars=4` | **~99%** 漏检错误区段 &gt;4 字 |

详见 [Detector 专项报告](./FW_Detector_Metadata_Gate_Audit_2026_06_02.md) 第十部分（TOP50 表、覆盖估算、误修风险）。

### 3.3 已触发路径（39 条）

| 阶段 | 结果 |
|------|------|
| Recall 空 | **16/39（41%）** |
| 有候选 | 23/39 |
| 句级 KenLM `pickedIsRaw` | **38/39** |
| `applied` | **1** |

Recall 与 KenLM **不是** 本批「零改善」的首因；首因是 **80.5% 从未进入 FW** 与 **Raw ASR 过差/截断**。

### 3.4 截断根因（dialog_200）

| 层次 | 是否主因 |
|------|----------|
| AudioAggregator 能量切分 | **是** |
| `rawAsrText` 首批冻结 | **是**（落盘「半句」） |
| Silero VAD（每批内） | 次要 |
| FW Whisper（单批内） | **否**（输出=输入） |
| Utterance Aggregator | **否** |

详见 [截断专项报告](./FW_Truncation_Pipeline_Audit_2026_06_02.md)。

---

## 4. 根因关系图

```text
                    dialog_200 参考整句
                           │
                           ▼
              ┌────────────────────────┐
              │ AudioAggregator        │
              │ 句中停顿 → 2 段音频     │◄── 截断报告 §3
              └───────────┬────────────┘
                          │ 批1 only → rawAsrText 冻结
                          ▼
              ┌────────────────────────┐
              │ faster-whisper-vad     │
              │ Silero VAD + Whisper   │
              └───────────┬────────────┘
                          │ 常为「半句」文本
                          ▼
              ┌────────────────────────┐
              │ fw_metadata_gate       │
              │ prob≥0.65 → no_spans   │◄── Detector 报告 §2
              │ 80.5% 未进 FW          │
              └───────────┬────────────┘
                          │ 19.5% triggered
                          ▼
              ┌────────────────────────┐
              │ Recall + 句级 KenLM    │
              │ pickedIsRaw 38/39      │◄── 全链报告 §5
              │ applied 1              │
              └────────────────────────┘
```

---

## 5. 投入优先级（综合建议，非实施承诺）

基于 **本批数据 + 代码行为** 的保守排序：

| 优先级 | 方向 | 理由 |
|--------|------|------|
| **TOP1** | **ASR 输入完整性**（多批文本合并 / 整句 manual-cut 不切句中） | 直接消除 24.5% 前缀截断表象；d061 类 WAV 5.7s 仅首批 660ms |
| **TOP2** | **ASR 模型 / TTS 测试对齐 / 音频前端** | Raw CER 0.36；severe 17% |
| **TOP3** | **Detector 覆盖模型**（截断信号、短语窗；非单纯 prob） | 失败样本 53%+ 漏检；prob 放宽 **+0** 漏检收益 |
| **TOP4** | **句级 KenLM delta / 候选组合** | 仅影响已触发 39 条 |
| **低** | 扩词库 / Patch / Prior 微调 | applied=1；Recall 空在已触发中为主 |

**明确不建议优先（本批数据）：**

- 仅降低 `wordProbabilityThreshold`  
- 无约束扩大 `maxSpanChars`（误修与组合爆炸）  
- 指望词库 alone 降低 dialog_200 CER  

---

## 6. 数据与复现

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node

# 节点 + test server :5020 就绪后
node tests/run-dialog200-timed-batch.mjs

# 质量汇总（CER 等）
node tests/analyze-dialog200-quality-perf.mjs
```

| 产物 | 路径 |
|------|------|
| 批测 JSON | `tests/fw-detector-dialog-200-batch-result.json` |
| 质量汇总 | `tests/fw-detector-dialog-200-quality-perf.json` |
| 参考 manifest | `test wav/dialog_200/cases.manifest.json` |

---

## 7. 审计边界确认

| 项 | 状态 |
|----|------|
| 修改 `fw-detector/` 源码 | **未做** |
| 修改 `node-config` / 阈值 | **未做** |
| 修改词库 / SQLite / Manifest | **未做** |
| 修改 PatchService | **未做** |
| 讨论 Scheduler | **未纳入** |
| 提交代码 Patch | **未做** |

---

## 8. 附录 — 专项报告章节索引

### 全链报告（10 部分）

1. FW Quality Pipeline  
2. Detector Coverage  
3. Recall Quality  
4. Lexicon Coverage  
5. KenLM Quality  
6. PriorScore Ranking  
7. FW Raw ASR Error  
8. Failure Classification  
9. Improvement Opportunity  
10. 最终结论  

### Detector 报告（10 部分）

1. Architecture  
2. NoSpan Dataset  
3. Miss Classification A–G  
4. Confidence Failure  
5. Span Length  
6. Miss Type Distribution  
7. Coverage Opportunity  
8. False Positive Risk  
9. TOP50 案例表  
10. 最终结论  

### 截断报告（10 部分）

1. Pipeline  
2. FW Raw Output  
3. Audio Aggregator  
4. VAD  
5. Utterance Aggregator  
6. FW Parameters  
7. Truncation Dataset  
8. 时间轴 TOP 案例  
9. Root Cause 分类  
10. 最终结论  

---

**报告结束。** 细节、表格与 TOP 案例请以三份专项文档为准。
