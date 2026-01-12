# Aggregator 改造方案（Text Incompleteness Score + Language Stability Gate）
## 面向低等待时间、多语言夹杂、手动截断场景的节点端文本聚合与修复设计（可交付开发）

**适用范围**：节点端（GPU 常驻）、线下双人轮流交流（多停顿、夹杂语言、可能手动截断）、线上会议室（多语输入→单语输出）。  
**核心目标**：
1. **降低等待时间**：不再依赖“3 秒静音”触发 finalize 才出结果；输出应尽快可见/可播。  
2. **多语言鲁棒**：不能固定输入语言；支持夹杂词（术语、专名、外来词）不误切 stream。  
3. **减少翻车**：ASR 同音字/局部错词导致译文语义偏航，提供保守可控的修复路径。  
4. **控制成本**：默认不引入滚动 ASR（rolling ASR），避免额外 GPU 推理开销。

---

## 1. 问题回顾（从“为什么要做 Aggregator”开始）

在将 `pause_ms` 下调、或用户使用“手动截断”触发边界后，系统容易出现：

- **utterance 过碎**：一句话被切成多段，导致用户体验“断断续续”，翻译延迟累积。  
- **边界重复**：上一段尾词在下一段开头重复出现（“我们我们…/and and …”）。  
- **语言抖动误切**：夹杂英语词/术语时，语言 top1 在 zh/en 间跳，导致 stream 被错误拆分。  
- **标点不可依赖**：实时 ASR 的标点通常是“回填/延迟/不稳定”，不能作为硬边界。  

结论：**边界/拼接应该由节点端 Aggregator 在“文本层”做重建**，把“ASR 分段”和“用户感知句子”解耦。

---

## 2. 总体架构与职责边界

### 2.1 处理链路（已实现为中间件架构）

**当前实现（中间件模式）**：
```
Web / Client Audio
  → Scheduler finalize（更快、更频繁，但不硬切语义）
      → NodeAgent.handleJob()
          → InferenceService.processJob()
              → PipelineOrchestrator.processJob()
                  ├─ ASR Service → ASRResult
                  ├─ NMT Service → NMTResult
                  └─ TTS Service → TTSResult
              → JobResult (包含 segments)
          → AggregatorMiddleware.process()  ← 中间件处理
              - Stream merge / split（边界判断）
              - Dedup（边界去重）
              - Commit（增量提交策略）
              - Tail Carry（尾巴延迟归属）
              - Text Incompleteness Score（未完成度）
              - Language Stability Gate（语言稳定门）
          → JobResultMessage (发送到 Scheduler)
```

**架构优势**：
- ✅ **解耦设计**：Aggregator 作为中间件，不依赖 PipelineOrchestrator 的具体实现
- ✅ **不影响模型替换**：替换 ASR/NMT/TTS 模型时，Aggregator 逻辑保持不变
- ✅ **可配置**：可以轻松启用/禁用，不影响其他组件
- ✅ **可扩展**：可以添加其他中间件（如 NMT Repair）

详细架构说明参见：`AGGREGATOR_MIDDLEWARE_ARCHITECTURE.md`

### 2.2 原则（必须对齐）
- **ASR**：提供证据（文本 + 语言概率 + 置信/质量 + segments 时间戳）。不负责“句子拼接”。  
- **Aggregator（中间件）**：负责“用户可感知边界”的重建；优先文本级手段解决问题。  
- **NMT Repair**：只做保守、可回退的修复（同音候选、重复/短尾去噪），不做大幅改写。  
- **默认不 rolling ASR**：除非后续 P2 明确需要（成本高、复杂度大、链路更长）。

---

## 3. 核心机制 A：Text Incompleteness Score（文本未完成度评分）

### 3.1 设计动机
- 标点在实时场景不稳定；不能用“有/无标点”判句子完成。  
- 多语言夹杂场景下，语言切换也不能作为硬边界。  
- 需要一个**语言无关**的“该段是否更像承接前后文”的评分。

### 3.2 输入信号（每个 utterance）
- `text`：ASR 文本  
- `gap_ms`：与前一 utterance 的时间间隔（单调时钟/音频时间轴）  
- `qualityScore`：识别质量分/置信相关输出（若有）  
- `is_manual_cut` / `is_final`：是否手动截断或强制 final  
- （弱信号）`ends_with_strong_punct`：是否存在强句末符号

### 3.3 评分项（可累计，权重可调）
> 说明：下面参数给出默认权重；生产可通过 A/B 调参。

| 评分项 | 条件（CJK/EN） | 权重（建议） | 说明 |
|---|---|---:|---|
| 极短文本 | CJK < 4 字；EN < 3 词 | +3 | 强承接信号，通常不应单独成句 |
| 短文本 | CJK < 8–12 字；EN < 4–6 词 | +2 | 口语停顿/碎片常见 |
| 短 gap | gap_ms < strongMerge+200 | +2 | 连续说话时网络/VAD 抖动会导致切碎 |
| 无强句末标点 | 末尾非 。！？.!?；; | +1 | 弱信号，仅辅助 |
| 连接词/语气词尾 | 白名单命中 | +1 | 弱信号，仅辅助 |
| 低质量 | qualityScore < 0.45(线下)/0.50(会议) | +1 | 低质量更可能需要上下文承接 |

**阈值**：`score_threshold = 3`（达到即倾向 MERGE）。

### 3.4 注意事项（避免误用）
- 标点/连接词 **必须是弱信号**，不得升级为 hard rule。  
- 分数只用于“倾向 merge”，最终仍受 gap 与语言稳定门约束。  

---

## 4. 核心机制 B：Language Stability Gate（语言稳定性门）

### 4.1 设计原则
- **语言变化 ≠ 新 stream**（夹杂词、术语、专名会造成 top1 抖动）。  
- 只有在“前后都高置信且切换明显”时，语言变化才具有边界意义。  
- 语言门必须与 gap 联动：**gap 很短时不因语言切换而切流**。

### 4.2 高置信语言切换（Confident Switch）判定
同时满足：
1. `prev.p_top1 >= 0.80`  
2. `curr.p_top1 >= 0.80`  
3. `prev.lang_top1 != curr.lang_top1`  
4. `(curr.p_top1 - curr.p_top2) >= 0.15`（会议室可提高到 0.18–0.20）  
5. `gap_ms > 600`（会议室可降到 500）

满足则认为“稳定切换”，可推动 `NEW_STREAM`。否则忽略语言切换信号。

---

## 5. Stream Boundary：merge vs new_stream（完整决策）

### 5.1 硬规则（最高优先级）
任一满足 → `NEW_STREAM`：
- `is_final == true` 或 `is_manual_cut == true`  
- `gap_ms >= hard_gap_ms`  
- session/room 发生切换（上层事件）

### 5.2 语言稳定门
若 `confident_lang_switch == true` 且 `gap_ms > langSwitchRequiresGapMs` → `NEW_STREAM`

### 5.3 强 merge
- `gap_ms <= strong_merge_ms` → `MERGE`（除非硬规则触发）

### 5.4 评分 merge（软判定）
计算 `TextIncompletenessScore`：
- `score >= score_threshold` 且 `gap_ms <= soft_gap_ms` → `MERGE`
- 否则 → `NEW_STREAM`

### 5.5 伪代码（与实现一致）
```text
if manual_cut or is_final -> NEW_STREAM
if gap >= HARD_GAP -> NEW_STREAM
if lang_switch_confident -> NEW_STREAM
if gap <= STRONG_MERGE -> MERGE
if score >= SCORE_TH and gap <= SOFT_GAP -> MERGE
else -> NEW_STREAM
```

---

## 6. Commit Boundary：何时提交给翻译/显示（降低等待时间的关键）

> 重点：降低等待时间主要通过 **commit 更快** 实现，而不是把 pause_ms 压到极低。

### 6.1 提交触发（任一触发即可 commit）
1. **时间触发**：`now - last_commit_ts >= commit_interval_ms`  
2. **长度触发**：累计 `pending_text` 超过阈值  
3. **标点触发**：出现强句末标点（可提前提交，但不作为必要条件）

### 6.2 Tail Carry（尾巴延迟归属）
- 每次 commit 保留尾部 `tail_tokens` 不提交（例如 1–3 token / CJK 2–6 字）。  
- 下一轮合并时把 tail 作为 prefix 参与去重/修复。  
- 作用：
  - 减少边界误切与重复  
  - 避免“短尾单独输出”  
  - 为同音纠错提供更稳定上下文窗口

### 6.3 Dedup（边界去重）
- 对 `prev_tail` 与 `curr_head` 做重叠检测（最长重叠前后缀），裁剪重复部分。  
- 推荐阈值：
  - `dedup_min_overlap`: 3–5 字符 / 1–2 词  
  - `dedup_max_overlap`: 10–18 字符 / 5–8 词  

---

## 7. NMT Repair：同音字与轻量去噪（可选 P1）

### 7.1 触发条件（建议）
- `qualityScore < repair_threshold`  
- 识别文本命中“高风险词表/同音歧义词”  
- 发生明显重复（dedup 裁剪量高）或短尾噪声频繁

### 7.2 修复动作（严格受限，避免“编造”）
- 候选集（2–6）：
  - 原文
  - 同音替换（**单 span**）
  - 去重/去噪（重复、短尾、口头填充词）
- 打分择优：
  - 规则分：glossary/专名保护、重复惩罚、数字保护
  - 语言模型/NMT 分：自然度/一致性
- **禁止新增实体/数字/专名**：未在原文或 glossary 中出现的实体不得引入。

---

## 8. 参数表（线下/会议室默认值）

> 下表为“稳态默认值”，推荐先按此落地，后续再 A/B 调参。

### 8.1 线下模式（Offline turn-taking）
- `pause_ms`: 1000–1200（Scheduler 侧）  
- `hard_gap_ms`: 2000  
- `soft_gap_ms`: 1500  
- `strong_merge_ms`: 700  
- `langStableP`: 0.80  
- `langSwitchMargin`: 0.15  
- `langSwitchRequiresGapMs`: 600  
- `score_threshold`: 3  
- `commit_interval_ms`: 1200–1500  
- `commit_len_cjk`: 24–36  
- `commit_len_en_words`: 10–16  
- `tail_carry_tokens`: 1–3（CJK 2–6）

### 8.2 会议室模式（Room multi-input → single-output）
- `pause_ms`: 800–1000  
- `hard_gap_ms`: 1500  
- `soft_gap_ms`: 1000  
- `strong_merge_ms`: 600  
- `langStableP`: 0.80  
- `langSwitchMargin`: 0.18–0.20  
- `langSwitchRequiresGapMs`: 500  
- `score_threshold`: 3  
- `commit_interval_ms`: 800–1200  
- `commit_len_cjk`: 18–28  
- `commit_len_en_words`: 8–12  
- `tail_carry_tokens`: 2–4（CJK 4–8）

---

## 9. 调参建议（先稳后快）

1) **先用 commit 提速**：优先降低 `commit_interval_ms`，而不是极限降低 `pause_ms`。  
2) 误切多（过于 NEW_STREAM）：
   - 提高 `langSwitchMargin`（0.15→0.18/0.20）
   - 提高 `soft_gap_ms`
   - 提高 `score_threshold` 或降低短文本权重（谨慎）
3) 误并多（不同轮次合一起）：
   - 降低 `hard_gap_ms`（2000→1800）
   - 降低 `soft_gap_ms`
   - 提高 `langSwitchRequiresGapMs`（让语言切换更不敏感）  
4) 重复多：
   - 增加 `tail_carry_tokens`
   - 调整 `dedup_max_overlap`  
5) 输出过碎：
   - 提高 `commit_len_*` 或提高 `commit_interval_ms`（会议室慎用）

---

## 10. 失败模式清单（Failure Modes）与对策

- **FM1：边界词重复（我们我们 / and and）**  
  对策：Dedup（重叠裁剪）+ Tail Carry + 提升 padding/hangover（Scheduler）

- **FM2：夹杂语言误切 stream**  
  对策：Language Stability Gate（必须双高置信 + margin + gap）；提高 `langSwitchMargin`

- **FM3：会议室延迟仍高**  
  对策：降低 `commit_interval_ms`（800–900）；降低 `commit_len_*`；保持 tail carry

- **FM4：NMT 修复“改错内容”**  
  对策：禁止新增实体/数字；单 span 替换；glossary 强保护；提高 repair 触发门槛

- **FM5：最后一句不 flush**  
  对策：stop/leave 强制 flush；埋点 `flush_noop_count`；确保 flush 创建 job

---

## 11. 观测指标与验收标准

### 11.1 关键指标（必须埋点）
- `commit_latency_ms`（用户端首个输出延迟）  
- `merge_rate` / `new_stream_rate`  
- `very_short_utt_rate`  
- `boundary_dup_rate`（dedup 裁剪比例 / 次数）  
- `tail_carry_usage`  
- （可选）`repair_trigger_rate` 与 `repair_success_rate`

### 11.2 验收标准（建议）
1. 用户无需等待 3 秒静音即可看到翻译输出（会议室目标：≤1.2s 首次输出）。  
2. 夹杂语言不再导致频繁误切。  
3. 边界重复显著下降（≥60%）。  
4. 极短 utterance 单独输出次数下降（≥70%）。  
5. ASR 推理次数无显著增长（默认不 rolling ASR）。  

---

## 12. JIRA Task List（可直接拆分）

### EPIC：AGGREGATOR_TEXT_BOUNDARY_REFACTOR

**P0（必做）**
- AGG-1：Aggregator 会话态管理（per session / room）
- AGG-2：Text Incompleteness Score（计算 + 可配置参数）
- AGG-3：Language Stability Gate（基于 lang probabilities）
- AGG-4：merge/new_stream 决策函数（硬规则 + 软规则）
- AGG-5：Commit 策略（time/len/weak punct）
- AGG-6：Tail Carry（尾巴延迟归属）
- AGG-7：Dedup（边界重叠裁剪）
- AGG-8：stop/leave flush 与 result_queue 对齐（避免最后一句丢失）
- AGG-9：指标埋点与日志（便于回放调参）

**P1（增强）**
- AGG-10：NMT Repair（同音候选 + 轻去噪 + 打分）
- AGG-11：glossary/专名/数字保护
- AGG-12：A/B 调参框架（配置下发 + 回放评测）
- AGG-13：失败模式回放用例集（含夹杂语言、手动截断、停顿）

---

## 13. 结论

通过 **Text Incompleteness Score + Language Stability Gate**，在不增加 ASR 推理开销的前提下：
- 将“边界判断”从不可靠的标点、以及不稳定的语言抖动中解耦  
- 用文本层聚合实现更快 commit、更少重复、更少碎片  
- 让同音字/轻量噪声可通过受限 NMT 修复进一步降低翻车率  
- 为后续 P2（必要时 rolling ASR）保留演进空间

