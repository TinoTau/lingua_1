# Lexicon Runtime V2 — P3.3 FW Metadata Span Gate 测试报告（dialog_200）

版本：V1.0  
日期：2026-05-31  
**范围：** P3.3 FW Metadata Span Gate + V2 Recall（Industry Routing **关**）  
**音频集：** `D:\Programs\github\lingua_1\test wav\dialog_200`  
**完成度：** **200 / 200**（墙钟 **516 s**，低于 **15 min** 上限）

原始数据：

- `electron_node/electron-node/tests/lexicon-v2-phase3-p33-batch-result.json`
- `electron_node/electron-node/tests/lexicon-v2-phase3-p33-quality-perf.json`
- `electron_node/electron-node/tests/lexicon-v2-phase3-p33-batch-run.log`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 清理 | `cleanup_orphaned_processes_simple.ps1` |
| 构建 | `npm run build` |
| 节点 | `start_electron_node.ps1`，health @ **5020** |
| ASR | `faster-whisper-vad` @ **6007**（CUDA，`word_timestamps=True`） |
| FW | `fw_detector_v1`，`spanGateMode=fw_metadata_gate` |
| KenLM Span Gate | **disabled**（`kenlmSpanGate.enabled=false`） |
| V2 Recall | `useLexiconRuntimeV2Recall=true`，SQL LIMIT **2/3/0** |
| Industry Routing | **false** |
| Intent | 批测关闭（`lexicon_v2_intent_enabled=false`） |
| 批测命令 | `node tests/run-lexicon-v2-phase3-p33-batch.js --max-minutes 15` |
| 分析命令 | `node tests/analyze-phase3-p33-audit.mjs` |
| 墙钟耗时 | **516 s**（8.6 min） |
| 均 case 墙钟 | **2.58 s/case** |

**批测前修复：** `utterance_asr.py` 修复 `'SegmentInfo' object has no attribute 'get'`（上一轮 200/200 ERROR 根因）。

---

## 2. 主链契约

**结论：** **200 / 200 PASS**（`pipeline_ok_rate = 1.0`）

| 指标 | 值 |
|------|------|
| 已完成 / 计划 | **200 / 200** |
| pass / fail / skip | **200 / 0 / 0** |
| `fw_applied_total` | **24** |
| `text_changed_count` | **23** |
| `industry_routing_used_count` | **0** |
| `merge_cap_violations` | **0** |
| `fw_degrade`（契约层） | **0** |

含 span 的 job：**~38** 条（其中 **3** 条 span=2：d002、d064、d119）。

---

## 3. Span Gate 效果

| 指标 | P3.3（200 job） | P3.2（63 job） | Phase 3 Hotfix（199 job） |
|------|-----------------|----------------|---------------------------|
| span/job P95 / max | **1 / 2** | 1 / 2 | ~12 / ~12 |
| span recall 调用 | **41** | 13 | **2298** |
| KenLM **gate** query | **0** | ~21/job avg | — |
| FW apply | **24** | **0** | **680** |

### 3.1 Metadata Gate 性能

| 指标 | avg | p50 | p95 | max |
|------|-----|-----|-----|-----|
| `fw_metadata_gate_ms` | **0** | 0 | **1** | **3** |
| `fw_metadata_gate_word_count`（有 metadata 的 job） | ~24 | — | — | — |

对比 P3.2：`kenlm_span_gate_ms` avg **11906 ms** → P3.3 gate 开销 **可忽略**。

### 3.2 Recall / Veto 链路

| 指标 | avg | p50 | p95 | max |
|------|-----|-----|-----|-----|
| `v2_recall_ms`（41 次 span recall） | 1 | 1 | 3 | 3 |
| `kenlm_veto_ms` | 164 | 0 | 1280 | 2470 |
| `kenlm_veto_query_count` / job | 0 | 0 | 2 | 4 |
| merge 后候选数 | 1 | 1 | 2 | 2 |

---

## 4. 识别质量（相对 manifest 参考文本）

归一化字符级 CER（`analyze-phase3-p33-audit.mjs`，**200 条全量**）。

| 指标 | raw ASR | FW 后 text_asr |
|------|---------|----------------|
| 平均 CER | **36.02%** | **36.35%** |
| 中位 CER | 26.32% | 26.67% |
| P95 CER | 88.00% | 88.00% |
| FW 改善 case | — | **5** |
| FW 劣化 case | — | **14** |
| 不变 case | — | **181** |

### 4.1 与历史轮次对照

| 轮次 | 样本量 | avg CER final | FW apply | fw_degraded | pipeline P95 |
|------|--------|---------------|----------|-------------|--------------|
| Phase 2 | 200 | **35.93%** | 10 | 0 | 7458 ms |
| Phase 3 Hotfix | 199 | **51.62%** | 680 | 162 | 20672 ms |
| P3.2 KenLM gate | 63 | **37.73%** | 0 | 0 | 16060 ms |
| **P3.3 Metadata gate** | **200** | **36.35%** | **24** | **14** | **4096 ms** |

**解读：**

- 相对 Hotfix，CER **回落 15.3 pp**，apply 从 680 降至 24，Span Explosion 与大规模误修已消除。
- 相对 Phase 2，CER 略高 **0.42 pp**，但 apply 更多（24 vs 10）；5 条改善 vs 14 条劣化，净质量略负。
- 相对 P3.2，在 **全量 200 条** 下恢复有限修复（24 apply），且 pipeline P95 **降 75%**（16060 → 4096 ms）。

---

## 5. 端到端性能

| 指标 | avg | p50 | p95 | p99 | max |
|------|-----|-----|-----|-----|-----|
| `pipeline_ms` | 2576 | 2321 | **4096** | 5098 | 12201 |
| `fw_detector_step_ms` | 166 | 0 | 1289 | 2047 | 2483 |
| ASR 墙钟（batch avg） | — | — | — | — | **2.58 s/case** |

### 5.1 与历史 pipeline P95 对比

| 轮次 | pipeline P95 |
|------|--------------|
| Phase 2 | 7458 ms |
| Phase 3 Hotfix | 20672 ms |
| P3.2 KenLM gate | 16060 ms |
| **P3.3 Metadata gate** | **4096 ms** |

P3.3 在消除 KenLM span gate 固定开销后，**全链路 P95 优于 Phase 2**，为当前 Phase 3 方案中性能最优配置。

### 5.2 长尾

- **d067**：`pipeline_ms=12201`（ASR 侧异常慢，gate/veto 仍正常）。
- 含 span + apply 的 job：`fw_detector_step_ms` 通常 **1.2–2.5 s**（主要为 KenLM weak_veto，非 metadata gate）。

---

## 6. 典型观测

| 类型 | 样例 | 说明 |
|------|------|------|
| 0 span 快路径 | 多数 job（~162） | `fw_metadata_gate_ms=0`，`fw_detector_step_ms=0` |
| alias 触发 span | d002（span=2） | `aliasHitCount>0`，进入 V2 recall |
| 有 apply | 24 job | 如 tech/restaurant 场景同音替换 |
| alignment 告警 | d001 等 | `alignmentFailures=9`，gate 仍 `all_signals_normal` → 0 span |
| 劣化 | 14 job | 需后续个案审计 veto/候选 |

---

## 7. 测试结论

| 维度 | 判定 |
|------|------|
| 主链契约 | ✅ **200/200 PASS** |
| Span 预算 | ✅ max **2**，KenLM gate query **0** |
| 性能 | ✅ pipeline P95 **4096 ms**（优于 P3.2 / Phase 2） |
| 质量 | ⚠️ avg CER **36.35%**（略差 Phase 2 **0.42 pp**；14 条劣化） |
| 修复收益 | ✅ **24 apply**，5 条 CER 改善（P3.2 为 0） |

**总评：** P3.3 FW Metadata Span Gate **可作为 Phase 3 默认 span 入口**——在保持 span≤2 与契约全绿的前提下，同时解决 P3.2 的性能否决项，并恢复有限词库修复能力。后续重点为 **14 条劣化 case** 的 veto/候选审计，而非回退 KenLM span gate。

---

## 8. 复现命令

```powershell
cd D:\Programs\github\lingua_1
.\scripts\cleanup_orphaned_processes_simple.ps1
cd electron_node\electron-node
npm run build
cd D:\Programs\github\lingua_1
.\scripts\start_electron_node.ps1
# 等待 5020 / 6007 health OK 后：
cd electron_node\electron-node
node tests/run-lexicon-v2-phase3-p33-batch.js --max-minutes 15
node tests/analyze-phase3-p33-audit.mjs
```
