# Pinyin IME v2 HintGate 必要性审计报告

**日期：** 2026-06-07  
**性质：** 只读事实审计（禁止改码 / 禁止调阈值 / 禁止删除 HintGate）  
**数据源：** `electron_node/electron-node/tests/lexicon-tone-dialog200-batch-result.json`（200/200 contract PASS）

---

## 执行摘要

| 问题 | 结论 |
|------|------|
| HintGate 是否真实存在并影响 span？ | **是**。`resolvePinyinImeV2Spans` 必经 `runPinyinImeV2HintGate`；`approvedSpanCount=0` 时 FW 直接 `no_spans` 早退，Recall/KenLM 不运行 |
| 它过滤了多少 IME proposal？ | 批测累计 `gateDroppedNoNeighbor=67`（**唯一** HintGate 拒绝信号；`gateDroppedSupport=0`，`gateDroppedMaxSpans=0`） |
| `no_spans` 有多少是 HintGate 导致？ | **40/134（30%）** 为 neighbor 门控杀光；**65/134（48%）** 为 normalizer 杀光；**29/134（22%）** 为无 CJK |
| d001 / d002 / d003 断点 | d001：**normalizer**（非 neighbor）；d002：**HintGate neighbor**；d003：**IME 提议错位**（进了 span 但非目标词） |
| 是否偏离原始设计？ | **部分偏离**。冻结文档写「IME 发现 span，KenLM 裁决」；实现中 HintGate 用 `recallSpanTopK` 做 **Recall 前置精度门控**，承担「证明值得修」 |
| 是否建议移除？ | **不建议整删**。建议 **降级 neighbor 门控** 或 **仅用于超额裁剪**；保留 normalizer 结构过滤 |

---

## 一、HintGate 代码入口表

| 文件 | 函数 / 符号 | 被谁调用 | 输入 | 输出 | 是否影响 span 进入 FW |
|------|-------------|----------|------|------|----------------------|
| `pinyin-ime-v2-hint-gate.ts` | `runPinyinImeV2HintGate` | `resolve-pinyin-ime-v2-spans.ts` | diffSpans, instability, boundaryTopK, config, `lexiconNearNeighbor` | `approved[]`, gate diagnostics | **是**（唯一审批门） |
| `pinyin-ime-v2-span-normalizer.ts` | `normalizePinyinImeV2Spans` | `runPinyinImeV2HintGate` 内部 | 三类 span 源 + rawAsrText | normalized spans / dropped | **是**（HintGate 第一步） |
| `resolve-pinyin-ime-v2-spans.ts` | `createLexiconNearNeighborProbe` | `runPinyinImeV2HintGate` 经闭包 | `rawSpan`, profile, minPrior | `boolean` | **是**（neighbor 否决） |
| `resolve-pinyin-ime-v2-spans.ts` | `resolvePinyinImeV2Spans` | `fw-detector-orchestrator.ts` | rawText, profile, enabledDomains | `FwSpanDiagnostics[]`, `pinyinImeV2` diag | **是** |
| `resolve-pinyin-ime-v2-spans.ts` | `mapApprovedSpansToFwSpans` | `resolvePinyinImeV2Spans` | approved spans | `FwSpanDiagnostics[]`（candidates 空） | **是** |
| `run-pinyin-ime-v2-span-proposal.ts` | `runPinyinImeV2SpanProposal` | `resolvePinyinImeV2Spans` | rawAsrText, dict, topK | diffSpans, boundary, instability | 间接（HintGate 上游） |
| `fw-detector-orchestrator.ts` | `runFwDetectorOrchestrator` | `fw-detector-step.ts` | JobContext | 若 `spanDiagnostics.length===0` → **早退** `no_spans` | **是** |
| `fw-sentence-rerank-pipeline.ts` | `runFwSentenceRerankPipeline` | orchestrator（仅 span>0） | approved FwSpanDiagnostics | recall + KenLM | 下游 |
| `local-span-recall.ts` | `recallSpanTopK` | neighbor 探针 + rerank | spanText, profile | hits | neighbor 路径 **是** |
| `pinyin-ime-v2-hint-gate.test.ts` | 单测 | Jest | mock neighbor | 断言 approve/reject | 规格文档 |
| `types.ts` | `PinyinImeV2ActiveDiagnostics` | 诊断输出 | — | `gateDropped*`, `approvedSpanCount` | 可观测 |

**注释 SSOT（代码）：**

```27:29:electron_node/electron-node/main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-hint-gate.ts
/**
 * ImeHintGate — sole span gate for pinyin-ime-v2 unique mainline.
 * Outputs raw-span ApprovedSpan only; never replacement text or apply actions.
 */
```

---

## 二、真实 span 生成链路

```text
rawAsrText
  → normalizeForImeAlignment + textToPinyinStream
  → decodeRawTextTopK (topK=5)
  → collectDiffSpansFromCandidates          → diffSpans (diffSpanCount)
  → aggregateDiffSpanSupport                → supportCount 回填
  → buildInstabilityRegions
  → applyBoundaryDiscovery
  → buildBoundaryCompatibleTopKDiff         → boundaryCompatibleTopKSpans
  → runPinyinImeV2HintGate
      → normalizePinyinImeV2Spans           → 合并 + 字数/音节结构过滤
      → sort by supportCount
      → [gate] supportCount >= minSupportCount (默认 2)
      → [gate] lexiconNearNeighbor(rawSpan) → recallSpanTopK(topK=1)
      → [gate] maxApprovedSpans (默认 4)
      → approvedSpanCount
  → mapApprovedSpansToFwSpans               → FwSpanDiagnostics (candidates=[])
  → [若 spans.length===0] orchestrator 早退 no_spans
  → runFwSentenceRerankPipeline
      → recallSpanTopK (正式 Recall, perSpanLimit)
      → Tone sort → buildSentenceCandidates → KenLM → Apply
```

### 数量层级（概念）

| 阶段 | 批测可观测字段 | 说明 |
|------|----------------|------|
| IME 原始 diff | `diffSpanCount` | 仅字符 diff 路径；**不含** boundary-only 案 |
| IME boundary 提议 | `boundaryCompatibleTopKSpanCount` | diff=0 时仍可产生提议（141 案） |
| normalizer 通过后 | `approved + gateDroppedNoNeighbor + gateDroppedSupport + gateDroppedMaxSpans` | 进入 HintGate 审批池 |
| normalizer 丢弃 | `normalizerDroppedCount` | 累计 175 次丢弃 |
| HintGate 批准 | `approvedSpanCount` | 66 案 >0 |
| 进入 Recall | `fw_triggered` / `summary.spanCount` | 与 approved 一致（66 案） |

---

## 三、dialog_200 全量统计

| 指标 | 数量 |
|------|------|
| total cases | **200** |
| `fw_reason=no_spans` | **134** |
| `fw_triggered=true` | **66** |
| `diffSpanCount > 0` | **30** |
| normalizer 后进入审批池（normPassed>0） | **106** 案 |
| `approvedSpanCount > 0` | **66** |
| `diffSpanCount > 0` 且 `approvedSpanCount = 0` | **14** 案 |
| `gateDroppedNoNeighbor`（全案累计） | **67** |
| `gateDroppedSupport`（全案累计） | **0** |
| `normalizerDroppedCount`（全案累计） | **175** |
| `skippedReason=no_approved_spans` | **105** |
| `skippedReason=no_cjk` | **29** |

### `no_spans` 根因分解（134 案）

| 根因 | 数量 | 占比 |
|------|------|------|
| **normalizer 杀光**（有 proposal 但 normPassed=0） | **65** | 48.5% |
| **HintGate neighbor 杀光**（normPassed>0 但 approved=0） | **40** | 29.9% |
| **无 CJK**（`skippedReason=no_cjk`） | **29** | 21.6% |

> **结论：** `no_spans` 的**第一大**原因是 normalizer（结构过滤），**第二大**是 HintGate neighbor；二者合计约 **78%**。

### `diffSpanCount > 0` 但 `approvedSpanCount = 0`（14 案）

```
d002, d020, d025, d031, d035, d047, d076, d080, d081,
d115, d125, d137, d170, d182
```

这类是判断 **HintGate 过强** 的关键集：IME 有字符 diff，但最终零 span。

---

## 四、重点案例 d001 / d002 / d003

### d001 — 钟贝 / 蓝美马分

| 阶段 | 值 |
|------|-----|
| rawAsrText | `你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?` |
| imeTopK | **5** |
| diffSpanCount | **0** |
| boundaryCompatibleTopKSpanCount | **2** |
| diffZeroBoundaryPositive | **1** |
| normalizerDroppedCount | **2** |
| gateDroppedNoNeighbor | **0** |
| approvedSpanCount | **0** |
| skippedReason | `no_approved_spans` |
| fw_reason | `no_spans` |

**判断：IME 未产生字符 diff；boundary 有 2 个提议，但 normalizer 全部丢弃 → 未到达 neighbor 门控。**

**断点：Proposal + Normalizer（非 HintGate neighbor）。** 钟贝/蓝美马分未进入 span 链。

---

### d002 — 美食 / 大悲

| 阶段 | 值 |
|------|-----|
| rawAsrText | `麻烦帮我做一杯美食带走大悲就行谢谢` |
| imeTopK | **5** |
| diffSpanCount | **15** |
| instabilityRegionCount | **3** |
| boundaryCompatibleTopKSpanCount | **2** |
| normalizerDroppedCount | **0** |
| normPassed（估算） | **2**（approved 0 + noNeighbor 2） |
| gateDroppedNoNeighbor | **2** |
| gateDroppedSupport | **0** |
| approvedSpanCount | **0** |
| skippedReason | `no_approved_spans` |
| fw_reason | `no_spans` |

**判断：属于「IME 已发现 diff（15），合并后 2 个 span 进入 HintGate，neighbor 门控 **全部拒绝**」。**

批测 JSON **未导出** 被拒绝 span 的 `rawSpan` 文本；仅能从计数推断 2 个 normalized span 因 `lexiconNearNeighbor=false` 被拒。

**模拟 B（移除 neighbor）：d002 可获得 2 个 span，进入 Recall/KenLM。**

---

### d003 — 少病 / 小背

| 阶段 | 值 |
|------|-----|
| rawAsrText | `请问,这款燕麦拿铁可以少病吗?我赶时间小背` |
| imeTopK | **5** |
| diffSpanCount | **0** |
| boundaryCompatibleTopKSpanCount | **3** |
| normalizerDroppedCount | **1** |
| approvedSpanCount | **2** |
| gateDroppedNoNeighbor | **0** |
| fw_triggered | **true** |
| fw_span_count | **2** |

**实际进入 FW 的 span：**

| span | IME 来源 | HintGate | Recall 候选（top） | KenLM |
|------|----------|----------|-------------------|-------|
| `少病` | boundary_topk_diff | **通过** | 烧饼、哨兵…（非少冰） | 查询 9 次，未 apply |
| `赶时` | boundary_topk_diff | **通过** | 干事、干尸… | 同上 |
| `小背` | — | **未提议** | — | — |

**判断：HintGate 未阻断；断点在 IME boundary 提议错位 + Recall 未命中「少冰」+ KenLM 未放行。**

---

## 五、HintGate 设计依据（有文档/代码证据者）

| 证据 | 路径 | 内容 |
|------|------|------|
| 架构冻结 | `docs/pinyin-v2/ARCHITECTURE.md` §7、§15 | HintGate 为 Pinyin-IME-V2 主链第 2 步；neighbor → `recallSpanTopK` |
| 设计原则 | `docs/pinyin-v2/ARCHITECTURE.md` §14 | **「宁可漏报，不允许误修」**；Span 过多 → HintGate 门控 |
| 主链 README | `docs/pinyin-v2/README.md` | `rawAsrText → Pinyin-IME-V2 → HintGate → Recall → …` |
| 历史漏斗 | `docs/pinyin-v2/KenLM_P1_Blocking_Audit_2026_06_03.md` §1 | BoundarySpan 190 → **ApprovedSpan 49（~76% proposal 损失在 HintGate）** |
| P2 审计 | `docs/pinyin-v2/Domain_Constrained_Recall_P2_Supplement_Checklist_2026_06_03.md` §2.1 | 明确 HintGate 调用 `recallSpanTopK` 早于 rerank |
| 代码注释 | `pinyin-ime-v2-hint-gate.ts` L28 | **sole span gate** for pinyin-ime-v2 mainline |
| 单测 | `pinyin-ime-v2-hint-gate.test.ts` | 证明 neighbor/support 拒绝行为；**未**测移除后 FP |
| Tone P0 约束 | `docs/tone/ToneModule_P0_Supplement_Checklist_2026_06_03.md` | 冻结期 **不改** HintGate `lexiconNearNeighbor` |

### 未发现证据（如实声明）

| 问题 | 结论 |
|------|------|
| Git 引入时间 / commit | 本审计未跑 `git log`；以 `ARCHITECTURE.md` 冻结文档为准 |
| 「移除 HintGate 导致误修爆炸」的回归测试 | **未发现** 此类测试 |
| 「HintGate 降低误修」的定量 A/B | **未发现**；仅有架构原则「宁可漏报」 |
| 临时压制某轮 FP 的说明 | **未发现** 临时性文档；呈现为 **冻结架构组成部分** |

---

## 六、HintGate 判定信号分析

### 6.1 `lexiconNearNeighbor(rawSpan)`

实现：`recallSpanTopK(rawSpan, profile, topK=1, minPrior, enabledDomains)`，与正式 Recall **同函数、同 profile、同 domainIds 解析**。

| 问题 | 判断 |
|------|------|
| 是否重复门控？ | **是**。在 Recall 之前要求「已有 1 个 lexicon hit」，属于 **Recall-like 前置条件** |
| general 下 domain-only 词？ | **是**。`primaryDomain=general` → `domainIds=[]` → 钟贝/蓝美马分等 **neighbor 失败** |
| rawSpan 不在词库？ | **是**。无 homophone bucket hit → 失败（除非 base 有同拼音其他词） |
| 是否与正式 Recall 重复？ | **是**。正式 Recall 再次 `recallSpanTopK`（更大 topK） |
| 是否把 Recall 职责提前？ | **是**。把「是否有候选」从 rerank 阶段 **前移到 span 审批** |

### 6.2 `supportCount >= minSupportCount`（默认 2）

**组成（代码）：**

- diff span：`aggregateDiffSpanSupport` → 同一 instability region 内 **distinct TopK candidate ranks** 数
- instability region：合并重叠 diff 后的 rank 计数
- boundary topK diff：自带 `supportCount`（`contributingRanks`）

| 问题 | 判断 |
|------|------|
| IME diff 是否足够？ | diff 本身已表达「TopK 与 raw 不一致」；supportCount 是 **同一区域的 rank 聚合**，与 diff 高度相关 |
| 是否重复统计？ | **部分重复**——是对 diff 的稳定性再要求 |
| 批测是否因 support 拒绝？ | **否**。`gateDroppedSupport=0`（200 案全量） |
| 是否会拒低频专业词？ | 理论上会（support=1）；**本批未发生** |

### 6.3 `normalizer`（`normalizePinyinImeV2Spans`）

**仅结构过滤（代码证实）：**

- 合并 diff + instability + boundary intervals
- 丢弃：`single_char`（`minSpanChars=2`）
- 丢弃：`syllable_out_of_range`（音节 2–5）
- 丢弃：`too_long`（`maxSpanChars=6`）
- **无**词库 / 语义 / neighbor 判断

| 问题 | 判断 |
|------|------|
| 是否应保留？ | **合理**。与 Recall 的 `MIN_SYLLABLES=2, MAX=5` 对齐 |
| 批测影响 | **最大**：65/134 `no_spans` 由 normalizer 杀光（含 d001） |

---

## 七、只读模拟 A / B / C（基于现有 diagnostics）

> 未重跑模型；用 `approved`、`gateDropped*`、`normalizerDropped` 估算。

| 指标 | 当前 | 模拟 A（normalizer 后全过，限 4） | 模拟 B（去 neighbor） | 模拟 C（neighbor+domain fallback） |
|------|------|-----------------------------------|----------------------|-------------------------------------|
| fw_triggered 案数 | **66** | **106** | **106** | **106**（neighbor 层与 B 同案数；fallback 不增加 normPassed） |
| span 总数（上限 4/句） | **107** | **173** | **173** | **173** |
| 新增 span 案数 | — | **+40** | **+40** | **+40** |
| d001 进 span | **否** | **否** | **否** | **否**（normalizer 杀光） |
| d002 进 span | **否** | **是（2）** | **是（2）** | **是（2）** |
| d003 进 span | **是（2）** | **是（2）** | **是（2）** | **是（2）** |

**说明：** 本批 `gateDroppedSupport=0` 且 `gateDroppedMaxSpans=0`，故 **模拟 A 与 B 数值相同**；差异仅在语义上 A 也去掉 support/max 裁剪（当前 support 未生效）。

**模拟 C：** domain weak fallback 只影响 neighbor 探针命中率，**不改变** normPassed 计数；对 d001 无影响；对 d002 若 2 个被拒 span 含 domain-only 词（如钟贝类）可能从 0→2，但 d002 被拒 span 文本未导出，**无法逐 span 确认**。

---

## 八、是否违背原始设计

对照目标：「IME 发现 span → 每句 2–4 span → 每 span 2–4 候选 → KenLM/Apply 裁决」

| 判断项 | 是/否 | 证据 |
|--------|-------|------|
| 把「发现 span」变成「证明 span 值得修」 | **是** | `lexiconNearNeighbor` 要求 recall hit 才批准 |
| Recall 之前做 Recall-like 判断 | **是** | neighbor 调用 `recallSpanTopK(topK=1)` |
| 过早过滤专业词/低频词 | **是** | general profile + neighbor；normalizer 杀 boundary（d001） |
| 导致 no_spans 远高于预期 | **是** | 134/200；仅 66 triggered |
| KenLM/Apply 无机会裁决 | **是** | 134 案 orchestrator 早退，KenLM query=0 |
| 仍保留每句 span 上限 2–4 | **是** | `maxApprovedSpans=4` |
| support 门控在本批生效 | **否** | `gateDroppedSupport=0` |

**结论：** HintGate **是**冻结架构的一部分，但其实现（尤其 **neighbor 门控**）**偏离**「IME 只负责发现位置、KenLM 负责是否替换」的分工，**提前承担了 Precision 判决**。

---

## 九、最小调整建议（只读，不改代码）

### 方案 1：保留 normalizer，删除 neighbor/support 审批门控

| 项 | 说明 |
|----|------|
| 逻辑 | IME diff/boundary → normalizer → `maxApprovedSpans` 截断 → Recall |
| 修改点 | `pinyin-ime-v2-hint-gate.ts`：去掉 neighbor/support 否决；或 bypass 到「normalizer 输出即 approved」 |
| 风险 | span 数 +40 案（+66 spans）；可能增加 KenLM 负载与 FP span |
| 好处 | d002 类 **14 案** diff>0 零批准可恢复；Recall/KenLM 获得裁决机会 |
| 验收 | contract 200/200；`no_spans` 134→≤94；`fw_triggered` ≥106；span≤4/句 |

### 方案 2：HintGate 降级为排序器

| 项 | 说明 |
|----|------|
| 逻辑 | normalizer 后 **全部** 可进池；按 `supportCount`+neighbor 命中排序；取 top `maxApprovedSpans` |
| 修改点 | `runPinyinImeV2HintGate`：neighbor 改为加权，非否决 |
| 风险 | 低于方案 1（超额时仍裁剪）；可能批准低质量 span |
| 好处 | 保留「动态平衡」；不完全放弃 HintGate 信号 |
| 验收 | 同方案 1；`gateDroppedNoNeighbor` 应降为 0 |

### 方案 3：HintGate 仅用于超额裁剪（推荐折中）

| 项 | 说明 |
|----|------|
| 逻辑 | `normPassed <= maxApprovedSpans` → **全过**；仅当超额时按 neighbor/support 排序裁剪 |
| 修改点 | `runPinyinImeV2HintGate` 循环前判断 `normalized.spans.length` |
| 风险 | **最低**（本批多数案 normPassed≤4） |
| 好处 | 不改变低 span 密度句；对 d002（normPassed=2）**直接放行** |
| 验收 | d002 进 span；`no_spans` 下降约 40；contract 保持 |

**本批数据：** 106 案 normPassed>0，仅 **40** 案因 neighbor 杀光；方案 3 对这 40 案生效，**不影响** d001（normPassed=0）。

---

## 十、下一轮验收标准

| # | 指标 |
|---|------|
| 1 | contract PASS **200/200** |
| 2 | `no_spans` **显著下降**（baseline 134） |
| 3 | `fw_triggered` 上升，**span_count 不爆炸**（≤4/句） |
| 4 | candidate 仍受 `perSpanLimit` / `maxSentenceCandidates` 约束 |
| 5 | d001/d002/d003 关键错词 **至少进入 span**（允许 recall 候选不完美） |
| 6 | **不要求** apply 立即 >0 |
| 7 | KenLM / Apply 仍负责最终替换 |
| 8 | 单独统计 **false positive span**（批准但不应修） |
| 9 | ToneModule 路径不变（仅 rerank recall sort） |

---

## 十一、最终报告（十一问）

1. **HintGate 是否真实存在并影响 span？** — **是**，唯一审批门；零批准则 FW 不进入 Recall。

2. **过滤了多少 IME diff span？** — 全案 `gateDroppedNoNeighbor=67`；**14 案** diff>0 但零批准；另有 **65 案** normalizer 杀光（属 HintGate 模块内）。

3. **no_spans 中多少是 HintGate？** — **40/134（30%）** 纯 neighbor 杀光；**65/134（48%）** normalizer；**29/134（22%）** 无 CJK。

4. **d001/d002/d003 断点？** — d001：**normalizer**；d002：**neighbor**；d003：**IME 提议错位**（非 HintGate）。

5. **设计依据是否充分？** — 有冻结架构与「宁可漏报」原则；**缺乏**移除后 FP 爆炸的回归证据；历史审计已记录 **~76% proposal 损失**。

6. **是否偏离原始设计？** — **是**（neighbor 将 Recall 前置为 span 门控）。

7. **移除 / 降级 / 裁剪？** — **不建议移除整模块**；建议 **降级 neighbor** 或 **方案 3 仅超额裁剪**；**保留 normalizer**。

8. **最小改造？** — `runPinyinImeV2HintGate` 内 neighbor 从 **否决** 改为 **排序/超额裁剪**；可与 domain weak fallback（neighbor 探针）正交。

9. **验收指标？** — 见第十节。

10. **support 门控？** — 本批 **零生效**；非当前主因。

11. **与 domain recall 关系？** — neighbor 与正式 Recall 共用 `resolveDomainIdsForRecall(general→[])`；general 下 **双重** 阻断 domain 词（见 `Lexicon_PrimaryDomain_Domain_Recall_Audit_2026_06_07.md`）。

---

*只读审计，未修改任何代码或阈值。*
