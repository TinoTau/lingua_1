# 音频聚合完整机制文档

**日期**: 2025-12-31  
**版本**: v1.0  
**状态**: 已实现并验证

---

## 一、概述

本文档全面描述音频聚合功能的完整机制，包括：
1. **调度服务器Finalize机制**：如何将音频块聚合成完整utterance
2. **节点端AudioAggregator机制**：如何将多个utterance聚合成完整句子
3. **ASR处理机制**：短句识别和文本过滤
4. **NMT提取机制**：三段式提取流程（哨兵序列、上下文对齐、兜底）
5. **Web端提示标识机制**：音频丢失标记和用户提示

---

## 二、调度服务器Finalize机制

### 2.1 音频块累积

**流程**：
```
Web端发送audio_chunk
  ↓
调度服务器audio_buffer.add_chunk()
  ↓
累积到当前utterance_index的缓冲区
  ↓
更新last_chunk_timestamp_ms
  ↓
启动/重置超时计时器（pause_ms）
```

**关键点**：
- 每个`audio_chunk`包含`is_final`标识（Web端静音检测）
- 调度服务器维护`last_chunk_at_ms`映射，用于pause检测
- 音频块按`utterance_index`分组累积

### 2.2 Finalize触发条件

**条件1：立即Finalize（IsFinal）**
- **触发**：收到`is_final=true`的audio_chunk
- **原因**：`"IsFinal"`
- **行为**：立即调用`try_finalize()`

**条件2：Pause检测Finalize（Pause）**
- **触发**：本次chunk与上次chunk的时间间隔 > `pause_ms`（默认2000ms）
- **原因**：`"Pause"`
- **行为**：先finalize上一个utterance，然后开始新的utterance

**条件3：超时Finalize（Timeout）**
- **触发**：`pause_ms`时间内没有收到新的audio_chunk
- **原因**：`"Timeout"`
- **行为**：自动finalize当前utterance（最后一句话的场景）

**条件4：异常保护Finalize（MaxLength）**
- **触发**：累积音频超过500KB
- **原因**：`"MaxLength"`
- **行为**：立即finalize，防止内存溢出

**条件5：最大时长限制（MaxDuration）**
- **触发**：累积音频时长超过`max_duration_ms`（默认20000ms）
- **原因**：`"MaxDuration"`
- **行为**：立即finalize，防止过长音频

### 2.3 Finalize执行流程

**步骤1：检查是否可以finalize**
```rust
if !self.internal_state.can_finalize(utterance_index) {
    // 已经finalize或正在finalize，跳过
    return Ok(false);
}
```

**步骤2：应用Hangover延迟（EDGE-1）**
- Manual类型：`hangover_manual_ms`（默认0ms）
- Auto类型：`hangover_auto_ms`（默认200ms）
- Exception类型：0ms（不延迟）

**步骤3：获取累积的音频数据**
```rust
let audio_data = self.state.audio_buffer
    .take_combined(&self.session_id, utterance_index)
    .await;
```

**步骤4：设置标识**
```rust
let is_manual_cut = reason == "IsFinal" || reason == "Send";
let is_pause_triggered = reason == "Pause";
let is_timeout_triggered = reason == "Timeout" || reason == "MaxDuration";
```

**步骤5：创建JobAssignMessage**
- 包含完整的utterance音频（已拼接）
- 包含标识：`is_manual_cut`、`is_pause_triggered`、`is_timeout_triggered`
- 发送给节点端

**步骤6：递增utterance_index**
- 完成finalize后，`current_utterance_index`递增
- 新的audio_chunk会使用新的utterance_index

### 2.4 超时计时器机制

**启动时机**：
- 每次收到audio_chunk后，如果不需要finalize，启动/重置计时器

**计时器逻辑**：
```rust
async fn reset_timers(&mut self) {
    // 取消旧计时器
    self.cancel_timers();
    
    // 更新generation（防止旧计时器触发）
    let generation = self.internal_state.increment_timer_generation();
    let timestamp_ms = self.internal_state.last_chunk_timestamp_ms;
    
    // 启动新计时器（pause_ms后触发）
    tokio::spawn(async move {
        sleep(Duration::from_millis(pause_ms)).await;
        
        // 检查时间戳是否仍然匹配（防止新chunk到达后误触发）
        if last_ts == timestamp_ms {
            // 发送TimeoutFired事件
        }
    });
}
```

**关键点**：
- 使用`generation`防止旧计时器误触发
- 使用`timestamp_ms`检查是否有新chunk到达
- 如果时间戳已更新，忽略本次超时

---

## 三、节点端AudioAggregator机制

### 3.1 设计目标

**目标**：将多个短句utterance聚合成完整的长句后再进行ASR识别

**原因**：
- 短句ASR识别准确率较低
- 聚合后可以提高识别准确率
- 减少NMT翻译次数，提高处理效率

### 3.2 处理流程

**输入**：
- `JobAssignMessage`：包含完整的utterance音频（已由调度服务器finalize）
- 标识：`is_manual_cut`、`is_pause_triggered`、`is_timeout_triggered`

**流程**：
```
接收JobAssignMessage
  ↓
解码音频（Opus base64 → PCM16 Buffer）
  ↓
添加到缓冲区（按sessionId分组）
  ↓
判断是否应该立即处理
  ↓
如果应该处理：
  - 聚合所有音频块
  - 返回聚合后的音频 → ASR识别
  - 清空缓冲区（保留pendingSecondHalf）
如果继续缓冲：
  - 等待更多utterance
```

### 3.3 立即处理条件

**条件1：手动截断（isManualCut）**
- **触发**：用户手动点击"发送"
- **行为**：立即处理，不等待更多utterance

**条件2：3秒静音（isPauseTriggered）**
- **触发**：调度服务器检测到pause（chunk间隔 > pause_ms）
- **行为**：立即处理，认为用户已经说完一句话

**条件3：超时Finalize（isTimeoutTriggered）**
- **触发**：调度服务器超时finalize（没有更多chunk）
- **行为**：立即处理（**修复：即使时长小于10秒也处理，确保最后一句话能返回**）
- **特殊处理**：如果是超时触发，会进行音频切割（找到最长停顿，分割成前半句和后半句）

**条件4：超过最大缓冲时长（20秒）**
- **触发**：`buffer.totalDurationMs >= 20000ms`
- **行为**：立即处理，防止缓冲区过大

**条件5：达到最短自动处理时长（10秒）且不是超时触发**
- **触发**：`buffer.totalDurationMs >= 10000ms && !isTimeoutTriggered`
- **行为**：立即处理，认为10秒的音频足够ASR识别

### 3.4 超时切割机制（isTimeoutTriggered）

**场景**：调度服务器20秒超时强制截断，但用户可能还在说话

**处理逻辑**：
```
1. 聚合所有音频块
2. 找到最长停顿（findLongestPauseAndSplit）
3. 在最长停顿处分割：
   - 前半句：立即进行ASR识别（使用当前utterance_id）
   - 后半句：保留在pendingSecondHalf，等待后续utterance合并
4. 应用Hangover：对前半句额外保留200ms音频（SPLIT_HANGOVER_MS）
5. 如果前半句仍然过长（>10秒），进行二级切割
```

**关键点**：
- 使用最长停顿作为分割依据（最可靠）
- 如果找不到停顿，使用能量最低区间作为fallback
- 如果fallback也失败，使用整个音频（不分割）

### 3.5 缓冲区管理

**数据结构**：
```typescript
interface AudioBuffer {
  audioChunks: Buffer[];  // 音频块列表
  totalDurationMs: number;  // 总时长
  startTimeMs: number;  // 开始时间
  lastChunkTimeMs: number;  // 最后chunk时间
  isManualCut: boolean;  // 手动截断标识
  isPauseTriggered: boolean;  // 3秒静音标识
  isTimeoutTriggered: boolean;  // 超时标识
  sessionId: string;
  utteranceIndex: number;
  pendingSecondHalf?: Buffer;  // 保留的后半句音频
  pendingSecondHalfCreatedAt?: number;  // 创建时间（用于TTL检查）
}
```

**清理策略**：
- 处理完成后，如果存在`pendingSecondHalf`，保留它；否则删除缓冲区
- `pendingSecondHalf`有TTL（12秒），过期后自动清理
- `pendingSecondHalf`最大时长限制（12秒），超过后丢弃

---

## 四、ASR处理机制

### 4.1 短句识别优化（S1/S2机制）

**S1：Prompt Biasing（提示词偏置）**
- **目的**：提高短句识别准确率
- **方法**：使用上一个utterance的文本作为prompt，引导模型识别
- **实现**：`initial_prompt`参数传递给Faster Whisper

**S2：Rescoring（重评分）**
- **目的**：对识别结果进行二次评分，选择最佳候选
- **方法**：生成多个候选，使用语言模型评分，选择最佳
- **实现**：SecondaryDecodeWorker + Rescorer

**当前状态**：
- S1已启用（默认）
- S2已禁用（GPU负载过高）

### 4.2 文本过滤机制

**过滤层级**：

1. **片段级过滤（Segment Level）**
   - 在ASR识别过程中，对每个音频片段进行过滤
   - 使用`is_meaningless_transcript()`检查
   - 无意义片段直接跳过，不参与拼接

2. **结果级过滤（Result Level）**
   - 对最终拼接的完整文本进行过滤
   - 使用`filter_asr_text()`进行更严格的过滤
   - 包括括号内容提取和智能过滤

**过滤规则**（从配置文件`config/asr_filters.json`加载）：
- **括号过滤**：所有包含括号的文本
- **精确匹配**：配置的精确匹配模式
- **部分匹配**：配置的部分匹配模式
- **空文本过滤**：空字符串和空白文本
- **叠词过滤**：无意义的重复词（如"谢谢谢谢"）

**空结果处理**：
- 如果ASR识别结果为空或全部被过滤：
  - 跳过NMT处理
  - 跳过TTS处理
  - 直接返回空结果给调度服务器

---

## 五、NMT提取机制

### 5.1 输入拼接

**有context_text的情况**：
```
input_text = context_text + SEPARATOR + text
```
例如：`"上一句 ^^ 当前句"`

**无context_text的情况（Job0）**：
```
input_text = text
```
直接翻译，不需要提取

### 5.2 三段式提取流程

#### 阶段1：哨兵序列提取（SENTINEL）

**方法**：在完整翻译中查找分隔符

**分隔符配置**（从`nmt_config.json`读取）：
- 默认分隔符：` ^^ `（带空格）
- 分隔符变体：`[" ^^ ", "^^", " ^^", "^^ "]`

**提取逻辑**：
```python
for sep_variant in SEPARATOR_TRANSLATIONS:
    pos = out.find(sep_variant)
    if pos != -1:
        separator_pos = pos + len(sep_variant)
        final_output = out[separator_pos:].strip()
        # 清理分隔符残留
        for sep_variant in SEPARATOR_TRANSLATIONS:
            if final_output.startswith(sep_variant):
                final_output = final_output[len(sep_variant):].strip()
        extraction_mode = "SENTINEL"
        extraction_confidence = "HIGH"
        break
```

**优势**：
- 最准确的方法
- 开销最小（只需字符串查找）
- 置信度最高

#### 阶段2：上下文翻译对齐切割（ALIGN_FALLBACK）

**触发条件**：找不到分隔符

**方法**：
1. 单独翻译`context_text`，得到`context_translation`
2. 在完整翻译中查找`context_translation`的位置
3. 提取`context_translation`之后的部分作为当前句翻译

**查找策略**（按优先级）：
- **方法1：前缀匹配**：如果完整翻译以`context_translation`开头
- **方法2：子串匹配**：在完整翻译的前80%中查找`context_translation`
- **方法3：上下文尾部匹配**：查找`context_translation`的最后30个字符
- **方法4：保守估算**：使用`context_translation`长度的105%作为切割点

**范围限制**：
- 搜索范围限制在前80%，避免在中间找到错误位置
- 防止提取错误的文本

**提取模式**：
- `extraction_mode = "ALIGN_FALLBACK"`
- `extraction_confidence = "HIGH" | "MEDIUM" | "LOW"`（根据匹配方法）

**开销**：
- 需要额外一次NMT推理（翻译context_text）
- 这是fallback机制，只在分隔符丢失时触发

#### 阶段3：最终不为空兜底（SINGLE_ONLY / FULL_ONLY）

**触发条件**：阶段2提取结果为空

**方法1：单独翻译当前文本（SINGLE_ONLY）**
```python
# 尝试单独翻译当前文本（不使用context）
single_translation = translate(req.text, without_context=True)
if single_translation:
    final_output = single_translation
    extraction_mode = "SINGLE_ONLY"
    extraction_confidence = "MEDIUM"
```

**方法2：使用完整翻译（FULL_ONLY）**
```python
# 如果单独翻译也失败，使用完整翻译（虽然包含context，但至少保证有结果）
final_output = out  # 完整翻译
extraction_mode = "FULL_ONLY"
extraction_confidence = "LOW"
```

**关键点**：
- 确保最终结果不为空
- 即使提取失败，也要返回结果（避免音频丢失）

### 5.3 文本清理

**清理分隔符残留**：
- 移除提取文本开头的分隔符变体
- 移除提取文本中间的分隔符（不应该有，但以防万一）

**过滤规则**：
- **标点符号过滤**：如果提取结果只包含标点符号，返回空字符串
- **引号过滤**：如果提取结果只包含引号，返回空字符串
- **短句检查**：如果提取结果长度小于原文的50%，可能被截断，记录警告

### 5.4 空context处理（Job0场景）

**优化**：
- 如果`context_text`为空或空字符串，直接使用当前文本翻译
- 不需要拼接，不需要提取
- 直接使用完整翻译作为结果

**代码逻辑**：
```python
if req.context_text and req.context_text.strip():
    # 有context，拼接后翻译并提取
    input_text = f"{req.context_text}{SEPARATOR}{req.text}"
    # ... 提取逻辑 ...
else:
    # 无context（Job0），直接翻译
    input_text = req.text
    final_output = out  # 直接使用完整翻译
```

---

## 六、Web端提示标识机制

### 6.1 音频丢失标记

**触发条件**：
- 调度服务器检测到：有文本（ASR或NMT）但TTS音频为空

**标记方式**：
```rust
if has_text && tts_empty {
    // 在文本前添加[音频丢失]标记
    *text_asr = format!("[音频丢失] {}", text_asr);
    *text_translated = format!("[音频丢失] {}", text_translated);
}
```

**显示效果**：
- 原文显示：`[音频丢失] 这是原文`
- 译文显示：`[音频丢失] This is translation`

### 6.2 音频缓冲区管理

**最大缓冲时长**：25秒

**内存限制**：
- 软限制：20秒（80%的25秒）
- 硬限制：25秒

**处理策略**：

1. **单个音频块超过25秒**：
   - 允许添加并触发自动播放
   - 不丢弃，确保长音频能够播放

2. **总缓冲时长超过软限制（20秒）但新块不超过25秒**：
   - 如果正在播放，不丢弃
   - 如果未播放，丢弃最旧的音频块

3. **内存压力过高**：
   - 自动开始播放以释放内存
   - 清理部分缓存

**自动播放触发**：
- 如果单个音频块超过25秒，自动触发播放
- 如果内存压力过高，自动触发播放

### 6.3 MissingResult处理

**触发条件**：
- 调度服务器检测到：ASR、NMT、TTS都为空
- 原因：`silence_detected`（静音检测）

**处理逻辑**：
```typescript
if (missingResult.reason === 'silence_detected') {
    // 检查是否有缓存的文本（可能是之前的partial结果）
    const cachedText = getCachedText(utterance_index);
    if (cachedText) {
        // 显示缓存的文本
        displayTranslationResult(cachedText);
    } else {
        // 没有缓存，显示MissingResult
        displayMissingResult(utterance_index, reason);
    }
}
```

---

## 七、Job去重机制

### 7.1 调度服务器去重

**机制**：基于`job_id`的去重

**实现**：
```rust
// 记录收到的job_result（保留30秒）
job_result_deduplicator.record_job_result(job_id, session_id);

// 检查是否重复
if job_result_deduplicator.is_duplicate(job_id, session_id) {
    // 30秒内收到相同job_id的结果，过滤掉
    return;
}
```

**关键点**：
- 只基于`job_id`，不基于文本内容
- TTL：30秒（与job超时时间一致）
- 定期清理过期记录（每30秒）

### 7.2 节点端去重

**机制**：基于`job_id`的去重（DedupStage）

**实现**：
```typescript
// 检查该job_id是否在30秒内已发送过
const sessionJobIds = this.lastSentJobIds.get(job.session_id) || new Set<string>();
if (sessionJobIds.has(job.job_id)) {
    return { shouldSend: false, reason: 'duplicate_job_id' };
}

// 记录job_id（30秒TTL）
sessionJobIds.add(job.job_id);
this.lastSentJobIds.set(job.session_id, sessionJobIds);
```

**关键点**：
- 统一使用`job_id`进行去重，不基于文本内容
- TTL：30秒（与调度服务器保持一致）
- 定期清理过期记录（每5分钟）

---

## 八、关键修复点

### 8.1 最后一句话自动返回（2025-12-31）

**问题**：最后一句话不会自动返回结果，需要再说一句才会把之前的一句顶出来

**原因**：
- 节点端AudioAggregator的`shouldProcessNow`判断中，如果音频时长小于10秒且没有触发标识，不会自动处理
- 调度服务器通过超时机制finalize最后一句话时，会设置`is_timeout_triggered = true`
- 但之前的逻辑中，`isTimeoutTriggered`只在特殊处理分支中使用，没有在`shouldProcessNow`中作为立即处理的条件

**修复**：
```typescript
const shouldProcessNow = 
  isManualCut ||  // 手动截断：立即处理
  isPauseTriggered ||  // 3秒静音：立即处理
  isTimeoutTriggered ||  // 修复：超时finalize，立即处理（即使时长小于10秒）
  buffer.totalDurationMs >= this.MAX_BUFFER_DURATION_MS ||  // 超过最大缓冲时长（20秒）：立即处理
  (buffer.totalDurationMs >= this.MIN_AUTO_PROCESS_DURATION_MS && !isTimeoutTriggered);  // 达到最短自动处理时长（10秒）且不是超时触发：立即处理
```

### 8.2 NMT重叠检测移除（2025-12-31）

**问题**：NMT提取时可能包含context翻译的部分内容，导致重复输出

**原因**：
- 上下文对齐切割（ALIGN_FALLBACK）可能提取错误的文本
- 重叠检测逻辑复杂，开销较大

**修复**：
- 移除重叠检测逻辑
- 依赖分隔符的回退机制来处理重复问题
- 如果分隔符丢失，ALIGN_FALLBACK会通过上下文对齐来提取，这已经足够准确

### 8.3 空context处理优化（2025-12-31）

**问题**：Job0（无context）的处理逻辑不够清晰

**修复**：
- 如果`context_text`为空或空字符串，直接使用当前文本翻译
- 不需要拼接，不需要提取
- 直接使用完整翻译作为结果

### 8.4 音频丢失标记（2025-12-31）

**问题**：用户无法知道为什么没有音频

**修复**：
- 调度服务器检测到有文本但无音频时，在文本前添加`[音频丢失]`标记
- Web端显示时，用户可以看到明确的提示

---

## 九、配置参数

### 9.1 调度服务器配置

**路径**：`central_server/scheduler/config.toml`

**关键参数**：
```toml
[scheduler.phase2]
pause_ms = 2000  # Pause检测阈值（毫秒）
max_duration_ms = 20000  # 最大音频时长限制（毫秒）
job_timeout_seconds = 30  # Job超时时间（秒）
```

### 9.2 节点端AudioAggregator配置

**代码中定义**：
```typescript
MAX_BUFFER_DURATION_MS = 20000  // 最大缓冲时长：20秒
MIN_AUTO_PROCESS_DURATION_MS = 10000  // 最短自动处理时长：10秒
PENDING_SECOND_HALF_TTL_MS = 12000  // pendingSecondHalf TTL：12秒
SPLIT_HANGOVER_MS = 200  // 分割点Hangover：200ms
```

### 9.3 NMT服务配置

**路径**：`electron_node/services/nmt_m2m100/nmt_config.json`

**关键参数**：
```json
{
  "separator": {
    "default": " ^^ ",
    "translations": [" ^^ ", "^^", " ^^", "^^ "]
  }
}
```

### 9.4 Web端配置

**代码中定义**：
```typescript
MAX_BUFFER_DURATION = 25  // 最大缓冲时长：25秒
MEMORY_LIMIT_PERCENT = 80  // 内存限制百分比：80%
```

---

## 十、测试建议

### 10.1 最后一句话自动返回测试

**测试场景**：
1. 用户说完最后一句话后停止说话
2. 等待调度服务器超时finalize（pause_ms后）
3. 验证最后一句话是否自动返回结果

**预期结果**：
- 最后一句话应该自动返回，不需要再说一句

### 10.2 超时切割测试

**测试场景**：
1. 用户连续说话超过20秒
2. 调度服务器触发MaxDuration finalize
3. 节点端进行超时切割
4. 验证前半句是否正确识别，后半句是否正确保留

**预期结果**：
- 前半句立即进行ASR识别
- 后半句保留在pendingSecondHalf，等待后续utterance合并

### 10.3 NMT提取测试

**测试场景**：
1. 正常情况：分隔符存在
2. 分隔符丢失：使用ALIGN_FALLBACK
3. 提取失败：使用SINGLE_ONLY或FULL_ONLY

**预期结果**：
- 所有情况都应该返回非空结果
- 提取模式应该正确记录

### 10.4 音频丢失标记测试

**测试场景**：
1. TTS生成失败（返回空音频）
2. 验证文本是否添加`[音频丢失]`标记

**预期结果**：
- 文本应该显示`[音频丢失]`标记
- 用户应该能够看到明确的提示

---

## 十一、已知问题和限制

### 11.1 分隔符丢失问题

**问题**：NMT模型可能忽略或改变分隔符，导致提取失败

**影响**：
- 需要使用ALIGN_FALLBACK方法（增加一次NMT推理）
- 可能提取错误的文本

**缓解措施**：
- 使用三段式提取流程，确保最终结果不为空
- 记录提取模式和置信度，便于监控

**长期方案**：
- 改进分隔符设计（参考`nmt_sentinel_sequence_design.md`）
- 使用更robust的哨兵序列

### 11.2 最后一句话处理

**问题**：如果最后一句话时长小于10秒，需要依赖调度服务器的超时finalize

**影响**：
- 如果调度服务器超时机制失效，最后一句话可能不会返回

**缓解措施**：
- 已修复：`isTimeoutTriggered`现在会立即处理，即使时长小于10秒

### 11.3 音频缓冲区管理

**问题**：长音频可能导致内存压力

**影响**：
- 可能触发自动播放
- 可能丢弃部分音频

**缓解措施**：
- 单个音频块超过25秒时，允许添加并触发自动播放
- 内存压力过高时，自动清理缓存

---

## 十二、相关文档

- **NMT分隔符提取问题**：`NMT_SEPARATOR_EXTRACTION_ISSUE.md`
- **NMT哨兵序列设计**：`nmt_sentinel_sequence_design.md`
- **超时音频切割机制**：`TIMEOUT_AUDIO_SPLITTING_MECHANISM.md`
- **Job去重实现**：`JOB_RESULT_DEDUPLICATION_IMPLEMENTATION.md`
- **Job超时修复**：`JOB_TIMEOUT_FIX.md`

---

## 十三、更新历史

- **2025-12-31**：创建文档，整理所有机制
- **2025-12-31**：修复最后一句话自动返回问题
- **2025-12-31**：移除NMT重叠检测逻辑
- **2025-12-31**：优化空context处理（Job0场景）
- **2025-12-31**：添加音频丢失标记机制

