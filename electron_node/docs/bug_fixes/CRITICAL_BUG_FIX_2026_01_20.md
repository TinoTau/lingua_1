# 紧急Bug修复 - 2026-01-20

## ❌ **发现的严重问题**

PowerShell脚本 `fix_port_config.ps1` 错误地覆盖了 `semantic_repair_en_zh/service.json`！

### 错误内容

文件被替换成了piper-tts的配置：

```json
{
    "id":  "piper-tts",  // ❌ 错误！应该是 "semantic-repair-en-zh"
    "name":  "Piper Tts",
    ...
}
```

这导致：
1. ❌ 服务ID不匹配
2. ❌ 启动时找不到服务：`service not found`
3. ❌ 配置完全错误

---

## ✅ **已修复**

已恢复 `semantic_repair_en_zh/service.json` 的正确内容。

---

## 🔧 **修复脚本问题**

### 脚本Bug

```powershell
$serviceDir = Join-Path $servicesDir $serviceId.Replace("-", "_")
```

问题：
- "semantic_repair_en_zh" → "semantic_repair_en_zh" (正确)
- 但脚本逻辑有问题，导致覆盖了错误的文件

---

## 🚀 **立即行动**

### Step 1: 重启Electron

```powershell
# 关闭Electron窗口
# 重启
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### Step 2: 测试服务

现在应该可以正常启动服务了。

---

## 📋 **验证清单**

- [x] 恢复semantic_repair_en_zh/service.json
- [ ] 重启Electron
- [ ] 验证服务可以启动

---

**修复时间**: 2026-01-20  
**问题**: PowerShell脚本错误覆盖文件  
**状态**: ✅ 已修复，等待测试
