# Pinyin IME v2 SpanSelector 开发方案 — 补充信息与约束清单

**日期：** 2026-06-07  
**对照文档：** [Pinyin IME v2 SpanSelector 开发方案.md](./Pinyin%20IME%20v2%20SpanSelector%20开发方案.md)  
**对照代码：** `electron_node/electron-node/main/src/fw-detector/pinyin-ime-v2/`  
**性质：** 只读审计产出，供开发前补齐方案缺口（本文档本身不实施代码）

---

## 使用说明

- **【必须补充】** — 原方案未写清，开发前应在主方案中落字，否则易返工  
- **【建议补充】** — 强烈建议写入验收或 Target List  
- **【事实校正】** — 原方案与当前代码不一致，应修正描述  
- **【冻结冲突】** — 与历史冻结文档冲突，需显式修订或加注例外  
- **【不在范围】** — 本阶段明确不做，防止 scope creep  

---

## 一、方案与代码事实差异（【事实校正】）

| # | 原方案表述 | 代码事实 | 建议修正 |
|---|-----------|----------|----------|
| F1 | Normalizer 负责「边界修正」 | **边界修正**在 Proposal 阶段：`applyBoundaryDiscovery`（`run-pinyin-ime-v2-span-proposal.ts`）；Normalizer 仅 **合并 interval + 字数/音节门控** | Normalizer 职责改为：合并 diff/instability/boundary、单字过滤、`maxSpanChars=6` 过长过滤、音节 2–5 |
| F2 | Proposal 输出 `SpanProposal[]` | 实际类型为 `PinyinImeV2SpanProposal`：`diffSpans` + `instabilityRegions` + `boundaryCompatibleTopKSpans` + `diagnostics` | 对齐现有类型名，不引入新数组别名 |
| F3 | 链路为 `Proposal → Normalizer → SpanSelector` 三文件串联 | **当前** `normalizePinyinImeV2Spans` 在 `runPinyinImeV2HintGate` **内部**调用；`resolve-pinyin-ime-v2-spans.ts` 只调 HintGate | SpanSelector **继续内调 normalizer**（与现结构一致），不必把 normalizer 提到 resolve 层 |
| F4 | `SelectedSpan` 含 `supportCount/neighborHit/score` | 现 `PinyinImeV2ApprovedSpan` 仅：`rawSpan,start,end,confidence,reason`；下游 `FwSpanDiagnostics` 只用 `confidence→riskScore`、`reason→signals` | 区分 **内部排序用字段** vs **输出 SelectedSpan**；或保留 `confidence/reason` 不变，排序字段仅 selector 内部 |
| F5 | 新逻辑 `maxSelectedSpans` | 配置键仍为 `maxApprovedSpans`（`pinyin-ime-v2-config.ts`、`node-config-types.ts`、orchestrator `configSnapshot`） | 写明：**首轮可不改配置键**，仅改语义；若改名需同步 `electron-node-config.json` schema |
| F6 | 排序仅用于超额裁剪 | dialog_200 批测 **仅 1 案**（`d185`）`normPassed>4`；**105/106** 案走 `all_passed` | 验收重心在 **去掉 veto**，排序单测仍需覆盖 `ranked_capped` |
| F7 | d002 修复后必进 Recall | 降级后 d002 可得 **2 span**，但 **apply 仍可能为 0**（KenLM `minDeltaToReplace=0.03` 第二断点） | 验收写清：**进 span / 进 Recall 即可**，不要求 apply>0 |

---

## 二、必须补充的硬约束（【必须补充】）

### 2.1 行为约束（冻结边界）

| ID | 约束 | 代码依据 |
|----|------|----------|
| C1 | **禁止** SpanSelector 输出 replacement 文本、调用 `applyFwSpanReplacements`、写 `segmentForJobResult` | `pinyin-ime-v2-freeze-contract.test.ts`；模块内无 apply 导入 |
| C2 | **禁止** 修改 `topK`（IME decode TopK，默认 5） | 用户约束 + `runPinyinImeV2SpanProposal` 仅收 `topK` |
| C3 | **禁止** 本阶段修改：`local-span-recall.ts`、`fw-sentence-rerank-pipeline.ts`、`rerank-fw-sentences.ts`、`apply-span-replacements.ts`、Tone 排序 | 主方案 §十二；orchestrator 早退条件不变 |
| C4 | `directRepair` 必须保持 `false`（config loader 硬编码） | `pinyin-ime-v2-config.ts` L35 |
| C5 | `lexiconNearNeighbor` **仍可**调用 `recallSpanTopK(span, profile, topK=1, minPrior, enabledDomains)` — 仅角色从 **veto → rank** | `resolve-pinyin-ime-v2-spans.ts` L35-43 |
| C6 | neighbor 探针仍受 `primaryDomain` / `resolveDomainIdsForRecall` 影响（general → 无 domain 层） | 与下一阶段 domain weak fallback **正交**；本阶段不依赖 fallback 即可过 d002 |
| C7 | `approvedSpanCount=0` → `spans.length===0` → orchestrator `reason:'no_spans'` **机制保留**，仅「何時为 0」变化 | `fw-detector-orchestrator.ts` L206-211 |

### 2.2 排序公式（【必须补充】— 原方案仅有示例）

原方案 `score = supportWeight + neighborWeight + boundaryWeight` **未冻结权重**。开发前需写入主方案：

```text
建议冻结 v1（与现排序习惯对齐）：
  neighborHit     → +1000（或布尔 1/0 乘大权重）
  supportCount    → +supportCount * 10
  boundaryTopK    → +100（fromBoundaryTopKDiff）
  instability     → +50（fromInstability）
  tie-break       → start 升序（与现 hint-gate sort 一致）
```

| ID | 要求 |
|----|------|
| C8 | 权重写入代码常量或 config，**禁止** silent 改权重不更新文档 |
| C9 | `minSupportCount`（默认 2）**不再 veto**；需明确：废弃 / 仅作 rank 加分 / 保留配置但不读 |
| C10 | `computeConfidence(supportCount, topK, hasNeighbor)` **建议保留**用于 `FwSpanDiagnostics.riskScore`，避免下游行为漂移 |

### 2.3 兼容层（【必须补充】）

| 旧字段 / API | 新字段 | 写入位置 | 轮次 |
|-------------|--------|----------|------|
| `approvedSpanCount` | `selectedSpanCount` | `PinyinImeV2ActiveDiagnostics` + `resolve-pinyin-ime-v2-spans.ts` | 双写 ≥1 轮 |
| `gateDroppedNoNeighbor` | `legacyGateDroppedNoNeighbor` | 同上；新逻辑下可 **仿真旧 veto 计数** 便于对比 | 双写 |
| `no_approved_spans` | `no_selected_spans` | `skippedReason` union；IME disabled 路径也需双写 | 双写 |
| `runPinyinImeV2HintGate` | `selectPinyinImeV2Spans` | `index.ts` **deprecated re-export** | 建议保留 1 轮 |
| `PinyinImeV2ApprovedSpan` | `PinyinImeV2SelectedSpan` | `type` alias | 建议保留 1 轮 |

**【必须补充】** `legacyGateDroppedNoNeighbor` 定义：

```text
在 all_passed 模式下：统计「若仍用旧 neighbor veto 会被拒」的 span 数（用于审计对比，非运行时拒绝）
```

### 2.4 诊断双层结构（【必须补充】）

当前存在 **两层** 诊断，原方案只写了 `SpanSelectorDiagnostics`：

| 层级 | 类型 | 位置 | 说明 |
|------|------|------|------|
| 内层 | `PinyinImeV2HintGateDiagnostics` → 改名 | `pinyin-ime-v2-types.ts` | `inputSpanCount`、`normalizerDroppedSingleChar`、`normalizerDroppedSyllableRange` 等 **需保留或映射** |
| 外层 | `PinyinImeV2ActiveDiagnostics` | `fw-detector/types.ts` | 批测 JSON 主读层；**缺** `gateDroppedMaxSpans` 透传（内层有、外层从未暴露） |

| ID | 补充项 |
|----|--------|
| C11 | 外层增加：`selectedSpanCount`、`selectionMode`、`cappedByMaxSpansCount`（可选 `neighborHitCount`） |
| C12 | 内层 `gateDroppedMaxSpans` → 外层 `cappedByMaxSpansCount` **应首次打通**（现 bug/缺口） |
| C13 | `gateDroppedSupport` 在本批恒 0；降级后建议 **固定写 0** 或 deprecated |

---

## 三、影响面遗漏（【建议补充】到 Target List）

### 3.1 源码文件（主方案未列全）

| 文件 | 改动类型 |
|------|----------|
| `pinyin-ime-v2-hint-gate.ts` | 重命名 + 逻辑重写 → `pinyin-ime-v2-span-selector.ts` |
| `pinyin-ime-v2-types.ts` | 类型新增/alias |
| `fw-detector/types.ts` | `PinyinImeV2ActiveDiagnostics` 扩展 |
| `resolve-pinyin-ime-v2-spans.ts` | 调用 + 诊断双写 + 注释 |
| `map-approved-span-to-fw.ts` | 类型 import（可选改名文件） |
| `index.ts` | export + deprecated |
| `pinyin-ime-v2-hint-gate.test.ts` | 重命名 + 断言改造 |
| `pinyin-ime-v2-freeze-contract.test.ts` | **静态读文件路径** `readV2('pinyin-ime-v2-hint-gate.ts')` → 必改 |
| `resolve-pinyin-ime-v2-spans.test.ts` | `skippedReason` 断言 |
| `freeze-contract.test.ts` | 测试名 `HintGate 不依赖 V1` 可改文案 |

**【建议补充】** 文件处置策略（二选一，写入主方案）：

- **A（推荐）：** 新建 `span-selector.ts`，旧文件 **薄 shim** re-export deprecated（满足 freeze-contract 文件名可过渡）  
- **B：** 直接 rename + 全量改 import（freeze-contract 同步改）

### 3.2 测试 / 脚本（主方案未列）

| 路径 | 依赖字段 |
|------|----------|
| `tests/experiments/recall-candidate-dump-audit.mjs` | `approvedSpanCount` |
| `tests/experiments/recall-width-*.mjs` | 同上 |
| `tests/_audit-kenlm-p15-*.mjs` | 同上 |
| `tests/analyze-phase4b1-batch.mjs` | `approvedSpanCount`, gate* |
| `tests/analyze-post-cleanup-batch.mjs` | `gateDroppedNoNeighbor` |
| `tests/verify-pinyin-ime-v2-dict-recovery.mjs` | `approvedSpanCount` |
| `tests/lexicon-tone-dialog200-batch-result.json` | 历史基线，**不修改**；新批测另存 |

### 3.3 文档（主方案 §十 已有，补充路径）

| 文档 | 备注 |
|------|------|
| `docs/pinyin-v2/ARCHITECTURE.md` §7、§14、§15 | 「宁可漏报」措辞需 **修订** 为 SpanSelector 语义 |
| `docs/pinyin-v2/README.md` | 主链图 |
| `docs/pinyin-v2/Domain_Constrained_Recall_P2_Supplement_Checklist_2026_06_03.md` | **禁止改 hint-gate 门控** — 见 §五 |
| `docs/tone/ToneModule_P0_Supplement_Checklist_2026_06_03.md` | **禁止改 HintGate neighbor** — 见 §五 |
| `docs/tone/Pinyin_IME_v2_HintGate_*_Audit_2026_06_07.md` | 索引交叉引用 |
| `docs/tone/Lexicon_Tone_2026_06_07_文档索引.md` | 新增 SpanSelector 报告链接 |

---

## 四、验收指标补充（【建议补充】）

### 4.1 主方案已有 — 确认仍有效

| 指标 | 基线 | 目标 | 数据来源 |
|------|------|------|----------|
| contract PASS | 200/200 | 200/200 | `run-dialog200-timed-batch.mjs` |
| `fw_triggered` | 66 | **≥ 106** | `lexicon-tone-dialog200-batch-result.json` |
| `no_spans` | 134 | **≤ 94** | 同上 |
| span 总数 | 107 | **≈ 173** | Σ min(4, normPassed) |
| d002 `selectedSpanCount` | 0 | **≥ 2** | 案 d002 |
| d003 | 2 span | **不退化** | 案 d003 |
| d001 | 0 | **仍为 0** | normalizer 根因，**非本阶段目标** |

### 4.2 主方案缺失 — 建议新增

| ID | 指标 | 说明 |
|----|------|------|
| A1 | `legacyGateDroppedNoNeighbor` 在 all_passed 案可 >0，但 `selectedSpanCount>0` | 证明 veto 已移除 |
| A2 | `selectionMode=all_passed` 案数 **≈ 105** | 与批测分布一致 |
| A3 | `selectionMode=ranked_capped` 案数 **≈ 1**（d185） | 覆盖超额裁剪 |
| A4 | **false positive span** 单独统计 | 新批准 span 中无 ASR 错词 / 误选比例（脚本级，不阻塞 CI） |
| A5 | `fw_detector_step_ms` P95 不明显退化 | KenLM 查询增加风险 |
| A6 | `apply` **不要求** >0 | KenLM 第二断点未动 |
| A7 | Jest：`pinyin-ime-v2-freeze-contract` + `freeze-contract` + `test:fw-detector` 全绿 | 主方案仅写 tsc |
| A8 | `npm run build:main` 通过 | dist 同步 |

### 4.3 仍无法改善的 no_spans（【必须补充】预期管理）

降级后预计 **仍有 ~94 案 no_spans**，来源：

| 根因 | 约数量 | 本阶段 |
|------|--------|--------|
| normalizer 杀光 | ~65 | **不在范围**（除非另开 IME/normalizer 任务） |
| 无 CJK | ~29 | 不在范围 |
| proposal 空 | 少量 | 不在范围 |

**d001**（`diffSpanCount=0`，`boundaryCompatibleTopKSpanCount=2`，`normalizerDroppedCount=2`）**不会因 SpanSelector 单独修复**。

---

## 五、冻结文档冲突（【冻结冲突】— 开发前需修订）

| 文档 | 冲突内容 | 建议处理 |
|------|----------|----------|
| `Domain_Constrained_Recall_P2_Supplement_Checklist` | **禁止**改 `pinyin-ime-v2-hint-gate.ts` 门控规则 | 新增 **SpanSelector V1.0 例外条款**，废止「neighbor veto」冻结 |
| `ToneModule_P0_Supplement_Checklist` | **禁止**改 `HintGate lexiconNearNeighbor` | 注明：neighbor **仍调用 recallSpanTopK(…,1,…)**，**无 tone**，仅语义降级 |
| `KenLM_P1_Blocking_Audit` | 「禁止 HintGate 调整」 | 标注为历史审计边界；本变更为 **已批准架构调整** |
| `ARCHITECTURE.md` §14 | 「宁可漏报，HintGate 门控」 | 改为「SpanSelector 数量控制 + KenLM/Apply _precision_」 |

---

## 六、与下一阶段衔接（【建议补充】）

主方案 §十二写「通过后进入 PrimaryDomain General → AllDomainWeakRecall」。

| ID | 补充约束 |
|----|----------|
| P1 | **两阶段正交**：SpanSelector 去掉 veto 后，d002 可不依赖 domain fallback；fallback 仍改善 **rank 分** 与正式 Recall |
| P2 | domain fallback **不应**在本阶段混入 SpanSelector PR（避免双变量） |
| P3 | 若合并一 PR，验收需 **分报告**：selector 收益 vs fallback 收益 |

---

## 七、明确不在范围（【不在范围】）

- IME decode / diff / boundary proposal 算法  
- `normalizePinyinImeV2Spans` 规则（含 `minSpanChars/maxSpanChars/min/maxSyllables`）  
- `maxApprovedSpans` 数值（保持 4）  
- Recall SQL / `perSpanLimit` / domain recall 查询条件  
- ToneModule、`sortRecallHitsByToneCompatibility`  
- KenLM `minDeltaToReplace`、Apply gate  
- `lexicon_v2_intent` / CPU LLM profile  
- 批测脚本注入 `restaurant` profile（可作为 **对照实验**，非本 PR 必需）  
- 删除 `pinyin-ime-v2-hint-gate.ts` 且无 shim（freeze-contract 会断）  

---

## 八、开发前 Checklist（合并版）

### 8.1 方案文档（开发前）

- [ ] 校正 Normalizer / Proposal 职责描述（§一 F1–F3）  
- [ ] 冻结排序权重与 tie-break（§二 C8–C9）  
- [ ] 冻结 `SelectedSpan` 与 `FwSpanDiagnostics` 字段映射（§一 F4、C10）  
- [ ] 冻结兼容 alias 列表与轮次（§二 2.3）  
- [ ] 修订 P2 / Tone P0 冻结冲突（§五）  
- [ ] 明确文件 shim vs rename 策略（§三 3.1）  
- [ ] 补充 FP span / P95 验收（§四 4.2）  
- [ ] 写明 d001 / normalizer 94 案 **非目标**（§四 4.3）  

### 8.2 实现（开发时）

- [ ] `selectPinyinImeV2Spans`：`all_passed` / `ranked_capped` / `empty_after_normalizer`  
- [ ] 去掉 neighbor/support **veto**；保留 `maxApprovedSpans` cap  
- [ ] 双层 diagnostics 双写 + `cappedByMaxSpansCount` 透传（C11–C12）  
- [ ] `index.ts` deprecated export  
- [ ] 更新 freeze-contract 静态测试路径  

### 8.3 测试（开发后）

- [ ] `pinyin-ime-v2-span-selector.test.ts`：neighbor false **仍选中**（≤4 spans）  
- [ ] 超额裁剪单测（>4 spans → `ranked_capped`）  
- [ ] `npm run test:fw-detector`  
- [ ] `run-dialog200-timed-batch.mjs` → 对比 §四指标  
- [ ] d001/d002/d003 专项断言  

---

## 九、一句话结论

原 **SpanSelector 开发方案** 方向正确、范围基本准确，但需补齐：**(1) 与代码事实对齐的职责/类型描述；(2) 冻结排序权重与 minSupportCount 处置；(3) 双层 diagnostics 与 alias 策略；(4) 完整影响面含 freeze-contract 与 6+ 实验脚本；(5) 历史冻结文档例外；(6) d001/normalizer/apply 预期管理**。完成以上补充后再进入开发，可避免与 P2/Tone 冻结及批测基线冲突。

---

## 附录：关键代码锚点

| 主题 | 路径 |
|------|------|
| 现 HintGate 逻辑 | `pinyin-ime-v2-hint-gate.ts` |
| 编排入口 | `resolve-pinyin-ime-v2-spans.ts` |
| Normalizer | `pinyin-ime-v2-span-normalizer.ts` |
| FW 映射 | `map-approved-span-to-fw.ts` |
| 外层诊断类型 | `fw-detector/types.ts` → `PinyinImeV2ActiveDiagnostics` |
| 早退 no_spans | `fw-detector-orchestrator.ts` L206-211 |
| 默认配置 | `pinyin-ime-v2-config.ts` → `maxApprovedSpans:4`, `minSupportCount:2` |
| 批测基线 | `tests/lexicon-tone-dialog200-batch-result.json` |
| 必要性/降级审计 | `Pinyin_IME_v2_HintGate_Downgrade_Naming_Audit_2026_06_07.md` |
