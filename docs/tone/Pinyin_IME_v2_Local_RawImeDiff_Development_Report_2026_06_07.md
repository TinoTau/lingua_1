# Pinyin IME v2 Local Raw-IME Diff Proposal 开发报告

**日期：** 2026-06-07  
**版本：** V1.1 补充方案落地  
**状态：** 已实现、单测通过、dialog_200 批测完成  
**对照方案：** [Pinyin IME v2 Local Raw-IME Diff Proposal 开发方案补充文档（V1.1）](./Pinyin%20IME%20v2%20Local%20Raw-IME%20Diff%20Proposal%20开发方案补充文档（V1.1).md)

---

## 1. 背景与目标

### 1.1 问题

在 SpanSelector 基线（`fw_triggered=106/200`）下，仍有 **94 条** 因 Proposal 层 **alignFailed 全灭** 而无法产出 diff span。典型案例如 **d001**：

- ASR：`…热拿铁钟贝少糖…蓝美马分…`
- 参考：`…热拿铁，中杯，少糖…蓝莓马芬…`
- 基线：`diffSpanCount=0`，`fw_triggered=false`

根因（见 [Proposal 深度审计](./Pinyin_IME_v2_Proposal_Deep_Audit_2026_06_07.md)）：整句 boundary-compatible TopK diff 在 align 阶段全部失败，4D 聚合无输入。

### 1.2 目标

在 **不修改** Normalizer / SpanSelector / Recall / Tone / KenLM / Apply 的前提下，于 Proposal 层增加 **Local Raw-vs-IME Diff** fallback：

- 当 trusted TopK 候选 **全部 alignFailed** 时，用 token 级 `rawSlice` vs `normalizeTraditionalChinese(token.word)` 构造 local diff spans；
- **替换**（非 append）整句 diff 结果，再走既有 instability → boundary → 4D → 下游链路。

### 1.3 约束（冻结）

| 约束 | 说明 |
|------|------|
| 禁止兼容层 | 不保留 HintGate / 双路径并行 |
| 仅改 Proposal | 下游模块零改动 |
| 激活门控 | `alignFailedCount === min(topK, candidates.length)` |
| 替换语义 | local spans **替换** align-failed 的空 diff，不叠加 |

---

## 2. 实现概要

### 2.1 数据流

```
runPinyinImeV2SpanProposal
  ├─ collectDiffSpansFromCandidates (boundary-compatible TopK diff)
  ├─ shouldActivateLocalRawImeDiffFallback?
  │     alignFailedCount === min(topK, |candidates|)
  ├─ buildLocalRawImeDiffSpans (token rawSlice vs normalized IME word)
  ├─ [激活] diffSpans ← local spans（替换）
  └─ aggregateDiffSpanSupport → instability → boundary → 4D
        → Normalizer → SpanSelector → Recall → KenLM → Apply
```

### 2.2 核心算法（`buildLocalRawImeDiffSpans`）

1. 取 trusted TopK 候选（复用 `selectTrustedTopKCandidates`）；
2. 对每个候选 token：
   - 由 syllable range 映射到 raw 字符区间（`syllableRangeToRawCharRange`）；
   - `rawSlice = rawAsrText.slice(start, end)`；
   - `imeWord = normalizeTraditionalChinese(token.word)`；
   - 若 `rawSlice !== imeWord` 且含 CJK，记为 diff interval；
3. 按 raw 区间合并 interval，产出 `PinyinImeV2DiffSpan[]`；
4. diagnostics 记录 span 数、trusted 候选数、单字 span 数、example spans（最多 3）。

### 2.3 激活条件（`shouldActivateLocalRawImeDiffFallback`）

```typescript
alignFailedCount === Math.min(topK, candidates.length)
```

即：**仅当 boundary-compatible diff 对全部 trusted 候选均 align 失败** 时才启用 local fallback，避免与已有整句 diff 混用。

---

## 3. 代码变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-local-raw-ime-diff.ts` | **新增** | `buildLocalRawImeDiffSpans`、`shouldActivateLocalRawImeDiffFallback` |
| `main/src/fw-detector/pinyin-ime-v2/run-pinyin-ime-v2-span-proposal.ts` | 修改 | 集成 fallback：全 alignFailed 时替换 diffSpans |
| `main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-types.ts` | 修改 | `LocalRawImeDiff*` 类型 |
| `main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-diagnostics.ts` | 修改 | `localRawImeDiffActivated` 等诊断字段 |
| `tests/fw-detector/pinyin-ime-v2-local-raw-ime-diff.test.ts` | **新增** | T1–T11 单元/契约测试 |

**未改动：** Normalizer、SpanSelector、Recall、Tone、KenLM、Apply、resolve 层。

---

## 4. 单测结果

```bash
cd electron_node/electron-node
npm run test:fw-detector
```

| 指标 | 结果 |
|------|------|
| 套件 | fw-detector |
| 通过 | **146 / 146** |
| Local Raw-IME Diff 用例 | T1–T11（激活门控、替换语义、d001 探针、单字 span、空候选等） |

---

## 5. 与 V1.1 方案对齐

| V1.1 要求 | 实现状态 |
|-----------|----------|
| token 级 raw vs normalized IME word | ✅ |
| trusted TopK 门控 | ✅ |
| alignFailed 全灭才激活 | ✅ |
| 替换 diffSpans（非 append） | ✅ |
| diagnostics 可观测 | ✅ `localRawImeDiff*` |
| 不改下游 | ✅ |
| 禁止兼容层 | ✅ |

---

## 6. 已知限制（批测验证）

1. **KenLM apply 仍为 0**：span 发现改善未传导至最终替换（与 SpanSelector 基线相同根因）；
2. **CER 未改善**：`final_avg` 与基线相同（0.250），因 apply=0，final 文本等于 raw；
3. **4 条 fw 回退**：local diff 产出 span 后经 Normalizer 清空（`empty_after_normalizer`），见测试报告 §4.3；
4. **批测 JSON 无 `localRawImeDiffActivated`**：该字段仅在 Proposal diagnostics；批测可通过 `diffSpanCount`/`selectedSpanCount` 与基线 diff 对比推断激活效果。

---

## 7. 相关文档与数据

| 资源 | 路径 |
|------|------|
| 开发前审计 | [Pinyin_IME_v2_Local_RawImeDiff_Proposal_Audit_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Proposal_Audit_2026_06_07.md) |
| 补充清单 | [Pinyin_IME_v2_Local_RawImeDiff_Proposal_DevPlan_Supplement_Checklist_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Proposal_DevPlan_Supplement_Checklist_2026_06_07.md) |
| dialog_200 测试报告 | [Pinyin_IME_v2_Local_RawImeDiff_Dialog200_Test_Report_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Dialog200_Test_Report_2026_06_07.md) |
| 批测原始 JSON | `electron_node/electron-node/tests/lexicon-tone-dialog200-local-raw-ime-batch-result.json` |
| 质量/性能汇总 | `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-local-raw-ime-quality-perf.json` |

---

## 8. 结论

Local Raw-IME Diff Proposal fallback **按 V1.1 冻结方案完成实现**，单测全绿。dialog_200 批测显示 **fw_triggered 从 106 提升至 158（+52）**，d001 等 alignFailed 案例成功产出 diff/selected span，达成 Proposal 层 span 发现目标；端到端 CER 与 apply 改善需后续 KenLM / domain profile 工作。
