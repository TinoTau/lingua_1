# Lexicon Runtime V2 — P4 测试报告（dialog_200 · domain_patch 灌库后）

版本：V1.0  
日期：2026-05-31  
**范围：** P4 Sentence Rerank + V2 Recall；V2 bundle **含 domain_lexicon=25**  
**音频集：** `D:\Programs\github\lingua_1\test wav\dialog_200`  
**完成度：** **200 / 200**（墙钟 **522 s**，未触发 15 min 上限）

原始数据：

- `electron_node/electron-node/tests/lexicon-v2-p4-batch-result.json`
- `electron_node/electron-node/tests/lexicon-v2-p4-quality-perf.json`
- `electron_node/electron-node/tests/lexicon-v2-p4-batch-run.log`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 清理 | `cleanup_orphaned_processes_simple.ps1` |
| 构建 | `npm run build:main` |
| 配置 | `tests/patch-p4-config.mjs` |
| V2 bundle | `node_runtime/lexicon/v2_shadow`（**schema v2**，**domain=25**） |
| 节点 | Electron @ **5020**（`domain:25` 启动日志） |
| ASR | faster-whisper-vad（CUDA） |
| FW | `useSentenceLevelRerank=true`，`minDeltaToReplace=0.03` |
| Span Gate | `fw_metadata_gate` |
| Intent | **关**（`lexicon_v2_intent_enabled=false`） |
| 批测 | `node tests/run-lexicon-v2-p4-batch.js --max-minutes 15` |
| 分析 | `node tests/analyze-p4-audit.mjs` |

---

## 2. 主链契约

**结论：** **200 / 200 PASS**（`pipeline_ok_rate = 1.0`）

| 指标 | 值 |
|------|-----|
| pass / fail / skip | **200 / 0 / 0** |
| `fw_applied_total` | **1** |
| `text_changed_count` | **1** |
| `sentence_rerank_jobs` | **39** |
| `picked_raw_count` | **38** |
| `picked_candidate_count` | **1** |
| 墙钟 | **522 s**（**2.61 s/case**） |

唯一 apply：**d043**（`pickedIsRaw=false`，与 domain=0 轮次相同）

---

## 3. domain_lexicon 与 Recall 观测

| 项 | Build/SQLite | P4 批测 Runtime |
|----|--------------|-----------------|
| domain_lexicon 行数 | **25**（restaurant） | Runtime 加载 **domain=25** ✅ |
| span recall 次数 | — | **42** |
| `domain_hits > 0` | — | **0** |
| `active_domain` | — | **base_only: 42** |

**说明：** 专业词已在 SQLite，但批测配置为 general profile + Intent 关，Recall **不发起** domain SQL；与灌库前 `domain_hits=0` 现象一致，**非 build 回退**。

---

## 4. Sentence Rerank

| 指标 | 值 |
|------|-----|
| rerank jobs | 39 |
| picked raw | 38 |
| picked candidate + apply | 1（d043） |
| combination P95 | **3**（cap=16） |
| KenLM batch 句数 P95 | **4** |
| perSpanLimit P50 | **8** |

---

## 5. 识别质量（相对 manifest 参考文本）

归一化字符级 CER（200 条全量）

| 指标 | raw ASR | FW 后 |
|------|---------|-------|
| **平均 CER** | **36.19%** | **36.17%** |
| 中位 CER | 26.67% | 26.67% |
| P95 CER | 88.00% | 88.00% |
| FW 改善 | — | **1** |
| FW 劣化 | — | **0** |
| 不变 | — | **199** |

### 5.1 历史对照

| 轮次 | domain 表 | avg CER final | FW apply | improve / degrade | pipeline P95 |
|------|-----------|---------------|----------|-------------------|--------------|
| Phase 2 | 0 | 35.93% | 10 | — | 7458 ms |
| P3.3 | 0 | 36.35% | 24 | 5 / 14 | 4096 ms |
| P4（domain=0） | 0 | 35.94% | 1 | 1 / 0 | 4261 ms |
| **P4（domain=25）** | **25** | **36.17%** | **1** | **1 / 0** | **4337 ms** |

**解读：** 灌库后 CER / apply **与 domain=0 轮次实质相同**（仍仅 d043 apply）；`minDelta=0.03` 仍过保守；Intent 未开导致 domain recall 未参与。

---

## 6. 端到端性能

| 指标 | avg | p50 | p95 | p99 | max |
|------|-----|-----|-----|-----|-----|
| `pipeline_ms` | 2608 | 2270 | **4337** | 6148 | 11912 |
| `fw_detector_step_ms` | 174 | 0 | 1319 | 2653 | 3048 |
| KenLM 句级 rerank ms | 172 | 0 | 1312 | 2645 | 3041 |
| `fw_metadata_gate_ms` | 0 | 0 | 1 | 1 | 3 |

### 6.1 与 P3.3 / P4(domain=0) 对照

| 指标 | P3.3 | P4 domain=0 | **P4 domain=25** |
|------|------|-------------|------------------|
| pipeline P95 | 4096 ms | 4261 ms | **4337 ms** |
| vs P3.3 | — | +4.0% | **+5.9%**（仍 <10% 预算） |
| FW apply | 24 | 1 | **1** |

---

## 7. 验收对照

| 验收项 | 目标 | 实测 | 判定 |
|--------|------|------|------|
| dialog_200 PASS | 契约通过 | **200/200** | ✅ |
| 15 min 内尽可能多测 | ≤15 min | **200 条 / 522 s** | ✅ |
| pipeline P95 ≤ +10% vs P3.3 | ≤4506 ms | **4337 ms** | ✅ |
| domain_lexicon 有数据 | >0 | **25** | ✅ |
| domain_hits 在 general 批测 | 可能为 0 | **0** | ⚠️ 符合当前配置 |
| CER 改善 | 期望 | +0.02 pp，1 improve | ⚠️ 与灌库前持平 |
| KenLM batch ≤17 | 是 | P95 **4** | ✅ |

---

## 8. 结论

1. **Build 灌库有效：** Runtime 确认 `domain=25`；manifest `seed_inputs` 含 `domain_patch_zh_v2`。
2. **P4 主链稳定：** 200/200 PASS；性能 P95 +5.9% vs P3.3，在预算内。
3. **质量未因灌库变化：** apply 仍 1 次；`domain_hits=0` 因 **Intent 关 + general profile**，非 SQLite 缺失。
4. **下一步（非本轮）：** 开启 Intent/restaurant profile 或 Industry Routing 后复测 domain recall 与 apply 增益。

---

**测试完成。**
