# 测试目录说明

本目录包含所有阶段的单元测试，按阶段编号组织。

## 目录结构

```
tests/
├── stage1.1/              # 阶段一.1（1.1 调度服务器核心功能）测试
│   ├── mod.rs            # 测试模块声明
│   ├── session_test.rs   # 会话管理测试
│   ├── dispatcher_test.rs # 任务分发测试
│   ├── node_registry_test.rs # 节点注册表测试
│   ├── pairing_test.rs   # 配对服务测试
│   ├── connection_manager_test.rs # 连接管理测试
│   ├── result_queue_test.rs # 结果队列测试
│   ├── README.md         # 测试说明文档
│   └── TEST_REPORT.md    # 测试结果报告
├── stage1.2/              # 阶段一.2（1.2 客户端消息格式对齐）测试
│   ├── mod.rs            # 测试模块声明
│   ├── message_format_test.rs # 消息格式验证测试
│   └── TEST_REPORT.md    # 测试结果报告
├── stage3.2/              # 阶段 3.2（模块化功能实现）测试
│   ├── mod.rs            # 测试模块声明
│   ├── node_selection_test.rs # 节点选择测试
│   └── TEST_REPORT.md    # 测试结果报告
├── stage1_1.rs           # 阶段一.1 测试入口（文件名使用下划线）
├── stage1_2.rs           # 阶段一.2 测试入口（文件名使用下划线）
└── stage3_2.rs           # 阶段 3.2 测试入口（文件名使用下划线）
```

## 运行测试

### 运行特定阶段的测试

```bash
# 运行阶段一.1的所有测试
cargo test --test stage1_1

# 运行阶段一.2的所有测试
cargo test --test stage1_2

# 运行阶段 3.2 的所有测试
cargo test --test stage3_2

# 运行特定测试模块
cargo test --test stage1_1 session_test
cargo test --test stage1_2 message_format_test
cargo test --test stage3_2 node_selection_test

# 运行特定测试
cargo test --test stage1_1 test_create_session
cargo test --test stage1_2 test_session_init_message_format
cargo test --test stage3_2 test_select_node_with_models_ready

# 显示详细输出
cargo test --test stage1_1 -- --nocapture
cargo test --test stage1_2 -- --nocapture
cargo test --test stage3_2 -- --nocapture
```

### 运行所有测试

```bash
cargo test
```

## 测试阶段说明

### 阶段一.1：调度服务器核心功能

**测试数量**: 47个测试  
**测试内容**: 会话管理、任务分发、节点注册、配对服务、连接管理、结果队列  
**测试报告**: [TEST_REPORT.md](./stage1.1/TEST_REPORT.md)

### 阶段一.2：客户端消息格式对齐

**测试数量**: 7个测试  
**测试内容**: 消息格式验证（移动端和 Electron Node 客户端的消息格式对齐协议规范）  
**测试报告**: [TEST_REPORT.md](./stage1.2/TEST_REPORT.md)

### 阶段 3.2：模块化功能实现

**测试数量**: 6个测试  
**测试内容**: 基于 capability_state 的节点选择、模块依赖展开的节点选择、节点心跳更新  
**测试报告**: [TEST_REPORT.md](./stage3.2/TEST_REPORT.md)

## 测试组织原则

1. **按阶段编号**: 每个开发阶段有独立的测试目录（如 `stage1.1/`, `stage1.2/` 等）
2. **模块化**: 每个功能模块有独立的测试文件
3. **文档完整**: 每个阶段包含 README.md 和 TEST_REPORT.md
4. **易于扩展**: 新阶段的测试可以按照相同结构添加

## 添加新阶段测试

1. 创建新的测试目录，如 `tests/stage1.2/`
2. 创建测试入口文件，如 `tests/stage1_2.rs`（注意：文件名使用下划线，因为 Rust crate 名不能包含点号）
3. 在目录中创建各个模块的测试文件
4. 创建 `mod.rs` 声明所有测试模块
5. 创建 `README.md` 说明测试内容
6. 运行测试后创建 `TEST_REPORT.md` 记录测试结果

## 测试命名规范

- 测试文件: `{module}_test.rs`
- 测试函数: `test_{functionality}`
- 测试目录: `stage{major}.{minor}/`（使用点号，更清晰）
- 测试入口: `stage{major}_{minor}.rs`（使用下划线，符合 Rust 命名规范）

