# FW ASR 前切片与多段拼接设计一致性审计（只读）

> **日期：** 2026-06-02  
> **性质：** 只读审计；未修改代码、配置、测试脚本；未提交 Patch  
> **审计目标：** 验证“前切片 + 多段 ASR + 重新拼接”的实现是否符合原始伪流式设计意图

---

## 执行摘要

| 结论项 | 结果 |
|---|---|
| 切片机制本身是否符合设计 | **是（基本符合）** |
| 多段 ASR 是否被拼接 | **部分是**（`asrText` 会拼接） |
| 最终业务文本/NMT/FW 是否使用拼接结果 | **当前多数否**（主链基线偏向 `rawAsrText` 首段） |
| 问题性质 | **不是切片错误**；是**切片后文本字段语义与消费不一致** |
| 设计一致性判定 | **B. 部分符合设计** |

---

## 第一部分：Audio Slicing Design Intent Report

基于 `pipeline-orchestrator`、`pipeline`、`fw-detector` 模块注释与 README 的事实：

1. **AudioAggregator 为什么要切片**  
   - 为长音频伪流式处理：先聚合再按能量切分，再按约 5 秒批次送 ASR，降低首包延迟。

2. **设计目标是否是伪流式**  
   - 是。属于“ASR 前切片 + 批次化识别 + 下游统一处理”的伪流式路径。

3. **原始音频最大长度**  
   - `MAX_BUFFER_DURATION_MS = 20000`（20 秒）。

4. **切片目标长度**  
   - 能量切分参数：`max=5000ms`、`min=2000ms`、`hangover=600ms`。  
   - 批次累计阈值：`MIN_ACCUMULATED_DURATION_FOR_ASR_MS = 5000ms`。

5. **切片后是否仍属于同一 utterance/turn**  
   - 是。切片后的多个 `audioSegments` 在同一 `job` 的同一 `ctx` 中处理。

6. **多段 ASR 文本应在哪里拼接**  
   - 当前在 `asr-step.ts` 拼接到 `ctx.asrText`。  
   - turn 层面在 `aggregation-step.ts` 进行段落累计与 finalize 合并。

7. **拼接后文本应进入哪些后续模块（设计目标）**  
   - FW Detector / Recall / KenLM、Aggregation、NMT、Result Builder。  
   - 当前实现在该点存在偏差（见后续部分）。

---

## 第二部分：AudioAggregator Implementation Report

审计对象：`audio-aggregator.ts`、`audio-aggregator-process-finalize.ts`、`audio-aggregator-utils.ts`、`audio-aggregator-stream-batcher.ts`

1. **输入音频如何进入 AudioAggregator**  
   - `runAsrStep -> PipelineOrchestratorAudioProcessor.processAudio -> AudioAggregator.processAudioChunk`。

2. **manual_cut 与普通 streaming 是否同一逻辑**  
   - 同一 `processAudioChunk` 主路径；manual/timeout 会触发立即 finalize。

3. **何时执行 splitAudioByEnergy**  
   - 在 `executeFinalizeAndReturn` 里统一执行（manual、timeout、达到自动阈值、达到最大缓冲）。

4. **max batch duration**  
   - 5000ms（切分单段上限）。

5. **min batch duration**  
   - 2000ms（切分单段下限）。

6. **hangover / silence 参数**  
   - `SPLIT_HANGOVER_MS = 600`。  
   - 停顿检测窗口 100ms，最小停顿 200ms（`findLongestPauseAndSplit`）。

7. **是否会在句中停顿处切片**  
   - 会（按最长停顿切分）。

8. **切片后是否保留顺序**  
   - 保留。递归切分与后续批次处理均按前后顺序。

9. **是否保留每段 offset / timing**  
   - 保留 job offset 对应关系（`originalJobInfo` / `batchJobInfo`）。  
   - ASR 段时序通过 `asrSegments` 合并保留。

10. **是否存在尾段丢弃**  
   - `is_manual_cut` / `is_timeout_triggered` 下，剩余小段会并入最后 batch 发送，不丢弃。  
   - 非独立 finalize 场景可缓存小段等待后续合并（非丢弃）。

---

## 第三部分：ASR Multi-Segment Processing Report

审计对象：`main/src/pipeline/steps/asr-step.ts`

1. **audioSegments 循环逻辑**  
   - `for (i=0; i<audioSegments.length; i++)`，每段都调用 ASR。

2. **每段是否都调用 FW**  
   - 不是“每段独立跑 FW step”；而是 ASR 全段结束后进入一次 FW step。

3. **每段 result.text 写入位置**  
   - `i===0`：`ctx.asrText = text`。  
   - `i>0`：`ctx.asrText += ' ' + text`。

4. **`ctx.rawAsrText` 写入方式**  
   - 仅 `i===0 && rawAsrText===undefined` 时写入；后续不更新。

5. **`ctx.asrText` 写入方式**  
   - 会按段拼接，保留多段文本。

6. **`ctx.asrSegments` 合并方式**  
   - 首段赋值，后续段扩展数组合并。

7. **`ctx.segmentForJobResult` 赋值方式**  
   - FW 模式下初始化为 `(ctx.rawAsrText ?? '').trim()`。

8. **`i===0` 与 `i>0` 差异**  
   - `i===0` 写 raw/asrResult/quality/language 等基线；`i>0` 仅追加 asrText/asrSegments。

9. **rawAsrText 只写第一段原因（代码事实）**  
   - 现有冻结契约把 `rawAsrText` 定义为“首段 freeze 文本”。

10. **是否符合“多段拼接为完整 utterance”设计意图**  
   - **部分符合**：拼接存在于 `asrText`。  
   - **不完全符合**：业务基线/下游主消费未使用拼接结果。

---

## 第四部分：ASR Field Semantics Report

| 字段 | 设计语义（从命名与目标推断） | 当前实际语义 | 是否应含多段拼接 | 是否只应首段 | 是否被业务模块使用 |
|---|---|---|---|---|---|
| `rawAsrText` | 原始 ASR 文本 | 首段冻结文本 | 倾向应区分 full vs first-seg | 当前是 | 是（FW/Recall/KenLM） |
| `asrText` | ASR 主文本 | 多段拼接文本 | 是 | 否 | 否（诊断为主） |
| `segmentForJobResult` | 业务 SSOT | FW/聚合后业务文本 | 应是 | 当前常继承首段基线 | 是 |
| `text_asr` | 对外最终文本 | `segmentForJobResult` 映射 | 应是 | 间接受影响 | 是 |
| `raw_asr_text` | 原始观测字段 | `ctx.rawAsrText` 落盘 | 取决于定义 | 当前是首段 | 统计使用 |
| `asrSegments` | ASR 段元信息 | 多段合并 | 是 | 否 | FW 辅助使用 |
| `RollingTurn.rawAsrText` | turn 原始文本 | `rawAsrText ?? asrText` | 应完整 | 当前优先首段 | session 使用 |
| `RollingTurn.finalText` | turn 最终文本 | `segmentForJobResult ?? rawAsr` | 应完整 | 受上游语义影响 | session 使用 |

---

## 第五部分：Downstream ASR Text Consumer Report

1. **FW Detector**  
   - 输入：`ctx.rawAsrText`（`fw-detector-orchestrator.ts`）。

2. **Recall**  
   - FW Recall / span 选择基于 `rawText`（即 `rawAsrText`）。

3. **KenLM**  
   - FW 候选句评分基于 `rawText`（即 `rawAsrText`）。

4. **Aggregation**  
   - 输入：`ctx.segmentForJobResult`，不是 `asrText`。

5. **NMT**  
   - 输入：`getTextForTranslation(ctx)` -> `resolveBusinessAsrText(ctx)` -> `segmentForJobResult`。

6. **Result Builder**  
   - `text_asr` 来自 `resolveBusinessAsrText(ctx)`（即 `segmentForJobResult`）。

7. **Node Agent Result Sender**  
   - 发送 `finalResult.text_asr`。

8. **dialog_200 质量统计**  
   - CER raw：`extra.raw_asr_text`。  
   - CER final：`extra.text_asr` / `text_asr_preview`。

### 重点回答

- 是否存在 FW Detector 只收到第一段文本：**是（当前代码语义下）**。  
- 是否存在 NMT 只收到第一段文本：**是（当前代码语义下）**。  
- 是否存在 Result Builder 只输出第一段文本：**是（当前链路下可能）**。  
- 是否存在质量统计只统计第一段文本：**是（当前口径主要如此）**。

---

## 第六部分：Design Conformance Report

按照目标“切片为伪流式，切片后应拼接成完整 utterance/turn 并进入主链”评估：

## 结论：**B. 部分符合设计**

### 符合点

- 切片机制（能量切分 + 约 5 秒批次）符合伪流式目标。  
- 多段 ASR 循环本身正确执行。  
- `asrText` 确实有多段拼接行为。

### 不符合点（核心）

1. 不是切片错误。  
2. 不是 ASR 多段循环错误。  
3. **是文本字段写入语义问题**：`rawAsrText` 首段冻结。  
4. **是 `segmentForJobResult` 初始基线问题**：来源首段 raw。  
5. **是下游消费字段问题**：FW/NMT/ResultBuilder 未消费完整拼接文本。  
6. **是统计口径问题**：CER 主口径与完整拼接真值不一致。

---

## 第七部分：Minimal Correction Direction Report（不实现）

约束：不取消切片、不改整段 ASR、不破坏伪流式。

1. **字段语义最小分离**  
   - 明确“首段诊断字段”与“完整拼接字段”两种语义，避免复用冲突。

2. **业务 SSOT 对齐完整拼接**  
   - `segmentForJobResult` 初始/基线应对齐完整拼接文本语义。

3. **FW/Recall/KenLM 输入对齐完整拼接**  
   - 保证 detector 决策文本与业务文本语义一致。

4. **保留每段 diagnostics**  
   - 保留 `asrSegments` / per-segment 可观测，不影响切片收益。

5. **统计口径对齐**  
   - 保留 raw 诊断口径；质量报告应新增或切换到完整拼接主口径。

---

## 第八部分：Verification Plan（不执行）

1. 构造 8–10 秒音频（含中间停顿）。  
2. 强制切成 2 段。  
3. 保证 segment #1/#2 文本均非空。  
4. 验证 `asrText` 包含两段。  
5. 验证 `segmentForJobResult` 包含两段。  
6. 验证 `text_asr` 包含两段。  
7. 验证 NMT 输入包含两段。  
8. 验证 FW Detector 输入包含两段。  
9. 验证 `raw_asr_text` 语义与设计定义一致。  
10. 重跑 dialog_200，截断样本占比应下降。

---

## 最终必须回答（代码事实）

1. 当前切片功能本身是否符合设计？  
   - **是（基本符合）**。

2. 当前多段 ASR 文本是否被正确拼接？  
   - **`asrText` 是**；主链消费层面不完整。

3. 当前最终业务文本是否使用了拼接结果？  
   - **当前多数否**。

4. 当前 FW Detector 是否看到完整拼接文本？  
   - **否**。

5. 当前 NMT 是否看到完整拼接文本？  
   - **否**。

6. 当前质量统计是否看到完整拼接文本？  
   - **否（主口径）**。

7. 当前问题是否应该叫“切片错误”？  
   - **不应该**。

8. 还是应该叫“切片后文本拼接/字段语义错误”？  
   - **是**。

9. 是否需要取消切片？  
   - **不需要**。

10. 最小修复边界是什么？  
   - **不动切片机制，只修字段语义与下游消费对齐，确保完整拼接文本进入 FW/NMT/Result/统计主链。**

---

## 关键代码锚点

- `main/src/pipeline-orchestrator/audio-aggregator.ts`  
- `main/src/pipeline-orchestrator/audio-aggregator-process-finalize.ts`  
- `main/src/pipeline-orchestrator/audio-aggregator-utils.ts`  
- `main/src/pipeline-orchestrator/audio-aggregator-stream-batcher.ts`  
- `main/src/pipeline/steps/asr-step.ts`  
- `main/src/pipeline/steps/fw-detector-step.ts`  
- `main/src/fw-detector/fw-detector-orchestrator.ts`  
- `main/src/pipeline/steps/aggregation-step.ts`  
- `main/src/pipeline/post-asr-routing.ts`  
- `main/src/pipeline/result-builder-core.ts`  
- `main/src/pipeline/steps/translation-step.ts`  
- `tests/run-dialog200-timed-batch.mjs`  
- `tests/analyze-dialog200-quality-perf.mjs`
