# AudioAggregator 问题分析归档

**日期**: 2026-01-24  
**目的**: 归档 AudioAggregator 相关的问题分析和修复文档

---

## 文档列表

本目录归档了 AudioAggregator 相关的问题分析和修复文档：

1. **AudioAggregator 处理流程分析** - 处理流程和业务需求分析
2. **AudioAggregator 跨节点问题分析** - Session Affinity 和跨节点问题
3. **AudioAggregator 修复对比分析** - 修复前后对比和备份代码对比
4. **AudioAggregator 合并逻辑修复** - 合并逻辑修复记录
5. **AudioAggregator 合并逻辑分析** - 合并逻辑详细分析
6. **AudioAggregator 和 Finalize 逻辑分析** - Finalize 处理逻辑分析

---

## 问题总结

### 主要问题

1. **Buffer 清除逻辑问题**
   - 修复前：无条件清空 `pendingTimeoutAudio`
   - 修复后：只有在成功合并时才清空

2. **跨节点问题**
   - 调度服务器随机分发任务，但 MaxDuration finalize 使用 Session Affinity
   - 使用 `utteranceIndexDiff` 判断连续性，需要确保 job 路由到同一节点

3. **合并逻辑问题**
   - 需要正确处理连续的 MaxDuration finalize
   - 需要正确处理 pendingTimeoutAudio 和 pendingMaxDurationAudio

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
