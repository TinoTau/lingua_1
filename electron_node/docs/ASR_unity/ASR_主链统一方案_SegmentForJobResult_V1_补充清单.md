# ASR 主链统一方案 V1 — 代码对照补充清单

**对照文档：** [ASR_主链统一方案_SegmentForJobResult_V1.md](./ASR_主链统一方案_SegmentForJobResult_V1.md)  
**代码基线日期：** 2026-05-30  
**关联审计：** [../electron-node/docs/ASR前后处理链路审计报告_2026_05_27.md](../electron-node/docs/ASR前后处理链路审计报告_2026_05_27.md)

本文档在 V1 方案基础上，对照当前 `electron_node/electron-node/main/src` 实际实现，列出**需补充的设计约束、遗漏改造点、与现有契约/测试的冲突**，供实施前评审。

---

## 1. V1 已覆盖且与代码问题一致的部分

| V1 条目 | 代码现状 | 结论 |
|---------|----------|------|
| 双真值源导致 turn finalize NMT 不完整 | `getTextForTranslation` 优先 `repairedText`；finalize 后 `segmentForJobResult`=全文 | ✅ 根因准确 |
| `result-builder` 只读 `repairedText` | `result-builder.ts` L33–44 | ✅ 需改 |
| `aggregation-step` 与 FW 分叉 | `postDetectorSegment()` 优先 `repairedText` | ✅ 需简化 |
| FW orchestrator 双写 | `fw-detector-orchestrator.ts` L219–220 同时写两字段 | ✅ 需改 |
| 目标：`text_asr === NMT input` | 当前两者均来自 `repairedText`，turn 场景不一致 | ✅ 目标正确 |

---

## 2. 必须在 V1 中补充的设计约束

### 2.1 `rawAsrText` 不可删除（V1 已保留，需强化语义）

V1 数据结构保留了 `rawAsrText`，但未写清与 `segmentForJobResult` 的分工。当前代码约定：

| 字段 | 语义 | 写入点 | 改造后约束 |
|------|------|--------|------------|
| `rawAsrText` | ASR **immutable 原文**（批测/契约/extra） | `asr-step.ts` 仅 `i===0 && undefined` | **必须保留**；禁止任何 step 覆盖 |
| `asrText` | 多 batch 拼接视图（观测用） | `asr-step.ts` | 保留；**不得**作为 NMT/Detector 默认输入 |
| `segmentForJobResult` | **唯一业务真值** | ASR 初始化 → FW → Agg → 5015/5016/5017 | V1 SSOT |

**补充约束：**

- [ ] `extra.raw_asr_text` 继续来自 `ctx.rawAsrText`，与 `text_asr` 分离（`result-builder.ts` L57）。
- [ ] `freeze-contract.test.ts` 已静态断言 `rawAsrText` 仅 `asr-step` 一处赋值；改造后不得破坏。
- [ ] **多 Node batch 缺口（V1 未写）：** `rawAsrText` 仅首 batch，`asrText` 为全文；FW `detectSuspiciousSpansV1` 读 `rawAsrText`（`fw-detector-orchestrator.ts` L119）。若 Node 切多 batch，Detector 范围 ≠ 全文。需在 V1 增加一条：**要么** ASR 保证单 batch 进 FW，**要么** finalize 前合并文本再 detect（P1 决策项，见 §6）。

---

### 2.2 FW Detector 输入：V1 与代码不一致，需明确选型

V1 §五写 Detector **输入** `ctx.segmentForJobResult`；当前实现：

```119:119:electron_node/electron-node/main/src/fw-detector/fw-detector-orchestrator.ts
  const rawText = (ctx.rawAsrText ?? '').trim();
```

ASR 结束后两字段相等（`asr-step.ts` L354–356），但语义不同。

**建议补充到 V1（二选一，实施前冻结）：**

| 选项 | 输入 | 适用 |
|------|------|------|
| **A（推荐）** | `rawAsrText`（空则 fail-fast） | 检测始终对 immutable ASR 原文；apply 结果写 `segmentForJobResult` |
| **B** | `segmentForJobResult` | 与 V1 字面一致；要求 ASR 后无其他 step 改 segment 再进 FW |

- [ ] V1 正文改为明确选项 A 或 B，避免实施时误改检测基准。
- [ ] `applyFwSpanReplacements` 输出**只**写 `segmentForJobResult`（两选项一致）。
- [ ] `asrRepairApplied = true` 保留，用于后续 step 写锁（见 §2.4）。

---

### 2.3 Turn 流式：步骤顺序约束（V1 未写清）

当前顺序（FW 模式）：

```text
ASR → FW（改当前 chunk 的 segment）→ AGGREGATION（non-finalize append / finalize merge）
```

finalize 时 `segmentForJobResult = accumulated + segmentPart`（`aggregation-step.ts` L127–134），其中 `accumulated` 来自历史 `appendTurnSegment(detectorSegment)`，**每 chunk 的 FW 结果已在 buffer 中**。

**补充约束：**

- [ ] **不得**在 finalize 后将 NMT 输入降级为「仅末 chunk」；统一读 finalize 后的 `segmentForJobResult` 即可修复审计问题。
- [ ] non-finalize：**不得清空** `segmentForJobResult`（当前 `applyPostAggregationRouting` 清空 `repairedText`，L63–65）；仅设 `shouldDeferTranslation=true` / `shouldAllowTranslation=false`。
- [ ] `appendTurnSegment` 必须 append **FW 之后**的 `segmentForJobResult`（当前 `postDetectorSegment` 优先 repairedText，改造后直接用 segment）。

---

### 2.4 写锁机制：Rename 约束，非删除

V1 删除 `repairedText` 后，`isRecoverWriteLocked()` / `asrRepairApplied` 仍需要，但语义应改为 **Segment 写锁**：

| 现状 | 改造后 |
|------|--------|
| `isRecoverWriteLocked` → Recover 命名 | 重命名为 `isSegmentWriteLocked` 或保留函数名但注释改为「FW/句修复已写 segment」 |
| `asrRepairApplied === true` | FW apply 或（未来）句级修复写回后置 true |
| 5015/5016 不改 `repairedText` | 5015/5016 **不得覆盖**已锁定的 `segmentForJobResult` |

**补充约束：**

- [ ] `phonetic-correction-step.ts` 已有 lock 检查（改 segment 前 skip）— 改造后改为 lock `segmentForJobResult`。
- [ ] `punctuation-restore-step.ts` **当前无 lock**（L77 直接改 segment）— V1 须补充：FW lock 时 skip 5017，或 5017 在 FW 之前（与现步骤顺序冲突，**默认 5017 off** 可暂缓）。
- [ ] `markSemanticRepairHttpSuccess` 写 `repairedText` → 改为写 `segmentForJobResult`，且 respect lock。

---

### 2.5 `syncRepairedTextBaseline` 应删除，非改写

V1 只提改 `getTextForTranslation`，未提 **`syncRepairedTextBaseline` 整个函数的存在理由是将 segment 复制到 repairedText**，与 SSOT 目标相反。

**补充约束：**

- [ ] 删除 `syncRepairedTextBaseline` 及所有调用（`post-asr-routing.ts`、`semantic-repair-step.ts`）。
- [ ] `applyPostAggregationRouting` 只做门控（`shouldDeferTranslation` / `shouldAllowTranslation` / 5015/5016/5017 flags），**不再同步文本字段**。
- [ ] `complete-aggregation.ts` 仅调用 routing，不引入第二文本源。

---

### 2.6 增强步骤（5015/5016/5017）统一读写 segment

V1 §七未列以下文件；当前行为：

| Step | 读 | 写 | 默认配置 |
|------|----|----|----------|
| 5016 同音 | `segmentForJobResult` | `segmentForJobResult` | off |
| 5017 断句 | `segmentForJobResult` | `segmentForJobResult` | off |
| 5015 语义 | `segmentForJobResult` | **`repairedText`** | off |
| DEDUP | **`repairedText`** | — | 总是执行 |

**补充约束：**

- [ ] 5015 成功/失败 fallback 均写 `segmentForJobResult`（`semantic-repair-step.ts`、`markSemanticRepair*`）。
- [ ] `dedup-step.ts` 改为只读 `segmentForJobResult`（V1 **遗漏**，P0）。
- [ ] 5015 若启用：`semantic-repair-step` 内 `aggregatorManager.updateLastCommittedTextAfterRepair` 仍用修复后 segment（`semantic-repair-step.ts` L134–139）。

---

### 2.7 `result-builder` extra 字段

除 `text_asr` 外，当前还输出：

```185:185:electron_node/electron-node/main/src/pipeline/result-builder.ts
    text_asr_repaired: ctx.repairedText,
```

**补充约束：**

- [ ] 删除 `text_asr_repaired` **或** 改为与 `text_asr` 同源（`segmentForJobResult`），避免第三个观测字段。
- [ ] 删除 `repairedText empty but segmentForJobResult set` 警告逻辑（SSOT 后不应出现）。

---

### 2.8 Session / Intent / Replay 下游（V1 完全未列）

| 模块 | 当前 `repairedText` 用法 | 补充要求 |
|------|--------------------------|----------|
| `session-finalize.ts` | `RollingTurn.repairedText` | 改为 segment 或 rename 为 `finalText` |
| `session-runtime/types.ts` | 类型含 `repairedText` | 同步类型 |
| `lexicon-v2/intent-warmup.ts`、prompt builder | mock `repairedText` | 改用 segment |
| `lexicon/replay-patch/patch-collector.ts` | `repairedText: ctx.repairedText ?? rawAsr` | 改为 segment |
| `aggregator-state*.ts` | `updateLastCommittedTextAfterRepair(..., repairedText)` | 参数 rename，语义不变 |

- [ ] V1 Target List 增加 **P1：Session/Intent/Replay 字段对齐**。

---

### 2.9 Recover 非主链代码（V1 说删除 repairedText，但 Recover step 仍存在）

FW 模式下 `LEXICON_RECALL` / `SENTENCE_REPAIR` 已从 pipeline 移除，但代码仍在：

- `apply-sentence-repair.ts`：写 `repairedText` + `segmentForJobResult`
- `sentence-repair-step.ts`、`lexicon-recall-step.ts`

**补充约束（与 V1「不考虑兼容」一致）：**

- [ ] Recover 路径若保留代码：统一改为只写 `segmentForJobResult`；或标记 `@deprecated` 并移出主链编译路径。
- [ ] `recover-contract.test.ts` / `v5-metrics.ts` 中 `repairedText` 引用需逐项清理或隔离。

---

## 3. V1 §七 代码修改清单 — 遗漏文件

在 V1 已有 8 个文件基础上，**必须追加**：

### P0（与主链/NMT 直接相关）

| 文件 | 改造要点 |
|------|----------|
| `pipeline/steps/dedup-step.ts` | 只读 `segmentForJobResult` |
| `pipeline/steps/semantic-repair-step.ts` | 去掉 `repairedText` / `syncRepairedTextBaseline`；写 segment |
| `pipeline/post-asr-routing.ts` | 删 `syncRepairedTextBaseline`；defer 不清文本；`getTextForTranslation` 仅 segment→asrText |
| `pipeline/steps/aggregation-step.ts` | 删 `postDetectorSegment` 的 repaired 分支；删 `ctx.repairedText=''` |
| `pipeline/steps/asr-step.ts` | 初始化 segment；**不再**写 `repairedText` |
| `pipeline/steps/fw-detector-step.ts` | `syncBaselineFromRaw` 只写 segment |
| `pipeline/steps/translation-step.ts` | 日志 source 改为 `segmentForJobResult` |

### P1（类型 / 契约 / 文档）

| 文件 | 改造要点 |
|------|----------|
| `pipeline/context/job-context.ts` | 删 `repairedText` 字段与注释 |
| `pipeline/result-builder.ts` | `text_asr` + extra 对齐 |
| `fw-detector/freeze-contract.test.ts` | 静态断言改为 `segmentForJobResult`（**与现 freeze 冲突**，见 §4） |
| `docs/FW_DETECTOR.md` | 字段表与数据流图 |
| `docs/ASR前后处理链路审计报告_2026_05_27.md` | 标注已修复 |

### P1（Session / 外围）

| 文件 | 改造要点 |
|------|----------|
| `session-runtime/session-finalize.ts` + tests | RollingTurn 字段 |
| `session-runtime/types.ts` | 类型 |
| `lexicon/replay-patch/*` | patch 提案字段 |
| `asr-repair/sentence-rerank/apply-sentence-repair.ts` | Recover 写回 |

### P2（测试全量）

| 文件 | 说明 |
|------|------|
| `tests/pipeline/repaired-text-not-overwritten.test.ts` | **语义反转**：改为「FW 写 segment 不被 aggregation/routing 覆盖」 |
| `tests/pipeline/finalize-complete-aggregation.test.ts` | 去掉 repairedText 基线断言 |
| `tests/pipeline/non-finalize-append.test.ts` | turn append 用 segment |
| `pipeline/result-builder.test.ts` | 大量 repairedText 假设 |
| `pipeline/pipeline-job-flow.test.ts` | 「本段 only」语义需与 turn finalize 全文对齐 **重新定契约** |
| `pipeline/post-asr-routing*.test.ts` | 重写 |
| `main/src/pipeline/steps/*-step.test.ts` | 批量更新 |

---

## 4. 与现有冻结契约 / 测试的冲突（实施前必须处理）

| 冲突项 | 现状 | V1 落地要求 |
|--------|------|-------------|
| `freeze-contract.test.ts` L88–92 | 要求 `result-builder` 含 `ctx.repairedText` | 改为断言 `segmentForJobResult` |
| `FW_DETECTOR.md` | 「NMT/text_asr ← repairedText」 | 更新为 segment SSOT |
| P0-Guard `repaired-text-not-overwritten.test.ts` | 保护 `repairedText` 不被覆盖 | 改名为 `segment-not-overwritten`；保护对象改为 segment |
| `pipeline-job-flow.test.ts` | 明确「result 只用 repairedText 本段，不能是 merged」 | **与 V1 turn finalize 全文目标矛盾** — 需产品决策：单 job 本段 vs turn 全文（V1 选全文） |
| `finalize-complete-aggregation.test.ts` | 「已有 repairedText 时 sync 不覆盖」 | 删除 repaired 分支测试 |

---

## 5. V1 Check List 补充项

在 V1 §九 基础上增加：

### 架构

- [ ] `syncRepairedTextBaseline` 已删除
- [ ] defer 路径仅改门控 flag，不清空 `segmentForJobResult`
- [ ] `text_asr_repaired` extra 已删除或等于 `text_asr`
- [ ] 不存在「本段 segment + 全文 repaired」双轨语义

### FW Detector

- [ ] Detect 输入源（`rawAsrText` vs `segment`）已在 V1 明确选型并落地
- [ ] Apply 只写 `segmentForJobResult`
- [ ] `asrRepairApplied` / 写锁在 5015/5016 生效

### Aggregation

- [ ] `postDetectorSegment` 删除或等价于读 `segmentForJobResult`
- [ ] turn finalize 后 `getTextForTranslation(segment)` 长度 ≥ 各 chunk 之和（集成测试）

### 外围

- [ ] `RollingTurn` / replay-patch / intent prompt 无 `repairedText` 主链依赖
- [ ] Recover 残留 step 不写第二文本源

### 回归

- [ ] 重写后的 P0 pipeline tests PASS
- [ ] `freeze-contract.test.ts` 更新后 PASS
- [ ] dialog_200 FW 批测：`text_asr` 与 NMT 输入 log 一致
- [ ] turn 多 chunk E2E：finalize 一次翻译 **完整 turn 文本**

---

## 6. V1 未覆盖、建议单列的架构决策项

实施前需产品/架构确认（写入 V1 §十 验收标准）：

| # | 决策 | 选项 | 建议 |
|---|------|------|------|
| D1 | FW detect 输入 | `rawAsrText` vs `segmentForJobResult` | **rawAsrText**（immutable） |
| D2 | 多 Node ASR batch | 单 batch 进 FW vs 合并后 detect | 短期：文档限制；中期：finalize 全 turn detect |
| D3 | 5017 与 FW lock | skip vs 调整步骤顺序 | 默认 off；开启时 skip if locked |
| D4 | `pipeline-job-flow`「本段 only」 | 废弃 vs 保留非 turn 模式 | turn 模式全文；非 turn 单 job 等价 |
| D5 | Recover 代码 | 删 vs 改 segment | 与 V1「不兼容」一致：改 segment 或隔离 |

---

## 7. 建议的 V1 实施方案顺序

```text
1. post-asr-routing + getTextForTranslation + result-builder（NMT/text_asr 对齐）
2. fw-detector-orchestrator + fw-detector-step + asr-step（去掉 repaired 双写）
3. aggregation-step + complete-aggregation（defer 不清 segment；finalize merge）
4. dedup + semantic-repair + markSemanticRepair*（segment 单写）
5. job-context 删字段 + session/replay 对齐
6. freeze-contract + pipeline tests 重写
7. FW_DETECTOR.md + V1 正文合并补充章节
```

---

## 8. 全仓 `repairedText` 引用规模（改造量级参考）

`electron_node/` 内约 **40+ 文件**、主进程 **~50 处**引用（含测试）。主链关键路径 **15 个源文件**（§3 P0/P1）。

---

## 9. 与 V1 Target List 的对照合并

| V1 Priority | V1 Target | 本清单补充 |
|-------------|-----------|------------|
| P0 | 消除双真值源 | + defer 不清 segment；删 syncRepairedTextBaseline |
| P0 | NMT/Result/Agg/FW 统一 segment | + dedup、5015、asr-step、fw-detector-step |
| P1 | 删除 repairedText 字段 | + session、replay、RollingTurn、extra.text_asr_repaired |
| P1 | 删除全仓引用 | 见 §8 规模 |
| P2 | 更新架构文档与冻结契约 | + freeze-contract **必改**；pipeline-job-flow **契约重定** |
| **新增 P0** | — | turn finalize 集成测试；detect 输入选型（§2.2） |
| **新增 P1** | — | isRecoverWriteLocked 语义/命名；5017 lock |

---

## 10. 结论

V1 方案**方向正确**，根因与主路径改造清单准确，但对照当前代码仍缺少：

1. **`rawAsrText` 与 detect 输入的明确分工**（含 multi-batch 缺口）  
2. **`syncRepairedTextBaseline` / defer 清空 repairedText** 的删除约束  
3. **dedup、5015、result extra、session/replay** 等遗漏改造点  
4. **写锁机制**在去掉 repairedText 后的迁移  
5. **freeze-contract 与 P0 测试**与 V1 目标的直接冲突及重写范围  
6. **turn finalize 全文**与旧测试「本段 only」的产品/契约决策  

建议在 V1 升版为 **V1.1** 时，将 §2、§3、§6 合并进正文，并将 §5 Check List 作为实施门禁。

---

**文档版本：** 1.0  
**维护：** 与 `ASR_主链统一方案_SegmentForJobResult_V1.md` 同步更新
