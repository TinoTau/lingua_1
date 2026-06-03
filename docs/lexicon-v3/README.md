# Lexicon V3.1 文档

> **状态**：V3.1 **已冻结**（节点单 Runtime + Patch Service）  
> **架构 SSOT**：[ARCHITECTURE.md](./ARCHITECTURE.md)

## 一句话

```text
node_runtime/lexicon/v3  →  lexicon.sqlite + manifest/stats/checksum
         ↑
  lexicon-patch-v3（事务 Patch + reload）
         ↓
  FW Recall（local-span-recall / LexiconRuntimeV2 加载 v3 bundle）
```

## 代码位置（文档在模块内）

| 模块 | 路径 |
|------|------|
| Runtime 加载 | `electron_node/electron-node/main/src/lexicon-v2/` |
| Patch Service | `electron_node/electron-node/main/src/lexicon-patch-v3/` |
| Recall | `electron_node/electron-node/main/src/lexicon/local-span-recall.ts` |
| npm 脚本 | `electron_node/electron-node/scripts/lexicon/` |
| V1 资产 import | `electron_node/lexicon-assets/docs/` |
| FW 详述 | `electron_node/docs/lexicon_v2/LEXICON_RUNTIME_V2.md` |

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node

npm run lexicon:gate:v3-runtime          # 门禁
npm run lexicon:prepare:v3-runtime -- --force   # bootstrap
npm run lexicon:patch:apply -- --bundle-dir <dir> patch.json
npm run test:lexicon-patch-e2e
npm run test:fw-detector
```

启动节点前：`npm run build:main`；`$env:PROJECT_ROOT` 指向仓库根。

## 与 FW / Pinyin-IME-V2 的关系

- **Recall** 只读 v3 runtime，不改 SQLite 业务表结构。
- **Span 发现** 已迁至 [Pinyin-IME-V2 V2.0](../pinyin-v2/ARCHITECTURE.md)（独立 IME 词典 `node_runtime/pinyin-ime-v2/dict/`）。
- 本目录 **不包含** FW 质量审计、Dialog200 测试报告（已移除）。

## 下一阶段（未实现）

| 阶段 | 内容 |
|------|------|
| P1 | Node Agent → `applyLexiconPatchV3` |
| P2 | Scheduler Patch 下发 |
| P3 | 签名验签 |
| P4 | 生产 rollout |

详见 [ARCHITECTURE.md §12](./ARCHITECTURE.md#12-下一阶段).
