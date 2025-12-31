# API Gateway 设计与架构

本文档是 [对外开放 API 设计与实现](./PUBLIC_API.md) 的子文档，包含背景、目标、架构设计和实现方案。

**返回**: [对外开放 API 主文档](./PUBLIC_API.md)

---

## 1. 背景与目标

### 1.1 当前系统能力

当前系统已经具备：

- 多会话实时语音翻译能力  
- 分布式第三方节点（Electron Node）算力池  
- 可插拔 ASR / NMT / TTS / 可选模块（情绪、语速、音色等）  
- 面向移动 App 的内部 WebSocket 协议  

### 1.2 目标

**扩展为一个可对外开放的语音翻译服务平台，使外部 APP / 网站 / 即时通信工具也可调用本系统。**

此扩展不改变核心推理与调度逻辑，只添加面向第三方使用的外壳、鉴权与多租户能力。

---

## 2. 新增能力概述

### 2.1 Public API Gateway（对外 API 网关）

新增一个网关服务，职责：

- 提供稳定、文档化的 **REST API** + **WebSocket API**  
- 验证第三方 APP 身份（API Key / OAuth / JWT）  
- 接收外部音频输入，将其转换成内部 `session_init` / `utterance` 消息  
- 将内部 `translation_result` 转换成对外 API 格式  
- 负责限流、计费钩子、日志、监控  

网关充当桥梁：

```
外部 APP / Web / IM 工具
        ↓ HTTPS / WSS
[Public API Gateway]
        ↓ 内部 WS / RPC
[Scheduler] → [Nodes]
```

### 2.2 多租户系统 (Multi-Tenant)

每个外部 APP / 网站视为一个 **租户（tenant）**。新增：

- `tenant_id`
- API Key 或 OAuth2 client ID/secret  
- 每租户的配额（最大并发会话数 / 请求频率）  
- 计费统计（累积使用量、节点时间、token 等）  

Scheduler 需要在 session/job 中携带 `tenant_id`，用于：  

- 限流与保护系统  
- 未来商业化计费  

### 2.3 对外协议包装（简化）

内部协议（session_init/utterance）保留，外部接口包装成更友好的 API：

#### REST（非实时/短会话）

- `POST /v1/speech/translate`  
  上传音频文件，返回翻译文本 + 语音。

#### WebSocket（实时流式翻译）

- `/v1/stream`  
  外部客户端发送音频分片 → 接收实时翻译文本与 TTS 输出。

#### Webhook（可选）

- 返回翻译结果给第三方服务器，适合 IM 平台。

### 2.4 SDK（可选）

提供跨平台 SDK 以简化接入：

- JS Web SDK  
- iOS SDK  
- Android SDK  

SDK 内部使用网关协议，对外只暴露：

```ts
const session = await lingua.startSession();
session.sendAudioChunk(chunk);
session.onResult((res) => console.log(res.text));
```

---

## 3. 架构设计

### 3.1 架构图

```
                   +-------------------------+
                   |    External App / Web   |
                   |  (IM, SaaS, Mobile App) |
                   +-------------+-----------+
                                 |
                           HTTPS / WSS
                                 |
                 +---------------v----------------+
                 |       Public API Gateway       |
                 | - Auth (API Key / OAuth)       |
                 | - Rate Limit / Billing         |
                 | - API v1 (REST + WebSocket)    |
                 +---------------+----------------+
                                 |
                       Internal WS / RPC
                                 |
                 +---------------v----------------+
                 |           Scheduler            |
                 | - Multi-tenant routing         |
                 | - Job dispatch                 |
                 +---------------+----------------+
                                 |
             -----------------------------------------
             |                 |                     |
   +---------v-----+  +--------v---------+  +--------v---------+
   |  Node Client  |  |  Node Client     |  |  Node Client     |
   | (Electron GPU)|  | (User PC GPU)    |  | (Cloud GPU)      |
   +---------------+  +------------------+  +------------------+
```

### 3.2 改动范围

改动量 **中等**，无需重构：

| 模块 | 改动量 | 说明 |
|------|--------|------|
| Node 推理服务 | 无 | 完全复用 |
| Scheduler | 小 | 加租户、限流、错误码 |
| WebSocket 内部协议 | 小 | 增加 tenant_id |
| Public API Gateway | 新增 | 外部应用入口 |
| SDK | 可选 | 提升第三方接入体验 |
| 文档 | 必须更新 | API 文档、开发指南 |

---

## 4. 实现方案

### 4.1 项目结构

```
api-gateway/
├── Cargo.toml
├── config.toml
├── src/
│   ├── main.rs
│   ├── config.rs
│   ├── auth.rs          # 鉴权模块
│   ├── tenant.rs        # 租户管理
│   ├── rate_limit.rs    # 限流
│   ├── rest_api.rs      # REST API 处理
│   ├── ws_api.rs        # WebSocket API 处理
│   └── scheduler_client.rs  # 与 Scheduler 通信
└── README.md
```

### 4.2 技术栈

**推荐**: Rust + Axum（与 Scheduler 保持一致）

**核心依赖**:
- `tokio` - 异步运行时
- `axum` - Web 框架
- `serde` / `serde_json` - 序列化
- `dashmap` - 并发限流
- `sha2` - API Key 哈希
- `tokio-tungstenite` - WebSocket 客户端

### 4.3 核心模块

#### 4.3.1 租户管理 (`tenant.rs`)

**功能**:
- 租户注册和管理
- API Key 生成和验证
- 租户配额管理

#### 4.3.2 鉴权中间件 (`auth.rs`)

**功能**:
- API Key 验证
- OAuth2 支持（可选）
- JWT 支持（可选）

#### 4.3.3 限流模块 (`rate_limit.rs`)

**功能**:
- 每租户请求频率限制
- 每租户并发会话数限制
- 全局限流保护

#### 4.3.4 REST API (`rest_api.rs`)

**功能**:
- 处理 REST API 请求
- 音频文件上传
- 翻译结果返回

#### 4.3.5 WebSocket API (`ws_api.rs`)

**功能**:
- 处理 WebSocket 连接
- 实时音频流处理
- 翻译结果推送

#### 4.3.6 Scheduler 客户端 (`scheduler_client.rs`)

**功能**:
- 与 Scheduler 建立 WebSocket 连接
- 消息格式转换
- 结果转发

### 4.4 Scheduler 扩展

#### 4.4.1 Session 结构扩展

**文件**: `scheduler/src/session.rs`

**新增字段**:
- `tenant_id: Option<String>` - 租户 ID（可选，内部会话可为 None）

#### 4.4.2 消息协议扩展

在 `scheduler/src/messages/session.rs` 中扩展 `SessionInit`：

```rust
pub struct SessionInit {
    // ... 现有字段 ...
    pub tenant_id: Option<String>,  // 新增
}
```

#### 4.4.3 租户限流（可选）

- 在 Scheduler 中实现租户级别的限流
- 或在 API Gateway 中统一处理

---

**返回**: [对外开放 API 主文档](./PUBLIC_API.md) | [API 规范与使用](./PUBLIC_API_SPEC.md) | [实现状态与部署](./PUBLIC_API_STATUS.md)

