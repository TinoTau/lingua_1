# DUP_SEND 定位方案

## 三类根因

1. **列表重复**：`resultsToSend` 内同一 `job_id` 出现两次（buildResultsToSend 已按 job_id 去重修复）。
2. **控制流重入**：handleJob 被同 job_id 调用两次，或 send loop 跑两次。
3. **Sender 内部重复**：sendJobResult 一次但底层 ws.send 两次。

## 日志 tag（已落地）

- **SEND_PLAN**（NodeAgent，buildResultsToSend 后）：`tag`、`job_id`、`planId`、`items`、`planFingerprint`。  
  若 `items` 里同一 job_id 两次 → （1）。
- **SEND_ATTEMPT** / **SEND_DONE**（NodeAgent，send loop 内）：`planId`、`idx`/`total`、`job_id`、`attemptSeq`、`callSite`。  
  同 planId 下 SEND_ATTEMPT 两条且 job_id 相同 → （1）或（2）；SEND_PLAN 只有一条则（2）。
- **SENT_WIRE**（ResultSender，ws.send 前）：`job_id`、`reason`、`wireSeq`、`caller`。  
  NodeAgent 只一次 SEND_ATTEMPT 但 sent=2 → （3）。

## 判定流程

1. grep **SEND_PLAN** → items 是否重复 job_id → （1）。
2. grep **SEND_ATTEMPT** → 同 planId 下 attempt 次数；若 SEND_PLAN 仅一条但 attempt=2 → （2）。
3. 若 attempt=1 仍 DUP_SEND → grep **SENT_WIRE** → 该 job_id 条数=2 则（3）。

## 修复方向

| 结论 | 修复 |
|------|------|
| （1）列表重复 | buildResultsToSend 去重（已做）；单元测试见 `node-agent-simple.test.ts` |
| （2）控制流重入 | 调度/入口：同 session+job_id 只处理一次 |
| （3）Sender 内部重复 | 查 ResultSender 内是否两次写出站 |
