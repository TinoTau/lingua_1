# S1/S2 短句准确率提升方案（落地版，可立即执行）
## 上下文偏置（S1）+ 双通道解码与复核（S2）——含“未来解耦”但本阶段不实现

**版本**：v1.1（交付开发落地）  
**范围声明**：本版本以最快可落地为第一原则，默认在现有节点端/fast-whisper 服务链路内实现；同时保留“解耦设计”的接口与边界约束，但不在本阶段实现进程隔离/独立服务化。  
**目标**：在不显著增加整体延迟与 GPU 负载的前提下，提升短句（短文本块）的识别稳定性，重点降低“同音字/近音词替换导致译文语义偏航”的错误。

---

## 0. 一句话总结（给开发部门）
- **S1（Prompt Bias）**：为 ASR 解码注入“关键词 + 最近上下文”的软偏置，提高 1-best 命中率。  
- **S2（Rescoring）**：仅对短句 + 低置信/高风险触发候选生成与复核择优；优先走 N-best，无 N-best 再走二次解码。  
- **本阶段不做解耦服务化**：但按 Adapter + Rescore 内聚模块的方式写代码，后续可平滑抽离。

---

## 1. 现状问题与约束

### 1.1 典型问题
- 短句/手动截断/pause_ms 下调后，ASR 易出现“一个显而易见的词被同音字替换”，翻译语义偏航明显。
- 多语言夹杂（术语/外来词）导致语言抖动，影响下游稳定性。
- 不能对每条 utterance 做 rolling ASR（成本/延迟不可控）。

### 1.2 工程约束
- 节点端 GPU 常驻；主链路吞吐优先。
- 可增加 CPU 逻辑与少量条件触发的 GPU 复核，但必须有限流/降级。
- 未来会接入其他 ASR，但本阶段只落地 fast-whisper。

---

## 2. 系统集成位置（最小改动）

建议的数据流：

```
Audio → fast-whisper primary decode（S1: prompt 注入）
     → Aggregator（Score+Gate+Dedup+TailCarry，产出 commit_text）
     → NeedRescore(commit_text, quality, flags, ctx)
         ├─ no  → 直接进入 NMT 翻译
         └─ yes → CandidateProvider → Rescorer → best_text → NMT 翻译
```

关键原则：
- S2 在 Aggregator commit 后触发：文本更稳定、触发更少、复核更准确。
- S2 必须严格条件触发，并具备超载降级（见 7）。

---

## 3. S1：上下文偏置（Prompt Bias）落地细则

### 3.1 Prompt 内容来源（优先级）
1) 用户/房间配置关键词（专名、术语、产品名）  
2) 会话内最近 committed_text 提取的关键词（高频、专名）  
3) 可选：固定少量系统词（通常不需要）

### 3.2 Prompt 结构（建议）
```
[CONTEXT]
Keywords:
- <k1>
- <k2>
Recent:
<line1>
<line2>
[/CONTEXT]
```

### 3.3 长度与压缩（必须）
- `prompt.max_chars`: 600（room: 500）
- `prompt.max_keywords`: 30
- `prompt.max_recent_lines`: 2
- 关键词去重、按优先级截断
- recent 文本截断：每行 60–120 字符

### 3.4 门控（重要优化：防止“错误上下文污染”）
- quality 高/中：启用 keywords + recent
- quality 很低：只启用 keywords，禁用 recent（recent 更容易污染）
- prompt 异常：自动回退空 prompt（开关）

---

## 4. S2：双通道解码 + 复核（Rescoring）落地细则

### 4.1 NeedRescore 触发条件（必须条件触发）
对每个 commit_text 计算 NeedRescore，满足任一触发：

**(A) 短句条件**
- CJK：`len_chars < 12–18`
- EN：`word_count < 6–10`

**(B) 低置信条件（若有 quality_score）**
- offline：`quality_score < 0.45`
- room：`quality_score < 0.50`

**(C) 高风险特征（命中任一）**
- 含数字/单位/金额/时间（12、30%、3点、$ 等）
- 命中用户关键词中的专名/术语（优先）
- 命中“小型风险词表”（静态表，不做学习系统）
- dedup 裁剪量异常高（边界抖动信号）

**不触发（强约束）**
- 文本过长且质量高
- 同一 commit 已复核（幂等）
- 节点超载（见 7.2）

> 缺失字段降级：没有 quality_score 时仅按短句+高风险触发；没有 lang_probs 则不做语言相关加权。

### 4.2 候选生成（CandidateProvider）
优先级：N-best → 二次解码 → 不触发

**(1) N-best（优先）**
- 若 fast-whisper/封装支持 alternatives，N=3–5。

**(2) 二次解码（仅在必须时）**
- primary：速度优先配置
- secondary：更保守配置（更大 beam、更高 patience、或更低 temperature 等）
- 仅在短句 + 低置信 + 高风险同时满足时触发。

**(3) 音频引用（AudioRef）**
- 二次解码需要定位 commit 对应音频：
  - Node 端 ring buffer 缓存 5–15 秒音频，按 {start_ms,end_ms} 或 chunk_ids 索引。
- 若拿不到音频引用：禁止二次解码，只能用 N-best 或放弃复核。

### 4.3 复核打分（Rescorer v1：规则+上下文）
对候选 `cand_i` 计算：
`Score = w_rule*RuleScore + w_ctx*ContextScore (+ w_nmt*NmtScore 可选)`

#### RuleScore（必须）
- 数字保护：数字/单位格式更合理者得分更高
- 专名保护（分层权重）：
  1) 命中用户显式关键词（最高）
  2) 命中会话高频关键词（中）
  3) 疑似专名（大写/混合）仅低权重（避免误判）
- 重复惩罚：明显重复（我们我们、and and）扣分
- 极短/语气词惩罚：只有“嗯/啊/and”扣分
- 长度合理性：过短或不完整扣分

#### ContextScore（推荐）
- 与 recent_committed_text 的关键词重合度
- 与上文字符集/语言一致性（弱约束，不作为切流）

#### NmtScore（可选，受限）
- 仅用于择优，不允许改写文本
- 只对 top2 候选打分，避免影响吞吐

### 4.4 替换策略与回退
- 若 `best_score - primary_score < delta_margin`：保持 primary，避免抖动
- 记录 trace：触发原因、候选数、best 是否替换、added latency（可开关）

---

## 5. 与现有 Aggregator/Queue 的接口改造（最小集）

### 5.1 AggregatorState 新增字段（必要）
- `recent_committed_text: Vec<String>`
- `recent_keywords: Vec<String>`（用户配置 + 上下文抽取）
- `last_commit_quality: Option<f32>`
- `last_commit_audio_ref: Option<AudioRef>`（仅二次解码需要）

### 5.2 result_queue 可选扩展字段（强烈建议）
- `rescore_applied: bool`
- `primary_text`, `best_text`
- `rescore_reason: string[]`
- `cand_count: u8`
- `rescore_added_latency_ms: u32`

---

## 6. 未来解耦保留但本阶段不实现（工程约束）
为将来接入其他 ASR，本阶段实现需满足：
- S1/S2 逻辑通过内部接口调用：`AsrAdapter`（映射/能力查询）+ `ShortUtteranceRescore`（引擎无关逻辑）
- Rescorer 内部不直接解析 fast-whisper 原始结构；解析放 Adapter。
- 未来抽离为独立进程/服务时，主要改动应仅限于 Adapter 的 I/O 层。

---

## 7. 性能、限流与降级（必须落地）

### 7.1 目标
- `rescore_trigger_rate ≤ 5%`（room 建议更低）
- 正常负载下 P95 额外延迟 ≤ +120ms（二次解码低频允许更高）

### 7.2 降级策略（必须）
当满足任一立即降级：
- rescore worker 队列长度 > 3
- 预计等待时间 > 200ms
- GPU busy/VRAM 压力过高（按可用信号）

降级动作：
- 若有 N-best：只做 N-best + 规则复核
- 否则：跳过复核，直接用 primary
- trace 写入 `overload_skip=true`

### 7.3 硬限流
- 每 session 每 10 秒最多触发 3 次
- 全局每秒最大触发 5 次
- 超过即跳过复核（记录 trace）

---

## 8. 指标与验收

### 8.1 指标（必须）
- `rescore_trigger_rate`, `rescore_win_rate`, `rescore_added_latency_ms`
- `proper_noun_hit_rate`, `digit_error_rate`, `short_utt_error_proxy`
- `overload_skip_rate`

### 8.2 验收建议
- 短句专名/术语错误下降明显（抽样评估）
- 数字相关错误下降
- P95 延迟增加可控
- GPU 负载与吞吐无明显回退（触发率受控）

---

## 9. 开发拆分（JIRA Task List）

### EPIC：ASR_SHORT_UTT_S1_S2

**P0（可立即开工）**
- S1-1 PromptBuilder：关键词/上下文抽取、压缩、配置化
- S1-2 fast-whisper primary 接入 prompt（开关 + 监控）
- S2-1 NeedRescore 判定函数（缺字段降级）
- S2-2 Rescorer v1：RuleScore + ContextScore + delta_margin 回退
- S2-3 Trace/埋点：trigger/win/latency/overload_skip
- OPS-1 动态配置：offline/room 参数切换

**P1（增强，依赖验证）**
- SPIKE-1 验证 fast-whisper 是否支持 N-best/alternatives
- S2-4 N-best 接入（若支持）
- S2-5 AudioRef + 音频 ring buffer（TTL 10s）
- S2-6 二次解码 worker（双配置）+ 并发上限 + 降级
- QA-1 短句专项回放集与脚本（含手动截断/停顿/夹杂词）

**P2（后续可选）**
- S1-3 Constrained Bias（Trie/prefix bias in beam search）
- AB-1 A/B 调参框架（灰度）

---

## 10. 开工确认的 6 个问题（Checklist）
1) fast-whisper 是否支持 prompt/initial_prompt？参数名与生效范围？  
2) 是否支持 N-best？若不行，二次解码可调哪些参数（beam/patience/temp）？  
3) `quality_score` 当前来源是什么？缺失则按降级逻辑走。  
4) Node 侧是否可实现音频 ring buffer？索引方式（ms span 或 chunk id）？  
5) result_queue 是否允许携带 trace 字段（可开关）？  
6) offline/room 参数由 Scheduler 下发还是 Node 本地配置？

---

## 附录：默认参数建议
- `prompt.max_chars`: 600（room: 500）
- `prompt.max_keywords`: 30
- `prompt.max_recent_lines`: 2
- `rescore.short_cjk`: 18
- `rescore.short_en_words`: 9
- `rescore.q_low_offline`: 0.45
- `rescore.q_low_room`: 0.50
- `rescore.delta_margin`: 1.5
- `rescore.max_trigger_rate`: 0.05
- `secondary_decode.max_concurrency`: 1
- `audio_cache.ttl_sec`: 10
- `rate_limit.per_session_per_10s`: 3
- `overload.queue_len_threshold`: 3
- `overload.wait_ms_threshold`: 200
