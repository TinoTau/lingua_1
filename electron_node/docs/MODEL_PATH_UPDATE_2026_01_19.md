# 模型路径配置更新

**日期**: 2026-01-19  
**类型**: 模型路径独立化

---

## 📋 更新内容

### 变更说明

新的统一服务 (`semantic-repair-en-zh`) 现在**只使用本服务目录下的模型**，不再从旧服务目录查找模型。

### 配置变更

**修改文件**: `electron_node/services/semantic_repair_en_zh/config.py`

**旧逻辑**（查找顺序）:
1. 首先在统一服务目录查找
2. 如果未找到，回退到旧服务目录查找

**新逻辑**（独立查找）:
1. **仅**在统一服务目录查找
2. 如果未找到，报错并提示用户安装

---

## 🎯 优势

### 1. 独立部署
- 服务可以独立部署，不依赖旧服务目录
- 整个服务目录可以独立迁移

### 2. 版本隔离
- 避免旧服务模型更新影响新服务
- 每个服务管理自己的模型版本

### 3. 清晰管理
- 明确的资源归属
- 便于资源清理和维护

### 4. 部署简化
- 不需要保留旧服务目录
- 减少目录依赖关系

---

## 📁 新的目录结构

```
semantic_repair_en_zh/
├── service.py
├── config.py
└── models/                                    # ⭐ 必需
    ├── qwen2.5-3b-instruct-zh-gguf/          # 中文模型
    │   └── qwen2.5-3b-instruct-zh-q4_0.gguf
    └── qwen2.5-3b-instruct-en-gguf/          # 英文模型
        └── qwen2.5-3b-instruct-en-q4_0.gguf
```

---

## 🚀 模型安装

### 快速安装脚本（推荐）

```powershell
cd electron_node/services/semantic_repair_en_zh
.\setup_models.ps1
```

**脚本功能**:
- ✅ 自动创建目录结构
- ✅ 优先使用硬链接（节省空间）
- ✅ 硬链接失败时自动复制
- ✅ 验证安装结果

### 手动安装

#### 方式 1: 完整复制（独立部署）

```powershell
cd semantic_repair_en_zh

# 创建目录
New-Item -Path "models" -ItemType Directory -Force

# 复制中文模型
Copy-Item -Path "..\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf" `
          -Destination "models\" -Recurse

# 复制英文模型
Copy-Item -Path "..\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf" `
          -Destination "models\" -Recurse
```

**空间占用**: ~4GB

#### 方式 2: 硬链接（节省空间，推荐）

```powershell
cd semantic_repair_en_zh

# 创建目录
New-Item -Path "models\qwen2.5-3b-instruct-zh-gguf" -ItemType Directory -Force
New-Item -Path "models\qwen2.5-3b-instruct-en-gguf" -ItemType Directory -Force

# 创建硬链接（找到实际的 .gguf 文件名）
New-Item -ItemType HardLink `
         -Path "models\qwen2.5-3b-instruct-zh-gguf\qwen2.5-3b-instruct-zh-q4_0.gguf" `
         -Target "..\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf\qwen2.5-3b-instruct-zh-q4_0.gguf"

New-Item -ItemType HardLink `
         -Path "models\qwen2.5-3b-instruct-en-gguf\qwen2.5-3b-instruct-en-q4_0.gguf" `
         -Target "..\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf\qwen2.5-3b-instruct-en-q4_0.gguf"
```

**空间占用**: ~11MB（链接文件）
**优点**: 不需要管理员权限，节省磁盘空间

#### 方式 3: 符号链接（需要管理员权限）

```powershell
# 以管理员身份运行 PowerShell
cd semantic_repair_en_zh
New-Item -Path "models" -ItemType Directory -Force

New-Item -ItemType SymbolicLink `
         -Path "models\qwen2.5-3b-instruct-zh-gguf" `
         -Target "..\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf"

New-Item -ItemType SymbolicLink `
         -Path "models\qwen2.5-3b-instruct-en-gguf" `
         -Target "..\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf"
```

---

## 🔍 验证安装

### 1. 检查文件存在

```powershell
# 检查中文模型
Test-Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf\*.gguf"

# 检查英文模型
Test-Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-en-gguf\*.gguf"

# 都应返回 True
```

### 2. 启动服务测试

```bash
cd semantic_repair_en_zh
python service.py
```

**成功输出**:
```
[Config] Found zh model: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf\qwen2.5-3b-instruct-zh-q4_0.gguf
[Config] Found en model: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-en-gguf\qwen2.5-3b-instruct-en-q4_0.gguf
...
[Unified SR] Service ready with 3 processor(s)
```

**失败输出**（模型未找到）:
```
[Config] WARNING: zh model not found at: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf
[Config] Please copy model to: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf
```

---

## 📚 相关文档

### 新增文档

1. **MODELS_SETUP_GUIDE.md** - 详细的模型安装指南
   - 多种安装方式说明
   - 常见问题解答
   - 自动安装脚本

2. **setup_models.ps1** - 自动安装脚本
   - 一键安装模型
   - 自动验证
   - 智能回退（硬链接失败时复制）

### 更新文档

3. **README.md** - 添加模型安装步骤
4. **DEPLOYMENT_CHECKLIST.md** - 更新模型检查说明

---

## 📊 修改对比

| 项目 | 旧配置 | 新配置 | 说明 |
|------|--------|--------|------|
| 查找路径 | 2个位置 | 1个位置 | 仅本服务目录 |
| Fallback | 有（旧服务） | 无 | 不依赖旧服务 |
| 错误提示 | 列出多个路径 | 精确提示 | 明确安装位置 |
| 独立性 | 低（依赖旧服务） | 高（完全独立） | 可独立部署 |

---

## ⚠️ 注意事项

### 对现有部署的影响

1. **首次启动需要模型**
   - 如果 `models/` 目录不存在，服务将无法启动
   - 需要先运行 `setup_models.ps1` 或手动安装

2. **旧服务不受影响**
   - 旧服务继续使用自己目录的模型
   - 不会互相干扰

3. **磁盘空间**
   - 完整复制需要额外 ~4GB
   - 使用硬链接几乎不占用额外空间

### 部署建议

**新部署**:
- 使用硬链接（推荐）
- 或完整复制（如需独立部署）

**测试环境**:
- 使用硬链接节省空间
- 便于快速测试

**生产环境**:
- 建议完整复制
- 确保服务完全独立
- 避免误删旧服务影响新服务

---

## 🔄 回滚方案

如果需要恢复旧的模型查找逻辑：

```python
# 修改 config.py 中的 _find_model 方法
def _find_model(self, lang: str) -> Optional[str]:
    # 恢复旧的查找逻辑
    possible_dirs = [
        os.path.join(self.service_dir, 'models', model_dir_name),
        os.path.join(
            os.path.dirname(self.service_dir),
            f'semantic_repair_{lang}',
            'models',
            model_dir_name
        )
    ]
    # ... 原有的查找代码
```

---

## ✅ 更新检查清单

- [x] 修改 `config.py` 模型查找逻辑
- [x] 创建 `MODELS_SETUP_GUIDE.md` 文档
- [x] 创建 `setup_models.ps1` 安装脚本
- [x] 更新 `README.md`
- [x] 更新 `DEPLOYMENT_CHECKLIST.md`
- [ ] 运行 `setup_models.ps1` 安装模型
- [ ] 验证服务启动成功
- [ ] 测试模型加载正常

---

## 🎓 相关资源

### 文档
- [模型安装指南](./electron_node/services/semantic_repair_en_zh/MODELS_SETUP_GUIDE.md) - 详细步骤
- [服务 README](./electron_node/services/semantic_repair_en_zh/README.md) - 使用指南
- [部署检查清单](./electron_node/services/semantic_repair_en_zh/DEPLOYMENT_CHECKLIST.md) - 验证步骤

### 脚本
- `setup_models.ps1` - 一键安装脚本（推荐使用）

---

**状态**: ✅ **配置已更新，需要安装模型**  
**下一步**: 运行 `setup_models.ps1` 安装模型  
**影响**: 服务需要本地模型才能启动  
**兼容**: 不影响旧服务运行

---

**更新人**: AI Assistant  
**审核人**: ___________  
**生效日期**: 2026-01-19
