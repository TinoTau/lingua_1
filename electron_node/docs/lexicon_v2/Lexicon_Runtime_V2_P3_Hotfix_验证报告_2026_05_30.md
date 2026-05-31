# Lexicon Runtime V2 — P3 Hotfix 验证报告

版本：V1.0  
日期：2026-05-30  
批测：`dialog_200` · Phase 3 Only（`useLexiconRuntimeV2Recall=true`，`useIndustryRouting=false`）

---

## 1. 修改文件列表

| 文件 | 变更摘要 |
|------|----------|
| `main/src/lexicon-v2/lexicon-runtime-v2.ts` | Base/Domain/Idiom 查询增加 `ORDER BY prior_score DESC LIMIT ?`（SQL 层截断） |
| `main/src/lexicon-v2/lexicon-runtime-v2-config.ts` | `maxBaseCandidates` / `maxDomainCandidates` / `maxIdiomCandidates` + merge cap |
| `main/src/lexicon-v2/recall-span-topk-v2.ts` | 使用配置限额；merge 后 hard cap ≤5（idiom 启用时 ≤6） |
| `main/src/lexicon-v2/recall-v2-diagnostics.ts` | 新增分层诊断字段 + job 级 collector |
| `main/src/node-config-types.ts` | `lexiconRuntimeV2` 限额字段类型 |
| `main/src/node-config-defaults.ts` | 默认 2 / 3 / 0 |
| `main/src/fw-detector/fw-detector-orchestrator.ts` | 附加 `recallV2Diagnostics`（只读诊断，不改决策链） |
| `main/src/lexicon-v2/recall-hotfix.test.ts` | merge cap 单测 |
| `tests/run-lexicon-v2-phase3-only-audit-batch.js` | Hotfix 批测输出路径 |
| `tests/analyze-phase3-only-audit.mjs` | 分层候选 / KenLM / 对比统计 |

**未修改：** FW 主链、`kenlm-span-gate.ts`、Detector、Pick、Session Intent、Industry Routing 决策逻辑。

---

## 2. Feature Flags（本轮批测生效值）

```json
"lexiconRuntimeV2": {
  "maxBaseCandidates": 2,
  "maxDomainCandidates": 3,
  "maxIdiomCandidates": 0,
  "recallDiagnosticsEnabled": true
}
```

---

## 3. Recall 查询链（Hotfix 后）

```text
Suspicious Span (Detector，未改)
  ↓
base_lexicon     WHERE pinyin_key=? AND length(word)=?  ORDER BY prior_score DESC  LIMIT 2
domain_lexicon   WHERE domain_id=? AND pinyin_key=? …  LIMIT 3   （Phase 3 Only 未启用 routing，本轮 domain 命中 0）
idiom_lexicon    跳过（maxIdiomCandidates=0）
  ↓
mergeTierCandidates（hard cap = 2+3+0 = 5）
  ↓
score + phonetic filter + FW topK(3)
  ↓
KenLM weak_veto（未改）
  ↓
pick / apply（未改）
```

SQL 示例（Base）：

```sql
SELECT … FROM base_lexicon
WHERE pinyin_key = ? AND length(word) = ? AND enabled = 1
ORDER BY prior_score DESC
LIMIT 2
```

---

## 4. 每层候选数量（2298 次 span recall，199 条有效 job）

| 指标 | avg | P95 | max | 说明 |
|------|-----|-----|-----|------|
| `base_hits`（SQL 返回前） | — | — | 2 | 原始命中累计 1974 |
| `base_after_limit` | 0.86 | 2 | **2** | SQL LIMIT 生效 |
| `domain_after_limit` | 0 | 0 | 0 | Industry Routing 关闭 |
| `idiom_after_limit` | 0 | 0 | 0 | 默认关闭 |
| `candidate_count_before_merge` | 0.86 | 2 | 2 | |
| `candidate_count_after_merge` | 0.86 | 2 | **2** | merge cap 违规 **0** |
| `sent_to_kenlm`（每 span） | 1.00 | 2 | 2 | 进入 KenLM 的候选数 |

**验收项 `candidate_count_after_merge ≤ 5`：通过（max=2）。**

---

## 5. KenLM 输入数量

| 指标 | Hotfix | Pre-Hotfix | Phase 2 |
|------|--------|------------|---------|
| 每 span `sent_to_kenlm` P95 | **2** | 无诊断（推测 >>2） | N/A |
| 每 job `kenlm_query_count` avg | **13.0** | ~13（同量级） | 低 |
| 每 job `kenlm_query_count` P95 | **24** | 未单独统计 | 低 |
| `kenlm_ms` avg | **9810 ms** | **11295 ms** | ~低 |
| `kenlm_ms` P95 | **16690 ms** | **18146 ms** | ~7458 ms（pipeline） |

说明：

- **单 span 候选规模已压到 0–2**，KenLM 单 job 耗时下降约 **13%**。
- 但 **每 job KenLM query 次数仍 ~13**：主要因为 **可疑 span 数量多**（≈11.5 span/job），而非单 span 候选膨胀。
- Pre-hotfix 无 `sent_to_kenlm` 诊断；从 FW apply / CER 几乎不变推断：**瓶颈不在 SQL 返回行数 alone**。

---

## 6. FW apply 数量

| 轮次 | fw_applied_total | text_changed | fw_degraded_cases |
|------|------------------|--------------|-------------------|
| Phase 2 | 10 | — | 0 |
| Phase 3 Pre-Hotfix | **684** | 192 | 158 |
| **Phase 3 Hotfix** | **680** | 191 | 162 |

**FW apply 几乎无下降（−0.6%），验收未通过。**

---

## 7. CER 与质量

| 轮次 | avg CER (final) | median CER (final) | fw_improved | fw_degraded |
|------|-----------------|----------------------|-------------|-------------|
| Phase 2 | **35.93%** | — | — | 0 |
| Phase 3 Pre-Hotfix | **51.57%** | 47.37% | 25 | 158 |
| **Phase 3 Hotfix** | **51.62%** | 47.06% | 20 | 162 |

**CER 未优于 51.57%，验收未通过。**

---

## 8. 性能对比

| 指标 | Phase 2 | Pre-Hotfix | Hotfix | 变化 |
|------|---------|------------|--------|------|
| avg wall s/case | 5.37 | 13.81 | **14.27** | +3.3%（略慢，批测方差） |
| pipeline P95 ms | 7458 | 20805 | **20672** | −0.6% |
| fw_detector P95 ms | — | 18176 | **16758** | −7.8% |
| v2_recall P95 ms | — | N/A | **3** | SQL 层极快 |
| Recall P95 vs Phase2 | — | +13214 ms | **+13214 ms** | 仍远超 Phase2+10% |

**Pipeline P95 / Recall P95 未显著下降，验收未通过。**

---

## 9. 批测契约

| 项 | 值 |
|----|-----|
| 完成 | 200 / 200 |
| PASS | 199 |
| FAIL | 1（`d090`：ASR 空文本 / 无 fw_detector，属偶发 pipeline 失败，与 hotfix 无关） |
| batch 墙钟 | 2854 s（14.27 s/case） |
| Industry Routing 使用 | 0 |

原始数据：

- `tests/lexicon-v2-phase3-hotfix-audit-batch-result.json`
- `tests/lexicon-v2-phase3-hotfix-audit-quality-perf.json`

---

## 10. 验收标准对照

| 标准 | 结果 |
|------|------|
| `candidate_count_after_merge ≤ 5` | ✅ 通过（max=2，违规 0） |
| KenLM 输入数量显著下降 | ⚠️ 部分：`kenlm_ms` −13%，但 query/job 仍 ~13 |
| FW apply 明显下降 | ❌ 680 vs 684 |
| CER 优于 51.57% | ❌ 51.62% |
| Recall P95 显著下降 | ❌ pipeline P95 基本持平 |

---

## 11. 结论

### 已证实

1. **SQL LIMIT 2/3/0 正确生效**：merge 后候选 max=2，诊断字段完整，无 cap 违规。
2. **单 span 候选规模失控已被消除**；V2 Recall SQL 本身 P95=3ms，不是性能主因。

### 未证实（用户原假设）

> Recall Explosion **完全**来源于候选规模失控

Hotfix 后：

- FW apply 仍 ≈680（Phase 2 仅 10）
- CER 仍 ≈51.6%（Phase 2 35.9%）
- 每 job 仍有 ~11 个可疑 span 进入 Recall → KenLM

说明 **主要劣化来自「Recall 触发面过宽 + 低质量 base 候选仍能通过 KenLM/pick」**，而非 SQL 返回行数 alone。

### 建议下一步（P3.2）

在不改 FW 主链 / KenLM / Detector 的前提下，优先：

1. **热词质量评分 / prior 过滤**：限制低 prior、非 repair_target 候选进入 KenLM。
2. **Recall 触发条件收紧**（若后续允许动 Recall 入口）：减少 span 级 invocation。
3. **Domain tier 在 Phase 3 Only 未参与**；完整 Phase 3+4 需另跑一轮验证 domain LIMIT 3。

---

## 12. 诊断字段示例（d001 第二 span）

```json
{
  "base_hits": 2,
  "domain_hits": 0,
  "idiom_hits": 0,
  "base_after_limit": 2,
  "domain_after_limit": 0,
  "idiom_after_limit": 0,
  "candidate_count_before_merge": 2,
  "candidate_count_after_merge": 2,
  "sent_to_kenlm": 2
}
```

完整诊断挂载于 `fw_detector.recallV2Diagnostics`（Orchestrator 只读附加）。
