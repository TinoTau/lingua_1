# 端口硬编码分析与清理方案
**时间**: 2026-01-20 11:10
**目标**: 统一端口配置，消除硬编码

---

## 📖 **问题1：为什么TTS端口错误会导致无法返回结果？**

### 设计意图（正确的行为）

```typescript
// job-pipeline.ts:135-137
if (step === 'ASR' || step === 'TRANSLATION') {
  throw error;  // 关键步骤失败 → 抛出错误
} else {
  // TTS是非关键步骤 → 记录错误但继续
  // 理论上应该返回结果（带空音频）
}
```

```typescript
// tts-stage.ts:171-177
catch (error) {
  logger.error('TTSStage: TTS task failed, returning empty audio');
  return {
    ttsAudio: '',      // ✅ 返回空音频
    ttsFormat: 'opus',
    ttsTimeMs: ...
  };
}
```

**理论行为**：TTS失败 → 返回空音频 → 任务应该完成并返回结果

### 实际问题（旧代码的兼容层）

从日志看到：
```
ResultSender not available, original job result not sent
```

**根本原因**：
1. **旧的NodeAgent代码路径**可能仍在使用
2. **ResultSender没有正确初始化**
3. 导致即使pipeline完成，结果也无法发送回调度服务器

### 为什么会无返回？

**完整链路**：
```
TTS失败 → 返回空音频 → Pipeline完成 → buildJobResult() → 
→ [应该] 通过WebSocket发送给调度器 → 
→ [实际] ResultSender未初始化 → 结果丢失 → 无返回
```

---

## 🔍 **问题2：所有硬编码端口清单**

### 发现的硬编码端口

| 服务 | service.json配置 | Python硬编码 | 状态 |
|------|-----------------|-------------|------|
| piper-tts | 5009 | ~~5005~~ → 5009 | ✅ 已修复 |
| speaker-embedding | ? | 5003 | ⚠️ 需检查 |
| your-tts | ? | 5004 | ⚠️ 需检查 |

### 需要验证的服务

| 服务 | 配置文件 | Python脚本 |
|------|---------|-----------|
| nmt-m2m100 | service.json | nmt_service.py |
| faster-whisper-vad | service.json | faster_whisper_vad_service.py |
| semantic-repair-zh | service.json | semantic_repair_zh_service.py |
| semantic-repair-en-zh | service.json | service.py |

---

## 🧹 **问题3：旧代码清理清单**

### 已发现的旧代码/兼容层

#### 1. **ResultSender未正确初始化**
```typescript
// 问题：旧的NodeAgent可能没有提供ResultSender
// 解决：确保新架构中ResultSender正确注入
```

#### 2. **重复的服务管理器代码**
```
- PythonServiceManager（旧）
- RustServiceManager（旧）
- ServiceProcessRunner（新，统一）
```

#### 3. **旧的端口硬编码**
```python
# 多个服务的default端口硬编码
# 应该：从service.json读取或环境变量
```

---

## ✅ **清理方案**

### **清理1：统一端口配置机制**

#### 目标架构
```
service.json (配置源) 
  ↓
ServiceProcessRunner (读取配置)
  ↓
Python服务 (接收--port参数)
  ↓
实际监听端口
```

#### 实施步骤
1. 修改所有Python服务，从命令行参数读取端口
2. ServiceProcessRunner传递--port参数
3. 移除所有硬编码的default值

### **清理2：删除旧的服务管理器**

#### 要删除的文件
```
main/src/python-service-manager/  （整个目录）
main/src/rust-service-manager/    （整个目录）
```

#### 保留的文件
```
main/src/service-layer/
  ├── ServiceRegistry.ts          ✅ 保留
  ├── ServiceProcessRunner.ts     ✅ 保留
  ├── ServiceDiscovery.ts          ✅ 保留
  └── service-ipc-handlers.ts     ✅ 保留
```

### **清理3：修复ResultSender初始化**

#### 问题代码
```typescript
// 旧代码可能在某些分支中没有初始化ResultSender
services.resultSender = undefined;  // ❌
```

#### 修复代码
```typescript
// 确保ResultSender在新架构中正确初始化
const resultSender = new ResultSender(managers.nodeAgent);
services.resultSender = resultSender;  // ✅
```

---

## 🚨 **当前紧急问题：Rust工具链损坏**

### 错误原因
```
error[E0786]: found invalid metadata files for crate `core`
= note: 页面文件太小，无法完成操作。 (os error 1455)
```

**根本原因**：
1. Windows虚拟内存不足
2. Rust标准库元数据文件损坏
3. 可能是磁盘空间不足或内存不足

### 解决方案

#### **方案1：重新安装Rust工具链（推荐）**
```powershell
rustup self update
rustup update stable
rustup toolchain uninstall stable-x86_64-pc-windows-msvc
rustup toolchain install stable-x86_64-pc-windows-msvc
```

#### **方案2：增加虚拟内存**
```powershell
# Windows设置 → 系统 → 关于 → 高级系统设置
# → 性能设置 → 高级 → 虚拟内存 → 更改
# 建议设置为物理内存的1.5-2倍
```

#### **方案3：清理并重试**
```powershell
cd d:\Programs\github\lingua_1\central_server\scheduler
cargo clean
cargo build --release
```

---

## 📋 **完整清理计划**

### Phase 1: 修复紧急问题（当前）
- [x] 修复piper-tts端口（5005 → 5009）
- [ ] 修复Rust工具链
- [ ] 验证编译通过

### Phase 2: 统一端口配置
- [ ] 检查所有服务的端口配置
- [ ] 修复speaker-embedding端口
- [ ] 修复your-tts端口
- [ ] 修改ServiceProcessRunner传递端口参数

### Phase 3: 删除旧代码
- [ ] 删除python-service-manager/
- [ ] 删除rust-service-manager/
- [ ] 清理未使用的import
- [ ] 更新文档

### Phase 4: 修复ResultSender
- [ ] 确保ResultSender正确初始化
- [ ] 验证任务结果能正确返回
- [ ] 集成测试通过

---

## 🎯 **立即行动**

### **Step 1: 修复Rust工具链**
```powershell
rustup update stable
```

### **Step 2: 重新编译调度服务器**
```powershell
cd d:\Programs\github\lingua_1\central_server\scheduler
cargo clean
cargo build --release
```

### **Step 3: 如果还失败，重装工具链**
```powershell
rustup toolchain uninstall stable-x86_64-pc-windows-msvc
rustup toolchain install stable-x86_64-pc-windows-msvc
```

---

**优先级**: 🔴 最高 - Rust工具链问题必须先解决  
**预计时间**: 5-15分钟（取决于网络速度）
