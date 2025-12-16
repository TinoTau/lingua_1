# 会议室成员加入流程

**日期**: 2025-01-XX  
**目的**: 说明会议室成员的加入方式和工作流程

---

## 📋 成员加入方式

### 1. 第一个成员（创建者）

**方式**: 通过创建会议室进入

**流程**:
1. 用户在 UI 中点击"创建房间"按钮
2. 客户端发送 `room_create(display_name?, preferred_lang?)` 消息
3. Scheduler 生成 6 位数房间码
4. **创建者自动成为第一个成员**（无需额外加入步骤）
5. Scheduler 返回 `room_create_ack` 和 `room_members` 消息
6. 客户端显示房间码和成员列表

**特点**:
- ✅ 创建房间时自动加入
- ✅ 无需输入房间码
- ✅ 自动成为房间的第一个成员

### 2. 其他成员

**方式**: 通过 6 位数房间码进入

**流程**:
1. 用户在 UI 中输入 6 位数房间码
2. 可选：输入显示名称和偏好语言
3. 客户端发送 `room_join(room_code, display_name?, preferred_lang?)` 消息
4. Scheduler 验证房间码是否存在
5. 如果房间存在，将用户加入房间
6. Scheduler 向加入者发送 `room_members` 消息
7. Scheduler 向房间内其他成员广播 `room_members` 消息（成员列表更新）
8. 客户端显示成员列表

**特点**:
- ✅ 需要输入房间码
- ✅ 可以设置显示名称和偏好语言
- ✅ 加入后自动收到成员列表
- ✅ 其他成员会收到成员列表更新通知

### 3. 邀请方式

**状态**: ⏸️ **暂时不考虑**

未来可能会添加邀请功能，但当前版本不包含此功能。

---

## 🔄 完整流程示例

### 场景：3 人会议

#### 步骤 1：用户 A 创建房间

```
用户 A 点击"创建房间"
    ↓
客户端发送: room_create(display_name="Alice", preferred_lang="en")
    ↓
Scheduler:
  1. 生成房间码: "483920"
  2. 创建房间
  3. 将用户 A 添加为第一个成员
    ↓
Scheduler 返回:
  - room_create_ack(room_code="483920")
  - room_members(room_code="483920", members=[Alice])
    ↓
用户 A 看到:
  - 房间码: 483920
  - 成员列表: [Alice (我)]
```

#### 步骤 2：用户 B 加入房间

```
用户 B 输入房间码: "483920"
用户 B 输入显示名称: "Bob"
用户 B 选择偏好语言: "zh"
    ↓
客户端发送: room_join(room_code="483920", display_name="Bob", preferred_lang="zh")
    ↓
Scheduler:
  1. 验证房间码存在
  2. 将用户 B 加入房间
    ↓
Scheduler 发送:
  - 给用户 B: room_members(room_code="483920", members=[Alice, Bob])
  - 给用户 A: room_members(room_code="483920", members=[Alice, Bob])
    ↓
用户 A 和用户 B 都看到:
  - 房间码: 483920
  - 成员列表: [Alice, Bob]
```

#### 步骤 3：用户 C 加入房间

```
用户 C 输入房间码: "483920"
用户 C 输入显示名称: "Charlie"
    ↓
客户端发送: room_join(room_code="483920", display_name="Charlie")
    ↓
Scheduler:
  1. 验证房间码存在
  2. 将用户 C 加入房间
    ↓
Scheduler 发送:
  - 给用户 C: room_members(room_code="483920", members=[Alice, Bob, Charlie])
  - 给用户 A: room_members(room_code="483920", members=[Alice, Bob, Charlie])
  - 给用户 B: room_members(room_code="483920", members=[Alice, Bob, Charlie])
    ↓
所有用户都看到:
  - 房间码: 483920
  - 成员列表: [Alice, Bob, Charlie]
```

---

## 📊 消息流程

### 创建房间消息流程

```
Client A                    Scheduler
   |                            |
   |-- room_create ------------>|
   |  (display_name,            |
   |   preferred_lang)          |
   |                            | 1. 生成房间码
   |                            | 2. 创建房间
   |                            | 3. 添加创建者为成员
   |<-- room_create_ack --------|
   |  (room_code)               |
   |<-- room_members -----------|
   |  (room_code, members)      |
   |                            |
```

### 加入房间消息流程

```
Client B                    Scheduler                    Client A
   |                            |                            |
   |-- room_join -------------->|                            |
   |  (room_code,               |                            |
   |   display_name,            |                            |
   |   preferred_lang)          |                            |
   |                            | 1. 验证房间码              |
   |                            | 2. 添加成员                |
   |<-- room_members -----------|                            |
   |  (room_code, members)      |                            |
   |                            |-- room_members ----------->|
   |                            |  (room_code, members)      |
   |                            |                            |
```

---

## ✅ 实现状态

### 已完成

- ✅ 创建房间时自动添加创建者为第一个成员
- ✅ 其他成员通过房间码加入
- ✅ 成员列表自动同步和广播
- ✅ 房间码验证和错误处理
- ✅ **单元测试**: 16个测试，全部通过 ✅
  - ✅ 创建房间（创建者自动加入）测试（5个测试）
  - ✅ 加入房间（其他成员）测试（6个测试）
  - ✅ 成员列表同步测试（3个测试）
  - ✅ 完整流程测试（2个测试）

### 待实现

- ⏸️ 邀请功能（暂时不考虑）

---

## 🔗 相关文档

- [Web↔Web 原声通话 + 翻译接管方案 v1.1](./Web_RawVoice_Translation_Handover_Spec_v1.1.md)
- [原声传递带宽优化策略](./RAW_VOICE_BANDWIDTH_OPTIMIZATION.md)

---

**完成时间**: 2025-01-XX

