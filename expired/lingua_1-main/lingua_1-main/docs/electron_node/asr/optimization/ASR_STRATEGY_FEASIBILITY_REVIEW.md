# ASR 准确率提升方案可行性评估

## 评估概述

本文档对《ASR_MULTILINGUAL_TURN_TAKING_ACCURACY_STRATEGY.md》和《ASR_ACCURACY_STRATEGY_SUPPLEMENTS_JIRA_CODE_ABTEST.md》两个改造方案进行可行性评估，结合当前代码实现，识别不合理点和优化建议。

---

## 1. 总体评估

### ✅ 方案整体可行
- 方案设计思路合理，符合多语言轮流交流场景需求
- 与当前系统架构兼容性良好
- 实施步骤清晰，优先级划分合理

### ⚠️ 需要注意的问题
- 部分功能与现有实现有重叠，需要明确边界
- 某些参数需要根据实际测试调整
- 性能影响需要量化评估

---

## 2. 边界稳态化（P0）评估

### 2.1 Hangover（延迟 finalize）

**方案要求**：
- 自动静音 finalize：120-180ms
- 手动截断 finalize：180-220ms

**当前实现**：
- Scheduler 有 `pause_ms` 机制（默认 3000ms）
- 支持 `is_final` 标记立即 finalize
- 有超时机制触发 finalize

**可行性**：✅ **可行，但需要调整**

**问题与建议**：

1. **与现有 pause_ms 的关系**
   - 当前 `pause_ms = 3000ms` 用于检测停顿
   - Hangover 是在 finalize **触发后**延迟执行，两者不冲突
   - **建议**：Hangover 应该在 `do_finalize` 之前应用，而不是在 pause 检测时

2. **实现位置**
   - **建议在 Scheduler 的 `do_finalize` 之前**：
     ```rust
     // 在 actor.rs 的 do_finalize 中
     async fn do_finalize(...) {
         // 1. 获取音频数据
         let audio_data = self.state.audio_buffer.take_combined(...).await;
         
         // 2. 应用 Hangover（延迟 finalize）
         let hangover_ms = if is_manual_finalize { 200 } else { 150 };
         // 等待 hangover_ms 后再继续（或异步处理）
         
         // 3. 创建 job
         ...
     }
     ```
   - **或者**：在 Web 端发送 `is_final` 时延迟发送（不推荐，增加客户端复杂度）

3. **手动截断识别**
   - 当前系统有 `is_final` 标记，可以区分手动截断
   - **建议**：在 `SessionEvent::IsFinalReceived` 中应用更长的 Hangover（200ms）

**优化建议**：
- ✅ Hangover 应该在 Scheduler 端实现（统一管理）
- ✅ 使用配置化参数，支持不同模式（线下/会议室）
- ⚠️ 注意 Hangover 会增加延迟，需要权衡用户体验

---

### 2.2 Padding（尾部补静音）

**方案要求**：
- finalize 后，在 PCM16 音频末尾补 200-300ms 的 0

**当前实现**：
- 音频在 Scheduler 累积为 `Vec<u8>`
- 节点端接收音频后直接转发给 ASR 服务

**可行性**：✅ **可行**

**问题与建议**：

1. **实现位置**
   - **建议在节点端**（`task-router.ts`）：
     ```typescript
     // 在 routeASRTask 中，发送给 ASR 服务之前
     if (audioFormat === 'pcm16') {
       const paddingMs = isManualFinalize ? 280 : 220;
       const paddingSamples = Math.floor((paddingMs / 1000) * sampleRate);
       const padding = new Uint8Array(paddingSamples * 2); // PCM16 = 2 bytes/sample
       audioBuffer = Buffer.concat([audioBuffer, padding]);
     }
     ```
   - **或者**：在 ASR 服务端（`faster_whisper_vad_service.py`）处理

2. **Opus 格式处理**
   - 当前 Web 端使用 Opus 编码发送音频
   - **问题**：Opus 帧不能直接拼接静音
   - **建议**：
     - 方案 A：在 Scheduler 解码 Opus → PCM16 → Padding → 重新编码（不推荐，性能差）
     - 方案 B：在节点端解码 Opus → PCM16 → Padding → 发送给 ASR（推荐）
     - 方案 C：在 ASR 服务端处理（需要传入 `is_manual_finalize` 标志）

3. **音频格式一致性**
   - 需要确保 Padding 后的音频格式与原始音频一致
   - **建议**：统一在节点端处理，确保格式一致

**优化建议**：
- ✅ 在节点端实现 Padding（统一处理点）
- ⚠️ 需要支持 Opus 解码（如果 Web 端使用 Opus）
- ✅ 使用配置化参数

---

### 2.3 Short-merge（短片段合并）

**方案要求**：
- <400ms 的片段先缓存，合并到下一段

**当前实现**：
- Scheduler 有 `AudioBufferManager` 管理音频累积
- 有 `utterance_index` 机制

**可行性**：✅ **可行，但需要新实现**

**问题与建议**：

1. **实现位置**
   - **建议在 Scheduler 的 `SessionActor` 中**：
     ```rust
     // 在 handle_audio_chunk 中
     async fn handle_audio_chunk(...) {
         // 1. 检查当前音频时长
         let audio_duration_ms = calculate_audio_duration(&chunk, audio_format);
         
         // 2. 如果 < 400ms，标记为 pending，不 finalize
         if audio_duration_ms < 400 && !is_final {
             self.internal_state.pending_short_audio = true;
             // 继续累积
             return;
         }
         
         // 3. 如果 >= 400ms 或 is_final，正常处理
         ...
     }
     ```

2. **与 pause_ms 的关系**
   - 当前 `pause_ms = 3000ms` 用于检测停顿
   - Short-merge 阈值 400ms < pause_ms，不冲突
   - **建议**：Short-merge 应该在 pause 检测之前判断

3. **边界情况**
   - 如果连续多个短片段（都 < 400ms），需要累积
   - **建议**：设置最大累积时长（如 2s），超过后强制 finalize

**优化建议**：
- ✅ 在 Scheduler 实现（统一管理）
- ✅ 需要跟踪音频时长（需要解析音频格式）
- ⚠️ 注意与 pause_ms 的交互逻辑

---

### 2.4 Lookback Overlap（可选）

**方案要求**：
- 下一段开头拼接上一段尾部 80-120ms 音频

**当前实现**：
- 有跨 utterance 去重机制

**可行性**：⚠️ **可行，但需要谨慎**

**问题与建议**：

1. **与去重的关系**
   - 方案文档提到"需配合文本去重模块使用"
   - 当前系统已有跨 utterance 去重（`faster_whisper_vad_service.py` Step 9.3）
   - **建议**：先确保去重机制稳定，再启用 Overlap

2. **实现复杂度**
   - 需要保存上一段的尾部音频
   - 需要处理音频格式（Opus/PCM16）
   - **建议**：作为 P1 功能，先实现其他 P0 功能

3. **性能影响**
   - 会增加音频处理时间
   - 可能增加重复识别风险
   - **建议**：通过 A/B 测试验证效果

**优化建议**：
- ⚠️ 作为可选功能，默认关闭
- ✅ 需要与去重模块联动测试
- ✅ 使用配置开关控制

---

## 3. 语言策略（P0）评估

### 3.1 每段独立语言识别

**方案要求**：
- 所有 utterance 默认：`language = None`
- 完全依赖 ASR 自动识别

**当前实现**：
- 节点端 `task-router.ts` 中 `src_lang` 可以设置为 `"auto"` 或具体语言
- ASR 服务支持 `language=None` 自动检测

**可行性**：✅ **完全可行**

**问题与建议**：

1. **当前实现检查**
   - 需要确认 `task.src_lang` 的处理逻辑
   - **建议**：如果 `src_lang == "auto"`，传递 `language=None` 给 ASR 服务

2. **与现有逻辑的兼容**
   - 当前代码中 `src_lang` 可能来自 Web 端配置
   - **建议**：在 Scheduler 或节点端统一处理，确保多语言场景下 `src_lang="auto"`

**优化建议**：
- ✅ 当前实现已支持，只需确保配置正确
- ✅ 在 Web 端支持 `src_lang="auto"` 选项

---

### 3.2 语言置信度分级

**方案要求**：
- 高置信（p ≥ 0.90）：直接采用
- 中置信（0.70 ≤ p < 0.90）：采用，但记录 top-2 候选
- 低置信（p < 0.70）：禁用上下文，允许触发补救

**当前实现**：
- ASR 服务已返回 `language_probability` 和 `language_probabilities`
- 节点端已传递这些字段

**可行性**：✅ **完全可行**

**问题与建议**：

1. **实现位置**
   - **建议在节点端**（`task-router.ts`）：
     ```typescript
     // 在 routeASRTask 中
     const langProb = asrResult.language_probability || 0;
     
     if (langProb < 0.70) {
       // 低置信：禁用上下文
       requestBody.condition_on_previous_text = false;
       requestBody.use_text_context = false;
     } else if (langProb >= 0.90) {
       // 高置信：可以启用上下文（可选）
       // 根据方案，默认关闭上下文
     }
     ```

2. **与现有逻辑的兼容**
   - 当前代码已设置 `condition_on_previous_text: false`
   - **建议**：根据 `language_probability` 动态调整

3. **Top-2 候选记录**
   - **建议在 Scheduler 的 `SessionState` 中**：
     ```rust
     struct SessionState {
         lang_window: Vec<LangInfo>, // 最近 6-10 段
     }
     struct LangInfo {
         lang: String,
         prob: f32,
         top2: Vec<String>,
     }
     ```

**优化建议**：
- ✅ 在节点端实现置信度分级逻辑
- ✅ 在 Scheduler 维护语言窗口（用于会议室模式路由）
- ✅ 使用配置化阈值

---

### 3.3 短期候选集

**方案要求**：
- 维护最近 6-10 段的 top-2 语言分布
- 用于坏段触发式重跑和会议室模式路由

**当前实现**：
- 无此功能

**可行性**：✅ **可行，需要新实现**

**问题与建议**：

1. **实现位置**
   - **建议在 Scheduler 的 `SessionActorInternalState` 中**：
     ```rust
     struct SessionActorInternalState {
         lang_window: VecDeque<LangWindowEntry>, // 最近 10 段
     }
     struct LangWindowEntry {
         utterance_index: u64,
         detected_lang: String,
         lang_prob: f32,
         top2_langs: Vec<String>,
     }
     ```

2. **使用场景**
   - 坏段触发式重跑（节点端）
   - 会议室模式路由（Scheduler）
   - **建议**：通过 `extra` 字段传递 top-2 信息

**优化建议**：
- ✅ 在 Scheduler 实现语言窗口
- ✅ 通过 `JobResult.extra` 传递到节点端（如果需要）
- ✅ 使用固定大小窗口（VecDeque）

---

## 4. 上下文提示策略（P0）评估

**方案要求**：
- 默认：`condition_on_previous_text = false`，`use_text_context = false`
- 仅在特定条件下启用

**当前实现**：
- 节点端已设置 `condition_on_previous_text: false`
- `use_text_context: true`（保留 initial_prompt）

**可行性**：✅ **部分可行，需要调整**

**问题与建议**：

1. **当前实现检查**
   - `use_text_context: true` 与方案要求不一致
   - **建议**：根据语言置信度动态调整：
     ```typescript
     // 默认关闭
     use_text_context: false
     
     // 仅在以下条件全部满足时启用：
     // 1. language_probability >= 0.90
     // 2. 最近多段语言一致
     // 3. prompt 文本长度 <= 100 字符
     if (langProb >= 0.90 && recentLangsConsistent && promptLen <= 100) {
       use_text_context = true;
     }
     ```

2. **与去重的关系**
   - 当前系统已有跨 utterance 去重
   - **建议**：默认关闭上下文，避免与去重逻辑冲突

**优化建议**：
- ✅ 默认关闭上下文（符合方案要求）
- ✅ 根据语言置信度和一致性动态启用
- ⚠️ 需要测试启用上下文后的效果

---

## 5. 触发式补救机制（P1）评估

### 5.1 坏段判定

**方案要求**：
- `language_probability < 0.70` 且文本过短
- 明显乱码或非法字符比例高
- 与上一段文本高度重叠
- segments 数异常或文本断裂

**当前实现**：
- 有跨 utterance 去重（检查重复）
- 无坏段判定逻辑

**可行性**：✅ **可行，需要新实现**

**问题与建议**：

1. **实现位置**
   - **建议在节点端**（`task-router.ts`）：
     ```typescript
     function isBadSegment(
       asrResult: ASRResult,
       audioDurationMs: number,
       previousText?: string
     ): boolean {
       // 1. 低置信 + 短文本
       if (asrResult.language_probability < 0.70 && 
           audioDurationMs >= 1500 && 
           asrResult.text.trim().length < 5) {
         return true;
       }
       
       // 2. 乱码检测
       const garbageRatio = countGarbageChars(asrResult.text) / asrResult.text.length;
       if (garbageRatio > 0.1) {
         return true;
       }
       
       // 3. 与上一段高度重叠（在 Scheduler 去重后检查）
       if (previousText && calculateOverlap(asrResult.text, previousText) > 0.8) {
         return true;
       }
       
       return false;
     }
     ```

2. **与去重的关系**
   - 当前去重在 ASR 服务端（Step 9.3）
   - **建议**：坏段判定在节点端，在去重之后检查

**优化建议**：
- ✅ 在节点端实现坏段判定
- ✅ 需要传入 `audioDurationMs`（从 Scheduler 传递）
- ✅ 需要传入 `previousText`（从 Scheduler 传递）

---

### 5.2 Top-2 语言重跑

**方案要求**：
- 从 `language_probabilities` 中取 top-2 语言
- 对当前音频重跑（最多 2 次）

**当前实现**：
- ASR 服务支持 `language` 参数强制指定语言
- 无重跑逻辑

**可行性**：✅ **可行，需要新实现**

**问题与建议**：

1. **实现位置**
   - **建议在节点端**（`task-router.ts`）：
     ```typescript
     async function routeASRTaskWithRerun(
       task: ASRTask,
       isBadSegment: boolean
     ): Promise<ASRResult> {
       // 1. 第一次识别（自动语言检测）
       let result = await routeASRTask(task);
       
       // 2. 如果是坏段，触发重跑
       if (isBadSegment && result.language_probabilities) {
         const top2 = getTop2Languages(result.language_probabilities);
         
         for (const lang of top2) {
           // 强制指定语言重跑
           const rerunResult = await routeASRTask({
             ...task,
             src_lang: lang, // 强制指定语言
           });
           
           // 选择更好的结果
           result = chooseBetterResult(result, rerunResult);
           
           // 最多重跑 2 次
           if (rerunCount >= 2) break;
         }
       }
       
       return result;
     }
     ```

2. **性能影响**
   - 重跑会增加延迟（2 次重跑 = 3 倍 ASR 时间）
   - **建议**：
     - 限制重跑频率（如每个 session 每分钟最多 N 次）
     - 使用异步重跑（不阻塞主流程）
     - 设置超时（如单次重跑不超过 5s）

3. **结果选择**
   - 需要质量评分函数
   - **建议**：
     ```typescript
     function chooseBetterResult(a: ASRResult, b: ASRResult): ASRResult {
       const scoreA = calculateQualityScore(a);
       const scoreB = calculateQualityScore(b);
       return scoreA >= scoreB ? a : b;
     }
     
     function calculateQualityScore(result: ASRResult): number {
       // 文本长度 + 语言置信度 - 乱码惩罚
       const textLen = result.text.trim().length;
       const langProb = result.language_probability || 0;
       const garbagePenalty = countGarbageChars(result.text) * 10;
       return textLen + langProb * 100 - garbagePenalty;
     }
     ```

**优化建议**：
- ✅ 在节点端实现重跑逻辑
- ⚠️ 需要限制重跑频率和超时
- ✅ 需要质量评分函数选择最佳结果
- ⚠️ 注意性能影响，建议异步处理

---

## 6. 跨 utterance 去重/合并（P1）评估

**方案要求**：
- Normalize + exact/prefix/overlap 合并规则
- 最近 N 条窗口（N=10）

**当前实现**：
- ASR 服务已有跨 utterance 去重（Step 9.3）
- 支持 exact、prefix、suffix、containment 检查

**可行性**：✅ **已实现，可能需要增强**

**问题与建议**：

1. **当前实现检查**
   - `faster_whisper_vad_service.py` Step 9.3 已有去重逻辑
   - **建议**：检查是否覆盖所有场景（exact/prefix/suffix/containment）

2. **与 Overlap 的关系**
   - 如果启用 Lookback Overlap，去重逻辑需要更严格
   - **建议**：先测试当前去重效果，再考虑启用 Overlap

3. **窗口大小**
   - 当前去重只检查上一段（`get_text_context()`）
   - **建议**：扩展为最近 N 段窗口（如 N=10）

**优化建议**：
- ✅ 当前实现已覆盖主要场景
- ✅ 可以扩展为多段窗口（如果需要）
- ⚠️ 需要与 Overlap 联动测试

---

## 7. 实施优先级建议

### P0（必须实现）
1. ✅ **边界稳态化**（Hangover + Padding + Short-merge）
2. ✅ **语言置信度分级**（动态调整上下文）
3. ✅ **默认关闭上下文**（符合方案要求）

### P1（重要但可选）
1. ⚠️ **触发式补救**（需要性能评估）
2. ⚠️ **Lookback Overlap**（需要与去重联动测试）
3. ✅ **语言窗口**（会议室模式需要）

---

## 8. 关键风险与建议

### 8.1 性能风险
- **Hangover**：增加延迟 120-220ms
- **Padding**：增加音频处理时间（可忽略）
- **重跑**：可能增加 2-3 倍 ASR 时间
- **建议**：通过 A/B 测试量化影响

### 8.2 兼容性风险
- **Opus 格式**：Padding 和 Overlap 需要解码/编码
- **建议**：统一在节点端处理，支持 Opus 解码

### 8.3 复杂度风险
- **多模块联动**：去重、重跑、Overlap 需要协调
- **建议**：分阶段实施，先 P0 后 P1

---

## 9. 总结

### ✅ 方案整体可行
- 设计思路合理，与当前系统兼容
- 实施步骤清晰，优先级明确

### ⚠️ 需要关注的点
1. **Hangover 实现位置**：建议在 Scheduler 的 `do_finalize` 之前
2. **Padding 与 Opus**：需要支持 Opus 解码
3. **重跑性能**：需要限制频率和超时
4. **上下文策略**：需要根据置信度动态调整

### 📋 建议实施顺序
1. **第一阶段**：边界稳态化（Hangover + Padding + Short-merge）
2. **第二阶段**：语言置信度分级 + 默认关闭上下文
3. **第三阶段**：触发式补救（需要性能评估）
4. **第四阶段**：Lookback Overlap（需要与去重联动测试）

---

## 10. 代码修改建议

### 10.1 Scheduler 端（Rust）
- `session_actor/actor.rs`：添加 Hangover 逻辑
- `session_actor/state.rs`：添加语言窗口和短片段标记
- `managers/audio_buffer.rs`：添加 Short-merge 逻辑

### 10.2 节点端（TypeScript）
- `task-router/task-router.ts`：添加 Padding、坏段判定、重跑逻辑
- `pipeline-orchestrator/pipeline-orchestrator.ts`：传递语言概率信息

### 10.3 ASR 服务端（Python）
- 当前实现已支持语言概率，无需修改
- 去重逻辑已实现，可能需要扩展窗口

---

## 11. 测试建议

### 11.1 单元测试
- Hangover 延迟测试
- Padding 音频格式测试
- 坏段判定逻辑测试
- 重跑逻辑测试

### 11.2 集成测试
- 多语言切换场景
- 手动截断场景
- 短片段合并场景
- 重跑触发场景

### 11.3 A/B 测试
- 边界稳态化效果
- 语言置信度分级效果
- 重跑效果和性能影响

