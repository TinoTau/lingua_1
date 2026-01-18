# Electron Node 文档索引

**项目**: lingua electron-node  
**最后更新**: 2026-01-19

---

## 📚 文档导航

### 🚀 快速开始

- **[PATH_STRUCTURE.md](./PATH_STRUCTURE.md)** - 项目路径结构
- **[README.md](./README.md)** - 本文档索引
- **[MIGRATION.md](./MIGRATION.md)** - 迁移指南

---

## 📖 服务相关 (services/)

服务管理和配置文档

- **[services/SERVICES_STATUS.md](./services/SERVICES_STATUS.md)** - 服务状态
- **[services/SERVICE_MIGRATION_GUIDE.md](./services/SERVICE_MIGRATION_GUIDE.md)** - 服务迁移指南
- **[services/SERVICES_DIRECTORY_README.md](./services/SERVICES_DIRECTORY_README.md)** - 服务目录说明
- **[services/MANUAL_PACKAGING_GUIDE.md](./services/MANUAL_PACKAGING_GUIDE.md)** - 手动打包指南
- **[services/README_PACKAGING.md](./services/README_PACKAGING.md)** - 打包说明

---

## ⚙️ 配置文档 (configuration/)

系统配置和环境设置

- **[configuration/GPU_CONFIGURATION_COMPLETE.md](./configuration/GPU_CONFIGURATION_COMPLETE.md)** - GPU配置完成
- **[configuration/PYTORCH_CUDA_INSTALLATION.md](./configuration/PYTORCH_CUDA_INSTALLATION.md)** - PyTorch CUDA安装
- **[configuration/PYTORCH_VERSION_ANALYSIS.md](./configuration/PYTORCH_VERSION_ANALYSIS.md)** - PyTorch版本分析
- **[configuration/MODEL_MIGRATION_COMPLETE.md](./configuration/MODEL_MIGRATION_COMPLETE.md)** - 模型迁移完成
- **[configuration/MODEL_MIGRATION_SUMMARY.md](./configuration/MODEL_MIGRATION_SUMMARY.md)** - 模型迁移总结

---

## 🔧 故障排查 (troubleshooting/)

问题诊断和解决方案

- **[troubleshooting/HIGH_CPU_USAGE_FIX.md](./troubleshooting/HIGH_CPU_USAGE_FIX.md)** - 高CPU使用修复
- **[troubleshooting/STARTUP_CPU_USAGE_ANALYSIS.md](./troubleshooting/STARTUP_CPU_USAGE_ANALYSIS.md)** - 启动CPU使用分析

---

## 🧪 测试文档 (testing/)

测试指南和测试结果

- **[testing/TEST_DIRECTORY_README.md](./testing/TEST_DIRECTORY_README.md)** - 测试目录说明
- **[testing/README_TESTING.md](./testing/README_TESTING.md)** - 测试说明
- **[testing/test_results_summary.md](./testing/test_results_summary.md)** - 测试结果总结
- **[testing/test_results_final.md](./testing/test_results_final.md)** - 最终测试结果
- **[testing/README_UTTERANCE_INDEX_TEST.md](./testing/README_UTTERANCE_INDEX_TEST.md)** - 发音索引测试
- **[testing/JOB_ASSIGN_FORMAT.md](./testing/JOB_ASSIGN_FORMAT.md)** - 任务分配格式

---

## 🛠️ 运维文档 (operations/)

日常运维和监控

- **[operations/任务链日志说明.md](./operations/任务链日志说明.md)** - 任务链日志说明
- **[operations/查看新服务日志说明.md](./operations/查看新服务日志说明.md)** - 新服务日志说明

---

## 📂 模块文档

### Electron Node (electron_node/)

- **[electron_node/README.md](./electron_node/README.md)** - Electron Node 架构
- **[electron_node/ARCHITECTURE_RECOMMENDATION.md](./electron_node/ARCHITECTURE_RECOMMENDATION.md)** - 架构建议
- **[electron_node/CAPABILITY_STATE_IMPLEMENTATION.md](./electron_node/CAPABILITY_STATE_IMPLEMENTATION.md)** - 能力状态实现
- **[electron_node/FEATURE_COMPARISON.md](./electron_node/FEATURE_COMPARISON.md)** - 特性对比
- **[electron_node/GPU_STATISTICS_TRACKING.md](./electron_node/GPU_STATISTICS_TRACKING.md)** - GPU统计跟踪
- **[electron_node/MODULE_HOT_PLUG_IMPLEMENTATION.md](./electron_node/MODULE_HOT_PLUG_IMPLEMENTATION.md)** - 模块热插拔实现
- **[electron_node/NODE_CLIENT_STARTUP_AND_LOGGING.md](./electron_node/NODE_CLIENT_STARTUP_AND_LOGGING.md)** - 客户端启动和日志
- **[electron_node/PLUGIN_ARCHITECTURE_NECESSITY_ASSESSMENT.md](./electron_node/PLUGIN_ARCHITECTURE_NECESSITY_ASSESSMENT.md)** - 插件架构必要性评估
- **[electron_node/SERVICE_MANAGER_REFACTORING.md](./electron_node/SERVICE_MANAGER_REFACTORING.md)** - 服务管理器重构
- **[electron_node/SERVICE_MIGRATION_ASSESSMENT.md](./electron_node/SERVICE_MIGRATION_ASSESSMENT.md)** - 服务迁移评估
- **[electron_node/STAGE2.2_IMPLEMENTATION.md](./electron_node/STAGE2.2_IMPLEMENTATION.md)** - 阶段2.2实现
- **[electron_node/THIRD_PARTY_PLUGIN_SCENARIOS.md](./electron_node/THIRD_PARTY_PLUGIN_SCENARIOS.md)** - 第三方插件场景

### GPU (GPU/)

- **[GPU/GPU_ARBITER.md](./GPU/GPU_ARBITER.md)** - GPU仲裁器
- **[GPU/GPU_ARBITRATION_MVP_TECH_SPEC.md](./GPU/GPU_ARBITRATION_MVP_TECH_SPEC.md)** - GPU仲裁MVP技术规范
- **[GPU/GPU_USAGE_THRESHOLD_CONTROL_PROPOSAL_v1.1.md](./GPU/GPU_USAGE_THRESHOLD_CONTROL_PROPOSAL_v1.1.md)** - GPU使用阈值控制提案
- **[GPU/ASR_BEAM_SIZE_CONFIG_ARCHITECTURE.md](./GPU/ASR_BEAM_SIZE_CONFIG_ARCHITECTURE.md)** - ASR Beam Size配置架构
- **[GPU/DUPLICATE_UTTERANCE_HANDLING.md](./GPU/DUPLICATE_UTTERANCE_HANDLING.md)** - 重复发音处理
- **[GPU/EXTRACT_TRANSLATION_EXPLANATION.md](./GPU/EXTRACT_TRANSLATION_EXPLANATION.md)** - 翻译提取说明
- **[GPU/INTERNAL_REPETITION_DEDUP_FIX.md](./GPU/INTERNAL_REPETITION_DEDUP_FIX.md)** - 内部重复去重修复
- **[GPU/SENTENCE_LENGTH_THRESHOLDS.md](./GPU/SENTENCE_LENGTH_THRESHOLDS.md)** - 句子长度阈值
- **[GPU/SEQUENTIAL_EXECUTION_IMPLEMENTATION.md](./GPU/SEQUENTIAL_EXECUTION_IMPLEMENTATION.md)** - 顺序执行实现
- **[GPU/TEXT_MERGE_AND_DEDUP_CLARIFICATION.md](./GPU/TEXT_MERGE_AND_DEDUP_CLARIFICATION.md)** - 文本合并和去重说明

### ASR Plus (ASR_plus/)

- **[ASR_plus/ASR_SEMANTIC_REPAIR_CHAIN_EN_INPUT.md](./ASR_plus/ASR_SEMANTIC_REPAIR_CHAIN_EN_INPUT.md)** - ASR语义修复链（英文输入）
- **[ASR_plus/ASR_SEMANTIC_REPAIR_CHAIN_ZH_INPUT.md](./ASR_plus/ASR_SEMANTIC_REPAIR_CHAIN_ZH_INPUT.md)** - ASR语义修复链（中文输入）
- **[ASR_plus/SEMANTIC_REPAIR.md](./ASR_plus/SEMANTIC_REPAIR.md)** - 语义修复
- **[ASR_plus/翻译流程与准确度提升机制.md](./ASR_plus/翻译流程与准确度提升机制.md)** - 翻译流程与准确度提升

### 短语音处理 (short_utterance/)

- **[short_utterance/ASR_AND_AGGREGATION_RESULTS.md](./short_utterance/ASR_AND_AGGREGATION_RESULTS.md)** - ASR和聚合结果
- **[short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md](./short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md)** - 音频聚合完成机制
- **[short_utterance/JOB_RESULT_DEDUPLICATION_IMPLEMENTATION.md](./short_utterance/JOB_RESULT_DEDUPLICATION_IMPLEMENTATION.md)** - 任务结果去重实现
- **[short_utterance/JOB_RESULT_GUARANTEE_AND_TTS_FORMAT.md](./short_utterance/JOB_RESULT_GUARANTEE_AND_TTS_FORMAT.md)** - 任务结果保证和TTS格式
- **[short_utterance/nmt_sentinel_sequence_design.md](./short_utterance/nmt_sentinel_sequence_design.md)** - NMT哨兵序列设计
- **[short_utterance/S1_EFFECTIVENESS_CHECK.md](./short_utterance/S1_EFFECTIVENESS_CHECK.md)** - S1有效性检查
- **[short_utterance/S2_RESCORING_ENABLED.md](./short_utterance/S2_RESCORING_ENABLED.md)** - S2重新评分启用
- **[short_utterance/UTTERANCE_PROCESSING_FLOW.md](./short_utterance/UTTERANCE_PROCESSING_FLOW.md)** - 发音处理流程

### 其他模块

- **[AGGREGATOR/](./AGGREGATOR/)** - 聚合器文档
- **[modular/](./modular/)** - 模块化架构文档
- **[TTS_SERVICES.md](./TTS_SERVICES.md)** - TTS服务
- **[AUDIO_PROCESSING_INDEX.md](./AUDIO_PROCESSING_INDEX.md)** - 音频处理索引
- **[SERVICE_HOT_PLUG_VERIFICATION.md](./SERVICE_HOT_PLUG_VERIFICATION.md)** - 服务热插拔验证
- **[SERVICE_PARAMETER_DECOUPLING.md](./SERVICE_PARAMETER_DECOUPLING.md)** - 服务参数解耦

---

## 📦 归档文档 (archived/)

### 已弃用服务 (archived/deprecated_services/)

**semantic_repair_zh** - 中文语义修复服务（已被 semantic_repair_en_zh 替代）
**semantic_repair_en** - 英文语义修复服务（已被 semantic_repair_en_zh 替代）

---

## 🗂️ 文档分类说明

### 服务相关 (services/)
服务的安装、配置、迁移和打包等管理文档。

### 配置文档 (configuration/)
GPU、PyTorch、模型等系统环境配置文档。

### 故障排查 (troubleshooting/)
各类问题的诊断和解决方案。

### 测试文档 (testing/)
测试指南、测试结果和测试工具说明。

### 运维文档 (operations/)
日志查看、任务监控等日常运维文档。

### 模块文档
按功能模块分类的技术文档（Electron Node、GPU、ASR等）。

### 归档文档 (archived/)
历史文档和已弃用服务的文档。

---

## 📌 文档使用建议

### 新用户
1. 阅读 [PATH_STRUCTURE.md](./PATH_STRUCTURE.md) 了解项目结构
2. 参考 services/ 目录了解服务配置
3. 查看 configuration/ 目录了解环境设置

### 开发者
1. 阅读 electron_node/ 目录了解架构
2. 参考具体模块文档（GPU/、ASR_plus/等）
3. 查看 testing/ 目录了解测试方法

### 运维人员
1. 参考 services/ 和 configuration/ 进行部署
2. 使用 troubleshooting/ 进行故障排查
3. 查看 operations/ 了解日志和监控

---

## 📝 文档维护

### 添加新文档
1. 确定文档类型（服务/配置/故障排查/测试等）
2. 放入对应的目录
3. 更新本索引文件

### 归档旧文档
1. 将不再使用的文档移至 `archived/` 目录
2. 根据类型放入对应的子目录
3. 更新本索引文件

---

**最后更新**: 2026-01-19  
**维护者**: Lingua Team
