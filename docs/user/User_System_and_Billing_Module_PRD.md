
# 用户系统与计费模块完整产品与技术方案说明
（User System & Billing Module – Full PRD + Tech Spec）

---

## 1. 项目背景与设计目标

Lingua 系统是一个基于 **Web → Scheduler → Node** 架构的实时语音翻译平台，支持单人会话与多人会议室模式。  
随着系统进入可运营阶段，需要引入 **统一的用户系统与计费模块**，用于：

- 统一用户身份管理
- 管理翻译服务的使用时长（余额）
- 支持多人会议的合理计费
- 支持节点端贡献算力并进行核销/充值
- 保证计费逻辑可信、可审计、可扩展

本模块设计遵循以下核心原则：

1. **计费权威集中在 Scheduler**
2. **客户端（Web / Node）不直接写账**
3. **计费按会话聚合，避免高频读写**
4. **账务操作可审计、可回放、可对账**
5. **初期实现可控，后期可演进**

---

## 2. 系统整体架构与模块关系

### 2.1 模块组成

| 模块 | 职责 |
|----|----|
| Web Client | 用户注册、登录、会议操作、余额展示 |
| Scheduler | 会话管理、任务调度、用量聚合、计费结算（权威） |
| Node Client | 执行推理任务、累积资源用量、贡献算力 |
| User Manager | 用户信息、余额、账本、审计日志 |
| （可选）API Gateway | 统一鉴权、限流、路由 |

### 2.2 信任边界

- **可信**：Scheduler、User Manager
- **不完全可信**：Web、Node
- 所有余额变更必须由 Scheduler 发起

---

## 3. 用户系统功能设计

### 3.1 用户注册与登录（Web）

#### 功能
- 用户注册
- 用户登录
- 用户资料查看

#### 注册字段
- username
- password / confirm_password
- email
- preferred_language

#### 注册流程
1. Web 提交注册信息
2. User Manager 校验并创建用户
3. 系统生成唯一 **8 位安全码**
4. 返回注册成功信息与安全码

#### 登录后可查看
- username
- email
- 常用语言
- 当前余额（小时/分钟）
- 安全码（可复制）

---

## 4. 用户数据模型

### 4.1 User 表

- user_id (UUID, PK)
- username
- email
- password_hash
- preferred_language
- security_code (8 digits, unique)
- balance_minutes (INT, 可为负，最低 -300)
- created_at
- updated_at

### 4.2 Ledger（账本）表

账本是**唯一的事实来源**。

- ledger_id
- user_id
- session_id / room_session_id
- change_minutes (+ / -)
- balance_before
- balance_after
- reason
  - session_settlement
  - node_redeem
  - node_recharge
- actor_type (scheduler / node / admin)
- actor_id
- request_id (幂等)
- created_at

### 4.3 Audit Log

- audit_id
- actor_type
- actor_id
- action
- target
- request_id
- payload
- created_at

---

## 5. 计费模型与技术方案

### 5.1 用量采集（Node → Scheduler）

Node 在本地累积以下指标：

- asr_time_ms
- nmt_time_ms
- tts_time_ms
- gpu_active_time_ms
- total_processing_time_ms

#### 上报策略
- 会话中：不高频上报
- 会话结束：一次性上报汇总
- 异常断线：Scheduler 超时兜底结算

---

### 5.2 单人会话计费流程

1. Web 创建会话（session_id）
2. Scheduler 分配 Node
3. Node 执行任务并累积用量
4. Web 关闭会话 / 超时
5. Scheduler 计算总用量 → 换算分钟
6. Scheduler 写入账本并更新用户余额

---

### 5.3 会议室模式计费（均摊）

#### 规则
- 每个会议室对应 room_session_id
- 所有翻译内容都会分发给每个成员
- 成员轮流说话，成本不可区分

#### 计费成员
- 结算时仍在会议室内
- 已登录并拥有 user_id

#### 均摊算法
```
total_cost = Σ task_cost
N = number_of_members
base = total_cost // N
remainder = total_cost % N
```
前 remainder 个成员 +1 分钟（或秒）

#### 结算
- 为每个成员生成独立账本记录
- 共享同一个 settlement_id

---

## 6. 节点端产品功能与界面设计

### 6.1 节点 Banner 卡片

显示内容：
- 当前节点可用额度（小时:分钟）
- 今日贡献算力时长

点击后进入【用户管理页面】

---

### 6.2 节点端用户管理页面

#### A. 已绑定用户列表

- 显示：username、语言、余额
- 支持拖拽排序（核销优先级）

##### 绑定流程
1. 输入 8 位安全码
2. Scheduler 校验
3. 成功提示：“用户 XXX 绑定成功”

返回字段（最小披露）：
- user_id
- display_name
- preferred_language
- balance

---

#### B. 自动核销机制

- 每 30 分钟触发一次
- 按排序顺序核销负余额
- 节点额度用尽即停止
- 所有核销由 Scheduler 写账

---

#### C. 手动充值

- 输入安全码
- 选择充值额度（1/2/5/10/20/50 小时）
- 按钮仅在节点额度充足时可点
- Scheduler 校验并写账

---

## 7. 安全设计

### 7.1 通信安全
- HTTPS 全链路
- Node 优先通过 Scheduler 访问 User Manager
- 所有写操作携带 request_id

### 7.2 权限控制
- Node 只能操作“已绑定用户”
- 不返回 email
- scope 限制接口能力

---

## 8. 异常与边界场景

| 场景 | 处理方式 |
|----|----|
| 用户余额 < -5 小时 | Scheduler 拒绝新会话 |
| Web 异常关闭 | Scheduler 超时结算 |
| Node 掉线 | 使用已上报数据 |
| 重复结算 | request_id 去重 |
| 多次核销 | 账本保证幂等 |

---

## 9. 可扩展方向

- 支持套餐/月付
- 按模块计费权重
- 节点积分商城
- 企业/组织账户

---

## 10. 交付与约束

- 本文档为开发实现唯一依据
- 计费规则变更需更新文档
- 不允许客户端直写余额

---

（END）
