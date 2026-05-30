# ASR→FW 主链 Legacy Recover 命名补丁 — 测试报告（dialog_200 × 200）

版本：V1.0  
日期：2026-05-30  
测试范围：Legacy Recover 隔离命名、门禁增强、FW 主链冻结回归  
音频集：`D:\Programs\github\lingua_1\test wav\dialog_200`（**全量 200 条**）  
原始结果：

- `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json`
- `electron_node/electron-node/tests/fw-detector-dialog-200-quality-perf.json`
- `electron_node/electron-node/tests/dialog200-batch-run.log`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 清理 | `cleanup_orphaned_processes_simple` + `clear_code_cache_comprehensive` + `clear_logs_simple` |
| 构建 | `npm run clear-cache` → `npm run build` |
| 节点 | `npm start`（`PROJECT_ROOT=D:\Programs\github\lingua_1`，`NODE_ENV=production`） |
| Test server | `http://127.0.0.1:5020` |
| ASR 引擎 | `faster-whisper-vad`（200/200） |
| FW 模式 | `fw_detector_v1`，KenLM `weak_veto` |
| Lexicon | `lexicon_runtime_status=ok` × 200；`lexiconRecall.enabled=false` |
| 批测参数 | `is_manual_cut: true`，`use_lexicon: true`，`lexicon_v2_intent_enabled: false` |
| 批测时间 | 2026-05-30T09:41:03Z 起，总耗时约 **494 s**（200 case 串行） |

---

## 2. 单元 / 门禁测试（批测前）

| 套件 | 结果 |
|------|------|
| `node scripts/fw-detector-gate.mjs` | **PASS** |
| `npm run test:fw-detector` | **16 suites / 64 tests PASS** |
| `npm run test:contract` | **2 suites / 10 tests PASS** |
| `npm run test:pipeline` | **7 suites / 10 tests PASS** |
| `npm run test:recover` | **10 suites / 28 tests PASS** |

重点冻结断言：

- FW 主链不 import `legacy/recover`
- FW mode 不含 `LEXICON_RECALL` / `SENTENCE_REPAIR`
- `result-builder` FW 路径不调用 `buildLegacyRecoverContractExtra`
- JobContext 无 `repairedText`

---

## 3. dialog_200 契约批测汇总

**结论：** ✅ **200 / 200 PASS**（`pipeline_ok_rate = 1.0`）

| 指标 | 值 |
|------|-----|
| total / pass / fail / skip | 200 / 200 / 0 / 0 |
| fw_triggered_count | 200 |
| fw_applied_case_count | 9 |
| fw_applied_total | 10 |
| text_changed_count | 9 |
| lexicon_runtime_ok_count | 200 |
| kenlm_approved_total | 48 |
| kenlm_vetoed_total | 0 |
| asr_service_id | faster-whisper-vad × 200 |

### 3.1 契约检查（每条 case）

全部通过，批测 JSON **无**：

- `sentence_repair.executed`
- `window_candidates`
- `ctc_nbest` / `asr_nbest_count > 0`

无以下失败码：`empty_text_asr`、`missing_fw_detector`、`sentence_repair_should_not_run`、`window_candidates_present`、`lexicon_not_ok`。

### 3.2 分场景（契约 pass）

| scenario | pass | fw_applied_cases |
|----------|------|------------------|
| cafe | 15 | **9** |
| meeting / taxi / hospital / shopping / friend | 各 15 | 0 |
| tech_deploy | 14 | 0 |
| 其余 8 场景 | 各 12 | 0 |
| lexicon_homophone | 12 | 0 |

### 3.3 FW apply 命中 case

| id | scenario | applied | 说明 |
|----|----------|---------|------|
| d001 | cafe | 1 | 钟贝→中杯 |
| d002 | cafe | 2 | — |
| d046 | cafe | 1 | — |
| d047 | cafe | 1 | — |
| d091 | cafe | 1 | — |
| d093 | cafe | 1 | — |
| d137 | cafe | 1 | — |
| d181 | cafe | 1 | — |
| d182 | cafe | 1 | — |

---

## 4. 识别质量（相对 manifest 参考文本）

归一化规则：去标点/空白后字符级 CER（`analyze-dialog200-quality-perf.mjs`）。

| 指标 | raw ASR | FW 后 text_asr |
|------|---------|----------------|
| 平均 CER | **36.19%** | **35.93%** |
| 中位 CER | 26.67% | 26.67% |
| P95 CER | 88.0% | 88.0% |
| 完全匹配数 | 22 / 200 | 22 / 200 |
| FW 改善 case 数 | — | **9**（CER 下降） |
| FW 劣化 case 数 | — | **0** |
| FW apply case 平均 CER 改善 | — | **5.83%** |

**说明：**

- TTS 合成音频 + 简繁/标点差异导致整体 CER 偏高；本批测重点为 **主链契约 + FW 不劣化**。
- `lexicon_homophone` 场景（后选生城/上线计化）FW **未 apply**（0/12），CER 仍高 — 属 P1.3 词库 Coverage 范畴，非本轮 legacy 命名回归范围。
- 高 CER 样例（非 apply）：d045/d090/d135/d180（homophone 场景）、d194（shopping，繁简+截断）。

### 4.1 SSOT 观测（d001）

| 字段 | 值 |
|------|-----|
| `raw_asr_text` | 你好,我想点一杯热拿铁**钟贝**少糖 深便温 |
| `text_asr` | 你好,我想点一杯热拿铁**中杯**少糖 深便温 |
| `fw_applied_count` | 1 |
| `lexicon_runtime_status` | ok |
| `pipeline_ms` | 5794 |

---

## 5. 性能数据

| 指标 | avg | p50 | p95 | min | max |
|------|-----|-----|-----|-----|-----|
| **pipeline_ms**（端到端） | 2471 ms | 2167 ms | 4065 ms | 1497 ms | 7356 ms |
| **asr_latency_ms**（FW 服务） | 874 ms | 864 ms | 1192 ms | 351 ms | 5560 ms |
| **audio_ms**（输入时长） | 3638 ms | 3900 ms | 4940 ms | — | — |

| 衍生指标 | 值 |
|----------|-----|
| RTF（pipeline / audio） | **0.679** |
| RTF（ASR / audio） | **0.240** |
| 200 case 总 wall time | **494 s**（串行；均 case **2.47 s**） |

KenLM：96 次 query，48 次 approved，0 veto（weak_veto 模式）。

---

## 6. 结论

| 维度 | 判定 |
|------|------|
| Legacy Recover 隔离 / 命名 | ✅ 门禁 + 单测通过 |
| FW 主链契约（200 case） | ✅ 200/200 PASS |
| Recover extra 未泄露 | ✅ 无 sentence_repair / window_candidates |
| FW apply 安全性 | ✅ 0 劣化 case |
| 识别质量（FW vs raw） | ✅ 9 case 改善，0 劣化；整体 CER −0.26pp |
| 性能 | ✅ p50 pipeline 2.17s；RTF 0.68 |

**Legacy Recover 命名补丁 + FW 主链冻结回归验收通过。**

---

## 7. 复现命令

```powershell
cd D:\Programs\github\lingua_1
.\scripts\cleanup_orphaned_processes_simple.ps1
cd electron_node\electron-node
npm run clear-cache
npm run build
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
npm start
# 新终端：
cd electron_node\electron-node
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
node tests/run-fw-detector-dialog-200-batch.js "D:\Programs\github\lingua_1\test wav\dialog_200"
node tests/analyze-dialog200-quality-perf.mjs
```
