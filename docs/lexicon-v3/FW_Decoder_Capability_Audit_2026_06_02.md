# FW Decoder 内部信息只读审计

> **日期：** 2026-06-02  
> **性质：** 只读事实分析；未改代码、配置、FW 服务  
> **范围：** Faster-Whisper（`faster-whisper-vad`）Decoder 是否产生比 top1 更多的信息，以及当前服务是否丢弃  
> **版本：** 仓库 `faster-whisper>=1.0.0`；审计机实测库 **faster_whisper 1.2.1**  
> **对照：** 同仓库 **Sherpa CTC** 路径有 `nbest[]`（FW 路径 **无**）

---

## 执行摘要

| 问题 | 结论 |
|------|------|
| Decoder 是否产生比 top1 更多信息？ | **库内部有，服务/API 几乎全丢** |
| 能否得到「候 0.48 / 後 0.51」式 **同位竞争 token**？ | **当前不能** |
| `word.probability` 是什么？ | **已选路径上 alignment 置信度均值**，非 vocab posterior |
| `beam_size=1` 是否丢失候选？ | **是**（仅保留 `sequences_ids[0]`） |
| `beam_size>1` 能否拿到 beam 路径？ | **库内可能有，faster-whisper 与本服均未导出** |
| N-best / lattice | **FW 路径未实现**；Sherpa CTC 有 `decode_beams` n-best |
| 对 Span Detection 最有价值且可验证的方向 | **导出 beam 多假设（句级 diff）** > token posterior（需改库/CT2） |

---

## 第一部分 — FW Decoder Configuration Report

### 1.1 Python Worker（`asr_worker_process.py` → `model.transcribe()`）

| 参数 | 生产 FW P0 值 | 说明 |
|------|---------------|------|
| **`beam_size`** | **1**（Node 传入；默认 `config.BEAM_SIZE=1`） | 传入 transcribe |
| **`best_of`** | **通常未传**（FW P0 Node 不传） | 仅 **temperature>0** 时 faster-whisper 用作 `num_hypotheses` |
| **`patience`** | 可选，默认未传 | beam search patience |
| **`temperature`** | **0**（FW P0 固定） | 0 → 走 beam；非 0 → sampling + best_of |
| **`condition_on_previous_text`** | **false**（Node FW P0） | |
| **`word_timestamps`** | **True**（硬编码） | 触发 align + Word 列表 |
| **`vad_filter`** | **False** | Silero VAD 在前 |
| **`initial_prompt`** | 可选（FW P0 关闭 text context） | |
| **`log_prob_threshold` / `compression_ratio_threshold` / `no_speech_threshold`** | 可传，默认库默认 | 影响 temperature fallback，非多候选输出 |

### 1.2 Node（`faster-whisper-asr-strategy.ts`，`isFwDetectorEngineEnabled()`）

| 参数 | 值 |
|------|-----|
| `beam_size` | **1** |
| `temperature` | **0** |
| `condition_on_previous_text` | **false** |
| `use_context_buffer` / `use_text_context` | **false** |
| `best_of` | **未发送** |
| ASR rerun | **关闭** |

### 1.3 与 decoder candidate 相关的其它参数

| 参数 | 是否影响「多候选输出」 |
|------|------------------------|
| `return_scores=True`（库内 CT2 generate） | 仅 **top1 序列** 的 score |
| `return_no_speech_prob` | 段级，非 token 竞争 |
| `language_probabilities` | **语言** posterior，非字词 |
| `patience` | 仅 beam 搜索宽度，不导出 beam 列表 |

---

## 第二部分 — FW Raw Decoder Output Report

### 2.1 `faster_whisper.transcribe()` 返回（库级，非本服 HTTP）

**`segments` 迭代元素 — `Segment` dataclass：**

| 字段 | 类型 | 本服是否落盘 |
|------|------|--------------|
| `id`, `seek`, `start`, `end` | int/float | start/end ✓ |
| `text` | str | ✓ |
| **`tokens`** | **`List[int]`** | **✗ 丢弃** |
| `avg_logprob` | float | ✓ |
| `compression_ratio` | float | ✓ |
| `no_speech_prob` | float | ✓（段级） |
| `temperature` | float | ✗ |
| **`words`** | **`List[Word]`** | 部分 ✓ |

**`Word` dataclass（库公开）：**

| 字段 | 说明 |
|------|------|
| `word` | 文本（字/词片段） |
| `start`, `end` | 秒 |
| `probability` | float |

**库内部 `find_alignment` 中间 dict 另有 `tokens`（token id 列表），但未进入公开 `Word` dataclass。**

**`TranscriptionInfo`：** `language`, `language_probability`, `all_language_probs`, `duration`, `transcription_options` — **无 n-best 文本**。

### 2.2 本服 HTTP `UtteranceResponse`（`api_models.py` / worker 队列）

```json
{
  "text": "...",
  "segments": [{
    "text": "...",
    "start": 0.0, "end": 2.9,
    "avg_logprob": -0.26,
    "compression_ratio": null,
    "no_speech_prob": null,
    "words": [{ "word": "...", "start": 0.0, "end": 0.4, "probability": 0.76 }]
  }],
  "language": "zh",
  "language_probability": null,
  "language_probabilities": { "...": 0.99 },
  "duration": 3.6,
  "vad_segments": [[0, 57600]],
  "diagnostics": { ... }
}
```

**不存在字段：** `nbest`, `beams`, `hypotheses`, `token_ids`, `token_logprobs`, `alternatives`, `lattice`.

### 2.3 Node `ASRResult`（FW 路径）

仅映射：`text`, `segments`, `language*`, `diagnostics`。**不调用** `mapCtcUtteranceResponse`（该 mapper 服务于 **Sherpa CTC** 的 `nbest[]`）。

Pipeline 文档：**FW 路径不输出 `asr_nbest`**；批测契约 **`ctc_nbest_present` = fail**。

---

## 第三部分 — Token Information Report

### 3.1 库内是否存在 token 级信息？

| 信息 | 库内 | 本服 API |
|------|------|----------|
| **token ids** | ✓ `Segment.tokens` | ✗ |
| **token logprobs（decode 步 vocab softmax）** | ✗ 不暴露 | ✗ |
| **token posterior / 同位候选排名** | ✗ | ✗ |
| **`text_token_probs`（align 阶段）** | ✓ 内部 `find_alignment` | ✗ |
| **word.probability** | ✓ | ✓ |

### 3.2 `word.probability` 的真实含义（faster_whisper 1.2.1 源码）

```python
# find_alignment → 对已选定 text_tokens 做 model.align()
text_token_probs = result.text_token_probs
word_probabilities = [np.mean(text_token_probs[i:j]) for i, j in word_boundaries]
```

这是 **「已解码 token 序列」在 forced alignment 下的置信度**，**不是** decode 时刻「候 vs 後 vs 厚」的 softmax 竞争分布。

### 3.3 必答题

| # | 问题 | 答案 |
|---|------|------|
| 1 | 当前服务是否丢弃 token 级信息？ | **是** — `Segment.tokens`、align 中间 `text_token_probs` 均未导出 |
| 2 | 是否只保留最终文本？ | **否** — 还保留段/词时间戳与 word probability；但 **decode 候选面** 等价于 top1 |
| 3 | 能否获取 token confidence？ | **仅** 已选 token 的 alignment 置信（聚合为 word.probability）；**无** per-position 竞争 |

---

## 第四部分 — Alternative Token Capability Report

### 4.1 Top-K / Alternative / Per-position / Token Distribution

| 能力 | faster-whisper 公开 API | 本服 |
|------|-------------------------|------|
| Top-K Token（同位） | **不支持** | **不支持** |
| Alternative Token | **不支持** | **不支持** |
| Per-position Candidate | **不支持** | **不支持** |
| Token Distribution | **不支持** | **不支持** |

### 4.2 必答：「候」能否看到「候 0.48 / 後 0.51 / 厚 0.01」？

**不能。** 当前任何一层（CT2 generate → faster-whisper → Python worker → HTTP → Node）**都不输出**该结构。

高置信同音错误（如「上限計劃」）在数据上表现为：**错误 token 的 word.probability 仍可 >0.8**（见 word 边界审计），与「竞争 posterior」无关。

---

## 第五部分 — Beam Search Capability Report

### 5.1 库内行为（`generate_with_fallback`）

```python
result = self.model.generate(..., beam_size=options.beam_size, return_scores=True, ...)[0]
tokens = result.sequences_ids[0]   # 仅第一条假设
```

- **temperature = 0：** `beam_size` 控制 CT2 beam 宽度；**只取 `sequences_ids[0]`**  
- **temperature > 0：** `beam_size=1`, `num_hypotheses=best_of`（采样多条）；**仍只取 `[0]`**

### 5.2 必答题

| # | 问题 | 答案 |
|---|------|------|
| 1 | `beam_size=1` 是否天然丢失所有候选？ | **是** — 仅一条解码路径进入后续 align |
| 2 | `beam_size>1` 能否获得候选路径？ | **库内 CT2 `result.sequences_ids` 可能有多条**；**faster-whisper 与本服均未读取/导出** |
| 3 | 「候選生成」vs「後選生成」会否同时出现在 beam 内？ | **理论上可能**（不同 beam 假设全文不同）；**当前无法观测**；需改库/服务导出 `sequences_ids[1:]` 或多次 decode |

**生产配置：** Node FW P0 **`beam_size=1`** → 连库内多 beam 都 **未启用**。

---

## 第六部分 — N-Best Capability Report

### 6.1 对比（同仓库事实）

| 路径 | N-best | 实现 |
|------|--------|------|
| **Sherpa CTC** (`asr_sherpa_lm/ctc_decode.py`) | **✓** `decode_beams` → `nbest[]` | pyctcdecode + 可选 KenLM |
| **Faster-Whisper** | **✗** | 无句级 n-best API |

### 6.2 必答题

| # | 问题 | 答案 |
|---|------|------|
| 1 | FW 官方能力是否支持 N-best？ | **不支持**（无 documented n-best transcript API） |
| 2 | 当前仓库版本是否支持？ | **依赖库 1.x：不支持** |
| 3 | 当前服务是否实现？ | **否** |
| 4 | 是否需要二次推理？ | **若要多句候选：** 需多次 `transcribe`（不同 temperature/seed）或改 CT2 导出 — **等价二次/多次推理** |
| 5 | 能否单次推理返回多个候选？ | **仅** temperature>0 + `best_of` 在库内生成多条；**仍只返回 top1**；本服未传 `best_of` |

---

## 第七部分 — Decoder Lattice Report

| 概念 | FW / Whisper 路径 | 说明 |
|------|-------------------|------|
| CTC lattice | **不适用** | Whisper 为 autoregressive decoder，非 CTC |
| Beam search graph | **CT2 内部存在** | 不暴露给 Python |
| Decoder lattice / candidate graph | **不可访问** | 无 API |
| 竞争节点「候/後/厚」 | **不可访问** | 无 per-step vocab 输出 |

**对比：** Sherpa CTC 的 `decode_beams` 返回多条 **完整文本** 假设（类似 n-best 链），仍 **不是** 字级 lattice。

---

## 第八部分 — Span Detection Value Report

假设未来能获得 A/B/C 三类信息，对 **「高置信同音」** Span 的价值（只评估，不设计 Detector）：

| 输入 | 对 Span Detection 价值 | 能否替代字流滑窗 / Lexicon scan |
|------|------------------------|----------------------------------|
| **A token posterior（同位竞争）** | **高（理论上）** — 可直接标歧义位置 | **可能**，但 **当前不存在** |
| **B alternative token** | 同 A | 同 A |
| **C beam candidates（句级）** | **中** — n-best **diff** 可定位「候選/後選」差异 span | **部分** — 仍可能需要 Lexicon 判哪条更对 |
| 现有 **word.probability** | **低** — 错误 token 常仍高 prob | **不能** |

### 重点：能否「後 0.51 / 候 0.48 → 自动 span」且 **不需要** 滑窗/分词/Lexicon？

**以当前 FW 输出：不能。**  
**即使导出 alignment 的 `text_token_probs`：** 仍是 **单一路径** 置信度，**不是** 竞争 posterior，**不能** 可靠区分「候/後」。

**句级 beam n-best diff**（若导出）对「候選生成 vs 後選生成」**可能有帮助**，但仍需 **外部语言知识** 选假设，不能完全去掉 Lexicon/KenLM。

---

## 第九部分 — Complexity Report（只评估，不开发）

| 方案 | 代码改动 | FW 服务 | Node | 性能/显存/延迟 |
|------|----------|---------|------|----------------|
| **A 读取 token posterior** | **大** — 需 fork/patch **faster-whisper 或 CTranslate2** 暴露 step logits | 大 | 中（新字段透传） | 延迟↑；显存↑（若存全 vocab logits） |
| **B alternative token** | **很大** — 库无此能力 | 很大 | 大 | 显著↑ |
| **C beam candidates** | **中** — patch `asr_worker_process` 读 `sequences_ids[1:beam]` 并 decode 为字符串；**需 beam_size>1** | 中 | 小（`segments`/`nbest` 扩展） | 延迟 **~beam 倍级**；显存↑ |
| **D N-best（多次采样）** | 中 — 循环 temperature/best_of 或多次 utterance | 中 | 中 | 延迟 **×N 次推理** |

**最小侵入验证路径（事实排序）：** **C（beam 多假设导出）** < **D（多次 transcribe diff）** << **A/B（改 CT2 内核）**。

---

## 第十部分 — 最终结论

| # | 问题 | 答案 |
|---|------|------|
| 1 | FW 是否已产生比 top1 更多信息？ | **Decoder 内部有**（token ids、beam 其它假设、align probs）；**到达 Node 的几乎只有 top1 + word 级汇总** |
| 2 | 是否被服务丢弃？ | **是** — worker 只序列化 7 个 word/segment 字段；无 `tokens`、无 n-best |
| 3 | 能否获得 token posterior？ | **不能**（无 vocab 竞争分布） |
| 4 | 能否获得 alternative token？ | **不能** |
| 5 | 能否获得 beam candidates？ | **当前不能**；**库内 beam>1 时可能存在但未导出** |
| 6 | 能否获得 N-best？ | **FW 路径不能**（Sherpa CTC 可以） |
| 7 | 能否获得 decoder lattice？ | **不能** |
| 8 | 最适合 Span Detection 的输入（若扩展 FW） | **句级 beam / n-best 文本 diff**（次选：导出 `Segment.tokens` + align probs，仍弱于竞争 posterior） |
| 9 | 是否值得优先研究？ | **值得做只读/ spike：beam_size>1 导出 2–3 条假设 diff**；**不值得** 先投 CT2 logits（成本极高） |
| 10 | 若只选一个方向验证 | **C — 在 FW 服务层导出 beam 多假设（需 beam_size>1 + worker 改序列化）**，对比「候選/後選」类 diff 能否稳定出现 |

### FW Decoder 还能利用什么？（事实清单）

**已在用：**

- top1 文本、`Segment.avg_logprob`、`Word.probability`（alignment）、`language_probabilities`

**库内有、服务未用：**

- `Segment.tokens[]`（token id 序列）
- CT2 `generate` 的 **`sequences_ids[1:]`**（beam>1 时）
- `find_alignment` 的 **`text_token_probs[]`**（单路径）
- temperature 分支的 **`best_of` 多假设**（未启用 + 未导出）

**库内也没有、勿指望开箱即用：**

- 同位 token softmax（候/後/厚）
- Decoder lattice
- 与 Sherpa 等价的 CTC n-best

---

## 附录 — 关键代码锚点

| 位置 | 事实 |
|------|------|
| `asr_worker_process.py` L188,L252-268 | `word_timestamps=True`；只导出 word 四字段 |
| `faster_whisper/transcribe.py` L48-58 | `Segment.tokens` 存在 |
| `faster_whisper/transcribe.py` L1461 | 仅 `sequences_ids[0]` |
| `faster_whisper/transcribe.py` L1709-1748 | align → `text_token_probs` → word mean prob |
| `faster-whisper-asr-strategy.ts` L44-49 | beam=1, temp=0, 无 best_of |
| `asr_sherpa_lm/ctc_decode.py` | **对照：** CTC `decode_beams` → nbest |
| `pipeline/README.md` | FW 不输出 `asr_nbest` |

---

## 相关审计

- [FW Word 边界审计](./FW_Word_Boundary_Audit_2026_06_02.md) — 字级 token 粒度与 probability 分布  
- [FW 质量审计（文本链修复后）](./FW_Quality_Audit_Post_Chain_Fix_2026_06_02.md) — Detector Miss 与 Recall 基线
