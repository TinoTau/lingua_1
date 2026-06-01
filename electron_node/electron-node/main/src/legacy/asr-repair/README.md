# Legacy ASR Repair

**Status:** Legacy-only · **Not part of FW frozen main chain**

默认 `asr.engine = fw_detector_v1` 时 **不执行** 本模块步骤。FW 主链见 [`../../fw-detector/README.md`](../../fw-detector/README.md)。

---

## 1. 用途

本目录归档 CTC n-best、窗召回、句级 expansion、KenLM rerank apply 等 Legacy ASR repair 链路。

- 非 FW 引擎（`applyLegacyAsrRepairPipelineMode` 注入 `LEXICON_RECALL` / `SENTENCE_REPAIR`）
- 历史对照、契约单测、`npm run test:contract`

**新功能不得添加到本目录。**

---

## 2. 数据流

```text
ASR + n-best
  → AGGREGATION（segment 文本，保留 CTC n-best）
  → LEXICON_RECALL（diff 窗 → WindowCandidate[]）
  → SENTENCE_REPAIR（扩展 → KenLM → legacy-apply-sentence-repair 单次写回）
  → PHONETIC_CORRECTION（segment write lock）
```

原则：segment-first；禁止 raw CTC 直接 final pick；单路径无 V4 并行。

---

## 3. 目录

| 路径 | 职责 |
|------|------|
| `legacy-asr-repair-contract.ts` | 契约、lifecycle、`stampAsrRepairPipelineSkip` |
| `legacy-asr-repair-result-extra.ts` | 非 FW `result.extra` |
| `steps/legacy-lexicon-recall-step.ts` | Window hotword recall |
| `steps/legacy-sentence-repair-step.ts` | 句级 expansion + rerank |
| `asr-repair/sentence-expansion/` | 窗扩展候选 |
| `asr-repair/sentence-rerank/legacy-apply-sentence-repair.ts` | 句级 apply 写点 |
| `asr-repair/asr-repair-safety-gates.ts` | 安全门控 |

KenLM scorer 共用：`main/src/asr-repair/`（FW weak_veto 亦用）。

---

## 4. 契约与 extra（R4）

契约版本：`v5-scored-lexicon-topk`（`legacy-asr-repair-contract.ts`）。

**JSON 键（唯一）：**

| 键 | 说明 |
|----|------|
| `asr_repair_contract_version` | 契约版本 |
| `asr_repair_lifecycle` | lifecycle 观测 |
| `asr_repair_skipped` | 跳过标记 |
| `sentence_repair` | 句修复详情 |
| `window_candidates` / `sentence_candidates` | 候选 |
| `qualityConfig` | `asr-repair-quality/quality-config.ts` |

**已删除旧键：** `recover_contract_version`、`recover_lifecycle`、`recover_skipped`。  
**skipReason：** `asr_repair_not_run`（非 `recover_not_run`）。

---

## 5. 质量门限

`asr-repair-quality/quality-config.ts`：

| 字段 | 默认 |
|------|------|
| `recallMinPhoneticScore` | 0.5 |
| `selectionMinPhoneticScore` | 0.85 |
| `maxReplacements` | 2 |
| `maxSentenceCandidates` | 32 |
| `kenlmBaselineTolerance` | 0.15 |

开关：`features.lexiconRecall.enabled`、`features.lexiconRecall.contractVersion`。

---

## 6. Rename 迁移（R1~R4 完成）

| 旧 | 新 |
|----|-----|
| `legacy/recover/` | `legacy/asr-repair/` |
| `recover-quality/` | `asr-repair-quality/` |
| `RecoverLifecycle` | `AsrRepairLifecycle` |
| `legacy.recover` | `legacy.asrRepair` |

排除 rename：`intent-recovery`、`recoverStats`（session 统计）、`window-recall`（候选召回语义）。

---

## 7. 隔离要求

FW 冻结主链 **不得** import `legacy/asr-repair`（`scripts/fw-detector-gate.mjs`）。

```powershell
cd electron_node/electron-node
npm run test:contract
```

---

## 相关

| 文档 | 路径 |
|------|------|
| V3 Lexicon | [`../../lexicon/README.md`](../../lexicon/README.md) |
| Pipeline | [`../../pipeline/README.md`](../../pipeline/README.md) |
| FW 冻结 | [`../../fw-detector/README.md`](../../fw-detector/README.md) |
