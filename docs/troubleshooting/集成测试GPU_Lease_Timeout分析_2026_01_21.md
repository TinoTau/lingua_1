# 集成测试GPU Lease Timeout问题分析

**日期**: 2026-01-21 01:50  
**问题**: GPU lease timeout: GPU_USAGE_HIGH  
**根因**: 🔴 **ASR任务处理超时（30秒）**

---

## 🔍 问题现象

### Web端报错

```
GPU lease timeout: GPU_USAGE_HIGH
```

### 系统状态

```
✅ 调度服务器: 运行中
✅ 节点端: 运行中
✅ ASR服务: 运行中
✅ Web端: 运行中
```

**GPU使用率**: 27% GPU / 34% Memory（不高）

---

## 📊 关键日志分析

### Job s-BA61422D:75 处理流程

#### 时间线

```
01:16:49.211 - 收到ASR请求（11.2秒音频）
01:16:49.213 - 音频解码完成（2ms）
01:16:49.940 - VAD完成（727ms，检测到1个语音段）
01:16:49.942 - 提交给ASR Worker
01:16:49.945 - Worker开始处理
01:16:55.315 - faster-whisper检测到语言（zh, 5.37秒）
01:16:55.317 - transcribe()完成（5.37秒）
01:17:19.952 - ⚠️ **ASR任务超时（30秒）**
01:17:20.000 - ⚠️ **segments转list完成（24.682秒！）**
01:17:20.106 - 结果到达但job已被取消
```

#### 耗时分解

| 阶段 | 耗时 | 占比 |
|------|------|------|
| 音频解码 | 0.002s | 0% |
| VAD检测 | 0.727s | 2.4% |
| **transcribe()** | 5.372s | 17.9% |
| **list(segments)** | 24.682s | 82.3% |
| **总耗时** | **30.010s** | **267.9% RTF** |

**音频时长**: 11.2秒  
**实际耗时**: 30秒  
**性能比率**: **2.68x 音频时长**（严重超标）

---

## 🔴 核心问题

### 问题1: list(segments) 耗时24.7秒

**正常情况**:
- 11秒音频应该在100-300ms内完成
- 实际耗时**24.7秒**，是预期的**80-250倍**！

**为什么这么慢？**

根据之前的分析，这是**性能退化问题**的体现：

1. **faster-whisper的segments是生成器（generator）**
   ```python
   segments, info = model.transcribe(audio, ...)
   # segments是generator，需要迭代才能获取结果
   ```

2. **迭代过程可能很慢**
   ```python
   # 在asr_worker_process.py中
   segments_list = list(segments)  # 这一步耗时24.7秒！
   ```

3. **可能的原因**:
   - 内部状态累积导致迭代变慢
   - GPU内存碎片化
   - CUDA上下文切换开销
   - ONNX Runtime内部问题

---

### 问题2: 30秒超时阈值被突破

**超时设置** (`asr_worker_manager.py`):
```python
ASR_TIMEOUT = 30.0  # 30秒
```

**实际耗时**: 30.01秒（刚好超过阈值）

**结果**:
- 节点端判定任务超时，取消任务
- GPU仲裁器认为GPU长时间被占用（HIGH状态）
- 当结果返回时，job已被标记为失败
- Web端收到`GPU lease timeout: GPU_USAGE_HIGH`

---

### 问题3: GPU仲裁器的连锁反应

**推测的流程**:

1. ASR任务占用GPU超过30秒
2. GPU仲裁器检测到高使用率时间过长
3. 标记GPU为`GPU_USAGE_HIGH`状态
4. 新的任务申请GPU lease被拒绝
5. 返回timeout错误给Web端

---

## 💡 根本原因分析

### 这是我们之前排查的性能问题

回顾之前的分析：

1. **真实音频测试显示性能退化**
   - 基线性能就很慢（1.7-2.2x音频时长）
   - 随着segments增多，性能进一步下降

2. **list(segments)是主要瓶颈**
   - 占用总耗时的80%以上
   - 这次测试：24.7秒 / 30秒 = 82%

3. **版本确认无问题**
   - faster-whisper 1.2.1
   - onnxruntime-gpu 1.23.2
   - 与备份代码一致

4. **不是"退化"，是"基线性能差"**
   - 之前的结论：这不是随时间退化
   - 而是性能本身就不理想

---

## 🎯 问题的严重性

### 当前状态评估

**11.2秒音频的处理时间**:
```
理想时间: 1-2秒（0.1-0.2x RTF）
可接受时间: 5-7秒（0.5-0.6x RTF）
当前时间: 30秒（2.68x RTF）
```

**影响**:
- 🔴 长句（>10秒）几乎无法正常处理
- 🔴 触发30秒超时，导致任务失败
- 🔴 GPU仲裁器拒绝新任务
- 🔴 用户体验极差

---

## 🔧 临时解决方案

### 方案1: 增加超时阈值（治标）

**修改** `asr_worker_manager.py`:
```python
# 从30秒增加到60秒
ASR_TIMEOUT = 60.0
```

**效果**:
- ✅ 避免30秒超时
- ⚠️ 用户等待时间更长
- ❌ 不解决根本问题

---

### 方案2: 使用ThreadPoolExecutor with timeout（已有）

**当前代码已实现**:
```python
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
    future = executor.submit(lambda: list(segments))
    try:
        segments_list = future.result(timeout=20.0)  # 20秒超时
    except concurrent.futures.TimeoutError:
        # 超时处理
```

**问题**: 
- ❌ 这次耗时24.7秒，已经超过20秒
- ❌ 应该触发TimeoutError，但日志显示成功了？

**需要检查代码逻辑**

---

### 方案3: 减少beam_size（权衡方案）

**当前设置**:
```python
beam_size=10  # 当前值
```

**调整为**:
```python
beam_size=5  # 或更小
```

**效果**:
- ✅ 可能加快处理速度
- ⚠️ 可能降低识别准确率

---

## 📋 深度调查方向

### 需要确认的问题

1. **为什么ThreadPoolExecutor的20秒timeout没有生效？**
   - 检查`asr_worker_process.py`的实现
   - 确认timeout逻辑是否正确

2. **为什么list(segments)这么慢？**
   - 是否与音频长度相关？
   - 是否与segments数量相关？
   - 是否有内存泄漏或状态累积？

3. **GPU仲裁器的holdMaxMs设置**
   - 当前holdMaxMs是多少？
   - 30秒是否触发了HIGH_PRESSURE状态？

4. **是否需要ASR Worker改造？**
   - 参考`ASR_worker改造方案.md`
   - 使用异步迭代器
   - 边生成边返回

---

## 🚨 紧急行动

### 立即执行

1. **检查asr_worker_process.py的timeout逻辑**
   ```python
   # 确认这段代码是否正确
   future.result(timeout=20.0)
   ```

2. **检查GPU仲裁器配置**
   - `holdMaxMs`
   - `defaultHoldMaxMs`
   - `GPU_USAGE_HIGH`阈值

3. **考虑临时增加超时阈值**
   - ASR_TIMEOUT: 30s → 60s
   - segments timeout: 20s → 40s

---

## 📊 数据对比

### 本次测试 vs 之前的性能测试

| 指标 | 合成音频测试 | 真实音频测试 | 本次测试 |
|------|------------|------------|---------|
| 音频时长 | 5s | 5s-20s | 11.2s |
| 总耗时 | ~1-2s | ~7-13s | 30s |
| RTF | 0.2-0.4x | 1.4-2.6x | 2.68x |
| segments | 1-2 | 多个 | 2 |
| list()耗时 | 短 | 长 | 24.7s |

**结论**: 本次测试的性能表现与"真实音频性能退化"测试结果一致，证实了之前的分析。

---

## 🔑 关键决策点

### 需要决策

1. **是否立即进行ASR Worker改造？**
   - 优点：彻底解决问题
   - 缺点：需要较大改动，风险高

2. **是否先调整超时阈值？**
   - 优点：快速缓解问题
   - 缺点：治标不治本

3. **是否调整beam_size？**
   - 优点：可能改善性能
   - 缺点：可能影响准确率

---

## 📝 建议

### 短期（立即）

1. ✅ **增加超时阈值到60秒**
   - `ASR_TIMEOUT = 60.0`
   - segments timeout: `40.0`

2. ✅ **检查timeout逻辑是否正确**
   - 确认20秒timeout为何没有生效

3. ✅ **监控GPU仲裁器状态**
   - 查看holdMaxMs配置
   - 确认是否需要调整

### 中期（本周）

1. 🔧 **进行性能profiling**
   - 定位list(segments)慢的具体原因
   - 使用Python profiler或CUDA profiler

2. 🔧 **测试beam_size调整**
   - 测试beam_size=5的效果
   - 对比准确率和性能

### 长期（计划）

1. 📐 **ASR Worker改造**
   - 异步迭代器
   - 流式返回segments
   - 参考改造方案文档

---

**当前状态**: 🔴 **功能受阻，需要立即处理**  
**优先级**: **P0 - 紧急**  
**影响范围**: 所有长音频（>10秒）处理
