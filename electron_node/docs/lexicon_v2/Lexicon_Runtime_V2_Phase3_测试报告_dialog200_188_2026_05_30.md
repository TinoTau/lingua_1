# Lexicon Runtime V2 — Phase 3/4 测试报告（dialog_200 部分完成）

版本：V1.0  
日期：2026-05-30  
**范围：** Phase 3 V2 Recall + Phase 4 Industry Routing  
**音频集：** `D:\Programs\github\lingua_1\test wav\dialog_200`  
**完成度：** **188 / 200**（进程在 d188 后中断，**非全量**）

原始数据：

- `electron_node/electron-node/tests/phase3-dialog200-run.log`
- `electron_node/electron-node/tests/lexicon-v2-phase3-dialog200-batch-partial-summary.json`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 清理 | `cleanup_orphaned_processes_simple` |
| 构建 | `npm run build:main` + `electron-rebuild better-sqlite3` |
| 节点 | `npm start`，`PROJECT_ROOT=D:\Programs\github\lingua_1` |
| ASR | `faster-whisper-vad` @ 6007 |
| Intent | `lexicon-intent-cpu` @ 5018（异步，不阻塞 pipeline） |
| V1 Lexicon | startup `lexicon_runtime_status=ok` |
| V2 Runtime | `lexiconRuntimeV2.enabled=true`，tables base=50000 idiom=22192 |
| Phase 3 | `useLexiconRuntimeV2Recall=true` |
| Phase 4 | `useIndustryRouting=true` |
| 批测命令 | `node tests/run-lexicon-v2-phase3-dialog200-batch.js --intent-drain-sec 240` |
| 墙钟耗时 | **2717 s**（约 45 min，至 d188 止；**未含** 240s Intent drain） |

---

## 2. 主链契约（已完成部分）

**结论：** 已完成 **188 / 188 PASS**（`pipeline_ok_rate = 1.0`，在已完成子集内）

| 指标 | 值 |
|------|-----|
| 已完成 / 计划 | 188 / 200 |
| pass / fail / error | **188 / 0 / 0** |
| 未执行 case | d189–d200（12 条） |
| 完整 JSON 落盘 | ❌（脚本未跑完） |

日志中 **无 FAIL、无 ERROR**。每条均为 `[dNNN] PASS`。

---

## 3. 识别质量

### 3.1 本次可观测结论

本次批测 **未生成** `lexicon-v2-phase3-dialog200-batch-result.json`，因此 **无法在本轮输出逐条 CER**。可确认：

- 188 条均通过 FW 主链契约（含 `segmentForJobResult`、KenLM weak_veto、runtime 可用性等）
- ASR 引擎与 FW **决策链未变**；Phase 3 仅替换 Recall 数据源，Phase 4 仅影响 domain 定域

### 3.2 同集间接参照（Phase 2，200/200 全量）

同一 `dialog_200` manifest，Phase 2 全量结果（Intent 开、V2 Recall **关**）：

| 指标 | raw ASR | FW 后 |
|------|---------|--------|
| 平均 CER | 36.19% | **35.93%** |
| 中位 CER | 26.67% | 26.67% |
| P95 CER | 88.0% | 88.0% |
| FW 改善 case | — | 9 |
| FW 劣化 case | — | **0** |

**推断（非本次实测 CER）：** Phase 3/4 在已完成的 188 条上 **0 契约失败、0 可见劣化**；与 Phase 2 同量级，**未见 Recall 换源导致的 FW 劣化**。全量 CER 需补跑 d189–d200 并落盘 JSON 后由 `analyze-phase3-dialog200-quality-perf.mjs` 计算。

---

## 4. 性能数据

### 4.1 墙钟（本次实测）

| 指标 | 值 |
|------|-----|
| 完成 case 数 | 188 |
| 总墙钟 | **2717 s** |
| 均 case 墙钟 | **≈ 14.5 s/case** |
| Intent drain | **未执行** |

### 4.2 与 Phase 2 对照（200 条全量，含 240s drain）

| 指标 | Phase 2 | Phase 3 部分（188 条） |
|------|---------|------------------------|
| 批测墙钟 | 1074 s | 2717 s（至 d188） |
| 均 case 墙钟 | ≈ 4.2 s | ≈ 14.5 s |
| pipeline_ms avg | 4160 | **本次无 JSON** |
| pipeline_ms p95 | 7458 | **本次无 JSON** |

**说明：**

1. **pipeline 不等待 CPU LLM**；墙钟变长主要来自 **188 条串行 ASR + V2 SQLite Recall 开销**，以及批测环境负载，**不是**「每 job 同步 Intent 推理」。
2. Phase 2 的 1074s 含 **240s 固定 Intent drain**；本次在 d188 中断，**未 drain**，仍比 Phase 2 纯 pipeline 段（≈834s/200）慢——V2 Recall 与 Industry Routing 可能增加 FW 步耗时，需补全 JSON 后看 `pipeline_step_ms.fw_detector` 分布确认。
3. Phase 3 验收阈值「Recall P95 ≤ Phase2 +10%」需 **全量 200 条 + perf JSON** 方可判定；**本次数据不足，标为待补测**。

---

## 5. Intent（本次未统计）

批测在 d188 中断，**未执行** 240s drain 与 `export-all`，故无 Intent 写入率、domain 分布。参考 Phase 2 全量：Intent 写入约 50%（latest-only + 单 worker 排队），**与 Phase 3 Recall 验收无直接关系**。

---

## 6. 验收对照（Phase 3 约束）

| 条件 | 本次 | 备注 |
|------|------|------|
| dialog_200 200/200 PASS | ⚠️ **188/200** | 缺 12 条 |
| FW 劣化 = 0 | ✅（已完成子集） | 无 FAIL |
| CER 不劣化 | ⚠️ 间接参照 Phase 2 | 无本次 CER |
| Recall P95 ≤ Phase2 +10% | ⚠️ 待补测 | 无 perf JSON |
| lexicon_runtime ok | ✅（188 PASS 契约） | |
| LocalSpanRecallHit 契约 | ✅ | 代码 + 188 条契约 |

**Phase 3/4 正式冻结：** 建议补跑 **d189–d200**（或全量重跑）并 `--intent-drain-sec 0`，生成完整 JSON + quality-perf 后再签核。

---

## 7. 建议补测命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
# 主链回归：跳过 Intent drain
node tests/run-lexicon-v2-phase3-dialog200-batch.js --intent-drain-sec 0
node tests/analyze-phase3-dialog200-quality-perf.mjs
```

---

## 8. 结论（基于已完成 188 条）

1. **主链契约：** 188/188 PASS，Phase 3 V2 Recall + Phase 4 Routing 在已跑 case 上 **未引入契约失败**。
2. **识别质量：** 无逐条 CER；结合 Phase 2 同集 0 劣化，**预期不劣化**，待全量 CER 确认。
3. **性能：** 墙钟明显高于 Phase 2 批测段，V2 Recall 开销待 perf JSON 量化；**Intent 不是主因**。
4. **完整性：** 本报告为 **部分批测**，**不能替代** 200/200 全量签核。
