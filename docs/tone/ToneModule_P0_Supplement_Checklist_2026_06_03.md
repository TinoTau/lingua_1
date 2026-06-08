# ToneModule P0 — 补充信息与约束清单

**日期**：2026-06-03  
**对照文档**：[ToneModule P0 冻结开发方案](./ToneModule%20P0%20冻结开发方案.md)  
**代码审计依据**：[FW_Timestamp_Capability_Audit_2026_06_03.md](../pinyin-v2/FW_Timestamp_Capability_Audit_2026_06_03.md) · [FW_Recall_Tone_Constraint_Audit_2026_06_03.md](../pinyin-v2/FW_Recall_Tone_Constraint_Audit_2026_06_03.md) · [ARCHITECTURE.md](../pinyin-v2/ARCHITECTURE.md)  
**性质**：开发前补充清单（非实现）

---

## 0. 用途

本文档在 P0 冻结方案基础上，对照 **当前实际代码**，列出：

1. 方案中 **未写清但实现时必须约定** 的信息  
2. 与现有 runtime **冲突或需替换** 的行为  
3. 建议 **写入 P0 方案或冻结合约** 的补充条目  

---

## 1. 方案歧义 — 需先冻结的定义

### 1.1 主链位置：§五 vs §三 部署位置

| 方案表述 | 矛盾点 | 建议冻结 |
|----------|--------|----------|
| §五 主链：`Recall → ToneModule → Builder` | 暗示 Tone 在 **Node Recall 之后** | 拆成两阶段 |
| §三 部署：`electron_node/services/faster_whisper_vad/` | 暗示 Tone 在 **ASR Worker 内** | 与上并存 |

**推荐冻结（与「避免重复传音频」一致）**：

```text
阶段 A（FW 服务，ASR 时）
  processed_audio + word timestamps
    → ToneModule 推理
    → HTTP 响应附带 toneTokens

阶段 B（Node，FW Detector）
  ctx.asrSegments（含 toneTokens）
    → Recall（不变）
    → toneMatchScore 写入 candidateScore（fw-sentence-rerank-pipeline）
    → Builder → KenLM → Apply
```

§五 主链图中的 `ToneModule` 应标注为 **「声学推理 @ FW；排序信号 @ Node」**，而非在 Recall 与 Builder 之间再跑一遍 CNN。

---

### 1.2 「删除 ToneDistance」与现有代码

| 项 | 代码现状 | P0 约束 |
|----|----------|---------|
| §十五 明确删除 `ToneDistance` / Text Tone | `fw-sentence-rerank-pipeline.ts` **仍在用** | P0 **必须替换** |
| 当前排序链 | `toneDistance(textToToneSyllables(span))` → **排序键 #1** | 改为 `toneMatchScore`（声学），**禁止**继续用 `textToToneSyllables(span.text)` 作 ASR 侧 tone |
| `tone-pinyin.ts` | `textToToneSyllables` / `toneDistance` 仍存在 | 可保留给 **候选词参考 tone** 或 diagnostics；**禁止**作为 ASR span 的 tone 来源 |
| `fw-sentence-rerank-p4.test.ts` | 单测 `toneDistance` | P0 需改测 `toneMatchScore` 或迁移到 Tone 模块单测 |

```ts
// fw-sentence-rerank-pipeline.ts（当前 — 与 P0 原则 1 冲突）
const asrToneKey = toneSyllablesKey(textToToneSyllables(span.text)); // ← 汉字反查，P0 禁止
.sort((a, b) => {
  if (a.toneDistance !== b.toneDistance) return a.toneDistance - b.toneDistance; // ← P0 删除
  ...
});
```

---

### 1.3 ASR 侧声学 tone vs 候选侧参考 tone（原则 1 边界）

方案 §九 `candidateTonePattern`（少冰 `3|1`、烧饼 `1|3`）**必然涉及候选词的字面拼音声调**。

| 侧 | P0 允许来源 | 禁止 |
|----|-------------|------|
| **ASR / Span（query）** | `toneTokens[].tonePosterior`（音频 CNN） | `textToToneSyllables(span.text)` |
| **候选词（reference）** | `HotwordEntry.tonePinyinKey`（词库）或 **仅对候选 word** 的 canonical pinyin-pro | 用 ASR 错字反推的 tone 作 query |

**词库事实**（Tone Audit）：`base_lexicon` **0%** 含数字声调 `tone_pinyin_key`；`domain_lexicon` 约 64%。P0 验收词（烧饼/哨兵/少冰）多数 **无有效 tone_pinyin_key** → 候选侧 fallback **必须写清**：`tonePinyinKey` 缺失时用 `textToToneSyllables(candidate.word)` **仅作 reference**，与 ASR 侧分离。

---

### 1.4 命名冲突：`tone` 在仓库中多义

| 符号 | 实际含义 | 与 ToneModule 关系 |
|------|----------|-------------------|
| `job.pipeline.use_tone` | **YourTTS 音色克隆**（`tone-step.ts`） | **无关** |
| `TONETask` / `TONEStage` | Speaker embedding / clone | **无关** |
| `toneDistance` / `tone-pinyin.ts` | 文本声调距离 | P0 **替换**（ASR 侧） |
| IME `tonePinyin`（dict tsv） | IME 词典静态标注 | **冻结**，不接入 ToneModule |
| `ToneModule`（P0 新增） | 普通话声调 CNN | 新语义 |

**约束**：配置、日志、metrics 使用 **`fwTone` / `toneModule` / `acousticTone`** 前缀，避免与 `use_tone`（TTS）混淆。

---

### 1.5 「禁止修改 Builder 组合逻辑」vs `candidateScore += toneMatchScore`

与 [Domain P2 Supplement](../pinyin-v2/Domain_Constrained_Recall_P2_Supplement_Checklist_2026_06_03.md) 相同：

| 允许 | 禁止 |
|------|------|
| 在 `fw-sentence-rerank-pipeline.ts` 映射 `hits → SpanReplacementPick` 时写入 `candidateScore` / `toneMatchScore` | 修改 `buildSentenceCandidates` 笛卡尔积、`maxSentenceCandidates`、KenLM 输入 |

若与 Domain P2 的 `sentenceDomainMatchScore` **同仓落地**，需冻结 **加分公式与上限**（避免双重排序覆盖）。

---

## 2. FW 时间戳与音频 — 关键约束（来自 FW Timestamp Audit）

### 2.1 word timestamp 已具备，但 Node 未消费

| 事实 | P0 影响 |
|------|---------|
| `asr_worker_process.py` 已 `word_timestamps=True` | **无需**再开开关 |
| `segments[].words[]` 经 HTTP → `ctx.asrSegments` | Node 需 **扩展类型** 并读取 `toneTokens`（新增） |
| FW Detector **不读** `ctx.asrSegments` | P0 必须在 `fw-sentence-rerank-pipeline` 或 orchestrator **注入** tone 数据 |

### 2.2 音频切片 **必须在 FW 服务内**完成（高优先级）

| 项 | 说明 |
|----|------|
| Node `ctx.audio` | 聚合后 **完整 utterance PCM**（`asr-step.ts`） |
| FW `processed_audio` | 经 **VAD 拼接**后的有效语音（`utterance_audio.py`） |
| `words[].start/end` | 相对 **`processed_audio` 时间轴**（0 起），**非** Node 原始 PCM |

**禁止**：Node 用 `ctx.audio` + FW 返回的 `word.start/end` 直接切片做 Tone CNN（**会错位**）。

**必须**：ToneModule 在 FW Worker 内对 **`processed_audio`** 切片；仅将 `toneTokens`（含 `start/end` 与 `token`）传回 Node。

### 2.3 dedup 会丢弃 `words`

`text_processing.update_segments_after_deduplication`：dedup 改文时 **`words=None`**。

| 约束 |
|------|
| `toneTokens` 应在 **dedup 之前**由 ToneModule 生成，并作为 **独立字段** 随响应返回（不依赖 dedup 后重建的 `words`） |
| 或：`toneTokens` 挂在 utterance 顶层 `toneTokens[]`，与 `text` 去重逻辑解耦 |

### 2.4 FW 模式 ASR 参数（已对齐 P0）

`faster-whisper-asr-strategy.ts`（`isFwDetectorEngineEnabled()`）：

- `use_context_buffer: false` — 无前缀上下文，时间轴较干净  
- `use_text_context: false`  
- `beam_size: 1`, `temperature: 0`  

**约束**：Tone P0 验收在 **FW Detector 引擎** 下跑；legacy ASR 路径非 P0 范围。

---

## 3. Recall / Span 集成 — 方案未写清的映射

### 3.1 ApprovedSpan → toneTokens 对齐

| 输入 | 说明 |
|------|------|
| `ApprovedSpan` | `rawSpan`, `start`, `end`（字符偏移，**rawAsrText**） |
| `toneTokens` | 按 **ASR 识别字** 排列，时间来自 `words[]` |
| `words[].word` | 与 `rawAsrText` 字符 **应对齐**（同一次 ASR）；错字时 token 仍是「病」不是「冰」 |

**P0 映射规则（建议冻结）**：

1. 取 span `[start,end)` 覆盖的字符索引  
2. 在 `toneTokens`（或 `words`+tone）中按 **字符顺序** 取子序列  
3. 得到 span 级 `queryTonePattern`（如 `3|4` 对「少病」）  
4. 与候选 `candidateTonePattern` 算 `toneMatchScore`  

**注意**：声学 tone 标在 **实际发音** 上；ASR 字错误时，仍是「对错字发音」的 tone，这正是 P0 要用的信号（区分 病 vs 冰 的发音）。

### 3.2 CJK word token 粒度

faster-whisper 中文多为 **单字 word**，偶发 `"可以"` 等多字 token。

| 约束 |
|------|
| 映射层需支持 **一字一 token** 与 **多字 token** 展开 |
| `ToneToken.token` 与 `words[].word` 对齐，不要求与 ApprovedSpan 等长 |

### 3.3 span 内排序 vs 硬过滤

方案原则 3：**Ranking only**。

| 当前代码 | P0 |
|----------|-----|
| `toneDistance` 作 **sort key #1**（实质软优先） | `toneMatchScore` 并入 **`candidateScore`**，**禁止**单独 sort 键压过 prior 过多 |
| 无 hard filter | 保持；`toneMatchScore=0` 时降级为现有 prior/recall 排序 |

### 3.4 Recall 路径不受 Tone 影响

| 路径 | Tone P0 |
|------|---------|
| `recallSpanTopK` / SQL | **不改** |
| HintGate `lexiconNearNeighbor` | **不改**（仍 `recallSpanTopK(...,1,...)`，无 tone） |
| IME | **不改** |

---

## 4. 数据结构与 HTTP 契约 — 需补充字段

### 4.1 方案仅有 `Segment.toneTokens`

建议 **同时** 定义 utterance 级扁平表，便于 span 查询：

```ts
// 建议补充（diagnostics + 映射）
export interface UtteranceTonePayload {
  toneEnabled: boolean;
  toneTokens: ToneToken[];      // 全句扁平，按 start 排序
  toneTokenCount: number;
  toneConfidenceAvg?: number;
  skippedReason?: 'no_audio' | 'no_timestamps' | 'non_zh' | 'model_error';
}
```

挂接点：

| 层 | 文件 |
|----|------|
| Python | `shared_types.py` / `api_models.py` `UtteranceResponse` |
| Node | `task-router/types.ts` `ASRResult` |
| Pipeline | `JobContext`：`asrTone?: UtteranceTonePayload`（或嵌入 `asrResult`） |
| FW 结果 | `FwDetectorResult` diagnostics（§十一 字段） |

### 4.2 `SegmentInfo` 扩展（Node 已有 `words`）

```ts
// types.ts — 建议与方案一致
export interface SegmentInfo {
  // ... existing
  words?: AsrWordInfo[];
  toneTokens?: ToneToken[];  // P0 新增
}
```

### 4.3 与 `words` 字段关系

| 约束 |
|------|
| **禁止**修改已有 `text` / `segments` / `words` 语义 |
| `toneTokens` 为 **纯增**；可与 `words` 并行（同 start/end） |
| README 示例（`faster_whisper_vad/README.md`）**未文档化 words** — P0 应更新服务 README |

---

## 5. Tone Model — 实现约束补充

### 5.1 性能「单句 <20ms」

| 需澄清 | 建议 |
|--------|------|
| 20ms 指 **整句所有字** 还是 **单字**？ | 冻结为：**整句 tone 推理 ≤20ms（CPU）**（P0 目标） |
| 字数量 | Dialog200 平均音频 ~3.5s，CJK 约 10–30 字；需 **batch 推理** 或轻量 CNN |
| 与 ASR 关系 | Tone 在 Worker **transcribe 之后**；计入 `asr_latency_ms` 子项还是独立 `tone_inference_ms` — **需 diagnostics 拆分** |

### 5.2 采样率与 Mel

| 项 | 代码事实 |
|----|----------|
| 服务采样率 | 16 kHz（`sample_rate` 默认 16000） |
| `processed_audio` | `float32` numpy |
| P0 Mel 80 维 | 与 Whisper 内部特征 **无关**；独立提取需在 FW 服务实现 |

### 5.3 语言与降级（§十三 安全）

| 条件 | 行为（建议写死） |
|------|------------------|
| `src_lang` 非 `zh`/`yue` | `toneEnabled=false`（`isFwDetectorLanguage` 含 `yue`，P0 CNN 是否支持粤语？**建议 P0 仅 `zh`**） |
| `words` 为空 / 无 timestamp | 跳过 Tone，`toneMatchScore=0` |
| Tone 模型加载失败 | ASR 仍返回 text；**无 toneTokens** |
| 非 FW 引擎 | ToneModule 不运行 |

---

## 6. 与 Domain-Constrained Recall P2 的协同

若两线并行改 `fw-sentence-rerank-pipeline.ts`：

| 信号 | 来源 | 注入点 |
|------|------|--------|
| `sentenceDomainMatchScore` | 句级 domain（P2） | `SpanReplacementPick.candidateScore` |
| `toneMatchScore` | 声学 tone（P0） | 同上 |

**必须冻结**：

```text
finalCandidateScore =
  baseCandidateScore
  + wDomain * sentenceDomainMatchScore   // P2
  + wTone * toneMatchScore               // P0
```

权重、`wTone` 上限、是否与现有 `candidateScore`（含 domainBoost）叠加 — **P0/P2 联合冻结**，避免重复加分。

---

## 7. P0 验收样本 — 代码层限制

### 7.1 方案 §十四 样本

| 样本 | Tone P0 能提供什么 | 不能单独解决 |
|------|-------------------|--------------|
| 少病 → 少冰 / 烧饼 / 哨兵 | 声学区分 **bing1 vs bing4** 等，提升 **ranking** | 少冰 **不在词库** → NOT_FOUND 仍在 |
| 评审 / 平身 | 声调差异（若 span 含评审且未被滤） | span=评审时同文被滤，只剩平身 — **IME 问题** |
| 上线 / 上限 | 声调 4 vs 4 等 | 需候选在 recall 池内 |

### 7.2 验收指标拆分

| 类别 | 可验收 |
|------|--------|
| **声学 Tone** | `toneTokens` 输出；`tonePosterior` 合理；`toneMatchScore` 对 少冰 vs 烧饼/哨兵 **有区分度** |
| **端到端 Apply** | **非 P0 必达**（KenLM / 词库覆盖另议） |

### 7.3 与 Tone Constraint Audit 关系

| 审计结论 | P0 关系 |
|----------|---------|
| 旧 `toneDistance` 对 base **无效** | P0 **删除**文本 tone 排序，改用声学 |
| FW 不提供 tone 文本 | P0 一致 |
| 词库 `tone_pinyin_key` base 无效 | 候选 reference 需 fallback 规则（§1.3） |

---

## 8. 冻结边界 — 需补充的允许改动白名单

方案 §二 / §十三 禁止改 IME/HintGate/ApprovedSpan/Apply — **同意**。

**建议显式允许改动**：

| 允许 | 禁止 |
|------|------|
| `services/faster_whisper_vad/` 新增 ToneModule、扩展 Response | 改 Whisper `transcribe` 主逻辑（除 tone 后处理） |
| `task-router/types.ts` 扩展 `ASRResult` / `SegmentInfo` | 改 `POST /utterance` 已有字段语义 |
| `fw-sentence-rerank-pipeline.ts` tone 排序 → score | 改 `build-sentence-candidates.ts` 组合算法 |
| `fw-detector-orchestrator.ts` **仅**传递 `ctx.asrTone` 到 pipeline（可选） | 改 IME/HintGate/Apply |
| `freeze-contract.test.ts` 增补 Tone 边界 | 恢复 legacy `fw-metadata-span-gate` |

---

## 9. 实施 Checklist（合并 P0 §十二、§十三）

### 9.1 方案冻结（文档）

- [ ] 澄清 Tone 推理 @ FW、toneMatchScore @ Node 两阶段  
- [ ] 禁止 Node 用 `ctx.audio` + FW timestamp 直接切片  
- [ ] 冻结 ASR query tone 仅来自 `toneTokens`；候选 tone 来自 lexicon / candidate-word pinyin-pro  
- [ ] 冻结 `toneTokens` 与 dedup 解耦  
- [ ] 命名与 `use_tone`（YourTTS）区分  
- [ ] 冻结 `candidateScore` 注入点（pipeline，非 Builder）  
- [ ] 冻结与 Domain P2 的 score 合成公式  
- [ ] 冻结 P0 语言范围：**zh only**（或明确 yue 排除）  
- [ ] 验收拆分：声学 ranking vs 端到端 Apply  

### 9.2 FW 服务

- [ ] ToneModule（CNN + Mel）在 `processed_audio` 上切片  
- [ ] `ToneToken` / `tonePosterior` DTO  
- [ ] `UtteranceResponse` 增加 `toneTokens`（或顶层 payload）  
- [ ] dedup **前**生成 tone；dedup 不清空 tone  
- [ ] diagnostics：`tone_inference_ms`、`toneTokenCount`  

### 9.3 Node 客户端与 Pipeline

- [ ] `ASRResult` / `SegmentInfo` 类型扩展  
- [ ] `asr-step` 保存 `toneTokens` 到 `ctx`  
- [ ] `fw-sentence-rerank-pipeline`：删除 `textToToneSyllables(span)` 排序  
- [ ] 实现 `toneMatchScore` + `candidateScore` 加权  
- [ ] `FwDetectorResult` diagnostics（§十一）  
- [ ] 无 tone 时降级（score=0，走原排序）  

### 9.4 模型与资产

- [ ] CPU 离线 CNN &lt;5MB  
- [ ] 模型文件路径 / bundle 约定（`faster_whisper_vad/models/tone/`？）  
- [ ] 单句推理 ≤20ms（CPU）基准测试方法  

### 9.5 测试

- [ ] 单元：`toneMatchScore(少冰|3,1 vs 烧饼|1,3)`  
- [ ] 集成：HTTP 响应含 `toneTokens`  
- [ ] 回归：`fw-sentence-rerank-p4.test.ts` 迁移  
- [ ] freeze-contract：IME 不 import ToneModule  

### 9.6 明确不做（与方案 §十五 对齐）

- [ ] 不恢复文本 `toneDistance` 作 ASR query  
- [ ] 不做 Forced Alignment（WhisperX）  
- [ ] 不做第二套 ASR  
- [ ] Tone 不参与 Span Discovery / HintGate / KenLM / Apply  
- [ ] 不在 Node 重跑 Tone CNN（P0）  

---

## 10. 关键代码索引

| 主题 | 路径 |
|------|------|
| `word_timestamps=True` | `services/faster_whisper_vad/asr_worker_process.py` |
| VAD 后 `processed_audio` | `services/faster_whisper_vad/utterance_audio.py` |
| dedup 丢 words | `services/faster_whisper_vad/text_processing.py` |
| Node ASR 请求 | `task-router/faster-whisper-asr-strategy.ts` |
| `ctx.asrSegments` | `pipeline/steps/asr-step.ts` |
| **待替换** tone 排序 | `fw-detector/fw-sentence-rerank-pipeline.ts` |
| 文本 tone（候选侧） | `lexicon/phonetic/tone-pinyin.ts` |
| 词库 tone_pinyin_key | `lexicon-v2/lexicon-runtime-v2.ts` |
| YourTTS `use_tone`（无关） | `pipeline/steps/tone-step.ts` |
| FW 语言门控 | `fw-detector/fw-mode.ts` |

---

**清单完成。本文档仅补充约束与信息，不代表 P0 方案已修订。**
