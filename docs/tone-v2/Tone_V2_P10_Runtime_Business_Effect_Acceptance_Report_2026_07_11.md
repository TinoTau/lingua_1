# Tone V2 P10 — Runtime Business Effect Acceptance Report

**Date:** 2026-07-11  
**Phase:** P10 Runtime Business Effect Acceptance Audit（只读审计）  
**Scope:** 验证 `TonePosterior → … → FinalCandidate` 业务传播；非 Runtime 开发 / 非 Feature 审计  
**采集输出:** `tmp/tone_p10_business_acceptance/`  
**审计脚本:** `electron_node/electron-node/tests/experiments/tone_p10_business_effect_acceptance_audit.mjs`  
**多段 VAD:** `electron_node/electron-node/tests/experiments/tone_p10_multi_segment_vad_audit.mjs`  
**Batch 审计:** `electron_node/services/faster_whisper_vad/scripts/tone_p10_batch_inference_audit.py`

---

## 1. Executive Summary

本轮在 **P1 Full Runtime 已切换** 前提下，对 tone-sensitive fixtures 执行 A/B 反事实（真实 Posterior vs Tone Disabled）、切片传播审计、Batch 推理确认、多段 VAD 补测，并尝试 C/D 离线反事实。

| 维度 | 结论 |
|------|------|
| Tone 是否传播到 Final Candidate | **是（有条件）** — d043 A/B 证明；d001 cafe 无变化 |
| 第一处信息丢失（主路径） | **Node ASR 音频路径** → `utterance_tone` 切片少于 FW；Recall 实际消费 `ctx.acousticToneSlices`（多于 `utterance_tone`） |
| ToneLookup 是否生效（cafe） | **否** — d001 `toneExactHitCount=0`，`recallToneCompatibleCount=0` |
| KenLM 是否覆盖 Tone | **部分** — KenLM 不读 tone 字段，但在 d043 中 tone 改变了进入 KenLM 的 span 组合 |
| Smoke Artifact | **`p10_structural_smoke`** — 非生产质量 |
| HTTP 级 C/D 反事实 | **未接线** — `run-lexicon-mock` 的 `disableTone`/`uniformTonePosterior` 仍被忽略 |

### Final Verdict: **D**

> **Runtime 正常。Smoke 结构完成。等待 Production Model 重训。**

**唯一阻塞业务效果验收的位置：** 当前 **Smoke 权重不具备业务语义**（d043 中 Tone ON 反而选出错误 homophone「岸线/安线」，Tone OFF 得「方案线」）；在 Production Model 到位前，无法完成业务质量验收。结构传播已在 d043 证明，但 cafe homophone（d001）在 **ToneLookup** 层无 `tone_exact` 命中，需真实 Posterior 后再评估 Recall/Penalty 是否需调参。

---

## 2. 规格十问

| # | 问题 | 答案 |
|---|------|------|
| 1 | Tone 是否真正影响 Candidate？ | **部分** — d043 影响 KenLM 输入候选；d001 有 pattern 但 `recallToneCompatible=0` |
| 2 | Tone 是否真正影响 Final Candidate？ | **是（已观测）** — d043：A(toned)=「呈方安线」 vs B(disabled)=「呈方案线」 |
| 3 | 信息第一次消失在哪一层？ | **分 fixture：** d001 → **ToneLookup**（pattern 有，exact=0）；切片链 → **Node ASR 路径**（FW 24 → Node words 19 → `utterance_tone` 12） |
| 4 | Node 是否消费全部 AcousticToneSlice？ | **否（报告层）** — `extra.utterance_tone` 仅反映 `ctx.asrResult.tone`（首批/ASR 返回），**不等于** Recall 输入；Recall 用 `ctx.acousticToneSlices`（d001: 19） |
| 5 | TonePenalty 是否足够？ | **不足以区分 homophone** — mismatch penalty=0.8 过弱；d001 无 penalty 触发样本 |
| 6 | KenLM 是否覆盖 Tone？ | **间接覆盖** — KenLM 无 tone 字段；d043 中 tone 改变 span 替换后 KenLM top1 随之改变 |
| 7 | 应调模型 / Penalty / Ranking / KenLM？ | **优先重训 Production Model**；Penalty/Ranking 在真实 Posterior 后再评估 |
| 8 | Smoke Artifact 是否足够结构验收？ | **是** |
| 9 | 是否可完成业务验收？ | **否** — smoke 权重 + 切片损耗 |
| 10 | 下一步重训还是调 Recall？ | **重训** |

---

## 3. Tone Influence Trace（代表性 fixtures）

### 3.1 d001（cafe homophone）— Tone 未改变 Final

| 阶段 | Variant A（真实 Posterior） | Variant B（Tone Disabled） |
|------|----------------------------|---------------------------|
| ToneEnabled | `true` | `false` (`tone_timestamp_disabled`) |
| Posterior / Slices | 12 slices in `utterance_tone` | 0（tone skipped） |
| TonePattern | `ngramTonePatternHitCount=52` | 0 |
| ToneLookup | `toneExactHitCount=0`, `plainFallbackHitCount=5` | 0 |
| TonePenalty 触发 | 无（`recallToneCompatibleCount=0`） | N/A |
| Ranking Top1 | 无 trace 级 pre-filter 输出 | 同左 |
| KenLM Top1 | 「…中焙烧糖…」 | 同左 |
| Final Candidate | 不变 | 不变 |

**第一处丢失：** Posterior 有 → Pattern 有（52 hits）→ **Lookup 无 exact 命中** → Penalty 未触发 → Final 不变。

### 3.2 d043（lexicon_homophone）— Tone 改变 Final

| 阶段 | Variant A（真实 Posterior） | Variant B（Tone Disabled） |
|------|----------------------------|---------------------------|
| ToneEnabled | `true` | `false` |
| Posterior / Slices | 13 (`utterance_tone`) / 21 (Recall diag) | 0 |
| TonePattern | `ngramHit=57`, `overlapHit=57` | 0 |
| ToneLookup | `toneExact=4`, `recallToneCompatible=9` | 0 |
| KenLM Top1 | 「…呈方**岸线**…」 | 「…呈方**案线**…」 |
| Final Candidate | 「…呈方**安线**…」 | 「…呈方**案线**…」 |
| appliedCount | 2 | 3 |

**传播路径已打通：** Posterior → Pattern → Lookup(exact) → Span 替换 → KenLM → Final。  
**业务方向错误：** Smoke Posterior 使 Tone ON 选出错误 homophone（安/岸），Tone OFF 反而正确——属 **模型质量** 问题，非 Recall 断链。

---

## 4. Counterfactual Matrix（A/B/C/D）

| Variant | 机制 | 状态 | d001 | d043 |
|---------|------|------|------|------|
| **A** 真实 Posterior | `toneTimestampOnlyEnabled=true` + 真实 Runtime | ✅ 已跑 | Final 不变 | Final「安线」 |
| **B** Tone Disabled | `toneTimestampOnlyEnabled=false` | ✅ 已跑 | Final 不变 | Final「方案线」✓ |
| **C** Uniform 0.2 | HTTP 未接线；离线 replay 需 trace | ⚠️ 未产出 | — | — |
| **D** Wrong Tone 3→2 | HTTP 未接线；离线 replay 需 trace | ⚠️ 未产出 | — | — |

**审计缺口（已知）：** `tone_p10_node_e2e_validation.mjs` 向 `/run-lexicon-mock` 发送的 `disableTone` / `uniformTonePosterior` **不被 test-server 解析**；本轮 B 变体通过 **config `toneTimestampOnlyEnabled=false`** 实现，为有效反事实。

---

## 5. Propagation Matrix（5 fixtures 完整 A/B）

| Fixture | Final A≠B | RankingΔ | KenLM TopΔ | toneExact (A) | patternHit (A) |
|---------|-----------|----------|------------|---------------|----------------|
| d001 cafe | No | No | No | 0 | 52 |
| d002 | No | No | No | — | — |
| d003 | No | No | No | — | — |
| d043 homophone | **Yes** | No* | **Yes** | 4 | 57 |
| d044 | No | No | No | — | — |

\*V4 trace `recallHitsPreFilter` 未输出（`session_id` 未匹配 `traceCaseId` 目标 ID 格式）；Ranking 逐步对比依赖 summary 级诊断。

### 聚合统计（tone-sensitive 子集，已完成 5/27）

| 指标 | 值 |
|------|-----|
| Posterior 存在（A） | 5/5 |
| TonePattern 命中 | 5/5（exampleWindows≥8） |
| TonePenalty 触发（trace 级） | 0/5（pre-filter trace 空） |
| Final Candidate A/B 变化 | **1/5**（d043） |
| Tone 完全无业务影响 | 4/5 |

---

## 6. Lost Information Matrix（AcousticToneSlice 切片链）

### 6.1 d001 切片漏斗

```text
FW /utterance (pcm16)     24 slices / 24 words
        ↓
Node ASR (opus 路径)      19 words → ctx.acousticToneSlices
        ↓
extra.utterance_tone      12 slices  ← 第一处「报告可见」减少
        ↓
spanAssemblyV4.tone       19 slices (Recall 消费)
        ↓
Recall pattern overlap    52 window hits
```

### 6.2 E2E 22 fixtures 统计

| 层级 | 观察 |
|------|------|
| `runtimeToneSliceCount` < `fwToneSliceCount` | **11/22** |
| 第一处减少 | **Node HTTP 响应 `extra.utterance_tone`**（绑定 `ctx.asrResult.tone`，非全量 `ctx.acousticToneSlices`） |
| Recall 实际输入 | `ctx.acousticToneSlices`（通常 ≥ `utterance_tone`，仍可能 < FW 因 ASR 词级差异） |

**根因：** Node pipeline 经 **Opus 编解码 + 不同 ASR 词切分**，FW-direct pcm16 产生更多词级 timestamp；`utterance_tone` 额外只暴露首批 ASR tone payload，造成「Node 未消费全部 slice」的 **表象**（Recall 路径实际用 accumulated slices）。

---

## 7. Batch Inference 审计

```json
{
  "predictBatchCalls": 1,
  "predictBatchSizes": [6],
  "isTrueBatch": true,
  "outputSliceCount": 6,
  "backend": "numpy_p1",
  "featureVersion": "p1-frame-mel-f0-v1",
  "trainingVersion": "p10_structural_smoke",
  "artifactPath": ".../tone_cnn_p1_v1_full.npz"
}
```

**结论：** 正式 Runtime 对每 utterance 执行 **单次 `np.stack` + 单次 `predict_batch`**，非 501 次逐词 numpy 调用。

---

## 8. 多段 VAD 补测（5 条合成样本）

合成方式：两条 dialog_200 WAV + **1.2s 静音** 拼接。

| ID | vadSegmentCount | fwToneSlices | nodeToneSlices | recallToneSlices | toneEnabled |
|----|----------------:|-------------:|---------------:|-----------------:|:-----------:|
| d001_d049 | 1 | 55 | 27 | 56 | true |
| d050_d051 | 1 | 55 | 31 | 53 | true |
| d052_d053 | 1 | 56 | 32 | 58 | true |
| d088_d089 | 1 | 48 | 24 | 44 | true |
| d025_d026 | 1 | 43 | 25 | 43 | true |

**结论：** 1.2s 间隙 **未触发** VAD 多段（`vadSegmentCount=1`）；Tone 仍 enabled，Recall 有切片。真正多段 VAD 验收 **未完成**（需更长停顿或自然多段语料）。

---

## 9. Smoke Artifact 确认

| 字段 | 值 |
|------|-----|
| `training_version` | **`p10_structural_smoke`** |
| `model_version` | `tone_cnn_p1_v1_full` |
| `backend` | `numpy_p1` |
| `featureVersion` | `p1-frame-mel-f0-v1` |
| 生产质量 | **否** — 结构验收专用，不得视为 Full Production Model |

---

## 10. Remaining Business Risks

| 风险 | 级别 | 说明 |
|------|------|------|
| Smoke 权重误导 homophone | **高** | d043 Tone ON 劣于 OFF |
| `utterance_tone` 切片误导监控 | 中 | 与 Recall 输入不一致 |
| ToneLookup cafe 无 exact | 中 | d001 pattern 有但 exact=0 |
| TonePenalty 0.8 过弱 | 中 | mismatch 难改变排序 |
| HTTP C/D 反事实未接线 | 低 | 审计能力缺口 |
| 多段 VAD 未覆盖 | 低 | 1.2s 合成未分段 |
| V4 trace 需 session_id 含 fixture ID | 低 | `traceCaseId` 匹配 |

---

## 11. Acceptance Checklist

| 项 | 状态 |
|----|------|
| Tone Influence Trace（tone-sensitive） | ✅ 部分（5 fixtures 完整 A/B） |
| Counterfactual A/B | ✅ |
| Counterfactual C/D | ⚠️ 未接线 / trace 空 |
| Propagation Matrix | ✅ |
| Lost Information Matrix | ✅ |
| Batch 真 batch | ✅ |
| 多段 VAD ≥5 | ⚠️ 已跑 5 条但均为单段 VAD |
| Smoke artifact 确认 | ✅ |
| 业务验收 PASS | ❌ |

---

## 12. Final Verdict（唯一结论）

### **D — Runtime 正常；Smoke 结构完成；等待 Production Model 重训**

**理由：**

1. **结构传播已证明** — d043 中 Tone ON/OFF 导致不同 Final Candidate 与 KenLM Top1（非仅「能运行」）。
2. **业务质量未达标** — Smoke Posterior 在 homophone 上产生反向效果；不能以当前权重做业务签收。
3. **cafe 路径第一处丢失在 ToneLookup** — 非 Recall 代码断链，而是 acoustic pattern 与 lexicon `tone_pinyin_key` 无 exact 对齐（在 smoke 权重下）。
4. **下一步是重训 Production Model**，不是先调 Recall/Ranking/KenLM；真实 Posterior 到位后再做 Penalty 强度与 Lookup 命中率评估。

---

## 13. 附录：采集路径

| 产物 | 路径 |
|------|------|
| A/B 审计原始 | `tmp/tone_p10_business_acceptance/{d001,d043,...}/` |
| 多段 VAD | `tmp/tone_p10_business_acceptance/multi_segment_vad/summary.json` |
| P10 E2E（22 fixtures） | `tmp/tone_p10_node_e2e/e2e_report.json` |
| Runtime 切换报告 | `docs/tone-v2/Tone_V2_P10_Runtime_Direct_Replacement_Development_Report_2026_07_11.md` |
