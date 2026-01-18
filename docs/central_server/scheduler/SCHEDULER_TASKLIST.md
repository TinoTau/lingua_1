# SCHEDULER_TASKLIST
## 调度服务器改造任务清单（MD 版本）

本文件根据《TASK_MANAGEMENT_FLOW_GAP_ANALYSIS.md》所列差异，整理为可直接交付开发部门的任务清单（Tasklist）。

---

# 1. 必须完成（High Priority）

## 1.1 实现 NO_TEXT_ASSIGNED 空结果核销流程
### 目标
确保空容器 Job 能够被正确核销，不进入超时流程。

### 要求
- 节点端发送空核销结果：
```json
{
  "job_id": "xxx",
  "is_final": true,
  "text_asr": "",
  "reason": "NO_TEXT_ASSIGNED"
}
```
- 调度端新增处理分支：  
  - 设置 job.status = COMPLETED_NO_TEXT  
  - 跳过 group_manager  
  - 不发送 UI 更新事件  

---

## 1.2 实现基于 expectedDurationMs 的动态 timeout
### 目标
不同 job 按其预计处理时长动态设定 timeout，解决长语音拆分后小 job 错误超时问题。

### 要求
- 新增 expectedDurationMs 字段  
- timeout = base + expectedDurationMs * factor  
- 限制 timeout 范围：15–60 秒  
- 替换目前固定超时逻辑

---

## 1.3 移除 Snapshot 重复获取
### 目标
提升调度主链路性能，避免多次 cloneSnapshot 造成 10–50ms 时间损耗。

### 要求
- create_job 获取一次 snapshot  
- 写入 JobCtx  
- 全链路透传  
- 禁止所有子函数再次获取 snapshot

---

## 1.4 修复 Phase2 request_binding 重复 GET（三次）
### 目标
减少多次 Redis GET 造成的延迟（3–10ms × 3 次）。

### 要求
- 调整为：锁前 GET 一次  
- 将结果透传至锁内与后续逻辑  
- 禁止重复 GET

---

# 2. 应完成（Medium Priority）

## 2.1 统一 Phase1 / Phase2 NodeSelector
### 目标
防止两条路径的节点选择逻辑分叉导致调度不一致。

### 要求
- 将 NodeSelector 抽象为单模块  
- 内部统一：过滤规则、语言对偏好、节点负载、冷启动策略  
- 创建 job / 绑定 job 均通过该模块调用

---

## 2.2 移除 Phase3 Config 重复读取
### 目标
减少配置 IO 与重复解析操作。

### 要求
- Phase3 config 放入 JobCtx  
- 全链路透传  
- 禁止子模块重复取 Config

---

## 2.3 合并 group_manager 写锁
### 目标
避免 ASR_FINAL + NMT_DONE 强制发生两次写锁（影响延迟）。

### 要求
- 重构更新流程  
- 合并两次写锁为一次  
- 保持顺序一致性

---

# 3. 可选优化（Low Priority）

## 3.1 缓存 session_manager.get_session
### 目标
减少重复 session lookup。

### 要求
- 获取一次 session 后缓存  
- 同一 JobResult 处理流程禁止重复调用

---

# 4. 可交付结构（推荐实施顺序）

1. NO_TEXT_ASSIGNED 空核销  
2. 动态 timeout  
3. Snapshot 透传  
4. request_binding 单次 GET  
5. 统一 NodeSelector  
6. Phase3 config 透传  
7. group_manager 写锁合并  
8. session_manager 优化  

---

# 5. 完成标准（Definition of Done）

- 所有重复调用（Snapshot、Config、Binding）被消除  
- NodeSelector 在 Phase1/Phase2 完全一致  
- 调度日志可明确区分：正常结果 / 空核销结果  
- 长语音拆分后的 job0–jobN 不再错误 timeout  
- 性能回归测试：job creation 延迟下降 10–30%  
- 新增单元测试覆盖：  
  - 空核销  
  - 动态 timeout  
  - 多 Job 容器化结果  
  - NodeSelector 正确过滤  

---

如需我生成 **更细颗粒度的第二层子任务版本（Subtask 版）** 或 **可导入 Jira 的 MD+CSV 双版本组合**，告诉我即可。
