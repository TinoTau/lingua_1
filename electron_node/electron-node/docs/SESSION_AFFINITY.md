# Session Affinity 与 Lexicon V2 Intent

与 **Canonical Lexicon（V3 bundle）** 分离：本模块管 **会话级路由** 与 **CPU LLM Intent**，不参与 `WindowCandidate` 生成。

## 代码位置

| 模块 | 路径 |
|------|------|
| 配置 | `main/src/lexicon-v2/lexicon-v2-config.ts` |
| CPU LLM Worker | `main/src/lexicon-v2/cpu-intent-llm-worker.ts` |
| Session 路由 | `main/src/lexicon-v2/session-*`、调度侧重连 |
| Affinity 管理 | 见 `pipeline-orchestrator` 与 scheduler 侧 session 映射 |

## 行为边界

| 允许 | 禁止 |
|------|------|
| 选择 domain profile | 生成 `WindowCandidate` |
| 滚动 session summary（Intent） | 修改 `repairedText` / lexicon SQLite |
| Fail-open（Intent 失败不挡 Recover） | confusion 召回进 production |

## 配置要点

`features.lexiconV2` / `features.lexiconRecall` 分属不同开关：

- Recover / 词库：`features.lexiconRecall.enabled`
- Intent：`features.lexiconV2.enabled`、`intentMode: cpu_llm`
- Session Affinity：`isSessionAffinityEnabled()`（见 `lexicon-v2-config.ts`）

服务：`lexicon-intent-cpu`（默认 `http://127.0.0.1:5018`）。

## 运维

- Intent warmup：服务 health ok 后 dummy `/intent`（fail-open）
- 诊断：`services:intent-runtime-diagnostics` IPC、`GET /service-diagnostics/intent-runtime`（test server）

## 相关

- [LEXICON.md](./LEXICON.md) — canonical bundle
- [RECOVER.md](./RECOVER.md) — 修复主链
- [CONFIGURATION.md](./CONFIGURATION.md)
