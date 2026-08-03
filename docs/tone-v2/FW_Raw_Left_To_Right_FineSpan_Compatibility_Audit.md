> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Raw Left-To-Right FineSpan Compatibility Audit

| Field | Value |
|------|-------|
| Date | 2026-07-21 |
| Task | FW Raw Coarse Span Left-to-Right Fine Span Segmentation Audit |
| Nature | **Read-only** · architecture compatibility · impact scope · minimal change estimate |
| Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |
| Related | [`Runtime_dialog_200_GT_First_Loss_PhaseA_CallGraph.md`](./Runtime_dialog_200_GT_First_Loss_PhaseA_CallGraph.md) · First-Loss Provenance Audit |
| Code change | **NONE**（本轮禁止开发） |

---

## 1. Executive Verdict

```text
REQUIRED_COMPATIBILITY_CLASS: B
ARCHITECTURE_CHANGE_REQUIRED: LIMITED
DUAL_PATH_REQUIRED: NO
```

当前 Fine Span 生成权在 **`generateGlobalWindows`**：对整句拼音音节流做 **长度 2～5 的全量重叠滑窗枚举**（非按粗 Span 内顺序扫描）。下游 **不硬性要求** 重叠滑窗才能工作，但：

1. **Recall** 以「先有 Window → 再 Recall」为合同；顺序式只需把 *lookahead options* 临时当作 Window 查询，**可复用** `recallTopKForWindows` / `recallSpanTopKV3`。
2. **Presence Vote** 文档写「fine span」，生产却按 **`buildFineSpanCandidatePool` → 每个 coarse span 一池** 计票；重叠细窗 **不会各自加票**。顺序式若继续按粗 Span 池投票 → Vote **可原样复用**；若对齐冻结文案改为「有序 FineSpan 一票」→ Vote **语义会变**（属 LIMITED ADJUSTMENT，不是大重构）。
3. **Assembly** 已用 overlap 拒绝 / 子集枚举补偿全滑窗冲突；有序低重叠后可 **复用**，补偿负担下降，但「同 span 多候选择一 + 跨粗 Span 组合」仍是正常职责。
4. **Tone** 已由 `rawStart/rawEnd` + word timestamps 映射，与游标字符区间兼容（PARTIAL：错位条件仍在）。

**无** 可用的正式左到右 Fine Span 扫描主链；IME beam / 已删 greedy 不得当作 Fine Span Generator 复用。

```text
结论：主要替换 Fine Span Generator；Recall / Bucket / Cap / KenLM 可复用；
Vote 视是否把计票单位从 coarse 池改为有序 FineSpan 而定（REUSE 或 LIMITED）；
禁止双链路 / shadow。
```

---

## 2. Audit Scope

| In scope | Out of scope |
|----------|--------------|
| 只读代码与冻结合同 | 改代码 / 配置 / 词库 |
| Fine Span 生成权与重叠关系 | 调整 Recall TopK / Vote 0.75 / Cap 16 |
| 下游依赖与最小调整范围 | 实施顺序扫描开发 |
| 最小回溯（上一 Fine Span）可行性 | 复杂状态机 / 音频实时流式 |

「流式」在本报告中仅指：**FW Raw 粗边界已固定后，按字符顺序逐步确认 Fine Span**。不是 ASR partial、不是边听边输出、不是重建 VAD 粗切分。

---

## 3. Frozen Architecture Baseline

不得改变（本审计假设目标设计遵守）：

```text
FW Raw ownership（粗边界）
Tone timestamp-only path
Lexicon / Pinyin Recall ownership
FineSpanDomainSet · One Span One Vote（合同语义）
DOMAIN_BUCKET_RETENTION_RATIO = 0.75
Multi-Bucket + Base
maxSentenceCandidates = 16
prefilledCombinations required
KenLM merged-pool · 整句最终输出
```

合法长度冻结值（`v4-limits.ts`，审计不得自定）：

```text
windowMinSyllables = 2
windowMaxSyllables = 5
maxBoundaryCrossCount = 1
maxGlobalWindowCount = 120
maxBoundaryWindowCount = 40
maxSqlPerUtterance = 150
```

---

## 4. Current Fine Span Ownership

### 4.1 Strategy classification

```text
CURRENT_FINE_SPAN_STRATEGY:
Utterance-global overlapping syllable sliding windows (len 2..5),
tagged with coarse-span membership / boundary_cross;
then blockedFilter + truncateWindows; then Recall per surviving window.
```

对应任务选项：**A + B 混合**（全量固定长度滑窗枚举，起点为每个音节位置），**不是** C（词库反推窗）或 D（Recall 反向创建 Span）。E 仅体现在后续 block/truncate/budget，不是第二种生成算法。

```text
FINE_SPAN_OWNER:
span-assembly-v4/generate-global-windows.ts::generateGlobalWindows
```

| Item | Value |
|------|-------|
| 入口 | `span-assembly-v4-orchestrator.ts` → `generateGlobalWindows` |
| 调用者 | `runSpanAssemblyV4Orchestrator`（唯一生产调用） |
| 输入 | `rawText`, `globalSyllables[]`, `CoarseSpan[]` |
| 输出 | `GlobalWindowDescriptor[]` |
| Span / Window ID | `windowId = "${syllableStart}:${syllableEnd}"` |
| 字符 offset | `rawStart` / `rawEnd`（经 `syllableRangeToRawCharRange`） |
| 音节 range | `syllableStart` / `syllableEnd` |
| 拼音 | `windowPinyinKey` = 音节 `join('|')` |
| Tone range | **生成阶段不写**；Recall 时用 `extractAcousticTonePatternForRecall(rawStart,rawEnd,...)` |
| Timestamp | 同上，映射到 `windowTimeRange`（诊断 / Tone pattern） |

### 4.2 Span vs Window naming（关键合同张力）

| 名称 | 代码实体 | 作用 |
|------|----------|------|
| CoarseSpan | `partitionCoarseSpans` | FW Raw / IME 粗边界 |
| GlobalWindow / Fine window | `GlobalWindowDescriptor` | 重叠滑窗 = 当前「细窗」生成物 |
| FineSpanCandidatePool | `buildFineSpanCandidatePool` | **按 coarseSpanId 分组的候选池**（名含 Fine，实为粗池） |
| Vote「一 Span」 | `voteUtteranceDomainFromPool` 的每个 pool 元素 | **实际 = 一个 coarse span** |

```text
ONE_SPAN_ONE_VOTE_ACTUAL_UNIT:
Production: one vote pool per CoarseSpan
(Frozen docs wording: one fine span — contract/docs vs code drift already recorded
 in Fine_Span_Presence_Runtime_Compliance audit)
```

---

## 5. Current Call Graph

```text
FW Raw / ASR text
  → partitionCoarseSpans                    [coarse boundaries]
  → generateGlobalWindows                   [ENUM len=2..5 × all starts] ★ OVERLAP
  → blockedFilter                           [FILTER]
  → truncateWindows                         [TRUNCATE ≤120 / boundary≤40]
  → recallTopKForWindows                    [LOOP each window → SQL] ★
       └ tone extract by rawStart/rawEnd
  → resolveCompatibilityRelations           [COVERAGE mark isCovered / CONFLICT]
  → buildFineSpanCandidatePool              [GROUP by coarse span]
  → voteUtteranceDomainFromPool             [One pool = One vote set]
  → per retainedDomain:
       filterDomainCandidatesPerSpan
       selectPerSpanCandidates              [per-coarse TopK 8/6/4]
  → buildSentenceCandidates                 [ENUM non-overlap subsets + gaps]
  → mergeCrossBucketSentenceCandidates      [DEDUP + CAP 16]
  → KenLM + delta gate
  → whole-utterance text_asr
```

循环 / 枚举点：`generateGlobalWindows` 双层 for；`recallTopKForWindows` 逐窗；Assembly `allNonOverlapSubsets` × slots。

---

## 6. Sliding Window and Overlap Analysis

### 6.1 Does it generate full overlapping windows?

```text
FULL_SLIDING_WINDOW_ENUMERATION: YES
```

伪代码（与实现一致）：

```text
for len in [2 .. min(5, N)]:
  for i in [0 .. N-len]:
    emit window [i, i+len)
```

例：`我要一杯少冰奶茶`（假设 8 音节）会生成 **理论 22** 个窗（含 `我要`/`要一`/`一杯`/…/`少冰奶茶` 等全部重叠），再经 block/truncate。

| 度量 | 值 / 说明 |
|------|-----------|
| 每音节起点窗口数 | 最多 **4**（len=2,3,4,5，受剩余长度限制） |
| 理论窗数 N 音节 | \(\sum_{L=2}^{\min(5,N)}(N-L+1)\)；N=8→22，N=12→38，N=20→70 |
| 硬上限 | `maxGlobalWindowCount=120`；boundary 另 cap 40 |
| SQL 上限 | `maxSqlPerUtterance=150`（达限后后续窗 skip） |
| dialog_200 `fine_spans` 字段均值 ≈4.49 | **与 fw_spans 同值** → 该审计字段实为 **粗 Span 数**，**不是** 滑窗数 |

### 6.2 Who consumes which windows?

| Stage | 是否全部重叠窗进入 |
|-------|-------------------|
| Recall | **几乎是**：未 blocked 且未被 truncate、且未超 SQL budget 的窗 **逐个** 查询 |
| Domain Vote | **否**：先合并进 coarse 池；重叠窗 **不各自计票** |
| Assembly | **否直接用窗**：用候选 `rawStart/rawEnd`；重叠由 compatibility + subset 枚举处理 |

```text
OVERLAPPING_FINE_SPANS_REQUIRED_BY_RECALL: NO
（Recall 需要的是「有 query 窗」；不要求彼此重叠。当前实现碰巧用重叠枚举产生 query。）

OVERLAPPING_FINE_SPANS_REQUIRED_BY_DOMAIN_VOTE: NO
（计票单位是 coarse 池；重叠细窗不增加 domainScores。）

OVERLAPPING_FINE_SPANS_REQUIRED_BY_ASSEMBLY: NO
（Assembly 需要的是可替换区间候选；重叠是输入噪声，用拒绝/子集补偿，不是合同前提。）
```

---

## 7. Recall Dependency Analysis

| Question | Answer |
|----------|--------|
| Fine Span 与 Recall 谁先谁后？ | **先 Window，再 Recall** |
| Span–Recall 循环依赖？ | **无** |
| 顺序式能否同步局部命中？ | **能**：对 cursor 处各合法长度构造临时 `GlobalWindowDescriptor`（或等价结构）调用现有 `recallSpanTopKV3` / `recallTopKForWindows` |
| 是否只能先生成 Span 再 Recall？ | 生产主链是批量先生成；接口本身是 **(window → hits)**，支持局部调用 |

```text
RECALL_REUSABLE_WITHOUT_SEMANTIC_CHANGE: YES
（查询语义不变；改变的是「哪些窗被查询」与查询次数。）
```

内部 `localLengthOptions` ≠ 正式 `FineSpan[]`：目标设计允许内部比较 2～5，正式输出仅确认后的顺序序列——与当前「全部 options 都进正式窗列表」不同，但是 **生成策略** 变更，不是 Recall 合同变更。

---

## 8. Domain Vote Dependency Analysis

| Question | Answer |
|----------|--------|
| 是否允许 Fine Span 重叠？ | 候选可重叠；**计票池按 coarse 折叠** |
| 是否假设必然重叠？ | **否** |
| spanId 投票单位？ | 实际为 **coarseSpanId 一池** |
| 多候选？ | 同池内多候选 → `FineSpanDomainSet` 并集 → 每 domain 最多 1 票 |
| 滑窗数量是否进入 domainScores？ | **否**（不按窗计数） |

若顺序式仍输出候选，并继续 `buildFineSpanCandidatePool(by coarse)`：

```text
DOMAIN_VOTE_REUSABLE_WITHOUT_SEMANTIC_CHANGE: YES
```

若开发时改为「每个有序 FineSpan 一池」（更贴近冻结文案）：

```text
DOMAIN_VOTE_REUSABLE_WITHOUT_SEMANTIC_CHANGE: PARTIAL
```

票数基数会从「粗 Span 数」变为「有序细 Span 数」，`retainedDomains` 可能变化——这是 **对冻结合同 wording 的对齐**，不是保留旧滑窗。必须在开发方案中二选一并更新 SSOT 措辞一致性；**本轮不实施**。

```text
多候选投票模型（一 FineSpan → 多 candidates → DomainSet → 一次 span vote）
在顺序式下仍可保持，无需改 Presence Vote 公式 / 0.75。
```

---

## 9. Assembly Dependency Analysis

Assembly 正常职责：

```text
同槽多候选选择
跨粗 Span 路径组合
缺口填 canonical
文本去重
per-bucket / global cap
```

因全滑窗被迫承担的补偿：

```text
大量重叠 raw 区间 → allNonOverlapSubsets / pickOverlapsAny 拒绝
compatibility COVERAGE（长短窗父子）
枚举节点逼近 maxIntervalEnumNodes=1024
```

```text
ASSEMBLY_REUSABLE_WITHOUT_SEMANTIC_CHANGE: YES / PARTIAL
YES：接口 SpanReplacementPick[][] + buildSentenceCandidates 可复用
PARTIAL：输入从「高重叠多窗候选」变为「低重叠有序细 span 候选」后，
枚举规模下降；无需为顺序式重写 Assembly，但 overlap 逻辑应保留作安全网
```

> 若 Fine Span 改为有序、基本不重叠：Assembly **可直接复用**；组合策略不必推倒，但「全滑窗补偿」属性减弱。第一轮 First-Loss 主因 `CROSS_SPAN_COMBINATION_MISS` **不会仅因改为顺序细窗自动消失**（组合失败还有多 slot / budget / parent_fragment 丢弃等因）。

---

## 10. Tone Alignment Compatibility

Tone 时间范围来源：

```text
ASR word timestamps
  → WordTimeSpan[]
  → extractAcousticTonePatternForRecall(rawStart, rawEnd, syllableStart, syllableEnd, …)
  → acousticTonePattern / windowTimeRange
```

顺序游标若提供稳定的 `rawStart/rawEnd` + 音节 bounds，**同一函数可复用**。

```text
TONE_ALIGNMENT_COMPATIBLE: PARTIAL
```

错位条件（既有，非顺序式独有）：

| 条件 | 影响 |
|------|------|
| 无 acoustic slices / tone 关闭 | tone off，plain fallback |
| 字符–音节映射失败 | 无 pattern |
| word timestamp 与字符区间不对齐 | overlap miss / syllable mismatch 计数 |
| 回溯 MOVE/MERGE 改边界后未重算 Tone | 必须在 Fine Span 阶段内重跑 extract |
| 跨词切分（一字多音节 / 儿化等） | pattern 长度与 term 音节不一致 |

---

## 11. Ordered FineSpan Data Contract

目标输出仍可映射现有结构：

| 字段 | 顺序式是否可填 |
|------|----------------|
| `windowId` / span id | 可（建议稳定规则，如 `coarseId:start:end`） |
| `rawStart/rawEnd` | 可（游标） |
| `syllableStart/syllableEnd` | 可（字符→音节映射已有） |
| `windowPinyinKey` | 可 |
| `WindowCandidate` | 可（对确认窗 Recall 后附着） |
| `anchorCoarseSpanId` | 可（所属粗 Span） |

```text
LEFT_TO_RIGHT_SCAN_CAN_REUSE_CURRENT_FINE_SPAN_CONTRACT: PARTIAL
```

可复用 **候选 / Recall / Vote 池 / Assembly pick** 合同；不可复用的是 **「GlobalWindow = 全量重叠枚举结果」** 这一生成语义。`boundary_window`（跨 1 个粗边界）在「严格每粗 Span 内游标、不跨粗边界」目标下会 **REMOVE**，除非单独定义为可选例外（本审计建议：第一版 **不跨粗边界**，与目标模型一致）。

---

## 12. Minimal Rollback Compatibility

目标仅允许：当前 + 上一 Fine Span；操作 KEEP / MERGE / SPLIT / MOVE（±1～2 字）。

| 问题 | 结论 |
|------|------|
| 数据结构能否改 start/end？ | `GlobalWindowDescriptor` / candidate 均为可变普通对象；**生成阶段内**可改 |
| Span ID / trace？ | 改边界后必须换 `windowId` 并重记 diagnostics；旧 ID 作 before 快照 |
| Tone / Pinyin？ | **必须重算** range + 可选重跑 Recall |
| Recall？ | MERGE/SPLIT/MOVE 后应对受影响窗 **重新 Recall** |
| Domain Vote？ | 推荐时点：整句（或至少整粗 Span）FineSpan 固定后才 Vote → **回溯不影响已执行 Vote** |

回溯必须停在 Fine Span Generation 内部；**禁止** Vote/Bucket/Assembly/KenLM 之后改 Span。

---

## 13. Legacy and Duplicate Logic

| 搜索语义 | 结果 |
|----------|------|
| cursor / advance（Fine Span） | **无**正式 LTR Fine Span 扫描；`build-sentence-candidates` 的 cursor 仅用于 **gap 填空** |
| greedy / longestMatch | 生产 greedy Fine Span **已删除**（freeze 测试断言 `select-greedy-longest-parent-term` 等不存在） |
| Beam | **Pinyin IME decoder beam**（粗边界），非 Fine Span 主链；`run-coarse-sentence-beam-v4` 已删 |
| Shadow / 双 Vote | Presence Vote 单链；domain-rerank / graph vote 已删 |

```text
结论：没有可提升为正式主链的顺序 Fine Span 扫描器；不可复用 IME beam 充当 Fine Span Generator。
```

---

## 14. Current vs Target Call Graph

### 14.1 Current

见 §5（全量重叠枚举）。

### 14.2 Target minimal

```text
FW Raw
  → Coarse Span                         REUSE
  → Left-to-Right Fine Span Scan          NEW（替换 generateGlobalWindows）
       ├ local length options (2..5)      NEW（内部 lookahead）
       ├ Local Recall                     REUSE（recallSpanTopKV3 / topk-for-windows）
       ├ optional revise previous         NEW（最小回溯）
       └ Ordered FineSpan[]               ADJUST（输出语义；字段合同 PARTIAL REUSE）
  → Compatibility (coverage/conflict)     REUSE（输入变稀后仍可用）
  → FineSpanCandidatePool                 REUSE 或 ADJUST（若 Vote 改按 FineSpan 池）
  → Presence Vote                         REUSE（粗池）或 ADJUST（细池对齐合同）
  → Multi-Bucket filter/select            REUSE
  → Sentence Assembly                     REUSE
  → Cap 16 + KenLM                        REUSE
```

尽量避免 NEW：仅 Generator + 可选最小回溯为 NEW；其余 REUSE/ADJUST。

---

## 15. Compatibility Classification

```text
REQUIRED_COMPATIBILITY_CLASS: B
```

| Class | Why not |
|-------|---------|
| A | 不只是「换函数」：边界窗策略、窗 ID、可能的 Vote 池粒度、diagnostics 都要明确；全滑窗删除是主链替换 |
| C | 下游 **不** 强依赖重叠滑窗才能运行 |
| D | 代码证据充足，可判定 |

```text
ARCHITECTURE_CHANGE_REQUIRED: LIMITED
DUAL_PATH_REQUIRED: NO
```

---

## 16. Must Change

```text
1. generate-global-windows.ts（或等价）— 正式 Fine Span 生成策略
2. span-assembly-v4-orchestrator.ts — 接线：LTR 产出 → 现有 recall/vote 输入
3. blocked-window-filter / truncateWindows — 若仍适用需按「正式 FineSpan」重审；
   或在 LTR 内嵌合法长度/粗边界约束后删除对「海量窗」的 truncate 依赖
4. 冻结合同文档中 Fine Span 生成描述（若实施）— 明确非全滑窗
5. （若选细池计票）buildFineSpanCandidatePool 分组键 + SSOT「One Span」措辞对齐
```

---

## 17. May Change

```text
compatibility-graph 对 COVERAGE 的权重（输入重叠减少后）
diagnostics / trace（cursor、rollback、localOptions）
per-span candidate limit 是否改为 per-fine-span（当前 limit 按 coarseSpanCount）
boundary_window 是否完全废除
```

---

## 18. Must Not Change

```text
FW Raw 粗边界 ownership
Tone timestamp-only 路径与 extract 函数语义
Lexicon SSOT / term_domain_tags
Presence Vote 公式与 0.75
Multi-Bucket + Base 每桶
maxSentenceCandidates = 16
KenLM + minDeltaToReplace
整句最终输出
禁止双链路 / shadow / 旧滑窗兜底并行
```

---

## 19. Can Remove（开发阶段，本轮不删）

```text
generateGlobalWindows 全量双层枚举（被 LTR 替代后）
依赖「海量重叠窗」的 truncate 预算路径（若不再需要）
仅服务于全滑窗的部分 diagnostics 桶名（可选清理）
已删 greedy/beam Fine Span 残留 — 确认无回归引用即可
```

**禁止**保留旧滑窗生产链路作兼容兜底。

---

## 20. Risks and Blocking Gaps

| Risk | Severity |
|------|----------|
| Vote 池粒度：粗 vs 真细 — 实施时必须显式选择，否则「顺序 FineSpan」名实不符 | Medium |
| 废除 `boundary_window` 可能丢失跨粗边界术语召回 | Medium |
| 查询次数下降 ≠ 最终句候选上升（Assembly/组合仍是瓶颈） | Info（First-Loss 已证） |
| 回溯改边界后 Tone/Recall 漏重跑 | Medium |
| dialog_200 审计字段 `fine_spans` ≠ 滑窗数，历史指标易误读 | Low |

```text
BLOCKING_GAPS:
NONE
（有合同/实现粒度漂移，但不阻碍完成本兼容性判定）
```

---

## 21. Development Target List（不实施）

```text
1. 仅替换 Fine Span Generator 为粗 Span 内 LTR + 内部 lookahead Recall
2. 明确 Vote 池 = 继续 coarse OR 改为 ordered FineSpan（二选一写进方案）
3. 删除全滑窗枚举，禁止双路径
4. 最小回溯 KEEP/MERGE/SPLIT/MOVE 仅在粗 Span 内
5. 复用 Recall / Bucket / Assembly / Cap / KenLM
6. 更新 Runtime_SSOT Fine Span 生成章节
```

建议未来只读诊断点（本轮不开发）：见任务书 §十三 JSON（`cursorBefore/After`、`localOptions`、`rollback` 等）。

---

## 22. Acceptance Check List

| # | Question | Answer |
|---|----------|--------|
| 1 | 当前是否全量重叠滑窗？ | **YES**（音节 2～5） |
| 2 | Fine Span 生成权？ | `generate-global-windows.ts::generateGlobalWindows` |
| 3 | Fine Span vs Recall 先后？ | **先窗后 Recall** |
| 4 | Span–Recall 循环依赖？ | **无** |
| 5 | Domain Vote 依赖滑窗数量？ | **否**（依赖 coarse 池数量） |
| 6 | One Span One Vote 真实单位？ | **生产 = CoarseSpan 池**；文档写 fine span |
| 7 | Assembly 依赖重叠窗？ | **否**（补偿重叠，不要求重叠） |
| 8 | Tone 支持顺序 Fine Span？ | **PARTIAL（可映射，需注意错位）** |
| 9 | 顺序式能否输出当前数据结构？ | **PARTIAL** |
| 10 | 是否只需调 Generator？ | **主要是；Vote 池策略可选 ADJUST** |
| 11 | 必须修改文件？ | 见 §16 |
| 12 | 可删旧代码？ | 全滑窗枚举及相关 truncate 依赖（实施时） |
| 13 | 旧链路/兜底残留？ | **无**可复用 LTR；禁止新建双路径 |
| 14 | 需改冻结文档？ | **实施时 YES**（生成策略 + 可选 Vote 单位澄清） |
| 15 | 兼容性？ | **B** |

---

## 23. Final Verdict

```text
CURRENT_FINE_SPAN_STRATEGY:
Utterance-global overlapping syllable windows len∈[2,5] via generateGlobalWindows;
blocked + truncated; all surviving windows recalled; candidates grouped by CoarseSpan for Vote.

FINE_SPAN_OWNER:
span-assembly-v4/generate-global-windows.ts::generateGlobalWindows

FULL_SLIDING_WINDOW_ENUMERATION:
YES

OVERLAPPING_FINE_SPANS_REQUIRED_BY_RECALL:
NO

OVERLAPPING_FINE_SPANS_REQUIRED_BY_DOMAIN_VOTE:
NO

OVERLAPPING_FINE_SPANS_REQUIRED_BY_ASSEMBLY:
NO

ONE_SPAN_ONE_VOTE_ACTUAL_UNIT:
CoarseSpan candidate pool (docs say fine span; code groups by coarse)

LEFT_TO_RIGHT_SCAN_CAN_REUSE_CURRENT_FINE_SPAN_CONTRACT:
PARTIAL

TONE_ALIGNMENT_COMPATIBLE:
PARTIAL

RECALL_REUSABLE_WITHOUT_SEMANTIC_CHANGE:
YES

DOMAIN_VOTE_REUSABLE_WITHOUT_SEMANTIC_CHANGE:
YES (if keep coarse pools) / PARTIAL (if move to ordered FineSpan pools)

ASSEMBLY_REUSABLE_WITHOUT_SEMANTIC_CHANGE:
YES

REQUIRED_COMPATIBILITY_CLASS:
B

DUAL_PATH_REQUIRED:
NO

ARCHITECTURE_CHANGE_REQUIRED:
LIMITED

BLOCKING_GAPS:
NONE
```

```text
FW RAW LEFT-TO-RIGHT FINESPAN
COMPATIBILITY AUDIT COMPLETE — STOP
```
