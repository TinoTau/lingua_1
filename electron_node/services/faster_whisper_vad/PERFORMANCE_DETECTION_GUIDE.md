# ASR 性能退化检测执行指南

**版本**: 1.0  
**日期**: 2026-01-21  
**状态**: 已部署，等待执行

---

## 📋 概述

本指南提供完整的ASR性能退化检测流程，帮助您系统化地定位和分析问题。

**检测目标**:
- 确定性能退化是否存在
- 定位退化发生的位置（ASR内部 vs Node层）
- 识别退化的根本原因（长命进程、CUDA、ONNX等）
- 为架构改造提供数据支持

---

## 🔧 已部署的检测工具

### 1. 统一日志体系（已集成到代码）

**位置**: 
- `asr_worker_process.py` (Worker进程)
- `utterance_processor.py` (主进程)

**日志格式**:
```
[trace_id] phase=decode_done t_decode=0.123s audio_duration=10.00s
[trace_id] phase=vad_done t_vad=0.234s segments_detected=3
[trace_id] phase=segments_list_done t_segments_list=30.581s 
    segments_count=88 worker_uptime=2345.1s job_index=63 
    audio_duration=24.00s
```

**关键指标**:
- `t_decode`: 音频解码时间
- `t_vad`: VAD检测时间
- `t_segments_list`: segments转换时间（⚠️ 主要嫌疑）
- `worker_uptime`: Worker进程运行时间
- `job_index`: Worker已处理任务数

**使用方法**:
1. 启动ASR服务
2. 发送测试请求
3. 查看日志文件: `logs/faster-whisper-vad-service.log`
4. 搜索 `phase=segments_list_done` 查看性能数据

---

### 2. 直连ASR vs Node对比测试

**脚本**: `test_direct_vs_node.py`

**用途**: 排除Node层和服务发现的影响

**运行**:
```bash
cd electron_node/services/faster_whisper_vad
python test_direct_vs_node.py
```

**输出**:
- 直连ASR的平均耗时
- 通过Node的平均耗时
- 两者差异百分比
- 结论建议

**判断标准**:
- 如果两者耗时相近（<10%差异）→ 问题在ASR内部
- 如果Node明显更慢（>10%差异）→ 可能是Node层问题

---

### 3. 性能退化基准测试

**脚本**: `benchmark_segments_degradation.py`

**用途**: 连续50次测试，观察性能退化曲线

**运行**:
```bash
cd electron_node/services/faster_whisper_vad
python benchmark_segments_degradation.py
```

**输出**:
- `benchmark_results_YYYYMMDD_HHMMSS.json` (详细数据)
- `benchmark_plot_YYYYMMDD_HHMMSS.png` (性能曲线图)

**关键指标**:
- **基线平均值**: 前10次测试的平均耗时
- **当前平均值**: 后10次测试的平均耗时
- **退化比率**: 当前/基线（>1.5 表示退化）

**判断标准**:
- 如果性能曲线持平 → 系统稳定
- 如果曲线随时间上升 → 确认长命进程退化

**示例输出**:
```
基线平均值: 8.23s
当前平均值: 32.15s
退化比率: 3.91x
⚠️ 检测到性能退化！
```

---

### 4. ONNX/CUDA配置对比实验

**脚本**: `test_onnx_cuda_config.py`

**用途**: 测试不同配置下的性能表现

**测试配置**:
1. CUDA + float16 (当前)
2. CUDA + float32
3. CUDA + int8
4. CPU + float32 (对照组)

**运行**:
```bash
cd electron_node/services/faster_whisper_vad
python test_onnx_cuda_config.py
```

**注意**: 需要手动修改 `config.py` 并重启服务（脚本会提供指引）

**输出**:
- 各配置的成功率和平均耗时
- 推荐的最佳配置
- GPU vs CPU性能对比

**判断标准**:
- 如果CPU比GPU快 → GPU配置有问题
- 如果float32比float16稳定 → 考虑切换配置
- 如果所有CUDA配置都慢 → 检查CUDA/ONNX安装

---

## 🚀 执行流程

### 阶段1: 基础检查（必须）

**时间**: 10分钟

**步骤**:

1. **检查服务状态**
   ```bash
   curl http://localhost:6007/health
   ```
   确认ASR服务正常运行

2. **查看当前日志**
   ```bash
   tail -f logs/faster-whisper-vad-service.log | grep "phase="
   ```
   观察是否有异常

3. **发送单次测试**
   使用集成测试工具或curl发送一次请求，观察日志中的性能指标

---

### 阶段2: 对比测试（推荐）

**时间**: 15分钟

**步骤**:

1. **运行直连测试**
   ```bash
   python test_direct_vs_node.py
   ```

2. **分析结果**
   - 查看输出的对比结论
   - 如果直连也慢 → 问题在ASR
   - 如果只有Node慢 → 问题在Node层

3. **保存结果**
   - 输出文件: `comparison_test_YYYYMMDD_HHMMSS.json`
   - 供后续分析使用

---

### 阶段3: 退化曲线测试（核心）

**时间**: 30-45分钟

**步骤**:

1. **确保ASR服务是新启动的**
   ```bash
   # 重启服务
   systemctl restart faster-whisper-vad
   # 或手动重启
   ```

2. **运行基准测试**
   ```bash
   python benchmark_segments_degradation.py
   ```
   
   这将运行50次测试，大约需要30-45分钟

3. **观察输出**
   - 实时查看每次测试的耗时
   - 注意是否有明显变慢的趋势

4. **分析结果**
   - 查看生成的性能曲线图（PNG文件）
   - 阅读分析报告（JSON文件）
   - 确认是否检测到退化

**预期结果**:
- ✅ 如果未检测到退化 → 系统稳定，可能需要更长测试
- ⚠️ 如果检测到退化 → 确认长命进程问题，进入阶段4

---

### 阶段4: 配置实验（可选）

**时间**: 60分钟

**步骤**:

1. **备份当前配置**
   ```bash
   cp config.py config.py.backup
   ```

2. **运行配置测试**
   ```bash
   python test_onnx_cuda_config.py
   ```

3. **按照脚本提示**
   - 修改config.py中的配置
   - 重启服务
   - 继续测试

4. **对比结果**
   - 查看哪个配置性能最好
   - 确定是否是配置问题

5. **恢复配置**
   ```bash
   cp config.py.backup config.py
   systemctl restart faster-whisper-vad
   ```

---

## 📊 结果分析

### 场景1: 未检测到退化

**现象**:
- 50次测试耗时稳定
- 退化比率 < 1.5
- 曲线图平稳

**结论**:
- 系统当前状态正常
- 生产环境问题可能需要更长时间复现

**建议**:
1. 增加测试次数（修改 `NUM_ITERATIONS = 100`）
2. 使用更长的音频（修改 `TEST_AUDIO_DURATION_SEC = 60`）
3. 在生产环境持续监控日志中的 `t_segments_list`

---

### 场景2: 检测到明显退化

**现象**:
- 前10次: ~8秒
- 后10次: ~30秒
- 退化比率: 3.75x
- 曲线图上升

**结论**:
- ✅ 确认长命进程退化问题
- 问题根因在Worker生命周期管理

**建议**:
1. 立即记录证据（保存日志和图表）
2. 查看ASR日志中的 `worker_uptime` 和 `job_index`
3. 验证 `t_segments_list` 是否随 `job_index` 增长
4. 准备实施架构改造（Worker生命周期管理）

---

### 场景3: CPU比GPU快

**现象**:
- CUDA配置: 平均20-30秒
- CPU配置: 平均8-10秒

**结论**:
- GPU配置有问题
- 可能是ONNX Runtime GPU provider问题

**建议**:
1. 检查CUDA版本和ONNX Runtime版本兼容性
2. 查看日志中的ONNX警告信息
3. 尝试重新安装onnxruntime-gpu
4. 考虑临时切换到CPU模式

---

## 📝 日志分析技巧

### 查找性能瓶颈

```bash
# 查看所有segments转换时间
grep "phase=segments_list_done" logs/faster-whisper-vad-service.log

# 查看超过10秒的慢请求
grep "phase=segments_list_done" logs/faster-whisper-vad-service.log | \
    grep -E "t_segments_list=[1-9][0-9]\."

# 按Worker运行时间排序
grep "phase=segments_list_done" logs/faster-whisper-vad-service.log | \
    grep -oP "worker_uptime=\K[0-9.]+" | sort -n
```

### 提取性能数据

```bash
# 提取关键指标到CSV
grep "phase=segments_list_done" logs/faster-whisper-vad-service.log | \
    sed -E 's/.*t_segments_list=([0-9.]+)s.*worker_uptime=([0-9.]+)s.*job_index=([0-9]+).*/\1,\2,\3/' \
    > performance_data.csv

# CSV格式: t_segments_list, worker_uptime, job_index
```

### 监控实时性能

```bash
# 实时监控segments转换时间
tail -f logs/faster-whisper-vad-service.log | \
    grep --line-buffered "phase=segments_list_done" | \
    grep --line-buffered -oP "t_segments_list=\K[0-9.]+s"
```

---

## ⚠️ 注意事项

### 测试环境要求

1. **隔离环境**: 建议在测试环境运行，避免影响生产
2. **系统资源**: 确保有足够的CPU、内存、GPU资源
3. **网络连接**: 基准测试需要稳定的网络连接
4. **磁盘空间**: 测试日志和结果文件可能较大

### 常见问题

**Q1: 测试脚本无法连接到ASR服务**
```
A: 检查服务是否运行: curl http://localhost:6007/health
   检查端口配置: 默认6007端口
```

**Q2: 测试中途服务崩溃**
```
A: 查看日志: tail -100 logs/faster-whisper-vad-service.log
   检查系统资源: top, nvidia-smi
   重启服务后重新测试
```

**Q3: 图表无法生成**
```
A: 安装matplotlib: pip install matplotlib
   如果在服务器上: 使用 plt.savefig() 保存图片，不要 plt.show()
```

**Q4: 配置测试中服务启动失败**
```
A: 检查config.py语法
   查看启动日志
   确认CUDA/ONNX环境配置正确
```

---

## 📞 技术支持

如果遇到问题，请收集以下信息：

1. **测试输出**: 脚本的完整输出
2. **日志文件**: `logs/faster-whisper-vad-service.log` 的最后1000行
3. **测试结果**: 生成的JSON和PNG文件
4. **系统信息**:
   ```bash
   python --version
   pip list | grep -E "faster-whisper|onnx|torch"
   nvidia-smi
   ```

---

## 📚 相关文档

- [ASR 性能退化系统排查与架构改造方案](../../ASR 性能退化系统排查与架构改造方案.md)
- [ASR_SERVICE_TECHNICAL_REVIEW_2026_01_20.md](../../ASR_SERVICE_TECHNICAL_REVIEW_2026_01_20.md)
- [MEMORY_LEAK_ANALYSIS.md](./MEMORY_LEAK_ANALYSIS.md)

---

## ✅ 检查清单

使用以下清单确保完整执行检测流程：

- [ ] 阶段1: 基础检查
  - [ ] 服务健康检查
  - [ ] 日志查看
  - [ ] 单次测试

- [ ] 阶段2: 对比测试
  - [ ] 运行 `test_direct_vs_node.py`
  - [ ] 分析结果
  - [ ] 保存证据

- [ ] 阶段3: 退化曲线测试
  - [ ] 重启ASR服务
  - [ ] 运行 `benchmark_segments_degradation.py`
  - [ ] 分析曲线图
  - [ ] 确认是否退化

- [ ] 阶段4: 配置实验（如需要）
  - [ ] 备份配置
  - [ ] 运行 `test_onnx_cuda_config.py`
  - [ ] 对比结果
  - [ ] 恢复配置

- [ ] 结果汇总
  - [ ] 收集所有测试数据
  - [ ] 编写检测报告
  - [ ] 提出改进建议

---

**最后更新**: 2026-01-21  
**维护者**: ASR Team
