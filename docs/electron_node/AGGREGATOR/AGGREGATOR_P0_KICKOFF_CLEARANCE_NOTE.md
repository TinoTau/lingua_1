# Aggregator P0 开工说明（实施前确认文件）
## Text Incompleteness Score + Language Stability Gate

**文件目的**  
本文件用于在 Aggregator P0 阶段正式开工前，与开发部门确认：  
- 方案已具备工程可实施性  
- 阻断项（Blocker）已明确解决路径  
- P0 实现范围、非目标、验收标准达成一致  
- 可以进入编码与联调（Scheduler / Node / result_queue）阶段

**结论先行**  
在完成下述 **2 个 Blocker 的确认** 后，可以立即开始 P0 开发。

**架构说明**  
P0 实现采用**中间件架构**，Aggregator 作为 `NodeAgent` 中的中间件，不依赖 `PipelineOrchestrator` 的具体实现，便于后续模型替换和功能扩展。详细说明参见：`AGGREGATOR_MIDDLEWARE_ARCHITECTURE.md`

---

## 1. 背景与目标

当前系统为降低等待时间，倾向缩短 `pause_ms` 或允许“手动截断”触发边界。实际效果是：

- utterance 变碎（一句话被切成多段）
- 边界重复（上一段尾词在下一段开头重复，如“我们我们 / and and”）
- 多语言夹杂（术语/外来词）导致语言 top1 抖动，从而误切 stream
- 标点在实时场景不稳定，无法作为硬边界

P0 的目标：**在不增加 ASR 推理负载（默认不 rolling ASR）的前提下**，通过 Node 侧 Aggregator 对文本层进行重建，显著改善：

1) **等待时间**：不依赖 3 秒静音，尽快输出可翻译文本  
2) **一致性**：减少 utterance 碎片、减少重复与短尾噪声  
3) **多语言鲁棒**：夹杂语言不误切 stream

---

## 2. P0 开工前 Blocker（必须逐条确认）

### Blocker 1：gap_ms 的可靠来源（必须确定一种）
Aggregator 的 merge/new_stream 决策依赖：
`gap_ms = curr.start_ms - prev.end_ms`

但当前链路中，可能存在：
- `JobAssignMessage` 未携带 start/end 时间戳
- ASR segments 时间戳未透传或为空

**确认项（必须二选一）：**
- ☐ **方案 A（优先）**：Node 侧从 ASR `segments[].start/end` 推导 utterance 起止时间  
  - 约束：segments 需稳定存在，并且语义为“相对音频时间轴”或可转为单调时间
- ☐ **方案 B**：Scheduler 在 `JobAssignMessage` 中显式下发 `start_time_ms / end_time_ms`  
  - 约束：需使用单调时间或音频时间轴，避免 wall-clock 漂移

**验收要求：**
- gap_ms 必须可计算，且在同一 session 内单调一致  
- 缺失时必须有降级策略（见 6.3）

> 未明确该项 → Aggregator 的 hard/soft gap 与 Language Gate 无法按设计生效，P0 不可开工。

---

### Blocker 2：跨 utterance 的 Dedup + Tail Carry（必须纳入 P0）
当前重复问题主要来自**边界重复与短尾碎片**。P0 必须实现以下两项，否则“减少重复/碎片”的目标无法达成：

**2.1 Dedup（边界重叠裁剪）**
- 输入：`prev_tail`（上一段尾部） + `curr_head`（当前段开头）
- 输出：裁剪后的 `curr_text` 或拼接结果
- 推荐阈值（可配置）：
  - `dedup_min_overlap`: 3–5 字符 / 1–2 词
  - `dedup_max_overlap`: 10–18 字符 / 5–8 词

**2.2 Tail Carry（尾巴延迟归属）**
- commit 时保留尾部 token/字符，不立即输出
- 下一轮合并时作为 prefix 参与去重与归属判断
- 推荐（可配置）：
  - 线下：1–3 token / CJK 2–6 字
  - 会议室：2–4 token / CJK 4–8 字

> 未实现 Dedup/Tail Carry → 用户仍会看到“重复/短尾单独输出”，P0 价值不足。

---

## 3. P0 实现范围（Scope In）

P0 需实现并联调的模块：

1) **Aggregator 会话态管理**
- `session_id → AggregatorState`
- 支持 offline / room 两种模式参数
- 支持 TTL/LRU 回收 + session close/leave 事件清理

2) **Text Incompleteness Score**
- 语言无关评分：短文本/极短/短 gap/低质量/弱标点等
- 评分达到阈值时倾向 merge（软规则）

3) **Language Stability Gate**
- 仅当“前后双高置信 + margin + gap”满足时，语言切换才推动 new_stream
- 当语言概率缺失/null 时：自动降级（不做 confident switch）

4) **merge / new_stream 决策函数**
- 硬规则 → 语言门 → 强 merge → 评分 merge
- 与你已交付的 TS/Rust/Python 实现保持一致（便于对齐测试）

5) **Commit 策略**
- 时间触发 / 长度触发（标点仅作为弱辅助）
- commit 前执行：Dedup + Tail Carry
- stop/leave 时强制 flush

6) **埋点与可观测性**
- commit latency、dedup 裁剪量、very short rate、merge/new_stream rate、tail carry usage
- 支持离线回放（按 session 复现边界行为）

---

## 4. P0 非目标（Non-Goals）

为控制范围，P0 明确不做：

- ❌ rolling ASR（滚动重识别/重解码）
- ❌ 在 partial results 上做复杂聚合（P0 默认仅处理 final）
- ❌ 大规模语义改写（只做拼接、去重、轻量规则，修复留到 P1）
- ❌ 依赖标点作为硬边界
- ❌ 以语言变化作为唯一切流条件

---

## 5. 默认参数基线（P0）

### 5.1 线下模式（Offline）
- `hard_gap_ms`: 2000  
- `soft_gap_ms`: 1500  
- `strong_merge_ms`: 700  
- `score_threshold`: 3  
- `langStableP`: 0.80  
- `langSwitchMargin`: 0.15  
- `langSwitchRequiresGapMs`: 600  
- `commit_interval_ms`: 1200–1500  
- `commit_len_cjk`: 24–36  
- `commit_len_en_words`: 10–16  
- `tail_carry`: 1–3 token / CJK 2–6 字  
- `dedup_min/max_overlap`: 3–5 / 10–18

### 5.2 会议室模式（Room）
- `hard_gap_ms`: 1500  
- `soft_gap_ms`: 1000  
- `strong_merge_ms`: 600  
- `score_threshold`: 3  
- `langStableP`: 0.80  
- `langSwitchMargin`: 0.18–0.20  
- `langSwitchRequiresGapMs`: 500  
- `commit_interval_ms`: 800–1200  
- `commit_len_cjk`: 18–28  
- `commit_len_en_words`: 8–12  
- `tail_carry`: 2–4 token / CJK 4–8 字  
- `dedup_min/max_overlap`: 3–5 / 10–18

> 所有参数必须可配置（配置文件/下发均可），P0 支持后续 A/B 调参。

---

## 6. 工程约束与降级策略（必须写进实现）

### 6.1 partial results 处理策略（P0）
- P0：Aggregator **只消费 final**（`is_final=true`）结果  
- partial 仍可用于 UI 预览，但不参与 merge/new_stream 与 commit 输出（避免抖动）

### 6.2 会话态回收策略
- TTL：无新 utterance N 秒后回收 state（建议 60–120s）
- 显式 close/leave：立刻 flush + 清理
- LRU：并发会话过多时按最久未使用回收

### 6.3 gap_ms 缺失时的降级
- gap_ms 缺失/null：  
  - 禁止触发 “hard_gap” 规则  
  - 仅使用 score + 强 merge（如可计算）或保守 new_stream
  - 必须打点 `missing_gap_count`

---

## 7. 验收标准（Go / No-Go）

P0 完成后必须满足：

1) **等待时间**
- 用户停止说话后无需 3 秒静音即可看到翻译输出
- 会议室模式：首次可翻译输出目标 ≤ 1.2s（以埋点为准）

2) **重复与碎片**
- 边界重复显著下降（≥60%，以 dedup 裁剪/重复率指标评估）
- 极短 utterance 单独输出次数下降（≥70%）

3) **多语言鲁棒**
- 中英夹杂、术语插入不再频繁误切 stream（new_stream rate 下降且不增加误并）

4) **成本控制**
- ASR 推理次数、GPU 占用无显著增长（不 rolling）

---

## 8. 开工确认（签字/确认区）

### 8.1 Blocker 确认
- gap_ms 来源： ☑️ **方案A（segments）** ✅ 已确认可行（见 `BLOCKER_RESOLUTION_ANALYSIS.md`）  
  - 方案B（JobAssignMessage）：可行但需要协议扩展，建议 P1 考虑
- Dedup + Tail Carry： ☑️ **纳入 P0** ✅ 已确认可行  
  - ☑️ **已明确阈值与实现方式**（见文档和参考实现）

**详细分析**：参见 `BLOCKER_RESOLUTION_ANALYSIS.md`

### 8.2 责任人与日期
- 技术负责人：__________________   日期：__________  
- Node 负责人：__________________   日期：__________  
- Scheduler 负责人：______________   日期：__________  
- 产品/系统负责人：______________   日期：__________

### 8.3 最终结论
☑️ **Blocker 已解决/明确** ✅  
☑️ **P0 Scope / Non-Goals 已确认** ✅  
☑️ **允许进入 Aggregator P0 开发阶段** ✅

**确认日期**：2025-01-XX  
**分析文档**：`BLOCKER_RESOLUTION_ANALYSIS.md`

---

## 9. 实现状态更新

### 9.1 架构变更

**实现方式**：采用**中间件架构**

- ✅ Aggregator 已实现为 `NodeAgent` 中的中间件
- ✅ 不依赖 `PipelineOrchestrator` 的具体实现
- ✅ 便于后续模型替换和功能扩展

**详细说明**：参见 `AGGREGATOR_MIDDLEWARE_ARCHITECTURE.md`

### 9.2 实现状态

✅ **P0 核心功能已全部实现**

- ✅ 核心决策逻辑（Text Incompleteness Score + Language Stability Gate）
- ✅ Dedup（边界重叠裁剪）
- ✅ Tail Carry（尾巴延迟归属）
- ✅ 会话态管理（per session）
- ✅ gap_ms 计算（从 segments 推导）
- ✅ 中间件集成（NodeAgent）
- ✅ 重新触发 NMT（2025-01-XX 完成）

**详细状态**：参见 `AGGREGATOR_IMPLEMENTATION_STATUS_AND_ARCHITECTURE.md`

### 9.3 代码位置

- **中间件**：`electron_node/electron-node/main/src/agent/aggregator-middleware.ts`
- **核心逻辑**：`electron_node/electron-node/main/src/aggregator/`
- **集成点**：`electron_node/electron-node/main/src/agent/node-agent.ts`

### 9.4 最新更新（2025-01-XX）

✅ **重新触发 NMT 功能已实现并测试通过**
- 实现日期：2025-01-XX
- 测试结果：6 次重新翻译成功
- 功能状态：正常工作
- 性能：平均延迟 1077.67ms（需要优化）

**详细文档**：
- `AGGREGATOR_NMT_RETRANSLATION_IMPLEMENTATION.md` - 实现文档
- `AGGREGATOR_NMT_RETRANSLATION_TEST_REPORT.md` - 测试报告

