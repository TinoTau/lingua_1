# 日志与可观测性文档

本目录包含 LINGUA 全链路日志与可观测性系统的规范文档和评估报告。

## 📁 文档结构

### 规范文档

- **[LINGUA_Logging_Observability_Spec_Consolidated_v3.1.md](./LINGUA_Logging_Observability_Spec_Consolidated_v3.1.md)** ⭐ **最终权威版本（SSOT）**
  - 版本：v3.1
  - 状态：**协议冻结 · 可直接开发**
  - 说明：日志与可观测性系统的唯一权威规范，包含完整的协议定义、类型定义和实现约束

### 评估报告

- **[DEVELOPMENT_READINESS.md](./DEVELOPMENT_READINESS.md)** - 开发就绪度评估
  - 包含 v1/v2/v3/v3.1 版本的完整评估历史
  - 技术可行性分析
  - 开发步骤建议
  - 风险评估

### 实现状态

- **[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)** - 实现状态跟踪
  - 当前实现进度
  - 已完成功能清单
  - 待完成任务
  - 测试结果

### 使用指南

- **[USAGE_GUIDE.md](./USAGE_GUIDE.md)** - 使用指南
  - 配置文件说明
  - 环境变量使用
  - 代码示例
  - 最佳实践

## 📋 文档说明

### 规范文档

**LINGUA_Logging_Observability_Spec_Consolidated_v3.1.md** 是日志系统的最终权威规范，包含：

- ✅ 完整的消息协议定义（包含 trace_id 字段）
- ✅ ui_event 协议的完整类型定义（Rust + TypeScript）
- ✅ 错误码体系与用户提示映射
- ✅ 日志配置与模块级开关
- ✅ 采样、节流与背压策略
- ✅ 内容日志与隐私治理规范

**注意**：v1、v2、v3 版本已废弃，请仅参考 v3.1 版本。

### 评估报告

**DEVELOPMENT_READINESS.md** 整合了所有版本的评估内容，包括：

- v1 版本的可行性评估
- v2 版本的开发就绪度评估
- v3 版本的完整性检查
- v3.1 版本的最终确认

## 🚀 快速开始

### 对于使用者

1. **阅读使用指南**：查看 [USAGE_GUIDE.md](./USAGE_GUIDE.md) 了解如何配置和使用日志系统
2. **查看实现状态**：查看 [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) 了解当前实现进度

### 对于开发者

1. **阅读规范**：查看 [LINGUA_Logging_Observability_Spec_Consolidated_v3.1.md](./LINGUA_Logging_Observability_Spec_Consolidated_v3.1.md)
2. **查看实现状态**：查看 [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) 了解详细实施情况
3. **了解历史评估**：查看 [DEVELOPMENT_READINESS.md](./DEVELOPMENT_READINESS.md) 了解开发就绪度评估历史

## 📊 实现进度

- ✅ **第一步：消息协议扩展** - 已完成并测试通过
- ✅ **第二步：trace_id 传播实现** - 已完成并测试通过
- ✅ **第三步：JSON 日志格式** - 已完成并测试通过
- ✅ **第四步：ui_event 推送** - 已完成并测试通过
- ✅ **第五步：模块日志开关** - 已完成并测试通过

**🎉 日志系统 MVP 阶段已全部完成！**

详细状态请查看 [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)

### 配置文件示例

项目根目录提供了 `observability.json.example` 作为配置文件示例，可以复制为 `observability.json` 并根据需要进行修改。

## 📝 版本历史

- **v3.1**（当前）：最终版本，开发信息 100% 补齐
- **v3**：合并版，开发信息 98% 补齐
- **v2**：集成版，可直接开发
- **v1**：初始方案，高度可行

## 🔗 相关链接

- [系统架构文档](../ARCHITECTURE.md)
- [协议规范文档](../PROTOCOLS.md)
- [项目状态](../project_management/PROJECT_STATUS.md)

