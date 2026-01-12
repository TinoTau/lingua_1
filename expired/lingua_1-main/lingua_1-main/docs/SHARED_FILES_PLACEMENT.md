# 共享文件和剩余文件放置指南

## 1. expired/shared/ 目录

### 内容
- `shared/protocols/messages.ts` - TypeScript 协议定义
- `shared/protocols/messages.js` - JavaScript 协议定义

### 用途
这些文件定义了 WebSocket 消息协议的 TypeScript/JavaScript 接口，被以下模块使用：
- **Web 客户端** (webapp) - 使用 TypeScript 版本
- **Electron 节点客户端** (electron_node) - 使用 TypeScript 和 JavaScript 版本
- **移动端客户端** (mobile-app) - 使用 TypeScript 版本

### 推荐放置方案

#### 方案 A：保留在项目根目录（推荐）

```
lingua_1/
├── shared/
│   └── protocols/
│       ├── messages.ts
│       └── messages.js
├── webapp/
├── central_server/
└── electron_node/
```

**理由**：
- 这些协议定义是跨模块共享的
- 多个模块都需要引用（webapp、electron_node、mobile-app）
- 放在根目录便于统一管理和版本控制

#### 方案 B：复制到各个模块（不推荐）

如果各模块需要独立维护协议定义，可以复制到：
- `webapp/src/shared/protocols/`
- `electron_node/electron-node/main/shared/protocols/`

**缺点**：
- 需要同步维护多个副本
- 容易出现版本不一致

### 最终建议

**将 `expired/shared/` 复制到项目根目录的 `shared/`**

```powershell
Copy-Item -Path "expired\shared" -Destination "shared" -Recurse -Force
```

---

## 2. expired/ 目录下的其他文件

### 2.1 observability.json 和 observability.json.example

**内容**：日志和可观测性配置文件

**用途**：用于配置系统的日志格式、级别等

**放置位置**：**项目根目录**

```
lingua_1/
├── observability.json
├── observability.json.example
├── webapp/
├── central_server/
└── electron_node/
```

**理由**：
- 这是全局配置文件
- 多个服务可能共享相同的日志配置
- 放在根目录便于统一管理

### 2.2 .gitignore

**内容**：Git 忽略规则

**放置位置**：**项目根目录**

```
lingua_1/
├── .gitignore
├── webapp/
├── central_server/
└── electron_node/
```

**理由**：
- 这是项目级别的 Git 配置
- 应该放在根目录

### 2.3 temp_implementation.txt 和 temp_node_protocol.txt

**内容**：临时实现文档和协议文档

**用途**：可能是开发过程中的临时笔记

**放置位置**：**可以删除或归档**

**建议**：
- 如果内容已整合到正式文档，可以删除
- 如果需要保留作为参考，可以移动到：
  - `central_server/docs/reference/`（如果是协议相关）
  - 或者直接删除

### 2.4 mobile-app/

**内容**：移动端客户端代码

**用途**：React Native 移动应用

**放置位置**：**项目根目录（独立模块）**

```
lingua_1/
├── mobile-app/
├── webapp/
├── central_server/
└── electron_node/
```

**理由**：
- 移动端是一个独立的客户端模块
- 与 webapp 并列，都是客户端
- 可以保持独立目录

---

## 3. expired/docs/ 目录下的其他文档

### 3.1 通用文档

以下文档应该放在 `central_server/docs/`（因为它们涉及整个系统）：

- `ARCHITECTURE.md` - 系统架构文档 ✅ 已复制
- `ARCHITECTURE_ANALYSIS.md` - 架构分析文档 ✅ 已复制
- `PROTOCOLS*.md` - 协议文档 ✅ 已复制
- `GETTING_STARTED.md` - 快速开始指南
- `README.md` - 文档索引

### 3.2 特定模块文档

- `webClient/` → `webapp/docs/` ✅ 已复制
- `scheduler/` → `central_server/docs/scheduler/` ✅ 已复制
- `api_gateway/` → `central_server/docs/api_gateway/` ✅ 已复制
- `electron_node/` → `electron_node/docs/electron_node/` ✅ 已复制
- `node_inference/` → `electron_node/docs/node_inference/` ✅ 已复制
- `node_register/` → `electron_node/docs/node_register/` ✅ 已复制
- `modular/` → `electron_node/docs/modular/` ✅ 已复制

### 3.3 其他文档

- `project_management/` → `central_server/docs/project_management/` ✅ 已复制
- `testing/` → `central_server/docs/testing/` ✅ 已复制
- `logging/` → `central_server/docs/logging/`（日志相关，属于系统级）
- `modelManager/` → `electron_node/docs/modelManager/`（模型管理属于节点端）
- `reference/` → `central_server/docs/reference/`（参考文档）
- `IOS/` → 可以保留在 `central_server/docs/IOS/` 或创建 `mobile-app/docs/`
- `webRTC/` → `webapp/docs/webRTC/`（WebRTC 相关，属于 Web 客户端）

---

## 4. 最终文件放置总结

### 4.1 必须放置的文件

| 文件/目录 | 放置位置 | 说明 |
|----------|---------|------|
| `expired/shared/` | `shared/` | 共享协议定义 |
| `expired/observability.json` | `.` | 全局配置文件 |
| `expired/observability.json.example` | `.` | 全局配置文件示例 |
| `expired/.gitignore` | `.` | Git 配置 |
| `expired/mobile-app/` | `mobile-app/` | 移动端客户端 |

### 4.2 可选放置的文件

| 文件/目录 | 放置位置 | 说明 |
|----------|---------|------|
| `expired/temp_*.txt` | 删除或归档 | 临时文件 |
| `expired/docs/logging/` | `central_server/docs/logging/` | 日志文档 |
| `expired/docs/modelManager/` | `electron_node/docs/modelManager/` | 模型管理文档 |
| `expired/docs/reference/` | `central_server/docs/reference/` | 参考文档 |
| `expired/docs/IOS/` | `central_server/docs/IOS/` 或 `mobile-app/docs/` | iOS 文档 |
| `expired/docs/webRTC/` | `webapp/docs/webRTC/` | WebRTC 文档 |
| `expired/docs/GETTING_STARTED.md` | `central_server/docs/` 或项目根目录 | 快速开始指南 |

---

## 5. 执行命令

```powershell
# 1. 复制 shared 目录
Copy-Item -Path "expired\shared" -Destination "shared" -Recurse -Force

# 2. 复制配置文件
Copy-Item -Path "expired\observability.json" -Destination "." -Force
Copy-Item -Path "expired\observability.json.example" -Destination "." -Force
Copy-Item -Path "expired\.gitignore" -Destination "." -Force

# 3. 复制移动端客户端
Copy-Item -Path "expired\mobile-app" -Destination "mobile-app" -Recurse -Force

# 4. 复制其他文档（可选）
Copy-Item -Path "expired\docs\logging" -Destination "central_server\docs\logging" -Recurse -Force
Copy-Item -Path "expired\docs\modelManager" -Destination "electron_node\docs\modelManager" -Recurse -Force
Copy-Item -Path "expired\docs\reference" -Destination "central_server\docs\reference" -Recurse -Force
Copy-Item -Path "expired\docs\IOS" -Destination "central_server\docs\IOS" -Recurse -Force
Copy-Item -Path "expired\docs\webRTC" -Destination "webapp\docs\webRTC" -Recurse -Force
Copy-Item -Path "expired\docs\GETTING_STARTED.md" -Destination "central_server\docs\" -Force

# 5. 处理临时文件（可选，建议删除）
# Remove-Item "expired\temp_*.txt" -Force
```

---

## 6. 最终项目结构

```
lingua_1/
├── shared/                    # 共享代码（协议定义）
│   └── protocols/
│       ├── messages.ts
│       └── messages.js
│
├── webapp/                    # Web 客户端
│   ├── src/
│   ├── tests/
│   └── docs/
│       ├── webClient/
│       └── webRTC/
│
├── central_server/            # 中央服务器
│   ├── scheduler/
│   ├── api-gateway/
│   ├── model-hub/
│   └── docs/
│       ├── scheduler/
│       ├── api_gateway/
│       ├── ARCHITECTURE.md
│       ├── ARCHITECTURE_ANALYSIS.md
│       ├── PROTOCOLS*.md
│       ├── project_management/
│       ├── testing/
│       ├── logging/
│       ├── reference/
│       └── IOS/
│
├── electron_node/             # Electron 节点客户端
│   ├── electron-node/
│   ├── node-inference/
│   ├── services/
│   └── docs/
│       ├── electron_node/
│       ├── node_inference/
│       ├── node_register/
│       ├── modular/
│       └── modelManager/
│
├── mobile-app/                # 移动端客户端
│   └── src/
│
├── scripts/                   # 启动脚本
├── expired/                   # 备份代码
│
├── observability.json         # 全局配置文件
├── observability.json.example
├── .gitignore
└── README.md
```
