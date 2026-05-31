# Lexicon Runtime V2 — P4 Sentence Rerank 测试报告（dialog_200）

版本：V1.0  
日期：2026-05-31  
**范围：** P4 Sentence-Level Rerank + Tone Pinyin + V2 Recall（Industry Routing **关**）  
**音频集：** `D:\Programs\github\lingua_1\test wav\dialog_200`  
**完成度：** **200 / 200**（首轮 130 + 补跑 70；墙钟首轮 **361 s** + 补跑 **~208 s**）

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
| 配置 | `tests/patch-p4-config.mjs` → APPDATA |
| 节点 | `start_electron_node.ps1`，health @ **5020** |
| ASR | `faster-whisper-vad` @ **6007**（CUDA） |
| FW | `useSentenceLevelRerank=true`，`maxSpans=4` |
| Span Gate | `fw_metadata_gate`，KenLM Span Gate **disabled** |
| V2 Recall | `useLexiconRuntimeV2Recall=true`；bundle **v1 schema**（domain **0 行**） |
| 批测命令 | `node tests/run-lexicon-v2-p4-batch.js --max-minutes 15` |
| 补跑 | `node tests/retry-p4-failed-batch.js`（d001–d070 ASR 未就绪） |
| 分析 | `node tests/analyze-p4-audit.mjs` |

---

## 2. 主链契约

**结论：** **200 / 200 PASS**（补跑后 `pipeline_ok_rate = 1.0`）

| 指标 | 值 |
|------|-----|
| 已完成 / 计划 | **200 / 200** |
| pass / fail / skip | **200 / 0 / 0** |
| `fw_applied_total` | **1** |
| `text_changed_count` | **1** |
| `sentence_rerank_jobs` | **39** |
| `picked_raw_count` | **38** |
| `picked_candidate_count` | **1** |

**首轮异常：** d001–d070 报错 `No available ASR service`（ASR 服务尚未 ready）；补跑后全部 PASS。

---

## 3. Sentence Rerank 效果

| 指标 | 值 |
|------|-----|
| 含 span 且进入 rerank 的 job | **39** |
| pickedIsRaw（不 apply） | **38** |
| picked 候选句并 apply | **1**（**d043**） |
| combination P95 | **3**（cap=16） |
| KenLM batch 句数 P95 | **4**（含 raw，≤17 ✅） |
| perSpanLimit（单 span job） | **8** |

### 3.1 唯一 apply 样本（d043）

| 项 | 值 |
|----|-----|
| maxDelta | **0.0307**（阈值 0.03，刚过线） |
| 替换后文本 | `我们下午討論後` |
| kenlm batch | 2 句（raw + 1 候选） |
| pipeline_ms | ~1230 ms（FW 段） |

---

## 4. Span Gate

| 指标 | P95 / max |
|------|-----------|
| span/job | **1 / 2** |
| `fw_metadata_gate_ms` | **1 / 5 ms** |

与 P3.3 一致：Metadata Gate 开销可忽略。

---

## 5. 识别质量（相对 manifest 参考文本）

归一化字符级 CER（`analyze-p4-audit.mjs`，**200 条全量**）。

| 指标 | raw ASR | FW 后 text_asr |
|------|---------|----------------|
| 平均 CER | **35.96%** | **35.94%** |
| 中位 CER | 26.32% | 26.32% |
| P95 CER | 88.00% | 88.00% |
| FW 改善 case | — | **1** |
| FW 劣化 case | — | **0** |
| 不变 | — | **199** |

### 5.1 与历史轮次对照

| 轮次 | 样本量 | avg CER final | FW apply | improve / degrade | pipeline P95 |
|------|--------|---------------|----------|---------------------|--------------|
| Phase 2 | 200 | **35.93%** | 10 | — | 7458 ms |
| **P3.3 Metadata** | 200 | **36.35%** | 24 | 5 / 14 | 4096 ms |
| **P4 Sentence Rerank** | 200 | **35.94%** | **1** | **1 / 0** | **4261 ms** |

**解读：**

- CER 相对 P3.3 **略优 0.41 pp**，主要因 apply 极少（1 vs 24），几乎无劣化。
- 相对 Phase 2 CER **基本持平**（35.94% vs 35.93%），但 **未发挥 rerank 修错能力**（仅 1 次 apply）。
- `minDeltaToReplace=0.03` 使 38/39 rerank job 保留 raw；P3.3 中 14 条 degrade **在本轮为 0**。

---

## 6. 端到端性能

| 指标 | avg | p50 | p95 | p99 | max |
|------|-----|-----|-----|-----|-----|
| `pipeline_ms` | 2644 | 2312 | **4261** | 5738 | 14882 |
| `fw_detector_step_ms` | 180 | 0 | 1326 | 2545 | 2561 |
| KenLM 句级 rerank ms | 179 | 0 | 1321 | 2538 | 2556 |
| `fw_metadata_gate_ms` | 0 | 0 | 1 | 1 | 5 |
| 墙钟（首轮 200 条） | — | — | — | — | **361 s** |
| 均 case 墙钟 | **2.78 s/case** | — | — | — | — |

### 6.1 与 P3.3 性能对照

| 指标 | P3.3 | P4 | Δ |
|------|------|-----|---|
| pipeline P95 | 4096 ms | **4261 ms** | **+4.0%** ✅（<10%） |
| FW apply 次数 | 24 | 1 | **−96%** |
| KenLM 调用形态 | per-span weak_veto | 句级 batch | 单 job ≤4 句 |

---

## 7. 验收对照（冻结方案 §九）

| 验收项 | 目标 | 实测 | 判定 |
|--------|------|------|------|
| dialog_200 PASS | 200/200 | **200/200** | ✅ |
| pipeline P95 不劣化 >10% | ≤4500 ms | **4261 ms** | ✅ |
| KenLM batch ≤17 | 是 | max **4** 句/batch | ✅ |
| avg CER ≤ Phase2 或 degrade↓ | ≤35.93% 或 degrade↓ | 35.94%，degrade **0** | ⚠️ CER 平，apply 过少 |
| improve↑ degrade↓ vs P3.3 | 期望 | 1/0 vs 5/14 | ⚠️ improve 不足 |
| domain 词库 | 有数据 | **0 行** | ❌ 待 P1 rebuild |
| tone_pinyin_key | build 覆盖 | bundle **v1** 无列 | ❌ 待 rebuild |

---

## 8. 结论与建议

1. **主链可用**：P4 sentence rerank pipeline、diagnostics、回滚 flag 均已验证；200/200 契约 PASS。
2. **质量侧**：`minDeltaToReplace=0.03` **过保守**，apply 从 P3.3 的 24 降至 **1**；误修消除，但未达到「更多正确修复」目标。
3. **性能侧**：P95 +4%，满足冻结预算。
4. **数据侧**：V2 bundle 仍为 v1、无 domain/tone → rerank 能力未充分释放。
5. **批测流程**：需 **ASR ready 后再跑**，或批测脚本内加重试/预热。

**建议下一步：** 重建 v2 bundle → 标定 minDelta（0.01–0.02）→ 并行 P3.4-A RepairTarget → 复测 dialog_200。

---

**测试完成。**
