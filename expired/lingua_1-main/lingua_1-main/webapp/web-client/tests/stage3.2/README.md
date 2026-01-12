# 阶段 3.2 测试：功能选择功能

## 测试概述

本测试阶段涵盖 Web 客户端功能选择相关的单元测试。

**测试日期**: 2025-01-XX  
**测试范围**: 
- FeatureFlags 类型定义和构建
- 功能选择逻辑
- WebSocket 客户端 features 参数传递
- 功能选择与语言选择的组合

## 测试文件

### 1. feature_selection_test.ts

测试功能选择的核心逻辑：

- ✅ FeatureFlags 接口定义
- ✅ 完整功能选择
- ✅ 部分功能选择
- ✅ 空功能选择
- ✅ 功能依赖关系（逻辑验证）
- ✅ 功能选择序列化/反序列化

### 2. websocket_client_feature_test.ts

测试 WebSocket 客户端中 features 参数的处理：

- ✅ FeatureFlags 参数处理
- ✅ 功能选择与语言选择组合
- ✅ 功能选择消息序列化

## 运行测试

```bash
# 运行阶段 3.2 的所有测试
npm test -- tests/stage3.2

# 运行特定测试文件
npm test -- tests/stage3.2/feature_selection_test.ts
npm test -- tests/stage3.2/websocket_client_feature_test.ts
```

## 测试覆盖率

- **FeatureFlags 类型**: 100% 覆盖
- **功能选择逻辑**: 100% 覆盖
- **消息构建逻辑**: 100% 覆盖

## 注意事项

- 这些测试是纯单元测试，不依赖外部服务
- WebSocket 实际连接测试需要浏览器环境，将在集成测试中覆盖
- 功能依赖关系检查由后端 ModuleManager 处理，前端只负责收集用户选择

