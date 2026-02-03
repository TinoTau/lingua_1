# Scheduler 测试文档索引

本目录包含 Scheduler（调度服务器）单元测试相关文档、阶段测试报告与调试记录。

## 快速入口

- `../TEST_GUIDE.md`：central_server 测试总指南（如何跑、常见问题）
- `TEST_STRATEGY.md`：测试策略（GPU/节点端模拟说明）
- `TEST_FIXES_COMPLETE.md`：阶段 3.2 修复完成总结
- `TEST_FAILURE_ANALYSIS.md`：阶段 3.2 失败分析（历史记录）

## 阶段测试报告

测试代码仍位于 `central_server/scheduler/tests/`；对应的 markdown 报告集中在本目录：

- `tests/stage1.1/TEST_REPORT.md`
- `tests/stage1.2/TEST_REPORT.md`
- `tests/stage2.1.2/TEST_REPORT.md`
- `tests/stage3.2/TEST_REPORT.md`

## 调试/对比记录（归档）

更细粒度的调试日志与对比分析会放在 `_archive/`，避免打扰“日常入口”。如果你在复盘或二次排查，可从那里开始。


