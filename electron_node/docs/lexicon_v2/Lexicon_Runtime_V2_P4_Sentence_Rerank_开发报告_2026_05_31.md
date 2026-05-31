# Lexicon Runtime V2 — P4 Sentence-Level Rerank + Tone Pinyin 开发报告

版本：V1.0  
日期：2026-05-31  
依据：`P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_V1_1.md`

---

## 1. 开发目标

将 P3.3 **per-span greedy pick + KenLM weak_veto** 替换为 **句级 KenLM rerank**，并引入 **Tone Pinyin 排序**（不过滤）与 **V2 recall 合计 limit**。

目标流程：

```text
Metadata Span Gate（不变）
→ recallSpanCandidateSets（V2，domain>alias>base 合计 limit）
→ buildSentenceCandidates（笛卡尔积，cap=16）
→ rerankFwSentenceCandidates（KenLM batch，raw 必入，minDelta）
→ applyFwSpanReplacements（不变）
```

回滚：`useSentenceLevelRerank=false` → 保留 P3.3 `runFwTopKDecisionPipeline`。

---

## 2. 修改文件列表

| 层级 | 文件 | 变更摘要 |
|------|------|----------|
| FW 主链 | `fw-sentence-rerank-pipeline.ts` | **新增** P4 编排 |
| | `build-sentence-candidates.ts` | **新增** 多 span 笛卡尔积 |
| | `rerank-fw-sentences.ts` | **新增** 单 batch KenLM + minDelta |
| | `map-sentence-to-approved.ts` | **新增** 句级 winner → approved |
| | `per-span-candidate-limit.ts` | **新增** 8/4/2 动态 limit |
| | `fw-detector-orchestrator.ts` | flag 切换 P3.3 / P4 |
| | `fw-config.ts` / `node-config-*` | maxSpans=4、P4 参数、回滚开关 |
| | `types.ts` | `sentenceRerank` diagnostics |
| Recall | `recall-span-topk-v2.ts` | 合计 limit merge（perSpanLimit 路径） |
| | `merge-span-candidates.ts` | **新增** domain>alias>base |
| | `runtime-v2-recall-adapter.ts` | tonePinyinKey、perSpanLimit 透传 |
| | `local-span-recall.ts` | `LocalSpanRecallOptions` |
| Tone | `lexicon/phonetic/tone-pinyin.ts` | **新增** toneDistance |
| V2 Runtime | `lexicon-runtime-v2.ts` | tone 列 + v1/v2 schema 兼容 |
| | `hotword-types.ts` | isAlias、tonePinyinKey |
| Build | `build-v2-shadow-bundle.mjs` | schema v2 + tone_pinyin_key |
| | `v2-pinyin-key.mjs` / `v2-materialize-aliases.mjs` | tone key 生成 |
| Tests | `fw-sentence-rerank-p4.test.ts` | P4 单测 |
| | `run-lexicon-v2-p4-batch.js` | dialog_200 批测 |
| | `analyze-p4-audit.mjs` | 质量/性能分析 |
| Docs | `P4_开发冻结方案_V1_1.md` | 合并补充清单 SSOT |

**未修改（冻结）：** Metadata Span Gate、`applyFwSpanReplacements`、CTC/Recover 主链

---

## 3. 批测前环境处理

| 项 | 处理 |
|----|------|
| V2 bundle 仍为 v1 schema | runtime 兼容 v1/v2；tone 列在 v1 下为空 |
| `better-sqlite3` rebuild 失败 | 未重建 v2 bundle；批测使用现有 v1 bundle |
| APPDATA 配置 | `patch-p4-config.mjs` 写入 P4 参数 |
| ASR 冷启动 | 首轮 d001–d070 失败；`retry-p4-failed-batch.js` 补跑合并 |

---

## 4. 冻结约束落实情况

| 约束 | 状态 |
|------|------|
| Metadata Gate 保留 | ✅ |
| 句级单 batch KenLM（≤17） | ✅（39 次 rerank job，batch 2–4 句） |
| 移除 per-span weak_veto（P4 路径） | ✅ |
| `minDeltaToReplace` + raw 保护 | ✅（38/39 job 选 raw） |
| `candidateRequireRepairTarget` | ✅ |
| maxSpans=4 | ✅ 配置已写入 |
| domain>alias>base 合计 limit | ✅ 代码已实现；**domain_lexicon 仍 0 行** |
| tone_pinyin_key build | ⚠️ schema 脚本已改，bundle 未重建 |
| useSentenceLevelRerank 回滚 | ✅ |

---

## 5. 默认配置（批测）

```json
{
  "spanGateMode": "fw_metadata_gate",
  "kenlmSpanGate": { "enabled": false },
  "maxSpans": 4,
  "useLexiconRuntimeV2Recall": true,
  "useIndustryRouting": false,
  "useSentenceLevelRerank": true,
  "maxSentenceCandidates": 16,
  "minDeltaToReplace": 0.03
}
```

---

## 6. 批测结论摘要（详见测试报告）

| 指标 | P4 | P3.3 基线 |
|------|-----|-----------|
| dialog_200 PASS | **200/200** | 200/200 |
| FW apply | **1** | 24 |
| avg CER final | **35.94%** | 36.35% |
| FW improve / degrade | **1 / 0** | 5 / 14 |
| pipeline P95 | **4261 ms** | 4096 ms |

**解读：**

- P4 主链与 diagnostics **工作正常**；`minDeltaToReplace=0.03` 使绝大多数 span job **保留 raw**（38/39 pickedIsRaw）。
- 仅 **d043** 通过句级 rerank apply（maxDelta≈0.031，刚好过阈值），CER 改善 1 条、劣化 0 条。
- apply 从 24 降至 1 → **误修风险大幅下降**，但未达到「更多 improve」的 P4 质量目标。
- 性能 P95 较 P3.3 **+4%**，在冻结「不劣化 >10%」内。

---

## 7. 后续建议（非本轮范围）

1. **P1 灌库**：重建 `lexicon-v2-shadow-v2` bundle（tone + domain 行）
2. **minDelta 标定**：0.03 对短句过严；可试 0.01–0.02 或 near-tie guardrail
3. **P3.4-A RepairTarget**：与 rerank 并行，扩大正确候选池
4. **批测脚本**：启动前等待 ASR ready，避免冷启动丢 70 条

---

**开发完成。原始数据见测试报告。**
