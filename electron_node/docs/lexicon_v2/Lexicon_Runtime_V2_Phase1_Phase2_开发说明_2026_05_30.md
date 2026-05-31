# Lexicon Runtime V2 — Phase 1 & Phase 2 开发说明

> 日期：2026-05-30  
> SSOT：`Lexicon_Runtime_V2_实施方案_补充整合版_2026_05_30.md`

## 范围

| Phase | 内容 | 是否接 FW Recall |
|-------|------|------------------|
| P1 | `LexiconRuntimeV2` SQL + LRU | **否** |
| P2 | `LexiconSessionIntent` + Session 写入 | **否** |

主链冻结不变：`ASR → FW_SPAN_DETECTOR → AGGREGATION → DEDUP → TRANSLATION`

---

## Phase 1 — Runtime V2

### 新增模块

```
main/src/lexicon-v2/
  lexicon-runtime-v2.ts          # SQL 查询 + prepared statements
  lexicon-runtime-v2-holder.ts   # 单例 + ensureLexiconRuntimeV2Loaded()
  lexicon-runtime-v2-config.ts   # feature flag
  lexicon-v2-bundle-path.ts      # v2_shadow 路径解析
  lexicon-types-v2.ts
  lru-bucket-cache.ts
```

### Feature Flags（默认全 false）

```json
{
  "features": {
    "lexiconRuntimeV2": {
      "enabled": false,
      "bundlePath": "node_runtime/lexicon/v2_shadow",
      "lruBucketCacheSize": 512
    }
  }
}
```

环境变量：`LEXICON_V2_BUNDLE_PATH` 可覆盖 bundle 目录。

### 启用试跑

1. 先构建 shadow bundle：`npm run lexicon:build:v2-shadow`
2. 配置 `features.lexiconRuntimeV2.enabled=true`
3. 启动节点，日志 `[LEXICON_V2] startup contract` 会打印 `lexiconRuntimeV2.status` 与表计数

### 单测

```bash
npx jest --testPathPattern="lexicon-v2/(lru-bucket-cache|lexicon-runtime-v2)"
```

---

## Phase 2 — Session Intent SSOT

### 新增 / 扩展

- `LexiconSessionIntent`（`session-runtime/types.ts`）
- `lexicon-session-intent.ts` — `topicKeywords` 规范化 + `topicKeywordPinyinKeys`（Node 侧 `textToSyllables` + `syllablesKey`）
- `lexicon-profile-decision-parser.ts` — 解析 `topicKeywords`
- `services/lexicon_intent_cpu/prompt_templates.py` — schema 增加 `topicKeywords`
- `session-finalize.ts` — Intent 回调写入 `lexiconSessionIntent`（双写 `lexiconIntentSummary`）
- `turn-profile-binding.ts` — turn 内绑定 `turnLexiconSessionIntent` → JobContext
- `session-migration.ts` / `session-result-extra.ts` — 迁移与 observability

### Feature Flags

```json
{
  "features": {
    "lexiconV2": {
      "enabled": true,
      "sessionIntentWriteEnabled": true
    }
  }
}
```

`sessionIntentWriteEnabled` 依赖 `lexiconV2.enabled=true`；**默认 false**，不影响现有行为。

### 写入链

```
finalize turn → scheduleIntentJob → CPU LLM
  → parseLexiconProfileDecision (+ topicKeywords)
  → buildLexiconSessionIntentFromDecision
  → session.lexiconSessionIntent
下一 turn beginSessionTurnProfile → bind 到 JobContext（Phase 3 前 FW 不读取）
```

### 单测

```bash
npx jest --testPathPattern="lexicon-session-intent|lexicon-profile-decision-parser|session-finalize"
```

---

## 暂停点（勿跳过）

Phase 2 完成后 **暂停验证**，再进入 Phase 3（`local-span-recall.ts` 切换 V2 lookup）。  
Phase 3 前 **禁止** 修改 `local-span-recall.ts` / FW recall 路径。

---

## 验收清单

- [x] P1：`LexiconRuntimeV2.load()` + base/idiom/domain/routing 查询
- [x] P1：LRU bucket cache
- [x] P1：不接 FW
- [x] P2：`LexiconSessionIntent` 类型 + Session 写入
- [x] P2：prompt / parser 扩展 `topicKeywords`
- [x] P2：turn 绑定 + migration + result.extra
- [x] P2：Recall 仍 V1
