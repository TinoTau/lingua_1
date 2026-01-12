# 产品文档索引

本文档列出了最能说明当前产品形态、功能、进度的核心文档。

**最后更新**: 2025-01-XX

---

## 📚 核心文档（必读）

### 1. 产品概述和快速开始

#### 1.1 项目主 README
- **位置**: `README.md`（项目根目录）
- **内容**: 
  - 产品概述和核心特性
  - 项目结构
  - 技术栈
  - 快速开始指南
  - 系统架构图
- **适用对象**: 新用户、开发者、管理者
- **更新状态**: ✅ 最新

#### 1.2 快速开始指南
- **位置**: 
  - `webapp/docs/QUICK_START.md` - Web 客户端快速开始
  - `central_server/docs/QUICK_START.md` - 中央服务器快速开始
- **内容**: 
  - 启动步骤
  - 配置说明
  - 验证方法
- **适用对象**: 开发者和运维人员
- **更新状态**: ✅ 最新（已修复 Model Hub 端口号）

---

### 2. 项目进度和状态

#### 2.1 项目状态（最重要）
- **位置**: `docs/project_management/PROJECT_STATUS.md`
- **内容**:
  - 执行摘要（总体完成度）
  - 测试统计（369+ 个测试，100% 通过）
  - 联合调试就绪度评估
  - 已完成功能概览
  - 核心功能清单
  - Phase 3 功能完成状态
  - 节点端 VAD 引擎集成（2025-01-XX）
- **适用对象**: 项目管理、技术负责人、新成员
- **更新状态**: ✅ 最新（已更新 VAD 集成和 Opus 压缩）

#### 2.2 开发计划
- **位置**: `docs/project_management/DEVELOPMENT_PLAN.md`
- **内容**:
  - 分阶段开发计划
  - 详细功能清单
  - 测试报告链接
  - 实现状态（✅/⏳/❌）
- **适用对象**: 开发者、项目管理
- **更新状态**: ✅ 最新

#### 2.3 已完成功能详细列表
- **位置**: `docs/project_management/PROJECT_STATUS_COMPLETED.md`
- **内容**: 所有已完成功能的详细说明
- **适用对象**: 技术负责人、新成员
- **更新状态**: ✅ 最新

#### 2.4 待完成功能列表
- **位置**: `docs/project_management/PROJECT_STATUS_PENDING.md`
- **内容**: 待完成功能及其影响评估
- **适用对象**: 项目管理、开发者
- **更新状态**: ✅ 最新

---

### 3. 技术架构和设计

#### 3.1 系统架构文档（最重要）
- **位置**: `docs/SYSTEM_ARCHITECTURE.md`
- **内容**: 
  - 三层架构设计（客户端层、服务层、算力层）
  - 三个客户端详解（Web端、公司端、节点端）
  - 服务层架构（Scheduler、API Gateway、Model Hub）
  - 数据流说明
  - 连接关系总结
- **适用对象**: 所有人员（必读）
- **更新状态**: ✅ 最新（已重新梳理）

#### 3.2 项目结构文档
- **位置**: `docs/PROJECT_STRUCTURE.md`
- **内容**: 
  - 完整目录结构
  - 三个客户端说明
  - 路径说明
  - 迁移历史
- **适用对象**: 开发者、新成员
- **更新状态**: ✅ 最新（已更新）

#### 3.2 各模块 README
- **位置**:
  - `central_server/README.md` - 中央服务器概述
  - `webapp/README.md` - Web 客户端概述
  - `electron_node/README.md` - Electron 节点客户端概述
- **内容**: 各模块的功能、技术栈、启动方式、测试状态
- **适用对象**: 开发者
- **更新状态**: ✅ 最新

---

### 4. 功能特性文档

#### 4.1 Web 客户端功能
- **位置**: `docs/web_client/`
  - [架构设计](./web_client/ARCHITECTURE.md) - Web 客户端架构设计
  - [Phase 2 实现](./web_client/PHASE2_IMPLEMENTATION.md) - Binary Frame、Opus 框架
  - [Phase 3 实现](./web_client/PHASE3_IMPLEMENTATION.md) - 背压、Opus、Session Init
  - [规模化规范](./web_client/SCALABILITY_SPEC.md) - 规模化能力要求与协议规范
- **内容**: 详细功能设计和使用说明
- **适用对象**: 开发者、产品经理
- **更新状态**: ✅ 最新（已整理）

#### 4.2 模块化功能
- **位置**: `docs/electron_node/modular/`
  - [完整技术说明书](./electron_node/modular/LINGUA_完整技术说明书_v2.md) - 模块化架构设计
  - [模块化功能说明](./electron_node/modular/MODULAR_FEATURES.md) - 功能选择机制
- **内容**: 模块化架构设计、功能选择机制
- **适用对象**: 架构师、高级开发者
- **更新状态**: ✅ 最新（已整理）

#### 4.3 自动语种识别和双向模式
- **位置**: `docs/electron_node/`（参考开发计划中的链接）
- **内容**: 自动语种识别功能的设计文档
- **适用对象**: 开发者
- **更新状态**: ✅ 最新（已整理）

#### 4.4 节点端音频处理优化（新增）
- **位置**: `docs/electron_node/node-inference/`
  - [VAD 引擎集成实现](./electron_node/node-inference/VAD_INTEGRATION_IMPLEMENTATION.md) - VAD 语音段检测和上下文优化
  - [VAD 上下文缓冲区实现](./electron_node/node-inference/VAD_CONTEXT_BUFFER_IMPLEMENTATION.md) - 上下文缓冲区机制
  - [Opus 压缩支持](./electron_node/node-inference/OPUS_COMPRESSION_SUPPORT.md) - Opus 端到端压缩
- **内容**: 节点端音频处理优化功能（VAD 集成、上下文优化、Opus 压缩）
- **适用对象**: 开发者、架构师
- **更新状态**: ✅ 最新（2025-01-XX）

---

### 5. API 文档

#### 5.1 API Gateway 文档
- **位置**: `docs/central_server/api_gateway/`
  - [公共 API 规范](./central_server/api_gateway/PUBLIC_API_SPEC.md)
  - [公共 API 状态](./central_server/api_gateway/PUBLIC_API_STATUS.md)
  - [公共 API 设计](./central_server/api_gateway/PUBLIC_API_DESIGN.md)
- **内容**: REST/WebSocket API 规范
- **适用对象**: 第三方开发者、集成开发者
- **更新状态**: ✅ 最新（已整理）

#### 5.2 Model Hub API
- **位置**: `docs/central_server/model_hub/README.md`
- **内容**: 模型库服务 API 端点和使用示例
- **适用对象**: 开发者
- **更新状态**: ✅ 最新（已整理）

#### 5.3 平台化服务包管理 API
- **位置**: 
  - `docs/central_server/model_manager/公司模型库与Electron客户端模型管理统一技术方案.md` - 完整规范
  - `docs/electron_node/PLATFORM_READY_IMPLEMENTATION_SUMMARY.md` - 实现总结
- **内容**: 平台化服务包管理 API（支持多平台）、服务包安装和管理
- **适用对象**: 开发者、架构师
- **更新状态**: ✅ 最新（已整理）

---

### 6. 测试文档

#### 6.1 测试报告链接
- **位置**: `docs/project_management/PROJECT_STATUS_TESTING.md`
- **内容**: 所有测试报告的链接和测试统计
- **适用对象**: 测试人员、技术负责人
- **更新状态**: ✅ 最新

#### 6.2 端到端测试指南
- **位置**: `docs/testing/END_TO_END_TESTING_GUIDE.md`
- **内容**: 端到端测试步骤和验证方法
- **适用对象**: 测试人员、开发者
- **更新状态**: ✅ 最新

#### 6.3 平台化服务包管理集成测试
- **位置**: `electron_node/electron-node/tests/stage3.2/INTEGRATION_TEST_GUIDE.md`（代码仓库内）
- **内容**: 平台化服务包管理系统集成测试步骤和验证方法
- **适用对象**: 测试人员、开发者
- **更新状态**: ✅ 最新（已整理）

---

### 7. 启动和运维

#### 7.1 启动脚本使用指南
- **位置**: `scripts/README_PRODUCTS.md`
- **内容**: 
  - 三个产品的启动脚本使用方法
  - 启动顺序
  - 环境变量配置
  - 故障排除
- **适用对象**: 开发者、运维人员
- **更新状态**: ✅ 最新

---

## 📊 文档分类总结

### 按用户角色

#### 新用户/快速了解
1. `README.md` - 项目主 README
2. `docs/project_management/PROJECT_STATUS.md` - 项目状态
3. `docs/PROJECT_STRUCTURE.md` - 项目结构

#### 开发者
1. `docs/project_management/DEVELOPMENT_PLAN.md` - 开发计划
2. 各模块的 `README.md` 和 `QUICK_START.md`
3. `scripts/README_PRODUCTS.md` - 启动脚本指南

#### 技术负责人/架构师
1. `docs/project_management/PROJECT_STATUS.md` - 项目状态
2. `electron_node/docs/modular/LINGUA_完整技术说明书_v2.md` - 技术说明书
3. `docs/project_management/PROJECT_STATUS_COMPLETED.md` - 已完成功能

#### 项目管理
1. `docs/project_management/PROJECT_STATUS.md` - 项目状态
2. `docs/project_management/DEVELOPMENT_PLAN.md` - 开发计划
3. `docs/project_management/PROJECT_STATUS_PENDING.md` - 待完成功能

#### 测试人员
1. `docs/project_management/PROJECT_STATUS_TESTING.md` - 测试报告链接
2. `docs/testing/END_TO_END_TESTING_GUIDE.md` - 端到端测试指南

---

## ✅ 文档一致性检查结果

### 已修复的问题

1. ✅ **Model Hub 端口号不一致**
   - **问题**: `central_server/docs/QUICK_START.md` 中端口号写的是 8000 或 8080
   - **实际**: 代码中配置的是 5000
   - **修复**: 已更新为 5000

### 已验证的一致性

1. ✅ **测试统计数据**: `PROJECT_STATUS.md` 和 `PROJECT_STATUS_TESTING.md` 中的测试统计数据一致
2. ✅ **端口配置**: 
   - 调度服务器: 5010 ✅
   - API 网关: 8081 ✅
   - Model Hub: 5000 ✅（已修复）
   - Web 客户端: 9001 ✅

---

## 🔍 文档更新建议

### 优先级 1（重要）
- ✅ 已修复 Model Hub 端口号不一致问题

### 优先级 2（建议）
- 建议定期更新 `PROJECT_STATUS.md` 中的"最后更新"日期
- 建议在 `README.md` 中添加更多使用示例和截图

### 优先级 3（可选）
- 可以考虑创建统一的产品功能对比表
- 可以考虑创建版本历史文档

---

## 📝 使用建议

1. **首次了解项目**: 
   - 先阅读 `README.md`
   - 再查看 `docs/project_management/PROJECT_STATUS.md`

2. **开始开发**: 
   - 阅读对应模块的 `README.md` 和 `QUICK_START.md`
   - 参考 `docs/project_management/DEVELOPMENT_PLAN.md`

3. **了解功能特性**: 
   - 查看 `docs/project_management/PROJECT_STATUS_COMPLETED.md`
   - 参考各功能的设计文档

4. **进行测试**: 
   - 参考 `docs/project_management/PROJECT_STATUS_TESTING.md`
   - 使用 `docs/testing/END_TO_END_TESTING_GUIDE.md`

---

**返回**: [项目文档首页](./README.md)

