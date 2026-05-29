# Electron Node 测试

## 目录结构

```
tests/
├── README.md
├── lib/
│   └── fw-detector-contract-assess.js   # FW dialog_200 契约判定
├── pipeline/                            # P0 聚合 / finalize 契约单测
├── run-fw-detector-dialog-200-batch.js  # FW dialog_200 批测（需节点 + :5020）
├── run-fw-detector-homophone-acceptance.js
├── run-fw-detector-false-repair-acceptance.js
├── session-affinity/                    # Session migration E2E（jest）
├── stage3.1/                            # ModelManager 等基础设施单测
├── aggregator-test.ts / run-aggregator-test.js
└── aggregator-test-vectors.ts / run-aggregator-test-vectors.js
```

批测输出 `*-result.json` 为本地产物，已加入 `.gitignore`，勿提交。

## 常用命令

| 用途 | 命令 |
|------|------|
| 构建主进程 | `npm run build:main` |
| Recover 契约单测 | `npm run test:contract` |
| P0 pipeline 单测 | `npm run test:pipeline` |
| FW detector 单测 | `npm run test:fw-detector` |
| FW dialog_200 批测 | `node tests/run-fw-detector-dialog-200-batch.js "<PROJECT_ROOT>/test wav/dialog_200" --limit 50` |
| FW homophone / false_repair | `node tests/run-fw-detector-homophone-acceptance.js` / `run-fw-detector-false-repair-acceptance.js` |
| Aggregator | `npm run test:aggregator` / `test:aggregator:vectors` / `test:aggregator:ts` |
| ModelManager 等 | `npm run test:stage3.1` |
| 聚合测试脚本 | `powershell -File run-aggregation-tests.ps1` |
| FW 静态门禁 | `node scripts/fw-detector-gate.mjs` |

## 前置条件

- **FW 批测**：`npm run start`，设置 `PROJECT_ROOT` 指向仓库根；test server 监听 `5020`（单实例）；`faster-whisper-vad` 在 `:6007`。
- **stage3.1**：仅需 `npm run build:main`（见 `stage3.1/README.md`）。

## 已移除（FW 主链收尾）

- Recover 批测：`run-dialog-200-batch.js`、`run-p0-dialog-200-batch.js`、`run-homophone-*.js`、`recover-contract-batch-assess.test.js`、`tests/lib/recover-contract-assess.js`
- 历史阶段目录：`stage2.2/`、`stage3.2/`、`refactor/`
- 全栈 smoke：`pipeline-e2e-test-simple.js`（ASR+NMT+TTS 手工联调，已由 FW 批测与 pipeline 单测替代）
- CTC secondary decode 单测：`candidate-provider.test.ts`、`secondary-decode-worker.test.ts`

词库门禁与 Phase5 验收见 `npm run lexicon:v3-gate`、`scripts/lexicon/run-phase5-acceptance.mjs`（`--e2e` 走 FW dialog_200 批测）。
