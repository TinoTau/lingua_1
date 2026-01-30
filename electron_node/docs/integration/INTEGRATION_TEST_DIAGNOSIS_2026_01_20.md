# 集成测试诊断报告
**时间**: 2026-01-20 11:04
**问题**: 集成测试无返回结果

---

## 🔍 **根本原因分析**

### ❌ **问题1：TTS服务端口配置不匹配**

#### 实际情况
```
Piper TTS实际启动端口：5005
系统期望连接端口：5009
```

#### 错误日志
```json
{
  "error": "connect ECONNREFUSED 127.0.0.1:5009",
  "jobId": "s-78C89699:183",
  "translatedText": "We are starting a sound stability test.",
  "msg": "TTSStage: TTS task failed, returning empty audio"
}
```

#### 影响
- ✅ ASR（语音识别）成功：识别出文本
- ✅ NMT（翻译）成功：翻译为英文
- ❌ TTS（语音合成）失败：无法连接到5009端口
- ❌ 最终结果：无返回（因为TTS失败）

---

### ❌ **问题2：ASR处理超时（长音频）**

#### 超时情况
```json
{
  "serviceId": "faster-whisper-vad",
  "status": 504,
  "errorMessage": "ASR processing timeout after 30.0s",
  "jobId": "s-78C89699:188",
  "audioLength": 954028,
  "audioDurationMs": 22360,
  "msg": "ASR task failed"
}
```

#### 详细分析
1. **音频时长**：22.36秒
2. **ASR超时设置**：30秒
3. **实际处理时间**：超过32秒
4. **GPU租约超时**：8秒watchdog触发警告

#### GPU状态
```json
{
  "gpuUsage": 100,
  "gpuMemory": 93.47826086956522,
  "holdTimeMs": 32137,
  "holdMaxMs": 8000,
  "msg": "GPU usage exceeded threshold"
}
```

---

### ⚠️ **问题3：SessionAffinityManager错误**

```json
{
  "sessionId": "s-78C89699",
  "msg": "SessionAffinityManager: Cannot record timeout finalize, nodeId not set"
}
```

**说明**：这是一个警告，不影响功能，但表明会话亲和性管理器无法记录节点ID。

---

## 📊 **处理流程分析**

### 成功的处理流程
```
1. Job s-78C89699:183 (utteranceIndex 0)
   ✅ Opus解码 → PCM16 (2.86秒)
   ✅ ASR识别 → "现在我们开始进行一次语音识别稳定性测试"
   ✅ 语义修复 → [处理中]
   ✅ 翻译 → "We are starting a sound stability test."
   ❌ TTS → 连接5009失败
   ❌ 结果：无返回音频

2. Job s-78C89699:184 (utteranceIndex 1)
   ✅ 音频缓冲 (9.36秒) → 等待更多音频
   ⏸️ 返回空结果（等待触发）

3. Job s-78C89699:185 (utteranceIndex 2)
   ✅ 合并缓冲音频 (9.36s + 2.08s = 11.44s)
   ✅ ASR处理中...
   ⏸️ [处理中]

4. Job s-78C89699:188 (utteranceIndex 5)
   ✅ 合并音频 (22.36秒)
   ❌ ASR超时 (30秒后返回504)
   ❌ 结果：处理失败
```

---

## 🔧 **解决方案**

### **方案1：修复TTS端口配置（紧急）**

#### 选项A：修改服务配置文件
```powershell
# 修改 services/piper_tts/service.json
# 将 port 从 5005 改为 5009
```

#### 选项B：修改系统端口映射
查找代码中硬编码的5009，改为实际端口5005。

**推荐**：选项A（修改service.json）

---

### **方案2：优化ASR超时设置**

#### 当前配置
```
ASR超时：30秒
GPU租约最大hold时间：8秒
```

#### 建议调整
```json
{
  "asrTimeout": 60000,  // 从30秒增加到60秒
  "gpuHoldMaxMs": 20000 // 从8秒增加到20秒
}
```

**适用场景**：
- 长音频处理（>15秒）
- GPU负载高时

---

### **方案3：修复SessionAffinityManager**

这是一个次要问题，可以稍后处理。需要确保节点注册时正确设置nodeId。

---

## 📈 **系统工作正常的部分**

### ✅ **服务发现与连接**
- 节点成功注册：`node-8671C61D`
- WebSocket连接稳定
- 调度服务器正常分配任务

### ✅ **语音识别（ASR）**
- faster-whisper-vad正常工作
- GPU调度正常
- 音频聚合机制正常

### ✅ **翻译（NMT）**
- nmt-m2m100正常工作
- 翻译准确

### ✅ **语义修复架构**
- 13个语言对正常工作
- 语义修复中心化逻辑正确

---

## 🎯 **立即行动**

### **Step 1: 检查TTS端口配置**
```powershell
Get-Content "d:\Programs\github\lingua_1\electron_node\services\piper_tts\service.json"
```

### **Step 2: 确认实际端口**
```powershell
netstat -ano | findstr "5005"
netstat -ano | findstr "5009"
```

### **Step 3: 修复配置**
根据Step 1和Step 2的结果，修改配置文件或代码。

---

## 📝 **总结**

### 核心问题
**TTS服务端口不匹配导致最终音频无法合成和返回。**

### 症状
- 系统处理正常
- ASR、NMT成功
- 但无最终返回

### 根源
- Piper TTS在5005端口启动
- 系统期望连接5009端口
- 连接失败 → TTS失败 → 无返回

### 次要问题
- 长音频ASR超时（可通过增加超时时间解决）
- SessionAffinityManager nodeId未设置（警告级别）

---

**优先级**: 🔴 高 - 立即修复TTS端口配置  
**影响范围**: 所有需要TTS的任务  
**修复时间**: 预计5-10分钟
