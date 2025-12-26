# ASR 模块文档

本文档目录包含 ASR（自动语音识别）模块的所有相关文档。

## 文档结构

```
asr/
├── README.md                    # 本文档（索引）
├── ASR_NEXT_PHASE_DEVELOPMENT_PLAN.md  # 下一阶段开发计划
├── ASR_P1_ENTRY_GATE_CHECKLIST.md      # P1 入口检查清单
├── ASR_P0_5_P1_SUPPLEMENTAL_DEVELOPMENT_TASKS.md  # P0.5/P1 补充开发任务
├── implementation/              # 实现相关文档
│   ├── ASR_PHASE_1_IMPLEMENTATION_SUMMARY.md
│   ├── ASR_P0_5_IMPLEMENTATION_SUMMARY.md
│   ├── GATE_A_B_UNIT_TEST_REPORT.md
│   └── GATE_A_B_TEST_FIX_SUMMARY.md
├── optimization/               # 优化相关文档
│   ├── ASR_ACCURACY_OPTIMIZATION.md
│   ├── ASR_RECOGNITION_ISSUES_ANALYSIS.md
│   ├── ASR_ACCURACY_AND_DUPLICATION_ANALYSIS.md
│   ├── ASR_MULTILINGUAL_TURN_TAKING_ACCURACY_STRATEGY.md
│   ├── ASR_STRATEGY_FEASIBILITY_REVIEW.md
│   ├── ASR_PARAMETERS_CLIENT_PASSTHROUGH_ANALYSIS.md
│   ├── BEAM_SIZE_EXPLANATION.md
│   ├── BEAM_SIZE_ISSUE_ANALYSIS.md
│   ├── BEAM_SIZE_FIX_SUMMARY.md
│   ├── BEAM_SIZE_COMPLETE_FIX.md
│   └── BEAM_SIZE_CONFIGURATION_IMPLEMENTATION.md
└── testing/                    # 测试相关文档
    ├── ASR_P0_5_TEST_REPORT.md
    ├── ASR_ACCURACY_IMPROVEMENT_TEST_REPORT.md
    ├── ASR_EDGE1_TEST_RESULTS.md
    ├── ASR_EDGE4_TEST_RESULTS.md
    ├── ASR_REFACTOR_PHASE1_TEST_RESULTS.md
    └── ASR_ACCURACY_STRATEGY_SUPPLEMENTS_JIRA_CODE_ABTEST.md
```

## 快速导航

### 开发计划
- [下一阶段开发计划](./ASR_NEXT_PHASE_DEVELOPMENT_PLAN.md)
- [P1 入口检查清单](./ASR_P1_ENTRY_GATE_CHECKLIST.md)
- [P0.5/P1 补充开发任务](./ASR_P0_5_P1_SUPPLEMENTAL_DEVELOPMENT_TASKS.md)

### 实现文档
- [Phase 1 实现总结](./implementation/ASR_PHASE_1_IMPLEMENTATION_SUMMARY.md)
- [P0.5 实现总结](./implementation/ASR_P0_5_IMPLEMENTATION_SUMMARY.md)
- [Gate-A/B 单元测试报告](./implementation/GATE_A_B_UNIT_TEST_REPORT.md)
- [Gate-A/B 测试修复总结](./implementation/GATE_A_B_TEST_FIX_SUMMARY.md)

### 优化文档
- [ASR 准确度优化](./optimization/ASR_ACCURACY_OPTIMIZATION.md)
- [ASR 识别问题分析](./optimization/ASR_RECOGNITION_ISSUES_ANALYSIS.md)
- [Beam Size 说明](./optimization/BEAM_SIZE_EXPLANATION.md)
- [Beam Size 配置实现](./optimization/BEAM_SIZE_CONFIGURATION_IMPLEMENTATION.md)

### 测试文档
- [P0.5 测试报告](./testing/ASR_P0_5_TEST_REPORT.md)
- [准确度改进测试报告](./testing/ASR_ACCURACY_IMPROVEMENT_TEST_REPORT.md)

## 相关文档

- [Faster Whisper VAD 服务文档](../../../electron_node/services/faster_whisper_vad/README.md)
- [Electron Node 文档](../README.md)

