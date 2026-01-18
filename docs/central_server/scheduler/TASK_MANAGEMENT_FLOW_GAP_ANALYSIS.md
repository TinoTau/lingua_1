# TASK_MANAGEMENT_FLOW_GAP_ANALYSIS
## 调度服务器任务管理流程差异分析（可交付开发部门）

版本：v1.0  
适用范围：调度服务器 / ASR 流程 / 长语音处理链路  

---

# 1. 概要结论

本次调度任务管理流程整体结构没有根本性矛盾，但存在多处高频重复调用、部分逻辑不一致，以及两个必须补齐的缺失逻辑。

最优先差异：

1. **缺失 Job 空结果核销（NO_TEXT_ASSIGNED）处理**  
2. **缺失 per-job 动态 timeout（expectedDurationMs）机制**  
3. **Snapshot / Phase3 配置重复获取**  
4. **Phase2 request_binding 重复 GET（三次）**  
5. **Phase1 / Phase2 NodeSelector 逻辑不一致**

这些必须在本次调度重构中解决，才能与新的 ASR 长语音容器设计完全匹配。

---

# 2. 已经符合设计的部分

## 2.1 Job = 文本容器  
- 每个 job 只发送一次最终结果  
- batch 只在内部使用  
- Dispatcher 聚合 batch → 形成 job 级文本  
→ 完全符合长语音容器模型。

## 2.2 Batch = 技术切片  
- AudioAggregator 仅负责切 batch，不产生文本  
→ 与设计一致。

## 2.3 多 Job 容器化机制  
- 超长语音时，将 job0/job1/job2/job_last 合并后进行 batch 切分  
- ASR 按容器输出  
→ 逻辑对齐。

---

# 3. 必须补齐的差异

## 3.1 必须新增：空容器 Job 的空结果核销  
当前：  
- 最后一个 job（jobN）可能没有 batch  
- 节点不发送结果 → 调度永远等待 → 最终超时

设计要求：

```json
{
  "job_id": "jobN",
  "is_final": true,
  "text_asr": "",
  "reason": "NO_TEXT_ASSIGNED"
}
```

调度必须支持：

```
if result.reason == NO_TEXT_ASSIGNED:
    job.status = COMPLETED_NO_TEXT
    skip group_manager
    return OK
```

---

## 3.2 必须新增：expectedDurationMs 动态 timeout  
当前：  
- job 使用固定 timeout（例如 60s）  
- 但 job0=10s、job1=10s、job2=10s、job3=3s  

风险：  
- job3 只有 1–3 秒，却硬等到 60 秒  

设计要求：

```
timeout = base + expectedDurationMs * factor
clamp(15s, 60s)
```

---

# 4. 高优先级重复逻辑（必须修复）

## 4.1 Snapshot 重复 clone  
必须改为 snapshot 在 JobCtx 全路径透传。

## 4.2 Phase3 config 重复读  
应缓存于 JobCtx。

## 4.3 request_binding 三次 GET  
必须改为一次 GET → 全链路透传。

## 4.4 NodeSelector 双路径不一致  
Phase1 / Phase2 的节点选择必须合并成统一模块。

---

# 5. 逻辑不一致但不算矛盾（建议修复）

- group_manager 写锁两次可合并一次  
- session_manager.get_session 两次可缓存  
- result_queue 与 UI 事件不能同时等待锁  

---

# 6. 建议新增模块

## 6.1 空核销结果处理器  
确保空结果不触发 UI 或 group_manager。

## 6.2 统一 NodeSelector  
将 Phase1 / Phase2 合并成一个节点选择器。

## 6.3 JobCtx 全链路透传  
包括 snapshot、phase3 config、request_binding。

---

# 7. 给开发的总结（可直接使用）

> 当前逻辑主线正确，但缺失“空核销结果处理”和“动态 timeout”两个核心能力，并存在 snapshot/config/request_binding 重复读取和节点选择器不一致的问题。  
> 修复这些问题后，调度服务器将与最新的 ASR 长语音容器设计完全对齐，并解决之前的 618/619 误超时和结果丢失风险。
