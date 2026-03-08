# ASR 模块流程与代码逻辑

节点端 ASR 处理流程：入口、音频聚合、ASR 调用、结果发送。以当前代码为准。

## 1. 核心组件

1. **runAsrStep** (`pipeline/steps/asr-step.ts`) — ASR 步骤入口
2. **PipelineOrchestratorAudioProcessor** — 封装音频聚合，调用 AudioAggregator
3. **AudioAggregator** (`pipeline-orchestrator/audio-aggregator.ts`) — 音频聚合，含 Utils、Merger、StreamBatcher、JobContainer、PauseHandler、TimeoutHandler、FinalizeHandler
4. **PipelineOrchestratorASRHandler** — ASR 任务路由，调用 TaskRouter
5. **结果发送**：`buildJobResult` → `buildResultsToSend`（含 pendingEmptyJobs）→ `ResultSender.sendJobResult`；无独立 Dispatcher
6. **Session 亲和**：由调度端实现，节点端不维护

## 2. 流程概览

- **runAsrStep**：创建 AudioProcessor → processAudio(job) → 空容器记入 ctx.pendingEmptyJobs → 遍历 audioSegments 调 ASR → 结果写 ctx → 后续步骤顺序执行 → buildResultsToSend → ResultSender
- **processAudio**：audioAggregator.processAudioChunk(job) → 校验格式与长度 → 返回 AudioProcessorResult
- **AudioAggregator.processAudioChunk** 分支：
  - 初始化/获取 buffer，解码 Opus→PCM16，记录 originalJobInfo
  - pendingTimeoutAudio TTL 过期 → 强制合并并能量切分，返回 audioSegments
  - isTimeoutTriggered → 聚合后写入 pendingTimeoutAudio，清空 buffer，返回空
  - shouldProcessNow（手动/pause finalize）→ 合并 pending 音频，按 Hotfix 决定是否切分，创建流式批次（≥5s），分配 originalJobIds，返回 audioSegments
  - 否则 → 累积到 buffer，返回空

## 3. 关键设计

- **Hotfix**：合并 pendingTimeoutAudio/pendingPauseAudio 时 hasMergedPendingAudio=true，整段作为一批，不切分
- **流式切分**：splitAudioByEnergy，maxSegmentDurationMs=10s，minSegmentDurationMs=2s，hangover=600ms；批次≥5s
- **头部对齐**：batch 归属由首帧所在 job 决定；容器按 expectedDurationMs 装满切换
- **空容器**：ctx.pendingEmptyJobs 由 buildResultsToSend 展开为 NO_TEXT_ASSIGNED，与主结果一并发送

## 4. 关键参数

| 参数 | 值 |
|------|-----|
| MAX_BUFFER_DURATION_MS | 20000 |
| MIN_AUTO_PROCESS_DURATION_MS | 10000 |
| PENDING_TIMEOUT_AUDIO_TTL_MS | 10000 |
| MIN_ACCUMULATED_DURATION_FOR_ASR_MS | 5000 |
| SPLIT_HANGOVER_MS | 600 |

## 5. 相关文档

- `AUDIO_AGGREGATOR_Data_Format.md` — 缓冲区与返回数据结构
- `Long_Utterance_Job_Container_Policy.md` — 长语音 Job 容器策略
- `main/src/pipeline-orchestrator/` — 源码
