# LONG_UTTERANCE_JOB_CONTAINER_POLICY
## 超长语音多 Job 拆分与文本容器合并策略（开发实现规范）

版本：v1.0  
适用范围：调度服务器、节点端 AudioAggregator、ASR → 文本处理管线（语义修复/NMT/TTS）  
目标：统一长语音拆分后 Job 层级的文本输出行为，保证用户体验稳定、文本不丢失、延迟优化。

---

# 1. 设计背景

在超长语音场景（30–40 秒以上），调度会执行 MaxDuration 拆分，将整句话分成多个 Job，例如：

- job0：前 10 秒
- job1：中段 10 秒
- job2：后段 10 秒
- job3：结尾（可能较短）

节点端 AudioAggregator 会根据能量、静音、最大切片时长进一步切成 ASR 批次（batch）：

- B0 = job0_1 + job0_2 = 6 秒
- B1 = job0_3 + job1_1 = 7 秒
- B2 = job1_2 + job1_3 = 7 秒
- B3 = job2_1 + job2_2 = 6 秒
- B4 = job2_3 + job2_4 + job3_1 = 9 秒

问题：
- ASR 若逐批返回，会产生 5 条文本（远大于 4 个 job 数量）
- 若等待所有 batch 完成再拼接，用户需等待 30 秒以上

目标：
- 对外展示的文本段数 ≤ Job 数量
- job 是用户可感知的文本容器
- batch 是内部技术切片
- 提前返回 job 前段翻译，改善用户体验

---

# 2. Job = 文本容器；Batch = 技术切片

## 2.1 Job 容器特性
- 每个 job 容器只发送一次最终结果
- 文本来源于多个 batch 合并
- 用户可见的段落取决于 job 容器数量

## 2.2 Batch 特性
- 完全内部实现细节
- 不对外直接产生文本结果
- 必须通过容器分配策略映射到 job

---

# 3. 容器分配算法（核心）

按时间顺序扫描 batch（B0→B1→…），并按以下规则映射到 job：

## R1：容器数量限制  
最终文本段数 ≤ job0–jobN 容器数量

## R2：头部对齐（Head Alignment）  
batch 的归属优先由 batch 首帧所在的 job 决定

## R3：容器“装满”判定  
容器累计 batch 时长 ≥ 原 job 预计时长 → 容器满

## R4：容器向前吸收（Forward Merge）
若容器未满，则可吸收下一个 batch，即使 batch 的 start_job 改变

## R5：最后一个容器允许为空  
例如 job3 不接收任何 batch，成为“技术 job”，后续用空结果核销

---

# 4. 示例：5 个 batch 收敛成 3 段文本

| Batch | 时长 | 首帧 job | 最终容器 job |
|------|------|----------|----------------|
| B0   | 6s   | job0     | job0           |
| B1   | 7s   | job0     | job1（容器满后进入下一）|
| B2   | 7s   | job1     | job1           |
| B3   | 6s   | job2     | job2           |
| B4   | 9s   | job2     | job2           |

最终结果：
- job0：B0 → 第一段文本
- job1：B1 + B2 → 第二段文本
- job2：B3 + B4 → 第三段文本
- job3：无 batch → 空结果核销，不产生文本

对外输出仅 3 段文本，满足设计目标。

---

# 5. 空结果核销策略（仅允许纯辅助 Job 使用）

job3 等容器可能完全没有 batch，需空结果核销：

```json
{
  "job_id": "job3",
  "is_final": true,
  "text_asr": "",
  "reason": "NO_TEXT_ASSIGNED"
}
```

空结果的限制：
- 不能用于占坑、心跳、进度上报
- 不能用于未来可能产生文本的 job
- 一旦 job 确认不会产出文本，必须发送空核销

---

# 6. Job 生命周期约束（强制）

每个 job 只能发送一次最终结果：

```
job_result(job_X):
    is_final = true
    text_asr != "" 或 text_asr == ""
```

禁止：
- 一个 job 多次发送文本
- 先空后文本（会破坏去重与顺序）

---

# 7. 调度服务器要求

## 7.1 动态 timeout  
根据音频时长动态生成 job timeout（不再一刀切）

## 7.2 接受空核销  
空核销视为正常完成，不计入超时统计

---

# 8. 节点端实现要点

- 实现 batch → job 容器分配策略
- 识别 batch.start_job、时长
- 容器装满自动切换
- 容器完成即刻发送唯一文本结果
- 空容器发送空核销
- 严禁占坑空结果
- 输出的 utterance_index 必须使用原始 job 的 index

---

# 9. 用户体验效果

| 目标 | 效果 |
|------|------|
| 快速响应 | job0 可在 6–8 秒内返回第一段翻译 |
| 稳定段落结构 | job1/job2 生成自然的句段 |
| 不丢内容 | batch 再多也能正确归属 job |
| 调度友好 | 技术 job 被正常核销，不抛超时 |
| 易维护 | job 顺序稳定，去重逻辑无需修改 |

---

# 10. 时序图（简化）

User 35s utterance  
    ↓  
Scheduler  
    job0 / job1 / job2 / job3  
    ↓  
Node / AudioAggregator  
    B0…B4  ← 能量切片  
    job0 ← B0  
    job1 ← B1+B2  
    job2 ← B3+B4  
    job3 ← (empty)  
    ↓  
ASR → SR → NMT → TTS  
    ↓  
job0 文本  
job1 文本  
job2 文本  
job3 空核销

---

# 11. 开发任务列表（可用于 JIRA）

## 节点端
- [ ] batch → job 容器分配逻辑  
- [ ] batch metadata：start_job / 时长  
- [ ] pause / manual send 作为段界  
- [ ] 容器装满时立即 finalize  
- [ ] 空容器发送空核销  
- [ ] 禁止占坑空结果  
- [ ] utterance_index = 原始 job index

## 调度端
- [ ] 动态 timeout  
- [ ] 空核销即刻核销 job  

## 测试
- [ ] 35s 长语音构造 5–8 batch 场景  
- [ ] job0–job2 生成 3 段文本  
- [ ] job3 空核销  
- [ ] 顺序正确：utterance_index = 0/1/2  
- [ ] 延迟正确：job0 在 8–10 秒内返回

---

# 12. 结语

本策略完全回到最初设计的目标：

- job 决定文本段落数量  
- batch 是内部细节  
- 文本永不丢失、永不碎片化  
- 支持超长语音的高质量用户体验

