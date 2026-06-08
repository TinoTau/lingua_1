# ToneModule P0 — Design Drift Audit

**日期**：2026-06-07  
**性质**：只读审计（禁止开发 / 调参 / 改模型 / 改 IME / Recall / KenLM / Apply）  
**关联**：[Final Acceptance Report](./ToneModule_P0_Final_Acceptance_Report_2026_06_07.md) · [Mandatory Addendum](./ToneModule%20P0%20%20补充冻结方案（Mandatory%20Addendum）.md)

---

## 执行摘要

| 审计问题 | 结论 |
|----------|------|
| Tone 数据源 | **A. 原始音频 + CNN**（生产路径）；**非** span/candidate 文本反查 |
| Tone 接入方式 | **B. Recall 后 toneMatchScore 排序**；**非** Recall 前 tone query |
| 相对原始设计 | **明显偏离** — 已实现为「独立 Recall 后排序模块」 |
| SSOT | **断裂** — `response.text`（dedup 后）≠ tone 对齐所用 word token 文本 |
| 建议 | **回滚 toneMatchScore**；改为 **tone-aware pinyin recall**；允许进入 **P0.5 Design Correction** |

---

## 第一部分 — Tone 数据源审计

### 1.1 FW Phase A（Python）— 真实音频路径

**调用链**（`api_routes.py` L273–281，dedup 之前）：

```text
processed_audio + segments[].words[].start/end
  → tone_module/inference.py :: run_tone_inference
    → _slice_audio(processed_audio, w.start, w.end)     # 按字级时间戳裁切
    → mel.py :: extract_mel_features(slice)               # 80-dim log-mel
    → classifier.py :: predict_batch(mel) → softmax(5)    # CNN 后验
    → ToneToken { token=w.word, tonePosterior, ... }
```

| # | 问题 | 答案 | 证据 |
|---|------|------|------|
| 1 | `tonePosterior` 是否由 CNN 输出？ | **是** | `classifier.py:81-90` `predict_batch` → `_softmax`；`inference.py:99-110` |
| 2 | CNN 输入是否来自 `processed_audio` slice？ | **是** | `inference.py:91` `_slice_audio(processed_audio, ...)` |
| 3 | slice 是否按 `words[].start/end` 裁切？ | **是** | `inference.py:87-92` 遍历 `SegmentInfo.words` |
| 4 | 是否存在 `textToToneSyllables(span.text)` 作 ASR query tone？ | **否（主链）** | `fw-detector/` 内 0 处引用；仅 `tests/experiments/*.mjs` 探针使用 |
| 5 | 是否存在 FW text → pinyin-pro → tone 作 ASR query？ | **否** | ASR query 仅来自 `UtteranceResponse.tone.toneTokens[].tonePosterior` |
| 6 | 是否存在 `candidate.word` → pinyin-pro → tone？ | **是，仅 candidate 侧** | `tone-match-score.ts:67-68` → `resolveTonePinyinKey`；`pinyin-resolve.ts:65-67` pinyin-pro fallback |
| 7 | 报告里 `query=3\|4` 来源？ | **验收脚本合成，非 CNN** | `tone-module-p0-final-acceptance.mjs` `buildTone(raw,'3\|4')` 手工设 `t3=0.88,t4=0.88`；真实 CNN 输出为完整 posterior 分布 |

**补充说明**：

- `ToneToken.token` 字段来自 **FW ASR `words[].word` 文本**，不是 CNN 识别；CNN 只产出 **声调后验**。
- `asr_worker_process.py` 负责 Whisper ASR 推理；Tone 不在 worker 内，而在主进程 `api_routes.py` 对 `processed_audio` 后处理。
- `tone-pinyin.ts` 中 `textToToneSyllables` **仍存在于工具库**，但 **已退出 fw-detector 主链**（Runtime Acceptance 已验证）。

### 1.2 Node Phase B — query 构建

`buildSpanQueryToneTokens`（`tone-match-score.ts:102-111`）：

1. 读取 `UtteranceTonePayload.toneTokens`（HTTP 下发的 CNN 后验）
2. `alignToneTokensToChars(rawText, toneTokens)` — 用 **字形匹配** 将 token 映射到 `rawText` 字符索引
3. 取 `span[start:end)` 对应 token 列表作为 query

**ASR query tone 成分**：

| 成分 | 来源 | 是否文本反查 |
|------|------|-------------|
| 声调后验 | CNN | 否 |
| 字符对齐 | `token.token`（ASR word 文本）vs `rawText` | 依赖 ASR 字形，非 pinyin-pro |
| Candidate 调类 | `hotword.tonePinyinKey` → pinyin-pro fallback | 仅 candidate reference |

**结论（第一部分）**：FW 侧 **确实从音频识别 tone**；Node 侧 **未用 span.text 反查作 query**，但用 **字形对齐** 绑定 posterior，且 candidate 侧允许 pinyin-pro fallback。

---

## 第二部分 — Tone 接入方式审计

### 2.1 当前调用序（`fw-sentence-rerank-pipeline.ts`）

```text
for each span:
  ① buildSpanQueryToneTokens(rawText, span.start, span.end, tone)   # 声学 query
  ② recallSpanTopK(span.text, ...)                                  # plain pinyin recall（无 tone 入参）
  ③ for each hit:
       toneMatchScore = computeToneMatchScore(queryTokens, hit.tonePinyinKey, hit.word)
       candidateScore = hit.candidateScore + wTone * toneMatchScore
  ④ sort hits by candidateScore
  ⑤ buildSentenceCandidates → KenLM rerank → Apply
```

| # | 问题 | 答案 |
|---|------|------|
| 1 | `toneTokens` 是否进入 Recall **之前**？ | **否** — 在 Recall **之后**才用于打分 |
| 2 | `recall-span-topk-v2.ts` 是否接收 acoustic tone query？ | **否** — 输入仅 `syllables`, `windowText`, `topK`, `profile`, `domainIds` |
| 3 | `local-span-recall.ts` 是否用 tone pattern 查库？ | **否** — `textToSyllables(trimmed)` → `syllablesKey` → SQL `pinyin_key` 查询 |
| 4 | `fw-sentence-rerank-pipeline.ts` 是否在 Recall 后算 `toneMatchScore`？ | **是** — L146-155 |
| 5 | `toneMatchScore` 是否写入 `candidateScore`？ | **是** — `finalCandidateScore = base + wTone * toneMatchScore` |
| 6 | 当前属于哪种？ | **Recall 后排序**（非 Recall 前约束） |

### 2.2 Recall SQL 层

`recall-span-topk-v2.ts` L198-199：

```typescript
const key = syllablesKey(syllables);  // plain pinyin，无 tone
const tier = collectTierCandidates(runtimeV2, key, termLength, domainIds, perSpanLimit);
```

`tone_pinyin_key` 从 DB 读出并附在 `HotwordEntry` 上（`lexicon-runtime-v2.ts:55`），但 **不参与 SQL WHERE**，仅在 Recall 后的 `toneMatchScore` 中使用。

---

## 第三部分 — 设计偏移判定

### 原始设计（目标）

```text
ToneModule → acoustic tone pattern
           → plain pinyin + acoustic tone → Pinyin Recall query
           → 召回 tone-compatible 候选
```

### 当前实现

```text
ToneModule → toneTokens (HTTP)
           → plain pinyin Recall（无 tone）
           → toneMatchScore 加权 candidateScore
           → KenLM sentence rerank
```

### 判定

| 维度 | 判定 |
|------|------|
| **当前实现属于** | **偏离设计：Recall 后 toneMatchScore 排序器** |
| 与「Tone 不应变成单纯 Recall 后排序器」 | **冲突** |
| 与「Tone 不应根据 FW 输出文字反查 tone」 | FW 推理本身合规；Node 对齐依赖 ASR 字形，存在间接耦合 |

---

## 第四部分 — SSOT 对齐问题审计

### 4.1 各字段来源

| 字段 | 来源 | 文件 |
|------|------|------|
| `rawAsrText` | `ctx.asrResult.text`（单次 FW HTTP `response.text`） | `asr-step.ts:350-353` |
| `tone` | 同次 HTTP `response.data.tone` | `faster-whisper-asr-strategy.ts:90` |
| `toneTokens[].token` | **dedup 前** `words[].word` | `inference.py:107`（tone 在 dedup 前生成） |
| HTTP `response.text` | **dedup 后** `full_text_trimmed` | `api_routes.py:312,437` |
| `ApprovedSpan.start/end` | IME 在 `rawAsrText` 上的字符索引 | `map-approved-span-to-fw.ts:17-18` |

### 4.2 断裂点

```text
api_routes.py:
  L274  run_tone_inference(segments_info)     ← pre-dedup words
  L312  process_text_deduplication(text)      ← 可能改 text
  L437  response.text = full_text_trimmed      ← post-dedup
  L445  response.tone = tone_payload           ← pre-dedup 对齐的 tokens
```

Node：

```text
rawAsrText  = response.text          (post-dedup)
toneTokens  = response.tone          (pre-dedup word 绑定)
alignToneTokensToChars(rawAsrText, toneTokens)  ← 字形不一致 → queryLen=0
```

### 4.3 必答问题

| # | 问题 | 答案 |
|---|------|------|
| 1 | `rawAsrText` 来自哪里？ | 单次 FW `/utterance` 的 `response.text`（post-dedup） |
| 2 | `toneTokens` 对齐哪一个 text？ | **implicit**：pre-dedup ASR `words[].word` 序列；Node 尝试对齐 post-dedup `rawAsrText` |
| 3 | `ApprovedSpan` char index 对应哪一个 text？ | `rawAsrText`（与 `ctx.rawAsrText` 一致） |
| 4 | d003 为何 pipeline=少病、独立 FW=烧病？ | **不同 HTTP 调用** + ASR 非确定性；同次调用内还可能叠加 dedup 字形漂移 |
| 5 | 是否存在二次 ASR？ | FW 路径默认 **否**（`disableAsrRerun: true`）；Final A/B 对同一 wav 两次 pipeline 属实验设计，非单请求内双 ASR |
| 6 | dedup / normalization 导致不一致？ | **是** — dedup 改 `response.text` 但不改 `tone_payload`；IME `normalizeForImeAlignment` 不改 `rawAsrText` |
| 7 | 是否应以 `ASRResult.text` 为唯一 SSOT？ | **是**，且 tone 对齐必须绑定 **同一次、同一版本** 的 text |
| 8 | 是否应将 `toneTokens` 绑定同一 `ASRResult.text`？ | **是** — 或附带 `toneAlignmentText` / 时间戳索引，避免 post-dedup 漂移 |

### 4.4 d003 探针（Final Acceptance 已记录）

```
pipeline rawAsrText : …可以少病吗…我赶时间小悲。
FW 独立调用 text  : …可以烧病吗…我赶时间小呗!
buildSpanQueryToneTokens(pipeline raw) → queryLen = 0
buildSpanQueryToneTokens(FW text)      → queryLen = 2
→ toneScoreAppliedCount = 0 → Tone 未进入 E2E 排序
```

---

## 第五部分 — 最小回归方案（设计层，本轮不实施）

**目标**：ToneModule 只输出 **per-char acoustic tone pattern**；不作为独立 ranking module。

```text
[保留] FW: processed_audio + word timestamps → CNN → toneTokens
[修复] SSOT: tone 对齐文本与 Node rawAsrText 同源（或时间戳映射）
[迁移] span → extract acousticTonePattern[] (argmax or posterior)
[迁移] recallSpanTopK(syllables, acousticTonePattern?)
[停用] fw-sentence-rerank-pipeline toneMatchScore / wTone
```

**不改**：IME · HintGate · Builder · KenLM · Apply · CNN 模型 · 训练。

---

## 第六部分 — 推荐改法草案评估

| # | 改法 | 可行性 | 说明 |
|---|------|--------|------|
| 1 | 保留 FW Worker ToneModule | ✅ | 已符合设计，无需重训 |
| 2 | 保留 `UtteranceResponse.tone` | ✅ | |
| 3 | 删除/停用 rerank 中 `toneMatchScore` / `wTone` | ✅ | 回归核心；改动集中 |
| 4 | `recallSpanTopK` 增 `acousticTonePattern?: number[]` | ✅ | 需改 recall **接口**，但不改 SQL schema |
| 5 | recall 先 plain pinyin，再 tone-compatible 优先 | ✅ | post-SQL merge 阶段重排；符合「soft preference」 |
| 6 | candidate tone：`tone_pinyin_key` 优先，pinyin-pro fallback | ✅ | 已存在；保持 **仅 candidate reference** |
| 7 | ASR query tone 禁止 span.text 反查 | ✅ | 主链已满足；需固化契约测试 |
| 8 | tone 无效 → plain pinyin fallback | ✅ | 与 Fail-Open 一致 |
| 9 | P0 soft preference，非 hard filter | ✅ | 推荐 `stable sort`：compatible 在前，incompatible 保留 |
| 10 | diagnostics：`acousticTonePattern`, `recallToneCompatibleCount` | ✅ | 补可观测性 |

**风险**：

- 改 recall 排序触及 `local-span-recall.ts` + `recall-span-topk-v2.ts`，属 **P0.5 设计纠正**，不是本轮审计范围。
- SSOT 修复若放在 FW（返回 `toneAlignmentText`）比纯 Node 补丁更稳。

---

## 第七部分 — 最终结论

| # | 问题 | 结论 |
|---|------|------|
| 1 | 当前 ToneModule 是否真的从音频识别 tone？ | **是（FW CNN 路径真实存在）**；Node 未反查 span 文本作声调 |
| 2 | 当前 ASR query tone 是否混入文本反查？ | **主链未用 pinyin-pro 反查 span**；但对齐依赖 ASR `word` 字形 + post-dedup `rawAsrText`，等效 **文本耦合** |
| 3 | 当前 ToneModule 是否偏离为 Recall 后排序器？ | **是** — `recallSpanTopK` 无 tone → `toneMatchScore` 加权 `candidateScore` |
| 4 | SSOT 对齐失败根因？ | **tone 在 dedup 前生成、`response.text` 在 dedup 后返回**；Node 用 dedup 后 text 做字形对齐 |
| 5 | 是否需要回滚 `toneMatchScore`？ | **是** — 偏离原始设计且 E2E 无效（`toneScoreAppliedCount=0`） |
| 6 | 是否应改为 tone-aware pinyin recall？ | **是** — 与 Mandatory Addendum 原始链路一致 |
| 7 | 最小修改文件清单？ | 见下表 |
| 8 | 是否允许进入 P0.5 Design Correction？ | **是** — 仅限设计回归，不扩模型/数据集 |

### 最小修改文件清单（P0.5 建议范围）

| 文件 | 动作 |
|------|------|
| `fw-sentence-rerank-pipeline.ts` | 移除 `toneMatchScore` / `wTone` / post-recall 加权 |
| `fw-tone-config.ts` | 停用或删除 `wTone` |
| `tone-match-score.ts` | 保留 posterior 工具；新增 `extractAcousticTonePattern`；移除或拆分 candidate scoring |
| `local-span-recall.ts` | 接口增加 `acousticTonePattern?` |
| `recall-span-topk-v2.ts` | post-merge tone-compatible 优先排序 |
| `api_routes.py` / `api_models.py` | SSOT：返回 `toneAlignmentText` 或保证 `tone` 与 `text` 字符索引一致 |
| `faster-whisper-asr-strategy.ts` / `task-router/types.ts` | 传递对齐元数据 |
| `fw-detector-orchestrator.ts` | 传入 acoustic pattern 至 recall；更新 diagnostics |
| `tone-module-p0-final-acceptance.mjs` | 验收改为 recall-path 探针（非 rerank A/B） |

**明确不修改（P0.5 约束）**：IME · HintGate · Builder · KenLM · Apply · CNN 权重 · 训练脚本。

---

## 附录 — 代码证据索引

| 主题 | 文件:行 |
|------|---------|
| CNN 音频裁切 | `tone_module/inference.py:87-99` |
| dedup 在 tone 之后 | `api_routes.py:274` < `api_routes.py:312` |
| response.text post-dedup | `api_routes.py:437` |
| Recall 无 tone | `recall-span-topk-v2.ts:36-45`, `198-199` |
| Recall 后打分 | `fw-sentence-rerank-pipeline.ts:128-175` |
| candidate pinyin-pro | `pinyin-resolve.ts:65-67` |
| rawAsrText SSOT | `asr-step.ts:350-353`, `fw-detector-orchestrator.ts:138` |
| Legacy 已清理 | `fw-detector/` 无 `textToToneSyllables` / `toneDistance` |

---

**签署建议**：当前实现为 **「音频 CNN + Recall 后排序」混合体**，与 **「音频 tone → pinyin recall query」** 原始设计 **不一致**。建议批准 **ToneModule P0.5 Design Correction**（设计回归），**不批准 P0 冻结**。
