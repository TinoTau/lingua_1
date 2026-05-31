# Lexicon Runtime V2 — Phase 1 & Phase 2 开发报告

版本：V1.0  
日期：2026-05-30  
范围：Phase 1（Runtime V2 SQL + LRU）+ Phase 2（Session Intent SSOT 写入链）  
SSOT 方案：`Lexicon_Runtime_V2_实施方案_补充整合版_2026_05_30.md`

---

## 1. 开发目标

| Phase | 交付物 | 约束 |
|-------|--------|------|
| P1 | `LexiconRuntimeV2`、四表 SQL 查询、LRU 缓存 | **不接 FW Recall** |
| P2 | `LexiconSessionIntent`、`topicKeywords` 解析与 Session 写入 | **不参与 Recall** |

主链冻结不变：`ASR → FW_SPAN_DETECTOR → AGGREGATION → DEDUP → TRANSLATION`

---

## 2. 新增 / 修改模块

### Phase 1

| 文件 | 职责 |
|------|------|
| `lexicon-runtime-v2.ts` | V2 SQLite 只读加载、prepared statements、tier 查询 |
| `lexicon-runtime-v2-holder.ts` | 单例 + `ensureLexiconRuntimeV2Loaded()` |
| `lexicon-runtime-v2-config.ts` | `features.lexiconRuntimeV2` 配置 |
| `lexicon-v2-bundle-path.ts` | `v2_shadow` bundle 路径解析 |
| `lexicon-types-v2.ts` | V2 类型与 schema 版本常量 |
| `lru-bucket-cache.ts` | pinyin bucket LRU |
| `lexicon-v2-startup.ts` | 启动日志扩展（V2 status / 表计数） |
| `node-config-types.ts` / `defaults.ts` / `node-config.ts` | 合并 `lexiconRuntimeV2` feature |

### Phase 2

| 文件 | 职责 |
|------|------|
| `session-runtime/types.ts` | `LexiconSessionIntent`、`LexiconProfileDecision.topicKeywords` |
| `lexicon-session-intent.ts` | 关键词规范化 + Node 侧 `topicKeywordPinyinKeys` |
| `lexicon-profile-decision-parser.ts` | 解析 LLM `topicKeywords` |
| `services/lexicon_intent_cpu/prompt_templates.py` | prompt schema 扩展 |
| `session-finalize.ts` | Intent 回调双写 `lexiconSessionIntent` |
| `turn-profile-binding.ts` | turn 内绑定 intent → JobContext |
| `session-migration.ts` | 迁移 payload 含 `lexiconSessionIntent` |
| `session-result-extra.ts` | observability 输出 intent 字段 |

---

## 3. Feature Flags

```json
{
  "features": {
    "lexiconRuntimeV2": {
      "enabled": true,
      "bundlePath": "node_runtime/lexicon/v2_shadow",
      "lruBucketCacheSize": 512
    },
    "lexiconV2": {
      "enabled": false,
      "sessionIntentWriteEnabled": false
    }
  }
}
```

- P1 默认 `lexiconRuntimeV2.enabled=false`；批测时显式开启以验证 shadow bundle 加载。
- P2 `sessionIntentWriteEnabled` 依赖 `lexiconV2.enabled`；批测关闭 Intent 调度，避免 CPU LLM 依赖。

---

## 4. 启动验收（批测环境）

日志 `[LEXICON_V2] startup contract`：

```
lexiconRuntimeV2.enabled: true
lexiconRuntimeV2.status: ok
lexiconRuntimeV2.tables: {"base":50000,"idiom":22192,"domain":0,"routing":0}
```

V1 词库（FW Recall 仍用）：`lexicon_runtime_status=ok`（200/200 case）。

---

## 5. 单元测试

| 套件 | 结果 |
|------|------|
| `lru-bucket-cache.test.ts` | PASS |
| `lexicon-runtime-v2.test.ts` | PASS |
| `lexicon-session-intent.test.ts` | PASS |
| `lexicon-profile-decision-parser.test.ts` | PASS |
| `session-finalize.test.ts` / `session-migration.test.ts` | PASS |

Phase 1/2 核心单测 **12/12 PASS**（`npm run build:main` 后执行）。

---

## 6. 已知前置条件

1. **Electron ABI**：节点启动前需 `npx electron-rebuild -f -w better-sqlite3`（或 `npm run lexicon:rebuild-sqlite`），否则 V1 词库报 `NODE_MODULE_VERSION 127 vs 119`。
2. **Renderer**：生产模式需 `npm run build:renderer`。
3. **ASR 服务**：批测需 `servicePreferences.faster-whisper-vad=true` 或按需拉起 ASR。
4. **Phase 3 前禁止**：修改 `local-span-recall.ts` / FW recall 路径。

---

## 7. 结论

Phase 1 Runtime V2 与 Phase 2 Session Intent SSOT **代码交付完成**；dialog_200 全量批测 **200/200 契约 PASS**，FW 主链无回归。Phase 2 Intent 写入的 E2E 需单独开启 `lexiconV2.enabled + sessionIntentWriteEnabled` 并启动 CPU LLM 服务（本批测未覆盖）。

详细质量/性能数据见：`Lexicon_Runtime_V2_Phase1_Phase2_测试报告_dialog200_200_2026_05_30.md`
