# AggregatorMiddleware 问题分析归档

**日期**: 2026-01-24  
**目的**: 归档 AggregatorMiddleware 相关的问题分析和修复文档

---

## 文档列表

本目录归档了 AggregatorMiddleware 相关的问题分析和修复文档：

1. **AggregatorMiddleware 未合并问题修复** - 问题修复记录
2. **AggregatorMiddleware 未合并问题详细分析** - 详细问题分析
3. **AggregatorMiddleware 生效但未合并问题分析** - 问题诊断
4. **AudioAggregator 和 AggregatorMiddleware 连续性判断对比** - 对比分析

---

## 问题总结

### 问题现象

- AggregatorMiddleware 已启用（`hasAggregatorManager: true`）
- 但所有 job 都被判定为 `NEW_STREAM`，文本未被合并
- 关键原因：`lastUtterance.isManualCut === true` 导致强制返回 `NEW_STREAM`

### 根本原因

1. 客户端发送 `is_final=true`（静音检测或手动发送）
2. 调度器立即 finalize（`reason="IsFinal"`）
3. 调度器设置 `is_manual_cut=true`（因为 `reason == "IsFinal"`）
4. 节点端接收 job，`is_manual_cut=true`
5. `AggregatorStateActionDecider` 强制返回 `NEW_STREAM`（因为 `lastUtterance.isManualCut === true`）

### 解决方案

- 检查调度器的 `is_manual_cut` 设置逻辑
- 考虑在 `AggregatorStateActionDecider` 中增加时间间隔检查
- 即使 `isManualCut=true`，如果时间间隔很短，也应该允许合并

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
