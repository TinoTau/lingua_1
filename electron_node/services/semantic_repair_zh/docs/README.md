# Semantic Repair ZH 文档索引

本文档目录包含中文语义修复服务的所有技术文档。

## 文档列表

### 核心文档
- [模型下载完成说明](MODEL_DOWNLOAD_COMPLETE.md) - 模型下载和配置说明

### 问题报告
- [GPTQ量化问题报告（英文）](GPTQ_QUANTIZATION_ISSUE_REPORT.md) - GPTQ量化加载问题的详细技术报告
- [问题报告（中文）](问题报告_中文.md) - GPTQ量化问题的中文简化报告
- [当前问题与解决方案](CURRENT_ISSUE_AND_SOLUTION.md) - **当前问题分析和解决方案建议（推荐阅读）**
- [解决方案总结](SOLUTION_SUMMARY.md) - 当前问题和解决方案总结
- [服务兼容性验证](SERVICE_COMPATIBILITY_VERIFICATION.md) - 其他服务兼容性验证报告
- [实施决策记录](IMPLEMENTATION_DECISION.md) - 不降级 PyTorch 的决策记录
- [**决策报告：技术方案变更**](决策报告_技术方案变更.md) - **给决策部门的技术方案变更报告（推荐阅读）**

### 优化文档
- [优化总结](OPTIMIZATION_SUMMARY.md) - 服务优化措施和性能改进总结

### 脚本使用文档
- [脚本使用指南](SCRIPTS_USAGE_GUIDE.md) - 各种辅助脚本的使用说明
- [脚本README](README_SCRIPTS.md) - 脚本功能详细说明

### 实施计划
- [llama.cpp 实施计划](LLAMACPP_IMPLEMENTATION_PLAN.md) - 使用 llama.cpp 替代 auto-gptq 的方案
- [实施决策记录](IMPLEMENTATION_DECISION.md) - 不降级 PyTorch 的决策记录和验证清单

## 快速链接

- [主README](../README.md) - 服务概述和API文档
- [服务配置](../service.json) - 服务配置文件

## 相关技术规格

- [双引擎自适应方案](../docs/SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md) - 双引擎自动切换设计
- [GPU仲裁MVP技术方案](../../../docs/GPU/GPU_ARBITRATION_MVP_TECH_SPEC.md) - GPU仲裁方案（暂不实现）
