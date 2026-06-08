# ToneModule P0 — Integration Validation & Runtime Acceptance Report

**日期**：2026-06-07  
**性质**：联调验收审计（允许小范围修复；禁止新功能/新模型/架构重构）  
**关联文档**：

- [开发报告](./ToneModule_P0_Development_Report_2026_06_06.md)
- [CNN 训练报告](./ToneModule_P0_CNN_Training_Report_2026_06_06.md)
- [Mandatory Addendum](./ToneModule%20P0%20%20补充冻结方案（Mandatory%20Addendum）.md)

**审计脚本**：

| 脚本 | 路径 |
|------|------|
| FW HTTP 审计 | `electron_node/services/faster_whisper_vad/tone_module/audit_runtime_acceptance.py` |
| Node 排序审计 | `electron_node/electron-node/tests/experiments/tone-module-p0-runtime-acceptance.mjs` |

**本轮小范围修复**：`tone-match-score.ts` 错误 import 路径（`../../task-router` → `../task-router`），导致 `npm run build:main` 失败，已修复。

---

## 执行摘要

| 验收项 | 结论 |
|--------|------|
| 全链路贯通（FW → HTTP → Node rerank） | **通过**（HTTP+代码追踪；Node 端到端批测未跑） |
| toneTokens 真实回传 | **通过**（20/20 中文样本） |
| Dedup 解耦 | **通过**（架构+代码序；无 live dedup HTTP 样本） |
| toneMatchScore 影响排序 | **通过**（公式+少冰专项+50 span 模拟） |
| Legacy Tone 清理 | **通过** |
| 性能 ≤20ms | **有条件通过**（P95=16ms ✓；MAX=28ms ✗） |
| Fail-Open | **基本通过**（non_zh 空响应缺 tone 字段，见 §7） |
| Dialog200 On/Off 批测 | **未执行**（节点 :5020 未启动） |

**总判定**：**有条件通过（Conditional Pass）** — 核心运行时链路已工作，尚有文档与 E2E 批测缺口。

---

## 第一部分 — Tone Pipeline Trace

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Phase A — FW Worker (Python)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│ api_routes.py :: process_utterance                                      │
│   perform_asr() → segments[].words[] (word_timestamps)                  │
│   run_tone_inference(processed_audio, segments)  ← L274，dedup 之前      │
│   process_text_deduplication()               ← L312                     │
│   update_segments_after_deduplication()      ← words 可能变 null        │
│   UtteranceResponse.tone = tone_payload      ← L445 顶层字段             │
│   diagnostics.toneModule.tone_inference_ms                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │ HTTP POST /utterance
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Node ASR 层                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ faster-whisper-asr-strategy.ts                                          │
│   ASRResult.tone = response.data.tone                                   │
│ asr-step.ts → ctx.asrResult = asrResult（含 tone）                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Phase B — FW Detector (TypeScript)                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ fw-detector-orchestrator.ts                                             │
│   runFwSentenceRerankPipeline({ tone: ctx.asrResult?.tone })              │
│ fw-sentence-rerank-pipeline.ts                                          │
│   buildSpanQueryToneTokens(rawText, span, tone)                         │
│   toneMatchScore = computeToneMatchScore(queryTokens, tonePinyinKey)      │
│   finalCandidateScore = baseCandidateScore + wTone * toneMatchScore       │
│   sort by candidateScore（无 toneDistance 独立键）                         │
│ FwDetectorResult.toneModule diagnostics                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**代码序验证**：`run_tone_inference`（api_routes.py:274）早于 `process_text_deduplication`（:312）。`tone` 挂于 `UtteranceResponse` 顶层，不依赖 dedup 后 `segments.words`。

---

## 第二部分 — ToneToken 回传验证（20 句中文抽样）

**环境**：FW 服务 `http://127.0.0.1:6007`，`dialog_200` 随机 20 条 WAV，`src_lang=zh`。

| 指标 | 结果 |
|------|------|
| 抽样数 | 20 |
| HTTP 成功 | 20/20 |
| toneEnabled=true | **20/20 (100%)** |
| toneTokenCount 范围 | 15–35 |
| toneConfidenceAvg 范围 | 0.63–0.73 |
| tone_inference_ms 范围 | 7–18 ms |

### 抽样表（节选 10 条）

| id | rawAsrText（节选） | toneEnabled | toneTokenCount | toneConfidenceAvg | tone_inference_ms |
|----|-------------------|-------------|----------------|-------------------|-------------------|
| d164 | 作业是下周以下午叫码… | true | 17 | 0.698 | 18 |
| d029 | 作业是下周一下午较码… | true | 16 | 0.679 | 7 |
| d007 | 市富曲仲官村軟件遠… | true | 30 | 0.641 | 12 |
| d190 | 醫生您好 我這兩天頭痛… | true | 20 | 0.675 | 8 |
| d071 | 你如何看待夸团队协作… | true | 20 | 0.666 | 9 |
| d058 | 这件外套能试穿吗… | true | 19 | 0.701 | 9 |
| d140 | 今天的站会现过一下订单中台… | true | 28 | 0.670 | 17 |
| d109 | …候选生成流程和上线计划… | true | 35 | 0.684 | 14 |
| d174 | 可以打爆麻 顺便结一下账… | true | 15 | 0.728 | 7 |
| d060 | 我想对比一下这两款订单中台… | true | 22 | 0.703 | 8 |

**结论**：`toneTokens` / `tonePosterior` / `confidence` 在真实 FW HTTP 链路中**稳定存在**。

完整 20 条见审计输出：`tone_module/_audit_fw_results_partial.json`。

---

## 第三部分 — Dedup 验证

### 3.1 架构约束

| 检查项 | 结果 |
|--------|------|
| Tone 在 dedup **之前**生成 | ✓ api_routes.py L274 < L312 |
| tone 独立于 segments.words | ✓ `UtteranceResponse.tone` 顶层 |
| dedup 后 words=null 不影响已生成 tone | ✓ 设计如此 |

### 3.2 Live HTTP 样本

对 dialog_200 前 80 条执行「ASR → 本地 deduplicate_text 对比」：**0 条**触发文本 dedup 变化。

### 3.3 合成 Dedup 样本

| 项 | 值 |
|----|-----|
| 触发前文本 | `少冰少冰谢谢` |
| 触发后文本 | `少冰少冰谢`（deduplicate_text） |
| 触发前 toneTokenCount（本地 inference） | **4** |
| dedup 后若 words=[] 再 inference | **0**（符合预期：tone 不应事后从空 words 重建） |
| HTTP tone 字段是否依赖 dedup 后 words | **否** |

**结论**：Dedup 解耦设计**成立**；dialog_200 TTS 语料未产生可观测的 live dedup 用例，以代码序+合成样本佐证。

---

## 第四部分 — Tone 排序验证（50 span）

**方法**：使用已编译 `tone-match-score.js` + `fw-tone-config.js`，对 5 类典型 span 组合随机模拟 50 次（含真实打分公式与 wTone=1）。

| 指标 | 值 |
|------|------|
| 模拟 span 数 | 50 |
| tone 改变 Top-1 排序的次数 | 7 |
| 改变比例 | 14% |

### 少病 span 示例（与 §8 一致）

| candidate | candidateTonePattern | base | toneMatchScore | final |
|-----------|---------------------|------|----------------|-------|
| 少冰 | shao3\|bing1 | 1.0 | **0.46** | **1.46** |
| 烧饼 | shao1\|bing3 | 1.0 | 0.02 | 1.02 |
| 哨兵 | shao4\|bing1 | 1.0 | 0.02 | 1.02 |

### 排序翻转示例（评审 span，query 2|2）

| 模式 | Top-1 |
|------|-------|
| 有 tone | **凭神**（toneMatchScore=0.9） |
| 无 tone（wTone=0） | 评审（全部 base=1 平局） |

**结论**：`toneMatchScore` **真实进入** `finalCandidateScore` 并**可改变** span 内候选排序。

**限制**：未对 50 条 dialog_200 **完整 FW Detector 流水线**逐条跑通（需节点 :5020）；当前为排序模块 + 声学 query 模拟验证。

---

## 第五部分 — Legacy Tone 清理验证

| 检查目标 | fw-detector 主链 | 残留位置 |
|----------|------------------|----------|
| `textToToneSyllables(span.text)` | **0 处** | — |
| `toneDistance` import | **0 处** | — |
| `toneDistance` sort | **0 处** | — |
| `textToToneSyllables` 定义 | 仍存在 | `lexicon/phonetic/tone-pinyin.ts`（工具库，**非主链**） |
| `toneDistance` 定义 | 仍存在 | 同上（**非主链**） |

**结论**：Legacy 文本 tone 排序已**完全退出** FW rerank 主链；`tone-pinyin.ts` 仅保留函数定义供其他模块/历史探针使用。

---

## 第六部分 — 性能压测（Dialog200）

**环境**：FW `:6007`，dialog_200 **全量 200 条**，统计 `diagnostics.toneModule.tone_inference_ms`。

| 分位 | ms |
|------|-----|
| **P50** | **9** |
| **P95** | **16** |
| **P99** | **20** |
| **MAX** | **28** |
| Mean | 9.54 |
| N | 200 |

| 目标 | 结果 |
|------|------|
| 整句 ≤20ms（P0 目标） | P95 **通过**；P99 **压线**；MAX **超标** |

**结论**：典型路径满足 ≤20ms；极端长句（35 tokens）偶发 28ms，需关注但**不阻断** P0 有条件通过。

---

## 第七部分 — Fail-Open 验证

| 场景 | ASR 返回 | tone | toneMatchScore@Node |
|------|----------|------|-------------------|
| 无音频（direct inference） | — | skippedReason=`no_audio` | 0 |
| 无 timestamps（direct） | — | skippedReason=`no_timestamps` | 0 |
| 非中文 HTTP（en + 静音） | text="" 可返回 | **tone 字段缺失（null）** | 0 |
| 模型缺失 | — | bootstrap/npz 存在 → 未触发 | — |
| 模型文件存在 | — | `tone_cnn_p0.npz` ✓ | — |

**缺口**：`src_lang=en` 且音频质量不合格时，早期 `UtteranceResponse` 返回**未携带** `tone` 对象（应显式 `toneEnabled=false` 更一致）。Node 侧 `buildSpanQueryToneTokens` 在 tone 缺失时返回 `[]`，`toneMatchScore=0`，**不阻断 ASR**。

---

## 第八部分 — 少冰案例专项验证

**构造**：rawText=`少病`，声学 query tone=`3|4`（模拟 FW toneTokens）

| candidate | candidateTonePattern | toneMatchScore | finalCandidateScore |
|-----------|---------------------|----------------|---------------------|
| **少冰** | shao3\|bing1 | **0.46** | **1.46** |
| 烧饼 | shao1\|bing3 | 0.02 | 1.02 |
| 哨兵 | shao4\|bing1 | 0.02 | 1.02 |

**结论**：Tone 对 少冰 vs 烧饼/哨兵 提供 **+0.44** 的 score 区分度（wTone=1），满足 P0「额外区分度」验收。

---

## 第九部分 — Dialog200 On/Off 对比

| 项 | 状态 |
|----|------|
| 节点 test server :5020 | **未启动** |
| `run-fw-detector-dialog-200-batch.js` | **未执行** |
| FW HTTP tone 开启率（20 样本） | 20/20 |

**无法在本轮统计**：

- candidate rank change（真实 detector）
- candidate accepted count
- KenLM selected count
- 最终修复数

**替代证据**：§4 排序模拟 + §2 HTTP tone 全通 + 主链代码追踪。

---

## 第十部分 — 待补充项审计

| # | 项 | 状态 |
|---|-----|------|
| 1 | FW README 更新 `UtteranceResponse.tone` | **未更新** ✗ |
| 2 | toneModule diagnostics 完整 | **基本完整** ✓（`tone_inference_ms` / `toneTokenCount` / `toneConfidenceAvg` / `FwDetectorResult.toneModule`） |
| 3 | toneTokenCount 稳定 | **稳定** ✓（zh 样本 100% 有 token） |
| 4 | wTone 可配置 | **可配置** ✓（`features.fwTone.wTone`，默认 1.0） |
| 5 | toneMatchScore 可观测 | **部分** △（pipeline 内部 + 单测；未暴露到 job result JSON） |

---

## 最终结论

### 1. ToneModule 是否真正进入主链？

**是。** FW HTTP 20/20 返回 `toneEnabled=true`；Node 代码路径 `ctx.asrResult?.tone` → `fw-sentence-rerank-pipeline` 已接线。

### 2. ToneModule 是否真正影响排序？

**是。** `finalCandidateScore = base + wTone * toneMatchScore` 已在 rerank pipeline 执行；少冰案例与 14% 模拟排序翻转可证。

### 3. ToneModule 是否满足 ≤20ms？

**有条件满足。** P50=9ms，P95=16ms；P99=20ms 压线，MAX=28ms 偶发超标。

### 4. Legacy Tone 是否彻底移除？

**主链是。** `fw-detector` 无 `toneDistance` / `textToToneSyllables(span)`；工具函数定义仍留于 `tone-pinyin.ts`（非运行时路径）。

### 5. 是否通过 ToneModule P0 Runtime Acceptance？

**有条件通过（Conditional Pass）。**

| 通过 | 未通过 / 待补 |
|------|----------------|
| 链路贯通（FW HTTP） | Node :5020 E2E dialog_200 批测 |
| toneTokens 回传 | FW README 文档 |
| Dedup 架构解耦 | 全响应路径统一 tone 字段（fail-open 一致性） |
| 排序信号有效 | toneMatchScore 写入对外 job diagnostics |
| Legacy 主链清理 | — |
| P95 性能 | MAX 28ms 长尾 |

### 6. 若需完全通过 — 必须补什么？

1. **启动节点 + dialog_200 FW Detector 批测**（Tone On/Off 对比 rank/apply 计数）
2. **更新 `faster_whisper_vad/README.md`**：文档化 `tone` 响应字段
3. **（可选小修复）** 所有 `UtteranceResponse` 早期返回路径附带 `tone: { toneEnabled: false, skippedReason }`
4. **（可选）** 将 `toneMatchScore` / `toneScoreAppliedCount` 写入 job result 可观测字段

---

## 附录 — 审计命令复现

```powershell
# 1. 启动 FW（需 GPU + medium 模型）
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
$env:ASR_MODEL="medium"
.\.venv\Scripts\python.exe faster_whisper_vad_service.py

# 2. FW 审计
.\.venv\Scripts\python.exe tone_module\audit_runtime_acceptance.py --part all --out tone_module\_audit_full.json

# 3. Node 审计（需先 npm run build:main）
cd D:\Programs\github\lingua_1\electron_node\electron-node
node tests/experiments/tone-module-p0-runtime-acceptance.mjs
```

---

*本报告仅验证 ToneModule 是否真正工作，不包含 WER 提升或端到端 Apply 效果评估。*
