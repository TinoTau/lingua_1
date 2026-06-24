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
| `lexicon:patch:apply:electron` | `apply-lexicon-patch-v3-for-electron.mjs` | **推荐** CLI apply（Electron ABI） |
| `lexicon:patch:apply` | `apply-lexicon-patch-v3.mjs` | CLI apply（系统 Node；ABI 不匹配时提示用 electron） |
| `test:lexicon-patch-e2e` | `run-patch-e2e.mjs` | Electron ABI 下跑 patch E2E |

**Patch First：** 增量扩词默认走 patch；JSONL 仍须双写（见 Expansion Package）。

**Patch Build Gate（Contract V1.0.0）：**

| npm 命令 | 脚本 | 说明 |
|----------|------|------|
| `lexicon:scan-patch-granularity` | `scan-patch-granularity.mjs` | P0 短语 DENY_LIST + 长度 |
| `lexicon:scan-alias-legality` | `scan-alias-legality.mjs` | Alias Ownership Contract 校验 |
| `lexicon:patch-build-gate` | `run-patch-build-gate.mjs` | 上述两者串联（**apply 前必过**） |
| `lexicon:scan-alias-legality:test` | `scan-alias-legality.test.mjs` | 合约单测 |

SSOT：[docs/lexicon-v3/ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md](../../../../docs/lexicon-v3/ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md)

**生产约束：** 单节点单进程 patch；apply 会短暂 close runtime → patch → reload。

---

## Native vs DB Rebuild

| 命令 | 实际作用 |
|------|----------|
| `lexicon:rebuild-native` | **electron-rebuild better-sqlite3**（native 模块） |
| `lexicon:rebuild-sqlite` | 同上（兼容 alias） |
| `lexicon:build:v2-shadow` | 从 JSONL **重建 lexicon.sqlite**（全量 DB build） |

---

## 离线构建（Schema V2 Only 冻结路径）

**JSONL 大改 / hierarchy 变更时 Full Build：**

```text
npm run lexicon:validate
npm run lexicon:build:v2-shadow
npm run lexicon:prepare:v3-runtime -- --force
npm run lexicon:gate:v3-runtime
npm run lexicon:rebuild-native
# 重启节点
```

| npm 命令 | 说明 |
|----------|------|
| `lexicon:validate` | seed 校验 |
| `lexicon:build:v2-shadow` | 生成 `node_runtime/lexicon/v2_shadow` |
| `lexicon:prepare:v3-runtime` | v2_shadow → `node_runtime/lexicon/v3` |
| `lexicon:gate:v3-runtime` | FW v3 runtime gate（仅 `lexicon-v3-five-table-v2`） |
| `lexicon:rebuild-native` | better-sqlite3 Electron ABI 对齐（**非 DB rebuild**） |
| `lexicon:rebuild-sqlite` | 同上（alias） |
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
- Patch **推荐** `lexicon:patch:apply:electron`；gate/build 经 Electron wrapper
- 节点 `npm start` 前需 `build:renderer`，且**不得**设置 `ELECTRON_RUN_AS_NODE`
