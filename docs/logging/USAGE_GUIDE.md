# 日志系统使用指南

**版本**: v1.0  
**最后更新**: 2025-01-XX

---

## 概述

本文档介绍如何使用 LINGUA 日志系统，包括配置、使用和最佳实践。

---

## 1. 配置文件

### 1.1 配置文件位置

日志配置文件 `observability.json` 可以放在以下位置（按优先级）：
1. 项目根目录：`observability.json`
2. 配置目录：`config/observability.json`
3. 上级目录：`../observability.json`

如果配置文件不存在，系统将使用默认配置（info 级别）。

### 1.2 配置文件格式

```json
{
  "default_level": "info",
  "modules": {
    "lingua_scheduler::websocket": "debug",
    "lingua_scheduler::dispatcher": "info",
    "lingua_scheduler::node_registry": "warn",
    "lingua_node_inference::inference": "debug",
    "lingua_node_inference::http_server": "info"
  }
}
```

### 1.3 配置字段说明

- **`default_level`**: 默认日志级别（如果模块未指定）
  - 可选值：`trace`, `debug`, `info`, `warn`, `error`
  - 默认值：`info`

- **`modules`**: 模块级别的日志设置
  - key: 模块名称（如 `lingua_scheduler::websocket`）
  - value: 日志级别（如 `debug`, `info`, `warn`, `error`）

---

## 2. 环境变量

### 2.1 日志级别控制

**环境变量 `RUST_LOG`**（优先级最高）

如果设置了环境变量 `RUST_LOG`，它将完全覆盖配置文件中的设置。

示例：
```bash
# 设置所有模块为 info 级别
export RUST_LOG=info

# 设置特定模块为 debug 级别
export RUST_LOG=info,lingua_scheduler::websocket=debug

# 设置多个模块的不同级别
export RUST_LOG=info,lingua_scheduler::websocket=debug,lingua_scheduler::dispatcher=warn
```

### 2.2 日志格式控制

**环境变量 `LOG_FORMAT`**

控制日志输出格式：
- `json`（默认）：JSON 格式，适用于生产环境
- `pretty`：Pretty 格式，适用于开发调试

示例：
```bash
# 使用 JSON 格式（默认）
export LOG_FORMAT=json

# 使用 Pretty 格式（开发调试）
export LOG_FORMAT=pretty
```

### 2.3 日志级别优先级

日志级别的优先级（从高到低）：
1. **环境变量 `RUST_LOG`** - 如果设置了环境变量，将完全覆盖配置文件
2. **配置文件 `observability.json`** - 如果环境变量未设置，使用配置文件
3. **默认值** - 如果配置文件不存在，使用默认级别（info）

---

## 3. 使用示例

### 3.1 基本使用

在代码中使用日志：

```rust
use tracing::{info, debug, warn, error};

// 记录信息日志
info!("用户已登录: {}", user_id);

// 记录调试日志
debug!(trace_id = %trace_id, session_id = %session_id, "处理会话消息");

// 记录警告日志
warn!("节点资源使用率过高: {}%", cpu_percent);

// 记录错误日志
error!(error = ?err, "处理请求失败");
```

### 3.2 结构化日志

使用结构化字段：

```rust
info!(
    trace_id = %trace_id,
    session_id = %session_id,
    job_id = %job_id,
    utterance_index = utterance_index,
    "Job 已创建"
);
```

### 3.3 JSON 格式输出

当使用 JSON 格式时，日志输出如下：

```json
{
  "timestamp": "2025-01-XXT12:34:56.789Z",
  "level": "INFO",
  "fields": {
    "trace_id": "550e8400-e29b-41d4-a716-446655440000",
    "session_id": "session-123",
    "job_id": "job-456",
    "message": "Job 已创建"
  },
  "target": "lingua_scheduler::dispatcher"
}
```

---

## 4. 模块名称

### 4.1 Scheduler 模块

- `lingua_scheduler::websocket` - WebSocket 处理
- `lingua_scheduler::dispatcher` - Job 调度器
- `lingua_scheduler::node_registry` - 节点注册表
- `lingua_scheduler::session` - 会话管理
- `lingua_scheduler::result_queue` - 结果队列

### 4.2 Node Inference 模块

- `lingua_node_inference::inference` - 推理服务
- `lingua_node_inference::http_server` - HTTP 服务器
- `lingua_node_inference::asr` - ASR 引擎
- `lingua_node_inference::nmt` - NMT 引擎
- `lingua_node_inference::tts` - TTS 引擎

---

## 5. 最佳实践

### 5.1 日志级别选择

- **`trace`**: 非常详细的调试信息，通常只在开发时使用
- **`debug`**: 调试信息，用于开发和生产环境的故障排查
- **`info`**: 一般信息，记录关键业务流程
- **`warn`**: 警告信息，表示可能的问题但不影响功能
- **`error`**: 错误信息，表示发生了错误

### 5.2 结构化日志

尽量使用结构化字段而不是字符串拼接：

```rust
// ❌ 不推荐
info!("用户 {} 在会话 {} 中创建了 Job {}", user_id, session_id, job_id);

// ✅ 推荐
info!(
    user_id = %user_id,
    session_id = %session_id,
    job_id = %job_id,
    "用户创建了 Job"
);
```

### 5.3 trace_id 传播

确保在所有关键日志中包含 `trace_id`：

```rust
info!(
    trace_id = %trace_id,
    "处理请求"
);
```

### 5.4 敏感信息

不要在日志中记录敏感信息（如密码、令牌、完整音频数据等）。

---

## 6. 故障排查

### 6.1 日志不输出

1. 检查日志级别设置是否过高
2. 检查环境变量 `RUST_LOG` 是否覆盖了配置文件
3. 检查配置文件格式是否正确

### 6.2 日志过多

1. 提高默认日志级别（从 `debug` 改为 `info`）
2. 在配置文件中为特定模块设置更高的日志级别
3. 使用环境变量 `RUST_LOG` 临时调整

### 6.3 配置文件不生效

1. 检查配置文件路径是否正确
2. 检查 JSON 格式是否正确
3. 检查环境变量 `RUST_LOG` 是否覆盖了配置文件

---

## 7. 参考文档

- [实现状态](./IMPLEMENTATION_STATUS.md) - 详细的实现状态和测试结果
- [规范文档](./LINGUA_Logging_Observability_Spec_Consolidated_v3.1.md) - 完整的规范定义
- [开发就绪度评估](./DEVELOPMENT_READINESS.md) - 开发就绪度评估报告

---

**END OF GUIDE**

