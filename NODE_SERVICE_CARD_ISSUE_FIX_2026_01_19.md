# 节点端服务卡片显示问题修复

**日期**: 2026-01-19  
**问题**: 新服务不显示 + 旧服务还在自动启动  
**状态**: ✅ 已修复

---

## 🔍 问题诊断

### 问题1: 新服务卡片不显示

**原因**: `installed.json` 中没有新服务的注册记录

```json
// installed.json 缺少这个条目：
{
  "semantic-repair-en-zh": {
    "1.0.0::windows-x64": {
      "service_id": "semantic-repair-en-zh",
      ...
    }
  }
}
```

### 问题2: 旧服务还在自动启动

**原因**: 用户配置文件 `electron-node-config.json` 中保存了旧的启动偏好

```json
// electron-node-config.json 中的旧配置：
{
  "servicePreferences": {
    "semanticRepairZhEnabled": true,  // ❌ 应该是 false
    "semanticRepairEnEnabled": true,  // ❌ 应该是 false
    "enNormalizeEnabled": true,       // ❌ 应该是 false
    "semanticRepairEnZhEnabled": ???  // ❌ 可能不存在或为 false
  }
}
```

---

## ✅ 修复方案

### 修复1: 更新 installed.json ✅

**文件**: `electron_node/services/installed.json`

**操作**: 添加新服务的注册信息

```json
{
  ...
  "semantic-repair-en": { ... },
  "semantic-repair-en-zh": {
    "1.0.0::windows-x64": {
      "service_id": "semantic-repair-en-zh",
      "version": "1.0.0",
      "platform": "windows-x64",
      "installed_at": "2026-01-19T08:00:00.000Z",
      "install_path": "D:/Programs/github/lingua_1/electron_node/services/semantic_repair_en_zh",
      "size_bytes": 4200000000
    }
  }
}
```

**状态**: ✅ 已完成

---

### 修复2: 更新用户配置 ⚠️

**配置文件位置**:
```
%APPDATA%\lingua-electron-node\electron-node-config.json
```

**完整路径示例**:
```
C:\Users\[用户名]\AppData\Roaming\lingua-electron-node\electron-node-config.json
```

#### 方式1: 使用自动修复脚本（推荐）⭐

```powershell
# 运行自动修复脚本
cd electron_node\services\semantic_repair_en_zh
.\fix_config.ps1
```

**脚本功能**:
- ✅ 自动查找配置文件
- ✅ 自动备份原配置
- ✅ 禁用三个旧服务
- ✅ 启用新统一服务
- ✅ 显示修改前后对比

#### 方式2: 手动修改配置文件

1. **打开配置文件**:
   ```powershell
   notepad $env:APPDATA\lingua-electron-node\electron-node-config.json
   ```

2. **修改 `servicePreferences` 部分**:
   ```json
   {
     "servicePreferences": {
       "rustEnabled": true,
       "nmtEnabled": true,
       "ttsEnabled": true,
       "yourttsEnabled": false,
       "fasterWhisperVadEnabled": true,
       "speakerEmbeddingEnabled": false,
       "semanticRepairZhEnabled": false,     // ⭐ 改为 false
       "semanticRepairEnEnabled": false,     // ⭐ 改为 false
       "enNormalizeEnabled": false,          // ⭐ 改为 false
       "semanticRepairEnZhEnabled": true     // ⭐ 改为 true
     }
   }
   ```

3. **保存文件**

4. **重启节点端**

---

## 📋 完整修复步骤

### 步骤1: 更新 installed.json ✅

```powershell
# 已完成，无需手动操作
```

### 步骤2: 运行配置修复脚本

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\semantic_repair_en_zh
.\fix_config.ps1
```

**预期输出**:
```
====================================================================
  Fix Node Configuration - Disable Old Services, Enable New Service
====================================================================

配置文件路径: C:\Users\...\AppData\Roaming\lingua-electron-node\electron-node-config.json

当前配置:
  semanticRepairZhEnabled: True
  semanticRepairEnEnabled: True
  enNormalizeEnabled: True
  semanticRepairEnZhEnabled:

  禁用旧服务: semantic-repair-zh
  禁用旧服务: semantic-repair-en
  禁用旧服务: en-normalize
  启用新服务: semantic-repair-en-zh

保存更新后的配置...
✅ 配置已更新！

更新后的配置:
  semanticRepairZhEnabled: False
  semanticRepairEnEnabled: False
  enNormalizeEnabled: False
  semanticRepairEnZhEnabled: True

📌 请重新启动节点端以应用新配置

====================================================================
  完成！
====================================================================
```

### 步骤3: 重启节点端

**关闭并重新启动 Electron 应用**

### 步骤4: 验证结果

启动后检查：

1. ✅ **新服务卡片显示**
   - 应该看到 "统一语义修复服务（中英文+标准化）" 卡片
   - 端口：5015
   - 状态：可启动

2. ✅ **旧服务卡片状态**
   - "Semantic Repair Service - Chinese" - 标记为已弃用
   - "Semantic Repair Service - English" - 标记为已弃用
   - "EN Normalize Service" - 标记为已弃用
   - 这些服务**不会**自动启动

3. ✅ **日志输出**
   ```
   Service manager initialized, auto-starting services based on user preferences
   autoStartServices: {
     ...
     semanticRepairZh: false,
     semanticRepairEn: false,
     enNormalize: false,
     semanticRepairEnZh: true  ⭐
   }
   ```

---

## 🔍 问题根源分析

### 为什么会出现这个问题？

1. **installed.json 不会自动更新**
   - 这个文件是服务注册表
   - 手动创建新服务时需要手动添加记录
   - 只有通过安装器安装的服务才会自动注册

2. **用户配置持久化**
   - `electron-node-config.json` 会保存用户的服务启动偏好
   - 即使 `service.json` 中设置 `enabled: false`，配置文件中的偏好优先级更高
   - 这是正常的设计，让用户可以覆盖默认配置

3. **配置文件优先级**
   ```
   用户配置 (electron-node-config.json)
      ↓ 覆盖
   服务配置 (service.json)
   ```

---

## 📝 配置文件说明

### installed.json

**作用**: 服务注册表，记录已安装的服务

**位置**: `electron_node/services/installed.json`

**格式**:
```json
{
  "服务ID": {
    "版本::平台": {
      "service_id": "服务ID",
      "version": "版本号",
      "platform": "平台",
      "installed_at": "安装时间",
      "install_path": "安装路径",
      "size_bytes": 大小
    }
  }
}
```

**何时更新**:
- 通过安装器安装服务时 ✅ 自动
- 手动创建服务时 ❌ 需手动添加

---

### electron-node-config.json

**作用**: 用户偏好设置，包括服务自动启动配置

**位置**: `%APPDATA%\lingua-electron-node\electron-node-config.json`

**格式**:
```json
{
  "servicePreferences": {
    "rustEnabled": boolean,
    "nmtEnabled": boolean,
    ...
    "semanticRepairZhEnabled": boolean,
    "semanticRepairEnEnabled": boolean,
    "enNormalizeEnabled": boolean,
    "semanticRepairEnZhEnabled": boolean
  },
  ...其他配置
}
```

**何时更新**:
- 用户在界面中修改服务启动设置时
- 应用关闭时保存当前运行状态
- 手动编辑配置文件

**优先级**: 高于 `service.json` 中的 `enabled` 字段

---

### service.json

**作用**: 服务元数据和默认配置

**位置**: 每个服务目录下的 `service.json`

**格式**:
```json
{
  "service_id": "服务ID",
  "name": "服务名称",
  "enabled": boolean,          // 默认启用状态
  "deprecated": boolean,       // 是否已弃用
  "deprecated_reason": "原因",
  ...
}
```

**优先级**: 低于 `electron-node-config.json` 中的用户偏好

---

## ✅ 验证清单

启动节点端后，检查以下内容：

### 服务显示

- [ ] 看到 "统一语义修复服务（中英文+标准化）" 卡片
- [ ] 新服务端口为 5015
- [ ] 旧服务（semantic-repair-zh/en, en-normalize）标记为 "已弃用"

### 服务启动

- [ ] 新服务（semantic-repair-en-zh）自动启动
- [ ] 旧服务（semantic-repair-zh/en, en-normalize）**不会**自动启动

### 日志验证

- [ ] 启动日志显示 `semanticRepairEnZhEnabled: true`
- [ ] 启动日志显示其他三个旧服务为 `false`
- [ ] 没有尝试启动旧服务的日志

### 功能测试

- [ ] 可以手动启动新服务
- [ ] 新服务的健康检查正常
- [ ] ASR模块可以调用新服务进行修复

---

## 🚀 快速修复命令

```powershell
# 一键修复（从项目根目录执行）
cd electron_node\services\semantic_repair_en_zh
.\fix_config.ps1

# 重启节点端后验证
```

---

## 📚 相关文档

- [ASR_INTEGRATION_COMPLETE_2026_01_19.md](./ASR_INTEGRATION_COMPLETE_2026_01_19.md) - ASR集成说明
- [UNIFIED_SERVICE_COMPLETE_2026_01_19.md](./UNIFIED_SERVICE_COMPLETE_2026_01_19.md) - 服务完整总结
- [README.md](./electron_node/services/semantic_repair_en_zh/README.md) - 新服务文档

---

**完成时间**: 2026-01-19  
**状态**: ✅ **问题已诊断，修复脚本已创建！请运行 fix_config.ps1 并重启节点端**
