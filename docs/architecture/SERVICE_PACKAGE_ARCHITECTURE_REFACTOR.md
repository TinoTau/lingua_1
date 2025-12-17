# Model Hub 服务包架构改造方案

**文档版本**: v1.0  
**创建日期**: 2025-12-17  
**状态**: 📋 待决策部门审阅  
**作者**: 技术团队

---

## 📋 执行摘要

本文档描述了将 Model Hub 从**模型文件下载**模式改造为**服务包下载**模式的完整方案。改造后，Model Hub 将提供打包好的服务（代码+模型），节点端下载后可直接使用，简化部署和维护流程。

### 核心变更

- **当前模式**: Model Hub 提供单独的模型文件，节点端需要单独管理模型文件和服务代码
- **改造后模式**: Model Hub 提供完整的服务包（代码+模型），节点端下载后解压即可使用

### 业务价值

1. **简化部署**: 节点端无需分别管理模型文件和服务代码
2. **版本一致性**: 服务代码和模型版本绑定，确保兼容性
3. **降低维护成本**: 统一的版本管理，减少版本不匹配问题
4. **提升可靠性**: 公司提供稳定版本，减少节点端配置错误

---

## 1. 当前架构分析

### 1.1 当前架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Model Hub (端口 5000)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  API 端点:                                            │  │
│  │  - GET /api/models              (模型列表)            │  │
│  │  - GET /api/models/{id}         (模型详情)            │  │
│  │  - GET /storage/models/{...}    (文件下载)            │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  存储结构:                                            │  │
│  │  /storage/models/                                     │  │
│  │    ├── whisper-base/                                  │  │
│  │    │   └── 1.0.0/                                     │  │
│  │    │       ├── ggml-base.bin                          │  │
│  │    │       ├── config.json                            │  │
│  │    │       └── tokenizer.json                         │  │
│  │    └── m2m100-en-zh/                                  │  │
│  │        └── 1.0.0/                                     │  │
│  │            └── model.onnx                             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTP 下载
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Electron Node (节点端)                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ModelManager                                        │  │
│  │  - 下载模型文件到 userData/models/                   │  │
│  │  - 管理 registry.json                               │  │
│  │  - 验证文件完整性                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Services (服务代码)                                  │  │
│  │  - services/nmt_m2m100/     (Python 服务)            │  │
│  │  - services/piper_tts/      (Python 服务)            │  │
│  │  - services/node-inference/ (Rust 服务)              │  │
│  │  - services/your_tts/        (Python 服务)           │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  模型文件存储 (userData/models/)                      │  │
│  │  - whisper-base/1.0.0/                               │  │
│  │  - m2m100-en-zh/1.0.0/                               │  │
│  │  - registry.json                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 当前架构的问题

#### 问题 1: 模型与服务代码分离
- **现状**: 模型文件存储在 `userData/models/`，服务代码在 `services/` 目录
- **问题**: 
  - 节点端需要分别管理模型文件和服务代码
  - 模型版本与服务代码版本可能不匹配
  - 部署时需要确保模型路径配置正确

#### 问题 2: 模型路径配置复杂
- **现状**: 不同服务从不同路径加载模型
  - Rust 服务: `MODELS_DIR` 环境变量（默认 `./models`）
  - Python 服务: HuggingFace 缓存或指定路径
- **问题**: 
  - 配置分散，容易出错
  - 模型路径不一致导致服务无法找到模型

#### 问题 3: 版本管理困难
- **现状**: 模型版本和服务版本独立管理
- **问题**: 
  - 无法保证模型版本与服务代码的兼容性
  - 升级时需要同时更新模型和服务代码
  - 回滚操作复杂

#### 问题 4: 已安装模型列表不准确
- **现状**: `ModelManager.getInstalledModels()` 从 `registry.json` 读取
- **问题**: 
  - 实际服务使用的模型可能不在 registry 中
  - 服务目录中的模型无法被正确识别

---

## 2. 改造方案

### 2.1 新架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Model Hub (端口 5000)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  新增 API 端点:                                       │  │
│  │  - GET /api/services              (服务列表)          │  │
│  │  - GET /api/services/{id}         (服务详情)          │  │
│  │  - GET /storage/services/{id}/{version}.zip           │  │
│  │                                    (服务包下载)        │  │
│  │  保留 API 端点 (向后兼容):                            │  │
│  │  - GET /api/models                (模型列表)           │  │
│  │  - GET /storage/models/{...}      (文件下载)           │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  存储结构:                                            │  │
│  │  /storage/services/                                  │  │
│  │    ├── nmt-m2m100/                                   │  │
│  │    │   ├── 1.0.0.zip                                 │  │
│  │    │   ├── 1.1.0.zip                                 │  │
│  │    │   └── latest.zip -> 1.1.0.zip                   │  │
│  │    ├── piper-tts/                                    │  │
│  │    │   └── 1.0.0.zip                                 │  │
│  │    ├── node-inference/                               │  │
│  │    │   └── 1.0.0.zip                                 │  │
│  │    └── your-tts/                                      │  │
│  │        └── 1.0.0.zip                                 │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTP 下载服务包
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Electron Node (节点端)                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ServicePackageManager (新增)                        │  │
│  │  - 下载服务包到临时目录                               │  │
│  │  - 验证服务包完整性                                   │  │
│  │  - 解压到 services/{service-name}/                   │  │
│  │  - 管理服务版本                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Services (服务代码 + 模型)                          │  │
│  │  - services/nmt-m2m100/1.0.0/                       │  │
│  │  │   ├── nmt_service.py                              │  │
│  │  │   ├── requirements.txt                            │  │
│  │  │   └── models/                                     │  │
│  │  │       └── m2m100-en-zh/                           │  │
│  │  ├── services/piper-tts/1.0.0/                       │  │
│  │  ├── services/node-inference/1.0.0/                  │  │
│  │  └── services/your-tts/1.0.0/                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 服务包结构规范

每个服务包是一个 ZIP 压缩文件，包含完整的服务代码和模型文件。

#### 服务包目录结构

```
{service-name}-{version}.zip
├── service.json                    # 服务元数据
├── README.md                       # 服务说明文档
├── requirements.txt                # Python 依赖（如适用）
├── {service_code}.py              # 服务主代码（Python 服务）
├── {service_code}.rs              # 服务主代码（Rust 服务，如适用）
├── models/                         # 模型文件目录
│   ├── asr/                        # ASR 模型（如适用）
│   │   └── whisper-base/
│   │       ├── ggml-base.bin
│   │       └── config.json
│   ├── nmt/                        # NMT 模型（如适用）
│   │   └── m2m100-en-zh/
│   │       └── model.onnx
│   └── tts/                        # TTS 模型（如适用）
│       └── vits-zh/
│           └── model.onnx
└── checksum.sha256                 # 服务包 SHA256 校验和
```

#### service.json 元数据格式

```json
{
  "service_id": "nmt-m2m100",
  "service_name": "M2M100 NMT Service",
  "version": "1.0.0",
  "service_type": "python",
  "port": 5008,
  "description": "M2M100 机器翻译服务",
  "models": [
    {
      "model_id": "m2m100-en-zh",
      "model_type": "nmt",
      "version": "1.0.0",
      "path": "models/nmt/m2m100-en-zh"
    }
  ],
  "dependencies": {
    "python": ">=3.10",
    "cuda": "optional"
  },
  "startup_command": "python nmt_service.py",
  "health_check": {
    "endpoint": "/health",
    "method": "GET"
  },
  "created_at": "2025-12-17T00:00:00Z",
  "sha256": "abc123..."
}
```

### 2.3 Model Hub API 扩展

#### 新增 API 端点

##### 1. 获取服务列表
```
GET /api/services
```

**响应示例**:
```json
[
  {
    "service_id": "nmt-m2m100",
    "service_name": "M2M100 NMT Service",
    "service_type": "python",
    "latest_version": "1.1.0",
    "versions": [
      {
        "version": "1.1.0",
        "size_bytes": 1048576000,
        "created_at": "2025-12-17T00:00:00Z",
        "stable": true
      },
      {
        "version": "1.0.0",
        "size_bytes": 1048576000,
        "created_at": "2025-12-10T00:00:00Z",
        "stable": true
      }
    ]
  }
]
```

##### 2. 获取服务详情
```
GET /api/services/{service_id}
```

**响应示例**:
```json
{
  "service_id": "nmt-m2m100",
  "service_name": "M2M100 NMT Service",
  "service_type": "python",
  "port": 5008,
  "description": "M2M100 机器翻译服务",
  "versions": [
    {
      "version": "1.1.0",
      "size_bytes": 1048576000,
      "sha256": "abc123...",
      "models": [
        {
          "model_id": "m2m100-en-zh",
          "model_type": "nmt",
          "version": "1.0.0"
        }
      ],
      "created_at": "2025-12-17T00:00:00Z",
      "stable": true
    }
  ]
}
```

##### 3. 下载服务包
```
GET /storage/services/{service_id}/{version}.zip
```

**支持特性**:
- HTTP Range 请求（断点续传）
- 返回 `Content-Type: application/zip`
- 返回 `Content-Disposition: attachment; filename="{service_id}-{version}.zip"`

##### 4. 获取服务包校验和
```
GET /api/services/{service_id}/{version}/checksum
```

**响应示例**:
```json
{
  "service_id": "nmt-m2m100",
  "version": "1.0.0",
  "sha256": "abc123...",
  "size_bytes": 1048576000
}
```

### 2.4 节点端改造

#### 2.4.1 新增 ServicePackageManager

**职责**:
- 从 Model Hub 下载服务包
- 验证服务包完整性（SHA256）
- 解压服务包到 `services/{service-name}/{version}/`
- 管理服务版本
- 提供已安装服务列表

**接口设计**:
```typescript
class ServicePackageManager {
  // 获取可用服务列表
  async getAvailableServices(): Promise<ServiceInfo[]>
  
  // 下载并安装服务包
  async installService(serviceId: string, version?: string): Promise<void>
  
  // 卸载服务
  async uninstallService(serviceId: string, version?: string): Promise<boolean>
  
  // 获取已安装服务列表
  getInstalledServices(): InstalledService[]
  
  // 获取服务路径
  getServicePath(serviceId: string, version?: string): string | null
}
```

#### 2.4.2 服务目录结构

```
electron_node/services/
├── nmt-m2m100/
│   ├── 1.0.0/                    # 版本目录
│   │   ├── service.json
│   │   ├── nmt_service.py
│   │   ├── requirements.txt
│   │   └── models/
│   │       └── m2m100-en-zh/
│   ├── 1.1.0/                    # 新版本
│   │   └── ...
│   └── current -> 1.1.0/        # 符号链接指向当前版本
├── piper-tts/
│   └── 1.0.0/
│       └── ...
└── node-inference/
    └── 1.0.0/
        └── ...
```

#### 2.4.3 服务启动适配

**Python 服务启动**:
```typescript
// 从版本目录启动服务
const servicePath = servicePackageManager.getServicePath('nmt-m2m100', '1.0.0');
const serviceDir = path.join(servicePath, 'nmt-m2m100', '1.0.0');
const serviceScript = path.join(serviceDir, 'nmt_service.py');
```

**Rust 服务启动**:
```typescript
// 从版本目录启动服务
const servicePath = servicePackageManager.getServicePath('node-inference', '1.0.0');
const serviceDir = path.join(servicePath, 'node-inference', '1.0.0');
const modelsDir = path.join(serviceDir, 'models');
// 设置 MODELS_DIR 环境变量
process.env.MODELS_DIR = modelsDir;
```

---

## 3. 实施步骤

### 阶段 1: Model Hub 改造 (2-3 周)

#### 1.1 服务包存储结构
- [ ] 创建 `/storage/services/` 目录结构
- [ ] 实现服务包上传工具
- [ ] 实现服务包版本管理

#### 1.2 API 扩展
- [ ] 实现 `GET /api/services` 端点
- [ ] 实现 `GET /api/services/{id}` 端点
- [ ] 实现 `GET /storage/services/{id}/{version}.zip` 端点
- [ ] 实现 `GET /api/services/{id}/{version}/checksum` 端点
- [ ] 添加 API 文档

#### 1.3 服务包打包工具
- [ ] 开发服务包打包脚本
- [ ] 实现 `service.json` 自动生成
- [ ] 实现 SHA256 校验和计算
- [ ] 编写打包文档

### 阶段 2: 节点端改造 (2-3 周)

#### 2.1 ServicePackageManager 实现
- [ ] 实现服务包下载功能
- [ ] 实现服务包验证（SHA256）
- [ ] 实现服务包解压
- [ ] 实现服务版本管理
- [ ] 实现已安装服务列表

#### 2.2 UI 改造
- [ ] 更新模型管理界面，改为"服务管理"
- [ ] 显示服务列表（替代模型列表）
- [ ] 显示服务版本信息
- [ ] 实现服务安装/卸载功能
- [ ] 显示服务包下载进度

#### 2.3 服务启动适配
- [ ] 修改 PythonServiceManager，从版本目录启动
- [ ] 修改 RustServiceManager，从版本目录启动
- [ ] 更新环境变量配置
- [ ] 测试服务启动流程

### 阶段 3: 第一批服务打包 (1-2 周)

#### 3.1 服务打包
- [ ] 打包 `nmt-m2m100` 服务（基于 `services/nmt_m2m100/`）
- [ ] 打包 `piper-tts` 服务（基于 `services/piper_tts/`）
- [ ] 打包 `node-inference` 服务（基于 `services/node-inference/`）
- [ ] 打包 `your-tts` 服务（基于 `services/your_tts/`）

#### 3.2 测试验证
- [ ] 测试服务包下载
- [ ] 测试服务包安装
- [ ] 测试服务启动
- [ ] 测试服务功能
- [ ] 测试服务卸载

### 阶段 4: 向后兼容和迁移 (1 周)

#### 4.1 向后兼容
- [ ] 保留原有模型下载 API（标记为 deprecated）
- [ ] 实现模型到服务的映射
- [ ] 提供迁移工具

#### 4.2 文档更新
- [ ] 更新架构文档
- [ ] 更新 API 文档
- [ ] 更新部署文档
- [ ] 编写迁移指南

---

## 4. 技术细节

### 4.1 服务包格式

**压缩格式**: ZIP（跨平台兼容）  
**压缩级别**: 标准（平衡压缩率和速度）  
**文件结构**: 扁平化，避免深层嵌套

### 4.2 版本管理策略

- **版本号格式**: 语义化版本（SemVer）: `MAJOR.MINOR.PATCH`
- **稳定版本**: 由公司标记为 `stable: true`
- **最新版本**: 提供 `latest` 符号链接
- **版本兼容性**: 同一服务的主版本号内保持兼容

### 4.3 校验和验证

- **算法**: SHA256
- **存储位置**: 
  - 服务包内: `checksum.sha256`
  - API 响应: `/api/services/{id}/{version}/checksum`
- **验证时机**: 下载完成后，解压前

### 4.4 断点续传

- **支持**: HTTP Range 请求
- **实现**: FastAPI 的 `FileResponse` 自动支持
- **块大小**: 客户端可配置（建议 1MB）

---

## 5. 风险评估与缓解

### 5.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 服务包大小过大 | 下载时间长，占用带宽 | 中 | 1. 使用压缩<br>2. 支持断点续传<br>3. 分块下载 |
| 版本冲突 | 多个版本共存导致混乱 | 低 | 1. 版本目录隔离<br>2. 符号链接管理当前版本 |
| 解压失败 | 服务无法启动 | 低 | 1. 解压前验证校验和<br>2. 解压后验证文件完整性 |
| 磁盘空间不足 | 无法安装新服务 | 中 | 1. 安装前检查磁盘空间<br>2. 提供磁盘清理功能 |

### 5.2 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 向后兼容性 | 现有节点无法升级 | 中 | 1. 保留原有 API<br>2. 提供迁移工具<br>3. 分阶段迁移 |
| 服务包质量 | 服务无法正常运行 | 低 | 1. 严格的打包流程<br>2. 自动化测试<br>3. 版本标记机制 |

### 5.3 运维风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| Model Hub 负载增加 | 下载速度慢 | 中 | 1. CDN 加速<br>2. 多地域部署<br>3. 缓存策略 |
| 服务包更新频繁 | 节点端需要频繁更新 | 低 | 1. 稳定版本策略<br>2. 自动更新机制（可选） |

---

## 6. 时间估算

| 阶段 | 任务 | 时间估算 | 负责人 |
|------|------|----------|--------|
| 阶段 1 | Model Hub 改造 | 2-3 周 | 后端团队 |
| 阶段 2 | 节点端改造 | 2-3 周 | 前端/Electron 团队 |
| 阶段 3 | 第一批服务打包 | 1-2 周 | 运维/打包团队 |
| 阶段 4 | 向后兼容和迁移 | 1 周 | 全团队 |
| **总计** | | **6-9 周** | |

---

## 7. 成功标准

### 7.1 功能标准

- [ ] Model Hub 提供服务包下载 API
- [ ] 节点端可以下载并安装服务包
- [ ] 节点端可以启动安装的服务
- [ ] 节点端可以卸载服务
- [ ] 节点端可以查看已安装服务列表

### 7.2 性能标准

- [ ] 服务包下载速度 ≥ 10MB/s（100Mbps 网络）
- [ ] 服务包安装时间 ≤ 5 分钟（1GB 服务包）
- [ ] 服务启动时间 ≤ 30 秒

### 7.3 质量标准

- [ ] 服务包校验和验证通过率 100%
- [ ] 服务安装成功率 ≥ 99%
- [ ] 服务启动成功率 ≥ 99%

---

## 8. 后续优化方向

### 8.1 增量更新
- 支持服务包增量更新（仅下载变更文件）
- 减少下载时间和带宽消耗

### 8.2 自动更新
- 节点端自动检测服务更新
- 支持自动或手动更新策略

### 8.3 服务依赖管理
- 支持服务间依赖关系
- 自动安装依赖服务

### 8.4 多版本共存
- 支持同一服务的多个版本共存
- 支持版本切换功能

---

## 9. 附录

### 9.1 第一批服务清单

| 服务 ID | 服务名称 | 当前代码位置 | 预估大小 |
|---------|----------|--------------|----------|
| `nmt-m2m100` | M2M100 NMT Service | `services/nmt_m2m100/` | ~1GB |
| `piper-tts` | Piper TTS Service | `services/piper_tts/` | ~500MB |
| `node-inference` | Node Inference Service | `services/node-inference/` | ~2GB |
| `your-tts` | YourTTS Service | `services/your_tts/` | ~1.5GB |

### 9.2 API 变更对比

| 功能 | 当前 API | 新 API | 兼容性 |
|------|----------|--------|--------|
| 获取模型列表 | `GET /api/models` | `GET /api/services` | 保留旧 API |
| 下载模型文件 | `GET /storage/models/{...}` | `GET /storage/services/{id}/{version}.zip` | 保留旧 API |
| 获取服务信息 | ❌ | `GET /api/services/{id}` | 新增 |
| 获取校验和 | `GET /storage/models/{...}/checksum.sha256` | `GET /api/services/{id}/{version}/checksum` | 新增 |

### 9.3 相关文档

- [系统架构文档](../SYSTEM_ARCHITECTURE.md)
- [Model Hub 文档](../../central_server/model-hub/README.md)
- [服务管理文档](../../electron_node/services/README.md)

---

## 10. 决策要点

### 10.1 需要决策的问题

1. **是否采用服务包模式？**
   - ✅ 推荐采用，简化部署和维护
   - ⚠️ 需要 Model Hub 和节点端同时改造

2. **向后兼容策略？**
   - ✅ 推荐保留原有 API，分阶段迁移
   - ⚠️ 需要维护两套 API，增加复杂度

3. **版本管理策略？**
   - ✅ 推荐语义化版本，公司标记稳定版本
   - ⚠️ 需要建立版本发布流程

4. **实施时间表？**
   - ✅ 推荐 6-9 周完成改造
   - ⚠️ 需要协调多个团队

### 10.2 建议

**强烈建议采用服务包模式**，理由：
1. 简化节点端部署和维护
2. 确保服务代码和模型版本一致性
3. 降低配置错误风险
4. 提升系统可靠性

**建议分阶段实施**：
1. 第一阶段：完成 Model Hub 改造和服务包打包
2. 第二阶段：完成节点端改造
3. 第三阶段：逐步迁移现有节点

---

**文档结束**

