# V3 Acceptance Gate

## D1 Runtime

- [x] Production runtime canonical-only (`V3_WINDOW_CANDIDATE_SOURCES`)
- [x] No `confusionRecallEnabled` in config
- [x] Runtime SQLite readonly
- [x] Replay does not auto-merge bundle
- [x] `confusion_evidence_total === 0` in dialog_200 / phase5 benchmark

## D2 Build

- [x] validation fail blocks build
- [x] unknown domain fail
- [x] alias collision fail
- [x] priorScore ∈ (0, 1]
- [x] manifest checksum required (phase5 / 4B gates)
- [x] confusion rows rejected
- [ ] strict provenance on all production seeds (use `lexicon:source-manager --strict`)

## D3 Benchmark

- [x] `npm run lexicon:phase5-benchmark`
- [x] dialog_200 PASS (200/200 on 2k ladder)
- [x] false / no-op repair measurable
- [ ] alias_hit E2E aggregation (job-level still 0 on last run)

## Verify

```powershell
cd electron_node/electron-node
npm run test:lexicon
npm run lexicon:phase5-benchmark
```

## SQLite：两份「冻结」（勿混淆）

| 对象 | 已冻结内容 | 何时需要操作 |
|------|------------|--------------|
| **better-sqlite3 原生模块** | Electron ABI 119 ↔ 系统 Node 127 双阶段 rebuild（见 `build-for-electron.mjs`、`lexicon:rebuild-sqlite`） | 节点报 `NODE_MODULE_VERSION`、或刚跑过 `lexicon:build` / `npm rebuild better-sqlite3` 后 |
| **词库 bundle 文件** `node_runtime/lexicon/current/lexicon.sqlite` | V3 **build 脚本**已不再创建 `lexicon_confusions`；runtime **不再读取**该表 | 仅当 **更换 seed / 校验 manifest↔sqlite 一致** 时需 `npm run lexicon:build` |

**当前常见状态（2026-05-27）**：`manifest.json` 已无 `confusion_count`，但磁盘上旧 bundle 可能仍含 `lexicon_confusions` 表与历史行（例如 200 行）。**这不影响 V3 运行时行为**（`lexicon-runtime` 已不加载 confusion），属于**工件滞后**，不是 ABI 配置失效。

日常启动节点：**不需要**为此重跑 `lexicon:build`；按 [常用命令](../../docs/CODING/常用命令) 使用 `npm run lexicon:rebuild-sqlite`（仅 Electron ABI）即可。
