# Lexicon 脚本（electron-node/scripts/lexicon）

> 架构 SSOT：[docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)

---

## FW Runtime（v3）

| npm 命令 | 脚本 | 说明 |
|----------|------|------|
| `lexicon:gate:v3-runtime` | `run-gate-v3-runtime.mjs` | 校验 `node_runtime/lexicon/v3` 四表阈值 + checksum |
| `lexicon:prepare:v3-runtime` | `prepare-lexicon-v3-runtime-from-shadow.mjs` | Bootstrap：从 `v2_shadow` 构建产物复制到 v3（**非** Patch） |
| `lexicon:migrate:v3-runtime` | `migrate-lexicon-v3-runtime-single-manifest.mjs` | 双 manifest → 单 manifest 一次性迁移 |

---

## Patch Service（V3.1）

| npm 命令 | 脚本 | 说明 |
|----------|------|------|
| `lexicon:patch:apply` | `apply-lexicon-patch-v3.mjs` | CLI apply；`--bundle-dir` 可选（E2E 副本） |
| `test:lexicon-patch-e2e` | `run-patch-e2e.mjs` | Electron ABI 下跑 patch E2E |

HTTP（test-server）：`POST /lexicon/apply-patch` → `main/src/lexicon-patch-v3/`。

---

## 离线构建（非运行时 Patch）

| npm 命令 | 说明 |
|----------|------|
| `lexicon:build:v2-shadow` | 生成 `node_runtime/lexicon/v2_shadow`（bootstrap 原料） |
| `lexicon:build` | V1 canonical bundle → `node_runtime/lexicon/current` |
| `lexicon:rebuild-sqlite` | better-sqlite3 Electron ABI 对齐 |
| `lexicon:patch-merge` | 离线 seed 合并（≠ PatchV3） |
| `lexicon:import-v3-5k-assets` | V1 5k 资产 import（见 lexicon-assets/docs） |
| `lexicon:v3-gate` | V1 `current` gate（**非** FW v3） |

---

## 验证 / 批测

| npm 命令 | 说明 |
|----------|------|
| `test:fw-detector` | FW 冻结单测 |
| `test:lexicon` | Legacy lexicon 单测 |
| `node tests/run-dialog200-timed-batch.mjs` | dialog_200 契约批测（需节点 :5020） |

---

## 环境

- `PROJECT_ROOT` 指向仓库根
- Patch / gate 使用系统 Node；E2E 经 `ELECTRON_RUN_AS_NODE=1` + Electron jest
- 节点 `npm start` 前需 `build:renderer`，且**不得**设置 `ELECTRON_RUN_AS_NODE`
