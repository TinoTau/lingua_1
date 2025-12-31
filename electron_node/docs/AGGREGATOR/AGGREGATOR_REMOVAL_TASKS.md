# Aggregator 改造前移除任务清单

**目标**：移除可以被 Aggregator 机制替代的现有实现，避免功能重复和冲突  
**执行时机**：在开始 Aggregator 开发前完成  
**优先级**：P0（必须完成）

---

## 执行摘要

根据机制替代性分析，以下内容可以被 Aggregator 替代，需要在开发前移除：

1. ✅ **ASR 服务端的跨 utterance 去重（Step 9.3）** - 可被 Aggregator dedup 替代
2. ❌ **Scheduler 侧去重闸门** - 未实现，无需移除
3. ❌ **流式 ASR partial results** - 不能替代（互补关系），保留
4. ❌ **gap_ms** - 不能替代（是输入参数），保留

---

## Task List

### TASK-1: 移除 ASR 服务端的跨 utterance 去重逻辑（Step 9.3）

**文件**：`electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**位置**：`process_utterance` 函数，Step 9.3 部分（约第 803-900 行）

**需要移除的代码**：
```python
# 9.3. 跨 utterance 去重：检查当前文本是否与上一个 utterance 的文本重复
if req.use_text_context:
    previous_text = get_text_context()
    if previous_text and full_text_trimmed:
        previous_text_trimmed = previous_text.strip()
        # ... 所有跨 utterance 去重逻辑 ...
        # - 完全重复检测
        # - 部分重复检测（startswith, endswith, contains 等）
        # - 返回空结果的逻辑
```

**移除原因**：
- Aggregator 会在节点端统一处理跨 utterance 的文本去重（dedup 功能）
- 避免重复处理，职责更清晰
- 在翻译前去重，性能更好

**保留内容**：
- ✅ Step 9.2：单个 utterance 内部去重（`deduplicate_text`）- **保留**
- ✅ `get_text_context()` 函数 - **保留**（可能用于其他用途）
- ✅ `use_text_context` 参数 - **保留**（可能用于其他用途）

**验证步骤**：
1. 移除 Step 9.3 的跨 utterance 去重逻辑
2. 保留 Step 9.2 的 utterance 内部去重
3. 运行测试，确保 utterance 内部去重仍然正常工作
4. 确认日志中不再出现 "Step 9.3: Cross-utterance" 相关日志

**影响评估**：
- **功能影响**：移除后，跨 utterance 的重复文本会传递到 Aggregator 处理
- **性能影响**：无负面影响，Aggregator 会在节点端统一处理
- **兼容性**：不影响现有 API 接口

---

### TASK-2: 更新相关文档和注释

**需要更新的文档**：

1. **`electron_node/services/faster_whisper_vad/docs/UTTERANCE_CONTEXT_AND_DEDUPLICATION.md`**
   - 更新"跨 Utterance 去重方案"部分
   - 说明：跨 utterance 去重已迁移到 Aggregator 层
   - 保留 utterance 内部去重的说明

2. **`electron_node/services/faster_whisper_vad/docs/organized/context_and_deduplication/context_and_deduplication.merged_part2.md`**
   - 更新 Step 9.3 相关说明
   - 标注：已迁移到 Aggregator

3. **代码注释**
   - 在 `faster_whisper_vad_service.py` 中添加注释：
     ```python
     # Step 9.2: 单个 utterance 内去重（保留）
     # 注意：跨 utterance 去重已迁移到 Aggregator 层（节点端）
     ```

**验证步骤**：
1. 检查所有相关文档已更新
2. 确认代码注释清晰说明职责边界

---

### TASK-3: 验证移除后的功能完整性

**测试场景**：

1. **Utterance 内部去重测试**：
   - 输入：`"这边能不能用这边能不能用"`
   - 预期：输出 `"这边能不能用"`（Step 9.2 仍然工作）

2. **跨 Utterance 重复测试**：
   - Utterance 1: `"测试"`
   - Utterance 2: `"测试"` 或 `"测试一下"`
   - 预期：两个 utterance 都会传递到 Aggregator，由 Aggregator 处理去重

3. **边界重复测试**：
   - Utterance 1: `"我们"`
   - Utterance 2: `"我们可以"`
   - 预期：两个 utterance 都会传递到 Aggregator，由 Aggregator 的 dedup 处理

**验证步骤**：
1. 运行单元测试，确保 utterance 内部去重正常
2. 运行集成测试，验证跨 utterance 重复会传递到 Aggregator
3. 检查日志，确认不再有 Step 9.3 的处理逻辑

---

## 不需要移除的内容

### ✅ 保留：ASR 服务端的 utterance 内部去重（Step 9.2）

**原因**：
- 处理单个 utterance 内部的重复（如 "这边能不能用这边能不能用"）
- 与 Aggregator 的跨 utterance 去重职责不同
- 在 ASR 服务端处理更高效

**代码位置**：`faster_whisper_vad_service.py` Step 9.2

---

### ✅ 保留：Scheduler 的重复 Job 创建去重

**原因**：
- 防止重复 finalize 导致的重复 job 创建
- 不是文本去重，是流程去重
- 与 Aggregator 的文本去重职责不同

**代码位置**：`central_server/scheduler/src/websocket/session_message_handler/audio.rs`

---

### ✅ 保留：流式 ASR partial results

**原因**：
- 与 Aggregator 是互补关系，不是替代关系
- 用于实时反馈，降低延迟
- Aggregator 用于最终优化

---

### ✅ 保留：gap_ms 相关逻辑

**原因**：
- gap_ms 是 Aggregator 的输入参数，必须保留
- 需要扩展协议获取时间戳以计算 gap_ms

---

## 执行顺序

1. **第一步**：完成 TASK-1（移除代码）
2. **第二步**：完成 TASK-2（更新文档）
3. **第三步**：完成 TASK-3（验证功能）
4. **第四步**：开始 Aggregator 开发

---

## 风险评估

### 低风险 ✅
- **移除范围明确**：只移除 Step 9.3 的跨 utterance 去重
- **功能边界清晰**：保留 utterance 内部去重
- **影响可控**：移除后功能由 Aggregator 接管

### 注意事项 ⚠️
- **测试覆盖**：确保移除后 utterance 内部去重仍然正常工作
- **日志监控**：移除后观察是否有新的重复问题出现
- **回滚准备**：保留代码备份，如果 Aggregator 开发延期，可以临时恢复

---

## 验收标准

- [x] Step 9.3 的跨 utterance 去重代码已移除
- [x] Step 9.2 的 utterance 内部去重仍然正常工作
- [x] 相关文档已更新
- [x] 代码注释已更新
- [x] 单元测试通过
- [x] 集成测试通过
- [x] 日志中不再出现 Step 9.3 相关处理

---

## 相关文档

- `AGGREGATOR_IMPLEMENTATION_FEEDBACK_REPORT.md` - 机制替代性分析
- `AGGREGATOR_TEXT_INCOMPLETENESS_LANGUAGE_GATE_DESIGN.md` - Aggregator 设计文档
- `UTTERANCE_DUPLICATION_REDUNDANCY_REPORT.md` - 重复问题分析

---

**创建时间**：2024年  
**最后更新**：2025-12-28  
**状态**：✅ **已完成**

---

## 执行记录

### 2025-12-28 - 任务完成

**执行内容**:
1. ✅ **TASK-1**: 移除 ASR 服务端的跨 utterance 去重逻辑（Step 9.3）
   - 从 `faster_whisper_vad_service.py` 中移除了 Step 9.3 的跨 utterance 去重代码（第 803-912 行）
   - 添加了注释说明跨 utterance 去重已迁移到 Aggregator 层
   - 保留了 Step 9.2 的 utterance 内部去重功能

2. ✅ **TASK-2**: 更新相关文档和注释
   - 更新了 `UTTERANCE_CONTEXT_AND_DEDUPLICATION.md`
   - 更新了 `context_and_deduplication.merged_part2.md`
   - 在代码中添加了清晰的注释说明职责边界

3. ✅ **TASK-3**: 验证移除后的功能完整性
   - 创建了测试文件 `test_step93_removal.py`
   - 运行了完整的单元测试和集成测试
   - 所有测试通过：3/3 ✅

**测试结果**:
- ✅ Step 9.2 内部去重测试通过
- ✅ Step 9.3 移除验证测试通过
- ✅ 日志验证测试通过

**验证要点**:
- ✅ Step 9.2 的 utterance 内部去重功能正常工作
- ✅ Step 9.3 的跨 utterance 去重已完全移除
- ✅ 服务能正常处理跨 utterance 请求，不会因为重复而返回空结果
- ✅ 日志中不再出现 Step 9.3 相关处理

**相关文件**:
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 代码已更新
- `electron_node/services/faster_whisper_vad/test_step93_removal.py` - 测试文件
- `electron_node/services/faster_whisper_vad/docs/TEST_STEP93_REMOVAL.md` - 测试报告

