# Lexicon V3.1 文档

> **状态**：V3.1 **已冻结**（节点单 Runtime + Patch Service）  
> **架构 SSOT**：[ARCHITECTURE.md](./ARCHITECTURE.md)

## 一句话

```text
node_runtime/lexicon/v3  →  lexicon.sqlite + manifest/stats/checksum
         ↑
  lexicon-patch-v3 / Patch Importer V4（事务 Patch + reload）
         ↓
  FW Recall（LexiconRuntimeV2 加载 v3 bundle）
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | V3.1 架构 SSOT |
| [ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md](./ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md) | Alias 五类合法 / 禁止 |
| [PATCH_IMPORTER_V4.md](./PATCH_IMPORTER_V4.md) | Importer V1.2 合约 + Runbook |
| [STORAGE_PIPELINE.md](./STORAGE_PIPELINE.md) | Build / Patch / Gate 链路 |
| [ILLEGAL_ALIAS_CLEANUP.md](./ILLEGAL_ALIAS_CLEANUP.md) | 非法 alias 清理 |
| [LEXICON_EXPANSION_PACKAGE.md](./LEXICON_EXPANSION_PACKAGE.md) | Expansion 词条包 |
| [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md) | FW 质量运营 |

## 代码位置

| 模块 | 路径 |
|------|------|
| Runtime 加载 | `electron_node/electron-node/main/src/lexicon-v2/` |
| Patch Service | `electron_node/electron-node/main/src/lexicon-patch-v3/` |
| Recall | `electron_node/electron-node/main/src/lexicon/local-span-recall.ts` |
| npm 脚本 | `electron_node/electron-node/scripts/lexicon/` |
| Schema V2 | `electron_node/lexicon-assets/docs/SCHEMA_V2.md` |
| FW 算法 | [../fw-detector/README.md](../fw-detector/README.md) |

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"

npm run lexicon:gate:v3-runtime
npm run lexicon:patch-build-gate -- <patch.json>
npm run lexicon:scan-alias-legality:test
npm run lexicon:patch:import:electron -- patch.json --source-jsonl entries.jsonl
npm run test:lexicon-patch-v4-e2e
```

启动节点前：`npm run build:main`

## 与 FW / Pinyin-IME-V2

- **Recall** 只读 v3 runtime，不改 SQLite DDL。
- **Span 发现**：[Pinyin-IME-V2](../pinyin-v2/ARCHITECTURE.md)
- **词库质量运营**：[LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md)

## 下一阶段（未实现）

| 阶段 | 内容 |
|------|------|
| P1 | Node Agent → `applyLexiconPatchV3` |
| P2 | Scheduler Patch 下发 |
| P3 | 签名验签 |

详见 [ARCHITECTURE.md §12](./ARCHITECTURE.md#12-下一阶段).
