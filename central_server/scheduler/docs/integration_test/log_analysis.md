# 集成测试日志分析结果

**日期**: 2026-01-24  
**分析目标**: 判断 job 和 utteranceIndex 丢失的原因

---

## 一、关键发现

### 1.1 调度服务器端

从日志中可以看到：

1. **UtteranceIndex 生成情况**：
   - 日志显示 `utterance_index`: 7, 8, 9
   - 但用户返回结果中只有: 0, 2, 5, 7, 8
   - **说明 utterance_index 0, 2, 5 的 job 已经处理完成，不在最近的日志中**

2. **Job 创建日志**：
   ```
   【任务创建】Job 创建成功（已选节点）
   - utterance_index: 9
   - reason: IsFinal
   ```

3. **去重机制**：
   ```
   Duplicate job_result filtered (received within 30 seconds), skipping processing
   - utterance_index: 7
   - result_type: empty
   ```

---

## 二、节点端分析

### 2.1 AudioAggregator 处理

- 所有 job 都显示 `"Buffer not found, creating new buffer"`
- 说明每个 job 到达时，之前的 buffer 已经被删除

### 2.2 ASR 处理

- 部分 job 的 ASR 结果为空
- 空结果被发送用于核销（`ASR_EMPTY`）

---

## 三、结论

### 3.1 Job 丢失原因

1. **部分 job 的 ASR 结果为空**，被标记为 `ASR_EMPTY`
2. **去重机制过滤了重复结果**
3. **Buffer 被提前删除**，导致音频无法合并

### 3.2 UtteranceIndex 不连续原因

- 部分 utterance_index 的 job 可能：
  1. ASR 结果为空，被过滤
  2. 被去重机制过滤
  3. 处理失败，没有返回结果

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
