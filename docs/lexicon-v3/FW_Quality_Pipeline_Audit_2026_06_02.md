# FW（Faster-Whisper）ASR 主链 — 只读质量审计

> **日期：** 2026-06-02  
> **性质：** 只读分析；未改代码、配置、阈值或词库  
> **数据：** `tests/fw-detector-dialog-200-batch-result.json`（200 条，`faster-whisper-vad`）  
> **参考 utterance：** `test wav/dialog_200/cases.manifest.json`（TTS 合成音，简体参考文本）

---

## 执行摘要

| 指标 | 值 |
|------|-----|
| 契约 PASS | 200/200 |
| 平均 CER（Raw / Final） | **0.3619 / 0.3617** |
| FW `triggered` | **39**（19.5%） |
| FW `applied` | **1**（0.5%） |
| `text_changed` | **1**（d043，繁简部分归一，非语义修复） |

**结论：** 当前识别质量瓶颈 **不在 Patch/词库 Patch 路径**，而在 **(1) FW 原始 ASR 输出质量** 与 **(2) Metadata Span Gate 覆盖不足**；在已触发的 39 条中，**Sentence KenLM Rerank 几乎一律保留 Raw**（`pickedIsRaw=38/39`），词库 Recall 几乎没有机会改变最终文本。

---

## 第一部分 — FW Quality Pipeline Report

### 1.1 主链调用顺序（代码事实）

```text
ASR (faster-whisper-vad)
  → task-router / faster-whisper-asr-strategy
  → ctx.rawAsrText, ctx.asrSegments (含 word.probability, avg_logprob)

FW_SPAN_DETECTOR (pipeline-mode-fw 插入 ASR 与 AGGREGATION 之间)
  → runFwDetectorOrchestrator (fw-detector-orchestrator.ts)

    ① Span 选择（当前配置 spanGateMode = fw_metadata_gate）
       → selectFwMetadataSpans (fw-metadata-span-gate.ts)
          · low_word_probability（token prob < 0.65）
          · alias_exact_hit
          · 可选 legacy fallback scan

    ② 若无 span → reason=no_spans, triggered=false, 输出=Raw

    ③ 若有 span → Sentence Rerank 路径（useSentenceLevelRerank=true）
       → runFwSentenceRerankPipeline (fw-sentence-rerank-pipeline.ts)
          对每个 span:
            recallSpanTopK (local-span-recall.ts)
              → recallSpanTopKViaRuntimeV2 (runtime-v2-recall-adapter.ts)
              → recallSpanTopKV2 + mergeSpanCandidates (recall-span-topk-v2.ts)
          buildSentenceCandidates（跨 span 组合，maxSentenceCandidates=16）
          rerankFwSentences (rerank-fw-sentences.ts)
            · KenLM scoreBatch(raw + 候选句)
            · bestDelta >= minDeltaToReplace(0.03) 才替换
          mapSentenceToApprovedReplacements + candidateRequireRepairTarget

    ④ applyFwSpanReplacements → ctx.segmentForJobResult

AGGREGATION → NMT → …
  → result-builder 暴露 text_asr / raw_asr_text / fw_detector extra
```

### 1.2 关键配置（`node-config-defaults` + `fw-config.ts`，未改动）

| 项 | 值 | 质量含义 |
|----|-----|----------|
| `spanGateMode` | `fw_metadata_gate` | 不用 KenLM 扫 span |
| `wordProbabilityThreshold` | **0.65** | 仅低置信 **词级** token 进 span |
| `minSpanChars` / `maxSpanChars` | **2 / 4** | 单 span 最多 4 字 |
| `maxSpans` | **4** | 每句最多 4 个修复窗 |
| `recall` 音节 | **2–5** | 超出则 Recall 空 |
| `candidateRequireRepairTarget` | **true** | 非 repair_target 候选不参与最终 apply |
| `minPrior` | **0.5** | priorScore 门槛 |
| `useSentenceLevelRerank` | **true** | 句级 KenLM，非 per-span greedy |
| `minDeltaToReplace` | **0.03** | KenLM 归一分差低于此保留 Raw |

---

## 第二部分 — Detector Coverage Report

### 2.1 Trigger 条件（当前生效路径）

**进入 FW 修复的前提：** Metadata Gate 在 ASR 输出中选出至少 1 个 span。

主要信号：

1. **`low_word_probability`** — Whisper `segment.words[].probability < 0.65`，且 token 为 2–4 个 CJK 字  
2. **`alias_exact_hit`** — 文本中命中词库 alias 精确片段（本批 **5** 次 span 级信号）

**不触发（`no_spans`）的情况：**

- 所有 token probability ≥ 0.65（模型“自信但错”）  
- ASR **严重截断**（只识别前几个音节，无后续低 prob token）  
- **繁体/简体混写** 与参考不一致，但 token 置信度仍高  
- `segment.words` 缺失或与文本对齐失败（`alignmentFailures`）  
- 错误跨度 **>4 字** 或 **非 CJK**（英文/数字块不进 gate）

### 2.2 dialog_200 统计

| 结果 | 条数 | 占比 |
|------|------|------|
| **未触发** `no_spans` | **161** | **80.5%** |
| 触发 + `no_candidates` | 16 | 8.0% |
| 触发 + 有候选 + 未 apply | 22 | 11.0% |
| 触发 + **applied** | **1** | 0.5% |

### 2.3 典型「明显 ASR 错但未触发」

| id | 现象 | 原因归类 |
|----|------|----------|
| d045–d180 | homophone 模板句只识别前几字，CER≈0.96 | **截断 + 整句错误**；无连续低 prob 4 字窗 |
| d061/d106 | Raw=`周末` / `周末一`，Ref 整句 | **VAD/时长截断** |
| d194 | 繁体 ASR vs 简体 Ref | **脚本差异**；非 homophone 可修 |
| d065/d155 | tech_deploy 整段同音替换 | 错误分散在多 span，**单 token 仍高置信** |

**结论：** Detector 设计为 **“Whisper 自知不确定的词”**，对 **“自信的错误 / 整句截断 / 短语级同音替换”** 覆盖极弱。这是 **Trigger 仅 19.5%** 的主因。

---

## 第三部分 — Recall Quality Report

### 3.1 Trigger 后 Recall 行为

| 指标 | 值 |
|------|-----|
| 平均 span 数 | **1.08** |
| 平均候选数（跨 span 合计） | **1.0** |
| Recall **为空**（`no_candidates`） | **16 / 39**（41%） |
| 有候选 | **23 / 39**（59%） |

### 3.2 Recall 为空的原因（代码约束）

1. **音节数 ∉ [2,5]**（`local-span-recall.ts`）  
2. **拼音相似度 + priorScore** 过滤后无 hit  
3. **`candidateRequireRepairTarget`** — 命中词但未标 `repair_target` 时句级 apply 仍可能被剔除  
4. **`enabledDomains`** 与 session profile 过滤 domain 词  
5. **`maxIdiomCandidates: 0`** — idiom 层默认不进 FW TopK  

### 3.3 候选来源（架构）

V2 路径：`recallSpanTopKV2` 合并 **base → domain → alias**（`merge-span-candidates.ts`），本批 JSON **未逐 tier 落盘**；从 span 数与 avgCandidates≈1 推断：**多数 span 仅 0–1 个有效 repair 候选**。

### 3.4 TopK 是否过小？

- Per-span limit 随 span 数动态收缩（`per-span-candidate-limit.ts`）  
- 句级组合 `combinationCount` 平均 **0.8**，中位为 **0** — 多数触发句 **无法形成有效多 span 组合**  
- 瓶颈更在 **Recall _yield=0** 而非 TopK 截断

---

## 第四部分 — Lexicon Coverage Report

### 4.1 方法说明

dialog_200 参考为 **整句 TTS 稿**；失败多为 **整句截断或多词同时错**，无法做可靠的「逐词 oracle 对齐 → 查 SQLite」自动化。以下基于 **失败模式 + homophone 场景设计意图** 的保守判断。

### 4.2 失败样本（CER_final > 0.15，n=124）归类

| 类别 | 含义 | 条数 | 占失败样本 |
|------|------|------|------------|
| **A** ASR 太差（Raw CER≥0.75） | 截断/半句 | **34** | 27% |
| **B** Detector 漏检 | 未进 FW | **66** | **53%** |
| **C** Recall 空 | 进了 FW 无候选 | **8** | 6% |
| **D** 词库缺失 | 有候选但无正确词 | **0*** | — |
| **E/F** KenLM / 排序 | 有候选未 apply | **16** | 13% |

\* 在 **已进入 Recall 的 23 条** 中，未见「参考词明显在库但 Recall 未返回」的可验证样本；**主要缺口在 Detector 未指向错误 span**。

### 4.3 homophone 场景（lexicon_homophone，n=12）

- 平均 Raw CER **0.76**；Trigger **4**，Applied **1**  
- 模板词（候选生成、上线计划等）**设计上在 domain/base 库**；ASR 常只输出「關於後,選生…」等 **前 4–8 字**  
- **不是「词不在库」**，而是 **错误形态超出 span 修复模型**

### 4.4 覆盖率结论（定性）

| 问题 | 判断 |
|------|------|
| 5 万 base + domain patch 对 **2–4 字 repair_target** | 对 **已触发 span** 基本够用 |
| 对 **整句截断 / 多词联合错误** | 词库 **无法覆盖** |
| 扩 Alias / Domain | 仅当 Detector **定位到对应 span** 时有收益 |

---

## 第五部分 — KenLM Quality Report

### 5.1 当前 Gate 形态

- Span 级 KenLM Gate：**关闭**（`kenlmSpanGate.enabled=false`）  
- **句级** `rerankFwSentences`：比较 Raw 与候选句 KenLM **normalizedScore** 差值  

### 5.2 dialog_200 统计

| 指标 | 值 |
|------|-----|
| 触发句中 `sentenceRerank.pickedIsRaw` | **38 / 39**（97.4%） |
| `maxDelta < minDeltaToReplace(0.03)` | **38** |
| 汇总字段 `kenlm_vetoed_count` | **0**（句级路径不产生 per-candidate veto 计数） |

### 5.3 含义

- **不是「Recall 命中正确词后被 KenLM 否决」为主模式**  
- 而是 **「候选句相对 Raw 的 KenLM 提升不足 0.03 → 整句保留 Raw」**  
- 在 ASR 已严重错误时，局部替换候选句往往 **语言模型得分也低于长 Raw**  

### 5.4 类型敏感度（推断）

旅游/品牌/英文/地名：本批 **未观察到** 大量「Recall 有正确 domain 词但被 KenLM 单点否决」；阻塞发生在 **更早阶段（无 span / 无候选 / delta 不足）**。

---

## 第六部分 — PriorScore Ranking Report

### 6.1 机制

- Recall 排序：`toneDistance → priorScore → candidateScore`（sentence pipeline 内）  
- `candidateRequireRepairTarget=true` 时，非 repair_target 词 **不能** 成为 approved replacement  

### 6.2 本批观察

- **仅 1 条 apply**（d043）：替换未改变语义，仅繁简字符  
- **23 条有候选未 apply**：PriorScore 排序 **不是主因**；主因是 **句级 KenLM pickedIsRaw**  
- **未见** 可复核的「正确词在候选列表但 prior 过低被压到 TopK 外」TOP 案例（组合数过少）

---

## 第七部分 — FW Raw ASR Error Report

**仅比较 Raw ASR vs 参考 utterance（200 条）：**

| 类别 | 定义 | 条数 | 占比 |
|------|------|------|------|
| **A** 完全匹配 | CER=0 | 22 | 11% |
| **B** 轻微 | CER≤0.05 | 4 | 2% |
| **C** 中度 | 0.05–0.35 | 84 | **42%** |
| **D** 同音/替换类 | 0.35–0.75 | 53 | **26.5%** |
| **E** 英文/拉丁问题 | 含拉丁差异 | 3 | 1.5% |
| **F** 严重截断/空 | CER≥0.75 | 34 | **17%** |

**CER 主要来自：** 中度识别偏差（42%）+ 同音替换（26.5%）+ 严重截断（17%）。  
**FW 后处理仅改善 1 条（0.5%）**，与 Raw 分布一致。

---

## 第八部分 — Failure Classification Report

（失败 = Final CER > 0.15，n=**124**）

| 类别 | 数量 | 占失败样本 | 说明 |
|------|------|------------|------|
| **A** ASR 错误过大 | 34 | 27% | 任何后处理难救 |
| **B** Detector 漏检 | 66 | **53%** | 最大桶 |
| **C** Recall 为空 | 8 | 6% | 有 span 无候选 |
| **D** 词库缺失 | ~0* | — | 非主因 |
| **E** KenLM 否决 | ~0 | — | 句级 delta 门控，非 veto 计数 |
| **F** 排序 / delta 不足 | 16 | 13% | 有候选，pickedIsRaw |
| **G** 其他 | 0 | — | — |

**TOP 失败案例：** d045/d090/d135/d180（homophone 模板，CER≈0.96，均未触发）；d061（截断「周末」）；d194（繁简/语义漂移）。

---

## 第九部分 — Improvement Opportunity Report

基于 **本批数据 + 代码行为** 的保守估算（非重新训练后的承诺值）：

| 方向 | 机制 | 潜在收益（dialog_200 量级） | 依据 |
|------|------|------------------------------|------|
| **升级 / 调 ASR+TTS 对齐** | 减少截断、繁简混写、置信幻觉 | **高（10–20+ pp CER）** | 80% 样本 FW 未介入；34 条 severe Raw |
| **扩大 Detector 覆盖** | 短语级可疑、截断检测、homophone 模板窗 | **中（5–15 pp，若允许改 gate）** | 66 条失败为 Detector miss |
| **放宽句级 KenLM delta / 组合** | 更多 apply | **低–中（1–5 pp）** | 38/39 triggered 为 pickedIsRaw |
| **扩词库 / Alias** | 仅对已触发 span | **低（≤2 pp 本批）** | 16 no_candidates + 多数未触发 |
| **调 PriorScore / repair_target** | 排序微调 | **极低** | 非主阻塞 |
| **重训 KenLM** | 域适配 LM | **低–中（不确定）** | 当前为 delta 门槛，非 span veto |
| **继续 Patch 词库系统** | 运营/domain 词 | **长期运维价值**；**对本批 CER 几乎无直接收益** | Applied=1 |

---

## 第十部分 — 最终结论

### Q1. 为什么 Trigger≈39，Applied≈1？

1. **161 条** Metadata Gate **无 span**（`no_spans`）— Whisper token 多数 **高置信**，或 **截断/整句错** 不符合低 prob 规则。  
2. **16 条** 有 span 但 **Recall 无候选**（音节/拼音/repair_target/domain 过滤）。  
3. **22 条** 有候选，但 **句级 KenLM** 在 **38/39** 触发句选择 **`pickedIsRaw`**（`maxDelta < 0.03` 或无组合）。  
4. **唯一 apply（d043）** 为 **繁简字符归一**，非业务词修复。

### Q2. 当前最大瓶颈？

**FW 原始 ASR 输出质量 + Metadata Span Detector 覆盖不足**（80.5% 样本 never enter repair funnel）。

### Q3. 词库覆盖率是否足够？

对 **「2–4 字、repair_target、已触发 span」** 基本够用；对 **dialog_200 主要错误形态（截断、整句同音、繁简）** **不够且无法用词库 alone 解决**。

### Q4. Detector 是否足够？

**不够。** 失败样本 **53%** 为 Detector 漏检；homophone 场景 CER 0.76 但 Trigger 仅 4/12。

### Q5. KenLM 是否限制效果？

**以句级 delta 门槛形式限制 apply**（97% triggered 保留 Raw），但 **不是** 典型的「Recall 正确词被 KenLM 否决」模式。

### Q6. PriorScore 是否限制效果？

**本批非主因**；阻塞在 Detector 与句级 KenLM delta。

### Q7. 是否值得继续开发词库系统？

**值得，但定位应是运营/domain 词条下发（Patch）**，而非期望显著提升 dialog_200 类 **TTS 批测 CER**。词库价值在 **Detector 已圈定 span** 的场景兑现。

### Q8. 下一阶段投入排序（按收益）

|  rank | 方向 | 理由 |
|------|------|------|
| **TOP1** | **ASR 模型 / 音频前端 / 测试集与 TTS 参考对齐** | Raw CER 0.36 且 FW 几乎不改；severe 占 17% |
| **TOP2** | **Detector 覆盖（span 选择策略）** | 80.5% 未触发；失败桶 53% 漏检 |
| **TOP3** | **句级 Rerank 门槛与候选组合_yield**（在 freeze 允许范围内评估） | 39 触发中 38 条 pickedIsRaw |

**不建议优先：** 大规模扩库（本批 ROI 低）、PriorScore 微调、KenLM 重训（在未解决 Detector/ASR 前边际有限）。

---

## 附录 — 数据与代码引用

| 项 | 路径 |
|----|------|
| 批测结果 | `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json` |
| Orchestrator | `main/src/fw-detector/fw-detector-orchestrator.ts` |
| Metadata Gate | `main/src/fw-detector/fw-metadata-span-gate.ts` |
| Sentence Rerank | `main/src/fw-detector/fw-sentence-rerank-pipeline.ts` |
| Recall | `main/src/lexicon/local-span-recall.ts`, `lexicon-v2/recall-span-topk-v2.ts` |
| KenLM pick | `main/src/fw-detector/rerank-fw-sentences.ts` |

**审计确认：** 未修改 Runtime、PatchService、FW 核心逻辑、SQLite、配置或阈值。
