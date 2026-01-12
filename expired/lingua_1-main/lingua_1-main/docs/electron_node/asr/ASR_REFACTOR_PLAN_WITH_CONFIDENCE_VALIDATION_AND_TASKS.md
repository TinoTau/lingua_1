
# 新版改造方案：多语言轮流交流 ASR 准确率提升 + 置信度/验证模块（含 Task List）
## 基于：ASR_MULTILINGUAL_TURN_TAKING_ACCURACY_STRATEGY.md + 置信度信息说明（language_probability 等）

> 适用场景：线下双人轮流表达（停顿多、偶尔手动截断）、线上会议室（多语输入 → 单一输出语）。  
> 约束：语言不可固定；节点端 GPU 必选；准确率问题以“关键字/同音词替换”导致翻译语义崩坏为主要症状。

---

## 1. 设计目标（DoD）

### 1.1 P0（必须达成）
- 手动截断/自动断句下 **句尾漏字明显下降**（尾音不被截断）
- “长音频短文本”“乱码”占比显著下降
- 多语言输入下 **不依赖固定语言**，系统仍稳定输出
- 引入验证/置信度模块后，整体吞吐与延迟可控（会议室模式尤为关键）

### 1.2 P1（强烈建议）
- “关键实体词/名词”同音错词导致的翻译跑偏显著下降（通过候选+重排择优）
- 坏段触发式补救可解释、可观测（指标完善）

---

## 2. 可用置信度与可增强的置信度（现状对齐）

### 2.1 已实现且可直接使用：语言检测置信度 `language_probability`
- 含义：模型对检测语言的置信度（0~1）
- 来源：Faster-Whisper 的 `info.language_probabilities[detected_language]`
- 状态：已实现并透传到各层，可用于分级/坏段判定/质量评分

### 2.2 需要补齐（P0）：Segment 时间戳（start/end）
用途：
- 检测“文本断裂”（segments gap 过大）
- 检测“segments 数异常”（音频长但 segments 少）
开销：小，收益大（建议立即做）。

### 2.3 可选（P1）：Word/Token 级置信度（`word_timestamps=True`）
用途：
- 定位“低置信词/疑似同音错词 span”
- 只对疑似坏段启用，可控性能开销（通常 10-20% 级别，需实测）

---

## 3. 新版总体方案（组合策略）

### 3.1 边界稳态化（P0，最高收益）
- Hangover：
  - 自动 finalize：120–180ms（建议默认 150ms）
  - 手动截断：180–220ms（建议默认 200ms）
- Padding：200–300ms（建议自动 220ms、手动 280ms）
- Short-merge：<400ms 片段缓冲合并下一段
- 可选 Lookback overlap：80–120ms（默认关闭，待去重稳定后开启）

### 3.2 语言不可固定：置信度驱动分级（P0）
对每个 utterance **仍使用 auto-detect**，但按 `language_probability` 做策略分级：
- p ≥ 0.90：高置信 → 正常流程
- 0.70 ≤ p < 0.90：中置信 → 正常流程 + 记录 top-2（用于后续补救）
- p < 0.70：低置信 → 强制关闭上下文提示 + 进入“坏段候选流程”

> 默认关闭上下文提示（use_text_context=false），仅在极少数“同语种连续且高置信”的窗口中才允许开启（可选）。

### 3.3 “验证/补救”模块（新增核心）：候选生成 + 重排择优（P1）
针对主要症状（关键词同音替换），推荐以 **Rerank** 为主、Repair 为辅：

#### 3.3.1 候选来源（最多 3 类，按成本从低到高）
1) **Top-2 强制语言重跑**（仅坏段触发，最多 2 次）
2) **同音候选生成（中文场景强力）**：对疑似低置信 span 生成 3–10 个同音/近音替换候选（仅触发）
3) （可选）**第二小型 ASR 验证模型**：仅在极端坏段触发，常驻 GPU 内存成本需评估

#### 3.3.2 重排打分（Quality Score）
对每个候选文本计算综合分数，选择最高者作为最终 ASR 输出：
- 基础分：文本长度（过短惩罚）
- 语言分：language_probability（越高越可信）
- 垃圾惩罚：乱码/异常字符（强惩罚）
- 断裂惩罚：segments gap/异常（需要时间戳）
- 词级惩罚（可选）：低置信词比例（需要 word_timestamps）
- 术语奖励（强烈建议）：命中 glossary 的候选加分；把 glossary 词写错的候选减分
- 去重惩罚：与上一条/最近窗口高度重复（防止重复三连）

---

## 4. 关键实现细节（可直接落地）

### 4.1 置信度分级与动态开关（Node 端建议实现点）
伪代码（TypeScript，示意）：
```ts
const p = asr.language_probability ?? 0;

let useTextContext = false; // 默认关闭
if (p >= 0.90 && recentLangConsistent && promptLen <= 100) {
  // 可选：仅在非常稳定窗口才开启
  useTextContext = true;
}

if (p < 0.70) {
  // 低置信：强制关闭上下文（防污染）
  useTextContext = false;
  conditionOnPreviousText = false;
}
```

### 4.2 坏段判定器（Bad Segment Detector）
最小可行版本（不依赖 word-level）：
- 低置信 + 长音频短文本：`p<0.70 && audioMs>=1500 && textLen<5`
- 乱码/异常字符（例如 U+FFFD）
- segments 异常（P0：在提取 start/end 后启用）：
  - 相邻 segments gap > 1.0s
  - 平均 segment 时长 > 5s（音频长但 segments 少）

### 4.3 Segment 时间戳提取（P0）
- 在 Node 端 ASR 返回结构中加入：
  - `segments: [{startSec, endSec, text}]`
- 并在 Scheduler/日志层透传，供坏段判定与质量评分使用

### 4.4 Word-level 置信度（P1，可选、限频启用）
- 仅当坏段触发时，对该段音频进行一次带 `word_timestamps=True` 的识别
- 计算：低置信词比例、最低置信词列表（用于同音候选生成定位）

### 4.5 同音候选生成（中文优先，P1）
触发条件建议更严格（避免频繁）：
- 检测到疑似关键字 span（低置信词或 glossary 词写错）
- 且该 span 属于中文（CJK 占比高）

候选生成策略：
- 只替换 1 个 span（一次只改一个词），候选数上限 10
- 优先从 glossary / 用户自定义词库 / 常用高频词库中找同音候选
- 对每个候选计算 Quality Score，择优

### 4.6 全链路可观测性（必须）
新增字段（Node → Scheduler → Web/日志）：
- `asr_quality_level: good/suspect/bad`
- `reason_codes: []`
- `quality_score`
- `rerun_count`
- `top2_langs`
- `segments_meta`（数量、最大 gap、平均时长）
- （可选）`low_conf_words_count`

---

## 5. 新版 Task List（JIRA）

### EPIC-ASR-P0-EDGE：边界稳态化（P0）
- EDGE-1 统一 finalize 接口（自动/手动/异常） — 0.5d
- EDGE-2 自动 finalize Hangover（默认 150ms，可配）— 0.5d
- EDGE-3 手动截断 Hangover（默认 200ms，可配）— 0.5d
- EDGE-4 Padding（自动 220ms / 手动 280ms，可配）— 0.5d
- EDGE-5 Short-merge（<400ms 合并）— 1.0d
- EDGE-6 配置下发：线下/会议室模式差异化参数 — 0.5d

### EPIC-ASR-P0-CONF：置信度与 segments 时间戳（P0）
- CONF-1 `language_probability` 分级逻辑落地（已有字段，补齐策略开关）— 0.5d
- CONF-2 提取并透传 segments start/end（结构升级）— 1.0d
- CONF-3 基于 segments 时间戳的断裂/异常检测（bad detector 子模块）— 0.5d

### EPIC-ASR-P0-OBS：指标与日志（P0）
- OBS-1 埋点：asr_e2e_latency p50/p95/p99、lang_prob 分布、bad_rate — 0.5d
- OBS-2 reason_codes 与 quality_score 透传（Node→Scheduler→Web）— 0.5d
- OBS-3 限频/超时机制：rerun 次数上限、会议室更严格 — 0.5d

### EPIC-ASR-P1-RERUN：Top-2 语言重跑（P1）
- RERUN-1 坏段判定器 v1（低置信/短文本/乱码 + segments 异常）— 1.0d
- RERUN-2 Top-2 强制语言重跑（最多 2 次）— 1.0d
- RERUN-3 质量评分选择器（quality_score 公式落地）— 0.5d

### EPIC-ASR-P1-WORD：Word-level 置信度（可选，P1）
- WORD-1 在坏段触发时启用 `word_timestamps=True` — 0.5d
- WORD-2 低置信词比例与低置信词列表计算 — 0.5d

### EPIC-ASR-P1-HOMOPHONE：同音候选生成与重排（中文）（P1）
- HMP-1 glossary 接口（会议室/线下可配置词表）— 1.0d
- HMP-2 同音/近音候选生成器（候选<=10，只改一个 span）— 2.0d
- HMP-3 候选重排：规则/术语综合打分（先无 LM 版本）— 1.0d
- HMP-4 （可选）引入轻量 LM 打分（GPU 批处理、超时）— 2.0d

### EPIC-ASR-QA：A/B 与压测（P0/P1）
- QA-1 A/B 分桶：按 sessionId/roomId hash — 0.5d
- QA-2 回放用例：手动截断/停顿/多语切换 — 1.0d
- QA-3 会议室压测：吞吐、p95 延迟、rerun 触发率 — 1.0d

---

## 6. 建议实施顺序（最短路径）
1) P0 边界稳态化（Hangover/Padding/Short-merge）
2) P0 segments 时间戳提取 + 断裂/异常检测
3) P0 指标/限频/透传（为后续优化提供观测）
4) P1 Top-2 语言重跑 + quality_score 择优
5) P1 同音候选生成（先 glossary/规则版，后 LM/word-level）
