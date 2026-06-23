# FW Repair V4 文档（已迁移）

本目录原开发过程文档（审计、测试报告、开发计划、清单等）已清理。当前 SSOT 如下：

## FW 算法

| 文档 | 路径 |
|------|------|
| 文档索引 | [`docs/fw-detector/README.md`](../fw-detector/README.md) |
| 最终架构冻结 | [`docs/fw-detector/freeze/FINAL_FREEZE_2026_06_23.md`](../fw-detector/freeze/FINAL_FREEZE_2026_06_23.md) |
| Assembly V1.2 | [`docs/fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) |
| Interval Assembly V1.1 | [`docs/fw-detector/assembly/INTERVAL_ASSEMBLY.md`](../fw-detector/assembly/INTERVAL_ASSEMBLY.md) |
| Domain Recall V1.2 | [`docs/fw-detector/recall/DOMAIN_RECALL.md`](../fw-detector/recall/DOMAIN_RECALL.md) |

## 聚合 / 去重

| 文档 | 路径 |
|------|------|
| Aggregator 模块 | [`electron_node/electron-node/main/src/aggregator/README.md`](../../electron_node/electron-node/main/src/aggregator/README.md) |
| Duplicate Guard | [`electron_node/electron-node/main/src/aggregator/DEDUP.md`](../../electron_node/electron-node/main/src/aggregator/DEDUP.md) |

## 词库 Schema V2

| 文档 | 路径 |
|------|------|
| Schema V2 合约 | [`electron_node/lexicon-assets/docs/SCHEMA_V2.md`](../../electron_node/lexicon-assets/docs/SCHEMA_V2.md) |
| 导入与门禁 | [`electron_node/lexicon-assets/docs/IMPORT_AND_GATE.md`](../../electron_node/lexicon-assets/docs/IMPORT_AND_GATE.md) |
| 资产 README | [`electron_node/lexicon-assets/docs/README.md`](../../electron_node/lexicon-assets/docs/README.md) |
| Multidomain seed | `electron_node/docs/lexicon-assets/.../domain_patch_multidomain_v1/entries.jsonl` |

## 模块内 README

| 模块 | 路径 |
|------|------|
| FW Detector | [`electron_node/electron-node/main/src/fw-detector/README.md`](../../electron_node/electron-node/main/src/fw-detector/README.md) |

## 批测报告输出

测试报告生成脚本输出至 `electron_node/electron-node/tests/repro/output/` 与 `tests/experiments/output/`，不再写入本目录。
