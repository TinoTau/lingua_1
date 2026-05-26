# Session Migration 双节点验收（手动）

> 冻结 V2 §5 / T-MIG-06：须 **两个独立 Node 进程** + **不同 HTTP 基址**，不可与同进程 Jest mock store 等同。

## 前置

1. Redis 集群 / Scheduler 已启动（`start_scheduler.ps1`）。
2. 两个 Electron Node 实例，或两个仅 test-server 进程，端口不同，例如：
   - Node A：`testServer.port=5020`，`NODE_ID=node-a`
   - Node B：`testServer.port=5021`，`NODE_ID=node-b`
3. Scheduler 环境变量：

```powershell
$env:NODE_MIGRATION_BASE_URL_NODE_A = "http://127.0.0.1:5020"
$env:NODE_MIGRATION_BASE_URL_NODE_B = "http://127.0.0.1:5021"
```

## 步骤

1. 在 Node A 上通过真实 job 或 `POST /run-pipeline-with-audio` 创建 `session_id=test-mig-1`，完成 ≥1 个 finalized turn。
2. 触发 Scheduler 将 session 从 `node-a` 选到 `node-b`（或调用 Rust `SessionMigrationOrchestrator::migrate_session` 集成测）。
3. 验收：
   - `GET http://127.0.0.1:5020/session-migration/export/test-mig-1` → 404（A 已 evacuate）
   - `GET http://127.0.0.1:5021/session-migration/export/test-mig-1?sourceNodeId=node-b` → 200（B 有 snapshot）
   - Redis `HGET scheduler:session:test-mig-1 assigned_node_id` → `node-b`
   - 在 A 上再派同 session job → 日志 `[SessionTurn] SESSION_MOVED`（fail-open，不污染 rollingContext）

## Jest 回归（单进程 protocol）

```bash
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="session-migration|session-moved"
npx jest tests/session-affinity/session-migration-e2e.test.ts
```
