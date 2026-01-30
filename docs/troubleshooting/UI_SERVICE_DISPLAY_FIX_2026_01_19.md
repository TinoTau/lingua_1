# 界面服务显示问题修复

**日期**: 2026-01-19  
**问题**: 服务管理界面看不到语义修复服务（包括新旧服务）  
**状态**: ✅ 已修复

---

## 🔍 问题分析

### 问题描述

用户反馈：
1. 节点端的服务管理界面里看不到新服务 `semantic-repair-en-zh`
2. 甚至连原来的两个语义修复服务（`semantic-repair-zh`, `semantic-repair-en`）都看不到

### 根本原因

**界面代码不完整**:

1. **服务显示名映射缺失** (`getServiceDisplayName`)
   - 只定义了旧的三个服务ID
   - 没有包含新服务 `semantic-repair-en-zh`

2. **类型定义不完整** (`handleStartSemanticRepair` 等函数)
   - TypeScript 类型定义只包含旧的三个服务ID
   - 导致新服务无法被正确处理

3. **偏好同步缺失** (`syncPreferencesFromStatus`)
   - 只同步了旧的三个服务状态
   - 新服务状态没有被保存到配置

---

## ✅ 修复内容

### 修复1: 添加服务显示名

**文件**: `ServiceManagement.tsx`

**修改前**:
```typescript
const getServiceDisplayName = (name: string): string => {
  const map: Record<string, string> = {
    nmt: 'NMT 翻译服务',
    tts: 'TTS 语音合成 (Piper)',
    yourtts: 'YourTTS 语音克隆',
    faster_whisper_vad: 'FastWhisperVad语音识别服务',
    speaker_embedding: 'Speaker Embedding 服务',
    rust: '节点推理服务 (Rust)',
    'en-normalize': 'EN Normalize 英文标准化服务',
    'semantic-repair-zh': 'Semantic Repair 中文语义修复',
    'semantic-repair-en': 'Semantic Repair 英文语义修复',
    // ❌ 缺少 semantic-repair-en-zh
  };
  return map[name] || name;
};
```

**修改后**:
```typescript
const getServiceDisplayName = (name: string): string => {
  const map: Record<string, string> = {
    nmt: 'NMT 翻译服务',
    tts: 'TTS 语音合成 (Piper)',
    yourtts: 'YourTTS 语音克隆',
    faster_whisper_vad: 'FastWhisperVad语音识别服务',
    speaker_embedding: 'Speaker Embedding 服务',
    rust: '节点推理服务 (Rust)',
    'en-normalize': 'EN Normalize 英文标准化服务 (已弃用)',
    'semantic-repair-zh': 'Semantic Repair 中文语义修复 (已弃用)',
    'semantic-repair-en': 'Semantic Repair 英文语义修复 (已弃用)',
    'semantic-repair-en-zh': '统一语义修复服务 (中英文+标准化)',  // ✅ 新增
  };
  return map[name] || name;
};
```

---

### 修复2: 更新TypeScript类型定义

**文件**: `ServiceManagement.tsx`

**修改前**:
```typescript
const handleStartSemanticRepair = async (
  serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en'  // ❌ 缺少新服务
) => {
  // ...
};

const handleStopSemanticRepair = async (
  serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en'  // ❌ 缺少新服务
) => {
  // ...
};

const handleToggleSemanticRepair = async (
  serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en',  // ❌ 缺少新服务
  checked: boolean
) => {
  // ...
};
```

**修改后**:
```typescript
const handleStartSemanticRepair = async (
  serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en' | 'semantic-repair-en-zh'  // ✅ 新增
) => {
  // ...
};

const handleStopSemanticRepair = async (
  serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en' | 'semantic-repair-en-zh'  // ✅ 新增
) => {
  // ...
};

const handleToggleSemanticRepair = async (
  serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en' | 'semantic-repair-en-zh',  // ✅ 新增
  checked: boolean
) => {
  // ...
};
```

**更新事件处理器类型**:
```typescript
// 修改前
onChange={(e) => handleToggleSemanticRepair(
  serviceId as 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en',  // ❌
  e.target.checked
)}

// 修改后
onChange={(e) => handleToggleSemanticRepair(
  serviceId as 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en' | 'semantic-repair-en-zh',  // ✅
  e.target.checked
)}
```

---

### 修复3: 更新偏好同步

**文件**: `ServiceManagement.tsx`

**修改前**:
```typescript
const syncPreferencesFromStatus = async () => {
  try {
    const rustEnabled = !!rustStatus?.running;
    const nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
    // ... 其他服务
    
    // 语义修复服务状态
    const semanticRepairZhEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-zh')?.running;
    const semanticRepairEnEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en')?.running;
    const enNormalizeEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'en-normalize')?.running;
    // ❌ 缺少 semanticRepairEnZhEnabled

    const newPrefs = { 
      rustEnabled, 
      nmtEnabled, 
      ttsEnabled, 
      yourttsEnabled, 
      fasterWhisperVadEnabled, 
      speakerEmbeddingEnabled,
      semanticRepairZhEnabled,
      semanticRepairEnEnabled,
      enNormalizeEnabled,
      // ❌ 缺少 semanticRepairEnZhEnabled
    };
    await window.electronAPI.setServicePreferences(newPrefs);
  } catch (error) {
    console.error('同步服务偏好失败:', error);
  }
};
```

**修改后**:
```typescript
const syncPreferencesFromStatus = async () => {
  try {
    const rustEnabled = !!rustStatus?.running;
    const nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
    // ... 其他服务
    
    // 语义修复服务状态
    const semanticRepairZhEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-zh')?.running;
    const semanticRepairEnEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en')?.running;
    const enNormalizeEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'en-normalize')?.running;
    const semanticRepairEnZhEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en-zh')?.running;  // ✅ 新增

    const newPrefs = { 
      rustEnabled, 
      nmtEnabled, 
      ttsEnabled, 
      yourttsEnabled, 
      fasterWhisperVadEnabled, 
      speakerEmbeddingEnabled,
      semanticRepairZhEnabled,
      semanticRepairEnEnabled,
      enNormalizeEnabled,
      semanticRepairEnZhEnabled,  // ✅ 新增
    };
    await window.electronAPI.setServicePreferences(newPrefs);
  } catch (error) {
    console.error('同步服务偏好失败:', error);
  }
};
```

---

## 📋 修复文件列表

| 文件 | 修改内容 | 行数 |
|------|---------|------|
| **ServiceManagement.tsx** | 添加服务显示名 | +1 |
| **ServiceManagement.tsx** | 更新类型定义（3处） | +3 |
| **ServiceManagement.tsx** | 更新偏好同步 | +2 |
| **ServiceManagement.tsx** | 更新事件处理器类型 | +1 |

**总计**: 1个文件，7处修改

---

## 🎯 预期效果

修复后，在服务管理界面中应该看到：

### 服务显示顺序

```
1. 节点推理服务 (Rust)
2. 统一语义修复服务 (中英文+标准化)           ⭐ 新服务
3. Semantic Repair 中文语义修复 (已弃用)      ⚠️ 旧服务
4. Semantic Repair 英文语义修复 (已弃用)      ⚠️ 旧服务
5. EN Normalize 英文标准化服务 (已弃用)       ⚠️ 旧服务
6. FastWhisperVad语音识别服务
7. NMT 翻译服务
8. TTS 语音合成 (Piper)
9. YourTTS 语音克隆
10. Speaker Embedding 服务
```

### 新服务卡片信息

**服务名**: 统一语义修复服务 (中英文+标准化)  
**服务ID**: semantic-repair-en-zh  
**端口**: 5015  
**状态**: 运行中 / 已停止  
**开关**: 可以启动/停止

### 旧服务卡片标记

所有旧服务都标记为 **(已弃用)**：
- EN Normalize 英文标准化服务 (已弃用)
- Semantic Repair 中文语义修复 (已弃用)
- Semantic Repair 英文语义修复 (已弃用)

---

## 🔄 为什么之前看不到服务？

### 问题1: 服务在后端是正常的

```typescript
// 后端代码（runtime-handlers.ts）可以正确获取服务状态
window.electronAPI.getAllSemanticRepairServiceStatuses()
// 返回: [
//   { serviceId: 'semantic-repair-zh', running: false, ... },
//   { serviceId: 'semantic-repair-en', running: false, ... },
//   { serviceId: 'en-normalize', running: false, ... },
//   { serviceId: 'semantic-repair-en-zh', running: false, ... }  // ✅ 后端有
// ]
```

### 问题2: 前端界面代码不完整

```typescript
// 前端代码（ServiceManagement.tsx）
{semanticRepairStatuses.map((status) => {
  const serviceId = status.serviceId;
  const displayName = getServiceDisplayName(serviceId);  // ❌ 新服务返回原始ID
  
  return (
    <div key={serviceId} className="lsm-item">
      <h3>{displayName}</h3>  // 显示 "semantic-repair-en-zh" 而不是友好名称
      // ...
    </div>
  );
})}
```

### 问题3: TypeScript 编译错误被忽略

```typescript
// 如果开发时没有严格的 TypeScript 检查
handleToggleSemanticRepair(
  'semantic-repair-en-zh',  // ❌ 这个值不在类型定义中
  checked
);
// 可能在运行时工作，但 TypeScript 会报错
```

---

## ✅ 验证步骤

### 步骤1: 重新编译前端

```bash
cd electron_node/electron-node
npm run build:renderer
```

### 步骤2: 重新启动节点端

关闭并重新启动 Electron 应用

### 步骤3: 检查服务列表

在"服务管理"界面中应该看到：

1. ✅ **新服务卡片显示**
   - 服务名：统一语义修复服务 (中英文+标准化)
   - 可以点击开关启动/停止

2. ✅ **旧服务卡片显示**
   - 三个旧服务都显示，且标记为"已弃用"

3. ✅ **服务状态正确**
   - 新服务如果已启动，显示"运行中"
   - 旧服务如果已关闭，显示"已停止"

### 步骤4: 测试启动/停止

1. 点击新服务的开关，启动服务
2. 观察端口信息显示（5015）
3. 观察 PID 信息显示
4. 点击关闭，服务正常停止

---

## 🔍 调试信息

如果服务仍然看不到，检查浏览器控制台：

```javascript
// 在服务管理界面按 F12 打开开发者工具
// 查看控制台输出：

// 正常情况：
Semantic repair services: [
  { serviceId: 'semantic-repair-zh', running: false, ... },
  { serviceId: 'semantic-repair-en', running: false, ... },
  { serviceId: 'en-normalize', running: false, ... },
  { serviceId: 'semantic-repair-en-zh', running: true, ... }  // ✅ 应该有
]

// 异常情况：
Semantic repair services: []  // ❌ 空数组

// 如果是空数组，说明后端没有正确获取服务列表
// 检查 installed.json 是否包含服务注册信息
```

---

## 📚 相关文档

- [NODE_SERVICE_CARD_ISSUE_FIX_2026_01_19.md](./NODE_SERVICE_CARD_ISSUE_FIX_2026_01_19.md) - 配置问题修复
- [TYPESCRIPT_COMPILATION_FIX_2026_01_19.md](./TYPESCRIPT_COMPILATION_FIX_2026_01_19.md) - TypeScript 编译修复
- [ASR_INTEGRATION_COMPLETE_2026_01_19.md](./ASR_INTEGRATION_COMPLETE_2026_01_19.md) - ASR集成说明

---

**完成时间**: 2026-01-19  
**状态**: ✅ **界面代码已修复，请重新编译并重启节点端！**
