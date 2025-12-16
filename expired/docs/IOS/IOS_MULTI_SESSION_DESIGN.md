# iOS 客户端多会话管理设计（类似微信/Teams）

版本：v1.0

本文件定义多会话管理模块的架构、数据结构、界面逻辑、状态机设计和与 WebSocket 的交互方式。

---

# 1. 多会话功能目标

- 支持用户在同一设备上同时维护多个“翻译会话”。  
- 各会话互不干扰，有独立的：  
  - 会话 ID  
  - 历史记录  
  - 语言配置  
  - 状态（active/idle/reconnecting 等）

- UI 类似微信/Teams：  
  - 会话列表页  
  - 单个会话页  
  - 会话可关闭/删除  
  - 会话可重命名  

---

# 2. 数据结构设计

## 2.1 ChatSession（会话元信息）
```swift
struct ChatSession: Identifiable, Codable {
    let id: UUID
    var title: String
    var createdAt: Date
    var srcLang: String
    var tgtLang: String
    var history: [TranslationSegment] = []
}
```

## 2.2 多会话管理器 SessionsViewModel

```swift
final class SessionsViewModel: ObservableObject {
    @Published var sessions: [ChatSession] = []
    @Published var selectedSessionId: UUID?

    func createSession(srcLang: String, tgtLang: String) -> UUID
    func deleteSession(id: UUID)
    func renameSession(id: UUID, title: String)
}
```

会话列表与会话内容的关系：

```
SessionsViewModel
     ├─ ChatSession A  → SessionViewModel A
     ├─ ChatSession B  → SessionViewModel B
     └─ ChatSession C  → SessionViewModel C
```

---

# 3. UI 架构

## 3.1 SessionsView（会话列表）
- 显示所有会话的预览信息：标题、最后一句话、时间  
- 支持：  
  - 新建会话按钮 "+"  
  - 删除（左滑）  
  - 重命名  

## 3.2 SessionView（单会话界面）
- 显示当前会话的消息列表  
- 使用对应的 SessionViewModel  

---

# 4. 会话与 WebSocket 的关系

有两种模式可选：

---

## 模式 A：每个会话一个 WebSocket（推荐）

优点：  
- 逻辑隔离最清晰  
- 不会相互影响  
- 每个会话可单独重连  

缺点：  
- 同时多个活跃会话时会占更多连接资源  

实现：

```
SessionViewModel
    ├─ AudioCaptureService
    ├─ AudioChunker
    ├─ AudioPlayerService
    └─ RealtimeClient  ← 含独立 WebSocket
```

---

## 模式 B：共享 WebSocket（复杂，暂不推荐）

需要：
- 消息中强依赖 session_id 字段区分  
- RealtimeClient 内部要维护 session → message 路由表  

适合需要减少连接的场景，但初期开发不必要。

---

# 5. 多会话生命周期状态机

```
Idle
 └─ startSession → Connecting
Connecting
 └─ connected → Active
Active
 ├─ network drop → Reconnecting
 └─ user stop → Ended
Reconnecting
 ├─ reconnect success → Active
 └─ timeout → Error
```

每个会话都有独立状态。

---

# 6. 持久化策略

推荐能力：

- 保存会话列表（id、title、createdAt）
- 每个会话保存最近 n 条翻译记录（如 20 条）
- 使用本地 sqlite 或简单 JSON 存储  

实现：

```
Utilities/
   └─ LocalStorage.swift
```

---

# 7. 多会话间资源管理策略

重点：  
**同一时间只能有一个会话处于录音状态。**

设计：

```
SessionsViewModel
    └─ activeRecordingSessionId: UUID?
```

- 当 Session A 开始录音时，自动停止 Session B 的录音  
- UI 显示“当前另一个会话正在翻译”提示

---

# 8. 多会话 UI 流程图

```
+---------------+
| SessionsView  |
+---------------+
       |
Tap session
       v
+---------------+
| SessionView   |
| (WebSocket)   |
+---------------+
       |
Back
       v
+---------------+
| SessionsView  |
+---------------+
```

---

# 9. 实施步骤

1. 创建 SessionsViewModel  
2. 创建 SessionsView UI  
3. 将 SessionViewModel 与会话 ID 绑定  
4. 将 SessionView 添加导航层级  
5. 添加会话管理能力：新建、删除、重命名  
6. 优化资源管理（单例录音会话）  
7. 添加持久化能力  

---

# 10. 验收标准

- 能创建多个会话，互不干扰  
- 每个会话可进入并进行实时翻译  
- 离开会话后可再次进入，历史记录保留  
- 删除会话不会影响其他会话  

