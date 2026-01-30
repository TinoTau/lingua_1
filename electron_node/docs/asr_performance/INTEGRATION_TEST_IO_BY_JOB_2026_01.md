# 集成测试 · 各 Job 在各服务的输入/输出一览

**报告来源**: `JOB_SERVICE_FLOW_REPORT.md`（Session s-4FDD9106，12 jobs）

下表按 Job 列出：ASR 输出 → 聚合输出 → 语义修复输出 → NMT 输入/输出 → TTS。便于对照分析翻译质量。

---

## Job 0 (utterance_index=0)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 開始進行一次語音識別穩定的測試 |
| 聚合 | 上 | segmentForJobResult=開始進行一次語音識別穩定的測試, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 15 |
| NMT | 当前句 + contextLength=15 | **译文**: Start a sound-identification stability t... (长度 44) |
| TTS | 译文 | 有音频 155024 |

**翻译质量**: 「语音识别」→ sound-identification（应为 voice/speech recognition）；「穩定的測試」→ stability test 可接受。

---

## Job 1 (utterance_index=1)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 我回鄉讀音量 |
| 聚合 | 上 | segmentForJobResult=我回鄉讀音量 一两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者再没有, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 41 |
| NMT | 当前句 + contextLength=15 | **译文**: I return to the country read volume One... (长度 160) |
| TTS | 译文 | 有音频 492264 |

**翻译质量**: 「我回乡读音量」被译成 “I return to the country read volume”，与「一两句比较短的话…」混在一起，语义错误；应为「我先读一点语音」类含义。

---

## Job 2 (utterance_index=2)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 不必要的时候提前结束本次识别 |
| 聚合 | 上 | segmentForJobResult=不必要的时候提前结束本次识别, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 14 |
| NMT | 当前句 + contextLength=41 | **译文**: Unnecessary time this identification is... (长度 61) |
| TTS | 译文 | 有音频 212368 |

**翻译质量**: 「不必要的时候提前结束本次识别」→ “Unnecessary time this identification is…” 语序/选词别扭，应为 “When unnecessary, end this recognition early” 类表达。

---

## Job 3 (utterance_index=3)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 接下来做一 |
| 聚合 | 上 | segmentForJobResult=接下来做一 我会尽量的连续地说的尝一些中间只保留自然的呼吸节奏不做刻意的停盾看看在超过, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 43 |
| NMT | 当前句 + contextLength=14 | **译文**: next do one I will try as consistently a... (长度 154) |
| TTS | 译文 | 有音频 497724 |

**翻译质量**: 「接下来做一」→ “next do one”；「我会尽量连续地说…中间只保留自然节奏…停顿…超过」被拼成一句，ASR 有误（尝/停盾），NMT 输出 “I will try as consistently as possible…” 与前半句粘连，整句语义混乱。

---

## Job 4 (utterance_index=4)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 20秒钟之后系统会不会因为超时获得精英判定而相信把这句话阶段从而导致前 |
| 聚合 | 上 | segmentForJobResult=同上, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 35 |
| NMT | 当前句 + contextLength=43 | **译文**: I will try as consistently as possible t... (长度 245) |
| TTS | 译文 | 有音频 782396 |

**翻译质量**: **严重错误**：本句应为「20 秒后系统会不会因超时或静音判定而把这句话截断…」，但 NMT 输出与 Job 3 类似 “I will try as consistently as possible…”，疑似**上下文串句**（上一句译文被当成本句译文或强影响本句）。

---

## Job 5 (utterance_index=5)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 两半句和后半句在阶点端被拆成两个不同的任务甚至出现于 |
| 聚合 | 上 | + 与以上不完整都起来将奥布连贯的情况, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 44 |
| NMT | 当前句 + contextLength=35 | **译文**: two-half phases and the last half phases... (长度 177) |
| TTS | 译文 | 有音频 569404 |

**翻译质量**: 「前半句和后半句…被拆成两个任务」→ “two-half phases and the last half phases…” 部分正确；「阶点端/将奥布连贯」为 ASR 误识，影响下游。

---

## Job 6 (utterance_index=6)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | (未找到/空) |
| 聚合 | — | segmentForJobResult 空, shouldSend=? |
| 语义修复 | — | 未执行 |
| NMT | — | translatedText 长度 0 |
| TTS | — | 无音频 |

**说明**: 低质量音频被拒，未走 NMT/TTS，仅发空结果核销。

---

## Job 7 (utterance_index=7)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 这次的长距能够被完整的识别出来而且不会出现半句话被提前发送或者直接丢失的现象那就说明我 |
| 聚合 | 上 | segmentForJobResult=同上, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 43 |
| NMT | 当前句 + contextLength=44 | **译文**: This time long distance can be fully ide... (长度 136) |
| TTS | 译文 | 有音频 457448 |

**翻译质量**: 「长距」应为「长句」（long sentence），NMT 译成 “long distance”，词义错误；后半「那就说明我」被截断。

---

## Job 8 (utterance_index=8)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 我们当前的切分策略和超市规则是基本可用的 |
| 聚合 | 上 | segmentForJobResult=同上, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 20 |
| NMT | 当前句 + contextLength=43 | **译文**: Our current cutting strategy and superma... (长度 75) |
| TTS | 译文 | 有音频 252648 |

**翻译质量**: 「超市规则」应为「超时规则」（timeout rules），ASR 误识为「超市」，NMT 译成 “supermarket rules”，语义错误。

---

## Job 9 (utterance_index=9)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | 说则我们 |
| 聚合 | 上 | segmentForJobResult=说则我们 还是要继续分析日治找出到底是在哪一个环节把我的语音给吃掉了, shouldSend=true |
| 语义修复 | 上 | repairedText 长度 34 |
| NMT | 当前句 + contextLength=20 | **译文**: says we still need to continue analyzing... (长度 98) |
| TTS | 译文 | 有音频 331152 |

**翻译质量**: 「说则我们」疑为「所以说我们」；「日治」应为「日志」，ASR 误识导致 “analyzing JJ” 等奇怪译文。

---

## Job 10、Job 11 (utterance_index=10、11)

| 阶段 | 输入 | 输出 |
|------|------|------|
| ASR | 音频 | (未找到/空) |
| 聚合 / 语义修复 / NMT / TTS | — | 未执行或空 |

**说明**: 低质量音频被拒，仅发空结果核销。

---

## 翻译质量小结

| 问题类型 | 涉及 Job | 表现 |
|----------|----------|------|
| **上下文串句/重复** | Job 4 | 本句应为「20秒后…超时/截断」，NMT 输出与 Job 3 类似 “I will try as consistently…”，疑似上一句译文混入本句。 |
| **同音/近形误识未纠正** | Job 7、8、9 | 长距→长句、超市→超时、日治→日志；语义修复未改，NMT 按错误原文翻译。 |
| **ASR 断句/粘连** | Job 1、3 | 多句合并成一段送 NMT，译文粘连（“I return to the country read volume One or two words…”）。 |
| **词义选择不当** | Job 0、2 | 语音识别→sound-identification；不必要的时候→Unnecessary time。 |
| **DUP_SEND** | Job 3 | job_result sent=2，需按 DUP_SEND 定位文档排查。 |

**建议**：  
1. 查 NMT 上下文注入（context_text/contextLength）是否把**上一句译文**误当成本句 context，导致 Job 4 类串句。  
2. 语义修复或前处理对「长距/超市/日治」等同音词做纠错或词表约束。  
3. 聚合阶段对「多句合并」的 segment 考虑按标点/长度再切分，减少整段进 NMT 的粘连。
