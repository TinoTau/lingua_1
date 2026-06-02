# Lexicon V3.1 文档入口

> **唯一 SSOT：** [Lexicon_V3_1_Final_SSOT.md](./Lexicon_V3_1_Final_SSOT.md)  
> **状态：** V3.1 已冻结（节点 Patch Service + 单 Runtime）

---

## 架构（一句话）

```text
node_runtime/lexicon/v3  →  lexicon.sqlite  →  manifest.json / stats.json / checksum.txt
         ↑
  lexicon-patch-v3（Patch）  →  FW / ASR（只读，冻结）
```

---

## 文档分布（按模块）

| 主题 | 文档位置 |
|------|----------|
| **架构 SSOT** | 本目录 [Lexicon_V3_1_Final_SSOT.md](./Lexicon_V3_1_Final_SSOT.md) |
| FW Runtime 加载 / Recall | [electron_node/docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../../electron_node/docs/lexicon_v2/LEXICON_RUNTIME_V2.md) |
| Patch Service 实现 | [electron_node/electron-node/main/src/lexicon-patch-v3/README.md](../../electron_node/electron-node/main/src/lexicon-patch-v3/README.md) |
| Legacy Recover 窗召回 | [electron_node/electron-node/main/src/lexicon/README.md](../../electron_node/electron-node/main/src/lexicon/README.md) |
| 词库脚本命令 | [electron_node/electron-node/scripts/lexicon/README.md](../../electron_node/electron-node/scripts/lexicon/README.md) |
| V1 资产 import / gate | [electron_node/lexicon-assets/docs/](../../electron_node/lexicon-assets/docs/README.md) |
| 节点文档索引 | [electron_node/electron-node/docs/README.md](../../electron_node/electron-node/docs/README.md) |

---

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node

# FW v3 runtime 门禁
npm run lexicon:gate:v3-runtime

# 首次 / 灾备 bootstrap
npm run lexicon:prepare:v3-runtime -- --force

# Patch（开发 / E2E）
npm run lexicon:patch:apply -- --bundle-dir <dir> patch.json

# 验收
npm run test:lexicon-patch-e2e
npm run test:fw-detector
```

启动节点前：`npm run build:renderer`；清除 `ELECTRON_RUN_AS_NODE`。

---

## 下一阶段（未实现）

| 阶段 | 内容 |
|------|------|
| P1 | Node Agent → `applyLexiconPatchV3` |
| P2 | Scheduler Patch 下发 |
| P3 | 版本追踪 / 签名验签 |
| P4 | 生产 rollout |

详见 SSOT §12。

---

## 已移除内容

本目录曾含多份方案、审计与 **测试报告**；已合并入 SSOT 或迁入模块 README，**测试报告已全部删除**。勿再从 git 历史外的备份引用旧 Final/Rev.1/Migration 文档。
