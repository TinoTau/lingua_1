# Lexicon Runtime V2

> ## DSU Freeze Notice（2026-06-23）
>
> **Session Profile 不再是 Runtime Domain SSOT。**
>
> | 层 | SSOT |
> |----|------|
> | Runtime 细域可用性 | **`term_domain_tags`**（sqlite DISTINCT → `availableFineDomains`） |
> | Runtime 层级映射 | **`domain_hierarchy`**（sqlite；build 物化自 `profile-registry.json`） |
> | Runtime 域决策入口 | **`RuntimeDomainRegistry`** |
> | Recall scope | **RS-03A** — policy `enabledDomains` → expand → ∩ available；默认 `[]` = 全量 available |
> | Session `primaryDomain` | 会话标签 / LLM 输出；**不**拥有 recall SQL scope |
>
> 权威文档：[DOMAIN_SOURCE_UNIFICATION.md](../../../docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md)
>
> 下文 §2–§3 中 profile / `domain_lexicon` 主轨描述为 **Pre-DSU 历史**；冲突时以 DSU 为准。

**Scope:** FW 主链 span recall（`useLexiconRuntimeV2Recall`）。  
**代码：** `electron-node/main/src/lexicon-v2/`、`lexicon/local-span-recall.ts`  
**冻结：** 见 [../../electron-node/main/src/fw-detector/README.md](../../electron-node/main/src/fw-detector/README.md)

---

## 1. 架构

| 项 | 说明 |
|----|------|
| Bundle | **`node_runtime/lexicon/v3`**（`manifest.json` + `lexicon.sqlite`） |
| Bootstrap 原料 | `node_runtime/lexicon/v2_shadow`（`lexicon:build:v2-shadow` → `lexicon:prepare:v3-runtime`） |
| 配置 | `features.lexiconRuntimeV2`（`node-config-defaults.ts`） |
| 入口 | `getLexiconRuntime()` → V2 SQLite 只读 |
| Recall | `recallSpanTopK(spanText, topK, minPrior, enabledDomains)` |
| Session | `getLexiconSessionIntentFromContext` → profile / primaryDomain |
| Diagnostics | `runWithRecallV2Diagnostics` → job extra |

默认：`lexiconRuntimeV2.enabled = true`，`fwDetector.useLexiconRuntimeV2Recall = true`。

---

## 2. SQLite 表与 Recall 层

V2 shadow bundle 由 build 脚本从 seed jsonl 生成，含：

- **base_lexicon** — 通用词条、拼音桶、exact 索引
- **domain_lexicon** — 行业域词条（travel / transport / restaurant / tech_ai）
- **alias** — alias → canonical，`repair_target` 标记
- **idiom** — 成语层（默认 `maxIdiomCandidates: 0` 关闭）

Recall 合并顺序（代码：`lexicon-v2/recall/`）：

1. Base pinyin topK（上限 `maxBaseCandidates`，默认 2）
2. Domain pinyin topK（上限 `maxDomainCandidates`，默认 3）
3. Alias exact / alias pinyin
4. 按 `enabledDomains` + session profile 过滤

门限：`fwDetector.recallMinPhoneticScore`（默认 0.5）、`minPrior`（默认 0.5）。

---

## 3. Session Intent 与 Domain

- **Profile SSOT：** Session 迁移 / Intent 服务写入的 `primaryDomain`
- **FW 使用：** `getProfileSnapshotFromContext(ctx)` → 过滤 domain recall
- **Industry routing：** `useIndustryRouting` 默认 `false`（冻结）；topic → domain 为可选扩展

Restaurant 等 domain 批测需通过 `POST /session-migration/import` 注入 profile，而非 pipeline HTTP 参数。

Intent CPU 服务（可选）：`features.lexiconV2.cpuWorker` → `:5018` Qwen GGUF。

---

## 4. 构建命令

在 `electron-node/` 目录：

| 命令 | 作用 |
|------|------|
| `npm run lexicon:build:v2-shadow` | 离线构建 `v2_shadow`（bootstrap 输入） |
| `npm run lexicon:prepare:v3-runtime` | 复制 shadow → **v3** runtime |
| `npm run lexicon:gate:v3-runtime` | FW v3 bundle 门禁 |

**环境：** 构建前需 `PROJECT_ROOT` 指向仓库根；Electron 运行前 bundle 须与 `better-sqlite3` ABI 一致。

**Seed 数据：**

| 路径 | 用途 |
|------|------|
| `data/lexicon/10k/lexicon_10k_canonical_merged.jsonl` | base canonical |
| `data/lexicon/confusions.jsonl` | confusion 证据（build 输入） |
| `data/lexicon/hotwords.jsonl` | hotword |
| `data/lexicon/domain_anchor.json` | FW detector domain anchor |

Domain patch 行格式示例：

```json
{ "word": "美式", "domains": ["restaurant"], "repair_target": true, "anchor": true }
{ "alias": "美食", "canonical": "美式", "repair_target": true }
```

---

## 5. 配置项

```json
{
  "features": {
    "lexiconRuntimeV2": {
      "enabled": true,
      "bundlePath": "node_runtime/lexicon/v3",
      "lruBucketCacheSize": 512,
      "maxBaseCandidates": 2,
      "maxDomainCandidates": 3,
      "maxIdiomCandidates": 0,
      "recallDiagnosticsEnabled": true
    },
    "fwDetector": {
      "useLexiconRuntimeV2Recall": true,
      "enabledDomains": ["tech_ai", "travel", "transport", "restaurant"],
      "recallMinPhoneticScore": 0.5,
      "candidateRequireRepairTarget": true
    }
  }
}
```

回滚 V1 Recover recall：`useLexiconRuntimeV2Recall: false`（需 legacy bundle + `lexiconRecall.enabled`，非 FW 冻结默认）。

---

## 6. 与 V3 Recover 的关系

| 路径 | 词库 | Pipeline |
|------|------|----------|
| FW 主链（默认） | **v3** SQLite（单 manifest） | `FW_SPAN_DETECTOR` + V2 recall |
| Recover V5 | V3 canonical (`node_runtime/lexicon/current`) | `LEXICON_RECALL` + window n-best |

二者互斥于同一 job；切换靠 `asr.engine` 与 `applyFwDetectorPipelineMode`。

V3.1 SSOT：[docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)

---

## 7. 验证

```powershell
cd electron_node\electron-node
npm run build:main
npx jest --testPathPattern="lexicon-v2|local-span-recall|domain-filter"
node tests/patch-p4-config.mjs
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/run-lexicon-v2-p4-batch.js "<dialog_200>"
```

Mock：`lexicon-assets/tests/restaurant_homophone.jsonl`、`tech_ai_mixed.jsonl`

---

## 8. 模块索引

| 路径 | 职责 |
|------|------|
| `lexicon-v2/lexicon-runtime-v2.ts` | Runtime 加载、status |
| `lexicon-v2/lexicon-runtime-v2-config.ts` | 配置解析 |
| `lexicon-v2/recall/` | SQL recall 合并 |
| `lexicon-v2/session-intent-context.ts` | Context → intent |
| `lexicon/local-span-recall.ts` | FW 入口 recallSpanTopK |
| `lexicon/domain-filter.ts` | Domain 过滤 |
| `scripts/lexicon/build-v2-shadow-for-electron.mjs` | Electron bundle 构建 |
