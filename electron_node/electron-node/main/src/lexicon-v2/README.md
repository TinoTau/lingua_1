# Lexicon Runtime V2（FW 主链）

> **SSOT：** [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)  
> **Domain SSOT：** [docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md](../../../../docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md)

FW 默认词库路径。类名仍为 `LexiconRuntimeV2`（V3.1 冻结未改名）。

**代码：** `electron-node/main/src/lexicon-v2/` · `lexicon/local-span-recall.ts`

---

## DSU 冻结要点（2026-06）

| 层 | SSOT |
|----|------|
| 细域可用性 | `term_domain_tags` → `availableFineDomains` |
| 层级映射 | `domain_hierarchy`（build 自 `profile-registry.json`） |
| 域决策入口 | `RuntimeDomainRegistry` |
| Recall scope | RS-03A：`enabledDomains` → expand → ∩ available |
| Session `primaryDomain` | 会话标签；**不**拥有 recall SQL scope |

---

## Runtime 布局

```text
node_runtime/lexicon/v3/
  lexicon.sqlite
  manifest.json
```

- 默认 `bundlePath`：`node_runtime/lexicon/v3`（`lexicon-v2-bundle-path.ts`）
- Bootstrap 原料：`v2_shadow`（`lexicon:build:v2-shadow` → `lexicon:prepare:v3-runtime`）

## SQLite 表（Recall）

| 表 | 用途 |
|----|------|
| `base_lexicon` | 通用词条、拼音桶 |
| `domain_lexicon` | 行业域词条 |
| `term` / `term_domain_tags` | Patch 运行时 term-centric |
| `idiom_lexicon` | 成语（默认 `maxIdiomCandidates: 0`） |

Recall 合并（`lexicon-v2/recall/`）：Base pinyin → Domain pinyin → Alias；按 `enabledDomains` 过滤。

门限：`recallMinPhoneticScore`（默认 0.5）、`minPrior`（默认 0.5）。

## 代码入口

| 文件 | 职责 |
|------|------|
| `lexicon-runtime-v2.ts` | 加载、status、reload |
| `lexicon-v2-bundle-path.ts` | 路径解析 |
| `recall/` | SQL span recall |
| `session-intent-context.ts` | Context → enabledDomains |
| `local-span-recall.ts` | FW `recallSpanTopK` |

## 配置要点

```json
{
  "features": {
    "lexiconRuntimeV2": {
      "enabled": true,
      "bundlePath": "node_runtime/lexicon/v3",
      "maxBaseCandidates": 2,
      "maxDomainCandidates": 3,
      "maxIdiomCandidates": 0
    },
    "fwDetector": {
      "useLexiconRuntimeV2Recall": true,
      "enabledDomains": [],
      "recallMinPhoneticScore": 0.5,
      "candidateRequireRepairTarget": true
    }
  }
}
```

`enabledDomains: []` = 全量 available fine domains（RS-03A）。

## 构建与门禁

在 `electron-node/`：

| 命令 | 作用 |
|------|------|
| `npm run lexicon:build:v2-shadow` | 构建 `v2_shadow` |
| `npm run lexicon:prepare:v3-runtime` | 复制 → **v3** runtime |
| `npm run lexicon:gate:v3-runtime` | FW bundle 门禁 |
| `npm run lexicon:rebuild-sqlite` | 重建 sqlite |

Patch 运行时：`lexicon-patch-v4/`（不修改 `domain_hierarchy`）。

## 与 Recover V5 的关系

| 路径 | 词库 | Pipeline |
|------|------|----------|
| FW 主链（默认） | v3 SQLite | `FW_SPAN_DETECTOR` + V2 recall |
| Recover V5 | `lexicon/current` | `LEXICON_RECALL` |

切换靠 `asr.engine` 与 `applyFwDetectorPipelineMode`。

## 验证

```powershell
cd electron_node\electron-node
npm run build:main
npm run lexicon:gate:v3-runtime
npx jest --testPathPattern="lexicon-v2|local-span-recall|freeze-contract"
```

## 关联文档

| 主题 | 路径 |
|------|------|
| Lexicon V3 运维 | [docs/lexicon-v3/LEXICON_OPERATIONS.md](../../../../docs/lexicon-v3/LEXICON_OPERATIONS.md) |
| 词库脚本 | [scripts/lexicon/README.md](../../../scripts/lexicon/README.md) |
| 词库资产 | [lexicon-assets/docs/README.md](../../../../lexicon-assets/docs/README.md) |
| FW Detector | [fw-detector/README.md](../fw-detector/README.md) |
