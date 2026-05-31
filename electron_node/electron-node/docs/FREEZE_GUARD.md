# Freeze Guard — P1~P4 FW 主链门禁

**Status:** ACTIVE  
**Scope:** `asr.engine = fw_detector_v1` 生产路径  
**关联：** [FW_MAINLINE_FREEZE.md](./FW_MAINLINE_FREEZE.md) · [PIPELINE.md](./PIPELINE.md)

---

## 1. 冻结主链

```text
ASR → Metadata Span Gate → Lexicon V2 Recall → P4 Sentence Rerank
→ applyFwSpanReplacements → segmentForJobResult → Aggregation → NMT
```

---

## 2. 禁止新增

| 类别 | 禁止 |
|------|------|
| Span 来源 | Metadata Gate 以外的 span 选择器进入默认路径 |
| Recall | V2 以外的 recall 实现进入默认路径 |
| 决策链 | Sentence Rerank 以外的 FW 决策链进入默认路径 |
| Apply | `applyFwSpanReplacements` 以外的 FW 写回 |
| NMT 输入 | `segmentForJobResult` 以外的字段作为翻译输入 |
| 写点 | 下表白名单以外的 `segmentForJobResult` 赋值 |

---

## 3. 唯一允许

| 角色 | 唯一实现 |
|------|----------|
| Span | `selectFwMetadataSpans`（`fw-metadata-span-gate.ts`） |
| Recall | `recallSpanTopK` → V2（`useLexiconRuntimeV2Recall` + `lexiconRuntimeV2.enabled`） |
| 决策 | `runFwSentenceRerankPipeline`（`useSentenceLevelRerank: true`） |
| Apply | `applyFwSpanReplacements`（`fw-detector-orchestrator.ts`） |
| NMT 输入 | `ctx.segmentForJobResult`（`resolveBusinessAsrText`） |

**例外（仍为冻结路径，非可删 legacy）：**

- Metadata Gate **legacy fallback**（`fallbackLegacyMaxSpans=1`）→ `suspicious-span-detector-v1.ts`
- 配置回滚：`useSentenceLevelRerank=false` → `legacy/fw-detector/fw-topk-decision-pipeline.ts`

---

## 4. segmentForJobResult 写点白名单

| 文件 | 场景 | 分类 |
|------|------|------|
| `pipeline/steps/asr-step.ts` | init from `rawAsrText` | 主链 init |
| `pipeline/steps/fw-detector-step.ts` | skip/disabled sync | 主链 init |
| `fw-detector/fw-detector-orchestrator.ts` | no_spans / apply | **主链唯一 FW apply** |
| `pipeline/steps/aggregation-step.ts` | turn 合并 | 主链 |
| `pipeline/steps/semantic-repair-step.ts` | 5015 | enhancement（write-lock） |
| `pipeline/steps/phonetic-correction-step.ts` | 5016 | enhancement（write-lock） |
| `pipeline/steps/punctuation-restore-step.ts` | 5017 | enhancement（write-lock） |
| `pipeline/post-asr-routing.ts` | 5015 helper | enhancement（write-lock） |
| `legacy/recover/.../legacy-apply-sentence-repair.ts` | Recover pick | legacy only |

**不算写点：** `agent/postprocess/aggregation-stage.ts` 局部变量。

FW apply 后 `isSegmentWriteLocked`（`ctx.asrRepairApplied === true`）阻止 5015/5016/5017 写回。

---

## 5. Orchestrator 双路径（回滚保留）

即使 `legacy/fw-detector/` 归档，orchestrator **必须保留**：

- `runFwSentenceRerankPipeline` — P4 默认
- `runFwTopKDecisionPipeline` — `useSentenceLevelRerank=false`
- `createSpanDetectorHint` — legacy_detector / topK 回滚
- metadata gate `legacyFallback` 回调

---

## 6. 实现门禁

| 门禁 | 路径 |
|------|------|
| 冻结合约 | `main/src/fw-detector/freeze-contract.test.ts` |
| 静态隔离 | `scripts/fw-detector-gate.mjs` |
| SSOT 一致 | `main/src/fw-detector/freeze-config-ssot.test.ts` |

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
node scripts/fw-detector-gate.mjs
```

---

## 7. 解冻流程

1. 改 `tests/freeze-rollback-config.json` 中对应块  
2. 人工 merge 到 `%APPDATA%/lingua-electron-node/electron-node-config.json`  
3. 跑 dialog_200 回归  
4. **不得**为回滚修改主链源码（仅 config）

---

## 8. Legacy 边界

| 路径 | 说明 |
|------|------|
| `main/src/legacy/fw-detector/` | P1.2b 回滚链（topK + weak_veto） |
| `main/src/legacy/recover/` | Recover 引擎（非 FW 默认 step） |
| `main/src/fw-detector/` | 冻结主链 + metadata fallback |

FW 主链源文件 **禁止** `import ... legacy/recover`（gate 断言）。
