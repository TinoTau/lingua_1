# ASR→FW 主链 Legacy Recover 命名与文档补丁 — 开发报告（含 dialog_200 回归）

版本：V1.1（含集成测试）  
日期：2026-05-30  
主链：**未改控制流** — `ASR → FW_SPAN_DETECTOR → AGGREGATION → DEDUP → TRANSLATION`

---

## 1. 本轮开发摘要

将已从默认主链隔离的 Recover 旧代码统一命名为 **legacy / deprecated / recover-only**，增强静态门禁与冻结合约，更新 FINAL / FW_DETECTOR / legacy README 文档。

**不包含：** 恢复 Recover、修改 FW 决策逻辑、修改 KenLM weak_veto、新增业务文本字段。

---

## 2. 改名清单

| 旧 path / symbol | 新 path / symbol | 动作 |
|------------------|------------------|------|
| `recover-contract.ts` | `legacy-recover-contract.ts` | 重命名 + `@deprecated` |
| `buildRecoverContractExtra` | `buildLegacyRecoverContractExtra` | 重命名 |
| `runLexiconRecallStep` | `runLegacyLexiconRecallStep` | 重命名 |
| `runSentenceRepairStep` | `runLegacySentenceRepairStep` | 重命名 |
| `applySentenceRepair` | `applyLegacySentenceRepair` | 重命名 |
| `v5-metrics.ts` | `legacy-v5-metrics.ts` | 重命名 |
| `lexicon-recall-step.ts` | `legacy-lexicon-recall-step.ts` | 重命名 |
| `sentence-repair-step.ts` | `legacy-sentence-repair-step.ts` | 重命名 |
| `apply-sentence-repair.ts` | `legacy-apply-sentence-repair.ts` | 重命名 |
| — | `pipeline/recover-result-bridge.ts` | 新增（FW result-builder 不直接 import legacy） |
| — | `pipeline/lexicon-runtime-contract.ts` | 新增（FW 共用 lexicon 状态） |

---

## 3. 门禁与冻结合约

### fw-detector-gate.mjs

- FW 主链禁止 `legacy/recover` import 与 legacy 符号
- 禁止 `LEXICON_RECALL` / `SENTENCE_REPAIR`（registry / pipeline-mode-fw 例外）
- registry 必须含 Legacy Recover 注释

### freeze-contract.test.ts

- FW mode 无 Recover 步骤
- result-builder / orchestrator 静态断言
- JobContext 无 `repairedText`

---

## 4. 文档

| 文档 | 内容 |
|------|------|
| `docs/ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md` | §16 Legacy Recover Boundary |
| `electron-node/docs/FW_DETECTOR.md` | Legacy 边界 + KenLM 共享说明 |
| `main/src/legacy/recover/README.md` | deprecated 状态、禁止/允许 import、删除 checklist |

---

## 5. 单元测试结果（2026-05-30）

| 命令 | 结果 |
|------|------|
| `npm run build` | PASS |
| `node scripts/fw-detector-gate.mjs` | PASS |
| `npm run test:fw-detector` | 64 tests PASS |
| `npm run test:contract` | 10 tests PASS |
| `npm run test:pipeline` | 10 tests PASS |
| `npm run test:recover` | 28 tests PASS |

---

## 6. dialog_200 集成回归（全量 200）

详见：[测试报告 dialog200×200](ASR_FW主链LegacyRecover命名补丁_测试报告_dialog200_200_2026_05_30.md)

### 6.1 契约

- **200 / 200 PASS**
- 无 `sentence_repair` / `window_candidates` / CTC n-best
- `lexicon_runtime_status=ok` × 200

### 6.2 识别质量

| 指标 | raw | FW 后 |
|------|-----|-------|
| 平均 CER | 36.19% | 35.93% |
| FW 改善 / 劣化 | — | 9 / **0** |
| apply case 平均 CER Δ | — | −5.83% |

### 6.3 性能

| 指标 | p50 | p95 | avg |
|------|-----|-----|-----|
| pipeline_ms | 2167 ms | 4065 ms | 2471 ms |
| asr_latency_ms | 864 ms | 1192 ms | 874 ms |
| RTF (pipeline/audio) | — | — | **0.679** |

---

## 7. 风险与后续

1. **JobContext 仍含 legacy 类型 import** — 删 legacy 时需同步精简。
2. **lexicon_homophone 场景 FW 未 apply** — P1.3 Coverage，非本轮范围。
3. **TTS 音频 CER 基线偏高** — 批测以契约 + FW 不劣化为主指标。

---

## 8. 验收结论

Legacy Recover 命名补丁 **开发完成**；FW 主链冻结 **200/200 契约通过**；识别质量 FW 相对 raw **9 改善 / 0 劣化**；性能 p50 **2.17s/case**。
