# Pinyin IME v2 SpanSelector — 开发报告

**日期：** 2026-06-07  
**性质：** 架构调整开发（HintGate 废止 → SpanSelector）  
**依据：**

- [Pinyin IME v2 SpanSelector 开发方案.md](./Pinyin%20IME%20v2%20SpanSelector%20开发方案.md)
- [Pinyin IME v2 SpanSelector 开发方案（V1.1补充章节）.md](./Pinyin%20IME%20v2%20SpanSelector%20开发方案（V1.1补充章节）.md)
- [vibe coding 代码规范](../CODING/vibe%20coding代码规范)

**关联审计：** [Pinyin_IME_v2_HintGate_Downgrade_Naming_Audit_2026_06_07.md](./Pinyin_IME_v2_HintGate_Downgrade_Naming_Audit_2026_06_07.md)

---

## 1. 执行摘要

| 目标 | 状态 |
|------|------|
| HintGate neighbor/support **veto** 移除 | **完成** |
| 新增 `selectPinyinImeV2Spans`（normalize → 全过 / ranked_capped） | **完成** |
| 删除全部兼容层（无 deprecated / 无双写 alias） | **完成** |
| 下游 Recall / KenLM / Apply **零改动** | **完成** |
| 单元测试 | **134 passed**（`test:fw-detector`） |
| dialog_200 批测 | **200/200 PASS**；`fw_triggered` **66 → 106** |

---

## 2. 问题与动机

改造前 `runPinyinImeV2HintGate` 在 normalizer 之后对 span 执行 **neighbor veto**（`lexiconNearNeighbor` 探针失败即丢弃）。dialog_200 批测（2026-06-07 基线）显示：

- `no_spans` **134/200**，其中 neighbor 杀光 **40 案**
- `fw_triggered` 仅 **66**
- d002（美食/大悲）等有 diff 但 **approvedSpanCount=0**

冻结方案 V1.1 将 IME 层职责收敛为 **Span Discovery + 数量控制**；精度判决交由 Recall / KenLM / Apply。

---

## 3. 架构变更

### 3.1 主链（改造后）

```text
rawAsrText
  → runPinyinImeV2SpanProposal
  → selectPinyinImeV2Spans
       └─ normalizePinyinImeV2Spans（内调）
  → mapSelectedSpansToFwSpans
  → runFwSentenceRerankPipeline（不变）
```

### 3.2 行为冻结（V1.1）

| 条件 | `selectionMode` | 行为 |
|------|-----------------|------|
| normalizer 后 0 span | `empty_after_normalizer` | 空输出 |
| `normalized ≤ maxApprovedSpans` | `all_passed` | 全部选中（按 `start` 排序） |
| `normalized > maxApprovedSpans` | `ranked_capped` | 按权重取 Top `maxApprovedSpans` |

**排序权重（冻结）：**

| 信号 | 加分 |
|------|------|
| `neighborHit` | +1000 |
| `supportCount` | ×10 |
| `boundaryTopK` | +100 |
| `instability` | +50 |
| tie-break | `start` 升序 |

`lexiconNearNeighbor` 仍调用 `recallSpanTopK(…, topK=1, …)`，**仅影响排序与 `confidence`**，不再否决。

---

## 4. 代码变更清单

### 4.1 新增

| 文件 | 职责 |
|------|------|
| `pinyin-ime-v2-span-selector.ts` | `selectPinyinImeV2Spans` 主逻辑 |
| `map-selected-span-to-fw.ts` | `PinyinImeV2SelectedSpan` → `FwSpanDiagnostics` |
| `pinyin-ime-v2-span-selector.test.ts` | Selector 单测 |
| `map-selected-span-to-fw.test.ts` | 映射单测 |

### 4.2 修改

| 文件 | 变更 |
|------|------|
| `resolve-pinyin-ime-v2-spans.ts` | 调用 `selectPinyinImeV2Spans`；诊断字段更新 |
| `pinyin-ime-v2-types.ts` | `PinyinImeV2SelectedSpan` / `SpanSelectorDiagnostics` |
| `fw-detector/types.ts` | `PinyinImeV2ActiveDiagnostics` 去兼容字段 |
| `pinyin-ime-v2/index.ts` | 导出新 API |
| `pinyin-ime-v2-freeze-contract.test.ts` | 静态契约指向 selector |
| `docs/pinyin-v2/ARCHITECTURE.md` | §7 / §14 / §15 SpanSelector 语义 |

### 4.3 删除（无兼容保留）

| 文件 | 说明 |
|------|------|
| `pinyin-ime-v2-hint-gate.ts` | 整文件删除 |
| `map-approved-span-to-fw.ts` | 整文件删除 |
| `pinyin-ime-v2-hint-gate.test.ts` | 整文件删除 |

### 4.4 明确未改动（冻结边界）

- `local-span-recall.ts`
- `fw-sentence-rerank-pipeline.ts`
- `rerank-fw-sentences.ts`
- `apply-span-replacements.ts`
- ToneModule / KenLM scorer / IME TopK decode

---

## 5. 类型与诊断（最终形态）

### 5.1 输出类型

```typescript
type PinyinImeV2SelectedSpan = {
  rawSpan: string;
  start: number;
  end: number;
  confidence: number;
  reason: 'ime_v2_diff' | 'ime_v2_instability' | 'ime_v2_boundary_topk_diff';
};

type PinyinImeV2SpanSelectorResult = {
  selected: PinyinImeV2SelectedSpan[];
  diagnostics: PinyinImeV2SpanSelectorDiagnostics;
};
```

### 5.2 诊断字段（无 legacy alias）

```typescript
type PinyinImeV2SpanSelectorDiagnostics = {
  inputSpanCount: number;
  normalizerDroppedCount: number;
  normalizerDroppedSingleChar: number;
  normalizerDroppedSyllableRange: number;
  normalizedSpanCount: number;
  selectedSpanCount: number;
  selectionMode: 'all_passed' | 'ranked_capped' | 'empty_after_normalizer';
  neighborHitCount: number;
  neighborMissCount: number;
  cappedByMaxSpansCount: number;
};
```

`skippedReason` 仅保留：`no_selected_spans`（替代原 `no_approved_spans`）。

**已删除字段：** `approvedSpanCount`、`gateDroppedNoNeighbor`、`gateDroppedSupport`、`gateDroppedMaxSpans`、`legacyGateDroppedNoNeighbor`。

---

## 6. 单元测试

```powershell
cd electron_node\electron-node
npm run build:main
npm run test:fw-detector
```

| 套件 | 结果 |
|------|------|
| `pinyin-ime-v2-span-selector.test.ts` | 5 cases：无 veto、低 support、boundary topk、ranked_capped、normalizer 空 |
| `map-selected-span-to-fw.test.ts` | 3 cases：三种 reason → signal 映射 |
| `resolve-pinyin-ime-v2-spans.test.ts` | `no_selected_spans` 路径 |
| `pinyin-ime-v2-freeze-contract.test.ts` | selector 不输出 replacement 文本 |
| 全量 `test:fw-detector` | **134/134 PASS** |

---

## 7. 批测验收摘要

详见 [测试报告](./Pinyin_IME_v2_SpanSelector_Dialog200_Test_Report_2026_06_07.md)。

| V1.1 验收项 | 目标 | 实测 |
|-------------|------|------|
| contract | 200/200 | **200/200** |
| `fw_triggered` | ≥ 106 | **106** |
| `no_spans` | 下降 | **134 → 94** |
| `selectionMode=all_passed` | ≥ 105 | **105** |
| `ranked_capped` | ≥ 1 | **1** |
| neighbor miss 仍选中 | `neighborMissCount>0` 且 `selectedSpanCount>0` | **58 案** |
| d002 `selectedSpanCount` | ≥ 2 | **2** |

---

## 8. 已知限制与后续

| 项 | 说明 |
|----|------|
| **FW apply 仍为 0** | KenLM `minDeltaToReplace` 未放行；非本任务范围 |
| **d001 未修复** | `empty_after_normalizer`（boundary topk 与 normalizer 合并丢 span） |
| **d003 仍错位** | IME boundary 提议位置问题；已进入 span 但非目标词 |
| **domain fallback** | 未在本 PR 引入；neighbor 探针仍受 `primaryDomain=general` 限制 |

---

## 9. 产物索引

| 产物 | 路径 |
|------|------|
| 批测原始 JSON | `electron_node/electron-node/tests/lexicon-tone-dialog200-spanselector-batch-result.json` |
| 质量/性能汇总 | `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-spanselector-quality-perf.json` |
| 分析脚本 | `electron_node/electron-node/tests/experiments/_spanselector-batch-analyze.mjs` |
| 测试报告 | [Pinyin_IME_v2_SpanSelector_Dialog200_Test_Report_2026_06_07.md](./Pinyin_IME_v2_SpanSelector_Dialog200_Test_Report_2026_06_07.md) |

---

## 10. 结论

SpanSelector 按 V1.1 冻结方案落地：**neighbor 从 veto 降为排序信号**，主链无兼容包袱。dialog_200 证实 **+40 条 FW 触发**（66→106），neighbor 杀光类 `no_spans` 消除。端到端修词仍阻塞于 KenLM / normalizer / domain 等下游或平行任务，符合改造预期边界。
