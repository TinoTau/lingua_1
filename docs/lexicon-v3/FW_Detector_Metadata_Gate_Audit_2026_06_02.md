# FW Detector（fw_metadata_gate）只读质量审计

> **日期：** 2026-06-02  
> **性质：** 只读分析；未改代码、配置、阈值或 Span 规则  
> **数据：** `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json`（200 条）  
> **参考文本：** `test wav/dialog_200/cases.manifest.json`

---

## 执行摘要

| 指标 | 值 |
|------|-----|
| FW `triggered` | **39**（19.5%） |
| `no_spans` | **161**（80.5%） |
| 失败样本（Final CER>0.15） | **124** |
| Detector 漏检（未触发且失败） | **92**（占失败 **74.2%**） |
| 与上轮对齐的「可修漏检」子集（Raw CER∈(0.15,0.75)，未触发） | **66**（占失败 **53.2%**） |

**核心结论：** Metadata Gate 只认 **Whisper 低词概率（<0.65）** 与 **alias 精确命中**。本批 **161 条** 全部 `skippedReason=all_signals_normal`；漏检样本 **100%** 在 Gate 侧 `lowConfidenceWordCount=0`（模型对错误 token 仍高置信）。最大漏检形态是 **整句/前缀截断（Category B）** 与 **错误跨度远超 4 字（Category C/F）**，**不是**单纯把 probability 阈值调松就能解决。

---

## 第一部分 — Detector Architecture Report

### 1.1 调用链（当前生产路径）

```text
pipeline/steps/fw-detector-step.ts
  → runFwDetectorOrchestrator (fw-detector-orchestrator.ts)
      → resolveFwSpans
          [spanGateMode = fw_metadata_gate]
          → selectFwMetadataSpans (fw-metadata-span-gate.ts)
              ① collectAliasSpans (alias-span-scan.ts)
              ② collectLowWordProbabilitySpans (segment.words[].probability)
              ③ optional legacy fallback → suspicious-span-detector-v1 (最多 1 span)
          → mapFwMetadataSpanToFwSpan
      → 若 spans.length=0 → reason=no_spans, triggered=false
      → 否则 → runFwSentenceRerankPipeline → applyFwSpanReplacements
```

### 1.2 Trigger 来源

| 来源 | 模块 | 默认状态 | 说明 |
|------|------|----------|------|
| **`low_word_probability`** | `fw-metadata-span-gate.ts` | **启用（主路径）** | `wordInfo.probability < 0.65`；token 须为 **2–4 个 CJK 字** |
| **`alias_exact_hit`** | `alias-span-scan.ts` | **启用** | 文本中精确命中 V2 alias 索引 key（≥2 字） |
| **Legacy fallback scan** | `suspicious-span-detector-v1.ts` | 配置启用，**本批未触发** | 仅当无 alias/低 prob 候选 **且** `avg_logprob < -1.0` **且**（words 缺失 **或** alignmentFailures>0） |
| **KenLM span gate** | `kenlm-span-selector.ts` | **废弃（默认关闭）** | `spanGateMode=kenlm_gate_filter` + `kenlmSpanGate.enabled=true` 时回滚 |
| **Legacy detector v1** | `suspicious-span-detector-v1.ts` | **废弃（非默认）** | `spanGateMode=legacy_detector` 全量回滚 |
| **detector_pinyin_hint** | legacy detector 内部 | **Metadata 路径剔除** | fallback 映射时过滤 |

### 1.3 当前启用 vs 废弃

| 状态 | 模式 / 信号 |
|------|-------------|
| **启用** | `spanGateMode=fw_metadata_gate`；`low_word_probability` + `alias_exact_hit` + 条件 legacy fallback |
| **废弃 / 回滚** | `kenlm_gate_filter`、`legacy_detector` 全链；KenLM **span** 扫描不进默认路径 |

### 1.4 Metadata Gate 依赖字段

| 字段 | 来源 | 用途 |
|------|------|------|
| `rawAsrText` | ASR | span 对齐基准文本 |
| `segments[].text` | ASR | segment 在全文中的 offset |
| **`segments[].words[].word`** | Whisper | token 文本 |
| **`segments[].words[].probability`** | Whisper | 低置信判定（阈值 **0.65**） |
| `segments[].avg_logprob` | Whisper | legacy fallback 触发（阈值 **-1.0**） |
| `aliasKeys` | Lexicon V2 exact 索引 | alias 精确命中 |

### 1.5 Whisper probability 如何参与

```149:181:electron_node/electron-node/main/src/fw-detector/fw-metadata-span-gate.ts
      const probability = wordInfo.probability;
      if (probability == null || probability >= config.wordProbabilityThreshold) {
        continue;
      }
      // ... minSpanChars/maxSpanChars, CJK-only ...
      spans.push({ signals: ['low_word_probability'], priority: 2 });
```

- **唯一主信号：** token 级 `probability < wordProbabilityThreshold`（默认 **0.65**）。  
- **`probability == null`** 或 **≥ 0.65**：该 token **永不** 产生 span。  
- **`avg_logprob`** 不直接产 span；仅参与 legacy fallback 门槛。  
- 本批：**37** 个低置信 token 分布在 **35** 条样本；**39** 条触发 — 说明 **低 prob 路径有效**，但只覆盖 **19.5%** 样本。

### 1.6 当前 Span 选择流程

1. 收集 alias spans（priority=3）+ 低 prob CJK token spans（priority=2）  
2. 若无候选且满足 fallback 条件 → 最多 **1** 个 legacy span（priority=1）  
3. `selectTopSpans`：按 priority → riskScore → 长度排序；重叠合并；截断至 **`maxSpans=4`**  
4. 硬约束：**`minSpanChars=2`, `maxSpanChars=4`**；非 CJK token 跳过

---

## 第二部分 — NoSpan Dataset Report

**筛选：** `triggered=false` 且 `reason=no_spans`（n=**161**）

| 指标 | 值 |
|------|-----|
| 数量 | **161** |
| 占 200 条 | **80.5%** |
| Raw CER 均值 | **0.3401** |
| Raw CER 中位 | **0.2222** |
| Raw CER P95 | **0.9** |

**CER 分布：**

| 桶 | 条数 | 说明 |
|----|------|------|
| CER = 0 | 20 | Gate 正确「不介入」 |
| CER ≤ 0.15 | 69 | 轻度错误，未触发可接受 |
| CER > 0.15 | **92** | 明显错误但未进 FW |
| CER ≥ 0.75 | **26** | 严重 ASR 问题，Detector 无法单独修复 |

**skippedReason：** 161/161 为 `all_signals_normal`（无 `no_metadata`）。

---

## 第三部分 — Detector Miss Classification Report

**漏检定义：** Final CER>0.15 且 `fw_triggered=false`（n=**92**）。  
**说明：** 上轮全链审计的 **66** 条为同一集合中 **Raw CER<0.75** 的子集（本批复核 **66/92**）；其余 **26** 条为严重截断/半句（Raw CER≥0.75），Detector 即使触发也难救。

### 3.1 分类统计（A–G）

| 类别 | 含义 | 数量 | 占漏检 |
|------|------|------|--------|
| **A** | 高置信同音词错误 | **1** | 1.1% |
| **B** | 整句/前缀截断 | **37** | 40.2% |
| **C** | 短语级错误（>4 字窗） | **37** | 40.2% |
| **D** | 繁简/脚本差异 | **0** | 0.0% |
| **E** | 英文夹杂 | **3** | 3.3% |
| **F** | 数字/日期/金额相关 | **14** | 15.2% |
| **G** | 其他 | **0** | 0.0% |

### 3.2 各类 TOP 案例

**Category A — 高置信同音词错误**

- **d086**（CER=0.2）Ref: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？ / Raw: 更易是龟仔钥匙找不到了前台,能帮忙开一下吗?

**Category B — 整句/前缀截断**

- **d045**（CER=0.96）Ref: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 / Raw: 關於後,學生成為學生
- **d090**（CER=0.96）Ref: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 / Raw: 關於後,選生成立
- **d135**（CER=0.96）Ref: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 / Raw: 關於後,選生成

**Category C — 短语级错误（>4 字窗）**

- **d196**（CER=0.652）Ref: 周末要不要去江边骑行？天气预报说周日多云，记得带水。 / Raw: 周末要不要去降邊騎行 天氣預報
- **d146**（CER=0.632）Ref: 挂号处请问内科还有号吗？我低烧，昨晚开始的。 / Raw: 括號出請問,那刻還有號碼? 我低哨昨晚開始的
- **d011**（CER=0.571）Ref: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。 / Raw: 刮号出请问 内刻还有号码 我微不

**Category E — 英文夹杂**

- **d189**（CER=0.429）Ref: 去望京SOHO，不走四环可以吗？那边现在堵不堵？ / Raw: 去望金斯赫布走四环可以吗?那扁现在赌不赌?
- **d009**（CER=0.381）Ref: 去望京SOHO，不走四环可以吗？那边现在堵不堵？ / Raw: 去望金斯赫布走四环,可以吗?那边现在赌不赌?
- **d099**（CER=0.348）Ref: 去望京SOHO，不走机场高速可以吗？那边现在堵不堵？ / Raw: 去望金斯厄布走机场高速可以吗?那边现在赌不赌?

**Category F — 数字/日期/金额相关**

- **d187**（CER=0.871）Ref: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。 / Raw: 市副局仲官村軟件遠走機場告訴 我敢救人
- **d118**（CER=0.708）Ref: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 / Raw: 老是這道題的解題部,周能不能解?
- **d073**（CER=0.667）Ref: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 / Raw: 老是這道題的解題步,周能不能解?

---

## 第四部分 — Confidence Failure Report

> **数据限制：** 批测 JSON **未导出** `segment.words[].probability` 逐 token 值；以下基于运行时落盘的 `fwMetadataSpanGate` 诊断字段。

### 4.1 漏检样本 Gate 统计

| 指标 | 值 |
|------|-----|
| 漏检样本数 | 92 |
| `lowConfidenceWordCount` 均值 | **0** |
| 最小 / 最大 | 0 / 0 |
| `lowConfidenceWordCount > 0` | **0** |
| 推断「全 token ≥0.65」的漏检 | **92**（**100%**） |
| 漏检中 `alignmentFailures > 0` | **50** 条（合计 708 次） |

### 4.2 对比：已触发样本

| 指标 | 值 |
|------|-----|
| 触发样本 `lowConfidenceWordCount` 均值 | **0.9487** |
| 全量 200 条低置信 token 合计 | **37**（35 条样本） |

### 4.3 「明显错误但 probability 逻辑上 >0.65」

- **存在：** 全部 **92** 条漏检在 Gate 侧 **零** 低置信 token。  
- 含义：Whisper 对错误内容 **普遍给出 ≥0.65 的词级概率**；Gate **无法** 区分「自信的错误」。  
- **legacy fallback 未救场：** 72 条存在 alignmentFailures，但 **0** 条 `usedLegacyFallback` — 因 `avg_logprob` 未低于 **-1.0**。

### 4.4 TOP20 高置信错误样本（按 Raw CER 降序，lowConf=0）

| id | CER | 分类 | reference（截断） | raw_asr（截断） |
|----|-----|------|-------------------|-----------------|
| d045 | 0.96 | B | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,學生成為學生 |
| d090 | 0.96 | B | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,選生成立 |
| d135 | 0.96 | B | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,選生成 |
| d180 | 0.96 | B | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,選生成立 |
| d194 | 0.9524 | B | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 請問 這雙鞋也有鞋子嗎? |
| d061 | 0.913 | B | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 周末 |
| d106 | 0.913 | B | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 周末一 |
| d065 | 0.9 | B | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别 | 這次發布我們現對期 |
| d155 | 0.9 | B | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别 | 這次發布我們現對峽谷的發布會 |
| d067 | 0.88 | B | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 您好,我定,您 |
| d178 | 0.88 | B | 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。 | 我們下午討論後 |
| d089 | 0.875 | B | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 这周的事 |
| d134 | 0.875 | B | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 这周的商业节目 |
| d187 | 0.871 | F | 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵 | 市副局仲官村軟件遠走機場告訴 我敢救人 |
| d016 | 0.8696 | B | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 周末要上班了 |
| d116 | 0.8636 | B | 你如何看待跨团队协作？遇到需求变更一般怎么处理？ | 你如何 |
| d006 | 0.8571 | B | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一 | 跟會員系統相關的訊息 |
| d051 | 0.8571 | B | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一 | 跟會員系統相關的訊息 |
| d022 | 0.84 | B | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 您好,我定,但顯示 |
| d060 | 0.84 | B | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 我想对比 |

---

## 第五部分 — Span Length Limitation Report

**当前冻结值：** `minSpanChars=2`, `maxSpanChars=4`, `maxSpans=4`

| 指标 | 值 |
|------|-----|
| 漏检样本错误跨度（首尾 diff 代理）均值 | **19.97** 字 |
| 中位 / P95 | **20** / **20** |
| 错误跨度 **>4 字** | **91** / 92（**98.9%**） |

**解读：**

- 当前 Gate **逐 token** 扫描，且 **单 span ≤4 CJK 字**；  
- 漏检中 **~99%** 的整体错误区段 **超过 4 字** — 即使降低 prob 阈值，**Recall 仍只能对 2–4 字窗做局部替换**；  
- **多 token 分散同音错**（长度相近、非截断）在启发式下归入 **Category C（37 条）**，需要 **>4 字 phrase span** 才可能定位。

**理论覆盖率（仅 span 长度放宽至覆盖 diff 区段，不考虑误修）：**  
若允许 phrase 级 span，`no_spans` 中 CER>0.15 且 errLen>4 约 **91** 条 → 理论 Trigger 约 **130**（自 39，**非去重并集**）。

---

## 第六部分 — Miss Type Distribution Report

（漏检样本内容标签；一条可命中多标签，按 **首要** 统计）

| 类型 | 条数 | 占漏检 |
|------|------|--------|
| 数字/数量 | 58 | 63.0% |
| 技术词 | 30 | 32.6% |
| 普通中文 | 25 | 27.2% |
| 旅游/地名 | 7 | 7.6% |
| 品牌/专名 | 3 | 3.3% |
| 英文 | 3 | 3.3% |

---

## 第七部分 — Coverage Opportunity Report

> 以下为 **理论 upper bound**（假设后续 Recall/Rerank 完美），**非** 承诺 CER 收益；多项 **重叠**，不可简单相加。

| 假设放宽项 | 当前 Trigger | 理论新增（代理） | 理论 Trigger | 依据 |
|------------|-------------|------------------|--------------|------|
| 仅降低 `wordProbabilityThreshold` | 39 | **+0**（漏检侧） | **~39** | 漏检 92 条 Gate 侧 lowConf=0；放宽阈值无法召回已「自信」token |
| 允许 **短语级 span**（>4 字） | 39 | **+91** | **~130** | errLen>4 占漏检 99% |
| **高置信同音扫描**（Category A） | 39 | **+1** | **~40** | 本批仅 **1** 条典型 A |
| **截断检测**（Category B） | 39 | **+37** | **~76** | 37 条截断型漏检 |

---

## 第八部分 — False Positive Risk Report

### 高风险

| 扩大方向 | 原因 |
|----------|------|
| **短语级 span（>4 字）** | 长窗易覆盖 **正确短语**；句级组合 `maxSentenceCandidates=16` 下 **组合爆炸**；KenLM 仍可能 `pickedIsRaw` |
| **激进降低 prob 阈值** | 低 prob ≠ ASR 错；正常口语填充词/噪声也会低 prob → **误修** |
| **截断检测 → 整句重写** | 短 VAD 切分、口语停顿可误判截断；触发后 Recall **无整句能力** |

### 中风险

| 扩大方向 | 原因 |
|----------|------|
| **高置信同音扫描** | 需 `repair_target` 约束；否则近音词 **换错** |
| **英文 token gate** | SOHO 等品牌 ASR 变体多；Recall 候选稀疏 |

### 低风险

| 扩大方向 | 原因 |
|----------|------|
| **alias 扩展** | 本批 alias 信号少但 **精确**；误触面小 |
| **繁简归一（pre-gate）** | d043 已验证；语义不变 |

---

## 第九部分 — TOP50 Detector Miss 案例

| id | reference | raw_asr | CER | 失败分类 | 建议触发类型 |
|----|-----------|---------|-----|----------|--------------|
| d045 | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,學生成為學生 | 0.96 | B | truncation_detector |
| d090 | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,選生成立 | 0.96 | B | truncation_detector |
| d135 | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,選生成 | 0.96 | B | truncation_detector |
| d180 | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 關於後,選生成立 | 0.96 | B | truncation_detector |
| d194 | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 請問 這雙鞋也有鞋子嗎? | 0.9524 | B | truncation_detector |
| d061 | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 周末 | 0.913 | B | truncation_detector |
| d106 | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 周末一 | 0.913 | B | truncation_detector |
| d065 | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。 | 這次發布我們現對期 | 0.9 | B | truncation_detector |
| d155 | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。 | 這次發布我們現對峽谷的發布會 | 0.9 | B | truncation_detector |
| d067 | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 您好,我定,您 | 0.88 | B | truncation_detector |
| d178 | 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。 | 我們下午討論後 | 0.88 | B | truncation_detector |
| d089 | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 这周的事 | 0.875 | B | truncation_detector |
| d134 | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 这周的商业节目 | 0.875 | B | truncation_detector |
| d187 | 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。 | 市副局仲官村軟件遠走機場告訴 我敢救人 | 0.871 | F | numeric_pattern_gate |
| d016 | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 周末要上班了 | 0.8696 | B | truncation_detector |
| d116 | 你如何看待跨团队协作？遇到需求变更一般怎么处理？ | 你如何 | 0.8636 | B | truncation_detector |
| d006 | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 跟會員系統相關的訊息 | 0.8571 | B | truncation_detector |
| d051 | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 跟會員系統相關的訊息 | 0.8571 | B | truncation_detector |
| d022 | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 您好,我定,但顯示 | 0.84 | B | truncation_detector |
| d060 | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 我想对比 | 0.84 | B | truncation_detector |
| d105 | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 我想对比 | 0.84 | B | truncation_detector |
| d150 | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 我想对比 | 0.84 | B | truncation_detector |
| d111 | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 會上提到候選生陳列祿 姚嘉健 | 0.8148 | B | truncation_detector |
| d112 | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 您好,我定单写示意。 | 0.8 | B | truncation_detector |
| d052 | 师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。 | 市府去浦東張江走沿岸路高架 | 0.7667 | B | truncation_detector |
| d014 | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 请问,这双鞋是否有相似的? | 0.7619 | B | truncation_detector |
| d050 | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 | 今天的站會獻過一下訂單 中台進都內存 | 0.7429 | B | truncation_detector |
| d139 | 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ | 李共科互反馈翻译引擎接口爆炸 | 0.7273 | B | truncation_detector |
| d097 | 师傅，去中关村软件园，走四环。我赶九点半的会，要是堵车您提前跟我说。 | 是付去中官村软件远走私环 我敢就 | 0.7241 | B | truncation_detector |
| d163 | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 | 老是這道題的解題部 周能不能 | 0.7083 | B | truncation_detector |
| d118 | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 | 老是這道題的解題部,周能不能解? | 0.7083 | F | numeric_pattern_gate |
| d156 | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 會上提到候選生成列入,要加監控 | 0.6667 | B | truncation_detector |
| d073 | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 | 老是這道題的解題步,周能不能解? | 0.6667 | F | numeric_pattern_gate |
| d196 | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 周末要不要去降邊騎行 天氣預報 | 0.6522 | C | phrase_span (>4 char) |
| d141 | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 跟會員系統相關的需求,我整理了 | 0.6429 | B | truncation_detector |
| d015 | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 我想对比一下,这两款定制器 | 0.64 | B | truncation_detector |
| d195 | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 我想对比一下,这两款电脑 | 0.64 | B | truncation_detector |
| d146 | 挂号处请问内科还有号吗？我低烧，昨晚开始的。 | 括號出請問,那刻還有號碼? 我低哨昨晚開始的 | 0.6316 | C | phrase_span (>4 char) |
| d021 | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 会上提到候选生成炼鹿 要加剑口 | 0.6296 | B | truncation_detector |
| d005 | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 | 今天,德湛会献过一下订单,中台,进都内存 | 0.6286 | B | truncation_detector |
| d011 | 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。 | 刮号出请问 内刻还有号码 我微不 | 0.5714 | C | phrase_span (>4 char) |
| d066 | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 会上提到候选生成链路,要加健康 | 0.5556 | B | truncation_detector |
| d142 | 师傅，去浦东张江，走三环。我赶九点半的会，要是堵车您提前跟我说。 | 市府去浦東張江走三環 我幹 9點半的回藥師杜澄寧提前跟我說 | 0.5556 | F | numeric_pattern_gate |
| d010 | 医生您好，我这两天头痛，想开点药并做个血常规。 | 醫生您好,我這兩天頭痛想開點,要並做個歇常規 | 0.55 | C | phrase_span (>4 char) |
| d100 | 医生您好，我这两天头痛，想开点药并做个血常规。 | 醫生您好,我這兩天頭痛想開店,要病,做隔歇常規 | 0.55 | C | phrase_span (>4 char) |
| d190 | 医生您好，我这两天头痛，想开点药并做个血常规。 | 醫生您好 我這兩天頭痛想開點 要病 做個些常規 | 0.55 | C | phrase_span (>4 char) |
| d184 | 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ | 小乘客互反馈翻译引擎接口包错,我们能不再是 | 0.5455 | F | numeric_pattern_gate |
| d070 | 请简单介绍一下你上一段项目里负责的核心模块和难点。 | 请简单介绍一下 你上一段视频 | 0.5417 | B | truncation_detector |
| d081 | 请问理财产品的风险等级在哪里查看？ | 請問理財產品的風險等急在哪裡查看 | 0.5 | C | phrase_span (>4 char) |
| d055 | 医生您好，我这两天嗓子疼，想开点药并做个血常规。 | 醫生您好我這兩天嗓子疼想開點要並做隔斜常規 | 0.4762 | C | phrase_span (>4 char) |

---

## 第十部分 — 最终结论

### 必答题

1. **Detector 最大漏检来源是什么？** **整句/前缀截断（Category B，37 条，40%）** + **错误跨度超过 4 字 Gate 能力（Category C/F 等）**。根因是 Gate 设计为「Whisper 自知不确定的 2–4 字 CJK token」，而非「参考文本对比」。

2. **高置信同音词占多少？** 启发式 **Category A：1 / 92（1.1%）**；且漏检 **100%** 在 Gate 侧无低置信 token。

3. **截断占多少？** **Category B：37 条（40%）**；另 **26** 条漏检 Raw CER≥0.75 多为极端截断。

4. **短语级错误占多少？** **Category C：37 条（40%）**；另有多条截断/数字类亦超 4 字窗。

5. **当前 probability gate 是否过于保守？** **对漏检而言「过窄」但非「阈值数字 alone」问题：** 漏检侧 **0** 个 token 落在 [threshold, 0.65)；问题是 **错误 token 根本不低 prob**。仅调低 0.65 **不能** 解决 92 条漏检。

6. **当前 span 长度是否限制效果？** **是。** **99%** 漏检错误区段 **>4 字**；与 Recall 音节窗 **[2,5]** 叠加，局部修复模型与错误形态 **不匹配**。

7. **若只能改一处，收益最大？** **在 Detector 层增加「截断/句长异常」信号**（相对纯 prob 阈值）— 本批 **37** 条 B 类 + **26** 条 severe 未触发；比 homophone 扫描（1 条 A）或 prob 微调（+0 条） **ROI 高**。注意：截断类 **误修风险也高**，需与 ASR 前端/VAD 协同，非单点 magic。

8. **收益排序（Detector 域内，理论 Trigger 覆盖）：**

|  rank | 方向 | 理论 Trigger |
|------|------|--------------|
| **TOP1** | 截断/句长异常检测 | ~**76** |
| **TOP2** | 短语级 span（>4 字窗） | ~**130** |
| **TOP3** | 高置信同音扫描 | ~**40**（本批极低） |

9. **哪些改动绝对不要做（在现有架构内）？**

- **仅调低 `wordProbabilityThreshold`**：漏检 **0** 低 conf token，**无数据支撑**；却增加对已触发路径的误修（低 prob 口语词）。  
- **无约束扩大 `maxSpanChars` / phrase 窗**：**误修与 KenLM 组合爆炸**（见第八部分）。  
- **启用 legacy fallback 作为「主 Detector」**：本批 **0** 次触发；依赖 `avg_logprob<-1` + alignment， **不稳定** 且 max **1** span。  
- **回滚 KenLM span gate 指望救 CER**：与 Metadata 冻结方向相反；本批 KenLM **句级** 仍 **38/39 pickedIsRaw**。

---

## 附录

| 项 | 路径 |
|----|------|
| 批测结果 | `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json` |
| Metadata Gate | `main/src/fw-detector/fw-metadata-span-gate.ts` |
| Orchestrator | `main/src/fw-detector/fw-detector-orchestrator.ts` |
| 默认配置 | `main/src/node-config-defaults.ts` |
| 上轮全链审计 | `docs/lexicon-v3/FW_Quality_Pipeline_Audit_2026_06_02.md` |

**审计确认：** 未修改 Detector 源码、配置、阈值、Span 规则；未提交 Patch。