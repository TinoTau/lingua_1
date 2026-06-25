# Session Runtime

Turn 级 session 状态、finalize、Rolling context、Lexicon V2 Intent 调度。

---

## 1. Session Affinity 与 Intent

与 **Canonical Lexicon V3** 分离：管会话级路由与 CPU LLM Intent，**不**生成 `WindowCandidate`。

| 模块 | 路径 |
|------|------|
| 配置 | `lexicon-v2/lexicon-v2-config.ts` |
| CPU LLM Worker | `lexicon-v2/cpu-intent-llm-worker.ts` |
| Intent 恢复 | `lexicon-v2/intent-recovery.ts` |
| Turn finalize | `session-finalize.ts` |
| Rolling context | `rolling-context-manager.ts`、`types.ts` |

### 行为边界

| 允许 | 禁止 |
|------|------|
| 选择 domain profile | 生成 WindowCandidate |
| 滚动 session summary | 修改 lexicon SQLite |
| Fail-open（Intent 失败不挡主链） | confusion 召回进 production |

### 配置

- Intent：`features.lexiconV2.enabled`、`intentMode: cpu_llm`
- Legacy 词库：`features.lexiconRecall.enabled`（独立开关）
- Session Affinity：`isSessionAffinityEnabled()`（`lexicon-v2-config.ts`）
- 服务：`lexicon-intent-cpu`（默认 `http://127.0.0.1:5018`）

### recoverStats

`RollingTurn.recoverStats` 为 **会话统计字段**（非 Legacy ASR repair 模块名），含 `noTopkCandidate`、`domainBoostApplied` 等。

---

## 2. 运维

- Intent warmup：health ok 后 dummy `/intent`（fail-open）
- 诊断：`services:intent-runtime-diagnostics` IPC、`GET /service-diagnostics/intent-runtime`

---

## 相关

| 文档 | 路径 |
|------|------|
| Lexicon V2 | [`../lexicon-v2/README.md`](../lexicon-v2/README.md) |
| Lexicon V3 | [`../lexicon/README.md`](../lexicon/README.md) |
| 节点配置 | [`../../../docs/CONFIGURATION.md`](../../../docs/CONFIGURATION.md) |
