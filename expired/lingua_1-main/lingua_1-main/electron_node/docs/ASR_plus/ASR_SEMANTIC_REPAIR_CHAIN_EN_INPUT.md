# 英文输入链路：ASR 轻量纠错 + 语义闸门（无 N-best）技术方案（交付开发部门）

**适用场景**：英文语音输入（含口音/连读/噪声），输出为中文或其他语言（英→中 / 英→多语）。  
**核心目标**：在不依赖 ASR N-best、且上下文被打散（每节点仅 1–2 句连续）的条件下，降低专有名词、缩写、数字串、连读导致的错误，并在进入 NMT/TTS 前阻断“不可翻译/不自洽”的文本。

---

## 1. 背景与约束

### 1.1 现状痛点（英文侧常见）
- 专有名词（公司/产品/人名/地名）被误识别或拆分。
- 缩写（API/URL/GPU/HTTP 等）被展开或写错。
- 数字、单位、日期（“fifteen” vs “fifty”）误判导致语义崩溃。
- 口音、连读、噪声使 ASR 输出“片段化、不成句”，影响翻译与 TTS。

### 1.2 关键约束
- faster-whisper：不支持 N-best。
- 调度侧打散上下文：不能依赖长对话历史。
- 允许英→中与中→英采用不同链路：英文侧可更偏工程化纠错（轻量规则优先）。

---

## 2. 设计原则（英文侧）

1. **轻量优先**：英文纠错优先用低成本规则/规范化；只有低质量句才调用 LLM。
2. **Minimal Edit**：只修正明显拼写/词形/缩写/数字单位错误，不进行自由改写。
3. **可翻译性闸门**：对片段化文本做 PASS/REPAIR/REJECT 判定，避免垃圾输入进入 NMT。
4. **不依赖长上下文**：仅使用微上下文（上一句尾部 80–150 chars）作为可选增强。

---

## 3. 总体链路（英文输入）

```
Audio
  → ASR (faster-whisper)
  → ASR 后文本聚合（现有聚合机制）
  → [新增] EN Normalize Stage（轻量规范化/纠错）
  → [新增] EN Semantic Gate + Minimal Repair（低质句才启用 LLM）
  → NMT（英→中/英→多语）
  → TTS
```

---

## 4. 新增模块 A：EN Normalize Stage（推荐先做，收益高、成本低）

### 4.1 功能清单（不需要词库维护）
1) **文本规范化**
- 统一大小写（句首大写、缩写全大写）
- 去除重复空格、异常标点
- 处理口头语填充词（um/uh/like）可选删除（仅在低质句）

2) **数字/单位/日期规范化**
- 将口语数字转为数字（可配置：one hundred and five → 105）
- 单位规范化（kb/MB/GHz, percent/%）
- 日期时间（Jan 5th / January fifth）统一格式（仅在必要时）

3) **缩写保护**
- 识别常见技术缩写并保护为大写：API, URL, HTTP, GPU, CPU, SQL, JSON...
- 避免被模型“纠正”为普通单词（例如 “api” → “app”）

4) **URL/邮箱/路径保护**
- 识别并保持原样，避免翻译破坏（必要时用占位符包裹，翻译后再还原）

> 以上属于“工程化纠错”，对英文链路通常比直接上 LLM 更稳、更快。

---

## 5. 新增模块 B：EN Semantic Gate + Minimal Repair（低质句启用）

### 5.1 输入/输出契约
输入：
- `text_in`：聚合后的英文 ASR 文本
- `quality_score`
- `micro_context`（可选）
- `flags`：是否包含数字/缩写/URL 等（由 Normalize Stage 产生）

输出：
- `decision: PASS | REPAIR | REJECT`
- `text_out`
- `confidence`
- `diff`
- `reason_codes`

### 5.2 触发策略（建议）
- 默认 PASS（不调用 LLM）
- 进入 REPAIR 的条件：
  - `quality_score < Q1`（建议 0.70）
  - 或 Normalize 后仍命中“不可翻译性检查”（片段化严重、结构不成立）
  - 或 数字/单位/专名密集且疑似错误（例如多个数字互相矛盾）

### 5.3 Minimal Repair 的 LLM 方案（可选）
- 模型可用更小版本（1–3B），也可与中文链路共用同一推理服务（按 lang 参数区分）。
- Prompt（英文 Minimal Edit）：
  ```
  You are a post-processor for ASR output. The input may contain misrecognized words, wrong abbreviations, or wrong numbers.
  Rules:
  1) Make minimal edits only to fix obvious errors.
  2) Do not expand the sentence. Do not add new information.
  3) Preserve acronyms (API, HTTP, GPU...), URLs, emails, and file paths.
  4) If the input is already fine, output it unchanged.
  Output ONLY the corrected text.

  Input: {text_in}
  (Optional) Previous snippet: {micro_context}
  ```

### 5.4 REJECT 与降级（Iteration 2）
- 当文本严重碎片化且修复置信度低：
  - `decision=REJECT`
  - 上层策略：提示用户重说 / 仅输出文字不播报 / 降低实时性等待更多音频聚合

---

## 6. 可选：低成本复跑（英文侧）

与中文一致，仅在极少数高风险句触发：
- `quality_score < Q2`（例如 0.50）
- 且文本极短或结构异常
- 通过解码参数扰动获取第二版本，交由 Gate 选择

---

## 7. 与现有 NMT Repair 的关系

英文侧优先在翻译前完成 Normalize + Gate，减少错误扩散。  
NMT Repair（翻译侧多候选）建议仅作为兜底，并限制候选数与超时，避免阻塞。

---

## 8. 工程落地建议

### 8.1 新增 Stage 顺序
1) `EnNormalizeStage.process(text)`
2) `EnSemanticRepairStage.process(text, quality_score, micro_context, flags)`
3) NMT

### 8.2 配置项（示例）
- `enNormalizeEnabled`
- `enNormalizeProtectAcronyms`
- `enNormalizeProtectUrls`
- `enRepairEnabled`
- `enRepairQualityThresholdQ1`
- `enRejectEnabled`
- `enRepairTimeoutMs`

### 8.3 可观测性（必做）
- normalize 前后文本对比
- decision/confidence/diff
- 延迟与超时统计
- 专名/缩写/数字类错误修复命中率（抽样评估）

---

## 9. 迭代计划

### Iteration 1
- 上线 EnNormalizeStage（不需要 LLM）
- 上线 Gate（仅 PASS/REPAIR，可先不启用 REPAIR）
- 完成指标采集

### Iteration 2
- 对低质量句启用 Minimal Repair（LLM）
- 加入 REJECT 与降级策略
- 可选：复跑策略

---

## 10. 风险与对策
- 误修复：Minimal Edit + 高门槛触发 + 超时回退
- 延迟：Normalize 优先；LLM 只在低质句触发；设置严格 timeout
- 专名/URL 被破坏：Normalize 的保护与占位符机制
