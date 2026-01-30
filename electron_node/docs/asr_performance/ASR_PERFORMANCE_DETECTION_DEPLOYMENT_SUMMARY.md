# ASR 性能排查体系部署完成报告

**日期**: 2026-01-21  
**状态**: ✅ 已完成部署，等待执行  
**负责人**: AI Assistant

---

## 📋 执行摘要

根据《ASR 性能退化系统排查与架构改造方案.md》的要求，我已完成**检测体系的全面部署**，暂未进行架构改造。所有检测工具已就位，可立即开始系统排查。

---

## ✅ 已完成的工作

### 1. 统一日志体系（已集成到代码）

#### 修改的文件：
- ✅ `electron_node/services/faster_whisper_vad/asr_worker_process.py`
- ✅ `electron_node/services/faster_whisper_vad/utterance_processor.py`

#### 新增功能：

**Worker进程级别跟踪**:
```python
# 新增Worker生命周期跟踪
worker_start_time = time.time()
job_index_in_worker = 0  # Worker已处理任务序号

# 每次任务记录详细性能指标
logger.info(
    f"[{trace_id}] phase=segments_list_done "
    f"t_segments_list={t_segments_list:.3f}s "
    f"segments_count={len(segments_list)} "
    f"worker_uptime={worker_uptime_sec:.1f}s "
    f"job_index={job_index_in_worker} "
    f"audio_duration={audio_duration:.2f}s"
)
```

**音频处理阶段跟踪**:
```python
# decode阶段
logger.info(f"[{trace_id}] phase=decode_done t_decode={t_decode:.3f}s ...")

# VAD阶段
logger.info(f"[{trace_id}] phase=vad_done t_vad={t_vad:.3f}s ...")
```

#### 关键指标：
- `t_decode`: 音频解码耗时
- `t_vad`: VAD检测耗时
- `t_segments_list`: segments转换耗时（⚠️ 核心嫌疑指标）
- `worker_uptime`: Worker进程运行时间
- `job_index`: Worker已处理任务数
- `audio_duration`: 音频时长

#### 使用方法：
```bash
# 查看所有性能日志
grep "phase=" logs/faster-whisper-vad-service.log

# 查看segments转换性能
grep "phase=segments_list_done" logs/faster-whisper-vad-service.log

# 查看超过10秒的慢请求
grep "t_segments_list=[1-9][0-9]\." logs/faster-whisper-vad-service.log
```

---

### 2. 步骤1：直连ASR vs Node对比测试工具

#### 文件：
- ✅ `electron_node/services/faster_whisper_vad/test_direct_vs_node.py`

#### 功能：
- 直接调用ASR服务（绕过Node层）
- 通过Node Client调用ASR服务
- 对比两者性能，确定问题位置

#### 运行方法：
```bash
cd electron_node/services/faster_whisper_vad
python test_direct_vs_node.py
```

#### 预期输出：
```
===== ASR 直连 vs Node 对比测试 =====

直连ASR:
  成功: 5/5
  平均耗时: 8.234s
  最快: 7.891s
  最慢: 8.567s

通过Node:
  成功: 5/5
  平均耗时: 8.456s
  最快: 8.123s
  最慢: 8.789s

对比分析:
  Node耗时 - 直连耗时: +0.222s (+2.7%)

✅ 结论: 两者性能接近，Node层开销可忽略
   → 问题在ASR服务内部，与服务发现无关
```

---

### 3. 步骤2：性能退化基准测试工具

#### 文件：
- ✅ `electron_node/services/faster_whisper_vad/benchmark_segments_degradation.py`

#### 功能：
- 连续50次调用ASR服务（使用24秒音频）
- 记录每次的详细性能指标
- 生成退化曲线图
- 自动分析是否存在性能退化

#### 运行方法：
```bash
cd electron_node/services/faster_whisper_vad
python benchmark_segments_degradation.py
```

#### 输出文件：
1. `benchmark_results_YYYYMMDD_HHMMSS.json` - 详细数据
2. `benchmark_plot_YYYYMMDD_HHMMSS.png` - 性能曲线图

#### 预期输出（如果检测到退化）：
```
===== 分析结果 =====
  total_tests: 50
  successful_tests: 48
  failed_tests: 2
  degradation_detected: True
  baseline_avg_duration: 8.23s
  current_avg_duration: 32.15s
  degradation_ratio: 3.91x

⚠️ 检测到性能退化！
后期平均耗时 (32.15s) 是初期 (8.23s) 的 3.91倍

===== 建议 =====
⚠️ 检测到性能退化！建议：
  1. 查看 ASR 服务日志中的 worker_uptime 和 job_index
  2. 检查日志中的 t_segments_list 是否随时间增长
  3. 考虑实施 Worker 生命周期管理（定期重启）
  4. 进行步骤3：多Worker对照实验
```

---

### 4. 步骤4：ONNX/CUDA配置对比实验工具

#### 文件：
- ✅ `electron_node/services/faster_whisper_vad/test_onnx_cuda_config.py`

#### 功能：
- 测试不同配置下的性能表现
- 对比 CUDA vs CPU
- 对比 float16 vs float32 vs int8

#### 测试配置：
1. CUDA + float16 (当前生产配置)
2. CUDA + float32
3. CUDA + int8
4. CPU + float32 (对照组)

#### 运行方法：
```bash
cd electron_node/services/faster_whisper_vad
python test_onnx_cuda_config.py
```

**注意**: 需要手动修改`config.py`并重启服务（脚本会提供详细指引）

#### 预期输出：
```
配置对比分析

配置                  成功率    平均耗时      最快      最慢      状态
--------------------------------------------------------------------------------
CUDA_float16          100.0%      8.23s     7.89s    8.56s     ✅ 正常
CUDA_float32          100.0%      9.12s     8.67s    9.45s     ✅ 正常
CUDA_int8             100.0%      7.45s     7.12s    7.78s     ✅ 正常
CPU_float32           100.0%     25.67s    24.12s   26.89s     ✅ 正常

🏆 推荐配置: CUDA_int8
   平均耗时: 7.45s
   成功率: 100.0%

📊 性能对比:
   GPU平均: 8.27s
   CPU平均: 25.67s
   ✅ GPU加速: 3.10x
```

---

### 5. 完整的执行指南文档

#### 文件：
- ✅ `electron_node/services/faster_whisper_vad/PERFORMANCE_DETECTION_GUIDE.md`

#### 内容：
- 所有检测工具的使用说明
- 分阶段的执行流程（4个阶段）
- 结果分析方法（3种典型场景）
- 日志分析技巧
- 常见问题解答
- 完整的检查清单

---

## 📁 文件清单

### 代码修改（2个文件）
1. `electron_node/services/faster_whisper_vad/asr_worker_process.py`
   - 新增Worker生命周期跟踪
   - 新增详细的segments转换性能日志

2. `electron_node/services/faster_whisper_vad/utterance_processor.py`
   - 新增decode阶段性能日志
   - 新增VAD阶段性能日志

### 检测工具（3个脚本）
3. `electron_node/services/faster_whisper_vad/test_direct_vs_node.py`
   - 直连ASR vs Node对比测试

4. `electron_node/services/faster_whisper_vad/benchmark_segments_degradation.py`
   - 性能退化基准测试（50次连续测试）

5. `electron_node/services/faster_whisper_vad/test_onnx_cuda_config.py`
   - ONNX/CUDA配置对比实验

### 文档（2个文档）
6. `electron_node/services/faster_whisper_vad/PERFORMANCE_DETECTION_GUIDE.md`
   - 完整的执行指南

7. `ASR_PERFORMANCE_DETECTION_DEPLOYMENT_SUMMARY.md` (本文档)
   - 部署总结报告

---

## 🚀 下一步执行建议

### 立即执行（P0 - 今天）

#### 1. 重启ASR服务以加载新日志代码
```bash
cd electron_node/services/faster_whisper_vad
# 停止旧服务
pkill -f faster_whisper_vad_service.py

# 启动新服务
python faster_whisper_vad_service.py

# 或者如果使用systemd
sudo systemctl restart faster-whisper-vad
```

#### 2. 运行快速验证测试
```bash
# 步骤1: 对比测试（5分钟）
python test_direct_vs_node.py

# 查看结果，确认工具正常工作
```

---

### 短期执行（P1 - 明天）

#### 3. 运行完整基准测试
```bash
# 步骤2: 基准测试（30-45分钟）
python benchmark_segments_degradation.py

# 等待完成后查看结果
ls -lh benchmark_*
```

#### 4. 分析测试结果
- 查看生成的性能曲线图（PNG文件）
- 阅读JSON文件中的详细数据
- 确认是否检测到性能退化

---

### 可选执行（P2 - 本周）

#### 5. 配置对比实验（如果需要）
```bash
# 步骤4: 配置测试（60分钟）
python test_onnx_cuda_config.py

# 按照提示修改配置并测试
```

---

## 📊 预期的排查结果

### 情况A: 检测到明显退化 ✅

**现象**:
- 基准测试显示退化比率 > 1.5x
- 性能曲线随时间上升
- 日志中 `t_segments_list` 随 `job_index` 增长

**结论**:
- ✅ 确认长命进程退化问题
- 问题根因是Worker状态累积

**下一步**:
1. 收集证据（日志、图表、测试结果）
2. 编写详细的检测报告
3. **准备实施架构改造**（Worker生命周期管理）

---

### 情况B: 未检测到退化 ⚠️

**现象**:
- 基准测试显示退化比率 < 1.5x
- 性能曲线平稳
- 日志中性能指标稳定

**结论**:
- 当前测试未复现问题
- 可能需要更长时间或更多请求

**下一步**:
1. 增加测试次数（100次、200次）
2. 使用更长的音频（60秒）
3. 在生产环境持续监控
4. 收集生产环境日志进行分析

---

### 情况C: CPU比GPU快 🔴

**现象**:
- CUDA配置平均20-30秒
- CPU配置平均8-10秒
- 配置测试显示GPU性能异常

**结论**:
- GPU配置有严重问题
- ONNX Runtime GPU provider问题

**下一步**:
1. 检查CUDA和ONNX Runtime版本
2. 查看ONNX警告日志
3. 考虑重新安装onnxruntime-gpu
4. 临时切换到CPU模式或更稳定的配置

---

## 🔍 如何验证部署成功

### 检查1: 日志是否包含新指标
```bash
# 重启服务后发送一次测试请求
curl -X POST http://localhost:6007/utterance \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test-1", ...}'

# 查看日志
grep "phase=" logs/faster-whisper-vad-service.log | tail -5

# 应该看到类似输出：
# [test-1] phase=decode_done t_decode=0.123s ...
# [test-1] phase=vad_done t_vad=0.234s ...
# [test-1] phase=segments_list_done t_segments_list=0.567s worker_uptime=45.1s job_index=3 ...
```

### 检查2: 测试脚本是否可运行
```bash
# 检查Python依赖
pip install requests numpy matplotlib

# 运行测试脚本（应该能正常启动）
python test_direct_vs_node.py
# 看到测试开始运行即表示成功
```

---

## 📞 遇到问题时

### 常见问题

**Q1: 修改代码后服务无法启动**
```bash
# 查看错误日志
tail -100 logs/faster-whisper-vad-service.log

# 检查Python语法
python -m py_compile asr_worker_process.py
python -m py_compile utterance_processor.py
```

**Q2: 测试脚本报错**
```bash
# 检查依赖
pip install requests numpy matplotlib

# 检查服务是否运行
curl http://localhost:6007/health
```

**Q3: 日志中看不到新指标**
```bash
# 确认代码修改已生效
grep "phase=segments_list_done" asr_worker_process.py
# 应该能看到修改的代码

# 确认服务已重启
ps aux | grep faster_whisper_vad
```

### 回滚方案

如果遇到严重问题需要回滚：

```bash
# 从Git恢复原始代码
cd electron_node/services/faster_whisper_vad
git checkout asr_worker_process.py
git checkout utterance_processor.py

# 重启服务
python faster_whisper_vad_service.py
```

---

## 📝 后续步骤

### 1. 执行完整的检测流程

按照 `PERFORMANCE_DETECTION_GUIDE.md` 中的4个阶段执行：
- ✅ 阶段1: 基础检查（10分钟）
- ✅ 阶段2: 对比测试（15分钟）
- ✅ 阶段3: 退化曲线测试（30-45分钟）
- ⚪ 阶段4: 配置实验（可选，60分钟）

### 2. 收集和分析结果

- 保存所有测试输出文件
- 提取日志中的关键数据
- 生成性能分析报告

### 3. 决策下一步行动

根据检测结果决定：
- **如果确认退化**: 实施架构改造（Worker生命周期管理）
- **如果未检测到**: 增加监控，继续观察
- **如果GPU问题**: 修复配置或切换到CPU模式

---

## ✅ 总结

### 已完成 ✅
- [x] 统一日志体系（代码已修改）
- [x] 直连ASR vs Node对比测试工具
- [x] 性能退化基准测试工具（50次连续测试）
- [x] ONNX/CUDA配置对比实验工具
- [x] 完整的执行指南文档
- [x] 部署总结报告（本文档）

### 待执行 ⏳
- [ ] 重启ASR服务以加载新代码
- [ ] 运行快速验证测试
- [ ] 运行完整基准测试（50次）
- [ ] 分析测试结果
- [ ] 生成检测报告
- [ ] 决策是否需要架构改造

### 暂未实施 ⏸️
- ⏸️ Worker生命周期管理（等检测确认后实施）
- ⏸️ 会话级上下文管理（等检测确认后实施）
- ⏸️ Worker定期重启机制（等检测确认后实施）

---

**部署完成时间**: 2026-01-21  
**部署状态**: ✅ 全部完成  
**可用性**: ✅ 立即可执行  

**重要提示**: 
1. 所有检测工具已就位，无需等待，可立即开始执行
2. 建议先执行快速验证，确认工具正常工作
3. 然后运行完整的基准测试，获取退化数据
4. 根据检测结果决定是否需要架构改造

---

📄 **相关文档**:
- [原始排查方案](../../ASR 性能退化系统排查与架构改造方案.md)
- [执行指南](./PERFORMANCE_DETECTION_GUIDE.md)
- [技术审查报告](../../ASR_SERVICE_TECHNICAL_REVIEW_2026_01_20.md)
