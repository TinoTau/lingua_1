# ASR 短句识别准确率提升技术方案（S1 + S2 整合版）
## 上下文偏置（Contextual Biasing）+ 双通道解码与复核（Rescoring）

**版本**：v1.0（可直接进入实现评审与拆分任务）  
**适用**：节点端 GPU 常驻；线下双人轮流交流（停顿多、手动截断）；会议室（多语输入→单语输出）  
**目标**：在不显著增加整体延迟的前提下，显著降低短句“显而易见的词被替换成同音字/近音词”的错误率，并保持翻译吞吐。

---

## 0. 总体结论（给开发负责人）
- 不做 Glossary 学习系统，改为两条成熟路线：
  - **S1：上下文偏置**（提升一次性识别命中率）
  - **S2：双通道解码 + 复核**（把短句纠错变成“候选选择问题”）
- 两者可组合：先用 S1，仍低置信/高风险再触发 S2。
- 不要求训练新模型，主要是工程实现、触发策略与参数调优。

---

## 1. 现状问题与约束

### 1.1 症状
- 短句/短片段（尤其手动截断、pause_ms 下调）中，ASR 容易出现单词级替换：同音字、近音词、形近词、专名/术语误听。
- 译文被“一个词”带偏，语义偏航明显。

### 1.2 约束
- 输入语言不可固定，可能夹杂术语外语词。
- 需保持翻译吞吐：不能对每条 utterance 做高成本 rolling ASR。
- 允许节点端额外计算，但必须“条件触发”。

---

## 2. 方案概览（S1 + S2）

### 2.1 S1：上下文偏置（Contextual Biasing）
在 ASR 解码时给模型一个“软提示”，让它更倾向输出领域词、专名、用户最近出现的词。

**落地层级（从易到难）**
1) **Prompt Bias（推荐 P0/P1）**：通过 `initial_prompt/prompt` 注入短语（术语、专名、最近上下文）。改动小、见效快。  
2) **Constrained Bias（推荐 P2）**：在 beam search 加 Trie/prefix 约束或偏置。更强但实现更复杂。

> v1 以 Prompt Bias 为主，Constrained Bias 作为后续增强。

### 2.2 S2：双通道解码 + 复核（Rescoring）
对“短句 + 低置信/高风险”的文本块运行第二通道生成候选，再复核选择最优文本。

**候选来源（可选其一或同时支持）**
- **S2-A：ASR N-best**（一次解码输出 3–5 个候选）  
- **S2-B：二次解码（双配置）**（同一音频再跑一次更保守解码，仅条件触发）

复核器（Rescorer）v1：**规则打分 + 上下文一致性**，可选引入 NMT 仅用于择优打分（不改写）。

---

## 3. 系统架构与数据流（建议）

```
Scheduler finalize（更快触发, 不追求语义边界）
   → Node ASR primary decode（S1 可注入 prompt）
   → Aggregator（Score+Gate+Dedup+TailCarry）
   → (S2) Rescoring worker（条件触发）
   → NMT translate / TTS / display
```

关键点：
- **S2 触发在 Aggregator 之后**：文本更稳定、触发更少、复核更准确。
- 若需要二次解码，必须能定位该 commit 对应的音频片段（见 6）。

---

## 4. S1 详细设计：Prompt Context Bias

### 4.1 Prompt 内容来源（按优先级）
1) **用户显式术语（用户/房间配置）**：会议主题、业务术语、专名、产品名  
2) **最近上下文（会话内）**：最近 N 秒/最近 K 条 committed_text 中的高频词与专名  
3) **系统默认词表（极少量，可选）**

### 4.2 Prompt 结构建议（可控、可压缩）
```
[CONTEXT]
Keywords:
- <phrase_1>
- <phrase_2>
Recent:
<recent_committed_snippet_1>
<recent_committed_snippet_2>
[/CONTEXT]
```

**长度控制（必须）**
- prompt 最大字符数：400–800（建议 room 更小）
- 关键词条数：10–40
- recent：1–3 条，每条截断 60–120 字符

### 4.3 多语言夹杂处理
- 不强制输入语言；只提供短语/专名
- 拉丁字符术语（API/GPU/品牌名）优先原样保留
- 禁用“请用中文识别”等强语言指令

### 4.4 触发策略
- 默认：所有 utterance 使用 prompt（成本接近零）
- 动态增强：仅对“短句/低置信”使用更强 prompt（更多关键词/更长 recent）
- 兜底：prompt 异常或性能下降可回退空 prompt（开关）

---

## 5. S2 详细设计：双通道解码 + 复核

### 5.1 触发条件（NeedRescore）
对每次 Aggregator commit 的文本块计算 NeedRescore，满足任一触发：
- 短文本：CJK < 12–18；EN < 6–10 words
- 低质量：quality_score < Q_LOW（线下 0.45 / 会议 0.50，可调）
- 高风险特征：
  - 数字/金额/单位/时间（如 12、30%、3点、$）
  - 专名/品牌/产品名（用户关键词命中优先）
  - 同音高歧义词（可维护“小型风险词表”，非学习系统）
- dedup 裁剪量异常高（边界抖动信号）

不触发（强约束）：
- 文本过长且质量高
- 同一 commit 已复核（幂等）

### 5.2 候选生成
**A：ASR N-best（优先）**
- N=3–5，直接来自引擎 alternatives

**B：二次解码（无 N-best 时）**
- primary：速度优先配置
- secondary：更保守配置（更大 beam / 更高 patience / 不同温度等）
- 仅在“短句 + 低置信 + 高风险”触发

### 5.3 复核器（Rescorer）v1（可直接实现）
对候选 `cand_i` 计算：
`Score = w_rule*RuleScore + w_ctx*ContextScore + w_nmt*NmtScore(optional)`

#### RuleScore（必须）
- 数字保护（数字/单位保持合理）
- 专名保护（命中用户关键词更多者优先）
- 重复惩罚（我们我们、and and）
- 字符集合理性（CJK/Latin 协调，但不作为切流）
- 长度合理性（只有语气词/极短扣分）

#### ContextScore（推荐）
- 与 `recent_committed_text` 的关键词重合度
- 与上文一致性（弱约束）

#### NmtScore（可选，受限）
- 仅用于择优打分，不改写文本
- 只对 top2 候选计算，避免影响吞吐

### 5.4 输出与回退
- 若 best 的优势不足（Δscore < margin），保持 primary，避免抖动
- 记录 trace：primary/best/原因/候选数（可开关）

---

## 6. 与现有 Aggregator/Queue 的最小接口改造

### 6.1 AggregatorState 最小新增字段
- `recent_committed_text: Vec<String>`
- `recent_keywords: Vec<String>`（用户配置 + 上下文抽取）
- `last_commit_audio_ref: Option<AudioRef>`（仅二次解码需要）
- `last_commit_quality: Option<f32>`

### 6.2 AudioRef（建议字段）
- `session_id`
- `commit_id`
- `audio_span`: {start_ms, end_ms} 或 {chunk_ids[]}
- `storage_key`（如落盘/共享内存）

实现建议：
- Node 侧 ring buffer 缓存音频片段，TTL 5–15 秒
- Rescore worker 只读缓存

### 6.3 result_queue 可选扩展字段
- `rescore_applied: bool`
- `primary_text`, `best_text`
- `rescore_reason: string[]`
- `cand_count: u8`

---

## 7. 性能与成本控制

### 7.1 S1 成本
- 主要是 prompt 拼接，几乎无 GPU 成本
- 必须限制 prompt 长度，避免推理变慢

### 7.2 S2 成本
- N-best：无额外推理，CPU 后处理很小
- 二次解码：额外 GPU 推理，必须严格条件触发
- 建议目标：**rescore 触发率 ≤ 5%**（room 可更低）

---

## 8. 指标与验收

### 指标
- `rescore_trigger_rate`, `rescore_win_rate`, `rescore_added_latency_ms`
- `proper_noun_hit_rate`, `digit_error_rate`
- `short_utt_error_proxy`（人工抽样/规则 proxy）

### 验收建议
- 短句专名/术语错误下降明显（抽样评估）
- 数字类错误下降
- P95 延迟增加可控（建议 ≤ +120ms；二次解码低频允许更高）

---

## 9. 失败模式与保护
- prompt 过长 → 限长 + 压缩 + 开关回退
- rescore 抖动 → Δscore margin + 优势不足不替换
- 二次解码占 GPU → 单独队列 + 并发上限 + 超载降级

---

## 10. JIRA Task List（可直接导入）

### EPIC：ASR_SHORT_UTT_ACCURACY_S1_S2

**P0**
- S1-1 PromptBuilder：关键词/上下文抽取、长度压缩、配置化
- S1-2 ASR primary 接入 prompt 参数（开关 + 监控）
- S2-1 NeedRescore 判定函数（短句/低置信/高风险）
- S2-2 候选结构与 trace 字段（primary/cands/best/reason）
- S2-3 Rescorer v1：RuleScore + ContextScore
- S2-4 result_queue 扩展（可选字段，开关控制）
- OBS-1 指标埋点与回放日志

**P1**
- S2-5 接入 N-best（若引擎支持）或多采样候选
- S2-6 二次解码 worker（双配置 decode）+ 并发上限/降级
- S2-7 音频缓存 AudioRef（ring buffer + TTL）
- QA-1 短句专项用例集与回放脚本（含手动截断/停顿/夹杂词）

**P2（可选增强）**
- S1-3 Constrained Bias（Trie/prefix bias in beam search）
- AB-1 A/B 调参（prompt 长度、触发阈值、margin、beam 参数）

---

## 附录：默认参数建议
- `prompt.max_chars`: 600（room: 500）
- `prompt.max_keywords`: 30
- `prompt.max_recent_lines`: 2
- `rescore.short_cjk`: 18
- `rescore.short_en_words`: 9
- `rescore.q_low_offline`: 0.45
- `rescore.q_low_room`: 0.50
- `rescore.delta_margin`: 1.5（按 RuleScore 量纲调）
- `rescore.max_trigger_rate`: 0.05
- `secondary_decode.max_concurrency`: 1（每 GPU/每 node）
- `audio_cache.ttl_sec`: 10
