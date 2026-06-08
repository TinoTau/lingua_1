# Pinyin IME v2 HintGate 降级与命名改造审计

**日期：** 2026-06-07  
**性质：** 只读设计与影响面审计（禁止改码 / 禁止补丁）  
**数据源：** `tests/lexicon-tone-dialog200-batch-result.json` + 源码静态分析

---

## 执行摘要

| 问题 | 结论 |
|------|------|
| 降级是否可行？ | **可行**。核心改动集中在 `pinyin-ime-v2-hint-gate.ts` 单文件循环逻辑；normalizer 已独立 |
| 是否建议重命名？ | **是**。`HintGate` / `approved` / `gateDropped` 语义与目标行为不符 |
| 推荐新名称 | 文件 **`pinyin-ime-v2-span-selector.ts`**；函数 **`selectPinyinImeV2Spans`**；类型 **`SelectedSpan`** |
| 旧字段兼容？ | **建议保留一轮 deprecated alias**（`approvedSpanCount` 等）；批测/实验脚本依赖 |
| 最小代码影响面 | **~6 源文件 + 3 测试 + 文档**；Recall/Tone/KenLM/Apply **零改动** |
| dialog_200 预期 | `fw_triggered` 66→**106**；`no_spans` 134→**94**；`span_total` 107→**173** |
| 最大风险 | span 数 +40 案 → KenLM 查询增加；FP span 需单独统计 |
| 与 domain fallback | **不冲突**；正交（fallback 改善 neighbor 探针，降级改变 neighbor 角色） |
| 是否建议进入开发？ | **是**，建议 **方案：SpanSelector + 超额裁剪排序** |

---

## 一、完整影响面清单

| 名称 | 类型 | 路径 | 保留 | 重命名 | 新名称建议 | 原因 |
|------|------|------|------|--------|------------|------|
| `pinyin-ime-v2-hint-gate.ts` | 源文件 | `main/src/fw-detector/pinyin-ime-v2/` | 逻辑保留 | **是** | `pinyin-ime-v2-span-selector.ts` | 非 gate，是 normalize+rank+cap |
| `runPinyinImeV2HintGate` | 函数 | 同上 | 行为改造 | **是** | `selectPinyinImeV2Spans` | 选择器非审批器 |
| `PinyinImeV2HintGateInput` | 类型 | `pinyin-ime-v2-types.ts` | 是 | **是** | `PinyinImeV2SpanSelectorInput` | |
| `PinyinImeV2HintGateResult` | 类型 | 同上 | 是 | **是** | `PinyinImeV2SpanSelectorResult` | |
| `PinyinImeV2HintGateDiagnostics` | 类型 | 同上 | 改造 | **是** | `PinyinImeV2SpanSelectorDiagnostics` | 语义从 drop→select |
| `PinyinImeV2ApprovedSpan` | 类型 | 同上 | 是 | **是** | `PinyinImeV2SelectedSpan` | 非「批准」 |
| `PinyinImeV2ApprovedSpanReason` | 类型 | 同上 | 是 | 可选 | `PinyinImeV2SelectedSpanReason` | 低优先级 |
| `normalizePinyinImeV2Spans` | 函数 | `pinyin-ime-v2-span-normalizer.ts` | **是** | 否 | — | 已独立，结构过滤 |
| `createLexiconNearNeighborProbe` | 函数 | `resolve-pinyin-ime-v2-spans.ts` | **是** | 可选 | `createLexiconNeighborScoreProbe` | 改为返回 score/boolean |
| `lexiconNearNeighbor` | 回调类型 | `pinyin-ime-v2-types.ts` | **是** | 可选 | `lexiconNeighborScorer` | 用于排序分，非 veto |
| `mapApprovedSpanToFwSpan` | 函数 | `map-approved-span-to-fw.ts` | **是** | 建议 | `mapSelectedSpanToFwSpan` | 与 SelectedSpan 对齐 |
| `mapApprovedSpansToFwSpans` | 函数 | 同上 | **是** | 建议 | `mapSelectedSpansToFwSpans` | |
| `resolvePinyinImeV2Spans` | 函数 | `resolve-pinyin-ime-v2-spans.ts` | **是** | 否 | — | 编排入口，改 import |
| `approvedSpanCount` | 诊断字段 | `types.ts`, `resolve-*.ts` | alias | **是** | `selectedSpanCount` | 外部报告依赖 |
| `gateDroppedNoNeighbor` | 诊断字段 | 多处 | alias | **是** | `neighborMissCount` / `notSelectedNeighborMiss` | 非「拒绝」 |
| `gateDroppedSupport` | 诊断字段 | 多处 | alias | **是** | `supportBelowRankThreshold` | 本批恒为 0 |
| `gateDroppedMaxSpans` | 诊断字段 | 多处 | 改造 | **是** | `cappedByMaxSpansCount` | 仅超额裁剪时递增 |
| `no_approved_spans` | skippedReason | `types.ts` | alias | **是** | `no_selected_spans` | |
| `maxApprovedSpans` | 配置 | `pinyin-ime-v2-config.ts` | **是** | 可选 | `maxSelectedSpans` | 可保留旧名减 diff |
| `minSupportCount` | 配置 | 同上 | 改造 | 可选 | 排序权重或废弃 | 不再作 veto |
| `pinyin-ime-v2-hint-gate.test.ts` | 测试 | 同目录 | 改造 | **是** | `pinyin-ime-v2-span-selector.test.ts` | |
| `pinyin-ime-v2-freeze-contract.test.ts` | 测试 | 同目录 | 改断言 | 部分 | 文件名引用更新 | |
| `resolve-pinyin-ime-v2-spans.test.ts` | 测试 | 同目录 | 改断言 | 部分 | `no_selected_spans` | |
| `index.ts` (pinyin-ime-v2) | barrel | 同目录 | **是** | export 更新 | 可 re-export 旧名 deprecated | |
| `freeze-contract.test.ts` | 测试 | `fw-detector/` | 注释 | 可选 | 测试名可改 | 仅静态「不依赖 V1」 |
| `fw-detector-contract-assess.js` | 批测契约 | `tests/lib/` | **是** | 否 | — | **不读** HintGate 字段 |
| `docs/pinyin-v2/ARCHITECTURE.md` 等 | 文档 | `docs/` | 更新 | **是** | SpanSelector 术语 | 冻结文档需同步 |
| `dist/**` | 构建产物 | — | 随 build | 自动 | — | 非手改 |

**未引用 HintGate 的运行时代码（本次零改动）：**

- `fw-sentence-rerank-pipeline.ts`、`local-span-recall.ts`、`rerank-fw-sentences.ts`、`apply-span-replacements.ts`
- `fw-detector-orchestrator.ts`（仅读 `pinyinImeV2` 诊断；逻辑不改）

---

## 二、当前「审批门控」语义（代码事实）

### 2.1 当前伪代码

```text
function runPinyinImeV2HintGate(input):
  normalized = normalizePinyinImeV2Spans(diff + instability + boundary, config)
  diagnostics.inputSpanCount = len(normalized.spans) + len(normalized.dropped)
  diagnostics.normalizerDropped* = count drops by reason

  approved = []
  sorted = sort(normalized.spans, by supportCount desc, start asc)

  for span in sorted:
    if len(approved) >= config.maxApprovedSpans:
      diagnostics.gateDroppedMaxSpans++
      continue                                    // 超额 → 拒绝

    if span.supportCount < config.minSupportCount:
      diagnostics.gateDroppedSupport++
      continue                                    // support 不足 → 拒绝

    if not lexiconNearNeighbor(span.rawSpan):     // recallSpanTopK(topK=1) 无 hit
      diagnostics.gateDroppedNoNeighbor++
      continue                                    // 无邻居 → 拒绝

    approved.push({ rawSpan, start, end, confidence, reason })

  diagnostics.approvedSpanCount = len(approved)
  return { approved, diagnostics }
```

### 2.2 问答

| 问题 | 答案 |
|------|------|
| 哪些条件导致 span **不进入 Recall**？ | ① normalizer 丢弃；② `supportCount < minSupportCount`；③ `lexiconNearNeighbor=false`；④ 超过 `maxApprovedSpans`；⑤ 上游 `candidateCount=0` / 无 CJK |
| 「被拒绝」诊断字段 | `normalizerDroppedCount`；`gateDroppedSupport`；`gateDroppedNoNeighbor`；`gateDroppedMaxSpans` |
| `approvedSpanCount=0` → `no_spans`？ | **是**。`resolve-pinyin-ime-v2-spans.ts` → `spans.length===0` → orchestrator `buildEarlyExitResult(..., reason:'no_spans')` |
| 当前是审批器还是排序器？ | **审批器（veto gate）**。neighbor/support 为 **硬否决**；仅排序用于 **处理顺序**，非录取 |

---

## 三、降级目标可行性审计

### 3.1 目标伪代码

```text
function selectPinyinImeV2Spans(input):
  normalized = normalizePinyinImeV2Spans(...)   // 不变

  if normalized.spans.length == 0:
    selectionMode = 'empty_after_normalizer'
    return { selected: [], diagnostics }

  if normalized.spans.length <= config.maxSelectedSpans:
    selected = all normalized.spans (map to SelectedSpan)
    selectionMode = 'all_passed'
  else:
    scored = normalized.spans.map(span => ({
      span,
      score: rankScore(supportCount, lexiconNearNeighbor(span), boundary flags, ...)
    }))
    selected = top maxSelectedSpans by score
    selectionMode = 'ranked_capped'

  return { selected, diagnostics }
```

### 3.2 改造难度

| 项 | 评估 |
|----|------|
| 代码是否易改？ | **是**。`pinyin-ime-v2-hint-gate.ts` 单循环改为分支；normalizer **无需动** |
| 需改类型 | `PinyinImeV2HintGate*` → `SpanSelector*`；`ApprovedSpan` → `SelectedSpan` |
| 需改 diagnostics | 新增 `selectionMode`、`normalizedSpanCount`、`neighborHitCount`；旧 `gateDropped*` → alias 或重映射 |
| 会失败测试 | `pinyin-ime-v2-hint-gate.test.ts` 中 **reject neighbor/support** 断言 → 改为 **rank order / cap** 断言 |
| 需新增诊断 | **是**：见第五节 |

### 3.3 建议新增字段

| 字段 | 用途 |
|------|------|
| `selectionMode` | `all_passed` \| `ranked_capped` \| `empty_after_normalizer` |
| `normalizedSpanCount` | normalizer 后 span 数（= `inputSpanCount - normalizerDroppedCount`） |
| `neighborHitCount` | 选中集中 neighbor=true 的数量 |
| `neighborMissCount` | 选中集中 neighbor=false 的数量（all_passed 时可能 >0） |
| `rankedSpanCount` | 参与排序的 span 数（仅 ranked_capped） |
| `cappedByMaxSpansCount` | 因超额未选入数 |
| `legacyGateDroppedNoNeighbor` | 兼容：旧逻辑下会被 neighbor veto 的数量（便于对比） |

---

## 四、命名改造映射表

| 旧名称 | 新名称 | 必须改 | 兼容风险 | 影响文件 |
|--------|--------|--------|----------|----------|
| `pinyin-ime-v2-hint-gate.ts` | `pinyin-ime-v2-span-selector.ts` | 建议 | 低（可 re-export 旧路径） | selector, index, freeze-contract.test |
| `runPinyinImeV2HintGate` | `selectPinyinImeV2Spans` | 建议 | 中 | resolve-spans, index, tests |
| `PinyinImeV2ApprovedSpan` | `PinyinImeV2SelectedSpan` | 建议 | 中 | types, map-approved-span-to-fw, tests |
| `approvedSpanCount` | `selectedSpanCount` | 建议 | **高** | types, resolve-spans, batch JSON, experiments/*.mjs |
| `gateDroppedNoNeighbor` | `notSelectedRankNeighborMiss` 或保留 alias | 建议 | 中 | types, resolve-spans, 审计脚本 |
| `gateDroppedSupport` | 废弃或 `legacySupportVetoCount` | 可选 | 低 | 本批恒 0 |
| `gateDroppedMaxSpans` | `cappedByMaxSpansCount` | 建议 | 低 | types, resolve-spans |
| `no_approved_spans` | `no_selected_spans` | 建议 | 中 | types, resolve-spans.test |
| `maxApprovedSpans` | `maxSelectedSpans`（或保留） | 可选 | 低 | config, node-config-types |
| `mapApprovedSpanToFwSpan` | `mapSelectedSpanToFwSpan` | 可选 | 低 | map-approved-span-to-fw |
| `ImeHintGate`（注释） | `SpanSelector` | 建议 | 无 | 源码注释 |

**兼容策略（推荐）：**

```typescript
// PinyinImeV2ActiveDiagnostics 一轮 deprecated alias
approvedSpanCount: number;  // @deprecated use selectedSpanCount
gateDroppedNoNeighbor: number; // @deprecated use legacyGateDroppedNoNeighbor
```

`resolve-pinyin-ime-v2-spans.ts` 同时写入新旧字段，批测脚本无需立即改。

---

## 五、诊断字段设计与消费方

### 5.1 建议新 diagnostics 形状

```json
{
  "normalizedSpanCount": 2,
  "selectedSpanCount": 2,
  "selectionMode": "all_passed",
  "neighborHitCount": 1,
  "neighborMissCount": 1,
  "cappedByMaxSpansCount": 0,
  "rankedSpanCount": 0,
  "normalizerDroppedCount": 0,
  "legacyGateDroppedNoNeighbor": 0,
  "approvedSpanCount": 2,
  "gateDroppedNoNeighbor": 0,
  "skippedReason": null
}
```

### 5.2 当前消费方

| 消费方 | 读取字段 | 是否需要兼容层 |
|--------|----------|----------------|
| `fw-detector-orchestrator.ts` | `spanResolution.spans.length` | 否（不看 gate 字段） |
| `run-dialog200-timed-batch.mjs` | `fw.summary`, contract | **否** |
| `fw-detector-contract-assess.js` | `fw.enabled`, `fw.summary` | **否** |
| `lexicon-tone-dialog200-batch-result.json` | 全量 `pinyinImeV2` | **是**（历史 JSON） |
| `tests/experiments/recall-*.mjs` | `approvedSpanCount` | **是** |
| `tests/experiments/lexicon-tone-apply0-audit-data.json` | `ime_skipped` | 部分（skippedReason 字符串） |
| 人工审计文档 | `gateDropped*` | 建议保留 legacy 字段 |

---

## 六、dialog_200 预期影响（重新验证）

基于 `lexicon-tone-dialog200-batch-result.json` 离线重算（降级规则：`selected = min(4, normPassed)`，其中 `normPassed = approved + gateDroppedNoNeighbor + gateDroppedSupport + gateDroppedMaxSpans`）：

| 指标 | 当前 | 降级后估算 | 依据 |
|------|------|------------|------|
| `fw_triggered` | **66** | **106** | 106 案 `normPassed>0` |
| `no_spans` | **134** | **94** | 200 - 106 |
| `span_total` | **107** | **173** | Σ min(4, normPassed) |
| d001 | 0 span | **0 span** | `normPassed=0`（normalizer 杀光 2 个 boundary） |
| d002 | 0 span | **2 span** | `normPassed=2`，all_passed |
| d003 | 2 span | **2 span** | 不变 |

**补充事实：**

- `normPassed > maxSpans(4)` 仅 **1 案**（`d185`，normPassed=5）；其余 105 案走 **`all_passed`** 分支
- 降级收益 **主要来自** neighbor veto 消除，**非**排序逻辑变更
- d001 **仍卡在 normalizer/proposal**，降级无法修复

---

## 七、风险矩阵

| 风险 | 等级 | 原因 | 缓解 |
|------|------|------|------|
| KenLM 查询增加 | **中** | +40 案进 FW；span_total +62% | 仍受 `maxSelectedSpans=4`、`maxSentenceCandidates=16` 约束 |
| FP span 增加 | **中** | 无 neighbor veto 的 span 进入 Recall | KenLM `minDeltaToReplace=0.03`；单独统计 FP |
| KenLM 误修 | **低** | 本批 66 案已跑 KenLM，0 apply | 最终门控未动 |
| Apply 误替换 | **低** | Apply 未改 | 同左 |
| ToneModule | **无** | 仅在 rerank recall sort | 不触碰 |
| domain weak fallback | **无冲突** | fallback 改善 neighbor 探针；降级后 neighbor 仅排序 | 可组合 |
| contract PASS | **低** | 契约不检查 span 数 | 200/200 应保持 |
| span 上限 | **低** | `maxSelectedSpans=4` 保留 | 硬 cap |
| 性能 P95 | **中低** | +40 案 Recall+KenLM | 监控 `fw_detector_step_ms` |

---

## 八、测试影响面

| 测试 | 动作 |
|------|------|
| `pinyin-ime-v2-hint-gate.test.ts` | **重写**为 span-selector：删除「neighbor false → reject」；改为「all_passed when ≤4」「rank when >4」 |
| `pinyin-ime-v2-span-normalizer.test.ts` | **保留** |
| `resolve-pinyin-ime-v2-spans.test.ts` | 更新 `skippedReason` 断言；可加集成 case |
| `pinyin-ime-v2-freeze-contract.test.ts` | 更新文件名引用；保留「不输出 replacement」断言 |
| `freeze-contract.test.ts` | 可选改测试标题；逻辑不变 |
| dialog_200 回归 | **必跑**；对比 no_spans / fw_triggered |
| d001/d002/d003 专项 | d002 应有 span；d001 仍无 |
| diagnostics 兼容测试 | **新增**：新旧字段同值一轮 |
| FP span 统计 | **新增**脚本（不阻塞 CI） |

**旧断言删除 / 改造：**

- 删除：`rejects span without lexicon neighbor`
- 改为：`neighbor miss still selected when under cap`
- 删除：`rejects span with supportCount < minSupportCount`（或改为排序 tie-break）

---

## 九、最小开发方案（不实施，仅设计）

### 9.1 文件级改动

| 文件 | 改动 |
|------|------|
| `pinyin-ime-v2-hint-gate.ts` | **重命名+重写** → `pinyin-ime-v2-span-selector.ts` |
| `pinyin-ime-v2-types.ts` | 新类型 + diagnostics；旧类型 deprecated export |
| `resolve-pinyin-ime-v2-spans.ts` | 调用 `selectPinyinImeV2Spans`；双写诊断 alias |
| `map-approved-span-to-fw.ts` | 接受 `SelectedSpan`；函数可 alias |
| `types.ts` (`PinyinImeV2ActiveDiagnostics`) | 扩展字段 + deprecated |
| `index.ts` | export 更新 + `runPinyinImeV2HintGate` deprecated wrapper |
| `pinyin-ime-v2-hint-gate.test.ts` | 重命名 + 断言更新 |
| `docs/pinyin-v2/ARCHITECTURE.md` | §7 HintGate → SpanSelector |

### 9.2 接口级改动

| 旧 | 新 |
|----|-----|
| `runPinyinImeV2HintGate` | `selectPinyinImeV2Spans` |
| `PinyinImeV2HintGateResult.approved` | `PinyinImeV2SpanSelectorResult.selected` |
| `PinyinImeV2ApprovedSpan` | `PinyinImeV2SelectedSpan` |

### 9.3 诊断 alias

| 旧字段 | 新字段 | 保留 alias |
|--------|--------|------------|
| `approvedSpanCount` | `selectedSpanCount` | **是，1 轮** |
| `gateDroppedNoNeighbor` | `legacyGateDroppedNoNeighbor` | **是** |
| `gateDroppedMaxSpans` | `cappedByMaxSpansCount` | **是** |
| `no_approved_spans` | `no_selected_spans` | **是**（双写 skippedReason） |

### 9.4 验收标准

1. contract PASS **200/200**
2. `no_spans` **≤ 94**（或相对 134 显著下降）
3. `fw_triggered` **≥ 106**
4. 每句 `selectedSpanCount ≤ 4`
5. **d002** `selectedSpanCount ≥ 1`（期望 2）
6. **d001** 仍为 0，文档标明 normalizer 根因
7. apply **不要求** >0
8. ToneModule / KenLM / Apply 代码 **零 diff**
9. FP span 单独出报告

---

## 十、最终报告

| # | 问题 | 答案 |
|---|------|------|
| 1 | HintGate 降级是否可行？ | **可行**，改动集中、normalizer 已分离 |
| 2 | 是否建议重命名？ | **是**，避免维护者误以为必须 neighbor 才能过 |
| 3 | 推荐新名称？ | **`pinyin-ime-v2-span-selector.ts` / `selectPinyinImeV2Spans` / `SelectedSpan`** |
| 4 | 哪些旧字段要兼容？ | `approvedSpanCount`、`gateDroppedNoNeighbor`、`no_approved_spans`（一轮 alias） |
| 5 | 最小代码影响面？ | **1 核心文件重写 + 3~4 类型/编排 + 2~3 测试**；下游 FW 管道不动 |
| 6 | dialog_200 预期？ | triggered **106**，no_spans **94**，spans **173**；d002 **+2 span** |
| 7 | 最大风险？ | **KenLM 负载 + FP span**；非 contract 破坏 |
| 8 | 与 domain weak fallback？ | **不冲突**；fallback 可提升 neighbor 排序分 |
| 9 | 是否同步改文档？ | **是**：`ARCHITECTURE.md`、`README.md`、tone 审计索引 |
| 10 | 是否建议进入开发？ | **是**；优先 **all_passed when ≤4**（覆盖 105/106 案），排序仅 **d185** 等超额案 |

---

*只读审计，未修改任何代码。*
