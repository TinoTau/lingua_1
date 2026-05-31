# Lexicon Runtime V2 — P3.2 KenLM Span Gate 测试报告（dialog_200 限时批测）

版本：V1.0  
日期：2026-05-30  
**范围：** P3.2 KenLM Span Gate + V2 Recall（Industry Routing **关**）  
**音频集：** `D:\Programs\github\lingua_1\test wav\dialog_200`  
**完成度：** **63 / 200**（墙钟上限 **15 min**，到限即停）

原始数据：

- `electron_node/electron-node/tests/lexicon-v2-phase3-p32-batch-result.json`
- `electron_node/electron-node/tests/lexicon-v2-phase3-p32-quality-perf.json`
- `electron_node/electron-node/tests/lexicon-v2-phase3-p32-batch-run.log`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 清理 | 结束上一轮批测进程 |
| 构建 | 节点已 `npm run build` 并启动 |
| 节点 | `start_electron_node.ps1`，health @ **5020** |
| ASR | `faster-whisper-vad` |
| FW | `fw_detector_v1`，`spanGateMode=kenlm_gate_filter` |
| V2 Recall | `useLexiconRuntimeV2Recall=true`，SQL LIMIT **2/3/0** |
| Industry Routing | **false** |
| Intent | 批测关闭（`lexicon_v2_intent_enabled=false`） |
| 批测命令 | `node tests/run-lexicon-v2-phase3-p32-batch.js --max-minutes 15` |
| 分析命令 | `node tests/analyze-phase3-p32-audit.mjs` |
| 墙钟耗时 | **900 s**（15.0 min） |
| 均 case 墙钟 | **14.29 s/case** |

---

## 2. 主链契约

**结论：** 已完成子集内 **63 / 63 PASS**（`pipeline_ok_rate = 1.0`）

| 指标 | 值 |
|------|------|
| 已完成 / 计划 | **63 / 200** |
| pass / fail / skip | **63 / 0 / 0** |
| 未执行 case | d064–d200（137 条，时间到限） |
| `fw_applied_total` | **0** |
| `text_changed_count` | **0** |
| `industry_routing_used_count` | **0** |
| `fw_degrade` | **0** |

含 span 的 case（11 条）：d006、d014、d015(2)、d016、d019、d022、d043(2)、d045、d051、d060、d061。

---

## 3. Span Gate 效果

| 指标 | P3.2（63 job） | Phase 3 Hotfix（199 job） | 变化 |
|------|----------------|---------------------------|------|
| span/job avg | **0.21** | ~11.5 | ↓ **98%** |
| span/job P95 | **1** | ~12 | ↓ |
| span/job max | **2** | ~12 | ✅ 满足 ≤2 |
| span recall 调用 | **13** | **2298** | ↓ **99.4%** |
| merge cap 违规 | **0** | **0** | — |

Gate 阶段 KenLM：

| 指标 | avg | p50 | p95 | min | max |
|------|-----|-----|-----|-----|-----|
| `kenlm_span_gate_ms` | 11906 | 12567 | 13099 | 638 | 13324 |
| `kenlm_span_gate_query_count` | 20 | 21 | 21 | 2 | 21 |

说明：即使 **0 span** 的 job 也执行 preFilter 窗口（最多 21 次 KenLM query），导致 FW detector 步骤 ~12 s 成为 pipeline 主耗时。

---

## 4. 识别质量（相对 manifest 参考文本）

归一化字符级 CER（`analyze-phase3-p32-audit.mjs`，**仅 63 条**）。

| 指标 | raw ASR | FW 后 text_asr |
|------|---------|----------------|
| 平均 CER | **37.73%** | **37.73%** |
| 中位 CER | 27.27% | 27.27% |
| P95 CER | 86.96% | 86.96% |
| FW 改善 case | — | **0** |
| FW 劣化 case | — | **0** |

### 4.1 与历史轮次对照

| 轮次 | 样本量 | avg CER final | FW apply | fw_degraded |
|------|--------|---------------|----------|-------------|
| Phase 2 | 200 | **35.93%** | 10 | 0 |
| Phase 3 Hotfix | 199 | **51.62%** | 680 | 162 |
| **P3.2（本轮）** | **63** | **37.73%** | **0** | **0** |

**解读：**

- P3.2 在已测 63 条上 **CER 与 raw 相同**，说明 gate 未产生错误 apply（Hotfix 劣化主因已消除）。
- 相对 Phase 2 全量 35.93%，本轮 37.73% **略高 1.8 pp**；样本仅前 63 条且 **无任何有益修复**（Phase 2 的 cafe 等同音修复未触发）。
- 相对 Hotfix 51.62%，质量 **显著回升**，验证 span 入口收紧有效。

---

## 5. 性能数据

### 5.1 Pipeline / FW 步骤

| 指标 | avg | p50 | p95 | p99 | min | max |
|------|-----|-----|-----|-----|-----|-----|
| `pipeline_ms` | 14289 | 14940 | **16060** | 16386 | 2865 | 16386 |
| `fw_detector_step_ms` | 11907 | 12567 | 13099 | 13324 | 645 | 13324 |
| `kenlm_span_gate_ms` | 11906 | 12567 | 13099 | 13324 | 638 | 13324 |
| `kenlm_veto_ms` | 0 | 0 | 0 | 0 | 0 | 0 |
| `v2_recall_ms`（13 次） | 1 | 1 | 3 | 3 | 1 | 3 |

### 5.2 与历史轮次对照

| 指标 | Phase 2（200） | Hotfix（200） | P3.2（63） |
|------|----------------|---------------|------------|
| pipeline P95 | **7458 ms** | **20672 ms** | **16060 ms** |
| pipeline avg | 4160 ms | 14267 ms | 14289 ms |
| KenLM 相关 avg | 低（legacy） | veto **9810 ms** | gate **11906 ms** |
| 批测墙钟 | 1074 s（含 Intent drain） | 2854 s | **900 s（限时）** |
| 均 case 墙钟 | — | 14.27 s | **14.29 s** |

**解读：**

- pipeline P95 较 Hotfix **↓ 22%**（20672 → 16060 ms），但仍约为 Phase 2 的 **2.2×**。
- veto 阶段 query = 0（无候选进入 weak_veto），KenLM 耗时 **全部集中在 span gate**。
- 单 case 墙钟 ~14.3 s，200 条全量预估 **~48 min**（不含启动/清理）。

---

## 6. Recall 链分层（有 span 的 13 次调用）

| 指标 | avg | P95 | max |
|------|-----|-----|-----|
| `candidate_count_after_merge` | 0 | 1 | 1 |
| `sent_to_kenlm`（veto 前） | 0 | 1 | 1 |
| `kenlm_veto_query_count` / job | 0 | 0 | 0 |

13 次 span 均未产生最终 apply；候选规模已被 Hotfix LIMIT 压住（≤1/span）。

---

## 7. 验收清单（P3.2 冻结标准）

| # | 标准 | 目标 | 实测 | 判定 |
|---|------|------|------|------|
| 1 | 契约 PASS | 200/200 | **63/63**（子集 100%） | ⚠️ 部分（时间限制） |
| 2 | span/job | ≤ 2 | max **2**，P95 **1** | ✅ |
| 3 | recall 调用下降 | ≥ 80% | **99.4%**（2298→13，同比例 extrap.） | ✅ |
| 4 | FW apply | ≤ 20 | **0** | ✅（偏保守） |
| 5 | fw_degrade | 0 | **0** | ✅ |
| 6 | CER | ≤ Phase 2 35.93% | **37.73%**（63 条） | ⚠️ 略超（无修复） |
| 7 | KenLM 总耗时 | < Hotfix | gate avg 11906 vs veto avg 9810 | ⚠️ 单 job 仍偏高* |

\*Hotfix 的 kenlm_ms 仅统计有 veto 的 job；P3.2 每条 job 均跑 gate。

---

## 8. 总结

1. **KenLM Span Gate 有效切断 Span Explosion**，recall 调用与 Hotfix 相比下降两个数量级，FW 错误 apply 归零。
2. **识别质量**在已测 63 条上回到 Hotfix 之前量级（~38% CER），显著优于 Hotfix 51.62%，但 **尚未恢复 Phase 2 的有益同音修复**。
3. **性能**：pipeline P95 较 Hotfix 改善，但 gate 对 **每条 job 固定 ~12 s KenLM 扫描** 仍是瓶颈；全量 200 条需约 48 min 墙钟。
4. **建议**：进入 P3.3 调 gate 阈值 + 0-span 快路径，并在时间允许时补跑 d064–d200 完成全量 CER 统计。

---

## 9. 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
node tests/run-lexicon-v2-phase3-p32-batch.js --max-minutes 15
node tests/analyze-phase3-p32-audit.mjs
```

全量（不限时）：

```powershell
node tests/run-lexicon-v2-phase3-p32-batch.js
```
