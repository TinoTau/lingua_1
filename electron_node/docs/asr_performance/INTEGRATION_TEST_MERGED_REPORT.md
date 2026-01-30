# 集成测试 · 合并报告

**日期**: 2026-01-27  
**日志**: `electron-node/logs/electron-main.log`  
**合并自**: Job 处理日志分析、头部对齐设计 vs 实现、各 Job 各服务 IO 报告

---

## 目录

1. [分析概要](#一分析概要)
2. [设计意图与实现一致性](#二设计意图与实现一致性)
3. [典型 Job 与各服务 IO](#三典型-job-与各服务-io)
4. [根因归纳](#四根因归纳)
5. [建议的下一步与验证](#五建议的下一步与验证)
6. [分析命令与脚本](#六分析命令与脚本)
7. [相关文档](#七相关文档)

---

## 一、分析概要

- **Job 数量**: 19 个（按 `utterance_index` 排序）
- **数据来源**: 节点端 `electron-main.log` 中的 `ASR INPUT/OUTPUT`、`NMT INPUT/OUTPUT`、`AudioAggregator` 事件
- **分析工具**: `analyze_job_details.py`、`extract_job_service_io.py`

| 类型 | 说明 |
|------|------|
| **有 ASR+NMT** | 首句、多 batch 合并（如 job-bc09…、job-66d6…）、单 batch（如 job-6d13…、job-ee11…、job-ee8e…、job-25c9… 等） |
| **有 ASR 无 NMT** | 如 job-2a74…、job-6d13…（MaxDuration 先发前 ≥5s，后半 pending，后续 job 才合并） |
| **有聚合无 ASR/NMT** | 如 job-8a19…、job-6e2a…、job-bc80…、job-54f9…、job-1b7e…、job-22be…、job-837f…（手动/超时 finalize 但 pending&lt;5s 不送 ASR，或空 chunk） |

---

## 二、设计意图与实现一致性

### 2.1 设计意图（头部对齐）

- **AudioAggregator**：按能量切分，合并成 ~5s 批次；每个 batch 归属其**第一个片段**所属的 job（头部对齐）。
- **Utterance 聚合**：按 `originalJobId` 分组，同一 job 的多个 ASR batch 文本**合并后再送 NMT**。
- **目标**：切片数 ≤ job 容器数，避免文本丢失。

### 2.2 实现结论

| 模块 | 结论 | 说明 |
|------|------|------|
| **AudioAggregator** | ✅ 符合设计 | `batchJobInfo` 取每 batch 首片段 `jobInfo`，`originalJobIds = batchJobInfo.map(j => j.jobId)` |
| **ASR 阶段** | ✅ 符合设计 | 按 `originalJobIds` 注册 `originalJob`，每 ASR batch 经 `addASRSegment` 归入对应 originalJob |
| **OriginalJobResultDispatcher** | ✅ 符合设计 | `receivedCount >= expectedSegmentCount` 时按 `batchIndex` 排序、合并文本，再回调后续链路 |

### 2.3 待验证点

- **`originalJobIds` 正确性**：跨 job 合并场景下是否与设计一致。
- **`expectedSegmentCount`**：多 batch 属同一 originalJobId 时，`batchCountForThisJob` 是否正确。
- **TTL（10s）**：是否足以等齐所有 batch，避免 `forceFinalizePartial` 导致前半丢失。

---

## 三、典型 Job 与各服务 IO

### 3.1 首句 `job-0cc12002…`（手动截断）

| 服务 | 输入 | 输出 |
|------|------|------|
| **AudioAggregator** | 手动截断；新建 buffer → FINALIZING → 按能量切分 | 1 段送 ASR |
| **ASR** | 133120 bytes（约 4.2s），pcm16，16kHz，src=auto，上下文 0 字 | 「我开始进行一次运营识别稳定性测试」（16 字，2292 ms） |
| **NMT** | 上述 ASR 文本，zh→en | 「I started a operating identification stability test.」（52 字，1466 ms） |

**备注**：「我们」→「我」、「语音」→「运营」等为 ASR 同音字问题。

### 3.2 多 ASR、单 NMT 且第一段丢失 · `job-25c9d9ee…`（**重点**）

| 服务 | 输入 | 输出 |
|------|------|------|
| **AudioAggregator** | 手动截断 + mergePendingMaxDurationAudio（≥5s 合并）→ 按能量切分 | 2 段送 ASR |
| **ASR #1** | 179200 bytes（约 5.6s），pcm16，16kHz | 「前半句和后半句在几点端被参战两个不同的任务甚至出现」（25 字，945 ms） |
| **ASR #2** | 129708 bytes（约 4.1s），pcm16，16kHz | 「变于医生的不完整,读起来前后不连关的情况」（20 字，676 ms） |
| **NMT** | **仅「变于医生的不完整,读起来前后不连关的情况」（20 字）** | 「The doctors are not complete, and they are unrelated to the read before.」（72 字，567 ms） |

**问题**：ASR #1 整段未进入 NMT，多 batch → 聚合 → NMT 链路上存在遗漏。

### 3.3 MaxDuration 触发 · `job-2a74f42d…`

| 服务 | 说明 |
|------|------|
| **AudioAggregator** | MaxDuration 触发；前 ≥5s 已送 ASR，剩余进 `pendingMaxDurationAudio`，状态 `PENDING_MAXDUR` |
| **ASR** | 1 次调用（约 8.3s 音频）→ 「如果10秒钟之后系统会不会因为超时或者监控判定而相信把这句话解断」 |
| **NMT** | 未调用（该 job 仅处理前半，后半待后续 job 合并后再送 ASR/NMT） |

### 3.4 有聚合无 ASR/NMT · 如 `job-8a192db0…`、`job-837fc3ac…`

- **AudioAggregator**：有处理（如手动截断、mergePending 但合并后 &lt;5s 不送 ASR）。
- **ASR / NMT**：未调用（输入/输出均为 -）。

### 3.5 各 Job 各服务 IO 明细

**完整 19 个 job 的 AudioAggregator / ASR / NMT 输入输出**见 → [JOB_SERVICE_IO_REPORT.md](./JOB_SERVICE_IO_REPORT.md)。

---

## 四、根因归纳

1. **长句被多次切分**  
   静音、超时、MaxDuration、手动截断等均触发 finalize → 多段 → 多 ASR batch。

2. **多 ASR batch 仅部分送 NMT**  
   job-25c9… 等：2 次 ASR，仅第 2 段进 NMT，第 1 段丢失 → 多 batch 聚合/转发存在缺失或覆盖。

3. **MaxDuration + pending 合并**  
   前 ≥5s 先 ASR，后半进 `pendingMaxDurationAudio`，再与后续 manual/timeout 合并 → 易产生跨 job、跨 batch 的 ordering 与遗漏。

4. **部分 job 有聚合无 ASR/NMT**  
   AudioAggregator 有记录但无 ASR/NMT 日志 → 需排查空音频、过滤、合并到其他 job 或落盘异常。

5. **ASR 同音字、漏字**  
   「我们」→「我」、「语音」→「运营」、「日志」→「日质」、「长句」→「长距」等，与切碎后语境不足等有关。

---

## 五、建议的下一步与验证

### 5.1 修复与排查

1. **修复多 ASR batch → NMT 聚合**  
   确保同一 job 下**所有** ASR batch 文本参与聚合后再送 NMT；检查 `runAggregationStep`、`TranslationStage`、`OriginalJobResultDispatcher` 对多 batch 的聚合与转发。

2. **排查「有聚合无 ASR/NMT」**  
   对应用 `job_id` 检索 `EMPTY_INPUT`、`shouldReturnEmpty`、`segmentCount`、`audioLength`、`NO_TEXT_ASSIGNED` 等，确认未送 ASR 或未落日志的原因。

3. **优化切分与 MaxDuration**  
   评估静音/超时/MaxDuration 与自然呼吸的冲突，避免长句被过细切分。

### 5.2 针对 job-25c9… 的验证命令

在 `electron_node` 下，对 `electron-node/logs/electron-main.log` 执行：

```bash
# originalJobIds
Select-String -Path "electron-node/logs/electron-main.log" -Pattern "originalJobIds" | Select-String "job-25c9d9ee"

# expectedSegmentCount / batchCountForThisJob
Select-String -Path "electron-node/logs/electron-main.log" -Pattern "expectedSegmentCount|batchCountForThisJob" | Select-String "job-25c9d9ee"

# addASRSegment / Accumulate
Select-String -Path "electron-node/logs/electron-main.log" -Pattern "Accumulate.*Added ASR segment" | Select-String "job-25c9d9ee"

# forceFinalizePartial
Select-String -Path "electron-node/logs/electron-main.log" -Pattern "Force finalize partial|forceFinalizePartial" | Select-String "job-25c9d9ee"

# 文本合并 TextMerge
Select-String -Path "electron-node/logs/electron-main.log" -Pattern "TextMerge.*Merged ASR batches" | Select-String "job-25c9d9ee"
```

（Linux/macOS 下可将 `Select-String` 换为 `grep`，见 [HEAD_ALIGNMENT_DESIGN_VS_IMPLEMENTATION_ANALYSIS.md](./HEAD_ALIGNMENT_DESIGN_VS_IMPLEMENTATION_ANALYSIS.md) 五、建议的验证步骤。）

---

## 六、分析命令与脚本

在 `electron_node` 目录下：

```bash
# 1. 详细 job 分析（含 AudioAggregator / ASR / NMT 序列）
python scripts/analyze_job_details.py electron-node/logs/electron-main.log

# 2. 指定 job
python scripts/analyze_job_details.py electron-node/logs/electron-main.log job-25c9d9ee-d9d4-48db-a866-f05ad19e965a

# 3. 导出各 job 各服务 IO 报告（UTF-8）
python scripts/extract_job_service_io.py electron-node/logs/electron-main.log docs/asr_performance/JOB_SERVICE_IO_REPORT.md

# 4. 快速检查最近 job（主进程 / ASR / NMT 日志）
python scripts/quick_check_jobs.py
```

导出完整 analyze 输出示例：

```bash
python scripts/analyze_job_details.py electron-node/logs/electron-main.log 2>&1 | Out-File -Encoding utf8 job_analysis_full.txt
```

---

## 七、相关文档

| 文档 | 说明 |
|------|------|
| [JOB_PROCESSING_LOG_ANALYSIS_REPORT.md](./JOB_PROCESSING_LOG_ANALYSIS_REPORT.md) | Job 处理流程日志分析（典型 job、根因、下一步） |
| [HEAD_ALIGNMENT_DESIGN_VS_IMPLEMENTATION_ANALYSIS.md](./HEAD_ALIGNMENT_DESIGN_VS_IMPLEMENTATION_ANALYSIS.md) | 头部对齐设计 vs 实现、验证步骤 |
| [JOB_SERVICE_IO_REPORT.md](./JOB_SERVICE_IO_REPORT.md) | 各 job 在 AudioAggregator / ASR / NMT 的输入输出明细（19 个 job） |
| `scripts/analyze_job_details.py` | 解析日志，输出每个 job 的聚合/ASR/NMT 序列与小结 |
| `scripts/extract_job_service_io.py` | 解析日志，生成各 job 各服务 IO 的 Markdown 报告 |
| `scripts/quick_check_jobs.py` | 快速检查近期 job 及 ASR/NMT 情况 |

---

*本合并报告整合了上述文档中的分析概要、设计一致性、典型 IO、根因、验证步骤与命令，便于集中查阅与排查。*
