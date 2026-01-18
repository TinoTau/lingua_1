# 维护指南

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0

---

## 📋 目录

- [日常维护](#日常维护)
- [模型管理](#模型管理)
- [日志管理](#日志管理)
- [性能监控](#性能监控)
- [备份与恢复](#备份与恢复)
- [升级指南](#升级指南)

---

## 🔄 日常维护

### 服务状态检查

#### 通过服务管理器检查
```typescript
const status = semanticRepairServiceManager.getServiceStatus('semantic-repair-en-zh');
console.log(status);
// {
//   running: true/false,
//   pid: 进程ID,
//   port: 5015,
//   startedAt: 启动时间,
//   lastError: 最后错误
// }
```

#### 通过 API 检查
```bash
# 全局健康检查
curl http://localhost:5015/health

# 预期响应
{
  "status": "healthy",
  "processors": {
    "zh_repair": {"status": "healthy", ...},
    "en_repair": {"status": "healthy", ...},
    "en_normalize": {"status": "healthy", ...}
  }
}
```

### 重启服务

```typescript
// 停止服务
await semanticRepairServiceManager.stopService('semantic-repair-en-zh');

// 等待几秒
await new Promise(resolve => setTimeout(resolve, 3000));

// 启动服务
await semanticRepairServiceManager.startService('semantic-repair-en-zh');
```

### 服务日志查看

**服务启动日志**:
```
[Unified SR] ===== Starting Unified Semantic Repair Service =====
[Config] Found zh model: .../models/qwen2.5-3b-instruct-zh-gguf/*.gguf
[Config] Found en model: .../models/qwen2.5-3b-instruct-en-gguf/*.gguf
[Unified SR] Service ready with 3 processor(s)
```

**正常请求日志**:
```
[zh_repair] INPUT | request_id=test-001 | text_in='你号' | text_length=2
[zh_repair] OUTPUT | request_id=test-001 | decision=REPAIR | text_out='你好'
```

**异常日志**:
```
[zh_repair] ERROR | request_id=test-002 | error=... | fallback=PASS
```

---

## 🗄️ 模型管理

### 模型文件位置

```
semantic_repair_en_zh/
└── models/
    ├── qwen2.5-3b-instruct-zh-gguf/
    │   └── *.gguf (~2GB)
    └── qwen2.5-3b-instruct-en-gguf/
        └── *.gguf (~2GB)
```

### 检查模型完整性

```powershell
# 检查模型文件存在
Test-Path "models\qwen2.5-3b-instruct-zh-gguf\*.gguf"
Test-Path "models\qwen2.5-3b-instruct-en-gguf\*.gguf"

# 检查文件大小（应该在 1.8-2.2GB 之间）
Get-ChildItem models\*\*.gguf | Select-Object Name, @{N='Size(GB)';E={[math]::Round($_.Length/1GB, 2)}}
```

### 模型更新

**步骤**:
1. 停止服务
2. 备份旧模型
3. 替换新模型
4. 启动服务测试
5. 验证功能正常

```powershell
# 1. 停止服务
# (通过服务管理器)

# 2. 备份旧模型
Copy-Item -Path "models" -Destination "models.backup_$(Get-Date -Format 'yyyyMMdd')" -Recurse

# 3. 替换模型文件
Copy-Item -Path "新模型路径\*.gguf" -Destination "models\qwen2.5-3b-instruct-zh-gguf\" -Force

# 4. 启动服务
# (通过服务管理器)

# 5. 测试
curl -X POST http://localhost:5015/zh/repair -d '{"job_id":"test","session_id":"s1","text_in":"你号"}'
```

### 模型损坏恢复

如果模型文件损坏或丢失：

```powershell
# 从备份恢复
Copy-Item -Path "models.backup_YYYYMMDD\*" -Destination "models\" -Recurse -Force

# 或从旧服务复制
.\setup_models.ps1
```

---

## 📊 日志管理

### 日志级别

服务支持以下日志级别（通过环境变量控制）:
```bash
LOG_LEVEL=DEBUG   # 调试信息（详细）
LOG_LEVEL=INFO    # 默认级别
LOG_LEVEL=WARNING # 仅警告和错误
LOG_LEVEL=ERROR   # 仅错误
```

### 日志清理

**日志文件位置**: 控制台输出（由服务管理器捕获）

**清理建议**:
- 定期检查日志大小
- 保留最近 30 天的日志
- 压缩归档旧日志

---

## 📈 性能监控

### 关键指标

#### 1. 响应时间
```bash
# 测试响应时间
time curl -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d '{"job_id":"perf-test","session_id":"s1","text_in":"测试文本"}'
```

**预期值**:
- 首次请求（模型加载）: ~30秒
- 后续请求（GPU）: 200-500ms
- 后续请求（CPU）: 2000-4000ms

#### 2. GPU 使用率

```powershell
# 使用 nvidia-smi 监控
nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used --format=csv -lms 1000
```

**预期值**:
- GPU 利用率: 80-100%（推理时）
- 显存占用: ~2GB（单模型）

#### 3. CPU 使用率

**预期值**:
- GPU 模式: 10-30%
- CPU 模式: 80-100%

### 性能问题诊断

**问题**: 响应速度慢（>2秒）

**可能原因**:
1. ❌ GPU 未启用 → 检查 llama-cpp-python CUDA 支持
2. ❌ 模型在 CPU 上运行 → 检查启动日志中的设备分配
3. ❌ 多个请求并发 → 检查并发控制（max_concurrency: 1）

**解决方案**: 参考 [故障排查指南](./TROUBLESHOOTING.md)

---

## 💾 备份与恢复

### 需要备份的内容

| 内容 | 路径 | 大小 | 频率 |
|------|------|------|------|
| **模型文件** | `models/` | ~4GB | 模型更新时 |
| **配置文件** | `service.json`, `config.py` | <10KB | 修改时 |
| **服务代码** | `*.py` | <1MB | 更新时 |

### 备份脚本

```powershell
# backup.ps1
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupDir = "D:\backups\semantic_repair_en_zh\$timestamp"

New-Item -Path $backupDir -ItemType Directory -Force

# 备份配置和代码
Copy-Item -Path "service.json" -Destination $backupDir
Copy-Item -Path "config.py" -Destination $backupDir
Copy-Item -Path "service.py" -Destination $backupDir

# 备份模型（如果需要）
# Copy-Item -Path "models" -Destination $backupDir -Recurse

Write-Host "Backup completed: $backupDir"
```

### 恢复流程

1. 停止服务
2. 恢复文件
3. 验证配置
4. 启动服务
5. 测试功能

---

## 🔄 升级指南

### 代码升级

```bash
# 1. 备份当前版本
cp -r semantic_repair_en_zh semantic_repair_en_zh.backup

# 2. 更新代码
git pull origin main

# 3. 检查依赖
pip install -r requirements.txt --upgrade

# 4. 重启服务
# (通过服务管理器)

# 5. 验证功能
python check_syntax.py
pytest tests/ -v
```

### Python 依赖升级

```bash
# 查看当前版本
pip list | grep -E "fastapi|llama-cpp-python|pydantic"

# 升级特定包
pip install --upgrade fastapi
pip install --upgrade pydantic

# 升级所有依赖（谨慎）
pip install -r requirements.txt --upgrade
```

**注意**: llama-cpp-python 升级可能需要重新编译 CUDA 支持。

### 模型升级

参考 [模型管理](#模型管理) 章节。

---

## 🛡️ 安全维护

### 端口安全

- 服务端口 5015 应仅在内网访问
- 不要暴露到公网
- 使用防火墙限制访问

### 模型文件安全

- 定期备份模型文件
- 检查文件完整性（MD5/SHA256）
- 防止未授权修改

### 日志安全

- 不要在日志中记录敏感信息
- 定期清理旧日志
- 限制日志文件访问权限

---

## 📋 维护检查清单

### 每日检查
- [ ] 服务运行状态正常
- [ ] API 响应正常
- [ ] 无异常错误日志

### 每周检查
- [ ] 检查磁盘空间（模型文件占用）
- [ ] 检查日志大小
- [ ] 性能指标正常

### 每月检查
- [ ] 备份模型文件
- [ ] 备份配置文件
- [ ] 检查依赖更新
- [ ] 审查异常日志

---

## 📞 支持联系

遇到问题时：
1. 首先查阅 [故障排查指南](./TROUBLESHOOTING.md)
2. 检查相关日志
3. 联系开发团队

---

**更新**: 2026-01-19  
**维护**: 开发团队
