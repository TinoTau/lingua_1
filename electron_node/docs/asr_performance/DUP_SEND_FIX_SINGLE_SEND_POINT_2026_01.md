# DUP_SEND 修复：单发送点

## 根因

同一 job 出现 `job_result sent = 2`：**resultsToSend 列表内同一 job_id 出现两次**（主结果 + pendingEmptyJobs 中重复或与主 job 同 id），发送循环对同一 job_id 发两次。

## 修复

1. **buildResultsToSend 按 job_id 去重**（`node-agent-simple.ts`）  
   - `seenJobIds` 记录已占位/已追加的 job_id；主结果占位当前 job；追加 pendingEmptyJobs 时跳过已出现的 job_id。  
   - 同一 job_id 在列表中只出现一次。

2. **单发送点契约**  
   - asr-step：只写 ctx，不发送；注释写明“空容器记入 ctx，由 node-agent 唯一出口发送”。  
   - node-agent：`buildResultsToSend` → send loop 为唯一发送路径。

## 验收

- 重新生成 `JOB_SERVICE_FLOW_REPORT.md` 后：Summary 无 DUP_SEND；每个 job 的 `job_result sent matched` 只有一条。
- 单元测试：`main/src/agent/node-agent-simple.test.ts` 覆盖 buildResultsToSend 去重（无 pending、不同 job_id、主 job_id 重复、pending 内重复、shouldSend=false）。

## 若仍 DUP_SEND

可能是控制流重入（handleJob 被同 job_id 调用两次）。按 `DUP_SEND_LOCALIZATION_2026_01.md` 用 SEND_PLAN / SEND_ATTEMPT / SENT_WIRE 区分重入与 sender 内部重复。
