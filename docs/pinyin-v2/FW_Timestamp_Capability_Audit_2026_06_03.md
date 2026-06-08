# FW Timestamp Capability Audit

**日期**：2026-06-03  
**性质**：只读审计（禁止开发 / 改代码 / 改配置）  
**目标**：确认 Faster-Whisper（FW）服务是否已具备 Tone Module 所需的 **word timestamp** 能力，以及该能力在 Pipeline 中的保留情况。

**关联审计**：[FW Recall Tone Constraint Audit](./FW_Recall_Tone_Constraint_Audit_2026_06_03.md)

---

## 0. Executive Summary

| 结论项 | 判定 |
|--------|------|
| FW 服务是否 **已生成** word timestamp？ | **是** — Worker 内 `word_timestamps=True` **硬编码开启** |
| Node 客户端是否 **请求** `word_timestamps`？ | **否** — HTTP 请求体无此字段 |
| HTTP 响应是否 **包含** segment / word timestamp？ | **是**（结构支持）；去重改文时 **words 被丢弃** |
| Pipeline 是否 **保存** word timestamp？ | **部分** — `ctx.asrSegments` 保留 `segments[].words`（若响应未丢）；**FW/Tone 主链未消费** |
| 能否「直接开启」？ | **已开启**（服务侧）；无需新开关即可产出 |
| 是否需要额外 Forced Alignment？ | **P0 不必**；高精度字级边界可选 WhisperX / 独立 aligner |
| Tone Module P0 能否直接基于 FW timestamp？ | **有条件可以** — 需新增 **span→字符偏移→audio slice** 映射层；并处理 dedup 丢 words、ASR 错字与字级时间非声调 |

---

## 1. 第一部分 — 组件定位

### 1.1 架构地图

```text
Pipeline
  runAsrStep (asr-step.ts)
    → TaskRouterASRHandler.routeASRTask (task-router-asr.ts)
      → executeFasterWhisperASR (faster-whisper-asr-strategy.ts)   ← Node FW Client
        → POST {baseUrl}/utterance

FW Python Service (electron_node/services/faster_whisper_vad/)
  faster_whisper_vad_service.py
    → api_routes.process_utterance
      → utterance_asr.perform_asr
        → ASRWorkerManager → asr_worker_process.py
          → WhisperModel.transcribe(..., word_timestamps=True)   ← 实际推理
```

| 角色 | 路径 |
|------|------|
| **FW 服务** | `electron_node/services/faster_whisper_vad/` |
| **ASR Step** | `electron_node/electron-node/main/src/pipeline/steps/asr-step.ts` |
| **FW Client（Node）** | `electron_node/electron-node/main/src/task-router/faster-whisper-asr-strategy.ts` |
| **FW Adapter（路由）** | `electron_node/electron-node/main/src/task-router/task-router-asr.ts` |
| **类型契约** | `electron_node/electron-node/main/src/task-router/types.ts`（`SegmentInfo` / `AsrWordInfo`） |
| **次要客户端** | `electron_node/services/node-inference/src/faster_whisper_vad_client.rs`（Rust，非 FW 主链） |

---

## 2. 第一部分 — 必答四问

### Q1 — 当前 FW 调用参数是否包含 `word_timestamps=true`？

| 层级 | 是否包含 | 说明 |
|------|----------|------|
| **Node Client** `faster-whisper-asr-strategy.ts` | **否** | `requestBody` 无 `word_timestamps` 字段 |
| **API 模型** `api_models.UtteranceRequest` | **否** | 未暴露为 HTTP 参数 |
| **ASR Worker** `asr_worker_process.py` | **是（硬编码）** | `transcribe_kwargs["word_timestamps"] = True`（约 L188） |

```python
# asr_worker_process.py（摘录）
transcribe_kwargs = {
    "language": task.get("language"),
    "task": task.get("task", "transcribe"),
    "beam_size": task.get("beam_size", BEAM_SIZE),
    "vad_filter": False,
    "initial_prompt": initial_prompt,
    "condition_on_previous_text": condition_on_previous_text,
    "word_timestamps": True,  # ← 始终开启，与客户端无关
}
```

**结论**：调用链 **上游不传参**，但 **服务 Worker 层已强制开启** word timestamps。

---

### Q2 — 当前 FW 返回结构是否包含 segment timestamp？

**是。**

| 层级 | 字段 |
|------|------|
| Worker 输出 | `segments[].start`, `segments[].end`（秒） |
| API `UtteranceResponse` | `segments: List[SegmentInfo]`，`start` / `end` |
| Node `ASRResult` | `segments?: SegmentInfo[]` |
| Pipeline | `ctx.asrSegments`, `ctx.asrResult.segments` |
| Job Result extra | `assembleJobResult` → `segments` |

Worker 摘录：

```python
segment_info = {
    "text": seg.text.strip(),
    "start": getattr(seg, 'start', None),
    "end": getattr(seg, 'end', None),
    "no_speech_prob": getattr(seg, 'no_speech_prob', None),
    "avg_logprob": getattr(seg, 'avg_logprob', None),
    "compression_ratio": getattr(seg, 'compression_ratio', None),
    "words": words_data,
}
```

---

### Q3 — 当前 FW 返回结构是否包含 word timestamp？

**是（服务层生成并序列化）。**

| 层级 | 字段 |
|------|------|
| `shared_types.WordInfo` | `word`, `start`, `end`, `probability` |
| `SegmentInfo.words` | `List[WordInfo]` |
| Node `AsrWordInfo` | `word`, `start?`, `end?`, `probability?` |
| `SegmentInfo.words` | `AsrWordInfo[]` |

Worker 摘录：

```python
words_data = [
    {
        "word": getattr(w, "word", str(w)),
        "start": getattr(w, "start", None),
        "end": getattr(w, "end", None),
        "probability": getattr(w, "probability", None),
    }
    for w in seg.words
]
```

---

### Q4 — 实际 JSON 样例（结构级，来自代码契约）

> 本轮未对运行中 FW 服务发 HTTP 探针；以下为 **当前 schema 下的代表性样例**（中文 utterance）。

**HTTP `POST /utterance` 响应片段：**

```json
{
  "text": "请问这款燕麦拿铁可以少冰吗",
  "language": "zh",
  "language_probability": 0.98,
  "duration": 3.52,
  "segments": [
    {
      "text": "请问这款燕麦拿铁可以少冰吗",
      "start": 0.12,
      "end": 3.48,
      "no_speech_prob": 0.02,
      "avg_logprob": -0.31,
      "compression_ratio": 1.42,
      "words": [
        { "word": "请", "start": 0.12, "end": 0.28, "probability": 0.91 },
        { "word": "问", "start": 0.28, "end": 0.41, "probability": 0.93 },
        { "word": "这", "start": 0.41, "end": 0.55, "probability": 0.89 },
        { "word": "款", "start": 0.55, "end": 0.68, "probability": 0.88 },
        { "word": "燕", "start": 0.68, "end": 0.82, "probability": 0.87 },
        { "word": "麦", "start": 0.82, "end": 0.96, "probability": 0.90 },
        { "word": "拿", "start": 0.96, "end": 1.12, "probability": 0.92 },
        { "word": "铁", "start": 1.12, "end": 1.28, "probability": 0.91 },
        { "word": "可以", "start": 1.28, "end": 1.58, "probability": 0.85 },
        { "word": "少", "start": 1.58, "end": 1.74, "probability": 0.86 },
        { "word": "冰", "start": 1.74, "end": 1.92, "probability": 0.84 },
        { "word": "吗", "start": 1.92, "end": 2.08, "probability": 0.88 }
      ]
    }
  ],
  "vad_segments": [[1920, 55680]],
  "diagnostics": {
    "audio_segmentation": {
      "fw_vad_segment_count": 1,
      "audio_ms": 3520,
      "asr_latency_ms": 2839
    }
  }
}
```

**注意（中文分词粒度）**：faster-whisper 对 CJK 使用 **Unicode 字符级** `split_to_word_tokens`，上例中多数为单字，偶发多字 token（如 `"可以"`）取决于 BPE 切分。

---

## 3. 第二部分 — Pipeline 是否保存 word timestamp

### 3.1 数据流追踪

```text
FW Worker (words 生成)
  → api_routes (SegmentInfo.words 填入)
  → [可选丢失] update_segments_after_deduplication
  → HTTP JSON
  → faster-whisper-asr-strategy: asrResult.segments = response.data.segments
  → asr-step: ctx.asrSegments = asrResult.segments
  → result-builder-core: JobResult.segments
  → FW Detector: 仅读 ctx.rawAsrText（不读 segments/words）
```

### 3.2 必答三选一

| 问题 | 答案 |
|------|------|
| **FW 返回了但被丢弃？** | **部分场景是** — 见下表 |
| **FW 根本没返回？** | **否** — Worker 始终 `word_timestamps=True` 并序列化 `words` |
| **FW 返回并一路保留到 Pipeline？** | **是（无 dedup 改文时）** — 存入 `ctx.asrSegments` / `ctx.asrResult.segments`；**下游 FW/Tone 未使用** |

### 3.3 丢弃 / 削弱点

| 位置 | 行为 | 对 `words` 影响 |
|------|------|----------------|
| `update_segments_after_deduplication` | `deduplicated_text != full_text` 时合并为单 segment | **`words=None`（显式丢弃）** |
| 同上 | dedup 未改文 | **保留** 原 `words` |
| `utterance_asr` fallback | segments 为空时用 `full_text.split()` 造 segment | `start/end/words` 均为空 |
| `fw-sentence-rerank-pipeline` / IME | 仅用 `rawAsrText` | **不读** `asrSegments` |
| `JobContext.asrSegments` 类型 | `any[]` | 无强类型约束，但 JSON 透传 |

```python
# text_processing.py — dedup 改文时丢弃 word alignment
if segments_info and deduplicated_text != full_text:
    segments_info = [
        SegmentInfo(
            text=deduplicated_text,
            start=first.start,
            end=last.end,
            ...
            words=None,  # ← 明确注释：drop word alignment
        )
    ]
```

### 3.4 各层保存情况

| 层 | segment `start/end` | `words[]` | 消费方 |
|----|---------------------|-----------|--------|
| `ASRResult` / `types.ts` | ✅ 类型定义 | ✅ 类型定义 | TaskRouter |
| `JobContext.asrSegments` | ✅ 赋值 | ✅ 透传（若响应有） | aggregation / semantic-repair meta |
| `JobResult.segments` | ✅ | ✅ 透传 | 可观测 / 外部 |
| `FwDetector` / Tone 主链 | ❌ 未使用 | ❌ 未使用 | — |
| 归档 `fw-metadata-span-gate` | 曾读 `segment.words` | — | **非活动路径** |

---

## 4. 第三部分 — 若无 word timestamp 时的能力（对照现状）

> **现状**：服务 **已有** word timestamp，本节回答「库能力 + 开启方式 + 成本」供 Tone Module 设计参考。

### 4.1 FW 版本与 `word_timestamps` 支持

| 项 | 值 |
|----|-----|
| 依赖 | `faster-whisper>=1.0.0`（`requirements.txt`） |
| 默认模型 | `Systran/faster-whisper-large-v3`（`config.py`） |
| 官方 API | `WhisperModel.transcribe(..., word_timestamps=True)` |
| 中文 | **支持** — 多语言模型；CJK 走 Unicode 字符切分（非空格分词） |

### 4.2 开启方法（当前 vs 理想）

| 方式 | 状态 |
|------|------|
| **当前生产** | Worker **已硬编码** `word_timestamps=True`，**无需再开** |
| HTTP 参数化（建议 P1） | 在 `UtteranceRequest` 增加 `word_timestamps?: bool`，Worker 读取 task 字段 |
| 关闭（若需 A/B） | 今日 **无** 运行时开关；需改 Worker 代码 |

### 4.3 性能成本（官方机制 + 本项目实测语境）

**机制**：`word_timestamps=True` 在 transcribe 后增加 **cross-attention 对齐**（DTW），相对纯 segment 有额外 CPU/GPU 开销（量级通常为数 %～数十 %，随音频长度变化）。

**本项目**：

| 事实 | 含义 |
|------|------|
| Dialog200 批测 **已在** `word_timestamps=True` 下运行 | `asr_latency_ms` **已包含** word alignment 成本 |
| 批测数据（n=141, FW large） | avg **2847 ms**，p50 **2839 ms**，p95 **4150 ms**；RTF_asr **0.809** |
| 无 `word_timestamps=False` 对照实验 | **无法从仓库数据量化「额外增加多少」** |

**推断**：Tone Module **不必为「开启 word_timestamps」单独预算增量** — 已支付。若未来做 `False` 优化，才可能回收部分 ASR 时延。

### 4.4 官方文档与中文

| 项 | 结论 |
|----|------|
| 多语言 / 中文 | Whisper large-v3 支持 `zh`；`word_timestamps` 文档明确支持 |
| 粒度 | CJK 为 **字符级**「word」（faster-whisper `split_tokens_on_unicode`） |
| 精度 | 对齐基于模型 cross-attention，**非**独立声学 forced aligner；长句 / 快语速可能有漂移 |

---

## 5. 第四部分 — Dialog200 / FW large 性能（word_timestamps 已开）

数据来源：`electron_node/electron-node/tests/fw-detector-dialog-200-quality-perf.json`（141 cases，全 `faster-whisper-vad`）。

| 指标 | 值 | 备注 |
|------|-----|------|
| ASR latency avg | **2847 ms** | 已含 word_timestamps |
| ASR latency p50 / p95 | 2839 / 4150 ms | |
| Audio duration avg | 3520 ms | |
| RTF (ASR) | **0.809** | asr_latency / audio_ms |
| Pipeline total avg | 6406 ms | 含 FW 后全链 |
| CPU / 内存增量 | **仓库无分项 profiling** | 本轮未跑 A/B；word 对齐与 transcribe 同进程，难单独拆分 |

**结论**：第四部分 **无法给出「开启 word_timestamps 的增量」** — 因为 **已经开启**；现有数字可作为 Tone Module 规划 **ASR 基线**。

---

## 6. 第五部分 — 中文稳定性与 Tone Module 适用性

### 6.1 是否接近字级时间戳？

| 维度 | 评估 |
|------|------|
| 粒度 | **接近字级** — CJK 按 Unicode 有效字符切分，多数为单字一个 `Word` |
| 与「词」 | 中文无空格；可能出现 **多字合并为一个 word token**（如 `"可以"`） |
| 与 **声调** | **无关** — timestamp 仅标音频区间，**不含** tone / pinyin |
| 与 ASR 错字 | 时间戳绑定 **识别结果字符**，非 ground-truth；错字（少病）仍对应错字时间段 |

### 6.2 是否适合作为 Tone Module Audio Slice 边界？

| 适用 | 限制 |
|------|------|
| ✅ 按 **字符/短 token** 从 utterance PCM 裁切 | ❌ 不能直接得到 **声调标签** |
| ✅ 比纯 segment 级更细 | ❌ ApprovedSpan 是 **字符偏移**，需 **text offset → time** 映射 |
| ✅ P0 可先做「音频片段 + 离线 G2P/声学」 | ❌ dedup 改文后 `words` 丢失，需 fallback segment 级或禁用 dedup 对 words 的破坏 |
| ⚠️ 对齐误差 | 快语速、连读、噪声下字界可能 **合并/漂移** |

**推荐 P0 边界策略**：

1. 优先 `segments[].words` 字级 `start/end`  
2. fallback `segments[].start/end` 按字数均分（粗）  
3. 将 `ApprovedSpan.start/end` 映射到 `rawAsrText` 字符索引，再查 words 表取时间  

---

## 7. 最终结论

### Q1 — 当前 FW 是否已经提供 word timestamp？

**是（服务 Worker 层）。**  
`asr_worker_process.py` 硬编码 `word_timestamps=True`，并在 `segments[].words` 中返回 `word/start/end/probability`。

### Q2 — 如果没有，能否直接开启？

**不适用 — 已经开启。**  
Node 客户端 **无需** 传参；若需运行时开关，需后续把参数暴露到 `UtteranceRequest`（本轮禁止开发）。

### Q3 — 是否需要额外 Forced Alignment？

| 场景 | 建议 |
|------|------|
| **Tone Module P0**（字级音频切片 + 外部 tone 推断） | **不需要** 独立 forced aligner；FW 内置对齐足够起步 |
| **高精度 / 评测 / 亚字级** | 可选 **WhisperX**（wav2vec2）或专用 aligner — **超出 P0** |

### Q4 — Tone Module P0 是否可以直接基于 FW timestamp 开始？

**有条件可以。**

| 已具备 | 尚缺（P0 开发项，本轮不实施） |
|--------|------------------------------|
| FW 产出字级 `words` | `ApprovedSpan` → `rawAsrText` 字符索引 → `words` 时间查询模块 |
| Pipeline 保存 `ctx.asrSegments` | FW Detector / Tone 读取 `asrSegments` 的接线 |
| 类型契约 `AsrWordInfo` | dedup 改文时 `words` 丢失的 fallback 策略 |
| Dialog200 ASR 时延基线 | 与 **pinyin-pro 反查 tone** 的融合策略（timestamp 不提供 tone） |

**不能直接开始的原因（非 FW 能力问题）**：

1. Tone 主链 today 只用 `rawAsrText`，**未读** timestamp  
2. dedup 路径会 **清空 words**  
3. timestamp 是 **音频-错字对齐**，不是 **声调真值**  

---

## 8. 附录 — 关键代码索引

| 主题 | 文件 |
|------|------|
| `word_timestamps=True` | `services/faster_whisper_vad/asr_worker_process.py` |
| words 序列化 | 同上 L250-260；`api_routes.py` L321-331 |
| dedup 丢 words | `services/faster_whisper_vad/text_processing.py` L176-195 |
| Node 请求（无 word_timestamps） | `task-router/faster-whisper-asr-strategy.ts` L31-53 |
| Node 响应接收 | 同上 L80-88 `segments: response.data.segments` |
| Pipeline 保存 | `pipeline/steps/asr-step.ts` L260-266 |
| 类型定义 | `task-router/types.ts` `AsrWordInfo` / `SegmentInfo` |
| FW 不消费 segments | `fw-detector/fw-detector-orchestrator.ts` 仅用 `ctx.rawAsrText` |
| README 响应示例 | **未文档化 words**（`services/faster_whisper_vad/README.md` 仅 segment start/end） |

---

**审计完成。本轮未修改代码、配置或服务。**
