# electron-node 脚本

## 构建与开发（package.json 引用）

| 脚本 | npm 命令 |
|------|----------|
| `setup-cleanup-handlers.js` | `npm run dev` |
| `cleanup-esbuild.js` | `npm run cleanup:esbuild` |
| `fix-service-type-export.js` | `npm run build:main` |
| `clear-cache.ps1` | `npm run clear-cache` |

## 词库

| 脚本 | 命令 |
|------|------|
| `init-lexicon-bundle.mjs` | `npm run init:lexicon-bundle` |
| `scripts/lexicon/build-for-electron.mjs` | `npm run lexicon:build`（build + electron-rebuild） |
| `scripts/lexicon/build-lexicon-bundle.mjs` | `npm run lexicon:build:raw`（仅 build，不 rebuild sqlite） |
| `scripts/lexicon/rebuild-sqlite-for-electron.mjs` | `npm run lexicon:rebuild-sqlite` |
| `build-lexicon-bundle.mjs` | `npm run build:lexicon-bundle`（→ build-for-electron） |
| `export-q17-regression-manifest.mjs` | `node scripts/export-q17-regression-manifest.mjs` |

## LID 模型导出（可选）

见 [README_LID_VOXLINGUA107.md](./README_LID_VOXLINGUA107.md)。

## 批测（tests 目录）

| 脚本 | 说明 |
|------|------|
| `tests/run-fw-detector-dialog-200-batch.js` | FW dialog_200 契约批测（需节点 + 5020 test server） |
| `tests/run-fw-detector-homophone-acceptance.js` | homophone 期望验收 |
| `tests/run-fw-detector-false-repair-acceptance.js` | false_repair 门禁 |
| `tests/lib/fw-detector-contract-assess.js` | FW dialog_200 契约判定 |
| `scripts/fw-detector-gate.mjs` | FW 主链静态门禁 |

Recover 历史批测脚本已移除；Recover 契约仍由 `npm run test:contract`（`main/src/pipeline/recover-contract*.ts`）覆盖。
