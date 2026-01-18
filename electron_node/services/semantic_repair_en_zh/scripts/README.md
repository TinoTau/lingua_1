# 脚本使用指南

**服务**: semantic-repair-en-zh  
**最后更新**: 2026-01-19

---

## 📁 脚本目录结构

```
scripts/
├── service/         # 服务管理脚本
│   ├── start_service.ps1      # 启动服务
│   └── setup_models.ps1       # 安装/复制模型
│
├── logs/            # 日志相关脚本
│   ├── view_logs.ps1          # 查看服务日志
│   └── capture_startup_logs.ps1  # 捕获启动日志
│
└── utils/           # 工具脚本
    ├── fix_config.ps1         # 修复配置文件
    └── check_syntax.py        # Python语法检查
```

---

## 🚀 服务管理脚本 (service/)

### start_service.ps1
**用途**: 启动语义修复服务

**使用方法**:
```powershell
.\scripts\service\start_service.ps1
```

**功能**:
- 检查 Python 环境
- 启动 FastAPI 服务
- 显示服务启动信息

---

### setup_models.ps1
**用途**: 从旧服务复制模型文件到新服务

**使用方法**:
```powershell
.\scripts\service\setup_models.ps1
```

**功能**:
- 从 `semantic_repair_zh` 复制中文模型
- 从 `semantic_repair_en` 复制英文模型
- 创建必要的目录结构
- 验证模型文件

**前置条件**:
- 旧的语义修复服务已安装
- 模型文件已下载

---

## 📋 日志相关脚本 (logs/)

### view_logs.ps1
**用途**: 查看服务日志（实时或历史）

**使用方法**:
```powershell
# 查看今天的日志
.\scripts\logs\view_logs.ps1

# 查看特定日期的日志
.\scripts\logs\view_logs.ps1 -Date "2026-01-19"
```

**功能**:
- 列出可用的日志文件
- 显示日志内容
- 支持日期过滤
- 高亮关键信息（ERROR, WARNING等）

---

### capture_startup_logs.ps1
**用途**: 捕获服务启动日志到文件

**使用方法**:
```powershell
.\scripts\logs\capture_startup_logs.ps1
```

**功能**:
- 启动服务并捕获输出
- 保存到带时间戳的日志文件
- 用于诊断启动问题

**输出位置**: `logs/startup_YYYYMMDD_HHMMSS.log`

---

## 🔧 工具脚本 (utils/)

### fix_config.ps1
**用途**: 修复 electron-node-config.json 配置文件

**使用方法**:
```powershell
.\scripts\utils\fix_config.ps1
```

**功能**:
- 定位 electron-node-config.json 文件
- 备份原配置文件
- 设置新服务为启用
- 设置旧服务为禁用

**修改内容**:
```json
{
  "servicePreferences": {
    "semanticRepairZhEnabled": false,
    "semanticRepairEnEnabled": false,
    "enNormalizeEnabled": false,
    "semanticRepairEnZhEnabled": true
  }
}
```

---

### check_syntax.py
**用途**: 检查 Python 代码语法

**使用方法**:
```bash
python scripts/utils/check_syntax.py <file_path>

# 检查整个服务
python scripts/utils/check_syntax.py .
```

**功能**:
- 递归检查 Python 文件
- 报告语法错误
- 显示错误位置

---

## 📊 常见使用场景

### 场景1: 首次部署

```powershell
# 1. 安装模型
.\scripts\service\setup_models.ps1

# 2. 检查语法
python scripts/utils/check_syntax.py .

# 3. 启动服务
.\scripts\service\start_service.ps1
```

---

### 场景2: 日常运维

```powershell
# 查看最新日志
.\scripts\logs\view_logs.ps1

# 重启服务
# 先停止（Ctrl+C），然后重新启动
.\scripts\service\start_service.ps1
```

---

### 场景3: 故障诊断

```powershell
# 1. 捕获启动日志
.\scripts\logs\capture_startup_logs.ps1

# 2. 查看错误日志
.\scripts\logs\view_logs.ps1

# 3. 检查配置
.\scripts\utils\fix_config.ps1
```

---

### 场景4: 更新配置

```powershell
# 1. 修复配置（切换到新服务）
.\scripts\utils\fix_config.ps1

# 2. 重启 Electron 应用
# 3. 验证新服务是否启用
```

---

## 🔍 脚本依赖

### PowerShell脚本
- **PowerShell 5.1+** (Windows 自带)
- 部分脚本需要管理员权限

### Python脚本
- **Python 3.8+**
- 无额外依赖（仅使用标准库）

---

## ⚠️ 注意事项

### 路径问题
- 所有脚本应该从服务根目录运行
- 使用相对路径 `.\scripts\...`

### 权限问题
- 某些脚本可能需要管理员权限
- 如遇权限错误，以管理员身份运行 PowerShell

### 并发问题
- 同一时间只能运行一个服务实例
- 启动前确保没有其他实例在运行

---

## 📚 相关文档

- **[../README.md](../README.md)** - 服务主文档
- **[../docs/scripts/SCRIPTS_USAGE_GUIDE.md](../docs/scripts/SCRIPTS_USAGE_GUIDE.md)** - 详细脚本文档
- **[../docs/operations/TROUBLESHOOTING.md](../docs/operations/TROUBLESHOOTING.md)** - 故障排查指南

---

## 🔗 快速链接

| 用途 | 脚本 |
|------|------|
| 启动服务 | `scripts/service/start_service.ps1` |
| 安装模型 | `scripts/service/setup_models.ps1` |
| 查看日志 | `scripts/logs/view_logs.ps1` |
| 捕获启动日志 | `scripts/logs/capture_startup_logs.ps1` |
| 修复配置 | `scripts/utils/fix_config.ps1` |
| 语法检查 | `scripts/utils/check_syntax.py` |

---

**最后更新**: 2026-01-19  
**维护者**: Lingua Team
