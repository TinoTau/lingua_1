# Lexicon Runtime V2（FW 主链）

> **SSOT：** [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)  
> **详述：** [electron_node/docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../../../../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md)

FW 默认词库路径。**类名仍为 `LexiconRuntimeV2`**（V3.1 冻结未改名）。

---

## Runtime 布局（当前）

```text
node_runtime/lexicon/v3/
  lexicon.sqlite
  manifest.json       # schemaVersion: lexicon-v3-four-table-v1
  stats.json
  checksum.txt
```

默认 `bundlePath`：`node_runtime/lexicon/v3`（`lexicon-v2-bundle-path.ts`）。

离线 bootstrap 原料：`node_runtime/lexicon/v2_shadow`（`lexicon:build:v2-shadow` → `lexicon:prepare:v3-runtime`）。

---

## 代码入口

| 文件 | 职责 |
|------|------|
| `lexicon-runtime-v2.ts` | 加载、查询、close/reload |
| `lexicon-v2-bundle-path.ts` | 路径解析、单 manifest 文件名 |
| `recall/` | SQL span recall |
| `session-intent-context.ts` | Session → enabledDomains |

FW 调用链：`local-span-recall.ts` → `recallSpanTopK`。

---

## 配置要点

- `features.lexiconRuntimeV2.enabled`
- `features.fwDetector.useLexiconRuntimeV2Recall`
- `fwDetector.enabledDomains` 与 `profile-registry` 对齐

---

## 验证

```bash
npm run lexicon:gate:v3-runtime
npx jest --testPathPattern="lexicon-v2|local-span-recall"
```

**勿改** Recall / schema 语义 unless FW freeze review。
