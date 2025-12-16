# 中央服务器

中央服务器包含调度服务器、API 网关和模型库服务。

## 目录结构

```
central_server/
├── scheduler/          # 调度服务器
├── api-gateway/       # API 网关
├── model-hub/         # 模型库服务
└── docs/              # 文档
```

## 调度服务器 (Scheduler)

**技术栈**: Rust + Tokio + Axum

**功能**:
- 会话生命周期管理
- 任务分发与负载均衡
- 节点注册与心跳监控
- Utterance Group 管理

**启动**:
```bash
cd scheduler
cargo build --release
cargo run --release
```

## API 网关 (API Gateway)

**技术栈**: Rust + Tokio + Axum

**功能**:
- 提供对外 REST API 和 WebSocket API
- API Key 鉴权
- 租户管理
- 请求限流

**启动**:
```bash
cd api-gateway
cargo build --release
cargo run --release
```

## 模型库服务 (Model Hub)

**技术栈**: Python + FastAPI

**功能**:
- ✅ 模型元数据管理（列表查询、详情查询、版本管理）
- ✅ 模型文件下载（支持断点续传）
- ✅ 模型统计（热门模型排行）
- ✅ 路径安全（防止路径遍历攻击）
- ✅ 文件校验（SHA256 校验和）

**API 端点**:
- `GET /api/models` - 获取模型列表
- `GET /api/models/{model_id}` - 获取单个模型信息
- `GET /storage/models/{model_id}/{version}/{file_path}` - 下载模型文件（支持 Range 请求）
- `GET /api/model-usage/ranking` - 获取热门模型排行榜

**启动**:
```bash
# 使用启动脚本（推荐）
.\scripts\start_model_hub.ps1

# 手动启动
cd central_server/model-hub
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python src/main.py
```

**服务地址**: `http://localhost:5000`  
**API 文档**: `http://localhost:5000/docs`

详细文档请参考 `model-hub/README.md`。

## 测试

### Scheduler 测试

```bash
cd scheduler
cargo test                    # 运行所有测试
cargo test --test stage1_1   # 运行阶段 1.1 测试
cargo test --test stage3_2   # 运行阶段 3.2 测试
```

**测试策略**：在测试 central_server 时，默认节点已经启动了 GPU（在测试中模拟），但不需要真的启动 GPU 或节点端服务。详细说明请参考 `scheduler/TEST_STRATEGY.md`。

详细测试指南请参考 `TEST_GUIDE.md`。

### 测试覆盖

- ✅ Scheduler: 完整的单元测试覆盖
  - ✅ 阶段 1.1: 63 个测试全部通过
  - ✅ 阶段 1.2: 7 个测试全部通过
  - ✅ 阶段 2.1.2: 12 个测试全部通过
  - ✅ 阶段 3.2: 6 个测试（`test_select_node_with_models_ready` 已通过，其他测试待确认）
  - ✅ 其他测试: 24 个测试全部通过
- ⚠️ API Gateway: 无单元测试（建议添加）
- ⚠️ Model Hub: 无单元测试（建议添加）

**注意**: 阶段 3.2 的测试已修复，`test_select_node_with_models_ready` 已通过。详细修复说明请参考 `scheduler/TEST_FIXES_COMPLETE.md`。

## 文档

详细文档请参考 `docs/` 目录。

### 快速参考

- **项目完整性**: `PROJECT_COMPLETENESS.md`
- **测试指南**: `TEST_GUIDE.md`
- **文档索引**: `docs/README.md`
- **迁移文档**: `docs/MIGRATION.md` - 迁移内容和路径调整说明
