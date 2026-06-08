# ToneModule P0.5 — Clean Correction Development Report

**日期**：2026-06-07  
**性质**：设计回归开发（删除 Recall 后 toneMatchScore；改为 tone-aware Recall）  
**关联**：[Design Drift Audit](./ToneModule_P0_Design_Drift_Audit_2026_06_07.md)

---

## 执行摘要

| 目标 | 状态 |
|------|------|
| 删除 `toneMatchScore` / `wTone` Recall 后排序 | **完成** |
| `extractAcousticTonePattern` → Recall 前约束 | **完成** |
| SSOT：`alignmentText === ASRResult.text` | **完成** |
| FW Detector 路径跳过 text dedup | **完成** |
| Recall 内 tone-compatible 优先排序 | **完成** |
| 单元测试 | **14 passed** |

---

## 第一部分 — 删除的错误实现

| 项 | 动作 |
|----|------|
| `fw-tone-config.ts` | **已删除** |
| `fw-sentence-rerank-pipeline.ts` | 移除 `toneMatchScore` / `wTone` / `candidateScore +=` |
| `build-sentence-candidates.ts` | 移除 `toneMatchScore` / `baseCandidateScore` |
| `FwToneModuleDiagnostics` | 移除 `wTone` / `toneScoreAppliedCount` |
| `node-config-types.ts` | 移除 `features.fwTone` |
| `tone-module-p0-final-acceptance.mjs` | 移除 wTone ON/OFF A/B；改为 Recall 路径探针 |
| `computeToneMatchScore` | **已从 `tone-match-score.ts` 导出中移除** |

**保留**：FW Worker `processed_audio → CNN → toneTokens` 不变。

---

## 第二部分 — SSOT 修复

### FW（Python）

| 变更 | 文件 |
|------|------|
| `skip_text_dedup: bool` 请求字段 | `api_models.py` |
| FW Detector 请求设置 `skip_text_dedup: true` | `faster-whisper-asr-strategy.ts` |
| dedup 在 `skip_text_dedup=true` 时跳过 | `api_routes.py` |
| `tone.alignmentText = full_text_trimmed` | `api_routes.py` + `tone_types.py` |

### Node

| 变更 | 文件 |
|------|------|
| `UtteranceTonePayload.alignmentText` | `task-router/types.ts` |
| `isToneAlignmentValid(rawText, tone)` | `tone-match-score.ts` |
| `alignmentText !== rawAsrText` → tone 不进入 Recall | `extractAcousticTonePattern` 返回 `null` |

---

## 第三部分 — acoustic tone pattern

新增于 `tone-match-score.ts`：

```typescript
extractAcousticTonePattern(rawText, spanStart, spanEnd, tone) → number[] | null
isCandidateToneCompatible(acousticPattern, candidateToneKey, candidateWord?) → boolean
argmaxToneFromPosterior(posterior) → number
```

- ASR query：**仅** CNN `toneTokens` posterior argmax
- **禁止** span.text → pinyin-pro

---

## 第四部分 — Recall 接口

| 文件 | 变更 |
|------|------|
| `recall-span-topk-v2.ts` | `acousticTonePattern?: number[]`；post-SQL tone 排序 |
| `local-span-recall.ts` | 透传 `acousticTonePattern`；返回 `recallToneCompatibleCount` |
| `tone-recall-sort.ts` | **新增** — 排序：`toneCompatible DESC → priorScore DESC → candidateScore DESC` |
| `fw-sentence-rerank-pipeline.ts` | span 级 `extractAcousticTonePattern` → `recallSpanTopK` |

---

## 第五部分 — Diagnostics（最小集）

```typescript
type FwToneModuleDiagnostics = {
  toneEnabled: boolean;
  alignmentTextMatched: boolean;
  acousticTonePattern?: number[];
  recallToneCompatibleCount: number;
  recallToneFallbackCount: number;
};
```

---

## 第六部分 — 测试

| 测试 | 结果 |
|------|------|
| `tone-match-score.test.ts` | 5 passed — 声学来源、SSOT、candidate 兼容 |
| `tone-recall-sort.test.ts` | 3 passed — 少冰 [3,1] Top1、无 tone fallback |
| `fw-sentence-rerank-p4.test.ts` | 6 passed — 无回归 |
| `tone-module-p0-runtime-acceptance.mjs` | `fwDetectorUsesWTone: false`, `fwDetectorUsesToneMatchScore: false` |
| `tone-module-p0-final-acceptance.mjs` | `shaoBingRecall.top1: 少冰` |

### 少病专项（Recall 内）

| candidate | tone key | acoustic [3,1] compatible |
|-----------|----------|---------------------------|
| **少冰** | shao3\|bing1 | **是 → Top1** |
| 烧饼 | shao1\|bing3 | 否 |
| 哨兵 | shao4\|bing1 | 否 |

---

## 第七部分 — 验收标准核对

| # | 标准 | 结果 |
|---|------|------|
| 1 | fw-detector 主链无 wTone | **通过** |
| 2 | fw-detector 主链无 toneMatchScore | **通过** |
| 3 | buildSentenceCandidates 无 tone 字段 | **通过** |
| 4 | Tone 不再影响 candidateScore | **通过** |
| 5 | Recall 接收 acousticTonePattern | **通过** |
| 6 | Recall 内 tone-compatible 优先 | **通过** |
| 7 | alignmentText 与 rawAsrText 同源 | **通过**（FW skip dedup + Node 校验） |
| 8 | IME / HintGate / Builder / KenLM / Apply 无改动 | **通过** |

---

## 第八部分 — 最终判定

| # | 问题 | 答案 |
|---|------|------|
| 1 | 错误的 toneMatchScore 接入是否已删除？ | **是** |
| 2 | wTone 是否已删除？ | **是** |
| 3 | Tone 是否已改为 Recall 前约束？ | **是** — `acousticTonePattern` 在 `recallSpanTopK` 之前提取，排序在 Recall 内 |
| 4 | SSOT 是否修复？ | **是** — `alignmentText` + skip dedup + Node 校验 |
| 5 | 是否仍有兼容兜底残留？ | **否** — 无 wTone；无 tone 时 plain recall；无 alignment 时不启用 tone |
| 6 | 是否可以进入 P0.5 Runtime Validation？ | **是** — 建议下一步跑 Dialog200 E2E + `toneScoreAppliedCount` 已移除后的 Recall 观测 |

---

## 修改文件清单

| 文件 | 变更类型 |
|------|----------|
| `tone_module/tone_types.py` | alignment_text |
| `api_models.py` | alignmentText, skip_text_dedup |
| `api_routes.py` | skip dedup, set alignmentText |
| `tone-match-score.ts` | 重写为 pattern 提取 |
| `tone-recall-sort.ts` | **新增** |
| `recall-span-topk-v2.ts` | acousticTonePattern + sort |
| `local-span-recall.ts` | 透传 pattern |
| `fw-sentence-rerank-pipeline.ts` | 删除 rerank tone 打分 |
| `build-sentence-candidates.ts` | 删除 tone 字段 |
| `types.ts` (fw-detector) | 新 diagnostics |
| `task-router/types.ts` | alignmentText |
| `faster-whisper-asr-strategy.ts` | skip_text_dedup |
| `node-config-types.ts` | 删除 fwTone |
| `fw-tone-config.ts` | **删除** |
| `tone-match-score.test.ts` | 重写 |
| `tone-recall-sort.test.ts` | **新增** |
| `tone-module-p0-final-acceptance.mjs` | 重写 |
| `tone-module-p0-runtime-acceptance.mjs` | 重写 |

---

**签署建议**：P0.5 Clean Correction **开发完成**，可进入 **P0.5 Runtime Validation**（全链路 Dialog200 + alignmentText 现场核验）。
