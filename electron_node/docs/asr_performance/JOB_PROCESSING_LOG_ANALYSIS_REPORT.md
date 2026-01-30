# Job 处理流程日志分析报告

**日期**: 2026-01-27  
**日志文件**: `electron-node/logs/electron-main.log`  
**分析工具**: `scripts/analyze_job_details.py`  
**合并报告**：详见 [INTEGRATION_TEST_MERGED_REPORT.md](./INTEGRATION_TEST_MERGED_REPORT.md)。

---

## 一、分析概要

根据 `analyze_job_details.py` 对节点端日志的分析，本次集成测试共有 **19 个 job**。下表汇总各 job 在 AudioAggregator、ASR、NMT 中的处理情况，以及发现的问题。

---

## 二、典型 Job 分析

### 1. Job [0] – 首句（手动截断）

| 阶段 | 输入 | 输出 |
|------|------|------|
| **AudioAggregator** | 手动截断 (`isManualCut: true`)，新建 buffer → FINALIZING → 按能量切分 → 发送 1 段音频 | 1 个 segment，对应 1 个 job |
| **ASR** | 音频 133120 bytes（约 4.2s），pcm16，16kHz，无上下文 | 识别文本：「我开始进行一次运营识别稳定性测试」（16 字），1 segment，约 2292ms |
| **NMT** | 待译：「我开始进行一次运营识别稳定性测试」 | 译文：「I started a operating identification stability test.」 |

**问题**：  
- 脚本提示「文本长度与音频长度不匹配（可能被截断）」：当前判定条件 `text_length < audio_length/1000` 不合理（字符数 vs 字节数），属误报，可忽略或调整阈值。  
- 原文「我们」被识别成「我」、「语音」→「运营」，属 ASR 同音字错误。

---

### 2. Job [1]、Job [22be…] – 有聚合无 ASR/NMT

| 项目 | 说明 |
|------|------|
| **AudioAggregator** | 手动截断，创建 buffer → FINALIZING → 按能量切分 → 发送 segments |
| **ASR 调用次数** | 0 |
| **NMT 调用次数** | 0 |

**含义**：  
- 调度侧已下发 job，节点端 AudioAggregator 也处理了对应音频并产出了 segments。  
- 但日志中**没有**该 job 的 `ASR INPUT` / `ASR OUTPUT`、`NMT INPUT` / `NMT OUTPUT`。  
- 可能原因包括：  
  1. 该 job 的音频被判为空或无效，未进入 ASR；  
  2. 逻辑上被合并到其他 job，本 job 仅作占位；  
  3. 结果写回/日志落盘异常。  

需结合「空音频」「EMPTY_INPUT」「shouldReturnEmpty」等日志进一步排查。

---

### 3. Job [25c9…] – 多段 ASR、单次 NMT（**重要**）

| 阶段 | 输入 | 输出 |
|------|------|------|
| **AudioAggregator** | 手动截断 + **mergePendingMaxDurationAudio**（合并 MaxDuration 缓存的音频） | 合并后按能量切分，得到多段音频，对应**多个 ASR 调用** |
| **ASR #1** | 179200 bytes（约 5.6s） | 「前半句和后半句在几点端被参战两个不同的任务甚至出现」（25 字） |
| **ASR #2** | 129708 bytes（约 4.1s） | 「变于医生的不完整,读起来前后不连关的情况」（20 字） |
| **NMT** | 仅 **ASR #2** 的文本 | 「The doctors are not complete, and they are unrelated to the read before.」 |

**问题**：  
- **同一 job 被拆成 2 次 ASR 调用**，但 **只有第 2 段文本送了 NMT**。  
- **ASR #1 的「前半句和后半句…」整段在 NMT 阶段丢失**，未参与翻译，也未出现在最终结果中。  
- 说明在「多 ASR batch → 聚合 → 送 NMT」的链路上，**前面段落的聚合或转发存在遗漏**。

---

### 4. Job [2a74…] – MaxDuration 触发

| 阶段 | 说明 |
|------|------|
| **AudioAggregator** | **MaxDuration 触发**（`isMaxDurationTriggered: true`），连续 MaxDuration finalize → 合并音频 → 按能量切分 |
| **策略** | 先处理前 ≥5s，剩余缓存到 `pendingMaxDurationAudio`；buffer 状态 → `PENDING_MAXDUR` |
| **ASR** | 至少 1 次 ASR 调用（脚本输出被截断，未看到完整 NMT） |

**含义**：  
- 长句超过 MaxDuration 阈值后，被拆成「先处理 5s + 缓存后半」；  
- 后半依赖后续 manual/timeout finalize 再合并、再送 ASR，易形成多 ASR、跨 job 的拼接与 ordering 问题。

---

## 三、日志与结果对应关系

你提供的**本次测试**返回结果中，utterance 索引与典型情况大致对应如下（仅作对照，具体以 job_id 为准）：

| Utterance | 原文 (ASR) | 译文 (NMT) | 日志侧情况 |
|-----------|------------|------------|------------|
| [0] | 我们开始进行一次语音识别稳定性测试 | We are starting to perform a voice-identification stability test. | 与 Job [0] 对应；「我们」→「我」、「语音」→「运营」等为 ASR 错误 |
| [1] | 语音识别稳定性测试 两句比较短的话… | Voice-identification stability test Two short words… | 多段拼接；存在截断、重复前缀 |
| [3] | 接下来这一句 我会尽量练续的说得长一些中间直保 | I will try to say this as long as possible. | 长句被切、同音字（如「练续」「直保」） |
| [5] | 与一双不完整,读起来结后不连关的情况。 | With a pair of incomplete, read and end not related situations. | 与 Job [25c9…] 中 **ASR #2** 及其 NMT 对应：「变于医生…」→「与一双…」等为同音字变体 |
| [7] | 这次的长距能够被完整的识别出来… | This long distance can be fully identified… | 长句截断、「长句」→「长距」等 |
| [9] | 我们还需要继续分析日质… | We need to continue analyzing the daytime… | 「日志」→「日质」「daytime」 |

---

## 四、根因归纳

1. **长句被多次切分**  
   - 静音、超时、MaxDuration、手动截断等都会触发 finalize；  
   - 长句被拆成多段 → 多 ASR 调用、多 batch。

2. **多 ASR batch 只部分送 NMT**  
   - Job [25c9…] 中 2 次 ASR，仅第 2 段进入 NMT，第 1 段整段丢失。  
   - 聚合/转发逻辑在「多 batch → 单次 NMT 输入」时存在缺失或覆盖。

3. **MaxDuration + pending 合并**  
   - 前 ≥5s 先 ASR，后半进 `pendingMaxDurationAudio`；  
   - 若后续 manual/timeout 再合并、再切，容易形成跨 job、跨 batch 的 ordering 与遗漏。

4. **部分 job 有聚合无 ASR/NMT**  
   - 如 Job [1]、Job [22be…]：AudioAggregator 有处理记录，但无 ASR/NMT 日志。  
   - 需查是否为空音频、被过滤或合并到其他 job。

5. **ASR 同音字、漏字**  
   - 「我们」→「我」、「语音」→「运营」、「日志」→「日质」、「长句」→「长距」等；  
   - 与模型、上下文、音频切碎后语境不完整等有关。

---

## 五、建议的下一步

1. **修复多 ASR batch → NMT 的聚合**  
   - 确保同一 job 下**所有 ASR batch** 的文本都参与聚合后再送 NMT；  
   - 检查 `runAggregationStep`、`TranslationStage` 等对多 batch 的处理与拼接逻辑。

2. **排查「有聚合无 ASR/NMT」的 job**  
   - 在日志中检索对应 `job_id` 的 `EMPTY_INPUT`、`shouldReturnEmpty`、`segmentCount`、`audioLength`；  
   - 确认是未送 ASR，还是 ASR 未返回、未写入日志。

3. **优化切分与 MaxDuration 策略**  
   - 评估静音、超时、MaxDuration 阈值与「自然呼吸」的冲突；  
   - 避免长句被过于细碎地切分，减少多 batch、多 job 的拼接复杂度。

4. **改进脚本与判定**  
   - 在 `analyze_job_details` 中从 `ASR INPUT` / `NMT INPUT` 等行补充 `sessionId`、`utteranceIndex`，便于按 session/utterance 对齐；  
   - 将「文本长度与音频长度不匹配」的判定改为更合理的指标（例如：字数 vs 时长经验关系），减少误报。

---

## 六、分析命令

```bash
cd electron_node
python scripts/analyze_job_details.py electron-node/logs/electron-main.log
# 指定 job_id
python scripts/analyze_job_details.py electron-node/logs/electron-main.log job-25c9d9ee-d9d4-48db-a866-f05ad19e965a
```

如需导出完整分析（超过 200 行），可去掉 `Select-Object -First 200`，或重定向到文件：

```bash
python scripts/analyze_job_details.py electron-node/logs/electron-main.log > job_analysis_full.txt 2>&1
```
