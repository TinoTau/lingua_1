---
status: HISTORICAL
historical_baseline: pre-FW_V4
reason: Dated troubleshooting incident report; paths may refer to repository state at that date.
classified_by: 2026-08-04_Documentation_Governance_Residual_Backlog_Closure
---

> Historical document; paths may refer to repository state at that date.

# 服务配置更新完成

**日期**: 2026-01-19  
**类型**: 服务默认状态配置更新

---

## ✅ 更新内容

### 1. 旧服务设置为默认关闭

已为以下服务添加 `enabled: false` 配置：

- ❌ **semantic-repair-zh** (端口 5013) - 中文语义修复
- ❌ **semantic-repair-en** (端口 5011) - 英文语义修复  
- ❌ **en-normalize** (端口 5012) - 英文标准化

配置示例：
```json
{
  "service_id": "semantic-repair-zh",
  "enabled": false,
  "deprecated": true,
  "deprecated_reason": "Use semantic-repair-en-zh unified service instead",
  ...
}
```

### 2. 新服务设置为默认启用

已为统一服务添加 `enabled: true` 配置：

- ✅ **semantic-repair-en-zh** (端口 5015) - 统一语义修复服务

配置示例：
```json
{
  "service_id": "semantic-repair-en-zh",
  "enabled": true,
  "replaces": ["semantic-repair-zh", "semantic-repair-en", "en-normalize"],
  ...
}
```

---

## 📊 配置对比

| 服务 | 端口 | 旧配置 | 新配置 | 说明 |
|------|------|--------|--------|------|
| semantic-repair-zh | 5013 | （无配置） | `enabled: false` | 默认关闭 |
| semantic-repair-en | 5011 | （无配置） | `enabled: false` | 默认关闭 |
| en-normalize | 5012 | （无配置） | `enabled: false` | 默认关闭 |
| **semantic-repair-en-zh** | 5015 | （无配置） | `enabled: true` | **默认启用** |

---

## 🎯 影响范围

### 新部署

- 系统将默认启动 `semantic-repair-en-zh`
- 旧的3个服务默认不启动
- 需要使用旧服务时可手动启动

### 现有部署

- 已运行的服务不受影响（继续运行）
- 重启服务管理器后生效新配置
- 可以手动切换到新服务

---

## 🔧 修改的文件

1. ✅ `electron_node/services/semantic_repair_zh/service.json`
   - 添加 `enabled: false`
   - 添加 `deprecated: true`
   - 添加 `deprecated_reason`

2. ✅ `electron_node/services/semantic_repair_en/service.json`
   - 添加 `enabled: false`
   - 添加 `deprecated: true`
   - 添加 `deprecated_reason`

3. ✅ `electron_node/services/en_normalize/service.json`
   - 添加 `enabled: false`
   - 添加 `deprecated: true`
   - 添加 `deprecated_reason`

4. ✅ `electron_node/services/semantic_repair_en_zh/service.json`
   - 添加 `enabled: true`
   - 添加 `replaces` 字段

---

## 📚 新增文档

1. ✅ `electron_node/services/SERVICE_MIGRATION_GUIDE.md`
   - 完整的迁移指南
   - API 对照表
   - 迁移步骤

2. ✅ `electron_node/services/SERVICES_STATUS.md`
   - 服务状态总览
   - 快速参考
   - 配置说明

3. ✅ `SERVICE_CONFIG_UPDATE_2026_01_19.md`
   - 本更新说明文档

---

## 🚀 使用建议

### 推荐方式（新部署）

```typescript
// 只启动统一服务
await semanticRepairServiceManager.startService('semantic-repair-en-zh');
```

**API 调用**:
```bash
# 中文修复
POST http://localhost:5015/zh/repair

# 英文修复
POST http://localhost:5015/en/repair

# 英文标准化
POST http://localhost:5015/en/normalize
```

### 兼容方式（过渡期）

如果需要临时使用旧服务，可以手动启动：

```typescript
// 手动启动旧服务（enabled: false 不影响手动启动）
await semanticRepairServiceManager.startService('semantic-repair-zh');
```

---

## 🔍 配置字段说明

### `enabled` (boolean)
- **作用**: 控制服务是否默认启用
- **true**: 系统自动启动（推荐使用）
- **false**: 系统不自动启动（需手动启动）

### `deprecated` (boolean)
- **作用**: 标记服务是否已废弃
- **true**: 不推荐使用，有替代方案
- **false**: 正常维护中

### `deprecated_reason` (string)
- **作用**: 说明废弃原因和替代方案
- **示例**: "Use semantic-repair-en-zh unified service instead"

### `replaces` (array)
- **作用**: 列出被替代的旧服务
- **示例**: ["semantic-repair-zh", "semantic-repair-en", "en-normalize"]

---

## 📋 验证步骤

### 1. 检查配置文件

```bash
# 检查旧服务配置
cat electron_node/services/semantic_repair_zh/service.json | grep enabled
# 应输出: "enabled": false

# 检查新服务配置
cat electron_node/services/semantic_repair_en_zh/service.json | grep enabled
# 应输出: "enabled": true
```

### 2. 测试服务启动

```typescript
// 测试新服务启动
await semanticRepairServiceManager.startService('semantic-repair-en-zh');

// 验证状态
const status = semanticRepairServiceManager.getServiceStatus('semantic-repair-en-zh');
console.log('Running:', status.running); // 应为 true
console.log('Port:', status.port);       // 应为 5015
```

### 3. 测试 API 功能

```bash
# 健康检查
curl http://localhost:5015/health

# 测试中文修复
curl -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test","session_id":"s1","text_in":"你号"}'
```

---

## 🎓 相关资源

### 文档链接

- [服务迁移指南](./electron_node/services/SERVICE_MIGRATION_GUIDE.md) - 详细迁移步骤
- [服务状态总览](./electron_node/services/SERVICES_STATUS.md) - 快速参考
- [统一服务文档](./electron_node/services/semantic_repair_en_zh/README.md) - 完整使用文档
- [部署检查清单](./electron_node/services/semantic_repair_en_zh/DEPLOYMENT_CHECKLIST.md) - 测试步骤

### 设计文档

- [设计方案](./docs/architecture/SEMANTIC_REPAIR_SERVICE_UNIFICATION_DESIGN.md)
- [实施总结](./docs/architecture/UNIFIED_SEMANTIC_REPAIR_IMPLEMENTATION_SUMMARY.md)
- [审阅和任务](./docs/architecture/UNIFIED_SEMANTIC_REPAIR_REVIEW_AND_TASKLIST.md)

---

## ✅ 完成确认

- [x] 4个 service.json 文件已更新
- [x] 配置字段已添加
- [x] 文档已创建
- [x] 迁移指南已完成
- [x] 状态总览已完成

---

## 🔄 回滚方案

如果需要恢复到之前的配置：

1. **修改 service.json**
   ```json
   // 将旧服务的 enabled 改为 true
   {
     "enabled": true,
     "deprecated": false
   }
   
   // 将新服务的 enabled 改为 false
   {
     "enabled": false
   }
   ```

2. **重启服务管理器**
   - 新配置会在重启后生效

---

**状态**: ✅ **配置更新完成**  
**生效**: 重启服务管理器后生效  
**影响**: 默认启动的服务列表变更  
**兼容**: 完全向后兼容（可手动启动旧服务）

---

**更新人**: AI Assistant  
**审核人**: ___________  
**生效日期**: ___________
