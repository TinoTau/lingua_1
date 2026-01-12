# 任务分配机制补充文档（增强项 + 分阶段 Checklist）v1.1

> 本文档为《任务分配稳定且高效_整体机制_建议_v1.0》的**补充说明**，  
> 目标是将“技术方向正确”进一步约束为“工程实现不偏航、可验收、可回归”的生产级方案。  
> 适用对象：开发负责人、架构评审、实施工程师。

---

## 一、补充增强项总览（必须补齐的工程约束）

### E1. Session Actor 的背压与降级策略（必须）
**问题来源**：单 Session 在弱网/慢节点/异常客户端下可能产生事件积压。  

**增强约束：**
- Actor 内部事件队列必须有**逻辑上限**（即使使用 unbounded channel）
- 定义 `MAX_PENDING_EVENTS`（建议 100–200）
- 超限后的处理策略必须明确：
  - 丢弃低优先级事件（如连续 AudioChunk）
  - 或合并事件（保留最新 AudioChunk）
- 触发降级时：
  - 可提前触发 finalize
  - 或向客户端返回“系统繁忙/请暂停说话”提示

**禁止事项：**
- 不允许无限制积压事件
- 不允许静默丢弃 finalize / CloseSession 事件

---

### E2. Session Actor 生命周期与资源回收（必须）
**问题来源**：防止僵尸 Session / 内存泄漏。

**增强约束：**
- Actor 创建：WebSocket session 建立
- Actor 退出条件（满足其一即可）：
  - WebSocket 正常关闭
  - 明确收到 CloseSession
  - 超过 `SESSION_IDLE_TIMEOUT`（建议 30–60s 无任何事件）
- Actor 退出前必须：
  - 释放音频 buffer
  - 使所有 timer generation 失效
  - 标记该 session 未完成 job 为 cancelled / ignored

---

### E3. 结果队列缺口（gap）的业务语义定义（必须）
**问题来源**：生产环境中不可避免存在 job 失败/超时。

**业务规则必须明确：**
- utterance_index 可被标记为：
  - SUCCESS
  - FAILED
  - SKIPPED（超时）
- 结果流允许：
  - `[SUCCESS, SUCCESS, FAILED, SUCCESS]`
- 不允许：
  - 因某 index 未返回而**永久阻塞**后续结果

**实现约束：**
- 每个 utterance_index 必须有 `result_deadline`（建议 30–60s）
- 超过 deadline：
  - 生成失败/跳过结果
  - 推进结果水位线

---

### E4. Session Actor 与调度策略的职责边界（建议）
**澄清声明（必须写入文档）：**
- Session Actor 负责：
  - 会话内一致性
  - finalize / utterance_index 正确性
  - job 创建触发的唯一性
- Scheduler 策略层负责：
  - 节点选择
  - 负载均衡
  - 公平性与配额
- 不允许将“调度效率问题”归因于 Actor 架构

---

### E5. 验收与监控指标（建议）
至少需要以下指标：
- session_actor_backlog_size
- duplicate_finalize_suppressed_total
- duplicate_job_blocked_total
- result_gap_timeout_total
- average_finalize_latency_ms

---

## 二、分阶段实施 Checklist（防止开发偏差）

---

## Phase 1：单实例 · 会话一致性正确性（必须通过）

### 架构与代码 Checklist
- [ ] 所有 session 状态修改仅发生在 Session Actor 内
- [ ] finalize / timeout / pause / is_final 不再直接修改 session 状态
- [ ] utterance_index 只在 finalize 成功路径中递增
- [ ] audio buffer 仅被 actor 拥有与消费
- [ ] timer 采用 generation 校验，旧 timer 不得生效

### 行为与稳定性 Checklist
- [ ] 同一 utterance_index 最多 finalize 一次
- [ ] 不存在 index 跳号、回退
- [ ] 并发触发 pause + timeout + is_final 不产生重复 job
- [ ] 单 session 弱网/慢节点不影响其它 session

### 测试 Checklist
- [ ] 并发 finalize 压力测试
- [ ] 快速连续 chunk + pause_exceeded 测试
- [ ] timeout 与 is_final 竞态测试

---

## Phase 2A：幂等 Job 边界 + 抗缺口结果流（强烈建议）

### Job 创建 Checklist
- [ ] 定义统一 job_key（session_id + utterance_index + job_type）
- [ ] job 创建使用幂等语义（重复返回同一 job_id）
- [ ] job 派发具备“一次性”语义（不可重复占用节点）

### 结果流 Checklist
- [ ] 每个 utterance_index 设置 result_deadline
- [ ] 超时自动生成 FAILED / SKIPPED 结果
- [ ] 后续结果不被永久阻塞

---

## Phase 2B：Redis 状态外置（面向生产）

### Redis Checklist
- [ ] session/node owner 写入 Redis（TTL）
- [ ] capacity / lease / request_id 原子一致
- [ ] Lua 脚本中 key 使用 hash tag（单 slot）

### 一致性 Checklist
- [ ] Scheduler 重启不导致重复 job
- [ ] lease 到期后可安全重派
- [ ] 并发实例下 job_key 仍然唯一

---

## Phase 3：多实例运行（可横向扩展）

### 多实例 Checklist
- [ ] session owner 与 node owner 明确
- [ ] 跨实例投递通道（Pub/Sub 或 Streams）
- [ ] owner 不一致时通过投递转发
- [ ] 同机 2–4 实例下功能一致

### 验收 Checklist
- [ ] 吞吐随实例数近似线性提升
- [ ] 任一实例 crash 不导致会话整体失效
- [ ] 无跨实例死锁/结果丢失

---

## 三、最终验收标准（必须达成）

- ✔ 会话内无竞态、无重复 job、无 index 跳号
- ✔ 单实例即可长期稳定运行
- ✔ 结果流永不因单点失败卡死
- ✔ 架构可平移到多实例，不需要重写核心逻辑

---

## 四、决策级总结

> Session Actor + 幂等边界不是“优化选项”，  
> 而是实时语音任务调度在生产环境中的**最低正确性保障**。

> 所有性能调优，必须建立在“会话一致性已被严格保证”的前提之上。
