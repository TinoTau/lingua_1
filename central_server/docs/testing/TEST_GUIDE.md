# 中央服务器测试指南

## 测试概览

### Scheduler (调度服务器)

**测试框架**: Rust + Tokio + Cargo Test

**测试文件结构**:
```
tests/
├── stage1_1.rs              # 阶段 1.1 测试入口
├── stage1_2.rs              # 阶段 1.2 测试入口
├── stage2_1_2.rs            # 阶段 2.1.2 测试入口
├── stage3_2.rs              # 阶段 3.2 测试入口
├── stage1.1/                # 阶段 1.1 详细测试
│   ├── session_test.rs
│   ├── dispatcher_test.rs
│   ├── node_registry_test.rs
│   ├── pairing_test.rs
│   ├── connection_manager_test.rs
│   └── result_queue_test.rs
├── stage1.2/                # 阶段 1.2 详细测试
│   └── message_format_test.rs
├── stage2.1.2/              # 阶段 2.1.2 详细测试
│   ├── asr_partial_message_test.rs
│   └── audio_buffer_test.rs
└── stage3.2/                # 阶段 3.2 详细测试
    └── node_selection_test.rs
```

## 运行测试

### 运行所有测试

```bash
cd central_server/scheduler
cargo test
```

### 运行特定阶段的测试

```bash
# 阶段 1.1: 调度服务器核心功能
cargo test --test stage1_1

# 阶段 1.2: 客户端消息格式对齐
cargo test --test stage1_2

# 阶段 2.1.2: ASR Partial 消息和音频缓冲
cargo test --test stage2_1_2

# 阶段 3.2: 模块化功能实现
cargo test --test stage3_2
```

### 运行特定模块的测试

```bash
# 会话管理测试
cargo test --test stage1_1 session_test

# 任务分发测试
cargo test --test stage1_1 dispatcher_test

# 节点注册表测试
cargo test --test stage1_1 node_registry_test
```

### 显示详细输出

```bash
# 显示所有输出（包括 println!）
cargo test -- --nocapture

# 显示特定测试的详细输出
cargo test --test stage1_1 -- --nocapture
```

### 运行特定测试函数

```bash
# 运行名为 test_create_session 的测试
cargo test test_create_session

# 运行包含特定字符串的测试
cargo test session
```

## 测试覆盖范围

### 阶段 1.1: 调度服务器核心功能

**测试数量**: 47+ 个测试

**覆盖模块**:
- ✅ 会话管理 (Session) - 7 个测试
- ✅ 任务分发 (Dispatcher) - 6 个测试
- ✅ 节点注册表 (Node Registry) - 17 个测试
- ✅ 配对服务 (Pairing) - 6 个测试
- ✅ 连接管理 (Connection Manager) - 8 个测试
- ✅ 结果队列 (Result Queue) - 9 个测试

### 阶段 1.2: 客户端消息格式对齐

**测试数量**: 7 个测试

**覆盖内容**:
- ✅ 消息格式验证
- ✅ 移动端和 Electron Node 客户端消息格式对齐

### 阶段 2.1.2: ASR Partial 消息和音频缓冲

**测试数量**: 多个测试

**覆盖内容**:
- ✅ ASR Partial 消息处理
- ✅ 音频缓冲管理

### 阶段 3.2: 模块化功能实现

**测试数量**: 6 个测试

**覆盖内容**:
- ✅ 基于 capability_state 的节点选择
- ✅ 模块依赖展开的节点选择
- ✅ 节点心跳更新 capability_state

### 其他测试

- ✅ Capability State 测试
- ✅ Group Manager 测试
- ✅ Module Resolver 测试

## 测试报告

详细的测试报告位于各阶段的 `TEST_REPORT.md` 文件中：

- `tests/stage1.1/TEST_REPORT.md` - 阶段 1.1 测试报告
- `tests/stage1.2/TEST_REPORT.md` - 阶段 1.2 测试报告
- `tests/stage2.1.2/TEST_REPORT.md` - 阶段 2.1.2 测试报告
- `tests/stage3.2/TEST_REPORT.md` - 阶段 3.2 测试报告

## API Gateway 测试

**状态**: ⚠️ 目前没有单元测试

**建议添加测试**:
- 认证模块测试
- 限流模块测试
- REST API 测试
- WebSocket API 测试
- 租户管理测试

## Model Hub 测试

**状态**: ⚠️ 目前没有单元测试

**建议添加测试**:
- 模型元数据管理测试
- 模型列表查询测试
- 模型下载 URL 生成测试

## 故障排除

### 测试编译失败

```bash
# 清理并重新编译
cargo clean
cargo test
```

### 测试超时

某些异步测试可能需要更长时间，可以增加超时时间或检查测试逻辑。

### 测试依赖问题

确保所有依赖都已正确安装：
```bash
cargo build
```

## 持续集成

建议在 CI/CD 流程中运行：

```bash
# 运行所有测试
cargo test --release

# 运行测试并生成覆盖率报告（需要安装 cargo-tarpaulin）
cargo tarpaulin --out Html
```
