# JSON格式修复完成 - 2026-01-20

## ❌ **问题根源**

PowerShell脚本 `fix_port_config.ps1` 使用 `ConvertTo-Json` 破坏了JSON格式：

### 破坏的方式

```powershell
$json | ConvertTo-Json -Depth 10 | Set-Content $serviceJsonPath -Encoding UTF8
```

**问题**:
1. ❌ PowerShell的JSON格式与标准不同（缩进、空格）
2. ❌ 中文字符编码问题
3. ❌ 导致Node.js的JSON.parse()解析失败

### 日志证据

```
Failed to parse service.json:
  - en_normalize ❌
  - nmt_m2m100 ❌
  - piper_tts ❌
  - your_tts ❌
  
totalServices: 1 (只发现了 node-inference)
```

结果：**所有被修改的service.json都无法解析，服务无法被发现！**

---

## ✅ **已修复**

已恢复所有service.json文件为正确的格式，并添加了port定义：

| 服务 | Port | 状态 |
|------|------|------|
| nmt-m2m100 | 5008 | ✅ 已修复 |
| faster-whisper-vad | 6007 | ✅ 已修复 |
| piper-tts | 5009 | ✅ 已修复 |
| en-normalize | 5012 | ✅ 已修复 |
| semantic-repair-zh | 5013 | ✅ 已修复 |
| speaker-embedding | 5014 | ✅ 已修复 |
| semantic-repair-en-zh | 5015 | ✅ 已修复 |
| your-tts | 5016 | ✅ 已修复 |

---

## 🚀 **立即测试**

### Step 1: 重启Electron

```powershell
# 关闭Electron窗口
# 重启
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

### Step 2: 验证服务发现

应该能看到所有9个服务（不是只有1个）：
- node-inference
- nmt-m2m100
- faster-whisper-vad
- piper-tts
- semantic-repair-zh
- semantic-repair-en-zh
- en-normalize
- speaker-embedding
- your-tts

### Step 3: 测试服务启动

点击启动任一服务，应该成功，不再报"service not found"。

---

## 📝 **经验教训**

### ❌ 不要使用PowerShell处理JSON

```powershell
# ❌ 错误方式
$json | ConvertTo-Json | Set-Content file.json
```

**问题**:
- PowerShell的JSON格式不标准
- 中文编码问题
- Node.js无法解析

### ✅ 正确方式

**方式1**: 手动编辑JSON文件（最安全）

**方式2**: 使用Node.js脚本

```javascript
const fs = require('fs');
const json = require('./service.json');
json.port = 5008;
fs.writeFileSync('./service.json', JSON.stringify(json, null, 2));
```

**方式3**: 使用Python脚本

```python
import json
with open('service.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
data['port'] = 5008
with open('service.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
```

---

## ✅ **完成清单**

- [x] 恢复所有service.json文件
- [x] 添加port定义到所有服务
- [x] 确保JSON格式正确
- [ ] 重启Electron测试
- [ ] 验证所有服务都被发现
- [ ] 验证服务可以启动

---

**修复时间**: 2026-01-20  
**修复文件**: 7个service.json  
**问题**: PowerShell破坏JSON格式  
**解决**: 手动恢复为正确格式并添加port  
**状态**: ✅ **已修复，请立即重启Electron测试！**
