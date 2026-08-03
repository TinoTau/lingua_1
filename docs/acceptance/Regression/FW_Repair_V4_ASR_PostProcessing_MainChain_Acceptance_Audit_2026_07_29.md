<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_ASR_PostProcessing_MainChain_Acceptance_Audit_2026_07_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — ASR Post-Processing Main Chain Acceptance Audit

**Date:** 2026-07-29  
**Nature:** 运行验收（不改生产代码）  
**Corpus:** `test wav/dialog_200` 全量 200  
**Entry:** Electron `POST :5020/run-pipeline-with-audio` → `asr_service_id=faster-whisper-vad`  
**Evidence dir:** `docs/tone-v2/_audit_scratch/mainchain_acceptance_2026_07_29/`  
**Runner:** `docs/tone-v2/_audit_scratch/mainchain-acceptance-dialog200.cjs`

**Runtime setup (ops, not code):**
- `%APPDATA%\lingua-electron-node\electron-node-config.json`：`servicePreferences.faster-whisper-vad=true`，`spanAssemblyV4DiagnosticsLevel=trace`
- Electron Node 启动；FW `:6007` `utterance_ready=true`
- Tone 默认绑定：Frozen Production V2（Batch A；本机解析已验证）

---

## 1. Executive Summary

**Electron 主链已真实跑通 200/200（HTTP/pipeline 成功，fw_triggered=200）。**  
但 **Tone Participation 未达验收门禁（Evidence ≈100%）**：

| 指标 | 实测 | 门禁 |
| ---- | ---- | ---- |
| Pipeline Success | **200/200** | 全量成功 |
| Tone channel on / slices>0 / WTS>0 | **200/200** | 通道开启 |
| Pattern Hit / Attempt | **216 / 288 = 75.0%** | ≈100% |
| Pattern Miss（仍触发 no_pattern 语义） | **72** | ≈0 |
| Plain Fallback | **0** | 0 |
| Tone Exact SQL Hit（累计） | **16**（15 cases） | 证明 SQL 会跑 |
| KenLM queryCount | **520**（均 2.6/case） | 有查询意图 |
| KenLM 有效打分 | **失败**（`kenlmSubprocessErrorReason=timeout`，score=0，pickedIsRaw） | 须可用 |
| NMT 输出 | **空**（`nmt-m2m100` preference=false） | 主链含 NMT |

**Final Acceptance：CONDITIONAL FAIL（主链可达，Tone/KenLM/NMT 未达冻结标准）**  
**可否冻结并进入下一阶段：NO**

---

## 2. Runtime Architecture

本轮实测唯一路径：

```text
Electron (:5020 run-pipeline-with-audio)
  → Node TaskRouter
  → FW ASR faster-whisper-vad (:6007 /utterance, skip_text_dedup)
  → Tone Module (slices + words)
  → FW Detector V4 Span Sliding Window
  → Mandatory Tone Recall
  → Domain Vote / Compatibility graph（V4 内建，非第二条 Shadow 管道）
  → Sentence Assembly
  → KenLM gate（配置开启，但本轮 subprocess timeout）
  → NMT（本轮 preference 关闭 → 无译文）
```

**未出现：** Plain Recall（plainFallbackHitCount 全 0）、Node unit-test 代替主链。

---

## 3. Tone Participation

### Part A — Tone Evidence

| Metric | Value |
| ------ | ----- |
| Total recall windows with Tone attempt（`ngramTonePatternAttemptCount` 累计） | **288** |
| Tone Evidence Hit（`ngramTonePatternHitCount`） | **216** |
| No Pattern / Miss（`ngramTonePatternMissCount`） | **72** |
| Coverage | **75.0%** |
| Cases with any miss | **51 / 200** |
| Cases all-hit（attempt>0 且 miss=0） | **149 / 200** |
| Cases with 0 Tone slices | **0** |
| Cases with 0 WordTimeSpan | **0** |

说明：计数器是 **进入 Tone-aware Recall 的 window**，不是生成器吐出的全部 Fine Span。硬阻断后的 recallable window 上，Evidence 仍仅 75%。

**门禁 Tone Evidence ≈100%：FAIL**

典型 miss 窗口（有 slices+WTS 仍无 pattern）：`谢谢`、`一下`、`开始/開始`、`没有` 等（见 traces / rows）。

### Part B — Tone SQL

| Metric | Value |
| ------ | ----- |
| Plain fallback | **0**（全库） |
| Tone Exact Hit 累计 | **16** |
| Exact Hit cases | **15**（如 d005/d009/d018…） |
| Pattern Miss 时 | Mandatory Tone → 该窗 **不跑成功 Tone 键查询**（Fail Closed Empty） |

**结论：**  
- Tone SQL **会执行**（exact hit 与 pattern hit 窗口）。  
- **仍存在** Pattern Missing → 跳过有效 Tone Recall（72 次 miss）。

示例（d005 trace）：`acousticTonePattern=[1,3]` + `toneExactHitCount=1`。

---

## 4. Recall Statistics

| Item | Value |
| ---- | ----- |
| Pattern attempts | 288 |
| Pattern hits | 216 |
| Pattern misses | 72 |
| Tone exact hits | 16 |
| Plain fallback | 0 |
| Avg pipeline ms | 6089.97 |

Skip reasons（utterance 级 `toneSkippedReason`）：**none × 200**（通道未关）。

---

## 5. Candidate Statistics

| Item | Value |
| ---- | ----- |
| Summary candidateCount 累计 | **2513**（均 12.57/case） |
| Span 导出字段上可观测 toneReason/pattern | **弱**（多数 span candidate 仅见 replacement；诊断靠 toneDiag） |
| 有 Tone Exact 的 case | 15 |

**解释：** 公开 `spans[].candidates` 裁剪导致 “withTone” 启发式为 0，**不能**据此否定 Tone SQL；应以 `toneExactHitCount` + `exampleToneWindows.acousticTonePattern` 为准。

Domain Vote / Assembly 使用的是 Recall 产出的候选池；Tone 信息在评分链路中通过 Mandatory Tone 路径进入（有 pattern 时），miss 窗则为空候选而非 Plain。

---

## 6. Domain Vote

- V4 使用 FineSpan presence vote + candidate compatibility graph（`buildCandidateCompatibilityGraph`）。  
- **不是**独立 Shadow Domain 管道。  
- Tone 不在 Vote 层被“另造”；Vote 消费 Recall 候选。  
- 本轮无证据表明 Tone 在 Vote 被主动剥离；但 miss 窗本身无 Tone 候选可投。

**判定：** Tone 对 Domain Vote 为 **间接参与（经 Recall 候选）**；在 hit 窗成立，在 miss 窗缺失。

---

## 7. Sentence Assembly

- `candidateSentenceCount` 与 `spanCount` 同量级（例 d001：13/13）。  
- Assembly 组合进入 KenLM rerank（`combinationCount≥1`）。  
- **未**观察到退回独立 Lexicon-Only 第二管道；仍是 V4 Assembly。  
- `appliedCount` 多为 0（KenLM 未批准替换）。

---

## 8. KenLM

| Item | Value |
| ---- | ----- |
| kenlmQueryCount 累计 | 520 |
| kenlmApprovedCount | 0 |
| pickedIsRaw | 典型 true |
| kenlmSubprocessErrorReason | **`timeout`**（d001 等 traces） |
| kenlmScore | 0 |

**判定：** Assembly **尝试**把句子候选送入 KenLM，但本轮 **KenLM 子进程超时**，等价于未有效打分 → 不能声称 “KenLM 真正使用 Tone Candidate 完成选句”。

完整例子（d001）：

```text
ASR: 你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?
Tone: sliceCount=12(asr)/19(diag), WTS=19, pattern hit 马分→[4,2]
Recall: attempt=1 hit=1 exact=0 plain=0
Candidates: summary.candidateCount=13
Assembly: candidateSentenceCount=13, combinationCount=2
KenLM: queryCount=3, subprocess timeout, pickedIsRaw, applied=0
NMT: （本轮 preference 关）空
```

证据文件：`trace_d001.json`

---

## 9. Electron dialog_200

| Item | Value |
| ---- | ----- |
| Total | 200 |
| Success | **200** |
| Failure | **0** |
| fw_triggered | 200 |
| asr_service_id | `faster-whisper-vad` |
| Tone participation (pattern coverage) | **75%** |
| Avg candidates/case | 12.57 |
| Avg KenLM queries/case | 2.6 |
| Avg pipeline ms | 6090 |
| Wall clock | ≈21 min |

**这是 Electron 真链，不是 Node unit test。**

---

## 10. Trace Samples

30 traces：`trace_d001.json` …（见 `traceIds` in `summary.json`）。

| 样例 | 观察 |
| ---- | ---- |
| d001（含「你好」） | Pattern hit `[4,2]`；KenLM timeout；Assembly 有组合 |
| d005 | Pattern hit + **toneExactHit=1**（Tone SQL 命中） |
| d013 | Pattern miss×2（`没有` / `没有折`）→ 无 Tone Evidence 窗 |
| d002 | slices=16 WTS=16 但 pattern miss（`谢谢`） |

回归短语覆盖：语料含「你好」等；窗口级 Evidence 仍受 ASR 切词/繁简与 Mapping 影响。

---

## 11. Ownership Audit

| 资产 | Owner | 冲突？ |
| ---- | ----- | ------ |
| Tone Evidence（posterior） | Tone Module | 无 |
| Word Timestamp | FW WordInfo | 无（WTS=0 本轮 0 case） |
| Tone Mapping | Recall（`mapToneEvidenceForRecall`） | 无 |
| Candidate | Recall → V4 pool | 无 |
| Sentence | Assembly | 无 |
| Language Score | KenLM（配置 Owner） | **运行失效（timeout）** |

无双 Decision Owner；KenLM 为执行失败而非权属冲突。

---

## 12. Duplicate Logic / Architecture Audit

| 项 | 状态 | 说明 |
| -- | ---- | ---- |
| Shadow Pipeline | **未观察到运行** | freeze 测试禁止 shadowBeam |
| Plain Recall | **运行计数 0** | 诊断字段仍保留 always-0 |
| Tiny 生产默认 | **已改 V2**（Batch A） | Tiny 文件仍在 models/（TEST_ONLY 残留） |
| Legacy Detector / Span V2/V3 | 配置仅 V4 | 历史文件可后续删 |
| Compatibility graph | **V4 内建** | 候选关系，非第二 ASR/Tone 链 |
| Duplicate Timestamp | 本轮无 | words 保留 |
| Duplicate Pattern Fill | 无 | Mapping only |

---

## 13. Delete List（建议，本轮未删）

| Item | Reason | 可删？ |
| ---- | ------ | ------ |
| Tiny 等非生产 npz 默认引用残留文档/脚本 | 易误导 | YES（清理批） |
| `plainFallbackHitCount` 长期兼容字段 | 恒 0 | DEFER（诊断兼容） |
| P0 `loader.py` | 非主链 | DEFER |
| 旧 span V2/V3 源码树（若仍在） | 非生产路径 | 另开清理审计 |

---

## 14. Remaining Risks

1. **Tone Evidence 仅 75%** — Mapping 在部分繁体/多字 token/缺口窗仍失败 → Mandatory Tone 空窗  
2. **KenLM subprocess timeout** — 选句退回 raw，修复质量不可验收  
3. **NMT preference=false** — 主链尾段未跑  
4. Span 导出裁剪导致 Candidate Tone 字段难观测 — 需增强 diagnostics（非业务双链）  
5. `exampleToneWindows` 仅截断样例，不能代替全窗枚举  

---

## 15. Final Acceptance

```text
ASR POST-PROCESSING MAIN CHAIN ACCEPTANCE

ELECTRON DIALOG_200:
200/200 PIPELINE SUCCESS

TONE CHANNEL:
ALWAYS ON (slices>0, WTS>0)

TONE EVIDENCE COVERAGE:
75.0% (216/288) — FAIL vs ≈100%

NO_PATTERN / MISS STILL PRESENT:
YES (72)

TONE SQL EXECUTED:
YES (toneExactHit total 16; pattern-hit windows)

PLAIN RECALL:
ZERO

CANDIDATE / DOMAIN / ASSEMBLY:
V4 SINGLE PIPELINE; TONE VIA MANDATORY RECALL WHEN PATTERN EXISTS

KENLM:
QUERIES ATTEMPTED; SUBPROCESS TIMEOUT — NOT EFFECTIVELY SCORING

NMT:
NOT RUN (preference false)

SHADOW / SECOND PIPELINE:
NOT OBSERVED IN RUN

ACCEPTANCE:
CONDITIONAL FAIL

READY TO FREEZE MAIN CHAIN:
NO

NEXT:
1) Fix remaining Pattern Miss → Evidence ≈100%
2) Fix KenLM subprocess timeout
3) Enable NMT preference and re-verify tail
4) Re-run dialog_200 acceptance
```

---

## 最终必须回答

| # | 问题 | 答案 |
| - | ---- | ---- |
| 1 | Tone Evidence 是否真正覆盖所有 Fine Span？ | **否**（recall 窗覆盖率 75%；非 100%） |
| 2 | 是否仍存在 no_pattern？ | **是**（72 misses） |
| 3 | Tone SQL 是否真正执行？ | **是**（有 pattern 时；exact hit=16） |
| 4 | Candidate 是否真正携带 Tone？ | **部分**（Tone 路径候选存在；span 导出字段弱；靠 toneDiag/exact 证明） |
| 5 | Tone 是否真正参与 Domain Vote？ | **间接是**（经 Recall 候选；miss 窗无） |
| 6 | Tone 是否真正参与 Sentence Assembly？ | **间接是**（V4 候选句来自上述池） |
| 7 | KenLM 是否真正使用 Tone Candidate？ | **否（有效打分）** — 有 query 但 subprocess timeout |
| 8 | dialog_200 是否跑通完整主链？ | **Electron→ASR→Tone→Span→Recall→Assembly 是；KenLM 失效；NMT 未开** |
| 9 | 是否仍存在重复链路或历史兼容逻辑？ | **运行无第二生产链**；残留文件/诊断字段仍在 |
| 10 | 是否可以冻结当前 ASR 后处理主链并进入下一阶段？ | **否** |

---

**Artifacts**
- `mainchain_acceptance_2026_07_29/summary.json`
- `mainchain_acceptance_2026_07_29/rows.jsonl`
- `mainchain_acceptance_2026_07_29/trace_*.json`（30）
- `mainchain_acceptance_2026_07_29/smoke_d001.json`
