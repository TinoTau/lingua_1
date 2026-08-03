<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_ToneEvidence_Contract_Architecture_Audit_2026_07_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Tone Evidence Contract Architecture Audit

> **SUPERSEDED (Tone conclusions · 2026-07-29 Final Freeze)**  
> 本文保留为历史审计证据。下列结论**不得**再作 CURRENT SSOT：  
> 「`utterance_tone` 仅首 batch」「72 Pattern Miss 为当前瓶颈」「多 batch Slice 在生产 Mapping 前丢失」「Feature Extraction / short Word 扩窗 / Span 为当前第一优先」。  
> **现行权威：** [`FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) · Runtime SSOT §0A · Coverage **99.65%** / 唯一残差 d132 = `FREEZE_AS_EVIDENCE_UNAVAILABLE`。

**Date:** 2026-07-29  
**Nature:** Part A–F / H 只读架构审计 + Part G 诊断字段无兼容重命名（允许改名，禁止改生产业务逻辑）  
**Evidence:**
- Code: `asr-step.ts`, `result-builder-core.ts`, `api_routes.py`, `tone_module/inference.py`, `tone_module/contract.py`, `tone-time-align.ts`, `recall-topk-for-windows.ts`, `fw-detector-v4-path.ts`
- Runtime: `docs/tone-v2/_audit_scratch/mainchain_acceptance_2026_07_29/`（dialog_200 验收 + miss_rc_*）
- Prior: `FW_Repair_V4_ToneParticipation_RootCause_SpanSlidingWindow_Audit_2026_07_29.md`

---

## 1. Executive Summary

**结论（代码级）：**

1. **Tone Evidence 合同不存在。** 进入 Tone-aware Recall 的 `WordTimeSpan` **不保证**存在相交的真实 `AcousticToneSlice`。缺失时 `mapToneEvidenceForRecall` **静默**返回 `pattern=null`，仅累加诊断计数，无 Fail Closed。
2. **生产 Mapping 输入不是 `utterance_tone`，而是 `ctx.acousticToneSlices`（多 batch offset+append）。** API/`extra.utterance_tone` 只导出 **首 batch** 的 `ctx.asrResult.tone`。这是 `asrToneSliceCount << diagToneSliceCount` 的直接断点（`result-builder-core.ts`）。
3. **`MIN_SLICE_SEC=0.02` 会在 `run_tone_inference` 中 `continue` 跳过短 Word，且不发 Slice；WordInfo / WordTimeSpan 仍保留。** 同类静默缺口还有 `extract_feature` 的 `ValueError → continue`。二者都会造成「有 WTS、无 Slice」。
4. **dialog_200 上 72 Pattern Miss 全部是「有 windowTimeRange、无 pattern」**（`tonePatternMappingMissCount`；旧名已删除）。`toneOverlapMissCount=0`。
5. **`mapToneEvidenceForRecall` 本轮不应改算法。** 缺口在 Evidence 生产与合同，不在 Mapping。
6. **诊断字段 `toneOverlapSyllableMismatchCount` 已无兼容重命名为 `tonePatternMappingMissCount`。** Span / KenLM / Domain / Assembly / CNN / Feature Contract **未改业务逻辑。**

---

## 2. Production Call Chain

### 2.1 端到端表

| 步骤 | 文件 | 函数 | 输入 | 输出 | 时间轴 | 丢数据 | 改时间戳 | 截断 |
| ---- | ---- | ---- | ---- | ---- | ------ | ------ | -------- | ---- |
| Electron ASR 分批 | `pipeline/steps/asr-step.ts` | `runAsrStep` | PCM chunks `audioSegments[]` | 每批 `ASRResult` | chunk-local → 累加 `cumulativeTimeSec` | NO | YES（累计 offset） | NO |
| FW API | `faster_whisper_vad/api_routes.py` | `process_utterance` | PCM + `skip_text_dedup` | `segments[].words[]` + tone | chunk / utterance-local（单次 FW 调用） | 可能（dedup 关闭则保留 words） | NO（Tone 前） | NO |
| Tone 入口 | 同上 | `run_tone_inference(...)` | `processed_audio` + `segments_info` | `UtteranceAcousticTonePayload` | 与 Word 相同（chunk-local） | **YES**（短 Word / feature fail） | NO | NO |
| 音频切片+特征 | `tone_module/inference.py` + `feature_v2.extract_feature` | 按 Word `start/end` 切真实音频 | feature batch | chunk-local | **YES**（`continue`） | NO | NO |
| Inference | `classifier.predict_batch` | features | posteriors | — | NO | NO | NO |
| Slice 构造 | `inference.py` | `zip(valid_words, posteriors)` | Word+probs | `AcousticToneSlice{start,end,posterior}` | **Word 原 start/end**（非 index 对齐全量 words） | NO（仅 valid） | NO | NO |
| API 序列化 | `api_routes.py` | `_tone_payload_to_model` | payload | JSON `tone.acousticToneSlices` | chunk-local | NO | NO | NO |
| Node 解析+offset | `asr-step.ts` | `offsetAcousticSlices(normalize..., segmentOffsetSec)` | 每批 slices | `ctx.acousticToneSlices.push(...)` | **utterance-local** | NO | **YES（+batch offset）** | NO |
| 首批 ASR 保留 | `asr-step.ts` | `i===0 → ctx.asrResult=asrResult` | 首批完整结果 | `ctx.asrResult.tone` **仅首批** | chunk0-local | **YES（后续 tone 不写入 asrResult）** | NO | **YES** |
| 多批文本/段合并 | `asr-step.ts` | `else` 分支 | 后续 `segments` | `ctx.asrSegments` append | words 仍为各批 local | NO | NO（此时未加 offset） | NO |
| API JobResult | `result-builder-core.ts` | `buildCoreResultExtra` | `ctx.asrResult?.tone` | `extra.utterance_tone` | **仅首批** | **YES** | NO | **YES** |
| FW Detector | `fw-detector-v4-path.ts` | `runSpanAssemblyV4Orchestrator` | `acousticSlices: ctx.acousticToneSlices` | assembly | utterance-local slices | NO | NO | NO |
| WTS | `tone-time-align.ts` | `buildWordTimeSpans` | segments + `segmentTimeOffsetsSec[batchIdx]` | `WordTimeSpan[]` | **utterance-local**（word.start+offset） | 可能（`indexOf` 失败跳过） | **YES** | NO |
| Mapping | `tone-time-align.ts` | `mapToneEvidenceForRecall` | WTS + slices | `pattern \| null` | 同 utterance-local | 逻辑失败≠丢证据 | NO | NO |
| 诊断计数 | `recall-topk-for-windows.ts` | `recallTopKForWindows` | mapping 结果 | `tonePatternMappingMissCount` 等 | — | NO | NO | NO |

### 2.2 关键数据流（简图）

```text
audioSegments[i]
  → FW process_utterance
      → segments.words (chunk-local)
      → run_tone_inference → slices (chunk-local; 可能少于 words)
  → Node:
      ctx.acousticToneSlices += offset(slices, cumulativeTimeSec)   // 全量 SSOT for Recall
      if i==0: ctx.asrResult = result                              // tone 仅首批
      else: ctx.asrSegments append words                           // words 全量
  → result-builder: utterance_tone = ctx.asrResult.tone            // 截断导出
  → FW Detector: mapToneEvidenceForRecall(ctx.acousticToneSlices, buildWordTimeSpans(...))
```

---

## 3. Current Data Contract

### Part B 问答

| # | 问题 | 答案 |
| - | ---- | ---- |
| 1 | 是否存在「每个进入 Tone-aware Recall 的 WordTimeSpan 必须有相交真实 Slice」合同？ | **否** |
| 2 | 合同定义在哪里？ | **无正式合同。** 仅有 Mapping 注释（Participation Mapping / 禁止伪造）与职责叙述 |
| 3 | 谁负责保证？ | **当前无人保证。** 设计上应由 **Tone Module（生产 Slice）+ Node 合并时间轴** 保证；Recall 只消费 |
| 4 | 谁负责校验？ | **无运行时校验。** 仅有事后诊断计数 |
| 5 | 合同失败时当前行为？ | `pattern=null`，窗仍可走 plain/无 tone SQL 路径（Batch 1.1C 后 tone 路径优先，但 pattern 空则无 tone pattern） |
| 6 | 是否静默跳过？ | **是**（Inference `continue`；Mapping 返回 null） |
| 7 | 是否有 Fail Closed？ | **否**（对比：ToneSlice>0 ∧ words=0 已有 Fail Closed；WTS 无 Slice **没有**） |
| 8 | 计数器与 Trace？ | 有：`tonePatternMappingMissCount` / `toneOverlapMissCount` / `exampleToneWindows`；**无**细粒度 miss reason 枚举 |
| 9 | Word 与 Slice 是否一一对应？ | **设计意图：每个通过过滤的 Word → 至多 1 Slice。** 不是强制 1:1（短 Word / feature fail → 0） |
| 10 | 一词是否允许多 Slice？ | **当前实现不允许**（一词最多一片） |
| 11 | 一片是否允许多 Word？ | **时间上可能重叠查询命中多 Word；构造时一片绑定一个 valid Word 的 [start,end]** |
| 12 | 多字 Word 如何表达？ | **一个 WordInfo / 一个 WTS / 一个 Slice** 覆盖整段时间；Mapping 按音节字符槽多次读同一 Word 的 Slice argmax |

**合理基数（基于 Feature Contract）：**  
Tone CNN 输入是 **按 Word 时间窗** 抽的固定帧特征（`P1_FIXED_FRAMES=64`，duration-normalized），不是「一字一帧强制」。因此合同应是：

```text
∀ WordTimeSpan used by Tone-aware Mapping:
  ∃ AcousticToneSlice overlapping [start,end) with real posterior
```

**不是**「一字一片」，也不是「一音节一片」。

---

## 4. MIN_SLICE_SEC Audit

### 4.1 参数来源

| 项 | 值 |
| -- | -- |
| 当前值 | **`0.02` 秒** |
| 定义 | `tone_module/contract.py`：`P0_MIN_SLICE_SEC = 0.02`；`P1_MIN_SLICE_SEC = P0_MIN_SLICE_SEC` |
| 运行时别名 | `inference.py`：`MIN_SLICE_SEC = P1_MIN_SLICE_SEC` |
| 可配置 | **否**（编译期常量；非 env/config） |
| 原设计目的 | P0/P1 **特征基线 / 训练对齐过滤**（`alignment_textgrid.py`、`probe_aishell3.py` 同样跳过 `< P0_MIN_SLICE_SEC`） |
| 类别 | **特征/训练约束上移到运行时的保护门**；不是独立产品策略开关 |

### 4.2 实际影响（dialog_200 / 已有 Evidence）

**机制（确定）：**

```python
# inference.py
if dur < MIN_SLICE_SEC:
    continue
# 以及
except ValueError:  # extract_feature
    continue
# words 仍在 segments[].words[]；valid_words 变短；slices 变少
```

**量化（基于验收与探针，非完整逐 Word 离线重放）：**

| 指标 | 值 | 说明 |
| ---- | -- | ---- |
| Pattern Attempt / Hit / Miss | 288 / 216 / 72 | 验收 SSOT |
| Mapping miss（有 windowTime） | 72（100% Miss） | 旧 mismatch 计数 |
| smoke_d001 最短 Word | ≈0.08s | **≫ 0.02**；该样例 `dur < MIN` = 0 |
| 典型缺口形态 | `diagToneSliceCount` 略小于或局部不覆盖 WTS | 短 Word **或** `extract_feature` fail **或** 观测用错 slice 源 |

> **判定：** `MIN_SLICE_SEC` **可以直接**造成「有 WordTimeSpan、无 Slice」。  
> 在 dialog_200 自然语速下，**<20ms Word 较少**；因此它是 **确认的代码根因类机制**，但是否独占 72 Miss 需 Batch B 用全量 Word 时长直方图验收。  
> **同等危险的兄弟机制：** `extract_feature` `ValueError → continue`（`feature_v2` 现为 bytecode shim，源码不可读，但调用点明确）。

### 4.3 样例表（≥20；来自 miss_rc / rows / smoke 机制样例）

说明：下列「是否造成 Miss」以 **验收/探针窗** 为准；多 batch 案例的 `asrTone` 计数不能代表 Mapping 输入。

| Case | Word | start | end | duration | 是否生成 Slice（推断） | 是否进入 Recall | 是否造成 Miss |
| ---- | ---- | ----: | --: | -------: | -------------------- | --------------- | ------------- |
| d015 | 一点 | 3.72* | 4.04* | 0.32 | 探针见无相交（观测源偏） | YES（一点） | YES（pattern null） |
| d051 | 审 | 3.18* | 3.32* | 0.14 | 局部窗「审一下」失败 | YES | YES（审一下） |
| d051 | 审一 | — | — | — | 有 pattern | YES | NO（hit） |
| d060 | 減一點 | — | — | — | 減一 hit / 減一點 miss | YES | YES |
| d067 | 一下 | 4.26* | 4.54* | 0.28 | 无相交于错误观测切片 | YES | YES |
| d096 | 一下 | 3.52* | 3.86* | 0.34 | diag 25 vs WTS 26 → 缺 1 | YES | YES |
| d001 | 杯 | 1.36 | 1.44 | 0.08 | smoke：diag slices=19=words | — | — |
| d001 | 一 | 1.18 | 1.36 | 0.18 | ≥ MIN | — | — |
| d011 | 開始 | 4.2 | 4.54 | 0.34 | 单 batch 对齐 | YES | 验收 miss / 探针可 HIT_REPLAY |
| 机制 | *(any)* | — | — | **<0.02** | **强制不生成** | 若进窗 | **会** |
| 机制 | *(any)* | — | — | feature fail | **不生成** | 若进窗 | **会** |
| d015 | (句首词) | ~0–0.6 | — | — | utterance_tone 仅见 3 片 | — | 观测偏斜 |
| d067 | (句首词) | ~0.3–0.6 | — | — | utterance_tone 仅 4 片 | — | 观测偏斜 |
| d141 | — | — | — | — | rows: sc=3 wc=24 | YES | YES |
| d195 | — | — | — | — | rows: sc=7 wc=25 | YES | YES |
| d052 | — | — | — | — | rows: sc=15 wc=29 | YES | YES |
| d101 | — | — | — | — | rows: sc=8 wc=22 | YES | YES |
| d112 | — | — | — | — | rows: sc=10 wc=20 | YES | YES |
| d118 | — | — | — | — | rows: sc=11 wc=17 | YES | YES |
| d150 | — | — | — | — | rows: sc=8 wc=25 | YES | YES |

\*探针 `buildWordTimeSpans` **未加 batch offset**；生产 `diagWindowTime` 常比 replay 高 ~0.8–1.7s（多 batch 时间基差）。

### 4.4 下游影响

| 问题 | 答案 |
| ---- | ---- |
| Word 是否仍在 `segments[].words[]`？ | **是** |
| WordTimeSpan 是否仍生成？ | **是**（若 `indexOf` 成功） |
| Tone Slice 是否完全缺失？ | **对该 Word：是** |
| `valid_words` 与原 words 错位？ | **按设计变短**；`zip(valid_words, posteriors)` **正确**，**不是** `zip(all_words, slices)` |
| Slice index 当 Word index？ | **生产 Mapping 不按 index**；按 **时间重叠** |
| 后续 zip/下标假设？ | Inference 内 zip 安全；**危险在「默认一词一片」的观测假设** |

### 4.5 修复方向比较（只方案）

| 方案 | 真实音频 | 改 Feature Contract | 影响模型 | 保持时间语义 | 改动范围 | 风险 |
| ---- | -------- | -------------------- | -------- | ------------ | -------- | ---- |
| **A** 以 Word 中心扩到最小真实窗 | YES | NO（仍用现 extract） | NO | 需记录 target vs inference 窗 | Tone inference | 邻音泄漏 |
| **B** 邻接上下文真实窗 + 显式 target/inference 四元组 | YES | NO | NO | **最佳** | Tone + 诊断字段 | 实现稍复杂 |
| **C** Evidence Unavailable 显式化 | N/A | NO | NO | 保留缺失 | 合同+诊断+可选 Fail Closed | 覆盖率不升，可观测性升 |
| **D** 仅修复多 batch `utterance_tone` 导出 + 观测 | YES（已有） | NO | NO | YES | `result-builder-core` / asr-step | **不修复**短 Word 缺口 |

禁止：复制 posterior、按拼音填 Tone、按比例扩展 pattern。

---

## 5. Multi-Segment Time Base Audit

### 5.1 时间基准一览

| 对象 | 时间基准 |
| ---- | -------- |
| FW `segment.start/end` | 单次 ASR 调用内 **chunk-local** |
| FW `word.start/end` | 同 chunk-local（相对本次 `processed_audio`） |
| raw audio offset（Node batch） | `segmentTimeOffsetsSec[batchIdx]` / `cumulativeTimeSec` |
| Tone inference slice start/end | **与 Word 相同 chunk-local**（直接用 `w.start/w.end`） |
| Node `ctx.acousticToneSlices` | **utterance-local**（+ batch offset） |
| API `utterance_tone` | **仅首 batch chunk-local**（未合并） |
| Node toneDiag `toneSliceCount` | `ctx.acousticToneSlices.length`（全量） |
| `WordTimeSpan` | **utterance-local**（word + batch offset） |

### 5.2 十五问（代码结论）

1. Segment 内 Word 是否已是 utterance-local？→ **否**，chunk-local；由 Node 加 offset。  
2. Tone 是否再叠加 segment.start？→ **Inference 内不再叠加**；Node 对 slices 加 **batch** offset。  
3. 是否漏加 offset？→ Mapping 路径：**对 slices/WTS 均加 batch offset**。  
4. 是否重复加？→ **未见**对同一对象双重 batch offset。  
5. 多 Segment Tone 是否 append？→ **`ctx.acousticToneSlices.push(...batchSlices)` 是。**  
6. 是否只返回首 Segment Slice？→ **对外 `utterance_tone`：是（首 batch）。** Mapping：**否。**  
7. API 是否覆盖而非累加？→ **`utterance_tone` 取 `ctx.asrResult.tone`（首批覆盖语义）。**  
8. `utterance_tone` 与 diagnostic 是否不同对象？→ **是。**  
9. 为何 `asrToneSliceCount << diagToneSliceCount`？→ **导出用首批 tone；诊断用全量 `acousticToneSlices`。**  
10. response serialization 是否裁剪？→ **等价于未导出后续 batch slices。**  
11. Node 是否只读某 segment？→ Mapping **读全量 slices**；导出 **读 asrResult.tone。**  
12. 数组重建丢失后续 Slice？→ **ctx 内不丢；response 丢。**  
13. 局部排序过滤？→ Inference 内按 start sort；无按时间砍后半句。  
14. 采样率/单位？→ 秒；16kHz PCM；一致。  
15. 浮点边界？→ `slice.end > span.start && slice.start < span.end`；极端贴边可能失败，**非主因。**

### 5.3 指定 Case 追踪表

> Mapping 行使用 **diag（全量）**；API 行使用 **utterance_tone（首批）**。  
> First/Last Time：能从探针得到的近似值；多 batch 时 API 时间轴不可与后半句 WTS 直接比。

#### d015

| 阶段 | Word Count | Slice Count | First Time | Last Time | Time Base |
| ---- | ---------: | ----------: | ---------: | --------: | --------- |
| FW words（合并 segments） | 21 | — | ~0 | ~4+ | chunk-local per batch |
| Tone inference input | =words/批 | — | — | — | chunk-local |
| Tone inference output（累加后 diag） | — | **21**（miss_rc） | ~0 | ~utterance end | utterance-local |
| API response `utterance_tone` | — | **3** | ~0 | ~0.62 | **首批 only** |
| Node parsed slices（Mapping） | — | 21 | — | — | utterance-local |
| toneDiag | WTS=21 | toneSliceCount=21 | — | — | — |
| Mapping input | 21 | 21 | diagWindow「一点」≈4.52–4.84 | — | utterance-local |

#### d051

| 阶段 | Word Count | Slice Count | First Time | Last Time | Time Base |
| ---- | ---------: | ----------: | ---------: | --------: | --------- |
| FW words | 26 | — | — | — | per-batch local |
| Tone out (diag) | — | **25** | — | — | utterance-local |
| API | — | **9** | — | ~1.8x | 首批 |
| toneDiag / Mapping | 26 | 25 | 「审一下」diag≈5.08–5.54 | — | utterance-local |
| 结果 | — | — | 审一 HIT / 审一下 MISS | — | 末音节 Evidence 缺口类 |

#### d060

| 阶段 | Word Count | Slice Count | First Time | Last Time | Time Base |
| ---- | ---------: | ----------: | ---------: | --------: | --------- |
| rows 观测 sliceCount | — | 8（**asrTone 优先，低估**） | — | — | 观测偏斜 |
| WTS | 26 | — | — | — | utterance-local |
| 结果 | — | — | 減一 HIT / 減一點 MISS | — | 同 d051 模式 |

#### d067

| 阶段 | Word Count | Slice Count | First Time | Last Time | Time Base |
| ---- | ---------: | ----------: | ---------: | --------: | --------- |
| API | — | **4** | ~0.34 | ~0.62 | 首批 |
| diag | 24–26 | **24** | — | — | utterance-local |
| Mapping 窗「一下」 | — | — | diag≈5.06–5.34 | — | utterance-local |

#### d096

| 阶段 | Word Count | Slice Count | First Time | Last Time | Time Base |
| ---- | ---------: | ----------: | ---------: | --------: | --------- |
| API | — | **9** | — | ~1.68 | 首批 |
| diag | 26 | **25** | — | — | utterance-local |
| 缺口 | WTS−Slice≈1 | — | 「一下」 | — | **缺一片级 Evidence** |

---

## 6. Response vs Diagnostics Divergence

**根因函数（确定）：**

```59:59:electron_node/electron-node/main/src/pipeline/result-builder-core.ts
    ...(ctx.asrResult?.tone ? { utterance_tone: ctx.asrResult.tone } : {}),
```

配合：

```274:276:electron_node/electron-node/main/src/pipeline/steps/asr-step.ts
      if (i === 0) {
        ctx.asrText = asrResult.text;
        ctx.asrResult = asrResult;
```

与：

```262:266:electron_node/electron-node/main/src/pipeline/steps/asr-step.ts
      const batchSlices = offsetAcousticSlices(
        normalizeAcousticSlices(asrResult.tone?.acousticToneSlices),
        segmentOffsetSec
      );
      ctx.acousticToneSlices.push(...batchSlices);
```

**验收脚本二次放大：** `mainchain-acceptance-dialog200.cjs` 曾用 `asrTone?.sliceCount ?? tone.toneSliceCount`，把 **首批计数写进 rows**，造成「Mapping 只有 3 片」的假象。  
**事实：** Mapping SSOT = `ctx.acousticToneSlices`（diag `toneSliceCount`）。

---

## 7. Index and Merge Logic

### 7.1 相关模式清单

| 模式 | 位置 | 风险 |
| ---- | ---- | ---- |
| `zip(valid_words, posteriors)` | `inference.py` | **安全**（与过滤后列表对齐） |
| **非** `zip(all_words, slices)` | — | 若有人假设全量 index 对齐会错 |
| `enumerate` / index | LTR / recall 窗循环 | 与 Tone 对齐无关 |
| `asrSegments` append | `asr-step.ts` | words 全量保留 |
| `acousticToneSlices` append+offset | `asr-step.ts` | **正确全量** |
| `ctx.asrResult =` 仅 i==0 | `asr-step.ts` | **tone 字段截断** |
| `utterance_tone` 映射 | `result-builder-core.ts` | **导出偏斜** |
| list filter `continue` | `inference.py` MIN / ValueError | **Evidence 静默缺失** |
| `indexOf` 建 WTS | `buildWordTimeSpans` | 失败则无 WTS（本批 Miss 中 ≈0） |
| 时间重叠 filter | `selectRealSliceForWordSpan` | 无 Slice → null |

### 7.2 是否导致数量/顺序偏斜？

- **Response vs Diag：是（导出截断）。**  
- **Mapping 输入：全量 append，顺序为 batch 顺序 + 每批 sort。**  
- **Inference 过滤：Slice 数 ≤ Word 数 → 与 WTS 数量偏斜（真实 Evidence 缺口）。**

---

## 8. Root Cause Classification

| ID | 根因 | 断点函数 | 是否本轮可改代码 | 对 72 Miss |
| -- | ---- | -------- | ---------------- | ---------- |
| R1 | **无 Tone Evidence 合同 / 无 Fail Closed** | （缺失） | 方案 Batch A | 结构性 |
| R2 | **短 Word / feature fail 静默不发 Slice** | `run_tone_inference` | 方案 Batch B | 直接机制；dialog 占比待直方图 |
| R3 | **`utterance_tone` 仅首 batch** | `buildCoreResultExtra` + `runAsrStep` | 方案 Batch C | **解释观测偏斜**；Mapping 已用全量 |
| R4 | **验收/探针用错 slice 源** | acceptance/probe scripts | 工具修复 | 放大误判 |
| R5 | Mapping 算法错误 | `mapToneEvidenceForRecall` | **本轮禁止；且非主因** | 否 |

**缺失发生在哪里：**  
优先：`run_tone_inference` 过滤后无 Slice；次要：多 batch 导出与观测链。  
**不应修改：** Mapping 填补、CNN、Feature Contract、Span/LTR/KenLM/Domain/Assembly。

---

## 9. Diagnostic Naming Cleanup

| 旧名 | 新名 | 语义 |
| ---- | ---- | ---- |
| `toneOverlapSyllableMismatchCount` | **`tonePatternMappingMissCount`** | 已找到 `windowTimeRange`，但 `mapToneEvidenceForRecall` 未生成 pattern |

规则执行：无 alias、无双写、无 fallback；计数逻辑不变。

### Part F：失败区分能力

| Reason | 当前能否区分 |
| ------ | ------------ |
| NO_WINDOW_TIME_RANGE | **能**（`toneOverlapMissCount`） |
| NO_WORDTIMESPAN_FOR_SYLLABLE_CHAR | **不能**（并入 mapping miss） |
| NO_SLICE_OVERLAP_WORD_TIME | **不能**（并入 mapping miss） |
| EMPTY_TONE_POSTERIOR | **不能**（argmax 仍产出 digit） |
| INVALID_TONE_POSTERIOR | **不能** |
| PATTERN_MAPPING_SUCCESS | **能**（hit 计数） |

**建议（Batch D，可选）：** 有限枚举 `TonePatternMappingMissReason`；本轮 **未实施**（避免扩大改动）。命名清理已足够支撑下一轮开发观测。

---

## 10. Modified Files for Naming Cleanup

生产/工具（逻辑未改，仅字段名）：

- `span-assembly-shared/types.ts`
- `span-assembly-shared/tone-diagnostics.ts`
- `span-assembly-v4/recall-topk-for-windows.ts`
- `tests/experiments/analyze-span-assembly-v3-dialog200.mjs`
- `docs/tone-v2/_audit_scratch/mainchain-acceptance-dialog200.cjs`
- `docs/tone-v2/_audit_scratch/tone-miss-rootcause-probe.cjs`
- 若干 `electron-node/tests/*-batch-result.json` / `trace-*.json`（字段名同步）
- `docs/tone-v2/FW_Repair_V4_ToneParticipation_RootCause_SpanSlidingWindow_Audit_2026_07_29.md`（规范表述更新）

**保留旧名的历史快照：** `_audit_scratch/historical/**`、`electron-node/reports/**`（历史审计记录）。

---

## 11. Proposed Repair Architecture

```text
Tone Module  --(真实音频 inference)--> AcousticToneSlice[]  --merge/offset--> utterance-local SSOT
FW WordInfo  -----------------------> WordTimeSpan[]      --同时间基----┘
                                                                      |
                                                              Contract Gate
                                                       (每个参与 Mapping 的 WTS
                                                        必须有相交真实 Slice
                                                        或显式 Unavailable)
                                                                      |
                                                              mapToneEvidenceForRecall
                                                              (只读，不补造)
```

**Owner：** Tone Module + Node ASR merge（Evidence）；Recall（消费）；Diagnostics（观测）。

---

## 12. Batch Plan

### Batch A — Tone Evidence Contract

- **Goal：** 成文并实现最小合同：参与 Tone-aware Mapping 的 WTS 必须有真实相交 Slice，否则显式 Unavailable / 可选 Fail Closed（产品二选一，开发前冻结）。
- **Files：** 新合同 doc；可选 `tone-time-align.ts` 校验钩子；`recall-topk` 诊断。
- **Functions：** 新增 `assertOrMarkToneEvidenceAvailability`（名可调整）；不改 Mapping 填补。
- **Current：** 静默 null。  
- **Target：** 可区分原因；合同失败可观测。
- **Delete：** 「默认一词一片」的隐含假设文档。
- **Risk：** Fail Closed 过严会降 Recall 覆盖。
- **Tests：** 单元：有 WTS 无 Slice → reason；运行：dialog 子集计数。
- **Acceptance：** 合同文档冻结；计数与枚举对齐。

### Batch B — Short Word Real-Audio Inference

- **Goal：** 仅当直方图确认 `MIN_SLICE`/`extract_feature` fail 造成实质 Miss 时实施；用 **真实音频扩窗**（方案 A/B），保留 target vs inference 时间字段。
- **Files：** `inference.py`；可选诊断；**不改** Feature Contract 张量形状。
- **Current：** `dur < 0.02` / ValueError → skip。  
- **Target：** 短 Word 仍产出真实 Slice，或显式 Unavailable（若物理不可推理）。
- **Risk：** 邻音污染；需回归 Tone 分布。
- **Tests：** 合成短 Word 夹具；dialog_200 Pattern 覆盖率。

### Batch C — Multi-Segment Merge / Export Repair

- **Goal：** `utterance_tone`（及任何外部消费者）导出 **与 `ctx.acousticToneSlices` 同一 SSOT**（已 offset 的全量 slices）。
- **Files：** `result-builder-core.ts`；必要时 `asr-step.ts` 同步 `ctx.asrResult.tone`；验收脚本改读 diag/SSOT。
- **Current：** 首批 only。  
- **Target：** `asrToneSliceCount == diagToneSliceCount`（同 utterance）。
- **Before/After：** d015 API 3 → 21。
- **Risk：** 低；注意序列化体积。
- **Tests：** 多 batch fixture；d015/d067/d096。

### Batch D — Diagnostics Enum（可选）

- **Goal：** `TonePatternMappingMissReason` 有限枚举；不建第二诊断链。
- **Files：** `tone-time-align.ts` 返回 reason；`recall-topk` 计数。
- **Risk：** 低。

---

## 13. Target List

| 验收对象 | 目标 |
| -------- | ---- |
| 谢谢 / 一下 / 开始 / 没有 / 一点 / 审一下 | Evidence 合同下可解释 Hit/Miss |
| d015 d051 d060 d067 d096 | API slice == diag slice；后半句 WTS 有相交 Slice 或显式 Unavailable |
| dialog_200 随机 ≥30 | 报告 WTS/Slice/无重叠数/多 batch/Hit-Miss |
| 命名 | 生产+工具+规范文档旧字段引用 = 0 |

---

## 14. Check List

- [x] 生产调用链按文件/函数画清  
- [x] 合同 12 问作答  
- [x] `MIN_SLICE_SEC` 来源与机制确认  
- [x] 多 Segment 时间基与导出断点确认  
- [x] Response vs Diag 根因函数定位  
- [x] index/zip/filter 风险清单  
- [x] 诊断字段无兼容重命名  
- [x] 修复 Batch 方案可开发  
- [ ] Batch 实施（明确 **不在本轮**）  
- [ ] dialog_200 全量 Word 时长直方图（Batch B 前置）  

---

## 15. Regression Plan

1. 单测：`tone-time-align` / tone diagnostics 字段名。  
2. 多 batch fixture：slices 全量导出。  
3. dialog_200：Pattern Attempt/Hit/Miss；`tonePatternMappingMissCount`；API vs diag slice 差 → 0。  
4. 冻结回归：`谢谢/一下/开始/没有/一点/审一下` + d015/d051/d060/d067/d096。  
5. 确认 Span/KenLM/Domain/Assembly/CNN 无 diff。

---

## 16. Final Verdict

**Tone Evidence 缺失的架构与代码根因已明确；修复方案可直接进入下一轮开发；诊断字段已完成无兼容重命名；除诊断名称外生产业务逻辑未改。**

### 十五问必答

1. **`MIN_SLICE_SEC` 是否直接造成 WTS 无 Slice？** → **是（代码路径直接 `continue`）。**  
2. **造成多少 Pattern Miss？** → **机制可造成 Miss；72 全部为 mapping miss。** 精确「因 dur<0.02」计数需 Batch B 直方图；并须计入 `extract_feature` fail。  
3. **短 Word 为何不能生成 Tone Evidence？** → Inference 在特征提取前丢弃，**不发 Slice**，Word 仍保留。  
4. **能否扩大真实音频窗解决且不伪造？** → **能（方案 A/B）；本轮不实施。**  
5. **多 Segment Slice 在哪一步丢失？** → **`buildCoreResultExtra` 导出 `ctx.asrResult.tone`（首批）；`ctx.acousticToneSlices` 未丢。**  
6. **为何 response 与 diagnostics 不一致？** → 上条；验收脚本又优先读了 response。  
7. **Slice 与 WTS 是否同一时间基？** → **Mapping 路径：是（utterance-local）。** API tone：否（常为 chunk0）。  
8. **是否存在 index/zip/filter 错位？** → Inference zip **安全**；过滤导致 **数量偏斜**；导出截断导致 **观测错位**。  
9. **`mapToneEvidenceForRecall` 是否需要修改？** → **本轮/主修复：否**（除非 Batch D 仅加 reason 返回）。  
10. **合同应由谁保证？** → **Tone Module + Node merge（Evidence SSOT）**；Recall 只消费。  
11. **修复改哪些文件/函数？** → Batch C：`result-builder-core.ts` / `runAsrStep`；Batch B：`run_tone_inference`；Batch A：合同+可选 gate；Batch D：mapping 返回 reason。  
12. **是否影响 Feature Contract/模型？** → **方案要求：不影响。**  
13. **诊断字段是否完成无兼容重命名？** → **是。**  
14. **下一轮可否按方案开发？** → **可以**（先 C 低风险导出修复，并行 A 合同；B 依赖直方图）。  
15. **Span/KenLM/Domain/Assembly 是否未动？** → **是。**

---

**Verdict:** `PASS`（审计 + 命名清理完成；业务修复待 Batch 开发）
