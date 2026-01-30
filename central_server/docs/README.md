# Central Server 文档中心

**版本**: v2.0  
**更新日期**: 2026-01-22

Central Server 包含 Lingua 系统的核心服务组件。

## 📦 核心组件

### 1. Scheduler（调度服务器）⭐

**位置**: `scheduler/`  
**文档**: [scheduler/docs/](scheduler/docs/)

**职责**:
- 节点注册和管理
- 任务分发和调度
- 会话生命周期管理
- 多实例协调

**必读文档**:
- [Scheduler架构](scheduler/docs/ARCHITECTURE.md)
- [Pool系统](scheduler/docs/POOL_ARCHITECTURE.md)
- [节点注册协议](scheduler/docs/NODE_REGISTRATION.md)
- [多实例部署](scheduler/docs/MULTI_INSTANCE_DEPLOYMENT.md)
- [Redis数据模型](scheduler/docs/REDIS_DATA_MODEL.md)

### 2. API Gateway（API网关）

**位置**: `api-gateway/`  
**文档**: [api_gateway/](api_gateway/)

**职责**:
- 公共API路由
- 认证和鉴权
- 速率限制
- 租户管理

**文档列表**:
- [Overview](api_gateway/OVERVIEW.md)
- [Public API设计](api_gateway/PUBLIC_API_DESIGN.md)
- [Public API规范](api_gateway/PUBLIC_API_SPEC.md)

### 3. Model Hub（模型中心）

**位置**: `model-hub/`  
**文档**: [model_hub/](model_hub/)

**职责**:
- 模型服务索引
- 模型元数据管理
- 服务发现

**文档**:
- [README](model_hub/README.md)

### 4. Model Manager（模型管理器）

**位置**: N/A（设计阶段）  
**文档**: [modelManager/](modelManager/)

**职责**:
- 公司模型库管理
- 客户端模型同步
- 模型版本控制

**文档**:
- [统一技术方案](modelManager/公司模型库与Electron客户端模型管理统一技术方案.md)

## 🚀 快速开始

### 启动Scheduler

```bash
# 1. 启动Redis
docker run -d -p 6379:6379 redis:7

# 2. 配置Scheduler
cd central_server/scheduler
cp config.toml.example config.toml

# 3. 启动Scheduler
cargo run --release
```

### 查看Dashboard

访问: http://localhost:5010/dashboard

### 启动API Gateway

```bash
cd central_server/api-gateway
cargo run --release
```

## 📖 文档导航

### 新手入门

1. [系统概览](OVERVIEW.md) - 了解Central Server整体架构
2. [快速开始](QUICK_START.md) - 快速启动指南
3. [Scheduler架构](scheduler/docs/ARCHITECTURE.md) - 核心组件架构

### 部署运维

1. [多实例部署](scheduler/docs/MULTI_INSTANCE_DEPLOYMENT.md) - 高可用部署
2. [迁移指南](MIGRATION.md) - 版本升级和迁移
3. [GPU需求说明](scheduler/docs/GPU_REQUIREMENT_EXPLANATION.md) - 硬件要求

### 开发集成

1. [Public API文档](api_gateway/) - 公共API接口
2. [节点注册协议](scheduler/docs/NODE_REGISTRATION.md) - 节点接入规范
3. [Redis数据模型](scheduler/docs/REDIS_DATA_MODEL.md) - 数据设计

## 🗂️ 目录结构

```
central_server/
├── scheduler/              # 调度服务器
│   ├── src/               # 源代码
│   │   ├── redis_runtime/ # Redis运行时（原phase2）
│   │   ├── pool_hashing.rs # Pool Hash（原phase3）
│   │   ├── node_registry/ # 节点注册
│   │   ├── pool/          # Pool管理
│   │   ├── websocket/     # WebSocket处理
│   │   └── ...
│   └── docs/              # 文档
│       ├── ARCHITECTURE.md
│       ├── POOL_ARCHITECTURE.md
│       ├── NODE_REGISTRATION.md
│       ├── MULTI_INSTANCE_DEPLOYMENT.md
│       └── REDIS_DATA_MODEL.md
│
├── api-gateway/           # API网关
│   └── src/
│
├── model-hub/             # 模型中心
│   └── src/
│
└── docs/                  # Central Server文档
    ├── README.md          # 本文档
    ├── OVERVIEW.md        # 系统概览
    ├── QUICK_START.md     # 快速开始
    ├── scheduler/         # Scheduler额外文档
    ├── api_gateway/       # API Gateway文档
    ├── model_hub/         # Model Hub文档
    └── project/           # 项目级文档
```

## 📊 项目信息

### 技术栈

- **语言**: Rust
- **异步运行时**: Tokio
- **Web框架**: Axum
- **数据存储**: Redis（单机/集群）
- **日志**: tracing
- **指标**: Prometheus

### 关键依赖

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
axum = "0.7"
redis = "0.25"
serde = { version = "1", features = ["derive"] }
tracing = "0.1"
```

## 🔗 外部链接

### 相关组件文档

- [Electron Node文档](../../electron_node/docs/) - 节点端文档
- [WebApp文档](../../webapp/docs/) - Web客户端文档
- [项目文档中心](../../docs/) - 项目级文档

### 项目资源

- [项目管理文档](../../docs/project_management/)
- [架构设计文档](../../docs/architecture/)
- [决策文档](../../docs/decision/)

## 💡 贡献指南

### 文档更新规范

1. **保持同步**: 代码变更后同步更新文档
2. **清晰简洁**: 每个文档不超过500行
3. **代码示例**: 提供实际可运行的代码
4. **交叉引用**: 正确链接相关文档

### 文档审核

- 技术准确性审核
- 与实际代码一致性检查
- 文档可读性评估

## 📞 联系方式

- **技术问题**: 查看对应模块的文档
- **Bug报告**: 提交Issue
- **功能建议**: 讨论并提交PR

---

**最后更新**: 2026-01-22  
**维护团队**: Central Server开发组
