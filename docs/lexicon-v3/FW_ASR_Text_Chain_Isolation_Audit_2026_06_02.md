# ASR 多段切片后文本链路审计（业务主链明确 + 错误链路隔离）

> **日期：** 2026-06-02  
> **性质：** 只读审计（未修改代码/配置/测试脚本，未提交 Patch）  
> **范围：** 仅文本字段语义与链路流向；不调整切片、FW 服务、Detector 算法、Lexicon/KenLM/NMT 能力实现

---

## 第一部分：Business ASR Text Chain Definition

### 1) 代码事实下的“目标业务主链”

目标链路定义（你给的版本）在项目内是成立的，且与伪流式设计并不冲突：

`Audio Segments -> per-segment ASR -> fullAsrText -> FW Detector -> Recall/KenLM/Rerank -> segmentForJobResult -> Aggregation -> NMT -> ResultBuilder.text_asr`

### 2) 当前实现与目标链路的关系

- 当前**分段识别**与**多段拼接动作**存在：`asr-step.ts` 把后续 segment 文本拼到 `ctx.asrText`。  
- 当前**业务主链基线**并未使用该拼接结果，而是沿用 `rawAsrText` 首段冻结语义进入 FW 与 `segmentForJobResult` 初始化。

### 3) 必答六问

1. **full ASR 文本应由哪个字段承载？**  
   - 应由“完整拼接 ASR 字段”承载；在现有字段中最接近的是 `ctx.asrText`（已拼接）。

2. **`segmentForJobResult` 应代表什么？**  
   - 应代表“业务 SSOT 文本”（FW 后、聚合后、供 NMT 与 `text_asr` 输出）。

3. **`rawAsrText` 应代表什么？**  
   - 从业务语义应代表“业务 raw baseline（完整）”；但当前代码事实是“首段冻结 raw”。

4. **`text_asr` 应代表什么？**  
   - 应代表最终对外 ASR 文本（完整业务文本）。

5. **NMT 应该消费哪个字段？**  
   - `segmentForJobResult`（当前实现也是如此）。

6. **FW Detector 应该消费哪个字段？**  
   - 应消费完整 raw baseline（而非首段诊断文本）。

---

## 第二部分：Diagnostic ASR Text Chain Definition

### 1) 哪些字段应属于诊断链路

- `firstSegmentRawAsrText`（建议新增）：首段诊断文本。  
- `raw_asr_text`（对外 extra 字段，当前语义混杂，需重定义或拆分）。  
- `asrSegments`：分段时序/词级概率诊断。  
- `perSegmentAsrResults`（若新增）：每段 ASR 返回诊断。  
- `audioSegments diagnostics`：切片数量、时长、offset。  
- `fw_detector` diagnostics：trigger/applied/span/candidate/kenlm 诊断。

### 2) 必答五问

1. **`rawAsrText` 是否应继续表示“完整 raw ASR”？**  
   - 从业务语义看应是；当前实现不是（首段冻结）。

2. **若 `rawAsrText` 已被历史语义污染，是否应新增 `firstSegmentRawAsrText`？**  
   - 是，能最低成本保留首段诊断价值并隔离误用。

3. **是否应新增 `fullRawAsrText`？**  
   - 若保守兼容历史可新增；若允许语义回正也可直接回正 `rawAsrText` 并新增首段字段。

4. **`raw_asr_text` 报告输出应代表完整 raw 还是首段 raw？**  
   - 业务主报表应代表完整 raw；首段应单独输出（例如 `first_segment_raw_asr_text`）。

5. **如何避免诊断字段被业务链误用？**  
   - 类型命名隔离 + 写点白名单 + 单测/静态门禁（见第六部分）。

---

## 第三部分：Wrong ASR Text Chain Report

审计文件（按你给定列表，路径以仓库实际为准）：

- `main/src/pipeline/steps/asr-step.ts`  
- `main/src/pipeline/steps/fw-detector-step.ts`  
- `main/src/fw-detector/fw-detector-orchestrator.ts`  
- `main/src/pipeline/steps/aggregation-step.ts`  
- `main/src/pipeline/post-asr-routing.ts`  
- `main/src/pipeline/result-builder-core.ts`  
- `main/src/pipeline/steps/translation-step.ts`  
- `main/src/agent/node-agent-result-sender.ts`（仓库实际路径）  
- `tests/analyze-dialog200-quality-perf.mjs`  
- `tests/run-dialog200-timed-batch.mjs`

### 1) 哪些地方读取 `rawAsrText`

- `fw-detector-step.ts`: `segmentForJobResult = (ctx.rawAsrText ?? '').trim()`  
- `fw-detector-orchestrator.ts`: `const rawText = (ctx.rawAsrText ?? '').trim()`  
- `result-builder-core.ts`: 输出 `extra.raw_asr_text`  
- `session-finalize.ts`: `rawAsrText ?? asrText` 用于 rolling turn

### 2) 哪些地方读取 `asrText`

- `asr-step.ts`: 作为拼接承载字段。  
- `session-finalize.ts`: 仅在 `rawAsrText` 缺失时 fallback。  
- 业务主链（FW/NMT/result builder）不读 `asrText`。

### 3) 哪些地方读取 `segmentForJobResult`

- `aggregation-step.ts` 当前段输入/turn 合并写回。  
- `post-asr-routing.ts`：`resolveBusinessAsrText` / `getTextForTranslation`。  
- `translation-step.ts`：NMT 输入来源。  
- `result-builder-core.ts`：`text_asr` 来源。

### 4) 哪些地方应改读完整拼接文本（方向）

- FW 入口基线（`asr-step` 初始化、`fw-detector-step` sync、`fw-detector-orchestrator` 输入）应改为“完整 raw baseline”。

### 5) 哪些地方应保留读取首段诊断文本

- 仅 diagnostics/extra 输出、审计脚本附加列、排障日志应读首段字段。

### 6) 关键“只输出第一段”赋值点

- `asr-step.ts`：`rawAsrText` 只在 `i===0` 写。  
- `asr-step.ts`（FW模式）：`segmentForJobResult = rawAsrText`。  
- `fw-detector-step.ts` 与 `fw-detector-orchestrator.ts` 继续以 raw 首段为输入。  
- downstream（NMT / `text_asr`）基于 `segmentForJobResult`，因此被首段污染。

---

## 第四部分：Field Semantics Options Report

### 方案 A

- **定义：** `rawAsrText` 回正为完整 raw；新增 `firstSegmentRawAsrText` 仅诊断。  
- **改动范围：** 中等（涉及字段写入和引用点）  
- **风险：** 中低  
- **兼容性：** 较好（可同时保留旧 extra 别名一段时间）  
- **测试成本：** 中等  
- **对 FW/NMT/ResultBuilder：** 正向，对齐完整链路语义

### 方案 B

- **定义：** 保留 `rawAsrText` 历史首段语义；新增 `fullRawAsrText` 作为业务基线。  
- **改动范围：** 中等偏大（新增字段并替换主链消费）  
- **风险：** 低（最保守）  
- **兼容性：** 最高  
- **测试成本：** 中等偏大  
- **对 FW/NMT/ResultBuilder：** 可对齐，但字段双轨期更长

### 方案 C

- **定义：** 不新增字段，直接把 `rawAsrText` 语义改成完整拼接。  
- **改动范围：** 小  
- **风险：** 中高（历史依赖与报表语义可能突变）  
- **兼容性：** 最差  
- **测试成本：** 低到中  
- **对 FW/NMT/ResultBuilder：** 能快速对齐

### 推荐方案（最小风险）

- **推荐：方案 A**  
  - 原因：业务语义最清晰、诊断隔离明确、兼容成本可控、比 B 更少双轨负担，比 C 风险更可控。

---

## 第五部分：Minimal ASR Text Chain Correction Plan（不执行）

### 1) 修改文件列表（最小范围）

- `main/src/pipeline/context/job-context.ts`  
- `main/src/pipeline/steps/asr-step.ts`  
- `main/src/pipeline/steps/fw-detector-step.ts`  
- `main/src/fw-detector/fw-detector-orchestrator.ts`  
- `main/src/pipeline/result-builder-core.ts`  
- `tests/*`（ASR/FW/translation/result builder/dialog200 分析脚本相关）

### 2) 字段定义（建议）

- `asrText`: 多段拼接文本（保持现状）。  
- `rawAsrText`: 完整 raw baseline（业务链使用）。  
- `firstSegmentRawAsrText`: 首段诊断文本（只诊断链使用）。  
- `segmentForJobResult`: 业务 SSOT（FW后/聚合后/NMT/`text_asr`）。

### 3) 赋值顺序（建议）

1. segment #1 返回后：写 `firstSegmentRawAsrText` 与 `asrText`。  
2. 后续 segment：继续拼接 `asrText`。  
3. ASR 结束：`rawAsrText = asrText.trim()`（完整 baseline）。  
4. FW 前基线与 `segmentForJobResult` 初始化来自完整 baseline。

### 4) 下游消费字段（建议）

- FW Detector / Recall / KenLM：读完整 baseline。  
- Aggregation / NMT / ResultBuilder：继续读 `segmentForJobResult`。  
- Diagnostics / 报表：同时输出 full 与 first-segment 字段。

### 5) 测试影响

- `asr-step` 多段行为测试需要补首段与完整字段断言。  
- FW freeze 契约测试要从“raw首段冻结”调整为“业务完整 + 首段诊断隔离”。  
- dialog200 分析脚本需新增 full/first 双口径。

### 6) 风险项

- 历史报表口径变化（CER 可能跳变）。  
- 依赖 `raw_asr_text` 老语义的外部脚本需适配。  
- 回归期需双字段并行输出避免误读。

---

## 第六部分：Wrong Chain Isolation Plan

### 1) 类型层命名约束

- 业务字段：`rawAsrText`（full）、`segmentForJobResult`、`text_asr`。  
- 诊断字段：`firstSegmentRawAsrText`、`asrSegments`、`fw_detector.*`。

### 2) result extra 输出区分

- `full_raw_asr_text`  
- `first_segment_raw_asr_text`  
- `text_asr`

### 3) 单元测试约束

- 多段时 `text_asr` 必含所有段。  
- `first_segment_raw_asr_text` 仅首段。  
- FW Detector 输入断言为 full raw。  
- NMT 输入断言为 `segmentForJobResult`。

### 4) lint/test guard（门禁）

- 禁止业务步骤直接读取 `firstSegmentRawAsrText`。  
- 禁止 `segmentForJobResult` 以首段字段初始化。  
- 保留写点白名单，新增“业务链不得回退到首段诊断字段”的静态检查。

---

## 第七部分：ASR Text Chain Acceptance Plan（不执行）

### 1) 单元测试

- 构造 2 个 `audioSegments`，ASR 返回 `"first"`、`"second"`。  
- 断言：  
  - `asrText = "first second"`  
  - business raw = `"first second"`  
  - `segmentForJobResult = "first second"`（FW前基线）  
  - `firstSegmentRawAsrText = "first"`

### 2) 集成测试

- 输入 8–10 秒、含停顿音频，强制 2 段。  
- 断言：  
  - `text_asr` 含两段  
  - NMT 输入含两段  
  - FW detector diagnostics 的输入长度匹配完整文本长度

### 3) dialog_200 回归

- 重跑 200 条。  
- 期望：  
  - 截断样本显著下降  
  - `node_audio_segment_count=2` 样本不再只输出第一段  
  - avg CER 下降（主口径）  
  - `fw_triggered` / `fw_applied` 需重算并重新解释

---

## 第八部分：最终结论（十问）

1. **当前业务主链应该使用哪个字段？**  
   - 完整拼接 raw baseline + `segmentForJobResult`（业务 SSOT）+ `text_asr`（对外）。

2. **当前错误链路在哪里？**  
   - `rawAsrText` 首段冻结被串入 FW 与 `segmentForJobResult`，进而污染 NMT/Result/统计。

3. **是否需要取消切片？**  
   - 不需要。

4. **是否需要修改 AudioAggregator？**  
   - 不需要（本问题核心不在切片算法）。

5. **是否需要修改 FW 服务？**  
   - 不需要（仅调整输入字段流向）。

6. **是否需要修改 Detector 算法？**  
   - 不需要（算法不变，输入文本语义修正）。

7. **是否需要新增 `firstSegmentRawAsrText` 或 `fullRawAsrText`？**  
   - 建议至少新增 `firstSegmentRawAsrText` 以隔离诊断；是否新增 `fullRawAsrText` 取决于方案选择。

8. **推荐哪种字段语义方案？**  
   - 推荐方案 A：`rawAsrText` 回正为完整、新增 `firstSegmentRawAsrText`。

9. **最小开发范围是什么？**  
   - 仅文本字段定义、赋值顺序、下游消费点与测试门禁；不动切片/算法/词库。

10. **修正后哪些历史质量审计需要重跑？**  
   - dialog_200 全量 CER/Trigger/Applied 报告；FW Detector 审计；截断专项审计；综合质量报告。

---

## 关键代码证据（本审计使用）

- `main/src/pipeline/steps/asr-step.ts`  
- `main/src/pipeline/steps/fw-detector-step.ts`  
- `main/src/fw-detector/fw-detector-orchestrator.ts`  
- `main/src/pipeline/steps/aggregation-step.ts`  
- `main/src/pipeline/post-asr-routing.ts`  
- `main/src/pipeline/result-builder-core.ts`  
- `main/src/pipeline/steps/translation-step.ts`  
- `main/src/agent/node-agent-result-sender.ts`  
- `tests/run-dialog200-timed-batch.mjs`  
- `tests/analyze-dialog200-quality-perf.mjs`  
- `main/src/pipeline-orchestrator/audio-aggregator*.ts`  
- `main/src/pipeline-orchestrator/audio-aggregator-utils.ts`  
- `main/src/pipeline-orchestrator/audio-aggregator-stream-batcher.ts`
