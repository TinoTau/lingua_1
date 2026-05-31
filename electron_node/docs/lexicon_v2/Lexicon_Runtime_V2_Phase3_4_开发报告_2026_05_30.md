# Lexicon Runtime V2 — Phase 3/4 开发报告

版本：V1.1  
日期：2026-05-30

## 状态

| Phase | 实现 | Flag | 批测 |
|-------|------|------|------|
| Phase 3 — V2 Recall | ✅ | `features.fwDetector.useLexiconRuntimeV2Recall` | 见测试报告（部分完成） |
| Phase 4 — Industry Routing | ✅ | `features.fwDetector.useIndustryRouting` | 同上 |

前置：`features.lexiconRuntimeV2.enabled=true`。

---

## Phase 3 — V2 Recall

### 目标

仅替换 Recall 数据源（base + domain + idiom），不改变 FW 决策链与 `LocalSpanRecallHit` 契约。

### 新增模块

| 文件 | 职责 |
|------|------|
| `lexicon-v2/domain-recall-merge.ts` | profile → domain_lexicon 查询域 |
| `lexicon-v2/recall-span-topk-v2.ts` | 三表召回 + V1 等价评分 |
| `lexicon-v2/runtime-v2-recall-adapter.ts` | V2→LocalSpanRecallHit；Latin 仍 V1 |
| `lexicon-v2/lexicon-fw-recall-config.ts` | Flag 读取 |

### 修改

| 文件 | 变更 |
|------|------|
| `lexicon/local-span-recall.ts` | V1/V2 分支；base/idiom tier 跳过 general 域误杀 |
| `node-config-types.ts` / `node-config-defaults.ts` | 新增 Flag |

### Recall 规则

- 无有效 Session 域 → base only
- 有 primaryDomain → base + domain
- 有 secondaryDomains → base + primary + secondary
- 4 字 span → 额外 idiom_lexicon
- topicKeywords **不参与**候选评分（Phase 4 仅定域）

---

## Phase 4 — Industry Routing

### 新增

| 文件 | 职责 |
|------|------|
| `lexicon-v2/industry-routing-domain-resolver.ts` | LLM → routing → anchor → enabledDomains |
| `lexicon-v2/lexicon-recall-context.ts` | AsyncLocalStorage 传递 Session Intent |

### 修改

| 文件 | 变更 |
|------|------|
| `fw-detector/fw-detector-orchestrator.ts` | `runWithLexiconRecallContext` 注入 intent |

---

## 单测与构建

| 项 | 结果 |
|----|------|
| `npm run build:main` | ✅ |
| `domain-recall-merge.test.ts` | ✅ |
| `industry-routing-domain-resolver.test.ts` | ✅ |
| `recall-span-topk-v2.test.ts` | ✅（bundle 不可用时 skip） |
| `local-span-recall.test.ts` | ✅ |

---

## dialog_200 批测（进行中 → 中断）

| 项 | 值 |
|----|-----|
| 脚本 | `tests/run-lexicon-v2-phase3-dialog200-batch.js` |
| 日志 | `tests/phase3-dialog200-run.log` |
| 已完成 | **188 / 200**（d001–d188） |
| 契约 | **188 PASS / 0 FAIL** |
| 中断原因 | 进程结束于 d188，未跑 d189–d200，未执行 Intent drain，未写完整 JSON |
| 摘要 | `tests/lexicon-v2-phase3-dialog200-batch-partial-summary.json` |

**说明：** CPU LLM Intent **不阻塞** pipeline；批测末尾 240s drain 仅用于 Intent 统计，非 Phase 3 主链验收必需。后续回归建议 `--intent-drain-sec 0` 或禁用 Intent 测 FW/V2 Recall。

---

## 主链冻结确认

未修改：`fw-topk-decision-pipeline.ts`、`suspicious-span-detector-v1.ts`、`apply-span-replacements.ts`、`kenlm-span-gate.ts`、`segmentForJobResult`、Aggregation / Dedup / Translation 顺序。

---

## 回滚

```json
"features": {
  "fwDetector": {
    "useLexiconRuntimeV2Recall": false,
    "useIndustryRouting": false
  }
}
```
