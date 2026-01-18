# 语义修复服务状态总览

**更新日期**: 2026-01-19

---

## 📊 当前服务状态

| 服务ID | 名称 | 端口 | 状态 | 说明 |
|--------|------|------|------|------|
| **semantic-repair-en-zh** | 统一语义修复服务 | 5015 | ✅ **启用** | 推荐使用 |
| semantic-repair-zh | 中文语义修复 | 5013 | ❌ **禁用** | 已废弃 |
| semantic-repair-en | 英文语义修复 | 5011 | ❌ **禁用** | 已废弃 |
| en-normalize | 英文标准化 | 5012 | ❌ **禁用** | 已废弃 |

---

## 🎯 推荐配置

### 默认启动服务

```
✅ semantic-repair-en-zh (端口 5015)
```

### 默认关闭服务

```
❌ semantic-repair-zh (端口 5013)
❌ semantic-repair-en (端口 5011)
❌ en-normalize (端口 5012)
```

---

## 🔌 API 端点快速参考

### 统一服务（端口 5015）

```bash
# 中文语义修复
POST http://localhost:5015/zh/repair

# 英文语义修复
POST http://localhost:5015/en/repair

# 英文标准化
POST http://localhost:5015/en/normalize

# 全局健康检查
GET http://localhost:5015/health

# 中文处理器健康检查
GET http://localhost:5015/zh/health

# 英文处理器健康检查
GET http://localhost:5015/en/health
```

---

## 📝 配置文件位置

| 服务 | service.json 路径 | enabled |
|------|------------------|---------|
| semantic-repair-en-zh | `services/semantic_repair_en_zh/service.json` | ✅ true |
| semantic-repair-zh | `services/semantic_repair_zh/service.json` | ❌ false |
| semantic-repair-en | `services/semantic_repair_en/service.json` | ❌ false |
| en-normalize | `services/en_normalize/service.json` | ❌ false |

---

## 🚀 启动命令

### 通过服务管理器（推荐）

```typescript
// 启动统一服务
await semanticRepairServiceManager.startService('semantic-repair-en-zh');

// 检查状态
const status = semanticRepairServiceManager.getServiceStatus('semantic-repair-en-zh');
console.log(status);
```

### 手动启动（测试用）

```bash
# 统一服务
cd electron_node/services/semantic_repair_en_zh
python service.py

# 旧服务（不推荐）
cd electron_node/services/semantic_repair_zh
python semantic_repair_zh_service.py
```

---

## 🔍 服务特性对比

| 特性 | 统一服务 | 旧服务 |
|------|---------|--------|
| **中文修复** | ✅ 支持 | ✅ 支持 |
| **英文修复** | ✅ 支持 | ✅ 支持 |
| **英文标准化** | ✅ 支持 | ✅ 支持 |
| **路径隔离** | ✅ 是 | ❌ 否 |
| **零 if-else** | ✅ 是 | ❌ 否 |
| **并发安全** | ✅ 是 | ⚠️ 部分 |
| **超时控制** | ✅ 是 | ❌ 否 |
| **统一日志** | ✅ 是 | ❌ 否 |
| **Request ID** | ✅ 自动生成 | ⚠️ 部分 |
| **单元测试** | ✅ 15个测试 | ❌ 无 |

---

## 📈 资源占用对比

| 指标 | 统一服务 | 旧服务（全部） |
|------|---------|--------------|
| **进程数** | 1 | 3 |
| **端口数** | 1 | 3 |
| **GPU内存** | ~2GB | ~6GB (峰值) |
| **启动时间** | ~30秒 | ~90秒 (并行) |

---

## 🛠️ 配置修改说明

### 已添加的配置字段

#### 旧服务（semantic-repair-zh, semantic-repair-en, en-normalize）

```json
{
  "enabled": false,           // 默认不启动
  "deprecated": true,         // 标记为已废弃
  "deprecated_reason": "Use semantic-repair-en-zh unified service instead"
}
```

#### 新服务（semantic-repair-en-zh）

```json
{
  "enabled": true,            // 默认启动
  "replaces": [               // 替代的旧服务列表
    "semantic-repair-zh",
    "semantic-repair-en",
    "en-normalize"
  ]
}
```

---

## 📚 相关文档

- [迁移指南](./SERVICE_MIGRATION_GUIDE.md) - 完整的迁移步骤和API对照
- [统一服务 README](./semantic_repair_en_zh/README.md) - 使用文档
- [部署检查清单](./semantic_repair_en_zh/DEPLOYMENT_CHECKLIST.md) - 测试步骤

---

## ⚡ 快速操作

### 启动推荐配置

```typescript
// 只启动统一服务
await semanticRepairServiceManager.startService('semantic-repair-en-zh');
```

### 临时使用旧服务（不推荐）

```typescript
// 手动启动特定的旧服务
await semanticRepairServiceManager.startService('semantic-repair-zh');
```

### 切换回旧服务（紧急情况）

```typescript
// 1. 停止统一服务
await semanticRepairServiceManager.stopService('semantic-repair-en-zh');

// 2. 启动旧服务
await semanticRepairServiceManager.startService('semantic-repair-zh');
await semanticRepairServiceManager.startService('semantic-repair-en');
await semanticRepairServiceManager.startService('en-normalize');
```

---

**状态**: ✅ 配置生效  
**推荐**: 使用统一服务 `semantic-repair-en-zh`  
**维护**: 旧服务保留但默认关闭
