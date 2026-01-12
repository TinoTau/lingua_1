# 模型管理与节点端服务包系统开发文档（平台化接口契约版）
Version: v1.1 (Platform-Ready)  
Date: 2025-12-17  
Scope: Model Hub（模型/服务包分发） + Node（服务包安装/运行）接口契约平台化；当前仅交付 Windows 产物，但契约需支持未来 Linux 集群扩展。

---

## 1. 目标与非目标

### 1.1 目标
1. **平台化契约**：Model Hub、服务包元数据、节点端运行描述均可表达多平台（windows-x64 / linux-x64 / …）。
2. **当前交付不变**：仍以 Windows 节点端为主，Python runtime 可随包内置，实现“开包即用”。
3. **未来可扩展**：未来引入 Linux 节点/集群时，不需要推翻接口与数据结构，仅新增平台产物与适配层实现。

### 1.2 非目标（本版本不做）
- Linux 节点端的完整实现与发行（仅做契约预留）。
- 服务包的增量更新（patch/delta）与内容寻址去重（CAS）。
- 用户系统/计费模块（已确认暂不做）。

---

## 2. 关键术语

- **Service**：一个可被节点运行的“推理服务”（如 NMT-ZH-EN）。
- **Service Package**：某 Service 的某版本、某平台的可部署产物（代码+模型+runtime+元数据）。
- **Platform**：产物适用平台标识（建议固定枚举），如 `windows-x64`, `linux-x64`。
- **Runtime**：服务运行所需解释器/二进制（本版本：Python runtime 随包内置；Rust 服务为平台二进制）。
- **Node**：执行推理任务的客户端（当前 Windows-only）。
- **Scheduler**：调度中心（只感知 service_id/version/health，不关心包细节）。

---

## 3. 平台标识规范

### 3.1 Platform 枚举（建议）
- `windows-x64`
- `linux-x64`（预留）
- `darwin-x64`（预留）
- `darwin-arm64`（预留）

### 3.2 兼容性约束
- 同一 `service_id + version` 允许存在多个 `platform` 产物。
- 节点端安装时必须选择与自身平台匹配的产物；不允许跨平台安装。

---

## 4. Model Hub API（平台化）

> 说明：本节为 Model Hub 对外契约。若未来加 API Gateway，此处 API 可作为内部接口继续保持。

### 4.1 列出服务（含多平台产物）
**GET** `/api/services`

Query（可选）：
- `platform`: 返回指定平台的产物（若不传则返回所有平台变体）
- `service_id`: 过滤单一服务
- `version`: 过滤版本

Response（示例）：
```json
{
  "services": [
    {
      "service_id": "nmt-zh-en",
      "name": "NMT ZH→EN",
      "latest_version": "1.2.0",
      "variants": [
        {
          "version": "1.2.0",
          "platform": "windows-x64",
          "artifact": {
            "type": "zip",
            "url": "/storage/services/nmt-zh-en/1.2.0/windows-x64/service.zip",
            "sha256": "…",
            "size_bytes": 1543219876,
            "etag": "…"
          },
          "signature": {
            "alg": "ed25519",
            "key_id": "company-key-2025-01",
            "value_b64": "…",
            "signed_payload": {
              "service_id": "nmt-zh-en",
              "version": "1.2.0",
              "platform": "windows-x64",
              "sha256": "…"
            }
          }
        }
      ]
    }
  ]
}
```

### 4.2 下载产物
**GET** `/storage/services/{service_id}/{version}/{platform}/service.zip`

支持：
- HTTP Range（断点续传）
- ETag / If-None-Match（避免重复下载）

### 4.3 获取单个产物元数据（可选）
**GET** `/api/services/{service_id}/{version}/{platform}`  
用于减少 `/api/services` 的 payload；可选实现。

---

## 5. 服务包文件结构（平台化约束）

### 5.1 通用结构（ZIP 根目录）
```
service-package.zip
├─ service.json
├─ app/                  # 服务代码（Python/Rust wrapper 等）
├─ models/               # 模型文件（ONNX 等）
├─ runtime/              # 运行时（可选，按平台）
├─ health/               # 健康检查脚本或配置（可选）
└─ README.md
```

### 5.2 Windows 产物约定（当前交付）
- Python 服务包必须包含 `runtime/python/`（embeddable/portable python）
- 启动使用：`runtime/python/python.exe`
- Rust 服务包包含 `runtime/bin/*.exe` 或 `app/*.exe`（二进制可执行）

### 5.3 Linux 产物预留（未来）
- Python 服务包可包含 `runtime/python/bin/python3`（或等价可移植 runtime）
- Rust 服务包包含 `runtime/bin/<binary>`（需 chmod +x）
- 依赖策略：不承诺携带 NVIDIA 驱动；如需 GPU，需提供前置检查与错误提示。

---

## 6. service.json（平台化契约核心）

> 要求：同一 `service.json` 可表达“多平台入口”，节点端根据自身 platform 选择对应的启动配置。

### 6.1 最小必填字段
- `service_id`（string）
- `version`（semver string）
- `platforms`（object：key=platform，value=PlatformConfig）
- `health_check`（HealthCheck）
- `env_schema`（object，可为空）

### 6.2 PlatformConfig 定义（建议）
```json
{
  "entrypoint": "app/main.py",
  "exec": {
    "type": "argv",
    "program": "runtime/python/python.exe",
    "args": ["app/main.py"],
    "cwd": "."
  },
  "default_port": 5101,
  "files": {
    "requires": ["service.json", "app/", "models/"],
    "optional": ["runtime/"]
  }
}
```

- `exec.type = "argv"`：避免 shell 差异，Node 使用 argv 直接启动进程。
- `program`/`args`：平台相关；Windows 为 `python.exe`，Linux 为 `python3` 等。
- `default_port`：默认端口，不可写死；实际端口由 Node 分配并注入 env。

### 6.3 HealthCheck 定义（建议）
```json
{
  "type": "http",
  "endpoint": "/health",
  "timeout_ms": 3000,
  "startup_grace_ms": 20000
}
```

### 6.4 env_schema（建议字段）
至少支持：
- `SERVICE_PORT`（int）
- `MODEL_PATH`（string）
- `LOG_LEVEL`（string，可选）

> 要求：服务代码必须从 env 读取端口，不允许写死。

---

## 7. 节点端（Node）架构：平台化适配层

当前代码中已存在：`PythonServiceManager`, `RustServiceManager`, IPC handlers。  
本版本要求新增一层：

### 7.1 核心组件
1. **ServiceRegistry**
   - 读取已安装服务包的 `service.json`
   - 维护 `installed.json`、`current.json`
2. **ServicePackageManager**
   - 下载、校验、解压、原子切换、回滚
3. **ServiceRuntimeManager**
   - 统一启动/停止服务进程（通过平台适配器）
4. **PlatformAdapter（关键）**
   - `getPlatformId(): Platform`
   - `spawn(argv, env, cwd)`
   - `makeExecutable(path)`（Linux 预留）
   - `acquireLock(key)`（跨平台文件锁）
   - `pathJoin(...)`（可选）

> 约束：所有平台差异逻辑只允许出现在 PlatformAdapter 内；禁止散落到各个 manager。

---

## 8. 节点端安装流程（原子 + 可回滚）

### 8.1 目录结构（建议）
```
services/
└─ <service_id>/
   ├─ installed.json        # 已安装版本列表与元数据（含 platform）
   ├─ current.json          # 当前激活版本指针（替代 symlink）
   ├─ versions/
   │  └─ <version>/<platform>/...
   └─ _staging/
```

### 8.2 安装步骤（必须）
1. 获取本机 platform（windows-x64）
2. 从 Model Hub 选择匹配的 variant（version + platform）
3. 下载 zip（断点续传）
4. 校验 SHA256（完整性）
5. 校验签名（可信性，Ed25519；Node 内置公钥）
6. 解压到 `_staging/<version>-<platform>-<rand>/`
7. 解析 `service.json`，校验平台配置存在
8. 进行基础启动前检查：文件存在性、端口可用、必要 env 可注入
9. 原子切换：rename staging → `versions/<version>/<platform>/`
10. 更新 `installed.json`
11. 如配置要求自动激活：更新 `current.json`
12. 清理 staging 与超旧版本（见 10.2）

### 8.3 失败与回滚
- 任一步骤失败：删除 staging，不影响现有 current。
- 若激活后健康检查失败：回滚到 previous（如果存在），并记录事件日志。

---

## 9. 服务启动/停止与健康检查

### 9.1 启动流程（统一入口）
1. 从 `current.json` 读取当前版本与平台路径
2. 读取 `service.json` → 选择 `platforms[platformId]`
3. Node 分配可用端口 `port = allocatePort(default_port)`
4. 注入 env：`SERVICE_PORT`, `MODEL_PATH`, `SERVICE_ID`, `SERVICE_VERSION`
5. PlatformAdapter.spawn(program, args, env, cwd)
6. 等待 health_check：
   - grace period 内轮询 `/health`
   - 超时则判定启动失败（可回滚）

### 9.2 停止流程
- 先发送优雅停止（若服务支持）
- 超时后强制 kill
- 回收端口与进程资源

### 9.3 多实例策略（当前简化）
- 同一 service_id 默认只运行 1 个实例。
- 未来如需多实例（Linux 集群），通过 `instance_id` 扩展，不改变 service.json 基本结构。

---

## 10. 版本与磁盘策略

### 10.1 版本保留（当前建议）
- 每个 `service_id` 保留：`current` + `previous`
- 新版本安装成功后，自动清理更旧版本（需确保不在运行中）。

### 10.2 安装前磁盘检查
- 预估至少 `zip_size_bytes * 2`（下载缓存 + 解压）
- 不足则拒绝安装，并给出提示（建议 UI 提示可清理旧版本）。

---

## 11. 发布签名与密钥管理（最小供应链闭环）

### 11.1 签名内容（强约束）
对以下 payload 进行签名：
- `service_id`
- `version`
- `platform`
- `sha256`

### 11.2 节点端验证
- Node 内置公司公钥列表（支持 key rotation：key_id）
- 校验通过才允许安装
- 校验失败记录安全事件日志（含 key_id、sha256、下载源 URL）

---

## 12. 与 Scheduler 的集成边界

Scheduler 只感知：
- `service_id`
- `version`
- `node_health`（节点上报服务状态）
- `capabilities`（可选：资源提示、语言对等）

Scheduler 不直接参与：
- zip 下载
- 安装与回滚
- runtime 细节

Node 上报建议字段：
- `service_id`, `version`, `platform`, `state`, `port`, `started_at`
- `resources_hint`（从 service.json 透传，可选）

---

## 13. 兼容性与迁移

### 13.1 与旧 “models API” 的兼容
- 保留 `/api/models`（旧下载方式）
- 新增 `/api/services`（服务包方式）
- Node 端可同时支持两套来源（过渡期）；但运行侧推荐只走服务包。

### 13.2 节点端代码改造最小清单
1. 新增 `ServicePackageManager`（下载/校验/staging/切换）
2. 新增 `PlatformAdapter`（Windows 实现 + Linux stub）
3. `PythonServiceManager` / `RustServiceManager` 改为读取 `service.json` 平台配置启动（去除脚本硬编码路径）
4. IPC handlers 增加：
   - installService(service_id, version?)
   - activateService(service_id, version)
   - rollbackService(service_id)
   - listInstalledServices()
   - getServiceStatus()

---

## 14. MVP 交付标准（平台化但仅 Windows 可用）

必须完成：
- Model Hub：services 列表支持 platform 变体；下载路径包含 platform
- Node：安装/校验（sha256 + signature）/原子切换/回滚
- Node：service.json 支持 platforms 结构；Windows 配置可跑通
- Node：PlatformAdapter 抽象到位（Linux 先返回 NotSupported）
- 日志：安装/升级/回滚/验证失败都可追踪

---

## 15. 开发验收用例（建议）

1. **安装成功**：安装 `nmt-zh-en@1.2.0 windows-x64`，启动通过 health。
2. **重复安装**：重复安装同版本，命中缓存或跳过，结果一致。
3. **签名失败**：篡改 zip，sha256 或签名失败 → 拒绝安装。
4. **启动失败回滚**：安装新版本后 health 失败 → 自动回滚 previous。
5. **磁盘不足**：模拟不足空间 → 拒绝安装并提示清理建议。
6. **并发安装锁**：同时触发两次安装 → 一个等待/失败，目录不损坏。

---

（END）
