# 归档文档说明

## 归档日期
2026-01-24

## 归档原因

以下文档已归档，因为：
1. **已解决的问题**: 文档中描述的问题已经解决（如 shouldCommit 已移除）
2. **部分内容过期**: 文档中包含已过时的信息（如 shouldCommit 相关逻辑）
3. **已被新文档替代**: 新的统一文档已创建（`SHOULD_WAIT_FOR_MERGE_COMPLETE.md`）

## 归档文档列表

### 已解决的问题

1. **`SHOULD_COMMIT_REMOVAL_ANALYSIS.md`**
   - **状态**: 已解决
   - **问题**: shouldCommit 与 shouldWaitForMerge 矛盾
   - **解决**: shouldCommit 已完全移除
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

2. **`SHOULD_COMMIT_REMOVAL_COMPLETE.md`**
   - **状态**: 已完成
   - **内容**: shouldCommit 移除完成报告
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

3. **`SHOULD_WAIT_FOR_MERGE_VS_SHOULD_COMMIT.md`**
   - **状态**: 已解决
   - **问题**: 两个逻辑的区别说明
   - **解决**: shouldCommit 已移除，不再需要对比
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md` 第10节

4. **`JOB_MERGE_FAILURE_ANALYSIS.md`**
   - **状态**: 已解决
   - **问题**: Job合并失败分析，提到 shouldCommit 与 shouldWaitForMerge 矛盾
   - **解决**: shouldCommit 已移除，矛盾已解决
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

### 部分内容过期

5. **`UTTERANCE_AGGREGATION_COMPLETE_FLOW.md`**
   - **状态**: 部分内容过期
   - **过期内容**: 
     - 第4.2节：提交决策（shouldCommit）- shouldCommit 已移除
     - 第5.2节：提交逻辑与等待合并逻辑不一致 - 已解决
   - **保留内容**: 其他流程说明仍然有效
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

6. **`UTTERANCE_AGGREGATION_FLOW_ASR_TO_SEMANTIC_REPAIR.md`**
   - **状态**: 部分内容过期
   - **过期内容**: shouldCommit 相关逻辑
   - **保留内容**: 流程说明仍然有效
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

7. **`ASR_AND_AGGREGATION_RESULT_FORMAT.md`**
   - **状态**: 部分内容过期
   - **过期内容**: shouldCommit 字段已移除
   - **保留内容**: 结果格式说明仍然有效
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

8. **`JOB_PROCESSING_ANALYSIS_TEST_SESSION.md`**
   - **状态**: 部分内容过期
   - **过期内容**: shouldCommit 相关分析
   - **保留内容**: 测试分析仍然有效
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

9. **`SHORT_UTTERANCE_LOGIC_REVIEW.md`**
   - **状态**: 部分内容过期
   - **过期内容**: shouldCommit 相关审查
   - **保留内容**: 其他逻辑审查仍然有效
   - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

10. **`SHOULD_WAIT_FOR_MERGE_LOGIC.md`**
    - **状态**: 已被新文档替代
    - **原因**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md` 包含更完整的信息
    - **参考**: 新文档 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

### 从 short_utterance/ 合并的文档

11. **`UTTERANCE_PROCESSING_FLOW.md`**
    - **状态**: 部分内容过期
    - **过期内容**: shouldCommit 相关逻辑（第273行、第436行）
    - **保留内容**: 其他流程说明仍然有效
    - **来源**: `short_utterance/UTTERANCE_PROCESSING_FLOW.md`

12. **`ASR_AND_AGGREGATION_RESULTS.md`**
    - **状态**: 历史测试结果
    - **内容**: 2025-12-30 的测试结果分析
    - **来源**: `short_utterance/ASR_AND_AGGREGATION_RESULTS.md`

13. **`S2_RESCORING_ENABLED.md`**
    - **状态**: 状态矛盾（已更新）
    - **问题**: 文档标题说"已启用"，但实际代码中已禁用
    - **解决**: 已更新为"已禁用"状态
    - **来源**: `short_utterance/S2_RESCORING_ENABLED.md`（`short_utterance/` 目录已删除）

## 目录删除说明

**`short_utterance/` 目录已删除**（2026-01-24）

**删除原因**:
- 与 utterance 文本聚合相关的文档已合并到 `utterance_aggregation/archived/`
- 其他文档与 utterance 聚合无关，且目录已过期

**已合并的文档**:
- `UTTERANCE_PROCESSING_FLOW.md` → `utterance_aggregation/archived/`
- `ASR_AND_AGGREGATION_RESULTS.md` → `utterance_aggregation/archived/`
- `S2_RESCORING_ENABLED.md` → `utterance_aggregation/archived/`

## 新文档位置

**当前有效文档**: `../SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

该文档包含：
- shouldWaitForMerge 完整逻辑说明
- 配置参数说明
- 处理流程说明
- 使用示例
- 与 shouldCommit 的区别（历史说明）
- 测试建议

## 注意事项

1. **不要删除归档文档**: 这些文档包含历史信息和问题解决过程，有参考价值
2. **查看新文档**: 如需了解当前逻辑，请查看 `SHOULD_WAIT_FOR_MERGE_COMPLETE.md`
3. **过期内容**: 归档文档中关于 shouldCommit 的内容已过期，请勿参考

---

**文档结束**
