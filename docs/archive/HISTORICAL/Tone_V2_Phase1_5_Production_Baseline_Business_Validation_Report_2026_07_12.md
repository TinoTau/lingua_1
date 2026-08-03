<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase1_5_Production_Baseline_Business_Validation_Report_2026_07_12.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 1.5 — Production Baseline Business Validation Report

**日期：** 2026-07-12  
**类型：** Production Baseline Business Validation（正式重跑）  
**Run ID：** `run_20260712_rerun`  
**Session：** `phase1_5_production_baseline_d200`  
**Verdict：** **A — Business Baseline Established**

> **本报告作为 Phase 2 Runtime Audio Alignment Training 的唯一比较基准。**

---

## 1. Executive Summary

在 FW 冻结端口 **6007**、Phase 1.5 启动脚本修复完成后，本轮于 **单实例 Electron → ServiceProcessRunner → 唯一 FW** 路径下，完整跑通：

| 阶段 | 结果 |
|------|------|
| Preflight（5020 + 6007） | ✅ PASS |
| Smoke `dialog_d001.wav` | ✅ PASS |
| `dialog_200` 全量批测 | ✅ **200/200** 成功 |
| Tone ON/OFF A/B（27 fixtures） | ✅ 有效 |
| Production Artifact 加载 | ✅ `production_baseline_20260712` |
| 运行期间服务重启 | ❌ 无 |
| `model_error` | **0** |
| HTTP 404/500（批测） | **0** |

**核心发现：** Production Baseline 全链可稳定运行；Tone 推理与 Recall 链路 100% 激活，但 **端到端文本准确率仍受 ASR 原始错误与 KenLM 主导排序制约**——A/B 中 12 例 final 变化，相对 expectedText 改善 5 例、退化 4 例、横向 3 例，净效应接近中性。

---

## 2. 冻结配置与 Artifact

### 2.1 服务端口（SSOT）

| 服务 | 端口 | 本轮状态 |
|------|------|----------|
| Node test server | 5020 | ✅ 使用 |
| Faster Whisper VAD | **6007** | ✅ 冻结 SSOT |
| NMT | 5008 | Electron 托管 |
| Scheduler | 5010 | Electron 托管 |
| Lexicon Intent | 5018 | **未主动启动**（Phase 1.5 不依赖） |

- SSOT：`electron_node/services/faster_whisper_vad/service.json`
- 环境变量：`FASTER_WHISPER_VAD_PORT=6007`
- 已清除：`PORT`、`TONE_P10_FW_PORT`、`FW_PORT`

### 2.2 Production Baseline Artifact

```text
electron_node/services/faster_whisper_vad/tone_module/models/production/tone_cnn_p1_v1_production_20260712.npz
```

启动前设置：

```powershell
$env:TONE_MODEL_PATH = "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\production\tone_cnn_p1_v1_production_20260712.npz"
```

**Runtime 确认（diagnostics / batchInference）：**

| 字段 | 值 |
|------|-----|
| `artifactPath` | `...tone_cnn_p1_v1_production_20260712.npz` |
| `trainingVersion` | `production_baseline_20260712` |
| `featureVersion` | `p1-frame-mel-f0-v1` |
| `backend` | `numpy_p1` |
| `modelVersion` | `tone_cnn_p1_v1` |

**未加载：** `p10_structural_smoke` ✅

### 2.3 FW Health 身份校验

`http://127.0.0.1:6007/health` 返回 FW schema：

- `readiness.utterance_ready = true`
- `device = cuda`
- ASR / VAD model 就绪
- **无** `prompt_pack_version` / `gpu_layers` / `warmup_done` → 非 `WRONG_SERVICE_ON_FW_PORT`

---

## 3. 运行环境与完整性

### 3.1 启动方式

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

禁止项均未发生：无手动 `python faster_whisper_vad_service.py`、无第二 Electron/FW、无 Intent 误绑 6007/6008、无端口自动切换。

### 3.2 进程与端口（测试期间）

| 项 | 值 |
|----|-----|
| Electron PID（5020 Listen） | **13896** |
| FW 主进程 PID（6007 Listen） | **28636** |
| FW worker PID | **7128** |
| Node port | 5020 |
| FW port | **6007** |
| 批测开始（UTC） | `2026-07-11T23:27:50.151Z` |
| A/B 审计（UTC） | `2026-07-11T23:33:26.815Z` |
| dialog_200 耗时 | **969 s**（≈16.2 min） |
| 服务中途重启 | **否** |
| Artifact / 端口 / 配置变更 | **否** |
| `wrong_service` | **否** |
| orphan worker（测试后见 §12） | 见生命周期检查 |

### 3.3 输出工件

```text
tmp/tone_phase1_5_business_baseline/run_20260712_rerun/
  dialog200_batch.json          # 200 cases
  batch.log
  business_effect_audit.json    # A/B 27 fixtures
  ab_audit.log
  aggregate_stats.json
```

---

## 4. Preflight & Smoke

### 4.1 Preflight

- Node `http://127.0.0.1:5020` — 可访问
- FW `http://127.0.0.1:6007/health` — FW schema，`utterance_ready=true`

### 4.2 Smoke — `dialog_d001.wav`

| 检查项 | 结果 |
|--------|------|
| Node HTTP | 200 |
| ASR service | `faster-whisper-vad` |
| `toneEnabled` | `true` |
| `skippedReason` | `null` |
| AcousticToneSlice | 12 slices，posterior finite |
| Recall | 执行（pattern hit=52, exact=0） |
| Final candidate | 可观测 |
| diagnostics | Production Baseline artifact |
| `model_error` | `false` |

---

## 5. dialog_200 全量结果

**命令：**

```powershell
node tests/tone-v2-dialog200-batch.js `
  --session phase1_5_production_baseline_d200 `
  --out D:\Programs\github\lingua_1\tmp\tone_phase1_5_business_baseline\run_20260712_rerun\dialog200_batch.json `
  --max-minutes 30 `
  --wait-fw
```

| 指标 | 值 |
|------|-----|
| 总 fixture | 200 |
| 成功 | **200** |
| 失败 | **0** |
| 固定 manifest | ✅ 未筛选 case |
| 单一 run / 单一 FW 实例 | ✅ |
| 结果拼接 | ❌ 无中断拼接 |

### 5.1 Runtime / Tone 统计

| 指标 | 值 |
|------|-----|
| `toneEnabled` rate | **100%** (200/200) |
| `skippedReason` 分布 | `{ null: 200 }` |
| 平均 AcousticToneSlice / case | **15.9** |
| posterior finite rate | **100%**（无 `model_error`） |
| low-margin posterior rate（A/B 27 fixtures, conf&lt;0.5） | **16.7%** (69/412 slices) |
| `model_error` count | **0** |

### 5.2 Recall 统计（dialog_200, Tone ON）

| 指标 | 值 |
|------|-----|
| Tone pattern hit（累计 `ngramTonePatternHitCount`） | 10,515 |
| tone exact hit（累计 `toneExactHitCount`） | 566 |
| tone exact hit rate（case 级有 exact&gt;0 占比） | **89.5%** (179/200) |
| plain fallback hit（累计） | 2,474 |
| tone penalty / recall 活动 case 数 | **200/200** |
| candidate rerank（KenLM 非 raw pick） | **49/200 (24.5%)** |
| `fw_applied_count` &gt; 0 cases | 见 batch（homophone 场景较高） |

### 5.3 Final（dialog_200, Tone ON）

| 指标 | 值 |
|------|-----|
| exact match vs `expectedText` | **28/200 (14.0%)** |
| mean CER | **0.219** |
| mean pipeline latency | **4837 ms** |
| p50 pipeline | **4340 ms** |
| p95 pipeline | **7230 ms** |
| mean FW detector step | **1325 ms** |

---

## 6. Tone ON / OFF A/B

**Fixtures：** 27 个 tone-sensitive（`d001`–`d003`, `d043`–`d048`, `d088`–`d093`, `d133`–`d138`, `d178`–`d183`）

| Variant | 配置 |
|---------|------|
| A — Tone ON | `toneTimestampOnlyEnabled = true`，Production posterior |
| B — Tone OFF | `toneTimestampOnlyEnabled = false`，`skippedReason = tone_timestamp_disabled` |

其余条件一致：同一 artifact、Node/FW、lexicon、KenLM、fixture。

### 6.1 A/B 汇总

| 指标 | 值 |
|------|-----|
| fixture 数 | 27 |
| posterior present | 27/27 |
| tone pattern hit | 27/27 |
| KenLM top1 变化（A vs B） | **19/27 (70.4%)** |
| final candidate 变化 | **12/27 (44.4%)** |
| final 无变化 | **15/27 (55.6%)** |
| trace 级 `tonePenaltyTriggered`（pre-filter 样本） | 0（审计探针未捕获 penalty 事件，Recall 层仍有 pattern/compatible 活动） |

### 6.2 相对 expectedText 的 A/B 效应（CER 归一化）

归一化：去除标点与空白后 Levenshtein CER。

| 分类 | 数量 | 占比（27 fixtures） | Fixture IDs |
|------|------|---------------------|-------------|
| **Tone ON 改善**（A CER &lt; B CER） | **5** | 18.5% | d045, d091, d093, d135, d181 |
| **Tone ON 退化**（B CER &lt; A CER） | **4** | 14.8% | d043, d048, d090, d179 |
| **横向变化**（CER 相同但文本不同） | **3** | 11.1% | d046, d133, d180 |
| **无 final 变化** | **15** | 55.6% | 其余 |

> A/B 有效：开关确实改变 Recall/KenLM 路径；但相对 gold text **无净胜率**（5 改善 vs 4 退化）。

---

## 7. Production Business Baseline 表（Phase 2 唯一基准）

| 指标 | Production Baseline |
|------|--------------------:|
| dialog_200 success rate | **100%** (200/200) |
| Tone enabled rate | **100%** |
| Tone exact hit rate（case 级） | **89.5%** |
| Tone penalty trigger rate（recall 活动 case） | **100%** |
| Candidate rerank rate | **24.5%** |
| Final candidate changed rate（A/B, 27 fixtures） | **44.4%** |
| Improvement count/rate（A/B vs expected） | **5 / 18.5%** |
| Regression count/rate（A/B vs expected） | **4 / 14.8%** |
| No-effect count/rate（A/B final 相同） | **15 / 55.6%** |
| Mean Node latency（pipeline） | **4837 ms** |
| Mean FW latency（detector step） | **1325 ms** |
| Mean Tone inference latency | **N/A（批测未分账）；smoke batchInference=23 ms / 6 slices** |

**附加基线（dialog_200 Tone ON）：**

| 指标 | 值 |
|------|-----|
| exact match rate | 14.0% |
| mean CER | 0.219 |
| low-margin posterior rate | 16.7%（A/B 探针集） |
| `model_error` rate | 0% |

---

## 8. 代表 Case 分析（10 例）

链路：**Raw ASR → TonePosterior → TonePattern → ToneLookup → TonePenalty → Candidate Before/After → KenLM → Final → Expected**

---

### Case 1 — d001：Tone pattern 有、exact=0；ASR 错误 Tone 无法补救

| 阶段 | 内容 |
|------|------|
| Raw ASR | `你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?` |
| TonePosterior | 12 slices，finite；例：t3 conf=0.93 @0.44s，t2 conf=0.47 @1.36s（低 margin） |
| TonePattern | `ngramTonePatternHitCount=52` |
| ToneLookup | `toneExactHitCount=0`，`plainFallbackHitCount=5` |
| TonePenalty | recall 活动，compatible=0 |
| Candidate | `fw_applied_count=0`，未触发 span 替换 |
| KenLM | `pickedIsRaw=true`，`maxDelta=0` |
| Final | 同 Raw ASR |
| Expected | `你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？`（CER≈0.41） |

**结论：** Posterior 正常，但 lookup exact 为 0；ASR 整句错误非 Tone 可修复范围。

---

### Case 2 — d012：正常正确样本

| 阶段 | 内容 |
|------|------|
| Raw ASR | `这个检查报告什么时候能出 我过敏 发痒需要请假休息吗?` |
| TonePosterior | 12 slices |
| TonePattern | pattern=37, exact=2 |
| ToneLookup | compatible=3 |
| KenLM | raw pick，maxDelta=1.42 |
| Final | 同 Raw（**exact match**） |
| Expected | 完全一致 |

---

### Case 3 — d043：A/B final 变化；Tone ON 略差于 OFF（退化）

| 阶段 | Tone ON (A) | Tone OFF (B) |
|------|-------------|--------------|
| Raw ASR | `...选生呈方安线吧! 成的借口文章補齊` | 同左 |
| TonePosterior | 13 slices，高 conf 为主 | posterior 仍计算，Recall 禁用 timestamp |
| TonePattern | acoustic pattern 可见（如 `men|xia` → [1,4]） | 无 pattern 注入 |
| KenLM top1 | `...方安线吧。 文章不齐` Δ=6.53 | `...方案线吧! 文章不齐` Δ=7.52 |
| Final | `...方安线吧。 文章不齐` | `...方案线吧! 文章不齐` |
| Expected | `我们下午讨论后选声城方案...接口文档补齐` | |
| CER vs expected | **0.48** | **0.44**（B 更好） |

**结论：** Tone 改变 KenLM 候选集与 final，但该 homophone case 上 **Tone OFF 更接近 expected**。

---

### Case 4 — d045：A/B final 变化；Tone ON 改善

| 阶段 | 内容 |
|------|------|
| Raw ASR | `關於後,選生成為 和上限计划请安上限计划执行有问题群里说` |
| TonePosterior | 6 slices（FW）/ 24 recall slices |
| TonePattern | pattern=62, exact=3 |
| A final | `...選生成為 和上限计划...` |
| B final | `...選生成為選手 和上限计划...`（多出「手」） |
| CER | A=**0.44** &lt; B=0.52 → **Tone ON 改善** |

---

### Case 5 — d046：排序变化但 CER 相同（横向）

| 阶段 | 内容 |
|------|------|
| A vs B final | `中倍珍长糖` vs `中贝珍长糖` |
| CER vs expected | 均为 **0.207** |
| 结论 | Tone 改变字形选择，未改变相对 gold 距离 |

---

### Case 6 — d048：KenLM 覆盖；Tone ON 退化

| 阶段 | Tone ON | Tone OFF |
|------|---------|----------|
| Final | `...少病吗? 我赶时间小呗` | `...少病吗?我赶时间小杯` |
| CER | 0.211 | **0.158** |
| 结论 | 「小呗」vs「小杯」— Tone ON 选错同音字 |

---

### Case 7 — d047：Tone 无影响（A/B final 相同）

| 阶段 | 内容 |
|------|------|
| Scenario | cafe |
| A/B final | 完全相同 |
| 结论 | Posterior 存在但 downstream 无分叉 |

---

### Case 8 — d090：homophone；Tone OFF 更接近 expected（退化）

| 阶段 | 内容 |
|------|------|
| A final | 繁体混用 `...選生成为 和上限計劃...` |
| B final | `...選生成為 和上限计划...` |
| CER | A=0.64, B=**0.40** |
| 结论 | 简繁/用词：Tone OFF 更贴近 expected 简体 |

---

### Case 9 — d179：低 margin + KenLM rerank；Tone ON 退化

| 阶段 | 内容 |
|------|------|
| Raw ASR | `這周的上限計劃意境,確認上限計劃評審...` |
| TonePosterior | 24 slices；部分 slice conf≈0.52（低 margin） |
| Recall | exact=4, `fw_applied_count=5` |
| KenLM | `pickedIsRaw=false`, maxDelta=8.74 |
| A vs B CER | 0.458 vs **0.375** |
| Final (A) | `這周的上限計劃已经,全任上线計劃評審...` |

---

### Case 10 — d134：homophone 场景但 Tone 完全无影响

| 阶段 | 内容 |
|------|------|
| Scenario | lexicon_homophone |
| A/B final | 完全相同 |
| dialog_200 | exact=4, pattern=72, 但 A/B 无分叉 |
| 结论 | Recall 有 tone 活动，但最终路径对开关不敏感

---

## 9. 十五问答复

| # | 问题 | 答复 |
|---|------|------|
| 1 | Production Baseline 是否真实部署？ | **是** — `npm start` + `TONE_MODEL_PATH` production npz |
| 2 | Runtime 是否真实加载正确 artifact？ | **是** — `trainingVersion=production_baseline_20260712`, `backend=numpy_p1` |
| 3 | dialog_200 是否完整跑完？ | **是** — 200/200，969s，无中断 |
| 4 | Tone ON/OFF A/B 是否有效？ | **是** — 12/27 final 变化，19/27 KenLM top 变化 |
| 5 | Tone enabled rate？ | **100%** |
| 6 | tone exact hit rate？ | **89.5%**（case 级） |
| 7 | tone penalty trigger rate？ | **100%** recall 活动 case；trace 探针 penalty=0 |
| 8 | Candidate rerank rate？ | **24.5%** |
| 9 | Final candidate change rate（A/B）？ | **44.4%** |
| 10 | Tone 改善多少？ | **5/27 (18.5%)** vs expected（CER） |
| 11 | Tone 退化多少？ | **4/27 (14.8%)** |
| 12 | Tone 无影响多少？ | **15/27 (55.6%)** final 相同 |
| 13 | 当前主要业务瓶颈？ | **(1) ASR 原始准确率（mean CER 0.22, exact 14%）；(2) ToneLookup exact 在部分 cafe case 为 0；(3) KenLM 强主导致 Tone 边际效应被覆盖或反向** |
| 14 | 可否作为 Phase 2 唯一基准？ | **是** — 环境稳定、artifact 正确、数据完整 |
| 15 | 可否进入 Phase 2 Runtime Audio Alignment Training？ | **是** — 见 Verdict A |

---

## 10. Final Verdict

## **A — Business Baseline Established**

满足条件：

- ✅ Production artifact 正确加载（`production_baseline_20260712`）
- ✅ dialog_200 完整（200/200）
- ✅ A/B 有效（27 fixtures，开关可观测分叉）
- ✅ 统计完整（Runtime / Recall / Final / 延迟）
- ✅ 运行期间环境稳定（无重启、无 wrong service、无 model_error）

**可以进入 Phase 2 Runtime Audio Alignment Training。**

---

## 11. 测试后生命周期检查

*（报告生成后执行，2026-07-12）*

| 检查项 | 结果 |
|--------|------|
| 正常关闭 Electron（PID 13896） | ✅ 已停止 |
| 6007 不再监听 | ✅ |
| 5020 不再监听 | ✅ |
| FW 主进程（PID 28636） | ✅ 随 Electron 退出 |
| FW multiprocessing worker（PID 7128） | ⚠️ **orphan** — Electron 退出后仍存活，已手动 `Stop-Process` 清理 |
| 其他服务 Python（NMT/TTS/Intent） | 测试前即存在，非本轮拉起 |

**Lifecycle issue（独立记录，不影响 baseline 数据有效性）：**

> Electron 正常退出后，FW worker PID **7128** 一度成为 orphan multiprocessing 子进程。已手动终止；后续 Phase 2 测试前须重新 preflight 确认无残留。

**备注：** 批测期间服务稳定、数据已落盘；orphan worker 属于**测试后清理**问题，**不得在同一残留环境开始下一轮测试**（已清理完毕）。

---

## 12. 关联文档

| 文档 | 说明 |
|------|------|
| `Tone_V2_Phase1_5_E2E_Test_Environment_Incident_Report_2026_07_12.md` | 首次失败环境问题 |
| `FW_Port_SSOT_Freeze_and_Phase1_5_Startup_Repair_Report_2026_07_12.md` | 端口冻结与启动修复 |
| `tmp/tone_phase1_5_business_baseline/run_20260712_rerun/` | 原始 run 工件 |

---

## 13. 本轮未处理项（按任务书冻结）

以下问题**仅记录**，未边测边修：

- Training Audio Domain / Feature Cache / 重训
- TonePenalty / KenLM / ToneLookup / Recall 调参
- Node 分割 / VAD / Opus / FW 端口

---

*Report generated: 2026-07-12 · Run `run_20260712_rerun` · Phase 2 baseline locked.*
