# 文档整理计划

**日期**: 2026-01-24  
**状态**: 进行中

---

## 整理原则

1. **参考实际代码**：根据代码实现整理文档
2. **模块化归档**：按功能模块归档到对应目录
3. **删除重复**：已迁移到 electron_node 的文档删除 scheduler 版本
4. **保留历史**：问题分析和修复文档归档到对应模块

---

## 待整理文档分类

### 1. AggregatorMiddleware 相关（aggregator/ 模块）

- ✅ `AggregatorMiddleware功能说明_2026_01_24.md` - 已合并到 `aggregator_middleware.md`，可删除
- ✅ `AggregatorMiddleware未合并问题修复_2026_01_24.md` - 已移动到 `aggregator/issue_merge_fix.md`
- ⏳ `AggregatorMiddleware未合并问题详细分析_2026_01_24.md` - 移动到 `aggregator/issue_merge_analysis.md`
- ⏳ `AggregatorMiddleware生效但未合并问题分析_2026_01_24.md` - 移动到 `aggregator/issue_not_merging.md`
- ⏳ `AudioAggregator和AggregatorMiddleware连续性判断对比_2026_01_24.md` - 移动到 `aggregator/continuity_comparison.md`

### 2. AudioAggregator 相关（audio/ 模块或迁移到 electron_node）

- ⏳ `节点端AudioAggregator完整流程与代码逻辑分析_2026_01_24.md` - 检查是否已迁移到 electron_node
- ⏳ `AudioAggregator处理流程分析_2026_01_24.md` - 移动到 `audio/` 或删除
- ⏳ `AudioAggregator跨节点问题分析_2026_01_24.md` - 移动到 `audio/` 或删除
- ⏳ `AudioAggregator修复对比分析_2026_01_24.md` - 移动到 `audio/` 或删除
- ⏳ `AudioAggregator合并逻辑修复_2026_01_24.md` - 移动到 `audio/` 或删除
- ⏳ `AudioAggregator合并逻辑分析_2026_01_24.md` - 移动到 `audio/` 或删除
- ⏳ `AudioAggregator和Finalize逻辑分析_2026_01_24.md` - 移动到 `audio/` 或删除

### 3. 节点端流式 ASR 相关（迁移到 electron_node 或删除）

- ⏳ `节点端流式ASR优化实施总结_2026_01_24.md` - 检查是否已迁移到 electron_node
- ⏳ `节点端流式ASR优化单元测试说明_2026_01_24.md` - 检查是否已迁移到 electron_node
- ⏳ `节点端音频处理和ASR结果聚合完整需求与架构文档_2026_01_24.md` - 检查是否已迁移到 electron_node
- ⏳ `节点端任务处理流程完整分析_2026_01_24.md` - 检查是否已合并到 `job/node_job_processing.md`

### 4. 集成测试相关（integration_test/ 模块）

- ⏳ `集成测试Job处理过程完整分析报告_2026_01_24.md` - 检查是否已合并
- ⏳ `集成测试Job处理过程完整分析_2026_01_24_v2_最终版.md` - 检查是否已合并
- ⏳ `集成测试Job处理过程完整分析_2026_01_24_v2.md` - 删除（旧版本）
- ⏳ `集成测试Job处理过程详细分析_2026_01_24_v2.md` - 删除（旧版本）
- ⏳ `集成测试完整分析报告_2026_01_24.md` - 检查是否已合并
- ⏳ `集成测试Job处理过程详细分析报告_2026_01_24.md` - 检查是否已合并
- ⏳ `集成测试Job处理过程完整分析_2026_01_24.md` - 检查是否已合并
- ⏳ `集成测试Job处理过程详细分析_2026_01_24.md` - 检查是否已合并
- ⏳ `集成测试日志分析结果_2026_01_24.md` - 移动到 `integration_test/` 或删除
- ⏳ `集成测试job处理分析_2026_01_24.md` - 删除（旧版本）
- ⏳ `集成测试job处理分析_2026_01_23.md` - 删除（旧版本）
- ⏳ `集成测试问题诊断_2026_01_22.md` - 移动到 `integration_test/` 或删除

### 5. MaxDuration 相关（finalize/ 模块）

- ⏳ `MaxDuration独立标签修复总结_2026_01_24.md` - 移动到 `finalize/` 或删除
- ⏳ `MaxDuration处理路径修复总结_2026_01_24.md` - 移动到 `finalize/` 或删除
- ⏳ `MaxDuration处理路径修复_2026_01_24.md` - 移动到 `finalize/` 或删除

### 6. 备份代码对比（backup_comparison/ 模块）

- ⏳ `备份代码配置覆盖机制分析_2026_01_23.md` - 移动到 `backup_comparison/`
- ⏳ `备份代码对比分析_2026_01_23.md` - 移动到 `backup_comparison/`
- ⏳ `备份代码vs当前代码完整差异对比_2026_01_23.md` - 移动到 `backup_comparison/`
- ⏳ `按照备份代码调整ASR配置_2026_01_23.md` - 移动到 `backup_comparison/`
- ⏳ `备份代码vs当前代码ASR性能对比_2026_01_23.md` - 移动到 `backup_comparison/`
- ⏳ `备份代码为什么不会ASR过载_2026_01_23.md` - 移动到 `backup_comparison/`
- ⏳ `备份代码ASR性能对比分析_2026_01_23.md` - 移动到 `backup_comparison/`
- ⏳ `备份代码ASR性能分析_2026_01_23.md` - 移动到 `backup_comparison/`

### 7. 架构相关（architecture/ 模块）

- ⏳ `ARCHITECTURE.md` - 检查是否已移动到 `architecture/`
- ⏳ `POOL_ARCHITECTURE.md` - 检查是否已移动到 `architecture/`
- ⏳ `REDIS_DATA_MODEL.md` - 检查是否已移动到 `architecture/`
- ⏳ `MULTI_INSTANCE_DEPLOYMENT.md` - 检查是否已移动到 `architecture/`
- ⏳ `OPTIMIZATION_HISTORY.md` - 检查是否已移动到 `architecture/`
- ⏳ `NODE_REGISTRATION.md` - 检查是否已移动到 `node_registry/`

### 8. 其他问题分析文档

- ⏳ `Job处理流程详细分析_2026_01_24.md` - 检查是否已合并到 `job/job_processing_flow.md`
- ⏳ `UtteranceAggregator配置对比分析_2026_01_24.md` - 检查是否已合并到 `aggregator/utterance_aggregator.md`
- ⏳ `客户端is_final发送逻辑对比分析_2026_01_24.md` - 移动到 `finalize/` 或删除
- ⏳ `utteranceIndex连续性问题分析_2026_01_24.md` - 移动到 `job/` 或删除
- ⏳ `select_node_timeout_node_id支持_2026_01_24.md` - 检查是否已合并到 `node_registry/session_affinity.md`
- ⏳ `调度服务器节点注册节点管理和任务管理流程详细分析_2026_01_24.md` - 检查是否已合并到 `node_registry/node_and_job_management.md`

---

## 处理优先级

1. **P0 - 立即处理**：
   - AggregatorMiddleware 相关文档（已完成部分）
   - 节点端流式 ASR 文档（检查迁移状态）

2. **P1 - 高优先级**：
   - 集成测试相关文档
   - MaxDuration 相关文档
   - Job 处理流程文档

3. **P2 - 中优先级**：
   - 备份代码对比文档
   - 架构相关文档
   - 其他问题分析文档

---

## 处理状态

- ✅ 已完成：AggregatorMiddleware 功能说明合并、部分问题分析文档归档
- ⏳ 进行中：继续整理其他模块文档
- 📋 待处理：按优先级继续整理

---

**最后更新**: 2026-01-24
