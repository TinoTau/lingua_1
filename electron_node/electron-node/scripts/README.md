# electron-node 脚本

## 构建与开发（package.json 引用）

| 脚本 | npm 命令 |
|------|----------|
| `setup-cleanup-handlers.js` | `npm run dev` |
| `cleanup-esbuild.js` | `npm run cleanup:esbuild` |
| `fix-service-type-export.js` | `npm run build:main` |
| `clear-cache.ps1` | `npm run clear-cache` |

## 词库 / Recover

| 脚本 | 命令 |
|------|------|
| `init-lexicon-bundle.mjs` | `npm run init:lexicon-bundle` |
| `build-lexicon-bundle.mjs` | `npm run build:lexicon-bundle` |
| `prepare-recover-test.mjs` | `npm run prepare:recover-test` |
| `export-q17-regression-manifest.mjs` | `node scripts/export-q17-regression-manifest.mjs` |

## LID 模型导出（可选）

见 [README_LID_VOXLINGUA107.md](./README_LID_VOXLINGUA107.md)。

## 批测（tests 目录）

| 脚本 | 说明 |
|------|------|
| `tests/run-dialog-200-batch.js` | dialog_200 全量契约批测（需节点 + 5020 test server） |
| `tests/run-homophone-expectation.js` | homophone 期望验收 |
| `tests/run-homophone-quality-check.js` | 基于批测 JSON 的质量检查 |
| `tests/lib/recover-contract-assess.js` | dialog_200 契约判定（批测与 `test:contract` 共用） |
