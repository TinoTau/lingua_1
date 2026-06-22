# Lexicon 脚本（electron-node/scripts/lexicon）

> 架构 SSOT：[docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)

---

## FW Runtime（v3）

| npm 命令 | 脚本 | 说明 |
|----------|------|------|
| `lexicon:gate:v3-runtime` | `run-gate-v3-runtime.mjs` | 校验 `node_runtime/lexicon/v3` v2 manifest + checksum |
| `lexicon:prepare:v3-runtime` | `prepare-lexicon-v3-runtime-from-shadow.mjs` | Bootstrap：从 `v2_shadow` 复制到 v3（**非** Patch） |
| `lexicon:migrate:v3-runtime` | `migrate-lexicon-v3-runtime-single-manifest.mjs` | 双 manifest → 单 manifest 一次性迁移 |

---

## Patch Service（V3.1）

| npm 命令 | 脚本 | 说明 |
|----------|------|------|
| `lexicon:patch:apply` | `apply-lexicon-patch-v3.mjs` | CLI apply；`--bundle-dir` 可选（E2E 副本） |
| `test:lexicon-patch-e2e` | `run-patch-e2e.mjs` | Electron ABI 下跑 patch E2E |

HTTP（test-server）：`POST /lexicon/apply-patch` → `main/src/lexicon-patch-v3/`。

---

## 离线构建（Schema V2 Only 冻结路径）

**唯一 Build 路径：**

```text
npm run lexicon:validate
npm run lexicon:build:v2-shadow
npm run lexicon:prepare:v3-runtime -- --force
npm run lexicon:gate:v3-runtime
npm run lexicon:rebuild-sqlite
# 重启节点
```

| npm 命令 | 说明 |
|----------|------|
| `lexicon:validate` | seed 校验 |
| `lexicon:build:v2-shadow` | 生成 `node_runtime/lexicon/v2_shadow` |
| `lexicon:prepare:v3-runtime` | v2_shadow → `node_runtime/lexicon/v3` |
| `lexicon:gate:v3-runtime` | FW v3 runtime gate（仅 `lexicon-v3-five-table-v2`） |
| `lexicon:rebuild-sqlite` | better-sqlite3 Electron ABI 对齐 |
| `lexicon:patch-merge` | 离线 seed 合并（≠ PatchV3） |
| `lexicon:import-v3-assets` | V3 canonical import → v2 build 链 |
| `lexicon:import-v3-5k-assets` | 5k import → v2 build 链 |

**已禁用（fail-fast，勿用）：**

| 命令 | 状态 |
|------|------|
| `lexicon:build` | ❌ legacy V1 — exit 1 |
| `lexicon:build:raw` | ❌ legacy V1 — exit 1 |
| `lexicon:v3-gate` | ❌ legacy V1 current gate — exit 1 |
| `build:lexicon-bundle` | ❌ 转发 legacy — exit 1 |

---

## 验证 / 批测

| npm 命令 | 说明 |
|----------|------|
| `test:fw-detector` | FW 冻结单测（GATE-SV2 / GATE-INT） |
| `test:lexicon-patch-e2e` | Patch term-centric E2E |
| `test:schema-v2-seed-acceptance-12` | 12 句专项 scripted 验收（需 :5020） |
| `node tests/run-dialog200-timed-batch.mjs` | dialog_200 契约批测（需节点 :5020） |

---

## 环境

- `PROJECT_ROOT` 指向仓库根
- Patch / gate 使用系统 Node；E2E 经 Electron dist runner
- 节点 `npm start` 前需 `build:renderer`，且**不得**设置 `ELECTRON_RUN_AS_NODE`
