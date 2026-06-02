# ASR 最终文本真值审计（Ground Truth Audit）

> **日期：** 2026-06-02  
> **性质：** 只读事实审计；未改代码、配置、测试脚本；未提交 Patch  
> **数据：** `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json`（200 条）、`test wav/dialog_200/cases.manifest.json`  
> **关联：** [FW 截断审计](./FW_Truncation_Pipeline_Audit_2026_06_02.md)

---

## 执行摘要

| 问题 | 结论（代码 + 批测事实） |
|------|-------------------------|
| 最终业务 ASR 文本 | **`ctx.segmentForJobResult` → `JobResult.text_asr`** |
| 批测 CER（raw） | **`extra.raw_asr_text`**（= 首批冻结的 `rawAsrText`） |
| 批测 CER（final） | **`extra.text_asr` / `text_asr_preview`**（= `segmentForJobResult` 落盘） |
| 业务 vs 统计是否分裂 | **否**：dialog_200 上 **199/200** `raw_asr_text === text_asr` |
| `rawAsrText` 是否仅首批 | **是**（`i===0` 写入后不再更新） |
| `asrText` 是否含多批 | **是**（`i>0` 拼接；**未落盘**到批测 JSON） |
| dialog_200 质量报告可信度 | **契约/FW 指标准**；**CER/Detector 与业务同源半句**，系统性低估整句 ASR |

---

## 第一部分 — ASR Text Field Report

| 字段名 | 创建位置 | 更新位置 | 最后使用位置 | 参与业务 | 参与统计 |
|--------|----------|----------|--------------|----------|----------|
| `ctx.rawAsrText` | `asr-step.ts`：`i===0` 且 `undefined` 时赋首批 ASR `text` | **无**（冻结） | `result-builder-core` → `extra.raw_asr_text`；`fw-detector-orchestrator` 读入 `rawText`；`session-finalize` → `RollingTurn.rawAsrText` | 间接（FW/Recall/KenLM 输入） | **是**：`analyze-dialog200-quality-perf.mjs` CER raw |
| `ctx.asrText` | `asr-step.ts`：`i===0` 赋首批 | `i>0`：`+=` 后续批 | 日志、`asr-step` 完成日志；`session-finalize` 仅作 `rawAsr` 缺失时 fallback | **否**（无 NMT/聚合 fallback） | **否**（批测 JSON 未导出） |
| `ctx.segmentForJobResult` | FW 模式：`asr-step` 末 = `rawAsrText`；`fw-detector-step` 再 sync；FW apply / aggregation / 5015 可写 | `fw-detector-orchestrator`；`aggregation-step`；`post-asr-routing`（5015，非 lock） | `resolveBusinessAsrText` → `text_asr`；`translation-step`；`node-agent-result-sender` | **是（SSOT）** | **是**：CER final = `text_asr` |
| `JobResult.text_asr` | `assembleJobResult` ← `resolveBusinessAsrText(ctx)` | — | 客户端/批测 `data.text_asr`；NMT | **是** | **是**（CER final、批测预览） |
| `extra.raw_asr_text` | `buildCoreResultExtra` ← `ctx.rawAsrText` | — | `run-dialog200` / `analyze-dialog200` / `run-fw-detector-dialog-200-batch` | 观测 | **是**（CER raw、Detector 审计对照） |
| `RollingTurn.finalText` | `session-finalize`：`segmentForJobResult ?? rawAsr` | — | Session rolling 上下文 | Session 记忆 | 否（dialog_200 批测未用） |
| `ctx.asrSegments` | 首批 ASR segments；`i>0` 合并 | — | FW span 检测 hint；`segments` 落盘 | 辅助 FW | 否 |
| `fw_detector.*` | `fw-detector-orchestrator` | — | 批测 `fw_triggered` / `fw_applied_count` 等 | 否（元数据） | **是**（Trigger/Applied） |

**说明：** Legacy 路径另有 `asrRepair` / `sentenceRepair` 字段；dialog_200 FW 批测走 `FW_SPAN_DETECTOR`，不启用 `LEXICON_RECALL` / `SENTENCE_REPAIR` 步骤。

---

## 第二部分 — 字段生命周期

### 2.1 `rawAsrText` Lifecycle

```text
[写] asr-step.ts L251-252  i===0 && rawAsrText===undefined → asrResult.text
[冻] 后续 i>0 永不写入
[读] asr-step 末 segmentForJobResult = rawAsrText (FW)
[读] fw-detector-step syncBaselineFromRaw
[读] fw-detector-orchestrator rawText = rawAsrText.trim()
[读] session-finalize buildRollingTurn.rawAsrText
[出] result-builder-core extra.raw_asr_text
```

### 2.2 `asrText` Lifecycle

```text
[写] asr-step i===0 → asrResult.text
[写] asr-step i>0 → asrText += ' ' + asrResult.text
[读] 日志 / diagnostics；session-finalize 仅 raw 空时 fallback
[禁] post-asr-routing / aggregation / translation 均不读 asrText
[未落盘] 批测 JSON 无此字段
```

**测试事实：** `asr-step.test.ts`「多 segment 时」`expect(ctx.asrText).toBe('first second')`；**未断言** `rawAsrText`。

### 2.3 `segmentForJobResult` Lifecycle

```text
[写] asr-step (FW)     = rawAsrText.trim()
[写] fw-detector-step  = rawAsrText (入口 sync)
[写] fw-orchestrator    = rawText 或 applyFwSpanReplacements(rawText, ...)
[写] aggregation-step  = detectorSegment / forward-merge / turn finalize 拼接
[写] semantic-repair   = textOut（仅当 !isSegmentWriteLocked）
[读] resolveBusinessAsrText → text_asr → NMT / 用户结果
```

**FW 主链顺序（`pipeline-mode-fw.ts`）：** `ASR → FW_SPAN_DETECTOR → AGGREGATION → …`

---

## 第三部分 — Dialog200 Metric Source Report

| 指标 | 脚本 | 使用字段 |
|------|------|----------|
| **CER raw** | `tests/analyze-dialog200-quality-perf.mjs` L76 | `c.extra.raw_asr_text` \|\| `raw_asr_preview` |
| **CER final** | 同上 L77 | `c.extra.text_asr` \|\| `text_asr_preview` |
| **Detector Trigger** | `run-fw-detector-dialog-200-batch.js` → `fw_triggered` | `extra.fw_detector.triggered`（pipeline 内对 **`rawAsrText`** 检测） |
| **Applied** | 同上 → `fw_applied_count` | `extra.fw_detector.summary.appliedCount` |
| **Recall（批测口径）** | 无独立 Recall CER；FW 内为 span/candidate | Orchestrator 输入 **`ctx.rawAsrText`**；批测行上 `fw_candidate_count` / `fw_span_count` |
| **KenLM** | FW orchestrator 内部 | 候选句 built from **`rawText`**（= `rawAsrText`） |
| **最终报告行** | `contractRow` | `text_asr_preview`、`raw_asr_preview`、`text_changed = raw !== text` |
| **Perf** | `analyze-dialog200-quality-perf.mjs` perf 段 | `pipeline_ms`、`asr_latency_ms`、`audio_ms`（**非**文本字段） |

**批测 200 条汇总（只读重算）：**

| 项 | 值 |
|----|-----|
| `text_changed` | **1 / 200** |
| `raw_asr_text === text_asr` | **199 / 200** |
| `avg_cer_raw` | **0.3619** |
| `avg_cer_final` | **0.3617** |
| CER raw≠final 的 case | **1** |
| `fw_triggered` | **39** |
| `fw_applied_count > 0` | **1** |
| `node_audio_segment_count >= 2` | **73** |

---

## 第四部分 — 双批次样本验证

**数据缺口：** `fw-detector-dialog-200-batch-result.json` **未持久化**每批 ASR 的 `segment #1` / `segment #2` 文本，也**未导出** `ctx.asrText`。下表仅能从批测 + manifest 还原；segment 分列来自**代码行为推断**（非实测第二段文本）。

| id | audio segment count | segment #1 text（= raw 冻结） | segment #2 text | rawAsrText（落盘） | asrText（运行时，未落盘） | segmentForJobResult | text_asr | 统计用文本 |
|----|-------------------|-------------------------------|-----------------|-------------------|-------------------------|---------------------|----------|------------|
| d061 | 2 | `周末`（推断=raw） | **未知** | `周末` | **未导出** | `周末` | `周末` | CER: `raw_asr_text` / `text_asr` |
| d106 | 2 | `周末一` | **未知** | `周末一` | 未导出 | `周末一` | `周末一` | 同上 |
| d019 | 2 | `今天,我们团队` | **未知** | `今天,我们团队` | 未导出 | 同左 | 同左 | 同上 |
| d045 | 2 | `關於後,學生成為學生` | **未知** | 同左 | 未导出 | 同左 | 同左 | 同上 |
| d067 | 2 | `您好,我定,您` | **未知** | 同左 | 未导出 | 同左 | 同左 | 同上 |

**参考（manifest）：** d061/d106 整句均为「周末要不要去江边骑行？…」；落盘仅为前缀。

---

## 第五部分 — 最终业务文本验证

| 消费方 | 字段 |
|--------|------|
| 用户最终看到的 ASR | **`JobResult.text_asr`** ← `resolveBusinessAsrText` ← **`segmentForJobResult`** |
| NMT 输入 | **`getTextForTranslation(ctx)`** = **`segmentForJobResult`**（`post-asr-routing.ts` L68-70） |
| FW Detector 输入 | **`ctx.rawAsrText`**（`fw-detector-orchestrator.ts` L221） |
| KenLM 输入 | FW 内对 **`rawText`**（= `rawAsrText`）的候选句/批打分 |
| Recall 输入 | FW span 检测与 V2 recall：**`rawText`**（= `rawAsrText`） |
| Dialog200 CER | **raw：** `raw_asr_text`；**final：** `text_asr` |

---

## 第六部分 — Consistency Audit Report

| 检查项 | 结果 |
|--------|------|
| 业务用 A、统计用 B？ | **业务与 CER final 同为 `segmentForJobResult`→`text_asr`**；**CER raw / FW / Detector 用 `rawAsrText`**。在 dialog_200 上二者 **199/200 相同**。 |
| NMT 完整、CER 半句？ | **否（本批）**：NMT 与 CER final 同源；均为首批冻结文本，**非**「NMT 吃 `asrText` 全句」。 |
| Recall 完整、报告半句？ | **否**：Recall 与 Detector 同读 **`rawAsrText`（半句）**；与 `text_asr` 一致。 |
| `asrText` 与业务/统计分裂？ | **存在字段级分裂**：运行时 `asrText` 可更长，但**不参与** NMT/CER/落盘；批测**无法验证**第二段是否非空。 |

---

## 第七部分 — Truncation Impact Report

**截断样本定义（截断专项）：** 前缀截断型 **49/200**（见 [FW_Truncation_Pipeline_Audit](./FW_Truncation_Pipeline_Audit_2026_06_02.md)）。

### 7.1 若「最终业务文本」= 当前 `text_asr` / `segmentForJobResult`

| 指标 | 变化 |
|------|------|
| CER | **≈0**：已与 CER final 相同（仅 1 条 `text_changed`） |
| Trigger / Applied | **≈0**：FW 已对当前 `rawAsrText` 决策 |
| Failure 分类 | **≈0** |

### 7.2 若 hypothetically 改用「多批合并真值」`asrText`

| 指标 | 可估算性 |
|------|----------|
| CER | **不可从现 JSON 重算**（无 `asrText` 落盘）；需重跑 pipeline 并导出 |
| Trigger / Applied | **不可定量**；更长文本可能增加 span，但第二批内容未知 |
| Failure 分类 | **不可定量** |

### 7.3 若修复文本链路（多批并入 `rawAsrText` / `segmentForJobResult`）

业务与 **CER raw / CER final / FW** 将**同时**变化；对 49 条截断样本 CER 可能显著下降（方向：改善），但需重跑后实测。

---

## 第八部分 — 最终结论（10 问）

1. **当前业务真正使用的 ASR 字段？** → **`segmentForJobResult` / `text_asr`**。  
2. **当前 CER 统计使用哪个字段？** → **raw：`raw_asr_text`；final：`text_asr`**。  
3. **两者是否一致？** → **在 dialog_200 批测上几乎一致（199/200）**；与 **`asrText` 不一致**（`asrText` 未参与统计）。  
4. **`rawAsrText` 是否只含第一批？** → **是**（代码冻结 + 批测 `raw_asr_text` 即首批）。  
5. **`asrText` 是否含完整多批？** → **设计上是的**（拼接）；**本批无落盘证据**。  
6. **`segmentForJobResult` 角色？** → **业务 SSOT**：FW apply → 聚合 → 可选 5015 → **`text_asr` / NMT**；FW 模式下初值 = **`rawAsrText`**。  
7. **dialog_200 质量报告是否可信？** → **FW 计数/契约可信**；**CER/Detector 可信反映「当前落盘半句」**，**不能**代表整 WAV 多批 ASR 能力。  
8. **Detector Audit 是否受影响？** → **是**：Detector 输入为 **`rawAsrText`**，与截断样本高度重叠（漏检多 `no_spans`）。  
9. **Lexicon ROI 评估是否受影响？** → **是（间接）**：FW Recall/KenLM 同基于半句；Applied 极低 partly 因输入过短/错误。  
10. **下一步建议（只读）** → **先修文本链路**（多批 ASR 进入 `segmentForJobResult` / `rawAsrText` 策略），再重跑 dialog_200；**不宜**在半句真值上继续扩 Detector 阈值。统计脚本可在真值固定后对齐，非首要矛盾。

---

## 代码锚点

```248:270:electron_node/electron-node/main/src/pipeline/steps/asr-step.ts
      if (i === 0) {
        ctx.asrText = asrResult.text;
        if (ctx.rawAsrText === undefined) {
          ctx.rawAsrText = asrResult.text ?? '';
        }
        // ...
      } else {
        ctx.asrText = (ctx.asrText || '') + ' ' + (asrResult.text || '');
        ctx.asrSegments = [...(ctx.asrSegments || []), ...(asrResult.segments || [])];
      }
```

```353:355:electron_node/electron-node/main/src/pipeline/steps/asr-step.ts
  if (isFwDetectorEngineEnabled()) {
    ctx.segmentForJobResult = (ctx.rawAsrText ?? '').trim();
  }
```

```63:70:electron_node/electron-node/main/src/pipeline/post-asr-routing.ts
export function resolveBusinessAsrText(ctx: JobContext): string {
  return (ctx.segmentForJobResult ?? '').trim();
}
export function getTextForTranslation(ctx: JobContext): string {
  return resolveBusinessAsrText(ctx);
}
```

```221:221:electron_node/electron-node/main/src/fw-detector/fw-detector-orchestrator.ts
  const rawText = (ctx.rawAsrText ?? '').trim();
```

```74:77:electron_node/electron-node/tests/analyze-dialog200-quality-perf.mjs
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
```
