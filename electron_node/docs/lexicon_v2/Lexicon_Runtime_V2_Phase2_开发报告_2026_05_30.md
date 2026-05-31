# Lexicon Runtime V2 — Phase 2 开发报告（Session Intent SSOT）

版本：V1.1  
日期：2026-05-30  
范围：Phase 2 — CPU LLM Intent → `lexiconSessionIntent` 写入链

---

## 1. 交付摘要

| 项 | 状态 |
|----|------|
| `LexiconSessionIntent` 类型与 Session 字段 | ✅ |
| LLM `topicKeywords` prompt / parser | ✅ |
| Node 侧 `topicKeywordPinyinKeys` | ✅ |
| `session-finalize` 双写 + turn 绑定 | ✅ |
| migration / result.extra 扩展 | ✅ |
| Worker 超时与配置对齐 | ✅（本轮回修） |
| FW Recall 切换 | ❌ 未做（Phase 3） |

---

## 2. 本轮回修

### 2.1 Intent Worker 超时

**问题：** `cpu-intent-llm-worker.ts` 固定 8s 超时，CPU LLM 推理 ~5–8s，导致 `inference_timeout`，Session 无法写入。

**修复：** Worker 超时改为 `timeoutMs + 1000`（配置默认 45s）。

### 2.2 批测脚本

| 脚本 | 用途 |
|------|------|
| `tests/run-lexicon-v2-phase2-dialog200-batch.js` | dialog_200 全量 + Intent drain + Session 统计 |
| `tests/analyze-phase2-dialog200-quality-perf.mjs` | CER / pipeline 性能分析 |
| `tests/run-lexicon-v2-phase2-intent-e2e.js` | 单 session 单 turn Intent 写入验收 |

### 2.3 运行配置（批测）

```json
{
  "features": {
    "lexiconV2": {
      "enabled": true,
      "sessionIntentWriteEnabled": true,
      "intentEnabled": true,
      "cpuWorker": { "timeoutMs": 45000 }
    },
    "lexiconRuntimeV2": { "enabled": true }
  },
  "servicePreferences": {
    "faster-whisper-vad": true,
    "lexicon-intent-cpu": true
  }
}
```

---

## 3. 写入链（已实现）

```text
finalize turn → shouldScheduleIntentJob (bootstrap/interval/…)
  → enqueueIntentJob → POST /intent
  → parseLexiconProfileDecision (+ topicKeywords)
  → buildLexiconSessionIntentFromDecision (+ pinyin keys)
  → session.lexiconSessionIntent
下一 turn → turnLexiconSessionIntent → JobContext（Phase 3 前 FW 不读）
```

---

## 4. 单元测试

| 套件 | 结果 |
|------|------|
| `lexicon-session-intent.test.ts` | PASS |
| `lexicon-profile-decision-parser.test.ts` | PASS |
| `run-lexicon-v2-phase2-intent-e2e.js` | **PASS**（单 turn 写入验证） |

---

## 5. 已知限制

1. **Intent Worker latest-only：** 200 条串行批测时，约 50% session 因 `skipped_by_debounce` 未写入 Intent（队列替换）；单 session E2E 100% 写入。
2. **topicKeywords 质量：** 可能包含 ASR 噪声词（如「深便温」），需 Phase 4 前靠 Node 校验/fallback 优化。
3. **unknown_domain：** 部分 LLM 输出 domain 不在 registry，parser 丢弃 decision（19/200 session）。

---

## 6. 结论

Phase 2 **Session Intent SSOT 链路已打通**；dialog_200 批测 **200/200 主链 PASS**，Intent 写入 **100/200**（队列策略所致，非功能缺陷）。单 session E2E **PASS**。

详细数据见：`Lexicon_Runtime_V2_Phase2_测试报告_dialog200_200_2026_05_30.md`
