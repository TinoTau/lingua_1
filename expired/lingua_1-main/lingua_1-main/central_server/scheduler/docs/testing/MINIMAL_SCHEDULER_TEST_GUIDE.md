# 极简无锁调度服务单元测试指南

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-11
- **状态**: ✅ 测试已实现并验证通过
- **测试文件**: `tests/minimal_scheduler_test.rs`
- **测试结果**: 7 个测试全部通过 ✅

---

## 一、测试概述

### 1.1 测试目标

测试极简无锁调度服务（`MinimalSchedulerService`）的4个核心方法：

1. **节点注册** (`register_node`) - 测试节点注册到 Redis
2. **节点心跳** (`heartbeat`) - 测试节点心跳更新
3. **任务调度** (`dispatch_task`) - 测试任务调度到节点
4. **任务完成** (`complete_task`) - 测试任务完成和资源释放

### 1.2 测试框架

- **框架**: Rust + Tokio + Cargo Test
- **依赖**: Redis（需要运行中的 Redis 实例）
- **环境变量**: `LINGUA_TEST_REDIS_URL`（可选，默认为 `redis://127.0.0.1:6379`）

---

## 二、测试列表

### 2.1 基础测试

| 测试名称 | 功能 | 状态 |
|---------|------|------|
| `test_create_minimal_scheduler_service` | 创建服务实例 | ✅ 已实现 |
| `test_register_node` | 节点注册 | ✅ 已实现 |
| `test_heartbeat` | 节点心跳 | ✅ 已实现 |
| `test_dispatch_task` | 任务调度 | ✅ 已实现 |
| `test_complete_task` | 任务完成 | ✅ 已实现 |
| `test_complete_task_node_mismatch` | 节点 ID 不匹配错误 | ✅ 已实现 |
| `test_full_workflow` | 完整流程（注册 → 心跳 → 调度 → 完成） | ✅ 已实现 |

---

## 三、运行测试

### 3.1 前置条件

1. **Redis 服务**: 需要运行中的 Redis 实例
   ```bash
   # 默认连接: redis://127.0.0.1:6379
   # 或设置环境变量:
   export LINGUA_TEST_REDIS_URL=redis://127.0.0.1:6379
   ```

2. **环境变量**（可选）:
   - `LINGUA_TEST_REDIS_URL`: Redis 连接 URL
   - `LINGUA_TEST_REDIS_MODE`: Redis 模式（`single` 或 `cluster`）

### 3.2 运行所有测试

```bash
cd central_server/scheduler
cargo test --test minimal_scheduler_test
```

### 3.3 运行特定测试

```bash
# 运行节点注册测试
cargo test --test minimal_scheduler_test test_register_node

# 运行完整流程测试
cargo test --test minimal_scheduler_test test_full_workflow

# 运行所有测试并显示输出
cargo test --test minimal_scheduler_test -- --nocapture
```

### 3.4 跳过测试（如果 Redis 不可用）

如果 Redis 不可用，测试会自动跳过并输出 `skip: redis not available`。

---

## 四、测试详细说明

### 4.1 test_register_node

**功能**: 测试节点注册到 Redis

**步骤**:
1. 创建 MinimalSchedulerService 实例
2. 调用 `register_node` 注册节点
3. 验证 Redis 中的数据：
   - `scheduler:node:info:{node_id}` - 节点信息
   - `scheduler:node:runtime:{node_id}` - 节点运行状态

**验证**:
- 节点信息中的 `online` 应该是 `"true"`
- 节点信息中的 `max_jobs` 应该是 `"4"`
- 节点运行状态中的 `current_jobs` 应该是 `"0"`

---

### 4.2 test_heartbeat

**功能**: 测试节点心跳更新

**步骤**:
1. 注册节点
2. 发送心跳（包含负载信息）
3. 验证 Redis 中的数据更新

**验证**:
- 节点信息中的 `online` 应该是 `"true"`
- 节点信息中的 `last_heartbeat_ts` 应该更新

---

### 4.3 test_dispatch_task

**功能**: 测试任务调度到节点

**步骤**:
1. 注册节点
2. 设置语言索引（`scheduler:lang:{src}:{tgt}`）
3. 设置 Pool 成员（`scheduler:pool:{pool_id}:members`）
4. 调用 `dispatch_task` 调度任务
5. 验证 Redis 中的数据：
   - 任务记录（`scheduler:job:{job_id}`）
   - 节点并发槽占用（`current_jobs` 应该增加）

**验证**:
- 返回的 `node_id` 应该是注册的节点 ID
- 返回的 `job_id` 不应该为空
- 节点的 `current_jobs` 应该从 `0` 增加到 `1`

---

### 4.4 test_complete_task

**功能**: 测试任务完成和资源释放

**步骤**:
1. 注册节点并占用一个并发槽
2. 创建 job 记录
3. 调用 `complete_task` 完成任务
4. 验证 Redis 中的数据更新

**验证**:
- Job 状态应该更新为 `"finished"`
- 节点的 `current_jobs` 应该从 `1` 减少到 `0`

---

### 4.5 test_complete_task_node_mismatch

**功能**: 测试节点 ID 不匹配的错误处理

**步骤**:
1. 创建 job 记录（属于 node-1）
2. 尝试用错误的节点 ID（node-2）完成任务
3. 验证错误处理

**验证**:
- 应该返回错误（节点 ID 不匹配）

---

### 4.6 test_full_workflow

**功能**: 测试完整流程（注册 → 心跳 → 调度 → 完成）

**步骤**:
1. 注册节点
2. 发送心跳
3. 调度任务
4. 完成任务
5. 验证最终状态

**验证**:
- 所有步骤应该成功执行
- 最终状态应该正确（`current_jobs` 应该是 `0`）

---

## 五、测试数据清理

### 5.1 自动清理

每个测试结束后，会自动清理测试数据（通过 `cleanup_test_keys` 函数）。

### 5.2 清理的键

- `scheduler:node:info:*` - 节点信息
- `scheduler:node:runtime:*` - 节点运行状态
- `scheduler:pool:*` - Pool 成员
- `scheduler:lang:*` - 语言索引
- `scheduler:job:*` - 任务记录
- `scheduler:session:*` - 会话记录

---

## 六、故障排查

### 6.1 Redis 连接失败

**症状**: 测试输出 `skip: redis not available`

**解决方案**:
1. 确保 Redis 服务正在运行
2. 检查 `LINGUA_TEST_REDIS_URL` 环境变量
3. 检查 Redis 连接权限

---

### 6.2 测试失败

**常见原因**:
1. **Redis 数据未清理**: 前一次测试的数据可能影响当前测试
   - **解决方案**: 运行 `cleanup_test_keys` 函数，或重启 Redis

2. **Lua 脚本错误**: Lua 脚本可能包含语法错误
   - **解决方案**: 检查 `scripts/lua/` 目录下的 Lua 脚本

3. **并发冲突**: 多个测试同时运行可能造成冲突
   - **解决方案**: 使用串行测试运行（`cargo test --test minimal_scheduler_test -- --test-threads=1`）

---

## 七、测试覆盖率

### 7.1 当前覆盖

- ✅ 节点注册（成功场景）
- ✅ 节点心跳（成功场景）
- ✅ 任务调度（成功场景）
- ✅ 任务完成（成功场景）
- ✅ 错误处理（节点 ID 不匹配）
- ✅ 完整流程

### 7.2 待补充

- ⏳ 任务调度失败场景（无可用节点、Pool 为空等）
- ⏳ 节点注册失败场景（节点 ID 冲突等）
- ⏳ 并发测试（多个节点同时注册、多个任务同时调度等）
- ⏳ 性能测试（大量节点和任务）

---

## 八、参考文档

- **规范文档**: `docs/architecture/LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md`
- **集成指南**: `docs/implementation/MINIMAL_SCHEDULER_INTEGRATION.md`
- **实施状态**: `docs/implementation/MINIMAL_SCHEDULER_IMPLEMENTATION_STATUS.md`

---

## 九、测试结果总结

### 9.1 测试执行结果

```
running 7 tests
test test_complete_task ... ok
test test_complete_task_node_mismatch ... ok
test test_create_minimal_scheduler_service ... ok
test test_dispatch_task ... ok
test test_full_workflow ... ok
test test_heartbeat ... ok
test test_register_node ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

### 9.2 测试覆盖

- ✅ **节点注册**: 测试节点注册到 Redis，验证节点信息和运行状态
- ✅ **节点心跳**: 测试节点心跳更新，验证节点状态更新
- ✅ **任务调度**: 测试任务调度到节点，验证任务记录和节点并发槽占用
- ✅ **任务完成**: 测试任务完成和资源释放，验证任务状态和节点并发槽释放
- ✅ **错误处理**: 测试节点 ID 不匹配的错误处理
- ✅ **完整流程**: 测试完整流程（注册 → 心跳 → 调度 → 完成）

### 9.3 注意事项

1. **串行执行**: 使用 `--test-threads=1` 参数串行执行测试，避免并发冲突
2. **Redis 清理**: 每个测试结束后自动清理测试数据
3. **Redis 连接**: 测试会自动跳过（如果 Redis 不可用）
