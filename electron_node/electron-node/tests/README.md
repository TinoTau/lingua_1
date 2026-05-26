# Electron Node 测试

## 目录结构

```
tests/
├── README.md
├── run-dialog-200-batch.js      # dialog_200 全量契约批测（需节点 + test server :5020）
├── run-homophone-expectation.js   # Homophone 期望验收（读 batch result）
├── run-homophone-quality-check.js
├── recover-contract-batch-assess.test.js
├── recover_expectations/          # Homophone 期望数据
├── fixtures/
├── session-affinity/              # Session migration E2E（jest）
├── stage2.2/                      # 阶段 2.2 说明
├── stage3.1/                      # ModelManager 等单元测试
├── stage3.2/                      # 模块化功能测试
└── refactor/                      # 重构相关 jest
```

批测输出 `*-result.json` 为本地产物，已加入 `.gitignore`，勿提交。

## 常用命令

| 用途 | 命令 |
|------|------|
| 构建主进程 | `npm run build:main` |
| Recover 契约 | `npm run test:contract` |
| dialog_200 批测 | `node tests/run-dialog-200-batch.js "<PROJECT_ROOT>/test wav/dialog_200"` |
| Homophone 验收 | `node tests/run-homophone-expectation.js tests/dialog-200-batch-result.json` |
| Pipeline E2E | `npm run test:pipeline` |
| Aggregator | `npm run test:aggregator` / `test:aggregator:vectors` / `test:aggregator:ts` |
| stage3.1 / 3.2 | `npm run test:stage3.1` / `test:stage3.2` |
| 聚合测试脚本 | `powershell -File run-aggregation-tests.ps1` |

## 前置条件

- **dialog_200 / Homophone**：`npm run start`，设置 `PROJECT_ROOT` 指向仓库根；test server 监听 `5020`（单实例）。
- **stage3.2**：部分测试需 Node `--experimental-vm-modules`（见 stage3.2 README）。

## 已移除（V3 收尾）

- `run-lexicon-v2-intent-session-test.js`、`lexicon-v2-intent-e2e/`（V2 intent 一次性 E2E）
- `pipeline-e2e-test.ts`、`aggregator-debug-test.ts`、根目录 `aggregator-test.js`（由 `aggregator-test.ts` + `npm run test:aggregator` 替代）
- 历史 `*-result.json` 与 `tmp-pilot-bundle/`

词库门禁与 Phase5 验收见 `npm run lexicon:v3-gate`、`scripts/lexicon/run-phase5-acceptance.mjs`。
