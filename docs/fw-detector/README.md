# FW Detector 文档

> **状态：** Framework **Frozen** · Maintenance Mode（**2026-06-25**）  
> **代码：** `electron_node/electron-node/main/src/fw-detector/`

## 生产主链

```text
FW Top1 → Recall → Tone First → Ranking
→ Vote → Filter → Tone Guard → Select → Assembly
→ KenLM → Apply Gate (≥3.0) → Writeback
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **架构 SSOT** — 主链 · 代码锚点 · 目录 |
| [freeze/FROZEN.md](./freeze/FROZEN.md) | **冻结 SSOT** — 合约 · 职责 · 回归 · 验证 |
| [CONFIG.md](./CONFIG.md) | Framework vs Lexicon 配置 |
| [INTERFACE_FREEZE.md](./INTERFACE_FREEZE.md) | 接口类型冻结 |

### 子模块

| 模块 | 文档 |
|------|------|
| Assembly V1.2 | [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) · [assembly/RANKING_V1_2.md](./assembly/RANKING_V1_2.md) |
| Interval Assembly | [assembly/INTERVAL_ASSEMBLY.md](./assembly/INTERVAL_ASSEMBLY.md) |
| Recall | [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](./recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) · [recall/DOMAIN_RECALL.md](./recall/DOMAIN_RECALL.md) |
| KenLM | [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) · [kenlm/SCORE_CONTRACT.md](./kenlm/SCORE_CONTRACT.md) |
| Diagnostics | [diagnostics/FROZEN.md](./diagnostics/FROZEN.md) |
| Domain / CP | [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md) · [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md) |
| Compatibility | [compatibility/FROZEN.md](./compatibility/FROZEN.md) |

## 关联模块

| 模块 | 文档 |
|------|------|
| Lexicon V3 | [../lexicon-v3/README.md](../lexicon-v3/README.md) |
| Pinyin IME V2 | [../pinyin-v2/README.md](../pinyin-v2/README.md) |
| Tone Module | [../tone-module/README.md](../tone-module/README.md) |

## 验证

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
```
