
# ASR 专用 JIRA Task List
## 基于「单工人 + 有界队列 + 背压 + 可选多进程」方案

> 目标：在不增加模型副本与显存占用的前提下，
> 提升 ASR 服务可用性、稳定性与用户体验。

---

## EPIC-ASR-1：服务入口与限流（Ingress & Backpressure）

| Key | Title | Priority | Estimate | 验收标准 |
|----|----|----|----|----|
| ASR-1.1 | 定义 ASR 并发模型（单工人 + 有界队列） | P0 | 0.5d | 设计文档评审通过 |
| ASR-1.2 | 实现队列满时 429/503 Busy 响应 | P0 | 1d | 队列满立即返回，<50ms |
| ASR-1.3 | 支持 Retry-After 响应头 | P1 | 0.5d | 客户端可自动退避 |
| ASR-1.4 | 最大等待时间超时返回（504） | P0 | 0.5d | 等待超时可控 |

---

## EPIC-ASR-2：ASR Worker（串行推理）

| Key | Title | Priority | Estimate | 验收标准 |
|----|----|----|----|----|
| ASR-2.1 | ASR Worker 单实例模型初始化 | P0 | 1d | 模型只加载一次 |
| ASR-2.2 | 串行执行 transcribe() | P0 | 0.5d | 无并发调用 |
| ASR-2.3 | 推理异常捕获与返回 | P0 | 0.5d | 不导致服务崩溃 |

---

## EPIC-ASR-3：多进程隔离与自动拉起

| Key | Title | Priority | Estimate | 验收标准 |
|----|----|----|----|----|
| ASR-3.1 | ASR Worker 独立进程化 | P1 | 1d | 主进程不因 worker 崩溃 |
| ASR-3.2 | Worker 心跳与退出检测 | P1 | 0.5d | 异常可检测 |
| ASR-3.3 | Worker 自动拉起 | P1 | 0.5d | 崩溃后自动恢复 |

---

## EPIC-ASR-4：可观测性与验收

| Key | Title | Priority | Estimate | 验收标准 |
|----|----|----|----|----|
| ASR-4.1 | 指标：queue_depth / wait_ms | P0 | 0.5d | 指标可记录 |
| ASR-4.2 | 压测（并发 + 抖动） | P0 | 1d | 无崩溃 |
| ASR-4.3 | 长稳测试（10+ 分钟） | P0 | 1d | 稳定运行 |

