# FW Detector 文档

> **状态：** FW Repair V4 Framework **Frozen** · Maintenance Mode（2026-06-23）  
> **代码：** `electron_node/electron-node/main/src/fw-detector/`

## 生产主链

```text
ASR → IME V2 → Raw Boundary → Fine Span Recall → Tone-First Recall
→ Domain Vote → Sentence Assembly V4 → KenLM Batch → Raw Log Delta Pick → Apply
```

## 文档索引（SSOT）

| 文档 | 说明 |
|------|------|
| [FRAMEWORK_FREEZE_DECLARATION.md](./FRAMEWORK_FREEZE_DECLARATION.md) | **入口** — 冻结声明与验证 |
| [freeze/FINAL_FREEZE_2026_06_23.md](./freeze/FINAL_FREEZE_2026_06_23.md) | 最终架构冻结矩阵 · Maintenance Mode |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 主链 · Module Ownership · Freeze Boundary |
| [CONFIG.md](./CONFIG.md) | Framework vs Lexicon 配置 |
| [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) | KenLM batch-only |
| [kenlm/SCORE_CONTRACT.md](./kenlm/SCORE_CONTRACT.md) | Raw Log Delta · Gate 3.0 |
| [INTERFACE_FREEZE.md](./INTERFACE_FREEZE.md) | 接口冻结 |
| [DIAGNOSTICS_CONTRACT.md](./DIAGNOSTICS_CONTRACT.md) | Diagnostics + JSON samples |
| [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md) | 词库迭代 · 质量基线 · P0 词表 |

### 子模块冻结合约

| 模块 | 文档 |
|------|------|
| Assembly V1.2 | [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) |
| Interval Assembly V1.1 | [assembly/INTERVAL_ASSEMBLY.md](./assembly/INTERVAL_ASSEMBLY.md) |
| Recall V1.0.1 | [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](./recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) |
| Domain Recall V1.2 | [recall/DOMAIN_RECALL.md](./recall/DOMAIN_RECALL.md) |
| Compatibility V1.1 | [compatibility/FROZEN.md](./compatibility/FROZEN.md) |
| Diagnostics V1.0.2 | [diagnostics/TRACE_FROZEN_V1_0_2.md](./diagnostics/TRACE_FROZEN_V1_0_2.md) |

## 关联

| 模块 | 文档 |
|------|------|
| Pinyin IME V2 | [../pinyin-v2/README.md](../pinyin-v2/README.md) |
| Tone Module | [../tone-module/README.md](../tone-module/README.md) |
| Lexicon V3 | [../lexicon-v3/ARCHITECTURE.md](../lexicon-v3/ARCHITECTURE.md) |
| Schema V2 | [../../electron_node/lexicon-assets/docs/SCHEMA_V2.md](../../electron_node/lexicon-assets/docs/SCHEMA_V2.md) |
| Duplicate Guard | [../../electron_node/electron-node/main/src/aggregator/DEDUP.md](../../electron_node/electron-node/main/src/aggregator/DEDUP.md) |

## 验证

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
```

期望 **50/50 PASS**
