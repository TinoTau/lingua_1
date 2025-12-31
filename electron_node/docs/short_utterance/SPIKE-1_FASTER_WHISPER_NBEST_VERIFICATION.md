# SPIKE-1: Faster-Whisper N-best 支持验证报告

## 验证日期
2025-01-XX

## 验证目标
验证 faster-whisper 库是否支持返回 N-best（多个候选转录结果），以便实现 S2-4（N-best 接入）。

---

## 验证方法

### 1. 代码审查

#### 1.1 当前实现分析

**文件**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`

**关键代码**（第 200 行）:
```python
segments, info = model.transcribe(audio, **transcribe_kwargs)
```

**transcribe 方法参数**（第 177-198 行）:
```python
transcribe_kwargs = {
    "language": task.get("language"),
    "task": task.get("task", "transcribe"),
    "beam_size": task.get("beam_size", 10),
    "vad_filter": False,
    "initial_prompt": initial_prompt,
    "condition_on_previous_text": condition_on_previous_text,
    "best_of": best_of,  # 可选
    "temperature": temperature,  # 可选
    "patience": patience,  # 可选
    # ... 其他参数
}
```

**返回值**:
- `segments`: 一个迭代器，包含多个 segment 对象（每个 segment 代表音频的一个片段）
- `info`: 包含语言检测等信息

**关键发现**:
- ✅ `beam_size` 参数存在（用于 beam search）
- ✅ `best_of` 参数存在（用于采样）
- ❌ **未发现返回多个完整候选的参数**（如 `num_return_sequences`、`alternatives`、`nbest` 等）

#### 1.2 返回值分析

**当前处理**（第 241-262 行）:
```python
segments_list = list(segments)
for seg in segments_list:
    if hasattr(seg, 'text'):
        text_parts.append(seg.text.strip())
    # ...
full_text = " ".join(text_parts)
```

**结论**:
- `segments` 是**时间序列的片段**，不是多个候选
- 最终只返回**一个完整的转录文本**（`full_text`）
- 没有多个候选的机制

### 2. 官方文档/API 验证

#### 2.1 Faster-Whisper 库 API

**库**: `faster-whisper` (Python)

**transcribe 方法签名**:
```python
def transcribe(
    audio: Union[str, np.ndarray, torch.Tensor],
    language: Optional[str] = None,
    task: str = "transcribe",
    beam_size: int = 5,
    best_of: int = 5,
    patience: float = 1.0,
    length_penalty: float = 1.0,
    temperature: Union[float, List[float], Tuple[float, ...]] = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
    compression_ratio_threshold: Optional[float] = 2.4,
    log_prob_threshold: Optional[float] = -1.0,
    no_speech_threshold: Optional[float] = 0.6,
    condition_on_previous_text: bool = True,
    initial_prompt: Optional[str] = None,
    word_timestamps: bool = False,
    prepend_punctuations: str = "\"'"¿([{-",
    append_punctuations: str = "\"'.。,，!！?？:：")]}、",
    vad_filter: bool = False,
    vad_parameters: Optional[Dict[str, Any]] = None,
) -> Tuple[Iterable[Segment], TranscriptionInfo]:
```

**关键发现**:
- ❌ **没有 `num_return_sequences` 参数**（类似 NMT 的候选生成）
- ❌ **没有 `alternatives` 参数**
- ❌ **没有 `nbest` 参数**
- ✅ 有 `beam_size` 和 `best_of`，但这些用于**单次解码的搜索策略**，不是返回多个候选

#### 2.2 返回值结构

**返回值类型**:
- `segments`: `Iterable[Segment]` - 单个转录结果的片段序列
- `info`: `TranscriptionInfo` - 转录信息（语言、概率等）

**Segment 对象**:
```python
class Segment:
    id: int
    seek: int
    start: float
    end: float
    text: str
    tokens: List[int]
    temperature: float
    avg_logprob: float
    compression_ratio: float
    no_speech_prob: float
```

**结论**:
- `segments` 是**单个转录结果的时间分段**，不是多个候选
- 每个 segment 代表音频的一个时间片段，所有 segment 组合成一个完整的转录结果

### 3. Web 搜索验证

**搜索结果**:
- Faster-whisper 主要专注于**提高推理速度和内存效率**
- **未发现官方文档提及 N-best 功能**
- 标准的 Whisper 模型也**未广泛支持 N-best**

---

## 验证结论

### ❌ **Faster-Whisper 不支持 N-best**

**证据**:
1. ✅ **代码审查**: transcribe 方法没有返回多个候选的参数
2. ✅ **API 分析**: 返回值是单个转录结果，不是多个候选
3. ✅ **文档验证**: 官方文档未提及 N-best 功能
4. ✅ **Web 搜索**: 未发现 N-best 支持的相关信息

### 技术原因

**Faster-Whisper 的设计**:
- 专注于**单次解码的最优结果**
- 使用 `beam_size` 和 `best_of` 在**解码过程中**探索多个路径
- 但**最终只返回一个最佳结果**，不保留其他候选

**与 NMT 的对比**:
- **NMT (M2M100)**: 支持 `num_return_sequences`，可以返回多个候选翻译
- **Faster-Whisper**: 不支持类似的机制

---

## 影响分析

### 对 S2 Rescoring 的影响

**当前状态**:
- ✅ S2 框架已实现（NeedRescoreDetector、Rescorer、CandidateProvider）
- ❌ **无法使用 N-best 路径**（S2-4 不可行）
- ⚠️ **必须使用二次解码路径**（S2-5 + S2-6）

### 实现路径调整

**原计划**:
```
优先级：N-best → 二次解码 → 不触发
```

**调整后**:
```
优先级：二次解码 → 不触发
（N-best 不可用）
```

---

## 建议方案

### 方案 A: 实现二次解码（推荐）

**实现内容**:
1. **S2-5: AudioRef + 音频 ring buffer**
   - 缓存 5-15 秒音频
   - TTL 10 秒
   - 按 {start_ms, end_ms} 索引

2. **S2-6: 二次解码 worker**
   - 双配置解码：
     - Primary: 速度优先（当前配置）
     - Secondary: 保守配置（更大 beam_size、更高 patience、更低 temperature）
   - 并发上限控制
   - 降级策略（超载时跳过）

**触发条件**:
- 仅在短句 + 低置信 + 高风险同时满足时触发

**优点**:
- ✅ 可以生成真正的候选（通过不同配置）
- ✅ 不依赖 N-best 支持
- ✅ 可以控制延迟（通过并发上限和降级）

**缺点**:
- ⚠️ 需要额外的 GPU 计算（二次解码）
- ⚠️ 需要实现音频缓存机制
- ⚠️ 延迟可能较高（需要两次解码）

### 方案 B: 使用 beam_size 探索（不推荐）

**思路**:
- 虽然 faster-whisper 不返回多个候选，但可以通过调整 `beam_size` 和 `best_of` 来影响解码结果
- 但这**不是真正的 N-best**，只是影响单次解码的搜索策略

**问题**:
- ❌ 无法获得多个候选进行 rescoring
- ❌ 无法实现 S2 的设计目标

---

## 下一步行动

### 立即优先级

1. **更新实现计划**
   - 标记 S2-4（N-best 接入）为**不可行**
   - 调整优先级：专注于 S2-5 + S2-6（二次解码）

2. **设计二次解码方案**
   - 确定音频缓存机制
   - 设计双配置策略
   - 设计并发控制和降级策略

3. **实现 S2-5: 音频 ring buffer**
   - 在 Node 端实现音频缓存
   - 实现 TTL 和索引机制

4. **实现 S2-6: 二次解码 worker**
   - 实现双配置解码
   - 实现并发控制
   - 实现降级策略

---

## 验证总结

| 项目 | 结果 |
|------|------|
| **Faster-Whisper 是否支持 N-best** | ❌ **不支持** |
| **是否有返回多个候选的参数** | ❌ **没有** |
| **是否可以通过其他方式获得候选** | ⚠️ **只能通过二次解码** |
| **S2-4 (N-best 接入) 是否可行** | ❌ **不可行** |
| **推荐实现路径** | ✅ **S2-5 + S2-6 (二次解码)** |

---

## 参考资料

1. **Faster-Whisper GitHub**: https://github.com/guillaumekln/faster-whisper
2. **当前实现代码**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`
3. **S2 实现计划**: `electron_node/docs/short_utterance/ASR_SHORT_UTT_S1_S2_IMPLEMENTATION_PLAN_WITH_FUTURE_DECOUPLING.md`

---

## 结论

**Faster-Whisper 不支持 N-best 功能**，因此 S2-4（N-best 接入）不可行。

**建议**：专注于实现 S2-5（音频 ring buffer）和 S2-6（二次解码 worker），通过二次解码生成候选进行 rescoring。

