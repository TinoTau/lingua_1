# 多语言会议室（Room）模式
## 需求与调度架构说明（冻结版）

> 本文档用于**冻结会议室模式的业务语义、调度职责与状态机设计**，不涉及具体代码实现。
> 适用于在节点端架构稳定后，进入会议室模式开发阶段使用。

---

## 1. 设计目标

构建一个支持**多用户、多语言实时交流**的会议室（Room）系统，满足：

- 同一会议室中允许存在多种语言
- 每个用户在任一时刻只能说 / 听一种语言
- 用户允许在运行过程中动态切换语言
- 调度服务器作为唯一的**语言路由与 fan-out 中心**
- 节点端保持**单语言对、单 Job 的最小职责**

明确不做：
- 客户端直连翻译节点
- 节点端多语言 fan-out
- job 级兜底或“尽量翻译”逻辑

---

## 2. 已冻结的核心决策

### 2.1 用户语言模型（Q1）

- 用户允许在运行中切换语言
- 但在任一时刻：
  - 只能说一种语言
  - 只能听一种语言

```text
User(t) = { activeLanguage }
```

约束：
- 语言切换是离散事件
- 切换仅对**后续发言**生效
- 已派发的 Job 不回滚、不取消

---

### 2.2 EN → EN 的处理方式（Q2）

#### 会议室模式（Room）
- EN → EN **不经过翻译节点**
- 原文音频通过 **WebRTC** 直接传递
- 翻译音频到达后，Web 端切换为译文

目的：
- 提升实时体验
- 对短反馈（yes / ok 等）获得最快响应
- 翻译作为增强层，而非阻塞层

#### 单会话模式（非 Room）
- 用户可直接听到原文
- 翻译延迟对体验影响较小

结论：
- EN → EN 不需要翻译
- 但需要后续实现 WebRTC 音频流能力

---

### 2.3 无节点池的处理策略（Q3）

原则：
- 不在 job 级别报错
- 不在节点端兜底
- 所有可用性判断前置到**用户语言选择阶段**

行为：
- 用户选择语言时：
  - 调度服务器检查 Node Pool 是否存在
  - 不存在则立即提示用户选择其他语言
- 不创建 job，不进入翻译流程

效果：
- 会议过程中语言可用性稳定
- 不出现“有时翻、有时不翻”的体验

---

## 3. 核心概念定义

### 3.1 Room（会议室）

- 由调度服务器创建与维护
- 是调度与语言路由的**语义边界**

```ts
Room {
  roomId
  state: ACTIVE | CLOSED
  users: Map<userId, UserState>
}
```

---

### 3.2 User（用户）

```ts
UserState {
  userId
  activeLanguage      // 当前说/听的语言
  languageReady       // 是否已确认有可用 Node Pool
  connectionState     // CONNECTED | DISCONNECTED
}
```

说明：
- activeLanguage 是唯一语言
- languageReady 由调度服务器在语言选择/切换时计算

---

### 3.3 Job（调度作业）

Job 是一次“音频 → 翻译 → 回传”的最小调度单元。

```ts
Job {
  jobId
  roomId
  speakerUserId
  sourceLanguage
  targetLanguage
  state: CREATED | DISPATCHED | FINISHED | FAILED
}
```

约束：
- 一个 Job 只对应一个语言对
- Job 之间完全独立

---

## 4. 调度服务器核心流程

### 4.1 Room 生命周期

```text
[INIT]
  |
  v
[ACTIVE] --(room closed)--> [CLOSED]
```

---

### 4.2 用户加入 / 离开 / 切换语言状态机

```text
          +----------------------+
          |      CONNECTED       |
          |  activeLanguage = L  |
          +----------+-----------+
                     |
          change language (L -> L')
                     |
        +------------v-------------+
        | check Node Pool for L'   |
        +------------+-------------+
                     |
      +--------------+--------------+
      |                             |
 Node Pool exists           Node Pool missing
      |                             |
+-----v-----+                +------v-------+
| update    |                | reject change|
| language  |                | notify user  |
+-----------+                +--------------+
```

---

### 4.3 用户发言 → Job fan-out 状态机

```text
User speaks (sourceLang = Ls)
          |
          v
Compute targetLanguages =
  all users' activeLanguage != Ls
          |
          v
For each targetLanguage Lt:
          |
          v
Check Node Pool (Ls -> Lt)
      |                 |
   exists            missing
      |                 |
create Job          skip Job
      |
      v
dispatch to node
```

---

### 4.4 Job 生命周期

```text
[CREATED]
    |
    v
[DISPATCHED]
    |
    +------ success ------> [FINISHED]
    |
    +------ failure ------> [FAILED]
```

说明：
- Job 失败只影响对应 targetLanguage
- 不影响 Room 或其他 Job

---

## 5. 关键架构约束（防止复杂度失控）

### 5.1 Room ≠ bufferKey

- Room：调度语义
- bufferKey：音频聚合实例

一个 Room 内必然存在多个 bufferKey（多用户 / 多发言）。

---

### 5.2 语言切换是调度事件

- 节点端不感知用户语言切换
- 节点只处理已派发的 Job
- 调度服务器决定是否继续派发某语言方向的 Job

---

### 5.3 不在翻译过程中发现“不可用”

- 所有语言可用性判断前置
- 会议过程中不出现 job 级语言不可用错误

---

## 6. 明确暂不实现的内容

- 同一用户同时听多种语言
- 历史发言补翻
- 自动推荐语言
- 中继翻译（如 EN → ZH → JP）

---

## 7. 后续实现前置条件

进入会议室模式开发前，需满足：

1. 节点端
   - bufferKey 语义稳定
   - Job 单语言对、失败即失败
2. 调度服务器
   - Node Pool 状态可查询
   - 语言选择 → 可用性校验接口
3. Web 端（后续）
   - WebRTC 原文音频流
   - 翻译音频切换机制

---

## 8. 总结

在当前决策约束下：

- 调度服务器承载全部复杂性
- 节点端保持最小职责
- Job 原子性清晰
- Room 模式可长期演进而不需要推倒重来

该文档作为会议室模式的**需求与架构冻结版本**保存。

