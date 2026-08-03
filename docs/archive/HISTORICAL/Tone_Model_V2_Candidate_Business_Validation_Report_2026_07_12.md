<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_Model_V2_Candidate_Business_Validation_Report_2026_07_12.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone Model V2 Candidate — Business Validation Report

**日期：** 2026-07-12  
**类型：** Production CNN V2 Candidate Business Validation  
**Run ID：** `run_20260712_v2_candidate`  
**Verdict：** **B — 离线提升明显；Business 收益有限或混合；保留 P9-A 为 Business Baseline；进入 CRNN**

---

## 1. Executive Summary

本轮在 **仅替换 `TONE_MODEL_PATH`** 为 V2 Candidate 的前提下，复用 Phase 1.5 同一 `dialog_200` + 27 tone-sensitive A/B fixture，与冻结 Baseline（Phase 1.5 `run_20260712_rerun`）对比。

| 维度 | 结果 |
|------|------|
| Candidate Artifact | `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\candidate\tone_cnn_production_v2_candidate_20260712.npz` |
| `trainingVersion` | `production_cnn_v2_candidate_20260712` |
| `modelArchitecture` | `conv1d_production_v2` |
| 离线 val_acc | **0.8248** |
| dialog_200 成功 | **200/200** |
| `model_error` | **0** |
| Runtime 兼容 | ✅ Loader / numpy_p1 / validate PASS |

---

## 2. 部署确认（仅 TONE_MODEL_PATH）

| 字段 | Candidate |
|------|-----------|
| `artifactPath` | `tone_cnn_production_v2_candidate_20260712.npz` |
| `trainingVersion` | `production_cnn_v2_candidate_20260712` |
| `modelArchitecture` | `conv1d_production_v2` |
| `featureVersion` | `p1-frame-mel-f0-v1` |
| `backend` | `numpy_p1` |
| `loaderReady` | `True` |

**未修改：** FW / Node Runtime / Feature / Recall / KenLM / Lexicon / Domain。

---

## 3. Baseline vs V2 Candidate 对比

| 指标 | Baseline (P9-A) | V2 Candidate | Δ |
|------|----------------:|-------------:|--:|
| tone exact hit rate（case 级） | 89.5% | 91.0% | +1.5 pp |
| candidate rerank rate | 24.5% | 23.5% | -1.0 pp |
| final changed rate（A/B 27） | 44.4% | 44.4% | +0.0 pp |
| improvement vs expected（A/B） | 18.5% | 18.5% | +0.0 pp |
| regression vs expected（A/B） | 14.8% | 11.1% | -3.7 pp |
| no effect（A/B final 相同） | 55.6% | 55.6% | -0.0 pp |
| exact match（dialog_200） | 14.0% | 14.0% | +0.0 pp |
| mean CER | 0.219 | 0.220 | +0.09 pp |
| low-margin posterior rate（A/B 27） | 16.7% | **44.4%** | +27.7 pp |
| KenLM top1 变化（A/B） | 70.4% | 63.0% | -7.4 pp |
| sentence correct（exact match） | 28/200 | **28/200** | 0 |

**解读：** V2 在声学层（tone exact hit、A/B regression 减少）有可见改善，但 **端到端 exact match / mean CER 与 Baseline 持平**；posterior 低置信 slice 比例上升，说明更大模型在业务域上更「犹豫」，尚未转化为最终文本收益。

---

## 4. Runtime / Tone / Candidate 统计（Candidate）

### 4.1 Runtime

| 指标 | Baseline | Candidate | Δ |
|------|----------|-----------|---|
| `toneEnabled` rate | 100% | **100%** | 0 |
| `skippedReason` | `{ null: 200 }` | `{ null: 200 }` | — |
| posterior finite / `model_error` | 0 | **0** | 0 |
| mean pipeline latency | 4837 ms | **4739 ms** | -98 ms |
| p50 / p95 pipeline | 4340 / 7230 ms | **4181 / 8451 ms** | — |
| mean FW detector step | 1325 ms | **1310 ms** | -15 ms |

### 4.2 Tone

| 指标 | Baseline | Candidate | Δ |
|------|----------|-----------|---|
| tone pattern hit（累计） | 10,515 | **10,515** | 0 |
| tone exact hit（累计） | 566 | **532** | -34 |
| tone exact hit rate（case 级） | 89.5% | **91.0%** | +1.5 pp |
| recall 活动 case | 200/200 | **200/200** | — |
| low-margin posterior（A/B） | 16.7% | **44.4%** | +27.7 pp |

### 4.3 Candidate / Final

| 指标 | Baseline | Candidate | Δ |
|------|----------|-----------|---|
| candidate rerank rate | 24.5% | **23.5%** | -1.0 pp |
| A/B final changed | 12/27 | **12/27** | 0 |
| A/B improvement vs expected | 5/27 | **5/27** | 0 |
| A/B regression vs expected | 4/27 | **3/27** | **-1** |
| A/B no effect | 15/27 | **15/27** | 0 |
| exact match（dialog_200） | 14.0% | **14.0%** | 0 |
| mean CER | 0.219 | **0.220** | +0.001 |

---

## 5. Performance

| 指标 | Baseline | Candidate | Δ |
|------|----------|-----------|---|
| mean pipeline ms | 4837 | 4739 | -98 ms |
| mean FW detector ms | 1325 | 1310 | -15 ms |

Production CNN V2 参数量更大，但 batch 侧 Tone 推理仍在可接受范围（无 `model_error`、无超时风暴）。

---

## 6. Compatibility

- ✅ `ToneModelLoaderV1` ready
- ✅ `numpy_p1` 推理
- ✅ `validate_artifact_v1` PASS
- ✅ 无 Shadow / Fallback / 自动切回 Baseline
- ✅ Diagnostics 可观测 `trainingVersion` / `modelArchitecture`

---

## 7. Representative Cases（10）

链路：**Raw ASR → Posterior → Tone Pattern → Recall → Candidate → KenLM → Final**  
对照：Baseline 数据来自 Phase 1.5 `run_20260712_rerun`；Candidate 来自本轮 `run_20260712_v2_candidate`。

### Case 1 — d045：Improvement（A/B Tone ON 更贴近 expected）

| 阶段 | Baseline (P9-A) | V2 Candidate |
|------|-----------------|--------------|
| Raw ASR | `關於後,選生成為 和上限计划...` | 同链路 |
| Posterior | 高 conf 为主 | 高 conf（例 t4 conf≈0.98） |
| A final / B final | A CER **0.44** &lt; B 0.52 | **同分类：improvement**（A CER 0.40 &lt; B 0.48） |
| 结论 | Tone ON 改善 | **保持改善** |

### Case 2 — d179：Improvement（低 margin + KenLM rerank）

| 阶段 | Baseline | Candidate |
|------|----------|-----------|
| Raw ASR | `這周的上限計劃意境...` | 同左 |
| Posterior | 部分 conf≈0.52 | 仍有多 slice 低 margin |
| A vs B CER | 0.458 vs 0.375（退化） | **0.292 vs 0.333（improvement）** |
| 结论 | Baseline 上 Tone ON 退化 | **Candidate 上转为改善** |

### Case 3 — d091：Improvement

| 阶段 | Candidate |
|------|-----------|
| A/B | final 变化；A CER **0.308** &lt; B 0.346 |
| 分类 | improvement（与 Baseline 同类 fixture 一致） |

### Case 4 — d093：Improvement

| 阶段 | Candidate |
|------|-----------|
| A/B | A CER **0.222** &lt; B 0.278 |
| 分类 | improvement |

### Case 5 — d135：Improvement

| 阶段 | Candidate |
|------|-----------|
| A/B | A CER **0.56** &lt; B 0.68 |
| 分类 | improvement |

### Case 6 — d043：Regression（Tone ON 仍劣于 OFF）

| 阶段 | Baseline | Candidate |
|------|----------|-----------|
| KenLM top1 (A) | `...方安线吧。 文章不齐` | 同左 |
| KenLM top1 (B) | `...方案线吧! 文章不齐` | 同左 |
| CER vs expected | A **0.48** &gt; B 0.44 | A **0.44** &gt; B **0.40** |
| 结论 | 退化 | **仍为退化**（V2 posterior 更自信但未扭转 KenLM 路径） |

### Case 7 — d048：Regression

| 阶段 | Baseline | Candidate |
|------|----------|-----------|
| Final 差异 | `小呗` vs `小杯` | 同 homophone 分叉 |
| CER | A 0.211 &gt; B 0.158 | A 0.105 &gt; B **0.053** |
| 结论 | Tone ON 选错同音字 | **仍为退化** |

### Case 8 — d090：Regression

| 阶段 | Candidate |
|------|-----------|
| A/B CER | A 0.60 &gt; B 0.36 |
| 结论 | 简繁/用词：Tone OFF 更贴近 expected |

### Case 9 — d001：No Effect（ASR 错误非 Tone 可修）

| 阶段 | Baseline | Candidate |
|------|----------|-----------|
| Raw ASR | `...中貝少糖...蓝没马分` | 同左 |
| tone exact | 0 | **1**（V2 有零星 exact） |
| Final | 同 Raw | 同 Raw |
| A/B | 无 final 变化 | 无 final 变化 |
| 结论 | Posterior 正常但 lookup 不足 | **略有 exact 但仍无 downstream 修复** |

### Case 10 — d047：No Effect（cafe，A/B 完全相同）

| 阶段 | Baseline | Candidate |
|------|----------|-----------|
| Scenario | cafe | cafe |
| A/B final | 完全相同 | 完全相同 |
| 结论 | Posterior 存在但无分叉 | **同 Baseline** |

---

## 8. Promotion Decision

- 离线 val_acc **82.48%** — **未达 ≈90% Promotion 门槛**
- Business：**tone exact +1.5 pp、regression -1 case**，但 **exact match / CER 无净改善**
- Runtime：**完全兼容**，无 `model_error`，延迟略优
- **不得 Promotion 为 Production**；**不得替换 Phase 1.5 Business Baseline**
- **Verdict B**

---

## 9. 下一阶段五问

| # | 问题 | 答复 |
|---|------|------|
| 1 | Business 收益是否与离线 82.48% 一致？ | tone exact hit +1.5 pp；端到端 CER/exact +0.1 pp / +0.0 pp — **部分一致（声学层提升 ≠ 最终文本线性提升）** |
| 2 | 是否明显优于 Tiny CNN？ | **是（离线 +11 pp；Business tone exact +1.5 pp）** |
| 3 | 是否作为新 Business Baseline？ | **否 — 保留 P9-A Production Baseline 为 Business 对照** |
| 4 | 是否进入 CRNN？ | **是** — 离线未达 90%，按冻结方案 Phase E |
| 5 | CRNN 阶段是否保留当前 CNN 为对照？ | **是** — `tone_cnn_production_v2_candidate_20260712.npz` 作为 CNN 臂对照 |

---

## 10. Final Verdict

**B — 离线提升明显；Business 收益有限或混合；保留 P9-A 为 Business Baseline；进入 CRNN**

---

*Raw data: `tmp/tone_v2_candidate_business_validation/run_20260712_v2_candidate/`*

| 文件 | 说明 |
|------|------|
| `v2_candidate_report.json` | 汇总指标 + 对比 |
| `dialog200_batch.json` | 200 case 全量 |
| `business_effect_audit.json` | 27 fixture A/B |
| `deployment.json` | Artifact probe + FW health |

*Report generated: 2026-07-12 · Run `run_20260712_v2_candidate`*
