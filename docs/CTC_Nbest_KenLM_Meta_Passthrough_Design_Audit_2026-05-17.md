# CTC n-best + KenLM Meta 透传设计审计报告

**审计日期**：2026-05-17  
**仓库根路径**：`D:\Programs\github\lingua_1`  
**性质**：只读代码审计 + 最小实现方案设计（未改业务代码）  
**目标**：将 ASR HTTP 返回的 n-best 与 KenLM 诊断信息，从 ASR response **透传**到 Node JobPipeline 的 `JobResult.extra`，**仅 evidence，不改写文本**。

**目标链路**：

```text
ASR HTTP response
→ ASR provider / strategy mapper
→ ASRResult
→ JobContext
→ JobResult.extra
→ integration report JSON
```

**本轮禁止实现**：词库、拼音候选、window phonetic、safe writeback、selector、n-best 参与改写/NMT、语义修复。n-best **只用于观测**。

---

## 0. 执行摘要

| 项 | 结论 |
|----|------|
| Python ASR 是否返回 n-best | **是**（`nbest[]`，项内含 `text` / `score` / `logit_score` / `lm_score`） |
| Python 是否返回 utterance 级 KenLM meta | **否**（KenLM 仅参与 `ctc_decode` 打分，HTTP 无 `kenlm` / `kenlm_meta`） |
| Node 是否在 mapper 丢弃 n-best | **是**（`ctc-asr-strategy.ts` 未读 `data.nbest`） |
| `ASRResult` / `JobContext` / `extra` 是否有 evidence 字段 | **否** |
| 是否可进入 Node 最小实现 | **可以**（不改主链控制流） |
| KenLM meta 完整透传 | **需分阶段**：Node 预留映射；utterance 级字段需 **可选** Python 小补丁 |

---

## 1. 当前 ASR HTTP response schema（实际字段名）

### 1.1 端点

| 服务 | 方法 | 路径 |
|------|------|------|
| `asr-sherpa-lm` / `asr-sherpa-en` | `POST` | `/utterance` |
| 健康检查 | `GET` | `/health` → `{ status, model_loaded }` |

契约定义：`electron_node/services/asr_sherpa_lm/api_models.py`（`asr_sherpa_en` 同构）。

### 1.2 `UtteranceResponse`（HTTP JSON 顶层）

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | top1 最终文本（与排序后 `nbest[0].text` 一致） |
| `segments` | `SegmentInfo[]` | `{ text, start?, end?, no_speech_prob? }` |
| `language` | `string \| null` | 常为 `null` |
| `language_probability` | `number \| null` | 常为 `null` |
| `language_probabilities` | `object \| null` | 常为 `null` |
| `duration` | `number` | 音频秒数 |
| `vad_segments` | `[int,int][]` | 常为 `[]` |
| `meta` | `object \| null` | **仅** `decode_ms`（毫秒） |
| `nbest` | `object[]` | 见 §1.3 |

**不存在**（服务代码内无产出）：`full_text`、`transcript`、`hypotheses`、`beams`（顶层）、`kenlm`、`kenlm_meta`、`lm_meta`、`kenlm_decision`、`kenlm_available`、`acoustic_score`、`total_score`（顶层）。

### 1.3 `nbest[]` 每项（`ctc_decode.py` 实际产出）

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | 规范化后文本 |
| `score` | `number` | `LM_ALPHA * logit_score + LM_BETA * lm_score` |
| `logit_score` | `number` | CTC logit（pyctcdecode beam[3]） |
| `lm_score` | `number` | KenLM 分（beam[4]）；无 KenLM 时常为 `0.0` |

**不存在**：`rank`、`acoustic_score`、`kenlm_decision`、`total_score`（项内字段名）。

### 1.4 KenLM 与 HTTP 的关系

- KenLM 在 `build_decoder(kenlm_path=...)` + `decode_beams` 中参与 beam 解码与 n-best 重排。
- `service_main.py` 仅返回 `meta={"decode_ms": ...}` 与 `nbest=nbest_list`，**无** utterance 级 KenLM 诊断对象。

### 1.5 Faster-Whisper 路径（对照）

`faster-whisper-vad` 经 `faster-whisper-asr-strategy.ts`，响应以 `text` / `segments` / `language*` 为主，**无** `nbest` 要求。本方案 CTC 映射 nbest；FW 缺字段时 `nbest`/`kenlmMeta` 为 `undefined`，主链继续。

### 1.6 Python 契约测试（已存在）

`electron_node/services/asr_sherpa_lm/test_api.py` 断言响应含 `nbest` 列表；**未**断言项内 `logit_score` / `lm_score` 或 KenLM meta。

---

## 2. 当前 Node ASR mapper 链路

```text
runAsrStep (pipeline/steps/asr-step.ts)
  → taskRouter.routeASRTask (task-router/task-router-asr.ts)
    → executeCTCASR (task-router/ctc-asr-strategy.ts)      # asr-sherpa-lm / asr-sherpa-en
    → executeFasterWhisperASR (task-router/faster-whisper-asr-strategy.ts)
  → postASRUtteranceRequest (task-router/task-router-asr-http.ts)
  → response.data → ASRResult（内联构造）
  → ctx.asrResult / ctx.asrText (asr-step.ts)
  → Aggregation → … → Translation → TTS
  → buildJobResult (pipeline/result-builder.ts) → JobResult
```

### 2.1 `ASRResult` 类型（`task-router/types.ts`）

现有字段：`text`, `confidence?`, `language?`, `language_probability?`, `language_probabilities?`, `segments?`, `is_final?`, `badSegmentDetection?`。

**无** `nbest`、`kenlmMeta`。

### 2.2 HTTP → `ASRResult`（`ctc-asr-strategy.ts`）

仅赋值：`text`, `confidence`, `language*`, `segments`, `is_final`；可选 `text_zh` / `text_en`。

**未读取** `data.nbest`、`data.meta`（用于 evidence）。

### 2.3 `ASRResult` → `JobContext`（`asr-step.ts`）

写入：`ctx.asrText`, `ctx.asrResult`, `ctx.asrSegments`, `ctx.languageProbabilities`, `ctx.qualityScore`。

**无** `ctx.asrNbest` / `ctx.asrKenlmMeta`。

### 2.4 `JobContext` → `JobResult`（`result-builder.ts`）

`extra` 当前仅含：`language_probability`, `language_probabilities`, `detected_src_lang`, `audioBuffered`, `pendingEmptyJobs`, `lid`, `router`。

**无** `asr_nbest`、`asr_kenlm_meta`。

### 2.5 `main/src/asr/**` 与主链关系

| 模块 | 与 JobPipeline 关系 |
|------|---------------------|
| `candidate-provider.ts` | 未接入 pipeline；注释写明 FW 不支持 nbest |
| `rescorer.ts` | 验收/实验路径，非主链 |
| `asr-step.ts` | **主链唯一 ASR 入口** |

### 2.6 `text_asr` 实际来源（行为约束）

`buildJobResult` 使用 **`ctx.repairedText`**（聚合/语义修复后），非直接 `asrResult.text`。

本方案：**top1 仍走现有 `asrText` → 聚合 → `repairedText` → `text_asr`**；nbest **仅进 `extra`**，不进 NMT、不替换 top1。

---

## 3. 字段丢失点

| 阶段 | 保留 | 丢弃 |
|------|------|------|
| Python HTTP | `text`, `nbest[]`, `meta.decode_ms`, `segments`, `duration` | utterance 级 KenLM 诊断（未生成） |
| `executeCTCASR` | `text`, `language*`, `segments` | **`nbest` 全列表**；`meta` 未作 evidence |
| `asr-step` → `ctx` | `asrResult`（对象内无 nbest） | 无独立 evidence 字段 |
| `result-builder` | 语言/LID 等 | **`asr_nbest` / `asr_kenlm_meta`** |

---

## 4. 最小数据结构设计

### 4.1 类型（建议新文件 `task-router/asr-evidence-types.ts`）

```typescript
export type AsrNBestItem = {
  rank: number;
  text: string;
  score?: number;
  acousticScore?: number;
  lmScore?: number;
  totalScore?: number;
  kenlmDecision?: string;
  raw?: unknown;
};

export type AsrKenlmMeta = {
  kenlm_available?: boolean;
  kenlm_called_count?: number;
  kenlm_veto_count?: number;
  kenlm_vote_boost_count?: number;
  kenlm_decision?: string;
  lm_score_raw?: number;
  lm_score_candidate?: number;
  raw?: unknown;
};
```

### 4.2 `ASRResult` 扩展（`task-router/types.ts`）

```typescript
export interface ASRResult {
  text: string;
  // ... 现有字段 ...
  nbest?: AsrNBestItem[];
  kenlmMeta?: AsrKenlmMeta;
}
```

### 4.3 `JobContext` 扩展（`pipeline/context/job-context.ts`）

```typescript
asrNbest?: AsrNBestItem[];
asrKenlmMeta?: AsrKenlmMeta;
```

### 4.4 `JobResult.extra` 输出（`pipeline/result-builder.ts`）

```json
{
  "asr_nbest": [],
  "asr_kenlm_meta": {}
}
```

仅在数组/对象非空时写入，避免无意义空壳。

---

## 5. 最小 Patch Plan

### 5.1 应修改文件

| 文件 | 修改内容 |
|------|----------|
| `task-router/asr-evidence-types.ts` | **新建**类型 |
| `task-router/asr-response-mapper.ts` | **新建** `mapCtcUtteranceResponse(data)` 纯函数 |
| `task-router/types.ts` | `ASRResult` 增加 `nbest?`、`kenlmMeta?` |
| `task-router/ctc-asr-strategy.ts` | 调用 mapper 合并进 `ASRResult` |
| `pipeline/context/job-context.ts` | `asrNbest?`、`asrKenlmMeta?` |
| `pipeline/steps/asr-step.ts` | 首段 batch 写入 ctx evidence |
| `pipeline/result-builder.ts` | `extra.asr_nbest`、`extra.asr_kenlm_meta` |
| `task-router/asr-response-mapper.test.ts` | Mapper 单测 |
| `pipeline/result-builder.test.ts` | extra 落盘单测 |

### 5.2 映射规则（`mapCtcUtteranceResponse`）

**nbest 来源优先级**：`data.nbest` → `data.hypotheses` → `data.beams`。

| HTTP 字段 | `AsrNBestItem` |
|-----------|----------------|
| 数组下标 | `rank` |
| `text` | `text` |
| `score` | `totalScore`、`score` |
| `logit_score` | `acousticScore` |
| `lm_score` | `lmScore` |
| `kenlm_decision`（若存在） | `kenlmDecision` |
| 原对象 | `raw` |

**kenlmMeta 来源优先级**：`data.kenlm` → `data.kenlm_meta` → `data.lm_meta` → `data.meta?.kenlm`。

**当前 Python**：通常 **无** utterance 级对象 → `kenlmMeta` 为 `undefined`；可选保留 `raw: data.meta`（含 `decode_ms`），**不**将 `decode_ms` 映射为 `kenlm_decision`。

**行为约束**：

1. 无 n-best 时主链继续。  
2. 无 KenLM meta 时主链继续。  
3. `text_asr` 仍走 `repairedText` / top1 业务链。  
4. n-best 不进入 NMT、不替换 top1、不触发词库 recall。  
5. KenLM meta 只进 `extra`，不控制 selector。  
6. 不增加服务依赖。

### 5.3 不应修改

| 区域 | 原因 |
|------|------|
| `translation-step.ts` | 禁止 nbest 进 NMT |
| `aggregation-step.ts`、`semantic-repair-*` | 不改写逻辑 |
| `asr/candidate-provider.ts`、`rescorer.ts` | 避免第二套候选路径 |
| 增强步骤（phonetic/punctuation 等） | 本轮禁止 |
| Python `ctc_decode` 打分逻辑 | 本轮仅观测 |
| `faster-whisper-asr-strategy.ts` | 可选不改；无 nbest 则透传为空 |

### 5.4 Python 可选后续（非本轮必须）

在 `UtteranceResponse` 增加 `kenlm_meta`，例如：

```python
kenlm_meta = {
    "kenlm_available": bool(KENLM_PATH and os.path.isfile(KENLM_PATH)),
}
```

**不**在未实现计数逻辑时伪造 `kenlm_veto_count` 等字段。

---

## 6. 报告 JSON / 集成测试落盘

### 6.1 当前 `JobResult.extra` 落盘路径

- **主路径**：`buildJobResult` → `JobResult.extra` → `node-agent` / scheduler 上报 / `test-server` HTTP 响应。
- **不存在**：`extra_snapshot`、`latency_audit` 字段（全树无实现）；历史审计见 `docs/CTC_Lexicon_WindowPhonetic_KenLM_Readonly_Audit_2026-05-16.md` §8。

### 6.2 集成测试文件状态

| 路径 | 状态 |
|------|------|
| `electron_node/electron-node/tests/integration/jobpipeline-wav-batch.integration.test.ts` | **不存在** |
| `tests/integration/` 目录 | 未找到该测试 |

用户 smoke 命令依赖上述文件；**实施前需新建测试**，或改用：

```powershell
node tests/run-mock-asr-pipeline.js --wav "<path-to-wav>"
```

并扩展 test-server / 脚本输出 `result.extra.asr_nbest`。

### 6.3 建议 smoke 环境变量（恢复集成测试后）

```powershell
$env:RUN_JOBPIPELINE_WAV="1"
$env:JOBPIPELINE_WAV_MAX="1"
$env:JOBPIPELINE_DISABLE_PUNCTUATION="1"
$env:JOBPIPELINE_WAV_ROOT="D:\Programs\github\lingua_1\test wav"
$env:JOBPIPELINE_REPORT_BASENAME="p0_ctc_nbest_kenlm_design_smoke.json"
```

WAV 根目录须**存在**；可用 `test wav\dialog_01_cafe_order.wav` 等。

---

## 7. 测试计划

### 7.1 Mapper 单测（必须）

Fixture：

```json
{
  "text": "候选生成",
  "nbest": [
    { "text": "候选生成", "lm_score": -10.1 },
    { "text": "后选生城", "lm_score": -18.4 }
  ],
  "kenlm": {
    "kenlm_available": true,
    "kenlm_called_count": 4,
    "kenlm_decision": "pass"
  }
}
```

断言：

- `ASRResult.text === "候选生成"`
- `ASRResult.nbest.length === 2`
- `ASRResult.kenlmMeta.kenlm_available === true`

另：**仅 `text`、无 nbest** → `nbest`/`kenlmMeta` 为 `undefined`。

### 7.2 `result-builder` 单测

`ctx.asrNbest` / `ctx.asrKenlmMeta` → `extra.asr_nbest` / `extra.asr_kenlm_meta`。

### 7.3 JobPipeline smoke

验收：

- Job OK，`text_asr` 非空  
- `extra.asr_nbest` 存在（CTC 模型 loaded 时应有项；否则记录「Python 返回空 nbest」）  
- `extra.asr_kenlm_meta` 存在或文档说明为空原因  
- NMT/TTS 行为与改前一致  

---

## 8. 是否可以进入实现

| 结论 | 说明 |
|------|------|
| **可以实现（Node 侧）** | Python 已返回 `nbest`；在 mapper + ctx + `result-builder` 透传即可，**不新增业务路径**。 |
| **KenLM meta：分阶段** | utterance 级字段 **当前 Python 未返回**；Node 预留别名 + `raw`；完整 meta 需可选 Python 补丁。 |
| **集成测试** | 需 **新建** `jobpipeline-wav-batch.integration.test.ts` 或扩展 `run-mock-asr-pipeline.js`。 |
| **不需先修服务启动** | 与 venv 问题无关；ASR 返回 `nbest` 即可验证透传。 |

**推荐实施顺序**：

1. `asr-response-mapper` + 单测  
2. `ctc-asr-strategy` / `types` / `job-context` / `result-builder`  
3. 扩展 test-server 或 mock 脚本打印 `extra.asr_nbest`  
4. （可选）Python `kenlm_meta: { kenlm_available: bool }`  

**线上实测说明**：`extra.asr_nbest` 在 CTC 服务就绪时应非空；`extra.asr_kenlm_meta` 在 Python 未补字段前可能为空或仅含 `raw.meta.decode_ms`——报告须如实标注，**不得伪造** `kenlm_decision`。

---

## 9. 审计文件索引

| 路径 | 用途 |
|------|------|
| `electron_node/services/asr_sherpa_lm/api_models.py` | HTTP 契约 |
| `electron_node/services/asr_sherpa_lm/service_main.py` | 响应组装 |
| `electron_node/services/asr_sherpa_lm/ctc_decode.py` | nbest 项字段 |
| `electron_node/electron-node/main/src/task-router/ctc-asr-strategy.ts` | **丢弃点** |
| `electron_node/electron-node/main/src/task-router/types.ts` | `ASRResult` |
| `electron_node/electron-node/main/src/pipeline/steps/asr-step.ts` | ctx 赋值 |
| `electron_node/electron-node/main/src/pipeline/result-builder.ts` | `extra` 输出 |
| `electron_node/electron-node/main/src/pipeline/context/job-context.ts` | 上下文 |
| `docs/CTC_Lexicon_WindowPhonetic_KenLM_Readonly_Audit_2026-05-16.md` | 历史 broader 审计 |

---

*本报告为只读审计产物；实现时请遵循 `docs/CODING/vibe coding代码规范`：单一路径、无 fallback 链条、evidence 与改写分离。*
