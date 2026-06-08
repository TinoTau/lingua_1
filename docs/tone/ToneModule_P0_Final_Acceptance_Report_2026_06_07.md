# ToneModule P0 — Final Acceptance Validation Report

**日期**：2026-06-07  
**性质**：只读验证（允许日志 / 统计 / A/B / 小范围修复）  
**禁止项**：本轮未新增功能、未改模型、未改 IME / HintGate / Recall SQL / Builder / KenLM  

**关联文档**：

- [Runtime Acceptance Report](./ToneModule_P0_Runtime_Acceptance_Report_2026_06_07.md)
- [Development Report](./ToneModule_P0_Development_Report_2026_06_06.md)
- [Mandatory Addendum](./ToneModule%20P0%20%20补充冻结方案（Mandatory%20Addendum）.md)

**审计产物**：

| 产物 | 路径 |
|------|------|
| Final Acceptance 脚本 | `electron_node/electron-node/tests/experiments/tone-module-p0-final-acceptance.mjs` |
| A/B 结果 JSON | `electron_node/electron-node/tests/experiments/tone-module-p0-final-acceptance.json` |
| A/B 运行日志 | `electron_node/electron-node/tests/experiments/tone-module-p0-final-acceptance.log` |
| FW 性能 200 条 | `electron_node/services/faster_whisper_vad/tone_module/_audit_perf.json` |
| Tone Reliability 100 token | `electron_node/services/faster_whisper_vad/tone_module/audit_tone_reliability.py` |
| Fail-Open | `electron_node/services/faster_whisper_vad/tone_module/_audit_fail.json` |

**本轮小范围修复**：`audit_tone_reliability.py` 中 `PROJECT` 路径 `parents[3]` → `parents[4]`（dialog_200 位于仓库根目录）。

---

## 执行摘要

| 验收维度 | 结论 |
|----------|------|
| Dialog200 Tone ON/OFF A/B（全链路） | **未通过** — 177/200 请求 503/504；有效配对仅 23 条 |
| E2E 排序真实参与 | **未证实** — 23 条有效样本 `toneScoreAppliedCount=0`，`candidateRankChangeCount=0` |
| 离线公式 / 专项排序 | **通过** — 少冰 / 评审 / 检查等专项符合设计预期 |
| Tone Reliability（100 token） | **基本可接受** — 高置信 37%；存在 ASR 错字导致的「声学正确、字形错位」 |
| Fail-Open | **通过** — tone 缺失时 `toneMatchScore=0`，主链不阻断 |
| 性能 P95 ≤ 20ms | **通过** — P95=16ms（FW 200 条） |
| **冻结建议** | **不建议冻结** |

**总判定**：ToneModule P0 **链路已贯通、公式与专项行为正确、性能达标**，但 **未能证明在真实 Dialog200 全链路中改善 Recall Candidate Ranking**；存在 **rawText 与 toneTokens 对齐失败** 的阻断性问题。不满足 P0 冻结标准。

---

## 第一部分 — Dialog200 Tone ON/OFF A/B

### 环境

| 组件 | 地址 | 状态 |
|------|------|------|
| FW Worker | `http://127.0.0.1:6007` | 运行中 |
| Node Test Server | `http://127.0.0.1:5020` | 运行中（Electron） |
| 语料 | `test wav/dialog_200/` | 200 WAV + manifest 齐全 |

**A/B 设计**：

- **Tone OFF**：`features.fwTone.wTone = 0`（FW 仍推理，Node 不加权）
- **Tone ON**：`features.fwTone.wTone = 1`
- 脚本：`tone-module-p0-final-acceptance.mjs`（须在 `electron-node/` 目录执行，否则 Electron mock 失败）

### 执行结果

| 指标 | Tone OFF | Tone ON | 备注 |
|------|----------|---------|------|
| 总 case 数 | 200 | 200 | |
| 有效评估（无 error） | **23** | **23** | 177 条 HTTP 失败 |
| HTTP 503 | 174 | — | FW 批测期间过载 |
| HTTP 504 | 3 | — | 网关超时 |
| `candidateRankChangeCount` | **0** | **0** | Top1/Top3 均无变化 |
| `candidateAcceptedCount` / `applyCount` | **0** | **0** | KenLM delta 未达替换阈值 |
| `kenlmSelectedCount` | 56 | 56 | 累计 KenLM query |
| `toneModuleEnabledCases` | 7 | 7 | 有 span 且 tone 启用 |

### 有效 span 样本（7 条有 rank 对比）

| id | spanText | Top1 (OFF) | Top1 (ON) | 变化 |
|----|----------|------------|-----------|------|
| d003 | 少病 | 烧饼 | 烧饼 | 无 |
| d006 | 评审 | 平身 | 平身 | 无 |
| d014 | 鞋是 | 写实 | 写实 | 无 |
| d017 | 一家 | 医家 | 医家 | 无 |
| d019 | 发一 | 法意 | 法意 | 无 |
| d022 | 顯示 | 显示 | 显示 | 无 |
| d186 | 评审 | 平身 | 平身 | 无 |

**关键观测**：全部有效样本 `toneScoreAppliedCount = 0`，说明 E2E 链路中 **声学 tone 分未进入任何候选的 `candidateScore`**。

### 根因分析（d003 探针）

对 `dialog_d003.wav` 单次 pipeline 探针：

```
pipeline rawAsrText : 请问,这款燕麦拿铁可以少病吗?我赶时间小悲。
FW 同音频独立调用 text: 请问,这款燕麦拿铁可以烧病吗?我赶时间小呗!
span「少病」@ [11,13)
buildSpanQueryToneTokens(pipeline raw) → queryLen = 0
buildSpanQueryToneTokens(FW text)       → queryLen = 2
```

**结论**：`alignToneTokensToChars` 将 toneTokens 对齐到 **FW 返回的 ASR 字形**；当 pipeline `rawAsrText` 与 FW `response.text`（tone 生成时所依文本）**不一致** 时，span 级 query 为空或长度不匹配 → `computeToneMatchScore` 恒为 0 → **排序等价于无 Tone**。

同音频真实声学下（FW text 对齐时）：

| candidate | toneMatchScore |
|-----------|----------------|
| 少冰 | 0.37 |
| 烧饼 | **0.25** |
| 哨兵 | 0.02 |

声学上「烧病」更接近烧饼而非少冰，即便 Tone 生效也可能 **强化错误候选**。

---

## 第二部分 — Candidate Ranking 验证（100 span 离线）

**方法**：`auditRanking100()` — 5 类典型 span 轮转 100 次，统一 `baseCandidateScore=1.0`，`wTone=1`。

| 指标 | 值 |
|------|-----|
| Top1 变化次数 | **20 / 100** |
| Top3 变化次数 | 0 |
| Top5 变化次数 | 0 |

### 抽样（节选）

**少病**（query 3|4）

| candidate | base | toneMatchScore | final | rankBefore → After |
|-----------|------|----------------|-------|-------------------|
| 少冰 | 1.0 | 0.45 | 1.45 | Top1 保持 |
| 烧饼 | 1.0 | 0.02 | 1.02 | |
| 哨兵 | 1.0 | 0.02 | 1.02 | |

**评审**（query 2|2）

| candidate | toneMatchScore | final | 备注 |
|-----------|----------------|-------|------|
| 凭神 | **0.88** | 1.88 | **升至 Top1** |
| 评审 | 0.45 | 1.45 | 无 tone 时 Top1 |
| 平身 | 0.45 | 1.45 | |

**进都**（query 4|1）：Top3 内「京都」与「进度」换位。

**结论**：打分公式 **具备改变 Top1 的能力**（20% 模拟场景）；但均为 **理想化声学 query**，不代表 E2E 实测。

---

## 第三部分 — Tone Reliability Audit（100 toneToken）

**方法**：`audit_tone_reliability.py 100` — 从 dialog_200 随机抽 WAV，FW HTTP `/utterance` 收集 toneToken。

| 分档 | 定义 | 数量 | 比例 |
|------|------|------|------|
| 高可信 | confidence ≥ 0.75 | 37 | 37% |
| 可接受 | 0.45 ≤ confidence < 0.75 | 54 | 54% |
| 低可信 | confidence < 0.45 | 9 | 9% |

### 人工核查说明（抽样）

对高置信样本（如 d067「您好，我订单显示已发货…」）：

- 三声、四声在语流中 posterior 尖锐（如 confidence≈0.99）→ **声学上符合普通话**
- FW `token` 绑定 ASR 字形；当 ASR 错字（烧/少）时，预测的是 **音频声调** 而非 **目标词声调** → 标记为「可接受（声学）/ 不用于字形纠错」

| 类别 | 估计比例 | 说明 |
|------|----------|------|
| 明显错误 | ~5–10% | 低置信 + 多峰 posterior 模糊 |
| 可接受 | ~50–55% | 中等置信，调类合理 |
| 高可信 | ~35–40% | 高置信，听感与预测一致 |

**结论**：CNN P0 声学预测 **整体可用**；但依赖 ASR 字形对齐，错字场景下可靠性语义需重新定义。

---

## 第四部分 — 少冰专项验证

**构造**：rawText=`少病`，声学 query=`3|4`（与 Runtime 报告一致）

| candidate | candidateTonePattern | toneMatchScore | finalCandidateScore |
|-----------|---------------------|----------------|---------------------|
| **少冰** | shao3\|bing1 | **0.45** | **1.45** |
| 烧饼 | shao1\|bing3 | 0.02 | 1.02 |
| 哨兵 | shao4\|bing1 | 0.02 | 1.02 |

**Top1–Top2 分差**：**0.43**

**结论**：在 **正确声学 query** 下，Tone **稳定拉开** 少冰 vs 烧饼/哨兵。**通过**。

---

## 第五部分 — 评审专项验证

**构造**：rawText=`评审`，query=`2|2`

| candidate | candidateTonePattern | toneMatchScore | finalCandidateScore |
|-----------|---------------------|----------------|---------------------|
| 凭神 | ping2\|shen2 | **0.88** | **1.88** |
| 评审 | ping2\|shen3 | 0.45 | 1.45 |
| 平身 | ping2\|shen1 | 0.45 | 1.45 |

**结论**：Tone **具备区分能力**，且可将 Top1 从「评审」翻转为「凭神」（需关注是否为误导，见 §10 Q3）。

---

## 第六部分 — 上线专项验证

**构造**：rawText=`上线`，query=`4|4`

| candidate | candidateTonePattern | toneMatchScore |
|-----------|---------------------|----------------|
| 上线 | shang4\|xian4 | 0.88 |
| 上限 | shang4\|xian4 | 0.88 |
| 尚线 | shang4\|xian4 | 0.88 |

`scoresIdentical: true`

**结论**：同调类同音异形 **无法区分** — **符合预期行为**。

---

## 第七部分 — 检查专项验证

验收脚本原用 query=`1|3`（与「检查」调类不符），复核采用正确 query=`3|2`：

| candidate | candidateTonePattern | toneMatchScore | finalCandidateScore |
|-----------|---------------------|----------------|---------------------|
| **检查** | jian3\|cha2 | **0.88** | **1.88** |
| 检察 | jian3\|cha4 | 0.45 | 1.45 |

**分差**：0.43（第二音节二声 vs 四声）

**结论**：在正确声学 query 下，Tone **提供有效区分度**。**通过**（脚本默认值需修正，不影响模块本身）。

---

## 第八部分 — Fail-Open 验证

| 场景 | FW / Node 行为 | toneMatchScore | 主链 |
|------|----------------|----------------|------|
| `tone=null` / 空 query | `buildSpanQueryToneTokens` → `[]` | **0** | 正常 |
| `toneDisabled` / skipped | `isAcousticToneEnabled` false | **0** | 正常 |
| `non_zh` | HTTP 早期返回可能缺 `tone` 字段 | **0** | ASR 正常 |
| `no_audio` | `skippedReason=no_audio` | **0** | 正常 |
| `wTone=0` | `final = base` | 0 贡献 | 正常 |

数据来源：`_audit_fail.json` + `tone-module-p0-final-acceptance.mjs` 离线断言。

**结论**：Fail-Open **通过**。

---

## 第九部分 — 性能验证（Dialog200）

数据来源：`_audit_perf.json`（FW HTTP 全量 200 条，`tone_inference_ms`）

| 分位 | ms | 目标 |
|------|-----|------|
| **P50** | **9** | |
| **P95** | **16** | ≤ 20 ✓ |
| **P99** | **20** | 压线 |
| **MAX** | **28** | 超标（长句 35 token） |
| Mean | 9.54 | |
| N | 200 | |

**结论**：**P95 ≤ 20ms 达标**；极端长尾 28ms 不阻断 P0 性能项。

---

## 第十部分 — 最终判定

### 1. ToneModule 是否真实参与排序？

| 层面 | 判定 |
|------|------|
| 代码 / 公式 | **是** — `finalCandidateScore = base + wTone × toneMatchScore` |
| Dialog200 E2E | **否（有效样本）** — `toneScoreAppliedCount=0`，wTone ON/OFF 排序无差异 |
| 离线模拟 | **是** — 100 span 中 20 次 Top1 变化 |

### 2. ToneModule 是否提升排序区分度？

| 层面 | 判定 |
|------|------|
| 专项（少冰 / 检查） | **是** — 分差 ~0.43 |
| 同调异形（上线/上限） | **N/A** — 不区分，符合设计 |
| E2E Dialog200 | **未证明** |

### 3. ToneModule 是否存在明显误导排序？

| 风险 | 说明 |
|------|------|
| **是（条件性）** | ASR 错字时声学匹配错误同音词（如「烧病」→ 烧饼 tone 分高于少冰） |
| 评审 2\|2 query | 离线可将 Top1 翻为「凭神」——需真实声学验证，存在误导潜力 |

### 4. ToneModule 是否满足性能要求？

**是** — P95=16ms ≤ 20ms。

### 5. ToneModule 是否应该冻结？

**否 — 不建议冻结。**

理由：

1. P0 核心目标「改善 Recall Candidate Ranking」在 E2E 未证实；
2. `rawAsrText` 与 `toneTokens` 对齐失败导致生产路径上 Tone 分恒为 0；
3. Dialog200 A/B 88.5% 样本因 infra 503/504 失败，统计不充分；
4. 存在错字场景下强化错误候选的风险，未建立防护验收。

### 6. 如果不冻结：还缺什么？

| # | 缺口 | 优先级 |
|---|------|--------|
| 1 | **SSOT 对齐**：`toneTokens` 必须与 `rawAsrText` 同源（同一 FW `response.text`），或对齐算法改为时间戳索引而非字形匹配 | P0 |
| 2 | **E2E 可观测性**：span diagnostics 输出 `toneMatchScore` / `baseCandidateScore`；pipeline extra 暴露 `ASRResult.tone` | P0 |
| 3 | **Dialog200 全量 A/B 重跑**：FW 稳定单并发 + 有效配对 200/200 + `toneScoreAppliedCount > 0` | P0 |
| 4 | **验收指标**：定义「rank change 可接受率 / 误导率」阈值 | P0 |
| 5 | Fail-Open 一致性：`non_zh` 响应补全 `tone: { toneEnabled: false }` | P1 |
| 6 | FW README 文档化 `tone` 字段 | P1 |

---

## 附录 A — 与 Runtime Acceptance 的关系

| Runtime 项 | Final 项 | 变化 |
|------------|----------|------|
| Node E2E 未跑 | Dialog200 A/B 已跑 | 23/200 有效，结论更悲观 |
| 排序「有条件通过」 | E2E `toneScoreAppliedCount=0` | 降级为 **未证实** |
| 性能通过 | 复用 `_audit_perf.json` | 维持通过 |

---

## 附录 B — 复现命令

```bash
# 1. 启动 FW (:6007) + Electron Node (:5020)

# 2. Final Acceptance（须在 electron-node 目录）
cd electron_node/electron-node
set PROJECT_ROOT=<repo_root>
node tests/experiments/tone-module-p0-final-acceptance.mjs

# 3. Tone Reliability 100 token
cd electron_node/services/faster_whisper_vad
.venv/Scripts/python.exe tone_module/audit_tone_reliability.py 100

# 4. 性能（若需重跑）
.venv/Scripts/python.exe tone_module/audit_runtime_acceptance.py
```

---

**报告人**：自动化验收 + 人工判定  
**版本**：ToneModule P0 Final Acceptance v1.0  
**签署建议**：**暂缓冻结**，先完成 SSOT 对齐与全量 E2E A/B 后复审。
