# 关键端口问题诊断 - 2026-01-20

## ❌ **发现的严重问题**

从日志中发现：**服务实际使用的端口与service.json定义的不一致！**

### 日志证据

```
NMT服务：
  service.json定义: 8002
  实际使用: 5008  ❌

faster-whisper-vad：
  service.json定义: 8001
  实际使用: 6007  ❌

semantic-repair-zh：
  尝试使用: 5013
  ERROR: 端口被占用  ❌

en-normalize：
  尝试使用: 5012
  ERROR: 端口被占用  ❌

semantic-repair-en-zh：
  尝试使用: 5015
  ERROR: 端口被占用  ❌
```

---

## 🔍 **问题分析**

### 问题1: 端口不一致

**我的端口释放检查代码检查的是错误的端口！**

```typescript
// 我检查的是service.json中的端口（如8002）
const port = entry.def.port;  // 8002
await this.waitForPortRelease(port, 3000);

// 但服务实际使用的是另一个端口（如5008）！
```

### 问题2: 端口仍被占用

即使服务显示"已停止"，旧进程仍然占用着端口。

---

## 🚨 **立即解决方案**

### 方案1: 强制Kill所有Python进程

```powershell
# 1. Kill所有Python进程
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 验证没有进程
Get-Process python -ErrorAction SilentlyContinue

# 3. 验证端口已释放
netstat -ano | findstr "5008 5012 5013 5015 6007"
# 应该没有输出

# 4. 重启Electron
npm start
```

### 方案2: 找出端口不一致的原因

**需要检查**:
1. 每个服务的service.json
2. 每个服务的Python代码中硬编码的端口
3. 环境变量

---

## 🔧 **修复计划**

### 修复1: 统一端口定义

**检查所有服务**，确保：
- service.json中的port与Python代码一致
- 没有硬编码端口

### 修复2: 改进端口检查逻辑

当前代码只检查service.json中的端口，需要：
- 检查进程实际占用的所有端口
- 或者从进程中获取实际端口

---

## 📋 **需要检查的服务**

1. **NMT (nmt_m2m100)**
   - service.json端口: 8002
   - 实际端口: 5008
   - 文件: `services/nmt_m2m100/service.json` 和 `nmt_service.py`

2. **faster-whisper-vad**
   - service.json端口: 8001
   - 实际端口: 6007
   - 文件: `services/faster_whisper_vad/service.json` 和 `faster_whisper_vad_service.py`

3. **semantic-repair-zh**
   - 尝试端口: 5013
   - 文件: `services/semantic_repair_zh/service.json` 和 `semantic_repair_zh_service.py`

4. **en-normalize**
   - 尝试端口: 5012
   - 文件: `services/en_normalize/service.json` 和 `en_normalize_service.py`

5. **semantic-repair-en-zh**
   - 尝试端口: 5015
   - 文件: `services/semantic_repair_en_zh/service.json` 和 `service.py`

---

## ⚡ **立即行动**

### Step 1: 强制清理（立即）

```powershell
# 执行完整清理
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
npm start
```

### Step 2: 检查service.json

我会立即检查所有service.json，找出端口不一致的原因。

---

**状态**: ⚠️ **严重** - 端口配置不一致  
**影响**: 所有服务无法正常重启  
**优先级**: 🔴 **最高**
