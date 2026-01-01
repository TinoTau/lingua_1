# 中文输入链路：ASR 语义闸门 + 最小纠错（无 N-best）技术方案（交付开发部门）

**适用场景**：中文语音输入（含口音），输出为英文或其他语言（中→英 / 中→多语）。  
**核心目标**：在不依赖 ASR N-best、且调度侧刻意打散对话（每节点仅 1–2 句连续）的条件下，显著降低“同音字误判/常用词误识别/专业用词误判”带来的灾难性翻译与 TTS 输出。

---

## 1. 背景与约束

### 1.1 现状痛点
- ASR（faster-whisper）输出存在同音词误判（例：短句→短剧、音频→硬瓶）。
- 口音、短句、噪声导致“声学合理但语义不合理”的文本。
- 错误进入 NMT/TTS 后被放大，导致译文/播报难以理解。

### 1.2 关键约束
- ASR 引擎为 faster-whisper：**不支持 N-best**。
- 调度服务器故意打散上下文：单节点通常只看到 1–2 句连续内容，不能保留整场对话。
- 中译英、英译中可走不同链路：允许按语向做不同的纠错策略与模型选型。
- 不采用需要持续维护的大词库/Glossary（维护成本与不稳定性不可接受）。

---

## 2. 设计原则

1. **单句自洽**：纠错主要依赖当前句；允许使用“微上下文”（上一句尾部 80–150 字）但不要求整场对话。
2. **Minimal Edit**：尽量少改动，只替换明显不合理词/同音错/错别字；不扩写、不编造。
3. **语义否决权（Semantic Gate）**：在进入 NMT/TTS 前，对文本可翻译性与语义合理性进行判定。
4. **可回滚**：全链路开关（feature flag），可按会话/节点/比例灰度。
5. **可观测**：完整记录“原始 ASR / 聚合后 / 修复后 / 翻译后”的对比指标与 diff。

---

## 3. 总体链路（中文输入）

### 3.1 处理流程（推荐）
```
Audio (Opus/PCM)
  → ASR (faster-whisper + 现有 prompt bias)
  → ASR 后文本聚合 (现有 AggregatorMiddleware / AggregationStage)
  → [新增] SemanticRepairStage (Gate + Minimal Repair)
  → NMT (中→英/中→多语)
  → TTS
  → ResultSender
```

### 3.2 插入点（最小侵入）
- **插入位置**：ASR 后聚合生成 `textForNMT` 之后、调用 NMT 之前。
- **实现方式**：新增 Stage/中间件 `SemanticRepairStage`，在 PipelineOrchestrator 或 PostProcessCoordinator 的 TranslationStage 前执行。

---

## 4. 新增模块：SemanticRepairStage（中文）

### 4.1 输入/输出契约

**输入（核心字段）**
- `session_id`（可选，用于微上下文；不跨调度服务器共享）
- `utterance_index`
- `src_lang = "zh"`
- `text_in`：聚合后的 ASR 文本（准备送 NMT 的文本）
- `quality_score`：ASR 质量分（如 badSegmentDetection.qualityScore）
- `micro_context`（可选）：上一句尾部片段（80–150 字），仅本节点内存态保留
- `meta`：噪声指标（可选）、采样率、VAD 事件等

**输出**
- `decision`：`PASS | REPAIR | REJECT`
- `text_out`：最终用于 NMT 的中文文本（PASS 则等于 text_in）
- `confidence`：修复置信度（0–1）
- `diff`：最小编辑差异（用于审计/指标）
- `reason_codes`：触发原因（用于统计）

> Iteration 1 可只实现 `PASS/REPAIR`；`REJECT` 在 Iteration 2 引入。

---

## 5. 触发策略（无 N-best）

### 5.1 Gate 触发条件（建议）
满足任一条件进入 `REPAIR` 流程：

1) **质量分触发**
- `quality_score < Q1`（建议默认 Q1=0.70；可配置）

2) **短句 + 异常词形触发（无需词库）**
- `len(text_in) <= L1`（建议 L1=12–16）
- 且命中任一启发式：
  - 字符分布异常：非常见字比例高、非中文/符号比例高
  - 词形异常：连续多段无标点碎片、疑似“语音噪声词”
  - 结构异常：缺少基本句法（可简化为：无动词/无实体/全名词堆叠等启发式）

3) **可翻译性检查触发**
- 语言检测失败（非 zh 或混杂严重）
- 句子可读性低（例如重复、乱码、极端短且无意义）

### 5.2 REJECT 条件（Iteration 2）
当修复模型无法在“不编造”的前提下把文本变成可翻译句，且置信度低：
- `confidence < R1`（例如 0.45）
- 或 `text_out` 仍不通过可翻译性检查

REJECT 的降级策略：
- 输出文字但不 TTS（或提示用户重说）
- 或只返回原文并附带 `decision=REJECT` 给上层策略处理

---

## 6. Minimal Repair 实现方案

### 6.1 主方案：轻量可商用 LLM（推荐）
- **模型建议**（满足 <=10GB、可商用、中文强）：
  - Qwen2.5-3B-Instruct（优先，轻量）
  - Qwen2.5-7B-Instruct（增强，资源足时）
- **运行形态**：
  - INT4 量化优先（显著降低内存/显存）
  - 节点端本地服务或集中式“修复服务”均可（建议先集中式，便于迭代）

**Prompt（严格 Minimal Edit）**
- 要求：不扩写、不解释、只输出修复文本
- 示例模板：
  ```
  你是语音识别后处理器。输入是一句 ASR 文本，可能有同音字、近音词、错别字。
  规则：
  1) 尽量少改动原文，只替换明显不合理或不符合语义的词。
  2) 不要扩写，不要添加新信息，不要改变语气。
  3) 如果原文合理，原样输出。
  4) 输出只包含修正后的文本，不要解释。

  原文：{text_in}
  （可选）上一句片段：{micro_context}
  ```

### 6.2 补强方案：文本层“同音候选生成 + 语义选择”（可选，Iteration 2）
> 目的：在不依赖 ASR N-best 的情况下，自行构造“可控的小候选集”，解决同音错更稳。

- 对 `text_in` 中疑似错误词（触发条件见 5.1）生成少量同音/近音候选（拼音相同/相近）。
- 将“替换后的整句”交给同一 LLM 做比较选择（或打分）。
- 仅对极短句或命中特征的词执行，避免成本爆炸。
- **不需要维护领域词库**：候选由拼音/相似度规则生成。

---

## 7. 可选：低成本复跑（替代 N-best 的第二候选来源）

> 仅在非常少数高风险句启用（强 gated），否则会增加 GPU/CPU 压力。

### 7.1 复跑触发建议
- `quality_score < Q2`（建议 Q2=0.50）
- 且 `len(text_in) <= 12`
- 且 命中异常词形/结构启发式

### 7.2 复跑方式
- **参数扰动复跑**：调整 faster-whisper 的解码参数（如 beam_size、temperature、patience、no_speech_threshold 等）获得不同输出。
- **提示扰动复跑**：仅关键词/关键词+微上下文两种 prompt 组合各跑一次（利用你现有 prompt bias 机制）。
- **聚合边界扰动**：短句时延迟 150–300ms 再聚合一次（利用你现有 pre-ASR 聚合机制）。

然后由 Semantic Gate 选择“更可翻译/更合理”的版本。

---

## 8. 与现有 NMT Repair 的协同（避免重复与阻塞）

现有 TranslationStage 的 NMT Repair 会在质量低时生成多个翻译候选并打分，存在 GPU 阻塞风险。建议调整为：

1) **优先 SemanticRepairStage（翻译前纠错）**：减少错误扩散。
2) 正常 NMT 翻译。
3) **NMT Repair 降级为兜底**：
   - 仅在 `decision != REPAIR` 或 `confidence < C1` 时触发
   - 候选数从 5 降到 3
   - 并增加超时保护（例如 10–15s）

---

## 9. 工程拆分与接口（建议）

### 9.1 新增服务（推荐独立）
- 服务名：`semantic-repair-zh`
- 协议：HTTP/JSON 或 gRPC（取决于现有 TaskRouter）
- 幂等：以 `job_id` + `utterance_index` 做幂等键（可选）

**Request 示例**
```json
{
  "job_id": "xxx",
  "session_id": "s1",
  "utterance_index": 12,
  "lang": "zh",
  "text_in": "这个硬瓶需要上传",
  "quality_score": 0.58,
  "micro_context": "我们刚才讨论了音频文件格式"
}
```

**Response 示例**
```json
{
  "decision": "REPAIR",
  "text_out": "这个音频需要上传",
  "confidence": 0.86,
  "diff": [{"from":"硬瓶","to":"音频"}],
  "reason_codes": ["LOW_QUALITY", "SHORT_SENTENCE", "SEMANTIC_ANOMALY"]
}
```

### 9.2 节点端改动点
- 在 `textForNMT` 生成后调用 repair 服务
- feature flag：
  - `semanticRepairEnabledZh: true/false`
  - `semanticRepairQualityThresholdQ1`
  - `semanticRepairForceForShortSentence`
  - `semanticRepairRejectEnabled`（Iteration 2）

---

## 10. 可观测性与验收指标

### 10.1 必备日志字段
- `asr_text_raw` / `text_aggregated` / `text_repaired` / `translation` / `tts_text`
- `quality_score`、`decision`、`confidence`、`diff_count`
- 延迟：repair 服务耗时、总链路耗时

### 10.2 关键指标（上线后）
- REPAIR 命中率（%）
- “灾难输出”下降：可用 proxy
  - 译文可读性分（简单启发式）
  - 用户重说率/取消率（如有）
  - TTS 播放中断/重启次数（如有）
- 平均延迟增量（P50/P95）
- 误修复率（抽样人工评估）

---

## 11. 迭代计划（建议）

### Iteration 1（最小可用）
- 上线 `semantic-repair-zh`（PASS/REPAIR）
- 仅 `quality_score < Q1` 触发
- 不做复跑、不做 REJECT
- 完成日志/指标闭环

### Iteration 2（增强）
- 增加“短句+异常词形”触发
- 增加 REJECT 与降级策略
- 可选：文本层同音候选生成
- 可选：极少数复跑

---

## 12. 风险与对策

- **误修复**：靠 Minimal Edit prompt + 高门槛触发 + diff 审计；可灰度。
- **延迟**：强 gated；模型量化；可设 1–2s 超时，超时直接 PASS。
- **编造内容风险**：严格 prompt；对输出做“长度差限制”（如字数变化不超过 ±20%）。
