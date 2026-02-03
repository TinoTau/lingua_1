# 节点端流式 ASR 文档索引

**最后更新**: 2026-02

**架构变更说明（2026-02）**：节点端已移除 **OriginalJobResultDispatcher**（死代码清理）。当前结果发送统一经 **ResultSender** + **buildResultsToSend**（含 `pendingEmptyJobs` 空容器 NO_TEXT_ASSIGNED）单路径完成。本目录下部分文档仍保留对 Dispatcher 的历史描述，仅作参考。

---

## 文档结构

本目录包含节点端流式 ASR 的完整文档，包括设计评审、实施总结、架构流程和测试说明。

### 核心文档

1. **[设计评审与优化建议](streaming_asr_node_optimization_guide.md)**
   - 决策部门的反馈和优化建议
   - P0/P1/P2 优化清单
   - 最小改动清单

2. **[实施总结](implementation_summary.md)**
   - P0 优化项完成情况
   - 架构优化亮点
   - 关键数据结构更新
   - 验收标准

3. **[架构与流程](architecture_and_flow.md)**
   - 业务需求详细描述
   - 代码架构和流程（具体到每个方法的调用）
   - 三种 finalize 类型的处理流程
   - 状态机转换逻辑
   - 代码逻辑重复和矛盾检查

4. **[单元测试说明](unit_testing.md)**
   - 测试覆盖场景
   - Mock 音频生成
   - 测试用例示例
   - 验证点

5. **[AudioAggregator 完整流程分析](audio_aggregator_flow_analysis.md)**
   - 完整的调用链
   - 每个处理器的详细流程
   - 关键设计决策

---

## 快速导航

### 按角色

- **决策部门**: 查看 [设计评审与优化建议](streaming_asr_node_optimization_guide.md)
- **开发人员**: 查看 [架构与流程](architecture_and_flow.md) 和 [AudioAggregator 完整流程分析](audio_aggregator_flow_analysis.md)
- **测试人员**: 查看 [单元测试说明](unit_testing.md)
- **项目管理者**: 查看 [实施总结](implementation_summary.md)

### 按主题

- **设计决策**: [设计评审与优化建议](streaming_asr_node_optimization_guide.md)
- **实施状态**: [实施总结](implementation_summary.md)
- **代码实现**: [架构与流程](architecture_and_flow.md), [AudioAggregator 完整流程分析](audio_aggregator_flow_analysis.md)
- **测试验证**: [单元测试说明](unit_testing.md)

---

## 文档迁移说明

本文档目录从 `central_server/scheduler/docs` 迁移而来，已整理合并并清理过期内容：

- ✅ 合并重复内容
- ✅ 清理过期信息
- ✅ 参考实际代码更新
- ✅ 统一文档格式

---

## 相关代码位置

- AudioAggregator: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`
- FinalizeHandler: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-finalize-handler.ts`
- MaxDurationHandler: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-maxduration-handler.ts`（若仍存在）
- 结果发送: `node-agent-result-builder.ts`（buildResultsToSend、sendJobResultPlan）、`node-agent-result-sender.ts`（ResultSender）；**OriginalJobResultDispatcher 已移除**
- 单元测试: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator*.test.ts` 等
