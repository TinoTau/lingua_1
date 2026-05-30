# Recover Legacy（CTC n-best / LEXICON_RECALL / SENTENCE_REPAIR）

**状态：** 物理隔离（P2，2026-05-30）  
**默认主链：** 不执行 — FW-only 使用 `fw-detector/` + `pipeline/`  
**规范 SSOT：** `docs/ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md`

## 目录

| 路径 | 职责 |
|------|------|
| `steps/lexicon-recall-step.ts` | Window hotword recall |
| `steps/sentence-repair-step.ts` | 句级 expansion + KenLM rerank + apply |
| `recover-contract.ts` | Recover extra / lifecycle 契约 |
| `v5-metrics.ts` | V5 批测指标 |
| `asr-repair/sentence-expansion/` | 窗扩展候选 |
| `asr-repair/sentence-rerank/` | rerank / apply（KenLM scorer 仍在 `asr-repair/sentence-rerank/kenlm-scorer.ts` 供 FW 共享） |

## 注册

Recover 步骤仍通过 `pipeline/pipeline-step-registry.ts` 注册，仅在非 FW Recover pipeline 模式下执行。

## 禁止

- FW 主链模块（`fw-detector/`、`fw-detector-step`、`aggregation-step` 等）不得 import 本目录
- 不得将 Recover extra 默认打入 FW `buildFwResultExtra`

## 测试

```powershell
npx jest --testPathPattern="legacy/recover|recover-contract|recover-safety|recover-nbest|lexicon-recall-step|candidate-source|sentence-repair-observability|sentence-expansion"
```
