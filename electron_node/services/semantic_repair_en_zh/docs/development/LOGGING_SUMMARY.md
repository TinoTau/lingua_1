# 日志系统总结

**服务**: semantic-repair-en-zh  
**日期**: 2026-01-19  
**状态**: ✅ 日志系统已完成

---

## 📋 日志功能概览

### 日志类型

| 类型 | 位置 | 格式 | 用途 |
|------|------|------|------|
| **任务链日志** | ProcessorWrapper | `[Unified SR] {PROCESSOR}_INPUT/OUTPUT` | 跟踪每个请求的输入输出 |
| **资源使用日志** | service.py | `Resource Usage [{stage}]` | 监控内存、CPU、GPU |
| **错误日志** | 全局异常处理 | `🚨 Uncaught exception` | 捕获未处理的异常 |
| **信号日志** | 信号处理器 | `Received signal {signum}` | 记录进程信号 |
| **启动/关闭日志** | lifespan | `===== Starting/Shutting down` | 服务生命周期 |

---

## 🎯 日志功能特性

### 1. 任务链日志（与中文服务一致）

**输入日志格式**:
```
ZH_REPAIR INPUT: Received repair request | job_id=xxx | session_id=xxx | utterance_index=xxx | text_in='xxx' | text_in_length=xxx | quality_score=xxx | micro_context=xxx
```

**输出日志格式**:
```
ZH_REPAIR OUTPUT: Repair completed | job_id=xxx | session_id=xxx | utterance_index=xxx | decision=REPAIR | text_out='xxx' | text_out_length=xxx | confidence=0.92 | reason_codes=['LOW_QUALITY_SCORE', 'REPAIR_APPLIED'] | repair_time_ms=245 | changed=True
```

**特点**:
- ✅ 统一格式，易于解析
- ✅ 包含所有关键信息
- ✅ 同时输出到 logger 和 stdout（`print(flush=True)`）
- ✅ 支持中文、英文、标准化三种处理器

### 2. 资源使用日志

**监控阶段**:
- `BEFORE_INIT`: 启动前
- `AFTER_ZH_INIT`: 中文处理器初始化后
- `AFTER_EN_INIT`: 英文处理器初始化后
- `AFTER_NORM_INIT`: 标准化处理器初始化后
- `SERVICE_READY`: 服务就绪
- `BEFORE_SHUTDOWN`: 关闭前
- `AFTER_SHUTDOWN`: 关闭后

**日志格式**:
```
[Unified SR] Resource Usage [SERVICE_READY]: Memory=1234.5MB, CPU=25.3%, GPU_Allocated=2.45GB, GPU_Reserved=3.12GB
```

### 3. 全局异常处理

**功能**:
- 捕获所有未处理的异常
- 防止服务崩溃
- 详细的堆栈跟踪
- 不拦截 KeyboardInterrupt（Ctrl+C）

**日志格式**:
```
================================================================================
[Unified SR] 🚨 Uncaught exception in main process, service may crash
[Unified SR] Exception type: ValueError
[Unified SR] Exception value: Invalid model path
[Unified SR] Traceback:
[Unified SR]   File "service.py", line 123, in <module>
[Unified SR]     ...
================================================================================
```

### 4. 信号处理

**支持的信号**:
- `SIGTERM`: 优雅关闭
- `SIGINT`: Ctrl+C

**日志格式**:
```
[Unified SR] Received signal 15, preparing to shutdown...
[Unified SR] SIGTERM received, graceful shutdown
```

### 5. 超时和错误日志

**超时日志**:
```
ZH_REPAIR TIMEOUT: Request timeout | job_id=xxx | elapsed_ms=30000 | timeout_limit=30s | fallback=PASS
```

**错误日志**:
```
ZH_REPAIR ERROR: Processing error | job_id=xxx | error=Model not loaded | fallback=PASS
```

---

## 🛠️ 日志工具

### 1. view_logs.ps1 - 日志查看器

**功能**:
- 检查服务状态和健康检查
- 显示进程信息（PID、内存、CPU）
- 查找并显示所有相关日志文件
- 过滤最近24小时的日志

**使用方法**:
```powershell
.\view_logs.ps1
```

**输出示例**:
```
========================================
Unified Semantic Repair Service - Log Viewer
========================================

[Log Viewer] Checking service status...
[Log Viewer] Service Status: healthy
[Log Viewer] Processors:
[Log Viewer]   - zh_repair: healthy
[Log Viewer]   - en_repair: healthy
[Log Viewer]   - en_normalize: healthy

[Log Viewer] Checking process information...
[Log Viewer] Service PID: 12345
[Log Viewer] Process Name: python
[Log Viewer] Memory Usage: 2345.67 MB
[Log Viewer] CPU Time: 00:05:23.1234567
[Log Viewer] Start Time: 01/19/2026 10:30:15

[Log Viewer] Searching for log files...
[Log Viewer] Found service logs:
[Log Viewer]   - startup_20260119_103015.log (125.45 KB, modified: 01/19/2026 10:35:45)
```

### 2. capture_startup_logs.ps1 - 启动日志捕获

**功能**:
- 捕获服务启动时的所有输出
- 自动创建 logs/ 目录
- 保存到带时间戳的日志文件
- 同时显示到控制台和文件

**使用方法**:
```powershell
.\capture_startup_logs.ps1
```

**输出**:
- 日志文件: `logs/startup_YYYYMMDD_HHMMSS.log`
- 实时控制台输出

---

## 📁 日志文件结构

```
semantic_repair_en_zh/
├── logs/                          📁 日志目录
│   ├── startup_20260119_103015.log    启动日志1
│   ├── startup_20260119_145230.log    启动日志2
│   └── ...
├── view_logs.ps1                  🔧 日志查看器
├── capture_startup_logs.ps1       🔧 日志捕获器
└── LOGGING_SUMMARY.md             📋 本文档
```

---

## 🔍 日志查找和分析

### 通过主进程日志查找

```powershell
# 查找所有统一服务相关日志
Get-Content electron_node\electron-node\logs\electron-main.log | Select-String "Unified SR|semantic-repair-en-zh"

# 查找特定处理器的日志
Get-Content electron_node\electron-node\logs\electron-main.log | Select-String "ZH_REPAIR|EN_REPAIR|EN_NORMALIZE"

# 查找错误日志
Get-Content electron_node\electron-node\logs\electron-main.log | Select-String "ERROR|TIMEOUT"
```

### 通过服务日志查找

```powershell
# 查看最新的启动日志
Get-ChildItem logs\ -Filter "startup_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100

# 查找特定 job_id 的日志
Get-Content logs\startup_*.log | Select-String "job_id=test_001"

# 查找资源使用日志
Get-Content logs\startup_*.log | Select-String "Resource Usage"
```

---

## 📊 日志示例

### 完整请求日志示例

```log
[2026-01-19 10:35:12] [INFO] [Unified SR] ZH_REPAIR INPUT: Received repair request | job_id=test_001 | session_id=session_001 | utterance_index=1 | text_in='你号，世界' | text_in_length=5 | quality_score=0.75 | micro_context=None
[Unified SR] ZH_REPAIR INPUT: Received repair request | job_id=test_001 | session_id=session_001 | utterance_index=1 | text_in='你号，世界' | text_in_length=5 | quality_score=0.75 | micro_context=None
[2026-01-19 10:35:12] [INFO] [Unified SR] ZH_REPAIR OUTPUT: Repair completed | job_id=test_001 | session_id=session_001 | utterance_index=1 | decision=REPAIR | text_out='你好，世界' | text_out_length=5 | confidence=0.92 | reason_codes=['LOW_QUALITY_SCORE', 'REPAIR_APPLIED'] | repair_time_ms=245 | changed=True
[Unified SR] ZH_REPAIR OUTPUT: Repair completed | job_id=test_001 | session_id=session_001 | utterance_index=1 | decision=REPAIR | text_out='你好，世界' | text_out_length=5 | confidence=0.92 | reason_codes=['LOW_QUALITY_SCORE', 'REPAIR_APPLIED'] | repair_time_ms=245 | changed=True
```

### 资源使用日志示例

```log
[Unified SR] Resource Usage [BEFORE_INIT]: Memory=256.3MB, CPU=5.2%
[Unified SR] Resource Usage [AFTER_ZH_INIT]: Memory=1245.7MB, CPU=15.3%, GPU_Allocated=2.45GB, GPU_Reserved=3.12GB
[Unified SR] Resource Usage [AFTER_EN_INIT]: Memory=2345.9MB, CPU=18.7%, GPU_Allocated=4.87GB, GPU_Reserved=6.25GB
[Unified SR] Resource Usage [AFTER_NORM_INIT]: Memory=2346.1MB, CPU=18.8%
[Unified SR] Resource Usage [SERVICE_READY]: Memory=2346.3MB, CPU=19.0%, GPU_Allocated=4.87GB, GPU_Reserved=6.25GB
```

---

## 🎨 日志格式对比

### 与旧服务的对比

| 特性 | 旧服务（中文） | 新服务（统一） | 改进 |
|------|-------------|--------------|------|
| **任务链日志** | ✅ | ✅ | 统一三种处理器 |
| **资源使用日志** | ✅ | ✅ | 更详细的阶段 |
| **全局异常处理** | ✅ | ✅ | 完全一致 |
| **信号处理** | ✅ | ✅ | 完全一致 |
| **日志查看工具** | ✅ view_logs.ps1 | ✅ view_logs.ps1 | 适配新服务 |
| **日志捕获工具** | ✅ capture_startup_logs.ps1 | ✅ capture_startup_logs.ps1 | 适配新服务 |
| **统一输出** | logger + print | logger + print | 完全一致 |

---

## ✅ 日志功能检查清单

### 代码层面

- [x] ProcessorWrapper 任务链日志（INPUT/OUTPUT）
- [x] 超时日志（TIMEOUT）
- [x] 错误日志（ERROR）
- [x] 全局异常处理器
- [x] 信号处理器（SIGTERM/SIGINT）
- [x] 资源使用日志（7个阶段）
- [x] 启动/关闭日志
- [x] 同时输出到 logger 和 stdout

### 工具层面

- [x] view_logs.ps1（日志查看器）
- [x] capture_startup_logs.ps1（日志捕获器）
- [x] logs/ 目录结构

### 文档层面

- [x] LOGGING_SUMMARY.md（本文档）
- [x] README.md 更新
- [x] 日志使用示例

---

## 🚀 快速开始

### 1. 启动服务并捕获日志

```powershell
.\capture_startup_logs.ps1
```

### 2. 查看日志

```powershell
.\view_logs.ps1
```

### 3. 分析特定请求

```powershell
# 查找特定 job_id
Get-Content logs\*.log | Select-String "job_id=test_001"

# 查看资源使用变化
Get-Content logs\*.log | Select-String "Resource Usage"
```

---

## 📚 相关文档

- [README.md](./README.md) - 服务主文档
- [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) - 故障排查（包含日志分析）
- [MAINTENANCE_GUIDE.md](./docs/MAINTENANCE_GUIDE.md) - 维护指南（包含日志管理）

---

**更新**: 2026-01-19  
**维护**: 开发团队
