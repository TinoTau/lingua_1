# Lexicon Runtime V2 — FW Metadata Span Gate 开发前只读审计报告

版本：V1.0  
日期：2026-05-30  
类型：只读代码审计（无代码修改）

---

## 1. 执行摘要

**核心结论（一句话）：**

> Faster-Whisper **底层 API 已支持** `word_timestamps` / `word.probability` / `segment.avg_logprob` / `compression_ratio` / `no_speech_prob`，但当前 **`faster-whisper-vad` 服务仅提取并返回 `text/start/end/no_speech_prob`**；Node `ASRResult` 亦仅保留上述字段。**FW Metadata Span Gate 在技术上可行**，最小改造链为：**Python worker 开启 `word_timestamps` 并序列化 words/metadata → 扩展 Node `SegmentInfo` → 新增 `fw-metadata-span-gate.ts` → `fw-detector-orchestrator.resolveFwSpans` 第三分支**。该方案可替代已否决的 KenLM Span Gate，**无需 KenLM 全句扫描**，预期恢复 Phase 2 量级 apply 的同时保持 span/job ≤ 2。

### 背景确认

| 事实 | 审计确认 |
|------|----------|
| span 入口不可靠是 Phase 3 根因 | ✅ legacy detector 枚举 CJK 窗口 + `detector_pinyin_hint` 单独触发 |
| legacy ~11.5 span/job | ✅ `spanDetectBudget=12`，与 Phase 2/3 一致 |
| KenLM Span Gate 切断误修但 ≈关闭修复 | ✅ P3.2 批测 63 条 fw_apply=0，gate ~12s/job |
| KenLM Span Gate 已否决 | ✅ 不应再作默认 span 来源 |
| 主链冻结 | ✅ ASR→FW→Aggregation→Dedup→Translation 顺序未变 |

### 推荐 MVP

```text
FW ASR (word_timestamps=True)
  ↓
alias/confusion exact hit（优先，≤maxSpans）
  +
low word.probability span（2~4 字 CJK，合并连续低置信）
  +
segment avg_logprob fallback（整段低置信时 legacy 粗扫 maxSpans=1）
  ↓
Lexicon V2 Recall（LIMIT 2/3/0，routing 关）
  ↓
KenLM weak_veto（现有 kenlm-span-gate.ts，不改）
  ↓
Apply
```

**若无 metadata 或全部信号正常 → 0 span，跳过 Recall（等同 skip FW repair）。**

---

## 2. 当前 FW 服务 metadata 能力

审计范围：`services/faster_whisper_vad/*`

### 2.1 Faster-Whisper API 能力 vs 当前实现

| # | 能力 | FW API 支持 | Python 已获取 | 已返回 HTTP/Node | 最小改造点 |
|---|------|-------------|---------------|------------------|------------|
| 1 | `word_timestamps=True` | ✅ `transcribe()` 参数 | ❌ 未传入 | ❌ | `asr_worker_process.py` `transcribe_kwargs` |
| 2 | `segment.words` | ✅（需 #1） | ❌ | ❌ | 同上 + `segments_data` 构建 |
| 3 | `word.start` / `word.end` | ✅ | ❌ | ❌ | 序列化到 segment.words |
| 4 | `word.probability` | ✅ | ❌ | ❌ | 同上 |
| 5 | `segment.avg_logprob` | ✅ | ❌ | ❌ | `getattr(seg, 'avg_logprob', None)` |
| 6 | `segment.compression_ratio` | ✅ | ❌ | ❌ | `getattr(seg, 'compression_ratio', None)` |
| 7 | `segment.no_speech_prob` | ✅ | ✅ | ✅ | 已有 |
| 8 | `segment.tokens` | ✅（token id 列表） | ❌ | ❌ | 可选；MVP 非必需 |
| 9 | token-level logprob | ⚠️ 非标准公开字段 | ❌ | ❌ | **不建议 MVP 依赖**；用 `word.probability` + `avg_logprob` |
| 10 | beam / alternatives | ⚠️ 无真正 n-best 输出 | ❌（FW 模式 beam=1） | ❌ | MVP 不需要；`candidate-provider.ts` 已确认不支持 |
| 11 | language probability | ✅ `info.language_probabilities` | ✅ | ✅ | 已有 |

### 2.2 当前 Python 数据流

```text
asr_worker_process.py: model.transcribe(audio, **kwargs)
  → segments_list（仅读 seg.text/start/end/no_speech_prob）
  → result_queue JSON
  → utterance_asr.py → SharedSegmentInfo
  → api_routes.py → UtteranceResponse.segments
  → text dedup 后 update_segments_after_deduplication()  ← 风险点
```

**关键代码位置：**

- `asr_worker_process.py` L180–204：`transcribe_kwargs` 无 `word_timestamps`
- L249–254：segment 仅 4 字段
- `shared_types.py` / `api_models.py`：`SegmentInfo` 仅 `text/start/end/no_speech_prob`
- `compression_ratio_threshold` / `log_prob_threshold`：仅作为 **transcribe 过滤参数** 传入，**不作为输出 metadata 返回**

### 2.3 中文与 dedup 风险

1. **去重破坏 metadata**：`text_processing.update_segments_after_deduplication()` 在文本变更时 **重建 segments**，丢失 `no_speech_prob`，时间戳仅粗保留首尾；若新增 `words/avg_logprob`，**必须在 dedup 后重新对齐或禁用 dedup 路径上的 metadata 丢弃**。
2. **中文无空格**：dedup 后 fallback 按空格 split；中文 utterance 常为 **单 segment 全句**，word 级对齐更依赖 `word_timestamps` 而非空格 split。
3. **FW 模式**：`faster-whisper-asr-strategy.ts` 已 `use_text_context: false`、`beam_size: 1`，有利于稳定 metadata。

### 2.4 最小 Python 改造清单

| 文件 | 改造 |
|------|------|
| `asr_worker_process.py` | `word_timestamps=True`；扩展 `segments_data` |
| `shared_types.py` | `SegmentInfo` + `WordInfo` + `avg_logprob` + `compression_ratio` |
| `api_models.py` / `text_processing.py` | Pydantic 模型同步；dedup 路径保留/重算 words |
| `utterance_asr.py` | 映射新字段 |
| `result_listener.py` | 若经 IPC 传递，同步 schema |

**预估 transcribe 开销：** `word_timestamps=True` 通常为 **同 pass 增量 <5%**（远低于 KenLM gate ~12s/job）。

---

## 3. 当前 Node ASRResult 结构

### 3.1 类型定义

| 类型 | 路径 | 内容 |
|------|------|------|
| `ASRResult` | `task-router/types.ts` L56–78 | `text`, `confidence?`, `language*`, `segments?`, `badSegmentDetection?`, `nbest?`, `kenlmMeta?`, `diagnostics?` |
| `SegmentInfo` | `task-router/types.ts` L22–27 | **`text`, `start?`, `end?`, `no_speech_prob?` 仅 4 字段** |
| `ASRHypothesis.tokens` | `asr/types.ts` L10–15 | Recover 用；**FW 主链未填充** |
| `JobContext` | `pipeline/context/job-context.ts` | `rawAsrText`, `asrResult`, `asrSegments`, `asrDiagnostics?` |

### 3.2 十项问答

| # | 问题 | 结论 |
|---|------|------|
| 1 | 是否只保留 text | ❌ 另有 segments、language_probs、diagnostics |
| 2 | 是否保留 segments | ✅ `ctx.asrSegments = asrResult.segments`（`asr-step.ts` L263） |
| 3 | 是否保留 words | ❌ 类型与服务均未传递 |
| 4 | avg_logprob | ❌ |
| 5 | no_speech_prob | ✅ segment 级；legacy detector 已用于 `low_no_speech_prob` 信号 |
| 6 | compression_ratio | ❌ |
| 7 | timestamps | ✅ segment start/end（秒）；dedup 后可能为 null |
| 8 | raw service response | ⚠️ 部分在 `asrResult.diagnostics`（P0 audio 诊断），**非完整 ASR JSON** |
| 9 | ASRResult 定义位置 | `task-router/types.ts` |
| 10 | 安全扩展点 | **`SegmentInfo` 扩展字段** + 可选 `ctx.asrMetadata` 只读副本；**不影响 `segmentForJobResult` SSOT**（仍由 FW step 写回） |

### 3.3 SSOT 与主链约束

```text
asr-step: ctx.rawAsrText ← asrResult.text（首段 freeze）
fw-detector-step: syncBaselineFromRaw → segmentForJobResult = rawAsrText
fw-orchestrator: 有 apply 时 segmentForJobResult = applyFwSpanReplacements(...)
aggregation-step: 只读 segmentForJobResult（freeze-contract 测试保障）
result-builder: text_asr ← resolveBusinessAsrText(ctx) ← segmentForJobResult
```

**metadata 仅作 FW span 输入，不写入 `segmentForJobResult` 直到 apply 发生。**

### 3.4 Node 最小改造清单

| 文件 | 改造 |
|------|------|
| `task-router/types.ts` | 扩展 `SegmentInfo`、`AsrWordInfo` |
| `faster-whisper-asr-strategy.ts` | 映射 HTTP response 新字段 |
| `pipeline/context/job-context.ts` | 可选 `asrMetadata?: FwAsrMetadata`（只读） |
| `asr-step.ts` | 填充 `ctx.asrMetadata`（或直接用 `ctx.asrResult.segments`） |
| `inference-service.ts` / `result-builder.ts` | diagnostics 可选输出 `asr_metadata_summary` |

---

## 4. FW Metadata Span Gate 可行性

### 4.1 接入架构

```text
resolveFwSpans(rawText, config, segments, kenlmScorer)
  ├─ spanGateMode === 'kenlm_gate_filter'   ← 已否决，应降级/关闭
  ├─ spanGateMode === 'legacy_detector'     ← 回滚路径
  └─ spanGateMode === 'fw_metadata_gate'    ← 新增（推荐默认）
       selectFwMetadataSpans({ text, segments, config })
       → FwSpanDiagnostics[]（复用现有类型）
```

**不修改：** `kenlm-span-gate.ts`（weak_veto）、`fw-topk-decision-pipeline.ts`、`apply-span-replacements.ts`

### 4.2 start/end：字符 offset vs word offset

| 方案 | 建议 |
|------|------|
| 字符 offset | ✅ **沿用** `FwTextSpan.start/end`（与 recall、apply、legacy detector 一致） |
| word offset | ❌ 需全链转换 |

### 4.3 word timestamps → 字符 offset 映射

**推荐算法（MVP）：**

1. 在 **segment.text** 或 **rawText** 上对 `words[]` 顺序做 greedy 匹配：
   - 规范化：去空格、全角半角（与 CER norm 可共享）
   - 对每个 `word.word`，从 cursor 起 `indexOf`；失败则 mark `alignment_failed`
2. 中文：`word_timestamps=True` 时 Whisper 对 zh 常为 **字级或短词级** token，与无空格文本 **通常可顺序对齐**
3. **Fallback 链：**
   - words 对齐失败 → 若 `avg_logprob` 低，用 **segment 文本全段** 作 1 个 conservative span（max 1）
   - 仍失败 → 0 span
4. **不引入** 外部 forced alignment 服务（MVP）；必要时 Phase 2 加字符级 edit distance 对齐

### 4.4 是否复用 `FwSpanDiagnostics`

✅ **复用**。新增 `signals` 值建议：

- `low_word_probability`
- `low_segment_avg_logprob`
- `high_compression_ratio`（辅助）
- `alias_exact_hit`

可扩展 `FwDetectorSignal` union；`riskScore` 按 gate 内部排序，**不用于 legacy minRiskScore 枚举**。

### 4.5 建议数据结构

```ts
// 输入（JobContext 组装）
type FwMetadataSpanGateInput = {
  text: string; // rawAsrText
  segments: Array<{
    start?: number;
    end?: number;
    avgLogprob?: number;
    compressionRatio?: number;
    noSpeechProb?: number;
    words?: Array<{
      word: string;
      start: number;
      end: number;
      probability?: number;
      charStart?: number; // gate 内对齐后填充
      charEnd?: number;
    }>;
  }>;
  maxSpans: number;
  aliasIndex?: ReadonlyMap<string, AliasHit[]>; // 仅 alias keys，非全 lexicon scan
};

// 输出
type FwMetadataSpanGateResult = {
  spans: Array<{
    text: string;
    start: number;
    end: number;
    startMs?: number;
    endMs?: number;
    confidence?: number;
    avgLogprob?: number;
    reason:
      | 'low_word_probability'
      | 'low_segment_avg_logprob'
      | 'high_compression_ratio'
      | 'high_no_speech_prob'
      | 'alias_exact_hit';
  }>;
  diagnostics: {
    mode: 'fw_metadata_gate';
    wordCount: number;
    lowConfidenceWordCount: number;
    selectedCount: number;
    alignmentFailures?: number;
    skippedReason?: 'empty_text' | 'no_metadata' | 'all_signals_normal';
  };
};
```

---

## 5. Span 选择策略评估

### A. word.probability < threshold（如 0.65）

| 维度 | 评估 |
|------|------|
| 可靠性 | ⭐⭐⭐⭐ 直接来自声学模型 |
| 召回 | ⭐⭐⭐ 可覆盖同音误识（若 ASR 自身低置信） |
| 误触 | ⭐⭐ 短词/口语仍可能误触；需 **maxSpans=2** + repair_target + weak_veto |
| MVP | ✅ **核心信号** |

规则：连续低置信 word 合并为 2~4 字 span；仅 CJK；**禁止** `detector_pinyin_hint` 单独触发。

### B. segment avg_logprob < threshold（如 -1.0）

| 维度 | 评估 |
|------|------|
| 可靠性 | ⭐⭐⭐ 段级粗信号 |
| 召回 | ⭐⭐ 无 word 级时兜底 |
| 误触 | ⭐⭐⭐ 段级较粗 |
| MVP | ✅ **fallback**；触发时允许 legacy 粗扫 **maxSpans=1** |

### C. compression_ratio 高（如 > 2.4）

| 维度 | 评估 |
|------|------|
| 可靠性 | ⭐⭐ 重复/幻觉指示 |
| 召回 | ⭐ 对同音替换帮助有限 |
| 误触 | ⭐⭐⭐ 易与正常重复口播混淆 |
| MVP | ⚠️ **仅加权辅助**，不单独触发 recall |

### D. no_speech_prob 高

| 维度 | 评估 |
|------|------|
| 可靠性 | ⭐⭐⭐ 已有 legacy 使用 |
| 召回 | ⭐ 对中文词修复弱 |
| 误触 | ⭐⭐ |
| MVP | ⚠️ **辅助信号**；legacy 已证 `"low_no_speech_prob"` 名称易误解（实为 **高** no_speech_prob） |

### E. alias/confusion exact hit

| 维度 | 评估 |
|------|------|
| 可靠性 | ⭐⭐⭐⭐⭐ 精确字符串 |
| 召回 | ⭐⭐⭐⭐ cafe「钟贝→中杯」类 |
| 误触 | ⭐ 低（需 alias 表维护） |
| MVP | ✅ **最高优先级** |

**实现：** 使用现有 `LexiconRuntime` 的 `aliasExactIndex` **键集合** 对 rawText 做 **multi-pattern 扫描**（Aho-Corasick 或 bounded substring），**禁止**扫描 base_lexicon 全表。  
**注意：** `confusions.jsonl` 当前 **空文件**；MVP 依赖 **lexicon aliases** 字段，非 phonetic-correction `confusion-set.ts`（5016 路径，与 FW 隔离）。

---

## 6. 与 Lexicon Runtime V2 的关系

| 原则 | 审计结论 |
|------|----------|
| V2 不负责找 span | ✅ `recallSpanTopKViaRuntimeV2` 仅消费 `span.text` |
| V2 Recall 只处理 gate span | ✅ orchestrator 0 span 早退已实现 |
| SQL LIMIT 2/3/0 | ✅ 保持 |
| Industry Routing 关 | ✅ 保持 |
| topicKeywords 不参与 span | ✅ 无代码路径；gate 不得读 sessionIntent |
| alias hit 独立于 base recall | ⚠️ **span 来源**独立；**recall** 仍走 `recallSpanTopK`（内含 alias_exact 候选源） |
| alias index | ✅ 已有 `alias-index.ts` + `runtime.lookupAliasExactMatches`；gate 需 **反向子串索引**（仅 alias 键） |

---

## 7. 与 KenLM 的关系

| 项 | 结论 |
|----|------|
| KenLM Span Gate | ❌ **否决**，不再作默认 |
| KenLM weak_veto | ✅ 保留 `scoreSpanCandidateSentences` |
| 全句滑窗 KenLM query | ❌ 禁止 |
| `kenlm-span-gate.ts` | ✅ 不修改 |
| P3.2 配置拆除 | ✅ **建议**：默认 `spanGateMode: 'fw_metadata_gate'`；`kenlmSpanGate.enabled: false`；保留 `kenlm_gate_filter` 枚举供实验/回滚 |
| 新增 `spanGateMode` | ✅ 扩展 union：`'legacy_detector' \| 'kenlm_gate_filter' \| 'fw_metadata_gate'` |

---

## 8. 配置设计

### 8.1 建议配置

```json
{
  "features": {
    "fwDetector": {
      "spanGateMode": "fw_metadata_gate",
      "fwMetadataSpanGate": {
        "enabled": true,
        "maxSpans": 2,
        "wordProbabilityThreshold": 0.65,
        "segmentAvgLogprobThreshold": -1.0,
        "compressionRatioThreshold": 2.4,
        "noSpeechProbThreshold": 0.5,
        "allowAliasExactHit": true,
        "allowSegmentFallbackScan": true,
        "fallbackLegacyMaxSpans": 1,
        "minSpanChars": 2,
        "maxSpanChars": 4
      },
      "kenlmSpanGate": {
        "enabled": false
      }
    }
  }
}
```

### 8.2 默认与回滚

| 场景 | 配置 |
|------|------|
| 新默认（P3.3） | `fw_metadata_gate` + `kenlmSpanGate.enabled: false` |
| 回滚 legacy | `spanGateMode: legacy_detector` |
| 回滚 KenLM gate（不推荐） | `kenlm_gate_filter` + `kenlmSpanGate.enabled: true` |
| 完全 skip FW repair | `fwMetadataSpanGate.enabled: false` 且无 metadata → 0 span |

### 8.3 CTC 隔离

- `fwDetector` 配置仅在 `asr.engine === 'fw_detector_v1'` 时生效（`fw-mode.ts`）
- CTC 路径（`asr-sherpa-lm`）**不加载** `fw-detector-orchestrator`
- 扩展 `node-config-types.ts` 时 **无需** CTC 服务读取

---

## 9. 代码改造点（Target List）

| 层级 | 文件 | 动作 |
|------|------|------|
| Python | `asr_worker_process.py` | `word_timestamps=True`；输出 words + avg_logprob + compression_ratio |
| Python | `shared_types.py`, `api_models.py` | 扩展 Segment/Word 模型 |
| Python | `text_processing.py` | dedup 后 words 重对齐或跳过 destructive rebuild |
| Node | `task-router/types.ts` | 扩展 `SegmentInfo` |
| Node | `faster-whisper-asr-strategy.ts` | 映射新字段 |
| Node | `asr-step.ts` | 可选 `ctx.asrMetadata` |
| Node | **`fw-metadata-span-gate.ts`（新）** | 核心 gate 逻辑 |
| Node | `fw-detector-orchestrator.ts` | `resolveFwSpans` 第三分支；KenLM scorer **仅 veto 阶段**创建 |
| Node | `fw-config.ts`, `node-config-*` | 新 mode + 默认 |
| Node | `fw-detector/types.ts` | 新 signal + diagnostics |
| Node | `result-builder.ts` | `fw_detector.fwMetadataSpanGate` diagnostics |
| 不改 | `kenlm-span-gate.ts`, CTC 服务, Recover, 主链 step 顺序 | 冻结 |

---

## 10. 测试设计

| 测试 | 类型 | 要点 |
|------|------|------|
| FW service metadata response | Python integration | `word_timestamps` 后 words.length > 0 |
| ASRResult metadata mapping | Node unit | HTTP mock → `SegmentInfo.words` |
| Chinese word probability span | Node unit | 低 prob 字合并为 span，char offset 正确 |
| alias exact hit | Node unit | 「钟贝」→ span + reason=alias_exact_hit |
| avg_logprob fallback | Node unit | 无 words 时段级 fallback maxSpans=1 |
| no metadata skip FW | Node unit | segments=[] → 0 span, rawText 不变 |
| maxSpans=2 | Node unit | 多信号竞争只保留 top-2 |
| no detector_pinyin_hint recall | Node unit | hint 信号不出现；仅 metadata reason |
| dialog_200 regression | E2E batch | span/job, recall, apply, degrade, CER, pipeline_ms |
| 性能 | E2E | fw_detector_step_ms 应 **无 ~12s KenLM gate**；kenlm 仅 veto |

**Fixtures：** `tests/fixtures/fw-asr-metadata-*.json`（含 words + avg_logprob 样例）

---

## 11. 验收指标

| # | 指标 | 目标 |
|---|------|------|
| 1 | dialog_200 PASS | 200/200 |
| 2 | span/job | ≤ 2 |
| 3 | recall invocation vs legacy | ↓ ≥ 80% |
| 4 | FW apply | 接近 Phase 2（~10），≤ 2× Phase 2 |
| 5 | fw_degrade | 0 |
| 6 | final CER | ≤ Phase 2（35.93%） |
| 7 | pipeline P95 | 接近 Phase 2（7458ms），**无 KenLM gate 12s 固定开销** |
| 8 | cafe/中杯类 | alias + low prob 至少恢复部分 apply |
| 9 | CTC | 现有 CTC tests PASS，无 metadata gate import |

---

## 12. Check List（开发前）

- [ ] Python `word_timestamps=True` spike 中文 utterance words 可对齐
- [ ] dedup 路径不丢弃 words/metadata
- [ ] Node `SegmentInfo` 扩展 backward compatible（旧字段 optional）
- [ ] `fw_metadata_gate` 不创建 KenLM scorer（span 阶段）
- [ ] `detector_pinyin_hint` 不出现在 metadata gate 路径
- [ ] alias 扫描仅用 alias index keys
- [ ] 默认关闭 `kenlm_gate_filter`
- [ ] freeze-contract 测试仍 PASS
- [ ] dialog_200 批测脚本支持新 diagnostics 字段

---

## 13. 风险与回滚

| 风险 | 等级 | 缓解 |
|------|------|------|
| dedup 破坏 word 对齐 | 高 | dedup 后重算或 metadata 绑定 dedup 后 text |
| 中文 word 粒度不一致 | 中 | greedy 对齐 + fallback avg_logprob |
| word.probability 阈值过严 → 0 apply | 中 | 与 P3.2 对称；alias hit 优先；阈值可配 |
| word.probability 过松 → 误触 | 中 | maxSpans=2 + repair_target + weak_veto |
| transcribe 延迟略增 | 低 | 仍远低于 KenLM gate |
| alias 表不全 | 中 | 依赖 lexicon 维护；非全库扫描 |

**回滚顺序：** `fw_metadata_gate` → `legacy_detector` → 关闭 `fwDetector.enabled`

---

## 14. 与 P3.2 KenLM Span Gate 对比

| 维度 | P3.2 KenLM Gate | FW Metadata Gate |
|------|-----------------|------------------|
| span 信号来源 | KenLM delete-span delta | ASR word.probability / avg_logprob |
| KenLM query（span 阶段） | ~21/job | **0** |
| fw_detector_step_ms | ~12s | 预期 **<100ms**（纯 CPU） |
| FW apply（63 条批测） | 0 | 预期 **>0**（alias + 低置信） |
| 误修风险 | 极低 | 低（有 weak_veto） |
| 依赖 | KenLM 子进程可用 | FW 服务返回 words |

---

## 15. 附录：关键代码引用

**Python 当前 segment 提取（仅 4 字段）：**

```249:254:electron_node/services/faster_whisper_vad/asr_worker_process.py
                        segment_info = {
                            "text": seg.text.strip(),
                            "start": getattr(seg, 'start', None),
                            "end": getattr(seg, 'end', None),
                            "no_speech_prob": getattr(seg, 'no_speech_prob', None),
                        }
```

**Node SegmentInfo 类型：**

```22:27:electron_node/electron-node/main/src/task-router/types.ts
export interface SegmentInfo {
  text: string;
  start?: number;
  end?: number;
  no_speech_prob?: number;
}
```

**Orchestrator span 来源分支：**

```130:158:electron_node/electron-node/main/src/fw-detector/fw-detector-orchestrator.ts
async function resolveFwSpans(...) {
  if (isKenlmSpanGateActive(config)) {
    const gateResult = await selectKenlmSuspiciousSpans(kenlmScorer, {...});
    ...
  }
  const spanDetection = detectSuspiciousSpansV1(rawText, config, segments, hintFn);
  ...
}
```

**Legacy detector 枚举根因：**

```255:260:electron_node/electron-node/main/src/fw-detector/suspicious-span-detector-v1.ts
  const candidates = enumerateCjkSpans(text, config.minSpanChars, config.maxSpanChars);
  ...
  selectSpansForPipeline(scored, config.spanDetectBudget, config.minRiskScore);
```

---

**审计完成。未修改任何代码。**
