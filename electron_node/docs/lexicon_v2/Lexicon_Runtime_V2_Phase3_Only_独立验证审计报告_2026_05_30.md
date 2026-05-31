# Lexicon Runtime V2 — Phase 3 Only 独立验证审计报告

版本：V1.0  
日期：2026-05-30  
音频集：`D:\Programs\github\lingua_1\test wav\dialog_200`（**全量 200 条**）

原始数据：

- `electron_node/electron-node/tests/lexicon-v2-phase3-only-audit-batch-result.json`
- `electron_node/electron-node/tests/lexicon-v2-phase3-only-audit-quality-perf.json`
- `electron_node/electron-node/tests/phase3-only-audit-run.log`

---

## 1. 结论摘要

| 维度 | 结果 | 是否达标 |
|------|------|----------|
| 主链契约 200/200 | ✅ PASS | ✅ |
| Industry Routing 使用 | **0 次** | ✅ |
| FW 劣化 case | **158** | ❌（要求 0） |
| Recall P95 vs Phase 2 | +13347 ms | ❌（要求 ≤ +10%） |
| 墙钟 / case | **13.81 s** | ❌（Phase 2 ≈ 5.37 s） |

**责任边界结论：**

- **Phase 4 Industry Routing 不是本轮慢的主因**（`useIndustryRouting=false`，routing lookup **0 次**）。
- **Phase 3 V2 Recall 单独开启后，仍出现 ~14 s/case 级墙钟，且识别质量显著劣化**（final CER 35.93% → **51.57%**，FW 劣化 158 case）。
- **下一步应优先审计 LexiconRuntimeV2 Recall 候选规模 / KenLM 输入膨胀 / 错误 apply**，而非继续叠加 Phase 4。

---

## 2. Phase 3 Only 配置

```json
{
  "features": {
    "lexiconRuntimeV2": { "enabled": true },
    "lexiconV2": {
      "enabled": true,
      "sessionIntentWriteEnabled": true
    },
    "fwDetector": {
      "useLexiconRuntimeV2Recall": true,
      "useIndustryRouting": false
    }
  },
  "servicePreferences": {
    "faster-whisper-vad": true,
    "lexicon-intent-cpu": true
  }
}
```

批测：`node tests/run-lexicon-v2-phase3-only-audit-batch.js`（**intent-drain-sec=0**）

---

## 3. Recall 调用链审计

### 3.1 预期路径（Phase 3）

```text
base_lexicon + domain_lexicon + idiom_lexicon
  → merge + score（profile domain，非 topicKeywords）
  → KenLM weak_veto
  → pick
```

### 3.2 代码路径确认

| 审计项 | 结论 |
|--------|------|
| `useIndustryRouting=false` 时走 `resolveDomainIdsForRecall(profile)` | ✅ |
| `industry-routing-domain-resolver.ts` 未被调用 | ✅（批测 `industry_routing_used_count=0`） |
| `runWithLexiconRecallContext` 仍存在 | ✅（传递 sessionIntent，**不触发 routing**） |
| topicKeywords 参与 candidate score | ✅ **未参与**（评分仍走 `computeCandidateScoreBreakdown` + profile） |

### 3.3 与 Phase 4 路径隔离

**未出现：**

```text
topicKeywords → industry_routing → domain routing → recall
```

---

## 4. 主链契约

| 指标 | 值 |
|------|-----|
| pass / fail / skip | **200 / 0 / 0** |
| pipeline_ok_rate | 1.0 |
| lexicon_runtime（V1） | 契约 PASS |
| 批测墙钟 | **2763 s**（无 Intent drain） |
| 均 case 墙钟 | **13.81 s** |

---

## 5. 识别质量（CER）

| 指标 | raw ASR | FW 后 | Phase 2 对照 |
|------|---------|-------|--------------|
| 平均 CER | 36.19% | **51.57%** | 35.93% |
| 中位 CER | 26.67% | **47.37%** | 26.67% |
| P95 CER | 88.0% | 88.0% | 88.0% |
| FW 改善 | — | 25 | 9 |
| FW 劣化 | — | **158** | **0** |
| text_changed | — | **192/200** | 9/200 |
| fw_applied_total | — | **684** | 10 |

**质量审计结论：** V2 Recall 开启后 FW **大量误 apply**（684 次 vs Phase 2 的 10 次），导致 final CER **显著劣化**。主链契约 PASS **不能**掩盖质量回归。

---

## 6. 性能统计

### 6.1 Pipeline / FW / KenLM（ms）

| 指标 | avg | p50 | p95 | p99 | Phase 2 p95 |
|------|-----|-----|-----|-----|-------------|
| pipeline_total_ms | 13811 | 13905 | **20805** | 22039 | 7458 |
| fw_detector_total_ms | 10898 | 10900 | 18176 | 19603 | — |
| kenlm_ms | 11295 | 10875 | 18146 | 19980 | — |

| 对比 | Phase 2 | Phase 3+4（188 条部分） | Phase 3 Only |
|------|---------|-------------------------|--------------|
| 均墙钟 s/case | ≈5.37 | 14.45 | **13.81** |
| pipeline P95 | 7458 | — | **20805** |

**Recall P95 验收：** ❌ 未满足「≤ Phase 2 + 10%」

### 6.2 V2 Recall 细分诊断

环境变量 `LEXICON_RECALL_V2_DIAGNOSTICS=1` 在 Electron 主进程 **未生效**（批测结果中 `recall_v2_diagnostics` 全为 null），故以下字段 **本轮无实测值**：

- v2_recall_ms / domain_lookup_ms / idiom_lookup_ms / merge_ms
- SQL query count / cache hit rate

**旁证（来自 job 级数据）：**

- `fw_detector_step_ms` 与 `kenlm_ms` 高度相关（avg ~11s），KenLM 占 FW 步绝大部分时间。
- 单 case `kenlm_query_count` 显著高于 Phase 2（例：d001 = 9 次 query，Phase 2 规模更小）。
- 推测：**V2 召回候选数膨胀 → KenLM batch 变大 → pipeline 变慢**，而非 Industry Routing。

---

## 7. 三阶段对比

| 项 | Phase 2 | Phase 3+4（188 条） | Phase 3 Only（200 条） |
|----|---------|---------------------|------------------------|
| V2 Recall | off | on | on |
| Industry Routing | off | on | **off** |
| 契约 PASS | 200/200 | 188/188 | **200/200** |
| 均墙钟 s/case | ~5.4 | ~14.5 | **~13.8** |
| FW 劣化 | 0 | — | **158** |
| final CER avg | 35.93% | — | **51.57%** |
| routing 使用 | 0 | — | **0** |

**性能：** Phase 3 Only 与 Phase 3+4 墙钟接近 → **慢因主要在 Phase 3 V2 Recall 路径，而非 Phase 4 alone。**

**质量：** Phase 3 Only 劣化严重 → **问题在 V2 候选/apply 行为，非 routing 定域。**

---

## 8. 性能瓶颈分析（定位，未修）

按优先级：

1. **KenLM 候选规模膨胀**  
   - fw_applied 684、kenlm avg 11s、192/200 text_changed  
   - 对比 Phase 2：apply 10 次、kenlm 开销小得多  

2. **V2 base tier 域过滤变更**  
   - `local-span-recall.ts` 中 base/idiom `domains=[]` 不再被 `matchEnabledDomain(general)` 拒绝  
   - 可能导致 **大量 base 候选进入 KenLM**，需与 Phase 2 V1 recall 候选数对比  

3. **V2 SQL / LRU**  
   - 诊断 env 未生效，cache/SQL 次数待补测  
   - 即使 SQL 有开销，当前数据更指向 **KenLM 主导**（fw_step ≈ kenlm_ms）  

4. **Industry Routing**  
   - 本轮 **0 次**，可排除  

---

## 9. 验收标准对照

| 标准 | 要求 | 实际 |
|------|------|------|
| dialog_200 PASS | 200/200 | ✅ 200/200 |
| FW degrade | 0 | ❌ **158** |
| Industry Routing 使用 | 0 | ✅ **0** |
| Recall P95 ≤ Phase2+10% | ≤ ~8200 ms | ❌ **20805 ms** |

**Phase 3 独立验证结论：未达标。** 不应进入 Phase 4 生产启用或继续叠加 routing 优化，应先修复 V2 Recall 候选质量与 KenLM 输入规模。

---

## 10. 建议下一步（审计后，非本次实现）

1. 补跑诊断：确保 Electron 启动前 `LEXICON_RECALL_V2_DIAGNOSTICS=1` 写入进程 env，或改 config flag 触发 diagnostics。  
2. 对比 **同一 span** V1 vs V2 候选数量、KenLM query 数。  
3. 审查 base tier 无 domain 过滤后进入 KenLM 的候选是否过量。  
4. 在修复前 **保持 `useLexiconRuntimeV2Recall=false`** 生产默认。

---

## 11. 诊断 env 说明

批测脚本与 `npm start` 均设置了 `LEXICON_RECALL_V2_DIAGNOSTICS=1`，但 Electron 主进程未输出 `recallV2Diagnostics` 字段。可能原因：Electron 子进程未继承 env / 需写入 `electron-node-config` 或启动脚本显式传递。**不影响 routing=0 与 CER 结论，但 SQL/cache 细分待补采。**
