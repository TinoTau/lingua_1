# Lexicon Storage Pipeline — 架构与命令

**版本：** 2026-06-25  
**前提：** 不改 DSU · Context Prior · Schema V2 · FW 主链

---

## 1. 全量 Build 链路

```text
entries.jsonl (+ profile-registry.json)
    ↓ lexicon:validate
    ↓ lexicon:build:v2-shadow      → v2_shadow SQLite
    ↓ lexicon:prepare:v3-runtime   → node_runtime/lexicon/v3/
    ↓ lexicon:gate:v3-runtime
    ↓ LexiconRuntimeV2.load() → FW Recall
```

---

## 2. Patch 链路（默认 · Patch-First）

```text
LexiconPatchV3 JSON
    ↓ lexicon:patch:apply / lexicon:patch:import:electron
    ↓ patch-service（事务 writable SQLite）
    ↓ rematerialize + manifest + checksum
    ↓ forceReloadLexiconRuntimeV3()
```

详见 [PATCH_IMPORTER_V4.md](./PATCH_IMPORTER_V4.md)。

---

## 3. Native 重建（勿与 DB build 混淆）

```text
npm run lexicon:rebuild-sqlite   → @electron/rebuild better-sqlite3（.node 模块）
```

| 命令 | 作用 |
|------|------|
| `lexicon:build:v2-shadow` | **生成** lexicon SQLite |
| `lexicon:rebuild-sqlite` | **重编译** native 绑定 |

---

## 4. 何时用哪种交付

| 场景 | 路径 |
|------|------|
| 日常词条增量 · alias 修正 | **Patch** |
| 新 domain_id · 大批量 hierarchy · JSONL 重构 | **Full Build** |
| 非法 alias 清理 | cleanup **Patch** + JSONL dual-write |

Expansion 词条清单见 [LEXICON_EXPANSION_PACKAGE.md](./LEXICON_EXPANSION_PACKAGE.md)。

---

## 5. 目录 SSOT

| 路径 | 用途 |
|------|------|
| `node_runtime/lexicon/v3/` | 生产 runtime bundle |
| `electron_node/docs/lexicon-assets/` | JSONL SSOT |
| `electron_node/lexicon-assets/docs/` | Schema V2 · IMPORT_AND_GATE |
| `scripts/lexicon/` | npm 脚本 |

---

## 6. 常用命令

```powershell
cd electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"

npm run lexicon:gate:v3-runtime
npm run lexicon:prepare:v3-runtime -- --force
npm run lexicon:patch:apply -- --bundle-dir <dir> patch.json
npm run build:main
```

脚本索引：`scripts/lexicon/README.md`

---

## 7. Gate 失败

1. 读 `reports/lexicon-import/` 或 gate 输出
2. 还原 v3 bundle 或反向 patch
3. 禁止在 FAIL 状态继续叠加 patch

---

## 8. 与 FW 关系

- Runtime 只读 SQLite；Recall 经 `LexiconRuntimeV2`
- Span 发现：**Pinyin-IME-V2**（独立词典）
- 质量迭代：[LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md)

---

*Storage Pipeline · Lexicon V3*
