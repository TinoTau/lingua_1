# ASR 与语义修复：解码参数与 PASS 判定参考

**用途**：供决策部门审议 ASR 质量、语义修复触发与降级策略时参考。  
**日期**：2026-01。

---

## 一、Faster-Whisper 当前解码参数

### 1.1 参数来源与默认值

| 参数 | 默认值 | 环境变量 | 说明 |
|------|--------|----------|------|
| `beam_size` | 5 | `ASR_BEAM_SIZE` | Beam search 宽度 |
| `temperature` | 0.0 | `ASR_TEMPERATURE` | 采样温度（0 更确定，减少随机性） |
| `patience` | 1.0 | `ASR_PATIENCE` | Beam search 耐心值 |
| `compression_ratio_threshold` | 2.4 | `ASR_COMPRESSION_RATIO_THRESHOLD` | 压缩比阈值 |
| `log_prob_threshold` | -1.0 | `ASR_LOG_PROB_THRESHOLD` | 对数概率阈值 |
| `no_speech_threshold` | 0.6 | `ASR_NO_SPEECH_THRESHOLD` | 无语音判定阈值 |

**代码位置**：
- 默认值定义：`electron_node/services/faster_whisper_vad/config.py`（约 155–161 行）
- API 请求模型：`electron_node/services/faster_whisper_vad/api_models.py`（UtteranceRequest）
- 实际传入 `transcribe()`：`electron_node/services/faster_whisper_vad/asr_worker_process.py`（约 178–199 行）

### 1.2 与 VAD 相关的设置

- **Silero VAD（前置）**：在调用 Faster-Whisper 前已做语音段检测，相关配置在 `config.py`：
  - `VAD_SILENCE_THRESHOLD = 0.2`
  - `VAD_MIN_SILENCE_DURATION_MS = 300`
  - `VAD_MIN_UTTERANCE_MS = 1000`
  - 等（见 config 中 VAD_* 常量）
- **transcribe 内 VAD**：调用 `model.transcribe()` 时 **关闭** 内置 VAD，避免重复：
  - `vad_filter: False`（asr_worker_process.py 中写死，已用 Silero 处理）

### 1.3 其他固定或请求级参数

- `condition_on_previous_text: False`（避免上下文导致重复识别）
- `task`: 一般为 `"transcribe"`
- `language` / `initial_prompt`：由请求或上下文文本决定

---

## 二、语义修复 PASS 判定代码片段

### 2.1 服务端（Python）：PASS/REPAIR 的判定规则

**唯一判定逻辑**：以「输出是否与输入不同」决定 REPAIR 还是 PASS，**没有**基于置信度或质量分数改变 PASS/REPAIR。

```python
# 文件: electron_node/services/semantic_repair_en_zh/processors/zh_repair_processor.py
# 文件: electron_node/services/semantic_repair_en_zh/processors/en_repair_processor.py
# 决策逻辑（两处相同）
decision = "REPAIR" if result['text_out'] != text_in else "PASS"
```

- `quality_threshold`（默认 0.85）**不参与** PASS/REPAIR 决策，仅用于打 `reason_codes`（如 `LOW_QUALITY_SCORE`）。
- 引擎返回的 `confidence` 只影响响应字段，**不改变** decision。

### 2.2 服务端：置信度计算（仅影响 confidence 数值）

```python
# 文件: electron_node/services/semantic_repair_en_zh/engines/repair_engine.py
def _calculate_confidence(self, text_in, text_out, diff):
    if text_in == text_out:
        return 1.0
    if not diff:
        return 0.9
    # 按修改比例给 0.6--0.9，diff 条数>3 再乘 0.9
    change_ratio = total_changes / total_length
    if change_ratio < 0.1:   confidence = 0.9
    elif change_ratio < 0.2: confidence = 0.8
    elif change_ratio < 0.3: confidence = 0.7
    else:                   confidence = 0.6
    if len(diff) > 3:
        confidence *= 0.9
    return max(0.5, min(1.0, confidence))
```

此处仅用于 `confidence` 字段，**不参与** PASS/REPAIR 判定。

### 2.3 服务端：Fallback PASS（超时、错误、不支持语言）

**超时或处理异常时一律返回 PASS（原文），不阻塞主链路：**

```python
# 文件: electron_node/services/semantic_repair_en_zh/base/processor_wrapper.py
# 超时
except asyncio.TimeoutError:
    return RepairResponse(..., decision="PASS", text_out=request.text_in, confidence=0.5, reason_codes=["TIMEOUT"])
# 错误
except Exception as e:
    return RepairResponse(..., decision="PASS", text_out=request.text_in, confidence=0.5, reason_codes=["ERROR"])
```

```python
# 文件: electron_node/services/semantic_repair_en_zh/service.py
# 不支持的语言（非 zh/en）
else:
    return RepairResponse(..., decision="PASS", text_out=request.text_in, confidence=1.0, reason_codes=["UNSUPPORTED_LANGUAGE"])
```

### 2.4 节点端（TypeScript）：返回 PASS 的场景

以下均为「不调用或调用失败时直接返回 PASS，保证流程不阻塞」：

| 场景 | 位置 | reason_codes |
|------|------|--------------|
| 未找到语义修复服务端点 | `task-router-semantic-repair.ts` | `SERVICE_NOT_AVAILABLE` |
| 服务未就绪（非 WARMED） | 同上 | `SERVICE_NOT_${status}` |
| 并发获取许可超时（5s） | 同上 | `CONCURRENCY_TIMEOUT` |
| 调用语义修复服务异常/超时 | 同上 | `SERVICE_ERROR` |
| 空文本 | `semantic-repair-stage.ts` | `EMPTY_TEXT` |
| 不支持的语言（非 zh/en） | 同上 | `UNSUPPORTED_LANGUAGE` |
| 中文 stage 未就绪 | 同上 | `ZH_STAGE_NOT_AVAILABLE` |
| 中文 stage 调用抛错 | 同上 | `ZH_STAGE_ERROR` |

**示例（服务不可用 / 调用错误时返回 PASS）：**

```typescript
// 文件: electron_node/electron-node/main/src/task-router/task-router-semantic-repair.ts
if (!endpoint) {
  return { decision: 'PASS', text_out: task.text_in, confidence: 1.0, reason_codes: ['SERVICE_NOT_AVAILABLE'] };
}
// 健康检查未通过
if (!healthResult.isAvailable) {
  return { decision: 'PASS', text_out: task.text_in, confidence: 1.0, reason_codes: [`SERVICE_NOT_${healthResult.status}`] };
}
// 并发超时
catch (error) {
  return { decision: 'PASS', text_out: task.text_in, confidence: 1.0, reason_codes: ['CONCURRENCY_TIMEOUT'] };
}
// 调用服务异常
catch (error) {
  return { decision: 'PASS', text_out: task.text_in, confidence: 1.0, reason_codes: ['SERVICE_ERROR'] };
}
```

```typescript
// 文件: electron_node/electron-node/main/src/agent/postprocess/semantic-repair-stage.ts
// 空文本
if (!text || text.trim().length === 0) {
  return { textOut: text, decision: 'PASS', confidence: 1.0, reasonCodes: ['EMPTY_TEXT'], ... };
}
// 不支持语言
return { textOut: text, decision: 'PASS', confidence: 1.0, reasonCodes: ['UNSUPPORTED_LANGUAGE'], ... };
// ZH stage 不可用或抛错
return { textOut: text, decision: 'PASS', confidence: 1.0, reasonCodes: ['ZH_STAGE_NOT_AVAILABLE'] | ['ZH_STAGE_ERROR'], ... };
```

### 2.5 管道中对 PASS/REPAIR 的消费

```typescript
// 文件: electron_node/electron-node/main/src/pipeline/steps/semantic-repair-step.ts
if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
  ctx.repairedText = repairResult.textOut;
  ctx.semanticDecision = repairResult.decision;
  ctx.semanticRepairApplied = repairResult.decision === 'REPAIR';
  // ... 更新 lastCommittedText、打日志等
} else if (repairResult.decision === 'REJECT') {
  ctx.repairedText = textToRepair;  // 保留原文
  ctx.semanticDecision = 'REJECT';
}
```

管道只根据 `decision` 更新上下文，**不修改** PASS/REPAIR 的判定逻辑。

---

## 三、小结（供决策参考）

1. **ASR**：当前解码采用 `beam_size=5`、`temperature=0` 及表中各阈值；VAD 由 Silero 前置完成，transcribe 内 `vad_filter=False`。调参可通过环境变量覆盖。
2. **语义修复 PASS**：
   - **唯一业务判定**：`text_out != text_in` → REPAIR，否则 PASS；无基于置信度或质量分数的 PASS 阈值。
   - **quality_threshold** 仅影响 reason_codes，不改变 decision。
   - **所有 fallback**（超时、错误、服务不可用、空文本、不支持语言等）均返回 PASS，保证主链路不阻塞。
3. 若希望「低置信度或低质量分数时也强制走修复或降级」，需在现有逻辑上**新增**判定分支（例如在 processor 或节点端根据 `confidence`/`quality_score` 决定是否仍调用引擎或如何标记 reason_codes），当前代码中无此类阈值。
