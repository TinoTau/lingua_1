# 面对面模式连接机制说明

**日期**: 2025-01-XX  
**目的**: 澄清面对面模式是否需要通过 WebSocket 注册到调度服务器

---

## 📋 结论

**答案**: ✅ **是的，面对面模式需要通过 WebSocket 连接到调度服务器**

面对面模式（双向模式）是**单会话模式的一种特殊形式**，与单向模式使用相同的连接机制。

---

## 🔧 连接流程

### 1. WebSocket 连接建立

面对面模式使用 `WebSocketClient.connectTwoWay()` 方法建立连接：

```typescript
// web-client/src/websocket_client.ts
async connectTwoWay(langA: string, langB: string, features?: FeatureFlags): Promise<void> {
  this.ws = new WebSocket(this.url); // 连接到调度服务器
  
  this.ws.onopen = () => {
    // 发送会话初始化消息
    const initMessage = {
      type: 'session_init',
      mode: 'two_way_auto',
      lang_a: langA,
      lang_b: langB,
      // ...
    };
    this.ws!.send(JSON.stringify(initMessage));
  };
}
```

### 2. Session Init 消息

Web 客户端发送 `session_init` 消息到调度服务器：

```json
{
  "type": "session_init",
  "client_version": "web-client-v1.0",
  "platform": "web",
  "src_lang": "auto",           // 双向模式使用自动检测
  "tgt_lang": "en",             // 临时目标语言（实际会根据检测结果自动切换）
  "mode": "two_way_auto",       // 标识为双向模式
  "lang_a": "zh",               // 语言 A
  "lang_b": "en",               // 语言 B
  "auto_langs": ["zh", "en"],   // 限制识别范围
  "features": {}
}
```

### 3. Scheduler 响应

调度服务器处理 `session_init` 消息后：

1. 创建 Session（会话）
2. 返回 `session_init_ack` 消息（包含 `session_id`）
3. 建立会话管理

---

## 📊 对比：面对面模式 vs 单向模式 vs 会议室模式

| 模式 | WebSocket 连接 | Session Init | 注册方式 |
|------|---------------|--------------|---------|
| **单向模式** | ✅ 需要 | ✅ 发送 `session_init` | WebSocket 会话注册 |
| **面对面模式（双向）** | ✅ 需要 | ✅ 发送 `session_init` (mode="two_way_auto") | WebSocket 会话注册 |
| **会议室模式** | ✅ 需要 | ✅ 发送 `room_create` 或 `room_join` | WebSocket 房间注册 |

### 相同点

- ✅ 都需要通过 **WebSocket** 连接到调度服务器
- ✅ 都需要发送初始化消息（`session_init` 或 `room_create`/`room_join`）
- ✅ 都通过 WebSocket 进行后续通信（发送音频、接收翻译结果）

### 不同点

| 维度 | 单向/面对面模式 | 会议室模式 |
|------|---------------|-----------|
| **初始化消息** | `session_init` | `room_create` / `room_join` |
| **会话管理** | Session（单会话） | Room（多成员房间） |
| **翻译路由** | 返回给发送者 | 按 `preferred_lang` 路由给房间成员 |
| **WebRTC** | ❌ 不使用 | ✅ 使用（原声传递） |

---

## 🔄 完整连接流程

### 面对面模式连接流程

```
[Web Client]
    │
    ├─ 1. 用户选择"双向模式"
    ├─ 2. 选择语言 A 和语言 B
    ├─ 3. 点击"连接"按钮
    │
    ├─ 4. 调用 app.connectTwoWay(langA, langB)
    │
    └─ 5. WebSocketClient.connectTwoWay()
        │
        ├─ 6. new WebSocket(schedulerUrl)  ← WebSocket 连接建立
        │
        ├─ 7. ws.onopen 触发
        │   │
        │   └─ 8. 发送 session_init 消息
        │       {
        │         type: "session_init",
        │         mode: "two_way_auto",
        │         lang_a: "zh",
        │         lang_b: "en",
        │         ...
        │       }
        │
        └─ 9. 等待 session_init_ack
            │
            └─ 10. 收到 session_id，连接完成
```

---

## 💡 关键点说明

### 1. 面对面模式是单会话模式

面对面模式（双向模式）本质上是**单会话模式的一种变体**：
- 使用相同的 WebSocket 连接机制
- 使用相同的 Session 管理
- 区别仅在于翻译方向的自动切换

### 2. 与会议室模式的区别

**面对面模式**（单会话模式）:
- 两个人**共用一台设备**
- 系统自动检测语言并切换翻译方向
- 通过 `session_init` 注册

**会议室模式**（多会话模式）:
- 每个成员有**独立的设备**
- 通过 `room_create` 或 `room_join` 注册
- 支持 WebRTC 原声传递

### 3. 为什么需要 WebSocket 连接？

1. **会话管理**: 调度服务器需要管理会话生命周期
2. **任务调度**: 需要将翻译任务分发到节点
3. **结果返回**: 翻译结果需要通过 WebSocket 返回给客户端
4. **实时通信**: 支持流式音频传输和实时字幕

---

## 📝 代码示例

### Web 客户端代码

```typescript
// web-client/src/app.ts
async connectTwoWay(langA: string, langB: string, features?: FeatureFlags): Promise<void> {
  // 调用 WebSocketClient 的连接方法
  await this.wsClient.connectTwoWay(langA, langB, features);
  // 连接成功后，session_id 已存储在 wsClient 中
}
```

### WebSocket 客户端代码

```typescript
// web-client/src/websocket_client.ts
async connectTwoWay(langA: string, langB: string, features?: FeatureFlags): Promise<void> {
  return new Promise((resolve, reject) => {
    // 1. 建立 WebSocket 连接
    this.ws = new WebSocket(this.url);
    
    this.ws.onopen = () => {
      // 2. 发送 session_init 消息
      const initMessage = {
        type: 'session_init',
        mode: 'two_way_auto',
        lang_a: langA,
        lang_b: langB,
        // ...
      };
      this.ws!.send(JSON.stringify(initMessage));
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'session_init_ack') {
        // 3. 保存 session_id
        this.sessionId = message.session_id;
        resolve();
      }
    };
  });
}
```

---

## ✅ 总结

1. **面对面模式需要通过 WebSocket 连接到调度服务器** ✅
2. **发送 `session_init` 消息进行会话注册** ✅
3. **使用 `mode: "two_way_auto"` 标识为双向模式** ✅
4. **与单向模式使用相同的连接机制** ✅
5. **区别仅在于翻译方向的自动切换逻辑** ✅

---

## 🔗 相关文档

- [面对面模式功能文档](./FACE_TO_FACE_MODE.md)
- [会话模式功能文档](./README.md)
- [会议室模式文档](../webRTC/Web_RawVoice_Translation_Handover_Spec_v1.1.md)
- [消息协议规范](../PROTOCOLS.md)

---

**最后更新**: 2025-01-XX

