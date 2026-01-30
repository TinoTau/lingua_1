# Job 服务流分析脚本 · Tasklist（最小集）

**脚本**: `electron_node/scripts/analyze_jobs_per_service_flow.js`  
**目标**: 按 Job 统计各阶段 request/response 次数，输出 Summary 表与 [Audit] 闭环断言，便于一眼发现重复调用、缺失响应、矛盾链路、重复发送。

---

## 执行方式

```bash
cd electron_node
node scripts/analyze_jobs_per_service_flow.js <logPath> --out <report.md>
```

示例：

```bash
node scripts/analyze_jobs_per_service_flow.js electron-node/logs/electron-main.log --out electron-node/logs/docs/asr_performance/JOB_SERVICE_FLOW_REPORT.md
```

---

## Tasklist 状态

### 1. 脚本统计增强（必做）

| 项 | 状态 | 说明 |
|----|------|------|
| 为每个 job 建 `stats`（asrOutCount / aggregationCount / semanticRepair req-resp / nmt req-resp / tts req-resp / jobResultSendCount / translatedTextNonEmpty / ttsAudioLengthMax / shouldSend 等） | ✅ 已完成 | `createJobStats()` + `accumulateStats()` |
| 在已有解析分支里累加 request/response/send 计数 | ✅ 已完成 | 按现有日志 pattern 累加，不新增控制流 |
| 报告顶部输出 Summary 表 | ✅ 已完成 | 每 job 一行：utterance_index, job_id, ASR, Agg, Repair req/resp, NMT req/resp, TTS req/resp, job_result sent, Flags |
| 每个 job 输出 [Audit] 断言（重复/缺失/矛盾/重复发送） | ✅ 已完成 | DUP_CALL, MISS_NMT_RESP, MISS_REPAIR_RESP, TTS_WITH_EMPTY_NMT, DUP_SEND |

### 2. 异常匹配增强（必做）

| 项 | 状态 | 说明 |
|----|------|------|
| 扩展异常关键词集合 | ✅ 已完成 | error/exception/failed + timeout, ECONNRESET, ECONNREFUSED, 429, 502, 503, 504, Unhandled, unhandled, undefined, null |

### 3. 日志补点（仅当脚本无法识别请求/响应时）

| 项 | 状态 | 说明 |
|----|------|------|
| NMT：request/response 各加一条结构化日志（带 reqId） | ⏸️ 可选 | 当前脚本已能通过「NMT INPUT / NMT OUTPUT / Translation completed」识别并计数 |
| TTS：request/response 各加一条结构化日志（带 reqId） | ⏸️ 可选 | 当前脚本已能通过「routeTTSTask / ttsAudioLength / TTS completed」识别并计数 |

---

## 验收标准

- 运行上述命令后，报告第一屏 **Summary 表** 可直接看到：
  - 哪些 job 的 NMT req/resp 或 Repair req/resp 不一致（缺响应时标 MISS_*）
  - 哪些 job 的 job_result sent > 1（标 DUP_SEND）
  - 哪些 job 存在 TTS 音频但 NMT 译文为空（标 TTS_WITH_EMPTY_NMT）
- 每个 job 的 ** [Audit]** 小节列出上述闭环断言（命中则标红说明）。

---

## 再统计与问题定位说明（执行版）— Patch 状态

### Patch A：统一统计关联键 ✅

| 项 | 状态 | 说明 |
|----|------|------|
| req/resp 统计必须解析 `job_id` | ✅ 已完成 | `getJobIdFromLine()` + `lineBelongsToJob()`；仅当行能解析出 job_id 且等于当前 jobId 才参与 NMT/TTS/语义修复/job_result 计数 |

### Patch B：每阶段只保留 1 个 response 判定点 ✅

| 项 | 状态 | 说明 |
|----|------|------|
| NMT response 只认一条 | ✅ 已完成 | 仅匹配「NMT OUTPUT: NMT request succeeded」；preview/length/info 不参与闭环计数 |
| TTS response 只认一条 | ✅ 已完成 | 仅认「ttsAudioLength 且值>0」的第一条；无音频/length=0/skipped 不计 |

### Patch C：报告自证统计来源 ✅

| 项 | 状态 | 说明 |
|----|------|------|
| 每 Job 输出 [Stats Evidence] | ✅ 已完成 | 列出 NMT responses matched / TTS responses matched / job_result sent matched（每阶段最多 1–2 条；无则写 none） |

### DUP_SEND 专项：发送日志补点 ✅

| 项 | 状态 | 说明 |
|----|------|------|
| sendJobResult 前打印 sendSeq / job_id / reason / isEmptyJob / shouldSend | ✅ 已完成 | `node-agent-result-sender.ts` 中「Sending job_result to scheduler」前增加 sendSeq 递增及上述字段 |

---

## 验收标准（再统计后）

- **Summary 表**：不再出现大规模 NMT 1/3、TTS 1/2；正常 Job 应为 NMT 1/1、TTS 1/1。
- **DUP_SEND**：Job 4 的两次 send 在 [Stats Evidence] 中能看到两条 job_result sent matched；后续跑节点端时日志中可见 sendSeq 递增及 reason/isEmptyJob/shouldSend。
- **低质量音频 Job（3/7/12/13）**：允许 ASR reject、NMT/TTS=0；必须 job_result sent=1，不出现重复发送。

---

## DUP_SEND 修复（单发送点）

- **buildResultsToSend**：按 job_id 去重，同一 job_id 只出现一次（`node-agent-simple.ts`）。
- **单元测试**：`main/src/agent/node-agent-simple.test.ts` 覆盖无 pending、不同 job_id、主 job_id 重复、pending 内重复、shouldSend=false。
- **单发送点**：asr-step 不发送，只写 ctx；node-agent send loop 为唯一出口。详见 `DUP_SEND_FIX_SINGLE_SEND_POINT_2026_01.md`。

---

## 本次执行结果

- **报告路径**: `electron-node/logs/docs/asr_performance/JOB_SERVICE_FLOW_REPORT.md`（或 `--out` 指定路径）
- **验收**: Summary 无 DUP_SEND；每 job 的 job_result sent matched 仅一条。
