<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lexicon_Cleanup_Phase1_Validation_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lexicon Cleanup Phase1 — Validation Report

**Date:** 2026-07-18  
**Type:** Validation Only（禁止改代码 / 数据库 / `term_domain_tags` / Runtime）  
**对照基线（上一轮）：** Scope Wiring 后 · Phase1 前 · `domain_vote_accuracy_revalidation_pre_phase1.json`  
**本轮证据：**

| 层 | 工件 | 说明 |
|----|------|------|
| Offline SpanAssembly 重放 | `tmp/.../domain_vote_phase1_validation.json` | 与上轮同协议：C1 `raw_asr_text` → V4 Orchestrator |
| Text repair 全量 200 | `tmp/.../lexicon_cleanup_phase1_dialog200_mock_batch.json` | `:5020` `/run-lexicon-mock`（**无 ASR**；当前 `servicePreferences` 全关，未改配置启 ASR） |
| Phase1 开发报告 | `Lexicon_Cleanup_Phase1_Development_Report.md` | 39 词 tags 变更 |

**未执行：** 带 WAV 的 dialog_200 全链路 E2E（需改 APPDATA `servicePreferences` 并拉起 faster-whisper；本轮验证禁止为跑测改运行配置）。Winner / Domain·Base Recall 以 **Offline 重放** 为 SSOT 对照；Repair / CER 以 **mock 全量 200** 为准。

---

## Executive Verdict

| 问题 | 结论 |
|------|------|
| Phase1 是否产生可观测正向？ | **是，幅度小**：medical winner 2→4；meeting −3；挂号相关 hospital case 纠偏 |
| Meeting / Tech_AI 霸榜是否解除？ | **否**：仍 **104+73=177/200（88.5%）** |
| 200/200 fine winner / general=0 是否改善？ | **否**：仍 200 fine · 0 general |
| Repair 是否明显恶化？ | **否**：mock CER raw 0.235 → final **0.220**；改善 34 / 劣化 8 |
| **是否可进入 Phase2？** | **可以（有条件）** — 继续 Lexicon Cleanup；**不可**进入 Assembly Diversity |

---

## 1. Winner Distribution（Offline · 与上一轮逐项对比）

| Domain | 上一轮 (Pre-Phase1) | 本轮 (Post-Phase1) | Δ |
|--------|--------------------:|-------------------:|--:|
| meeting | 107 | **104** | **-3** |
| tech_ai | 71 | **73** | **+2** |
| coffee | 10 | **8** | **-2** |
| tourism_transport | 4 | 4 | 0 |
| tourism_hotel | 4 | 4 | 0 |
| medical | 2 | **4** | **+2** |
| bakery | 2 | **3** | **+1** |
| general | 0 | 0 | 0 |
| **合计 fine winner** | **200** | **200** | 0 |

### Meeting / Tech_AI Winner 数量

| 指标 | 上一轮 | 本轮 |
|------|-------:|-----:|
| Meeting Winner | **107** | **104** |
| Tech_AI Winner | **71** | **73** |
| Meeting+Tech_AI 占比 | 89.0% | **88.5%** |

**Mock 全量 200 Winner Dist**（与 Offline 一致）：meeting 104 · tech_ai 73 · coffee 8 · medical 4 · bakery 3 · tourism_transport 4 · tourism_hotel 4。

---

## 2. Domain Distribution（Vote / Recall 侧）

| 指标 | 上一轮 | 本轮 | Δ |
|------|-------:|-----:|--:|
| Domain Lookup executed | 200/200 | 200/200 | 0 |
| Fine-domain winner | 200 | 200 | 0 |
| `utteranceDomain=general` | 0 | 0 | 0 |
| `insufficientEvidence` | 0 | 0 | 0 |
| `sameDomainCandidateCount>0` | 197 | **198** | **+1** |
| 场景主域错配（启发式） | 64 | **63** | −1 |

---

## 3. Base Recall / Domain Recall 命中

Offline metrics（均值 / 合计）：

| 指标 | 上一轮 | 本轮 | Δ |
|------|-------:|-----:|--:|
| avg Domain Recall hits | 20.455 | **20.54** | +0.085 |
| total Domain Recall hits | 4091* | **4108** | +17 |
| avg Base candidates | 9.435 | **9.57** | +0.135 |
| total Base candidates | — | **1914** | — |
| avg Vote-eligible | — | 20.54 | — |
| avg sameDomain | — | 4.485 | — |

\*上一轮 total 由均值×200 推得；本轮为实测合计。

**解读：** Phase1 清掉部分噪声 tag 后，Domain/Base 命中量级基本持平（略升），说明 **未出现召回塌陷**；亦说明 Inflation 主体未动，命中结构未换血。

---

## 4. Repair Rate / KenLM

**来源：** `/run-lexicon-mock` × 200（固定 C1 raw + manifest expected）

| 指标 | 本轮 |
|------|-----:|
| textChanged（有修复写出） | **49/200（24.5%）** |
| appliedCount>0 | **49/200** |
| CER 改善（final&lt;raw） | **34/200（17.0%）** |
| CER 劣化 | **8/200（4.0%）** |
| Exact Match (final) | **28/200** |
| avg CER raw | **0.2348** |
| avg CER final | **0.2199** |
| KenLM approved 计数合计 | **0**（summary 字段；与 applied 不同步，见下） |
| KenLM vetoed 合计 | **0** |

**KenLM 说明：** mock 路径 `summary.kenlmApprovedCount` 恒 0，但 `appliedCount=49` 与 CER 改善并存——**不能**用 approved 计数否定 KenLM；本轮以 **CER 改善率 / applied** 作为修复代理。  
**与上一轮 E2E 音频批测不可直接数值对齐**（上一轮 Vote 基线为 Offline；历史 WAV E2E 为 Expansion 等旧批次）。同协议可比的是 **Offline Winner 表**。

---

## 5. Winner 变化明细（7 case）

| Case | Scenario | Pre Winner | Post Winner | 说明 |
|------|----------|------------|-------------|------|
| d056 | hospital | meeting | **medical** | 挂号纠域见效 |
| d146 | hospital | meeting | **medical** | 同上 |
| d181 | cafe | meeting | **bakery** | 蓝莓马芬去 meeting 污染后旁路变化 |
| d089 | lexicon_homophone | meeting | tech_ai | Base Only 清「安排」等后的连锁 |
| d134 | lexicon_homophone | meeting | tech_ai | 同上 |
| d093 | cafe | coffee | meeting | **回退**（咖啡场景） |
| d183 | cafe | coffee | meeting | **回退** |

Hospital：`挂号`→medical 使 d056/d146 纠偏；d010/d100/d190 仍 tech_ai（「常规」等噪声仍在）。  
`医生/头痛` 纠域后 d010 medical 分升至 3.54，但仍负于 tech_ai 4.35。

---

## 6. 典型错误案例（本轮仍在）

| Case | Scenario | Winner | 现象 |
|------|----------|--------|------|
| d004/d005/d006 | meeting | tech_ai | 会议场景技术词主导（多域可争，但 meeting 标签海仍在） |
| d008/d009 | taxi | meeting | 出行句仍投 meeting |
| d010 | hospital | tech_ai | 医生已 medical，仍被「常规」等 tech 压过 |
| d011/d012 | hospital | meeting | 医疗句 meeting 噪声 |
| d037/d038 | restaurant | meeting/tech_ai | 餐饮未归 food_order |
| d093/d183 | cafe | meeting | Phase1 后 coffee→meeting **回退** |

**修复劣化例（mock）：** d028/d073 课堂题；d083/d173 凉菜→「医护茶」等误修。

**修复改善例（mock）：** d007 中关村；d021 上线/文档；d036 风险等。

---

## 7. 与上一轮逐项对照总表

| 项 | 上一轮 | 本轮 | 判定 |
|----|--------|------|------|
| Meeting Winner | 107 | 104 | 微降 |
| Tech_AI Winner | 71 | 73 | 微升 |
| medical Winner | 2 | 4 | **正向** |
| coffee Winner | 10 | 8 | 微降 |
| fine winner 200 | 是 | 是 | 未解过度投域 |
| sameDomain>0 | 197 | 198 | 持平+ |
| Domain Recall 命中 | ~20.5/case | 20.54/case | 持平 |
| Base 候选 | ~9.4/case | 9.57/case | 持平 |
| CER final (mock) | — | 0.220 | 有修复空间 |
| CER 改善率 | — | 17% | 可接受 |
| 禁止词（机场/会议…） | 未动 | 未动 | 合规 |

---

## 8. 是否可以进入 Phase2？

# **可以进入 Lexicon Cleanup Phase2（有条件）**

| 条件 | 要求 |
|------|------|
| Phase2 范围 | 继续 **tags 治理**（Weak 锚点人审、更多 Base Only、错域），**不是** Assembly / KenLM 优化 |
| 分类标准 | 遵循 `Lexicon_Classification_Standard_Audit_V2`：**区分能力**，禁止「7216 一刀切」 |
| 禁止清单策略 | 机场/预订/会议/开发… **人审后**再动，不得批量清空 |
| Phase1 残差 | `domain_lexicon` 未 rematerialize — Phase2 应含 **物化同步** 或验收其影响 |
| Assembly Diversity | **仍禁止**（Vote 准确率/过度投域未达 Verdict A） |

**不可进入 Phase2 的情形（本轮未触发）：** 若出现大规模 Winner 崩坏或 CER 崩盘——本轮未见。

---

## 9. 本轮边界

```text
未修改代码 / 数据库 / term_domain_tags / Runtime
未改 servicePreferences（故未跑 WAV E2E）
禁止继续开发
等待是否启动 Phase2 的明确指令
```

**一句话：** Phase1 点修有效但不够；Meeting/Tech_AI 仍主导；**可以进入 Phase2 标签治理**，**不能**进入 Assembly。
