# ASR 性能退化系统排查与架构改造方案

版本：2026-01-21
面向对象：节点端开发 / ASR 服务开发 / 系统架构组

---

# 1. 文档目的

本文件提供一套 **可重复、系统化的检测方法**，用于定位 ASR 在运行一段时间后性能突然退化的问题（如 `list(segments)` 从 <1s 变成 30–40s）。
同时给出 **架构级的解决方案**，避免通过补丁或临时超时处理来掩盖根因。

目标：

1. 建立一个可以“随时复现问题原因”的检测体系
2. 按实验一步步定位到问题发生位置
3. 最终用架构改造的方式“封闭问题”，让系统稳定运行

---

# 2. 现象总结（来自已有报告）

ASR 服务出现以下典型症状：

* `model.transcribe()` 耗时依然正常（4–5 秒）
* `list(segments)` 耗时异常，从 <1s → 30–40s（随 Worker 运行时间增长）
* GPU 利用率极低（2%），处理变为 CPU-bound
* 重启 ASR 服务即可恢复性能
* 代码和模型与备份版本一致，无逻辑修改

这说明：

> **问题不是代码变化，而是 Worker “长命进程 + 状态累积 + ONNX/CUDA 退化”导致的性能下降。**

---

# 3. 系统检测方法（可重复执行）

## 3.1 检测框架：统一日志与指标体系

为每一次 ASR 请求记录以下指标：

| 指标项                   | 含义                        |
| --------------------- | ------------------------- |
| `t_decode`            | 解码/重采样耗时                  |
| `t_vad`               | VAD + 切段耗时                |
| `t_transcribe`        | Whisper 推理时间              |
| `t_segments_list`     | `list(segments)` 耗时（主要嫌疑） |
| `t_postprocess`       | 文本清理                      |
| `t_end_to_end`        | 总链路耗时                     |
| `segments_count`      | 分段数量                      |
| `audio_duration_sec`  | 输入音频长度                    |
| `worker_uptime_sec`   | Worker 进程已运行时间            |
| `job_index_in_worker` | Worker 已处理任务序号            |
| `gpu_util`            | GPU 利用率快照                 |
| `memory_rss_mb`       | 进程常驻内存快照                  |

日志格式示例：

```
[trace_id] phase=segments_list_done 
    t=32.581s segments=88 
    worker_uptime=2345s job_index=63 
    gpu_util=2% mem=1340MB
```

这样你可以清晰看到：

* 延迟是在 decode / transcribe / segments / postprocess 的哪一步
* 是否随着 worker_uptime / job_index 增加而恶化
* 是否 GPU 完全没参与（推断为 CPU 退化）

---

## 3.2 系统排查步骤（必须按顺序执行）

### 步骤 1：排除 Node 层与服务发现影响（直连 vs Node）

用同一段音频：

1. **直连 ASR**

   ```bash
   curl http://localhost:9000/utterance -X POST ...
   ```
2. **通过 Node → InferenceService → 服务发现 → ASR**

对比 ASR 内部日志里的 `t_segments_list`。
如果两者一致 → **问题在 ASR 内部，与服务发现无关**。

（已有报告结论显示这是本次的真实情况。）

---

### 步骤 2：验证“长命进程退化”假设（基准测试）

运行以下独立基准脚本：

```python
for i in range(1, 51):
    run_once(24秒测试音频)
```

记录每次：

* `t_transcribe`
* `t_segments_list`

如果前 5 次正常、跑到第 20+ 次显著变慢 → 证明是 **进程状态积累导致退化**。

---

### 步骤 3：多 Worker 对照实验

1. Worker A：连续处理 100 个请求
2. Worker B：每 10 个请求强制重启一次

如果 Worker B 永远稳定、A 会慢 → 验证：

> 长命 Worker 不可靠，需要设计生命周期。

---

### 步骤 4：ONNX/CUDA 实验（排除配置问题）

做两组选项：

1. 切到 CPU（model=“cpu”）对比
2. 切换 compute_type（float16 → int8）

如果 CPU 模式下 segments_list 更稳定，则可能是：

* GPU provider 初始化/上下文泄漏
* ONNX nodes fallback CPU
* CUDA context 累积

这个结果会作为架构改造的背景信息。

---

# 4. 结果分析：问题本质（依据检测体系）

结合上述检测步骤与已有报告，可以预期：

1. `t_transcribe`（GPU 推理）稳定 → 模型部分 OK
2. `t_segments_list` 随 Worker age 增长 → 出现“退化曲线”
3. GPU 利用率极低 → ONNX 节点大量 fallback 到 CPU
4. 重启 Worker 后性能恢复 → 问题与长命进程直接绑定

因此：

> **根因是“ASR Worker 长生命周期 + 推理框架内部状态累积 + CPU fallback”，属于体系性问题，而非配置错误或 Node 层影响。**

---

# 5. 架构级解决方案（不使用补丁）

方案目标：

* 不依赖 timeout/try-catch 补丁
* 不隐藏问题
* 用架构规则消化“长命进程退化”这一不可控性

## 5.1 Worker 生命周期管理（核心）

定义 Worker 的硬寿命：

* `MAX_JOBS_PER_WORKER = 100`
* `MAX_UPTIME_PER_WORKER_SEC = 3600`

Worker 自主退出，服务管理器自动拉起新 Worker。

伪代码：

```python
MAX_JOBS = 100
MAX_UPTIME = 3600

start = now()
jobs = 0

while True:
    task = queue.get()
    jobs += 1
    process(task)

    if jobs >= MAX_JOBS or now() - start >= MAX_UPTIME:
        log("worker_lifespan_reach")
        break
```

特点：

* 无补丁逻辑
* 无复杂状态机
* 直接从架构层面“封死退化可能性”
* 日志行为可预测且易排查
* 即使 Whisper/ONNX 有内部泄漏，也不会影响整个系统

---

## 5.2 抽离 Worker 内部状态（确保 Worker“无跨请求状态”）

问题根源之一是 Worker 内部存在大量状态：

* 全局 session 上下文
* pending_results 表
* Text cache
* 全局 queue
* 其他用户行为残留

架构建议：

> Worker 不再保留任何与会话、历史请求相关的状态。

做法：

* 把上下文管理抽到主进程（或 Node）
* Worker 每次纯函数式处理：输入音频 → 输出 segments/text
* Worker 退出时自然清零所有状态（因为状态已经不在它体内）

好处：

* Worker 变得极其稳定和可预测
* 重启不会丢状态，因为状态已经外移
* 大幅减少内存泄漏可能路径

---

## 5.3 增加 ASR 自检机制（自动体检，而非补丁）

在 ASR 后台定时执行（每 10 分钟）：

* 用内置 1 秒测试音频跑一次 ASR
* 记录 `t_transcribe`, `t_segments_list`
* 如超出基线阈值 → 触发 Worker 自主退出

特征：

* 不影响业务请求
* 让系统能够提前发现退化，而不是等到客户流量进来才知道慢
* 机制简单，不引入额外状态

---

## 5.4 性能基线化（长期可用的工程能力）

为以下内容建立“固定基线文件”：

```
baseline_asr.json
{
  "audio_24s": {
    "transcribe": "<= 6s",
    "segments": "<= 1.5s",
    "max_total": "<= 9s"
  }
}
```

* 修改模型 / Whisper 版本 / ONNX 版本时重新生成基线
* 所有团队成员使用一致基线即可判断“退化 vs 正常”

---

# 6. 开发任务列表（Task List）

## P0：检测体系落地（必须）

* [ ] 加统一日志：t_transcribe / t_segments_list / job_index / worker_uptime
* [ ] Node 直连/绕过对照测试
* [ ] Worker 自检脚本（benchmark_segments.py）

## P1：原因定位（必须）

* [ ] 跑完整 50 次基准，绘制退化曲线
* [ ] 多 Worker 对照实验
* [ ] CPU fallback / compute_type 对比实验

## P2：架构改造（推荐）

* [ ] 移除 Worker 中的 session/pending_results 全局状态
* [ ] 外移上下文管理到主进程
* [ ] 引入 Worker 寿命模型（MAX_JOBS + MAX_UPTIME）
* [ ] 简化 Worker → 纯函数式任务处理

## P3：稳定性建设（推荐）

* [ ] 加入 ASR 后台自检任务
* [ ] 生成 baseline_asr.json 并归档
* [ ] 给调度端暴露“ASR 健康度指标”

---

# 7. 最终结论

> ASR 变慢不是服务发现重构导致的，而是 Worker 长生命周期 + Whisper/ONNX 状态积累导致的“可重复退化”。
> **通过检测体系 → 原因确认 → 架构改造（短命 Worker + 无跨请求状态）**
> 才能从根本上解决问题，而非依赖补丁。

该方案满足你提出的要求：

* 系统化检测
* 清晰找到根因
* 用架构设计处理复杂性
* 无补丁、无多层保险、易排查、易维护

---
