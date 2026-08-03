<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_WordTimeSpan_ToneSlice_MinimalOverlapContract_Audit_2026_07_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — WordTimeSpan / ToneSlice Minimal Overlap Contract Audit

**Date:** 2026-07-29  
**Nature:** 开发前只读审计（禁止改代码 / 配置 / 测试数据）  
**Evidence SSOT:** `docs/tone-v2/_audit_scratch/tone_evidence_ssot_attribution_2026_07_29/`  
**Code:** `tone-time-align.ts`、`inference.py`、`asr_worker_process.py`、`buildWordTimeSpans`、`utterance_asr.py`

---

## 1. Executive Summary

**唯一 Mapping Miss（d132）由 ASR 原始零时长 Word「诱」`[3.0, 3.0]` 直接造成。**

因果链（代码级）：

```text
Faster-Whisper WordInfo「诱」start=end=3.0
  → Tone inference: dur=0 < MIN_SLICE_SEC → short_duration_skipped（无 Slice）
  → Node buildWordTimeSpans: start/end 原样保留（batchOffset=0，未改 duration）
  → Recall Window「诱惑」you|huo 音节槽0覆盖「诱」
  → selectRealSliceForWordSpan: slice.end > 3 && slice.start < 3  → 永远 false
  → pattern=null / no_slice_overlap_word_time
```

**75 个 short_duration_skipped：** 74 个 duration==0，1 个 `0 < dur < 0.02`。其中 **仅 1 个**（d132「诱」）进入并造成 Mapping Miss。

**不修改通用 overlap 公式。** 闭区间会把零时长点同时绑到前后两个 Slice（「有」与「惑」），引入串位。

**唯一推荐结论：**

```text
A. FREEZE_AS_EVIDENCE_UNAVAILABLE
```

---

## 2. Current Runtime Contract

```text
有有效 (start < end) 时间范围 + 真实相交 AcousticToneSlice
  → Mapping 可读 posterior → pattern

无有效时间范围（含 start==end）或无相交真实 Slice
  → 不得伪造 Evidence → pattern=null + 诊断
```

当前实现已符合该合同；d132 是合法 Evidence Unavailable，不是 SSOT/导出 bug。

---

## 3. d132 Full Trace

**ASR text:** `游泳自卡本月月底到汽蓄飞游,有诱惑吗?`  
**Batch Count:** 1（utterance-local ≡ chunk-local）  
**WTS=17 / Slice=16 / short_skip=1**  
**Miss Window:** `诱惑` / `you|huo` / `mappingMissReason=no_slice_overlap_word_time`

### 3.1 零时长 Word 与邻接

| 阶段 | Word | start | end | duration | 时间基准 | 状态 |
| ---- | ---- | ----: | --: | -------: | -------- | ---- |
| FW 原始（经 worker 透传） | 诱 | 3.00 | 3.00 | 0 | chunk-local | start==end |
| API / evidenceProduction | 诱 | 3.00 | 3.00 | 0 | utterance-local | `short_duration_skipped` |
| Node merged Word | 诱 | 3.00 | 3.00 | 0 | utterance-local | **未改 duration** |
| WordTimeSpan | 诱 | 3.00 | 3.00 | 0 | utterance-local | 仍建 Span（indexOf 成功） |
| Tone production | 诱 | 3.00 | 3.00 | 0 | utterance-local | 无 Slice |
| AcousticToneSlice | （无） | — | — | — | — | 未生成 |
| 邻接 Slice「有」 | 有 | 2.92 | 3.00 | 0.08 | utterance-local | slice_created |
| 邻接 Slice「惑」 | 惑 | 3.00 | 3.16 | 0.16 | utterance-local | slice_created |
| Mapping slot0「诱」 | 诱 | 3.00 | 3.00 | 0 | utterance-local | **无 overlap → null** |
| Mapping slot1「惑」 | 惑 | 3.00 | 3.16 | 0.16 | utterance-local | 本可 HIT（未执行到，因 slot0 已失败） |

### 3.2 Window 失败机制

```text
raw「诱惑」位于 raw[15:17]
syllableCount=2 → 槽0 字符「诱」、槽1 字符「惑」
槽0 → WTS「诱」[3,3] → selectRealSliceForWordSpan → [] → missReason=no_slice_overlap_word_time
```

**哪个 Word 为零时长：** 「诱」  
**对应音节槽：** `you|huo` 的第 0 槽  
**哪个 Recall Window：** exampleToneWindows 中的「诱惑」  
**为何 pattern=null：** 首音节无真实相交 Slice；Mapping 正确拒绝伪造。

---

## 4. Zero-Duration Source

### 4.1 代码路径表

| 文件 | 函数 | 输入 | 输出 | 是否可能产生 start==end |
| ---- | ---- | ---- | ---- | ------------------------ |
| `asr_worker_process.py` | transcribe 结果打包 | faster-whisper `w.start/w.end` | dict `start/end` **原样** | **YES — 上游原样透传** |
| `utterance_asr.py` / `result_listener.py` | `_word_from_dict` | dict | `WordInfo(start,end)` **原样** | YES（透传） |
| `api_routes.py` | segments 序列化 | WordInfo | JSON words | NO（不改时间） |
| `inference.py` | `run_tone_inference` | WordInfo | diagnostic；**不改 Word** | NO（只跳过） |
| `asr-step.ts` | batch offset | word.start+offset | 同加 offset | **仅当 start≠end 时保持 duration；零时长仍为零** |
| `tone-time-align.ts` | `buildWordTimeSpans` | word.start/end + offset | WTS | **不创造零时长；不消除零时长** |
| `tone-time-align.ts` | `selectRealSliceForWordSpan` | WTS×slices | slice\|null | NO（消费侧） |

### 4.2 代码级结论

```text
ZERO_DURATION_SOURCE:
FW raw word timestamp
（faster-whisper word_timestamps 输出 start==end，经 asr_worker_process 原样透传）
```

**Node 未改变该 Word 的 duration**（d132 batchIndex=0，offset=0；`start' = start+0`，`end' = end+0`）。

无证据表明本链路存在额外 `round()` 把非零压成零；worker 对 word 时间为 getattr 直写。

---

## 5. Current Overlap Semantics

唯一消费函数：

```ts
// tone-time-align.ts — selectRealSliceForWordSpan
slice.end > span.start && slice.start < span.end
```

| 场景 | 行为 | 判定 |
| ---- | ---- | ---- |
| 正常全覆盖 `[1,1.2]`∩`[1,1.2]` | HIT | **正确** |
| 部分重叠 `[1,1.2]`∩`[1.1,1.3]` | HIT | **正确** |
| 仅边界接触 `[1,1.2]`∩`[1.2,1.4]` | NO | **正确**（半开区间语义） |
| 零时长 `[3,3]`∩任意 | **永远 NO** | **正确拒绝**（无开区间长度） |
| 若改为 `>=`/`<=`，零点 `[3,3]` | 同时命中「有」`[2.92,3]` **与**「惑」`[3,3.16]` | **串位风险** |

**是否应修改通用 `>` / `<`？ → 否。**

闭区间不能作为零时长“修复”，会破坏边界接触语义并造成相邻音节错误绑定。

---

## 6. Short-Duration Classification

来源：dialog_200 全量 `evidenceProduction`（75 条）。

| 类型 | 数量 |
| ---- | ---: |
| duration == 0 | **74** |
| 0 < duration < 0.02 | **1**（d158「谢谢!」dur≈0.02） |
| invalid / negative | **0** |

| 类型 | 进入 Tone-aware Miss Window（example 可证） | 造成 Mapping Miss |
| ---- | ----------------------------------------: | ----------------: |
| duration == 0 | **1**（d132「诱」） | **1** |
| 0 < duration < 0.02 | 0 | 0 |
| invalid / negative | 0 | 0 |

其余 74 个 short skip：**不参与导致 Miss 的 Tone-aware 目标窗**；相邻/其他窗仍可生成完整 pattern（本轮总 Miss 仅 1）。

**不得**把 `short_duration_skipped=75` 解释为 75 个必须修复的生产事故。

---

## 7. Business Impact

| 项 | 值 |
| -- | -- |
| Pattern Miss | 1 / 289 = **0.35%** |
| 根因 | ASR 偶发零时长 Word → 无真实音频区间 → 无 Slice |
| 伪造修复收益 | 把统计从 99.65%→100%，但无真实 Tone |
| 下游 | 已有 `pattern=null` / 无 Tone SQL 路径；无强制 Fail Closed |

→ **保持 1 次合法 pattern=null 优于增加代码复杂度。**

---

## 8. Minimal Options Comparison

| 方案 | 代码改动 | 维护成本 | 错配风险 | 对未来扩展影响 | 是否推荐 |
| ---- | -------: | -------: | -------: | -------------: | -------- |
| **0 保持现状** | 0 | 最低 | 无 | 无 | **是（主方案）** |
| A 删除零时长 Word | 中 | 高 | 文本/Span 错位 | 大 | 否 |
| B 显式 unavailable | 极小（诊断措辞） | 低 | 无 | 无 | 可选文档化，非必须开发 |
| C 真实音频最小扩窗 | 中 | 中 | 邻音泄漏 | 中 | 否（本残差不值） |
| D 修改通用 overlap | 小 | 中 | **高（双绑）** | 大 | **否** |

---

## 9. Maintenance Impact

方案 0：

- 不增加特殊 Case 分支  
- 不双端维护零时长规则  
- 无 epsilon / 容差 / 邻片借用  
- Tone Module 继续决定能否生成 Evidence；Mapping 只读相交  

符合单一职责。

---

## 10. Recommended Single Solution

```text
A. FREEZE_AS_EVIDENCE_UNAVAILABLE
```

冻结合同：

```text
无有效时间范围（start >= end）
→ Tone Module 不生成真实 Slice（short_duration_skipped）
→ Mapping 不伪造 → pattern=null
→ 诊断保留 short_duration_skipped + no_slice_overlap_word_time
```

可选后续（非本轮、非必须）：仅补 d132 回归测试与文档；**不改生产业务逻辑**。

---

## 11. Files and Functions for Future Repair

若未来仍要动（不推荐现时）：

| 意图 | 位置 | 说明 |
| ---- | ---- | ---- |
| 源头扩窗 | `inference.py` `run_tone_inference` | 仅真实音频；保留 target vs inference 窗 |
| 诊断归因精度 | `tone-miss-attribution.ts` | 零时长诊断行与 WTS 用同一 exclusive 公式时无法相交，归因可能落成 `slice_exists_but_no_overlap`（观测瑕疵，非业务错误） |
| **禁止** | `selectRealSliceForWordSpan` 改闭区间 | 串位 |

---

## 12. Minimal Test Plan（建议，本轮不实施）

| Case | 期望 |
| ---- | ---- |
| Word `[1,1.2]` Slice `[1,1.2]` | HIT |
| Word `[1,1.2]` Slice `[1.1,1.3]` | HIT |
| Word `[1,1.2]` Slice `[1.2,1.4]` | NO OVERLAP |
| Word `[1.2,1.2]`，前后有 Slice | pattern=null；不得绑邻片 |
| Word dur=0.01 | short_duration_skipped；无 Slice |
| **d132「诱惑」** | 固定回归：允许 pattern=null |

---

## 13. Target List

- [x] d132 零时长 Word 定位  
- [x] 源函数/透传路径确认  
- [x] Overlap 语义与闭区间风险证明  
- [x] 75 short skip 分类与业务影响  
- [x] 单一方案推荐（冻结）  

---

## 14. Check List

- [x] 只审计不改代码  
- [x] 无新框架 / fallback / 伪造 Tone 建议  
- [x] 唯一结论格式  

---

## 15. Final Verdict

```text
A. FREEZE_AS_EVIDENCE_UNAVAILABLE
```

当前行为在「没有真实音频范围时拒绝生成 Tone」上是正确的；不要为消灭最后一个统计 Miss 增加复杂度。

---

## 十六、最终问答

1. 哪个 Word 零时长？ → **「诱」`[3.0, 3.0]`**  
2. 在哪产生？ → **FW raw faster-whisper timestamp（`asr_worker_process` 透传）**  
3. Node 是否改 duration？ → **否**  
4. 是否直接导致唯一 Miss？ → **是（Window「诱惑」槽0）**  
5. 75 中多少零时长？ → **74**  
6. 多少 0&lt;dur&lt;0.02？ → **1**  
7. 多少真正影响 Tone-aware Recall Miss？ → **1**  
8. 严格 overlap 对正常区间是否正确？ → **是**  
9. 是否应改 `>`/`<`？ → **否**  
10. 是否应借用相邻 Slice？ → **否**  
11. 是否需要真实音频扩窗？ → **本残差不需要**  
12. 可否接受 pattern=null？ → **是**  
13. 最简单正确合同？ → **无有效时间范围 ⇒ Evidence Unavailable ⇒ null**  
14. 建议改哪些文件？ → **生产逻辑：无；可选仅补回归测试**  
15. 可否不改业务直接冻结？ → **是**  
16. 下一步？ → **直接冻结（可补 d132 回归测试，无业务开发）**
