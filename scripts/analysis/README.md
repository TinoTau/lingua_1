# 分析工具脚本

本目录包含系统分析和数据提取相关的工具脚本。

## 脚本分类

### 性能分析
- `analyze_finalize_timing.py` - 分析finalize时序
- `analyze_web_console_logs.py` - 分析Web控制台日志

### 数据提取
- `extract_web_audio_list.py` - 提取Web音频列表

## 使用说明

### 分析时序

```bash
# 分析finalize时序
python analyze_finalize_timing.py [日志文件路径]

# 分析Web控制台日志
python analyze_web_console_logs.py [日志文件路径]
```

### 提取数据

```bash
# 提取音频列表
python extract_web_audio_list.py [输入文件] [输出文件]
```

## 工具说明

### analyze_finalize_timing.py
- **功能**: 分析任务完成的时间分布
- **输入**: 系统日志文件
- **输出**: 时序分析报告

### analyze_web_console_logs.py
- **功能**: 分析Web客户端的控制台日志
- **输入**: 浏览器控制台日志
- **输出**: 问题分析报告

### extract_web_audio_list.py
- **功能**: 从日志中提取音频处理记录
- **输入**: 日志文件
- **输出**: 音频列表CSV文件

## 环境要求

- Python 3.8+
- 依赖库:
  - pandas (数据分析)
  - matplotlib (可视化，可选)

## 安装依赖

```bash
pip install pandas matplotlib
```

## 输出格式

分析脚本通常会生成:
1. 文本报告 (*.txt)
2. CSV数据文件 (*.csv)
3. 可视化图表 (*.png，如果安装了matplotlib)

## 相关文档

- [性能基准报告](../../central_server/docs/scheduler/redis_architecture/Redis直查架构_性能基准报告_2026_01_22.md)
- [测试报告](../../docs/testing/)

---

**最后更新**: 2026-01-22  
**维护团队**: 性能分析组
