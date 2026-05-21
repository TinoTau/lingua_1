# P0 CTC n-best Evidence Passthrough 开发报告

**日期**：2026-05-17  
**依据**：`docs/CTC_Nbest_KenLM_Meta_Passthrough_Design_Audit_2026-05-17.md`  
**范围**：Node 侧 evidence 透传（无改写、无词库、无 selector）

---

## 1. 修改文件

| 文件 | 操作 |
|------|------|
| `electron_node/electron-node/main/src/task-router/asr-evidence-types.ts` | **新增** `AsrNBestItem` / `AsrKenlmMeta` |
| `electron_node/electron-node/main/src/task-router/asr-response-mapper.ts` | **新增** `mapCtcUtteranceResponse` |
| `electron_node/electron-node/main/src/task-router/asr-response-mapper.test.ts` | **新增** Mapper 单测 |
| `electron_node/electron-node/main/src/task-router/types.ts` | `ASRResult` 增加 `nbest?` / `kenlmMeta?` |
| `electron_node/electron-node/main/src/task-router/ctc-asr-strategy.ts` | 合并 mapper 输出 |
| `electron_node/electron-node/main/src/pipeline/context/job-context.ts` | `asrNbest?` / `asrKenlmMeta?` |
| `electron_node/electron-node/main/src/pipeline/steps/asr-step.ts` | 首段 ASR 写入 ctx evidence |
| `electron_node/electron-node/main/src/pipeline/result-builder.ts` | `extra.asr_nbest` / `extra.asr_kenlm_meta` |
| `electron_node/electron-node/main/src/pipeline/result-builder.test.ts` | extra 落盘单测 |

**未修改**：Python ASR、`translation-step`、aggregation、增强步骤、`faster-whisper-asr-strategy`（无 nbest 时自然为空）。

---

## 2. ASR response 字段映射

### n-best

| 来源优先级 | `data.nbest` → `data.hypotheses` → `data.beams` |
| HTTP | Node (`AsrNBestItem`) |
|------|----------------------|
| 数组下标 | `rank` |
| `text` (string) | `text`（非 string 跳过） |
| `score` | `score`, `totalScore` |
| `logit_score` | `acousticScore` |
| `lm_score` | `lmScore` |
| `kenlm_decision` | `kenlmDecision` |
| 原对象 | `raw` |

### KenLM meta

| 来源优先级 | `data.kenlm` → `data.kenlm_meta` → `data.lm_meta` → `data.meta?.kenlm` |
| 已知字段 | 原样映射到 `AsrKenlmMeta`（仅当源对象含对应键） |
| `meta.decode_ms` | **不**映射为 KenLM meta |

---

## 3. ASRResult / JobContext / JobResult.extra 变化

```text
POST /utterance response.data
  → mapCtcUtteranceResponse(data)
  → ASRResult { text, ..., nbest?, kenlmMeta? }   // text 仍来自 data.text
  → asr-step: ctx.asrNbest / ctx.asrKenlmMeta     // 仅 i===0
  → buildJobResult: extra.asr_nbest / extra.asr_kenlm_meta
```

- `text_asr` 仍来自 `ctx.repairedText`（聚合/语义修复链），**未**改用 n-best。
- `extra.asr_nbest`：仅当 `ctx.asrNbest.length > 0`。
- `extra.asr_kenlm_meta`：仅当含至少一个已知 KenLM 诊断字段（非空壳）。

---

## 4. KenLM meta 当前状态

| 项 | 状态 |
|----|------|
| Python `/utterance` utterance 级 KenLM | **未返回**（无 `kenlm` / `kenlm_meta` / `lm_meta`） |
| Python `nbest[]` 项内 `lm_score` | **有**（参与综合 `score`） |
| Node KenLM 映射 | **已预留**；有源字段才填充 |
| 伪造字段 | **无**（未生成 `kenlm_decision` / `kenlm_available` 等） |

线上实测时：`extra.asr_nbest` 在 CTC 服务 loaded 且返回 nbest 时应非空；`extra.asr_kenlm_meta` **通常为空**，直至 Python 可选补丁。

---

## 5. 测试结果

| 项 | 结果 |
|----|------|
| `asr-response-mapper.test.ts` | **PASS**（5 cases） |
| `result-builder.test.ts` | **PASS**（含 extra evidence 用例） |
| `npx tsc --noEmit -p tsconfig.main.json` | **PASS** |
| E2E smoke (`5020` + WAV) | **未执行**（本机 Test Server 未运行） |

### Smoke 手动命令（节点已启动且 ASR/NMT/TTS 就绪后）

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main
node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\test wav\dialog_01_cafe_order.wav"
```

检查响应 JSON 中 `extra.asr_nbest` 为数组；`extra.asr_kenlm_meta` 可缺失，且不应出现伪造的 `kenlm_decision`。

---

## 6. 行为约束核对

- [x] 无 n-best / 无 KenLM meta 时主链继续  
- [x] `text_asr` 仍用 top1 / `repairedText` 链  
- [x] n-best 不进 NMT、不替换 top1  
- [x] 无新服务依赖、无 Python 改动  
- [x] 不伪造 KenLM 字段  
