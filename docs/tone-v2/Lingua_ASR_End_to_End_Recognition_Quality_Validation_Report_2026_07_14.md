# Lingua ASR End-to-End Recognition Quality Validation Report

**Date:** 2026-07-14  
**Run ID:** `asr_e2e_20260714_crnn_v3`  
**Verdict:** **C — Recall Coverage Is the Main Bottleneck**  
**Evidence JSON:** `tmp/asr_e2e_quality_validation/asr_e2e_20260714_crnn_v3/asr_e2e_quality_validation.json`  
**Orchestrator:** `electron_node/electron-node/tests/experiments/run-asr-e2e-quality-validation.mjs`

---

## Executive Summary

在**冻结**的 ASR 修复架构下，使用 **CRNN V3 Full**（`tone_crnn_v3_full_candidate_20260713.npz` · offline val_acc **83.56%**）对 **dialog_200 全量 200 条**执行 Node 音频入口 A/B/C 三组验收：

| Variant | 链路 | Mean CER | Exact Match |
|---------|------|--------:|------------:|
| **A** | FW Raw（`use_lexicon=false`） | **22.95%** | 25/200 (12.5%) |
| **B** | Repair Without Tone | **21.65%** | 25/200 (12.5%) |
| **C** | Full Repair + CRNN Tone | **26.68%** | 24/200 (12.0%) |

**核心结论：**

1. **无 Tone 修复链（B）相对 FW Raw（A）有小幅收益**（CER **−1.30 pp**）— Lexicon / Span / Domain Vote / 临时 KenLM 整体有效。
2. **开启 Tone（C）相对 B 净退化**（CER **+5.03 pp**；34 改善 vs **42 退化**）— 离线 83.56% 未能转化为 E2E 文本收益。
3. **主瓶颈为 Recall Coverage**（Variant C 分层：**85%** 样本正确候选未进入 TopK）— **不是**当前临时 KenLM（仅 **3%** KenLM 选错层）。
4. **KenLM 标记为 Temporary Baseline**；本轮结果作为未来扩大训练集后的比较基线。

**下一步建议：** 优先 **Recall Coverage / Label Strategy** 审计 — **非**立即 KenLM 重训。

---

## 一、测试对象与冻结范围

### 1.1 完整链路（Variant C）

```text
Node 音频入口 (:5020 /run-pipeline-with-audio)
  → 分割 / 聚合
  → Faster-Whisper (:6007)
  → FW WordInfo Timestamp
  → Tone CRNN V3 (numpy_crnn_v1)
  → Pinyin / Tone Recall
  → 细 Span 候选
  → 全句 Domain Vote
  → 同 Domain + Base 候选组句
  → Temporary KenLM (zh_char_3gram)
  → Final ASR Output
```

### 1.2 冻结项（本轮零修改）

FW · Node · VAD · WordInfo · Tone Feature/Runtime · Recall · Span · Domain Vote · Lexicon · Candidate 数量/分数 · TonePenalty · KenLM 模型/权重/Gate · NMT · expectedText

### 1.3 运行完整性

| 项 | 状态 |
|----|------|
| 语料 | dialog_200 **200/200** 完成（无 time_limit） |
| 代码版本 | 当前工作区 Electron Node + FW |
| run_id | `asr_e2e_20260714_crnn_v3` |
| 服务重启 mid-run | **无** |
| Artifact 切换 mid-run | **无** |

**方法学限制（须记录）：** A/B/C 为三次独立 pipeline 调用（不同 `session_id`）。FW ASR 输出在部分 case 上存在**跨调用差异**（例：d001 A/B raw=`中貝` vs C raw=`鐘貝`）。聚合指标仍有效，但 B↔C 微观对比受 FW 随机性噪声影响。

---

## 二、Tone 模型验收（CRNN V3）

| 检查项 | 结果 |
|--------|------|
| Artifact 路径 | `tone_module/models/candidate/tone_crnn_v3_full_candidate_20260713.npz` |
| `TONE_MODEL_PATH`（FW 启动前） | 同上 ✅ |
| `trainingVersion` | `crnn_v3_full_candidate_20260713` ✅ |
| `modelArchitecture` | `conv1d_bigru_v1` ✅ |
| `backend` | `numpy_crnn_v1` ✅ |
| `featureVersion` | `p1-frame-mel-f0-v1` ✅ |
| Loader probe | `loaderReady: true` ✅ |
| Variant C `toneEnabled` | **200/200** ✅ |
| Tone slices（C 合计） | **4,081** |
| Tone exact hits（C 合计） | **494** |
| Promotion | **否** — 仅质量验收 |

**注：** 单条 diagnostics 中 `artifactPath` 未下沉至 spanAssembly trace（`null`）；以启动前 `TONE_MODEL_PATH` + Python probe + `toneEnabled=true` 为验收依据。

---

## 三、KenLM 状态声明

```text
Temporary KenLM Baseline
```

- 模型：`electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin`
- 训练集有限 · **非**最终 Production KenLM
- 本轮：**无**重训 · **无** n-gram / vocab / weight 修改
- 本轮结果 = 未来 KenLM 扩大语料后的**正式比较基线**

---

## 四、三 Variant 定义

| Variant | 实现 | 记录字段 |
|---------|------|----------|
| **A — FW Raw** | `use_lexicon: false` | `fwRawText` / `text_asr` |
| **B — Repair Without Tone** | `use_lexicon: true` + `toneTimestampOnlyEnabled=false` | `finalWithoutTone` |
| **C — Full Repair With Tone** | `use_lexicon: true` + `toneTimestampOnlyEnabled=true` | `finalWithTone` |

---

## 五、文本归一化（A/B/C 共用）

| 规则 | 说明 |
|------|------|
| 标点 | 去除中英文标点 |
| 空格 | 去除 |
| 大小写 | `toLowerCase()` |
| 繁简 | 未统一转换；`臺→台` |
| 主指标 | **CER**（Levenshtein / ref 长度） |
| 辅指标 | WER（字符级切分，与 CER 等价口径） |

原始文本与归一化文本均保留于 JSON `cases[].*.expectedText` / `normalized`。

---

## 六、核心质量指标总表

| 指标 | FW Raw (A) | Repair w/o Tone (B) | Full w/ Tone (C) | B−A | C−B | C−A |
|------|----------:|--------------------:|-----------------:|----:|----:|----:|
| **CER (mean)** | 22.95% | **21.65%** | 26.68% | **−1.30 pp** | **+5.03 pp** | +3.73 pp |
| **WER (mean)** | 22.95% | 21.65% | 26.68% | −1.30 pp | +5.03 pp | +3.73 pp |
| **Exact Sentence Match** | 12.5% (25) | 12.5% (25) | 12.0% (24) | 0 | −1 | −1 |
| **Improved sentences** | — | 39 vs A | 34 vs B | — | — | 35 vs A |
| **Regressed sentences** | — | 30 vs A | 42 vs B | — | — | 31 vs A |
| **Unchanged (A→B)** | — | 131 | — | — | — | — |
| **Mean latency (ms)** | 3,645 | 3,576 | 3,654 | −69 | +78 | +9 |

### 6.1 句级修复率

| 比较 | Improved | Regressed | Unchanged |
|------|----------:|----------:|----------:|
| A → B | 39 | 30 | 131 |
| B → C | 34 | **42** | 124 |
| A → C | 35 | 31 | — |

**Repair Success Rate (A→B)：** 39/200 = **19.5%**  
**Repair Regression Rate (A→B)：** 30/200 = **15.0%**

---

## 七、三组核心比较

### Comparison 1：FW Raw vs Repair Without Tone

> 词库 + Span + Domain Vote + 临时 KenLM 对 FW 的总体修复能力

- Mean CER：**22.95% → 21.65%（−1.30 pp）**
- 39 条改善 · 30 条退化 · 131 条不变
- **裁决：修复链有效，但幅度有限**（exact match 未提升）

### Comparison 2：Repair Without Tone vs Full Repair With Tone

> Tone 对完整链路的独立增量

- Mean CER：**21.65% → 26.68%（+5.03 pp）**
- Tone 改善 34 条 · **退化 42 条**
- Tone exact hits 合计 494 · slices 4,081
- **裁决：Tone 在线后验未能转化为净 E2E 收益；部分场景显著退化**

### Comparison 3：FW Raw vs Full Repair With Tone

> 完整主链相对原始 FW 的最终总收益

- Mean CER：**22.95% → 26.68%（+3.73 pp）**
- **裁决：含 Tone 的完整链当前劣于 FW Raw**

---

## 八、Domain 与专业词质量

### 8.1 场景级 Mean CER（fixture `scenario` 标签）

| Scenario | n | A | B | C | Tone Δ (C−B) |
|----------|--:|--:|--:|--:|-------------:|
| cafe | 15 | 22.3% | 19.9% | **19.4%** | −0.5 pp ✅ |
| lexicon_homophone | 12 | 43.7% | 35.6% | 38.3% | +2.7 pp |
| restaurant | 12 | 28.5% | 26.7% | 26.4% | −0.3 pp |
| hotel | 12 | 7.8% | 7.8% | 7.8% | 0 |
| **shopping** | 15 | 17.5% | 14.1% | **73.8%** | **+59.7 pp** ⚠️ |
| hospital | 15 | 31.3% | 27.4% | 31.6% | +4.2 pp |
| taxi | 15 | 34.2% | 33.3% | 32.9% | −0.4 pp |

### 8.2 Domain Keyword Accuracy（manifest 启发式专业词命中）

| 指标 | FW Raw | Without Tone | With Tone |
|------|-------:|-------------:|----------:|
| 专业词出现总数 | 82 | 82 | 82 |
| 命中数 | 31 | 29 | 29 |
| 命中率 | 37.8% | 35.4% | 35.4% |
| Tone 新增修复 | — | — | **0** |
| Tone 导致退化 | — | — | **0**（计数级） |

**重点：** Tone 未提高 fixture 级专业词命中率；`shopping` 场景 Tone 灾难性退化需单独归因（Recall / Domain Vote / KenLM 组合）。

---

## 九、Span 与 Recall 指标（B vs C 聚合）

| 指标 | Without Tone (B) | With Tone (C) |
|------|-----------------:|--------------:|
| cases `toneEnabled` | 0/200 | **200/200** |
| total tone slices | — | **4,081** |
| tone exact hits | 0 | **494** |
| tone compatible (sum) | 0 | **>0**（per-case 累加） |
| recall fallback (sum) | 0 | **>0** |

**回答：** Tone **提高了 Recall 侧声学命中统计**（exact hits 494），但 **未提高** 最终专业词命中率或整体 CER — 瓶颈在 **候选未进入可被选中的句子级 TopK**（见 KenLM 分层）。

---

## 十、KenLM 分层分析（Variant C · 200 条）

| 层 | 含义 | 数量 | 占比 |
|----|------|-----:|-----:|
| **A** | Recall Success + KenLM Success | 0 | 0% |
| **B** | Recall Success + KenLM Failure | 6 | **3.0%** |
| **C** | Recall Failure（正确候选未入 TopK） | 170 | **85.0%** |
| **D** | Raw Already Correct | 24 | 12.0% |

**裁决：**

- **KenLM 不是主瓶颈**（B 层仅 3%）
- **Recall Coverage 是主瓶颈**（C 层 85%）
- 不满足「先重训 KenLM」的充分条件；满足「Recall 失败不得归因 KenLM」

**Tone 相关观察：** 494 次 tone exact hit 存在，但 **0** 条达到「Recall Success + KenLM Success」— 声学 Tone 信息未穿透到 KenLM 正确选句。

---

## 十一、Tone 独立价值

| 指标 | 值 |
|------|-----|
| TonePosterior present（C） | 200/200 |
| toneEnabled（C） | 200/200 |
| Tone 导致 final 改善（B→C） | 34 |
| Tone 导致 final 退化（B→C） | **42** |
| Tone 无影响（B→C） | 124 |
| KenLM Top1 改变 | 见 JSON per-case `kenlm.candidates` |
| **净 E2E CER 效应** | **+5.03 pp（负向）** |

**回答：** 在当前临时 KenLM 下，Tone 信息 **大部分未转化为最终文本收益**；声学层有信号，句子层无净收益。

---

## 十二、代表样本分析（20 Case）

| ID | 类型 | Expected (摘要) | A CER | B CER | C CER | Error Ownership |
|----|------|-----------------|------:|------:|------:|-----------------|
| d001 | cafe 标杆 | 热拿铁/中杯/蓝莓马芬 | 0.407 | 0.407 | 0.444 | FW + Recall |
| d002 | raw 已接近 | 美式大杯 | 0.059 | 0.059 | 0.059 | No Error |
| d034 | B 修对 C 退化 | — | 0.267 | **0.000** | 0.267 | Tone |
| d036 | B 修对 C 部分退化 | — | 0.438 | **0.063** | 0.250 | Tone + KenLM |
| d044 | Tone 改善 | — | 0.500 | 0.208 | **0.125** | Tone（正面） |
| d075 | Tone 改善 | — | 0.263 | 0.368 | **0.158** | Tone（正面） |
| d117 | Tone 大幅改善 | — | 0.391 | 0.391 | **0.087** | Tone（正面） |
| d007 | Tone 退化 | — | 0.548 | 0.484 | **0.548** | Tone |
| d045 | 高 CER 全链失败 | — | 0.960 | 0.400 | 0.560 | FW + Recall |
| d143 | Tone 改善 | — | 0.233 | 0.367 | **0.133** | Tone（正面） |
| d160 | B 恶化 C 恢复 | — | 0.208 | 0.417 | **0.208** | Tone |
| d180 | shopping 退化 | — | — | — | **高 CER** | Multiple |
| d193 | homophone | — | 0.050 | 0.050 | 0.050 | FW |
| d195 | Tone 轻微改善 | — | 0.280 | 0.320 | **0.240** | Tone |
| d198 | exact 全链 | — | **0.000** | **0.000** | **0.000** | No Error |
| d001 | KenLM 层 C | 候选含「以北/焙烧」非 expected | 0.407 | 0.407 | 0.444 | Recall |
| d034 | raw correct broken | B exact → C 坏 | 0.267 | 0.000 | 0.267 | Tone |
| d011 | Tone 退化 | — | 0.571 | 0.381 | 0.476 | Tone |
| d133 | cafe tone-sensitive | — | 0.680 | 0.640 | **0.560** | Tone（正面） |
| d192 | 全链失败 | — | 0.333 | 0.292 | 0.292 | Recall |

完整字段（Spans · Posterior · Candidates · KenLM scores）见 JSON `cases[]`。

---

## 十三、性能统计

| 阶段 | Without Tone (B) | With Tone (C) | Δ |
|------|-----------------:|--------------:|--:|
| Mean pipeline | 3,576 ms | 3,654 ms | +78 ms |
| FW detector step（均值） | ~1,300–1,500 ms | 同左 | — |
| Tone 增量 | — | **<100 ms 级（pipeline 级）** | 可接受 |

**注：** 本轮仅记录，不做性能优化。

---

## 十四、必须回答的 15 问

| # | 问题 | 回答 |
|---|------|------|
| 1 | 完整修复链是否显著优于 FW Raw？ | **否（含 Tone 的 C 劣于 A +3.73 pp）；无 Tone 的 B 优于 A −1.30 pp** |
| 2 | B 相对 A 提升多少？ | **CER −1.30 pp**；39 条句级改善 |
| 3 | Tone 相对 B 提升多少？ | **CER +5.03 pp（退化）** |
| 4 | Tone 是否显著提高专业词 Recall@K？ | **否**（keyword 命中率 35.4% 持平；分层 C 占 85%） |
| 5 | Tone 是否提高细分 Domain 词命中？ | **混合**（cafe −0.5 pp；shopping **+59.7 pp** 退化） |
| 6 | Tone 是否降低 CER？ | **否** |
| 7 | Tone 是否增加退化？ | **是**（42 vs 34 改善） |
| 8 | 主失败点在 Recall 还是 KenLM？ | **Recall（85%）** |
| 9 | 正确候选在 TopK 但 KenLM 选错比例？ | **3%** |
| 10 | 临时 KenLM 是否主瓶颈？ | **否** |
| 11 | KenLM 重训是否具明确必要性？ | **本轮否** — Recall 未解决前重训 ROI 低 |
| 12 | KenLM 训练集应覆盖哪些错误？ | B 层 6 条 + 未来 Tone 已召回但 KenLM 压制类（暂少） |
| 13 | Tone CRNN 是否完成业务职责？ | **未完成** — 离线 83.56% 未转化为 E2E 净收益 |
| 14 | 是否可停止优化 Tone？ | **是**（见 Final Freeze — 进入 Maintenance） |
| 15 | 下一步是否 KenLM Dataset Audit？ | **否（优先）** — 优先 **Recall Coverage / Label Strategy** |

---

## 十五、KenLM 后续判断

### 不建议本轮进入 KenLM 重训

依据：

- Recall Failure 层 **85%** — 正确候选多数未产生
- KenLM Failure 仅 **3%**
- Tone 提高声学 Recall 统计但 **CER 反向恶化**

### 建议下一步

```text
Recall Coverage & Label Strategy Audit
（与 Tone Recognition Ceiling Audit 结论一致：Label > Recall > KenLM）
```

**条件触发 KenLM 审计（未来）：** 当 Recall Success 层（A+B）占比 **>50%** 且 KenLM Failure 层持续 **>15%** 时。

---

## 十六、Final Verdict

## **C — Recall Coverage Is the Main Bottleneck**

| 子项 | 结论 |
|------|------|
| 修复链（无 Tone） | **有效但有限**（−1.30 pp CER） |
| Tone CRNN V3 E2E | **净负向**（+5.03 pp vs B） |
| KenLM | **非主瓶颈**（Temporary Baseline 记录备查） |
| 正式基线 | 本 run JSON 归档，供未来 KenLM 扩训对比 |

---

## 附录

| 资源 | 路径 |
|------|------|
| 原始结果 | `tmp/asr_e2e_quality_validation/asr_e2e_20260714_crnn_v3/asr_e2e_quality_validation.json` |
| Case studies | `tmp/asr_e2e_quality_validation/asr_e2e_20260714_crnn_v3/case_studies.json` |
| 编排脚本 | `electron_node/electron-node/tests/experiments/run-asr-e2e-quality-validation.mjs` |
| 报告生成 | `electron_node/electron-node/tests/experiments/generate-asr-e2e-quality-report.mjs` |
| Tone 上限审计 | `docs/tone-v2/Tone_Model_V3_Recognition_Ceiling_Audit_2026_07_13.md` |
| 语料 | `test wav/dialog_200/cases.manifest.json` |

---

**Signed:** End-to-End ASR Quality Validation complete · **200/200 dialog_200** · CRNN V3 · Frozen architecture · **No code changes this round.**
