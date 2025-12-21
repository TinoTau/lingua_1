# Scheduler 多实例部署指南

本文档说明如何在云平台上部署多个 Scheduler 实例，实现高可用和横向扩展。

## 前置要求

### 1. Redis 服务
- **必须**：部署 Redis（单机或 Cluster 模式）
- **推荐配置**：
  - 单机模式：至少 2GB 内存，启用持久化（AOF 或 RDB）
  - Cluster 模式：至少 3 个 master 节点（生产环境推荐）
  - 网络延迟：Scheduler 实例到 Redis 的延迟 < 10ms（同区域）

### 2. 服务器资源
- 每台服务器至少：
  - CPU: 2 核
  - 内存: 2GB
  - 网络: 100Mbps
- 操作系统：Linux（推荐）或 Windows Server

### 3. 网络配置
- 所有 Scheduler 实例需要能够：
  - 访问 Redis 服务
  - 访问 Model Hub（如果使用）
  - 被 Node 和 Session 客户端访问（WebSocket 连接）
- 建议使用负载均衡器（如 Nginx、云平台 LB）统一入口

## 配置步骤

### 步骤 1：准备配置文件

为每个实例创建独立的配置文件。假设有 3 台服务器：
- `scheduler-1` (IP: 10.0.1.10, Port: 5010)
- `scheduler-2` (IP: 10.0.1.11, Port: 5010)
- `scheduler-3` (IP: 10.0.1.12, Port: 5010)

#### 实例 1 配置 (`config-scheduler-1.toml`)

```toml
[server]
port = 5010
host = "0.0.0.0"

[model_hub]
base_url = "http://your-model-hub:5000"
storage_path = "./models"

[scheduler]
max_concurrent_jobs_per_node = 4
job_timeout_seconds = 30
heartbeat_interval_seconds = 15

[scheduler.phase2]
# 启用 Phase 2 多实例支持
enabled = true
# 重要：每个实例必须使用唯一的 instance_id
instance_id = "scheduler-1"
owner_ttl_seconds = 45
stream_block_ms = 1000
stream_count = 64
stream_group = "scheduler"
stream_maxlen = 10000

# DLQ 配置
dlq_enabled = true
dlq_maxlen = 10000
dlq_max_deliveries = 10
dlq_min_idle_ms = 60000
dlq_scan_interval_ms = 5000
dlq_scan_count = 100

[scheduler.phase2.redis]
# Redis 模式：single（单机）或 cluster（集群）
mode = "single"
# 单机模式 Redis URL
url = "redis://your-redis-host:6379"
# 如果是 Cluster 模式，使用 cluster_urls：
# mode = "cluster"
# cluster_urls = ["redis://redis-1:7000", "redis://redis-2:7001", "redis://redis-3:7002"]
# key 前缀（用于多环境隔离，如：lingua-prod, lingua-staging）
key_prefix = "lingua-prod"

[scheduler.phase2.node_snapshot]
# 启用节点快照同步（使所有实例拥有全量节点视图）
enabled = true
presence_ttl_seconds = 45
refresh_interval_ms = 2000
remove_stale_after_seconds = 600
```

#### 实例 2 配置 (`config-scheduler-2.toml`)

```toml
[server]
port = 5010
host = "0.0.0.0"

[model_hub]
base_url = "http://your-model-hub:5000"
storage_path = "./models"

[scheduler]
max_concurrent_jobs_per_node = 4
job_timeout_seconds = 30
heartbeat_interval_seconds = 15

[scheduler.phase2]
enabled = true
# 重要：使用不同的 instance_id
instance_id = "scheduler-2"
owner_ttl_seconds = 45
stream_block_ms = 1000
stream_count = 64
stream_group = "scheduler"
stream_maxlen = 10000

dlq_enabled = true
dlq_maxlen = 10000
dlq_max_deliveries = 10
dlq_min_idle_ms = 60000
dlq_scan_interval_ms = 5000
dlq_scan_count = 100

[scheduler.phase2.redis]
mode = "single"
url = "redis://your-redis-host:6379"
key_prefix = "lingua-prod"

[scheduler.phase2.node_snapshot]
enabled = true
presence_ttl_seconds = 45
refresh_interval_ms = 2000
remove_stale_after_seconds = 600
```

#### 实例 3 配置 (`config-scheduler-3.toml`)

类似实例 2，但 `instance_id = "scheduler-3"`

### 步骤 2：部署到服务器

#### 方式 A：使用 systemd（Linux）

在每台服务器上创建 systemd 服务文件：

`/etc/systemd/system/lingua-scheduler.service`

```ini
[Unit]
Description=Lingua Scheduler Service
After=network.target

[Service]
Type=simple
User=lingua
WorkingDirectory=/opt/lingua/scheduler
Environment="RUST_LOG=info"
Environment="LOG_FORMAT=json"
ExecStart=/opt/lingua/scheduler/target/release/scheduler
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

启动服务：
```bash
# 复制配置文件
cp config-scheduler-1.toml /opt/lingua/scheduler/config.toml

# 启动服务
sudo systemctl enable lingua-scheduler
sudo systemctl start lingua-scheduler

# 查看状态
sudo systemctl status lingua-scheduler
sudo journalctl -u lingua-scheduler -f
```

#### 方式 B：使用 Docker

创建 `Dockerfile`：

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/scheduler /app/scheduler
COPY config.toml /app/config.toml
EXPOSE 5010
CMD ["/app/scheduler"]
```

构建和运行：
```bash
# 构建镜像
docker build -t lingua-scheduler:latest .

# 运行实例 1
docker run -d \
  --name scheduler-1 \
  -p 5010:5010 \
  -v $(pwd)/config-scheduler-1.toml:/app/config.toml \
  lingua-scheduler:latest

# 运行实例 2
docker run -d \
  --name scheduler-2 \
  -p 5010:5010 \
  -v $(pwd)/config-scheduler-2.toml:/app/config.toml \
  lingua-scheduler:latest
```

#### 方式 C：使用 Kubernetes

创建 `deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: scheduler
spec:
  replicas: 3
  selector:
    matchLabels:
      app: scheduler
  template:
    metadata:
      labels:
        app: scheduler
    spec:
      containers:
      - name: scheduler
        image: lingua-scheduler:latest
        ports:
        - containerPort: 5010
        env:
        - name: INSTANCE_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        volumeMounts:
        - name: config
          mountPath: /app/config.toml
          subPath: config.toml
      volumes:
      - name: config
        configMap:
          name: scheduler-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: scheduler-config
data:
  config.toml: |
    [server]
    port = 5010
    host = "0.0.0.0"
    
    [scheduler.phase2]
    enabled = true
    instance_id = "${INSTANCE_ID}"
    # ... 其他配置
```

### 步骤 3：配置负载均衡器

使用 Nginx 作为负载均衡器示例：

```nginx
upstream scheduler_backend {
    # 使用 IP Hash 保持会话粘性（可选）
    ip_hash;
    server 10.0.1.10:5010;
    server 10.0.1.11:5010;
    server 10.0.1.12:5010;
}

server {
    listen 80;
    server_name scheduler.example.com;

    # WebSocket 升级
    location /ws/ {
        proxy_pass http://scheduler_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # HTTP API
    location / {
        proxy_pass http://scheduler_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**注意**：WebSocket 连接建议使用 IP Hash 或会话粘性，但 Phase 2 已支持跨实例投递，所以不是必须的。

## 监控和监管

### 1. Prometheus 指标

每个实例暴露 Prometheus 指标端点：`http://<instance-ip>:5010/metrics`

关键指标：

#### Phase 2 相关指标
- `scheduler_phase2_redis_op_total{op,result}` - Redis 操作计数
- `scheduler_phase2_inbox_pending` - Inbox pending 消息数
- `scheduler_phase2_dlq_moved_total` - DLQ 搬运计数
- `scheduler_phase2_presence_heartbeat_total` - Presence 心跳计数

#### 调度相关指标
- `scheduler_jobs_total{status}` - 任务总数（按状态）
- `scheduler_nodes_total{status}` - 节点总数（按状态）
- `scheduler_sessions_total` - 会话总数

#### 性能指标
- `scheduler_node_selection_duration_seconds` - 节点选择耗时
- `scheduler_redis_op_duration_seconds{op}` - Redis 操作耗时

### 2. 健康检查

每个实例提供健康检查端点：
- `GET /health` - 基本健康检查
- `GET /metrics` - Prometheus 指标

### 3. Redis 监控

#### 检查实例 Presence

```bash
# 查看所有活跃的 Scheduler 实例
redis-cli KEYS "lingua-prod:schedulers:presence:*"

# 查看特定实例的 presence
redis-cli GET "lingua-prod:schedulers:presence:scheduler-1"
```

#### 检查 Streams 状态

```bash
# 查看实例 1 的 inbox stream 信息
redis-cli XINFO STREAM "lingua-prod:streams:{instance:scheduler-1}:inbox"

# 查看 consumer group 信息
redis-cli XINFO GROUPS "lingua-prod:streams:{instance:scheduler-1}:inbox"

# 查看 pending 消息
redis-cli XPENDING "lingua-prod:streams:{instance:scheduler-1}:inbox" scheduler

# 查看 DLQ
redis-cli XLEN "lingua-prod:streams:{instance:scheduler-1}:dlq"
```

#### 检查节点快照

```bash
# 查看所有节点 ID
redis-cli SMEMBERS "lingua-prod:v1:nodes:all"

# 查看节点快照
redis-cli GET "lingua-prod:v1:nodes:snapshot:<node_id>"
```

### 4. 日志监控

每个实例的日志位置：
- 文件日志：`logs/scheduler.log`（轮转，5MB/文件，保留 5 个）
- 系统日志：`journalctl -u lingua-scheduler`（systemd）

关键日志事件：
- 实例启动：`Phase2 已启用`（包含 instance_id）
- Redis 连接：`Redis connected`
- 跨实例投递：`Enqueued to instance inbox`
- 错误：`ERROR` 级别日志

### 5. Dashboard

访问每个实例的 Dashboard：
- `http://<instance-ip>:5010/dashboard` - HTML Dashboard
- `http://<instance-ip>:5010/api/v1/stats` - JSON 统计 API

## 常见问题排查

### 问题 1：实例无法连接到 Redis

**症状**：日志中出现 Redis 连接错误

**排查**：
1. 检查 Redis 服务是否运行：`redis-cli ping`
2. 检查网络连通性：`telnet <redis-host> <redis-port>`
3. 检查 Redis 配置中的 URL 是否正确
4. 检查防火墙规则

### 问题 2：跨实例消息投递失败

**症状**：Node 连接在实例 A，Session 连接在实例 B，任务无法完成

**排查**：
1. 检查两个实例的 Phase 2 是否都启用：`enabled = true`
2. 检查 instance_id 是否唯一
3. 检查 Redis Streams inbox：
   ```bash
   redis-cli XINFO STREAM "lingua-prod:streams:{instance:scheduler-1}:inbox"
   ```
4. 检查 pending 消息：
   ```bash
   redis-cli XPENDING "lingua-prod:streams:{instance:scheduler-1}:inbox" scheduler
   ```
5. 查看 Prometheus 指标：`scheduler_phase2_redis_op_total{op="xreadgroup",result="err"}`

### 问题 3：Pending 消息持续增长

**症状**：`scheduler_phase2_inbox_pending` 指标持续上升

**排查**：
1. 检查目标实例是否存活：
   ```bash
   redis-cli GET "lingua-prod:schedulers:presence:<instance_id>"
   ```
2. 检查目标 node/session 是否在线
3. 查看 DLQ 是否有消息：
   ```bash
   redis-cli XLEN "lingua-prod:streams:{instance:<instance_id>}:dlq"
   ```
4. 检查 `XAUTOCLAIM` 是否正常工作（查看日志）

### 问题 4：节点快照不同步

**症状**：不同实例看到的节点列表不一致

**排查**：
1. 确认 `node_snapshot.enabled = true`
2. 检查刷新间隔：`refresh_interval_ms = 2000`
3. 检查 Redis 中的节点快照：
   ```bash
   redis-cli SMEMBERS "lingua-prod:v1:nodes:all"
   ```
4. 查看实例日志中的快照刷新信息

### 问题 5：实例频繁重启导致连接丢失

**症状**：实例重启后，Node/Session 连接断开

**解决方案**：
1. 使用健康检查和自动重启（systemd/K8s）
2. 配置合理的 `owner_ttl_seconds`（建议 45 秒）
3. 客户端实现自动重连机制
4. 使用负载均衡器的健康检查

## 最佳实践

### 1. 实例数量规划
- **最小**：2 个实例（高可用）
- **推荐**：3-5 个实例（负载均衡 + 容错）
- **最大**：根据实际负载，建议不超过 10 个实例

### 2. Redis 配置
- **生产环境**：使用 Redis Cluster（3+ master）
- **开发/测试**：单机 Redis 足够
- **内存**：至少为 `(实例数 × 100MB) + 节点数 × 10KB`

### 3. 监控告警
建议设置以下告警：
- Redis 连接失败
- Pending 消息数 > 1000
- DLQ 消息数 > 100
- 实例 Presence 丢失（超过 1 分钟）
- 节点选择失败率 > 5%

### 4. 部署流程
1. **灰度发布**：先部署 1 个实例，验证正常后逐步增加
2. **配置验证**：确保每个实例的 `instance_id` 唯一
3. **连接测试**：测试跨实例的 Node/Session 连接
4. **监控观察**：部署后观察 30 分钟，确认指标正常

### 5. 备份和恢复
- Redis 数据：定期备份（AOF 或 RDB）
- 配置文件：版本控制（Git）
- 日志：集中收集（ELK、Loki 等）

## 验证清单

部署完成后，请验证以下项目：

- [ ] 所有实例的 Phase 2 已启用（`enabled = true`）
- [ ] 每个实例的 `instance_id` 唯一
- [ ] 所有实例能连接到 Redis
- [ ] Redis 中能看到所有实例的 presence key
- [ ] 节点连接到一个实例，会话连接到另一个实例，任务能正常完成
- [ ] Prometheus 指标正常采集
- [ ] 日志正常输出
- [ ] 负载均衡器配置正确
- [ ] 健康检查端点正常响应

## 参考文档

- [Phase 2 实现文档](./phase2_implementation.md)
- [Phase 2 Streams 运维指引](./phase2_streams_ops.md)
- [配置示例](../config.toml)

