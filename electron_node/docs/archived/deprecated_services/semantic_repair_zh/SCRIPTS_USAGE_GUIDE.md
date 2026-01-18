# Semantic Repair ZH Service - 脚本使用指南

## 脚本清单和用途

### 0. `start_all_in_one.ps1` - 一键启动脚本（推荐）⭐
**用途**：自动执行完整的启动流程  
**何时使用**：想要一键启动并自动检查所有状态时使用  
**特点**：
- 自动检查环境（Python、端口、模型目录）
- 启动服务并等待就绪
- 自动检查服务状态
- 自动显示诊断信息
- 实时显示服务输出
- 检测潜在问题并发出警告

**使用方法**：
```powershell
cd electron_node\services\semantic_repair_zh
.\start_all_in_one.ps1
```

**这是最推荐的启动方式！**

---

### 1. `start_debug.ps1` - 调试启动脚本
**用途**：启动服务并显示详细的启动日志  
**何时使用**：需要查看服务启动过程的详细日志时使用  
**特点**：
- 检查 Python 环境和依赖
- 检查 CUDA 可用性
- 检查模型目录和文件
- 检查端口占用
- 启动服务并实时显示所有输出

**使用方法**：
```powershell
cd electron_node\services\semantic_repair_zh
.\start_debug.ps1
```

---

### 2. `capture_startup_logs.ps1` - 启动日志捕获脚本
**用途**：启动服务并将日志保存到文件  
**何时使用**：需要将启动日志保存到文件以便后续分析时使用  
**特点**：
- 自动创建 `logs/` 目录
- 将日志保存到 `logs/startup_YYYYMMDD_HHMMSS.log`
- 同时显示在控制台

**使用方法**：
```powershell
cd electron_node\services\semantic_repair_zh
.\capture_startup_logs.ps1
```

---

### 3. `check_service_status.py` - 服务状态检查脚本
**用途**：检查运行中的服务状态  
**何时使用**：服务已经启动后，需要检查服务状态时使用  
**特点**：
- 检查健康状态
- 显示进程信息（PID、内存、CPU、运行时间）
- 检查 GPU 信息
- 测试修复端点

**使用方法**：
```powershell
cd electron_node\services\semantic_repair_zh
python check_service_status.py
```

---

### 4. `check_gpu_usage.py` - GPU 使用情况检查脚本
**用途**：检查 GPU 内存使用情况（推理前后对比）  
**何时使用**：需要诊断 GPU 内存问题时使用  
**特点**：
- 检查推理前的 GPU 状态
- 执行一次测试推理
- 检查推理后的 GPU 状态
- 显示内存变化

**使用方法**：
```powershell
cd electron_node\services\semantic_repair_zh
python check_gpu_usage.py
```

---

### 5. `view_logs.ps1` - 日志查看脚本
**用途**：查看已保存的日志文件  
**何时使用**：需要查看历史日志时使用  
**特点**：
- 查找主进程日志文件
- 查找服务日志文件
- 显示最近的日志内容

**使用方法**：
```powershell
cd electron_node\services\semantic_repair_zh
.\view_logs.ps1
```

---

## 推荐使用流程

### 场景0：一键启动（最简单，推荐）⭐

**只需一步**：
```powershell
cd electron_node\services\semantic_repair_zh
.\start_all_in_one.ps1
```

这个脚本会自动：
1. 检查环境
2. 启动服务
3. 等待服务就绪
4. 检查服务状态
5. 显示诊断信息

**这是最推荐的启动方式！**

---

### 场景1：首次启动服务（查看详细启动日志）

**步骤1**：使用调试启动脚本启动服务
```powershell
cd electron_node\services\semantic_repair_zh
.\start_debug.ps1
```

**步骤2**：等待服务启动完成（看到 "Service is ready" 消息）

**步骤3**：在另一个终端窗口检查服务状态
```powershell
cd electron_node\services\semantic_repair_zh
python check_service_status.py
```

**步骤4**：如果需要检查 GPU 使用情况
```powershell
cd electron_node\services\semantic_repair_zh
python check_gpu_usage.py
```

---

### 场景2：保存启动日志到文件

**步骤1**：使用日志捕获脚本启动服务
```powershell
cd electron_node\services\semantic_repair_zh
.\capture_startup_logs.ps1
```

**步骤2**：等待服务启动完成

**步骤3**：查看保存的日志文件
```powershell
cd electron_node\services\semantic_repair_zh
.\view_logs.ps1
```

或直接查看日志文件：
```powershell
Get-Content logs\startup_*.log -Tail 100
```

---

### 场景3：服务已运行，需要诊断问题

**步骤1**：检查服务状态
```powershell
cd electron_node\services\semantic_repair_zh
python check_service_status.py
```

**步骤2**：检查 GPU 使用情况
```powershell
cd electron_node\services\semantic_repair_zh
python check_gpu_usage.py
```

**步骤3**：查看诊断端点（使用 curl 或浏览器）
```bash
curl http://127.0.0.1:5013/diagnostics
```

**步骤4**：查看历史日志
```powershell
cd electron_node\services\semantic_repair_zh
.\view_logs.ps1
```

---

## 脚本执行顺序总结

### 最简单方式（推荐）：
1. **`start_all_in_one.ps1`** - 一键启动，自动完成所有步骤 ⭐

### 手动启动方式：

#### 启动服务时：
1. **`start_debug.ps1`** 或 **`capture_startup_logs.ps1`** （二选一）
   - `start_debug.ps1`：实时查看日志
   - `capture_startup_logs.ps1`：保存日志到文件

#### 服务运行后：
2. **`check_service_status.py`** - 检查服务状态
3. **`check_gpu_usage.py`** - 检查 GPU 使用情况（可选）
4. **`view_logs.ps1`** - 查看历史日志（可选）

---

## 快速参考

| 脚本 | 用途 | 执行时机 | 输出 | 推荐度 |
|------|------|----------|------|--------|
| `start_all_in_one.ps1` | 一键启动（自动完成所有步骤） | 启动服务时 | 完整启动流程 + 诊断信息 | ⭐⭐⭐⭐⭐ |
| `start_debug.ps1` | 启动服务（调试模式） | 启动服务时 | 控制台实时输出 | ⭐⭐⭐⭐ |
| `capture_startup_logs.ps1` | 启动服务（保存日志） | 启动服务时 | 日志文件 + 控制台 | ⭐⭐⭐ |
| `check_service_status.py` | 检查服务状态 | 服务运行后 | 状态信息 | ⭐⭐⭐⭐ |
| `check_gpu_usage.py` | 检查 GPU 使用 | 服务运行后 | GPU 内存信息 | ⭐⭐⭐ |
| `view_logs.ps1` | 查看历史日志 | 任何时候 | 日志内容 | ⭐⭐⭐ |

---

## 注意事项

1. **不要同时运行多个启动脚本**：`start_debug.ps1` 和 `capture_startup_logs.ps1` 都会启动服务，不要同时运行。

2. **服务必须已启动**：`check_service_status.py` 和 `check_gpu_usage.py` 需要服务已经运行。

3. **端口冲突**：如果服务已经在运行（通过 Electron 或其他方式），启动脚本会失败，因为端口 5013 已被占用。

4. **日志文件位置**：
   - `capture_startup_logs.ps1` 保存到：`logs/startup_YYYYMMDD_HHMMSS.log`
   - `view_logs.ps1` 查找：`electron_node/electron-node/logs/electron-main.log`

---

## 常见问题

**Q: 我应该使用哪个启动脚本？**  
A: 
- 需要实时查看日志：使用 `start_debug.ps1`
- 需要保存日志到文件：使用 `capture_startup_logs.ps1`

**Q: 服务已经在运行，如何查看状态？**  
A: 使用 `check_service_status.py` 或访问 `http://127.0.0.1:5013/health` 和 `http://127.0.0.1:5013/diagnostics`

**Q: 如何查看启动日志？**  
A: 
- 如果使用 `capture_startup_logs.ps1`：查看 `logs/startup_*.log` 文件
- 如果使用 `start_debug.ps1`：日志显示在控制台
- 如果通过 Electron 启动：使用 `view_logs.ps1` 查看主进程日志
