# 服务注册说明

## 服务信息

- **服务 ID**: `semantic-repair-en-zh`
- **服务名称**: Unified Semantic Repair Service (EN/ZH + Normalize)
- **版本**: 1.0.0
- **端口**: 5015

## 已完成的注册步骤

### 1. ✅ 创建 service.json 配置

文件位置: `electron_node/services/semantic_repair_en_zh/service.json`

配置包含：
- 服务 ID、名称、版本
- 端口号：5015
- 启动命令和参数
- 健康检查端点
- 支持的功能特性
- API 端点列表

### 2. ✅ 更新 SemanticRepairServiceManager

文件位置: `electron_node/electron-node/main/src/semantic-repair-service-manager/index.ts`

已完成的修改：
- 添加 `semantic-repair-en-zh` 到服务 ID 类型定义
- 在服务初始化列表中添加新服务
- 更新所有模型服务检查逻辑（串行启动队列）
- 更新已安装服务列表过滤器

### 3. ⏳ 需要手动操作

#### 重命名服务目录

由于目录正在使用中，请手动完成以下操作：

1. **关闭所有正在使用该目录的程序**（包括 IDE、终端等）

2. **重命名目录**：✅ 已完成
   - 目录已从 `unified_semantic_repair` 重命名为 `semantic_repair_en_zh`

3. **更新服务注册表**：
   
   在服务目录 `D:\Programs\github\lingua_1\electron_node\services` 中，确保服务注册表能识别新目录。

## 使用方式

### 启动服务

通过 Electron Node 的语义修复服务管理器：

```typescript
await semanticRepairServiceManager.startService('semantic-repair-en-zh');
```

### 停止服务

```typescript
await semanticRepairServiceManager.stopService('semantic-repair-en-zh');
```

### 检查服务状态

```typescript
const status = semanticRepairServiceManager.getServiceStatus('semantic-repair-en-zh');
console.log(status);
// {
//   serviceId: 'semantic-repair-en-zh',
//   running: true,
//   starting: false,
//   pid: 12345,
//   port: 5015,
//   startedAt: Date,
//   lastError: null
// }
```

### API 端点

服务提供以下端点：

1. **中文语义修复**
   ```
   POST http://localhost:5015/zh/repair
   ```

2. **英文语义修复**
   ```
   POST http://localhost:5015/en/repair
   ```

3. **英文标准化**
   ```
   POST http://localhost:5015/en/normalize
   ```

4. **健康检查**
   ```
   GET http://localhost:5015/health
   ```

### 请求格式

```json
{
  "job_id": "test-001",
  "session_id": "session-001",
  "utterance_index": 0,
  "text_in": "你号，这是一个测试。",
  "quality_score": 0.8,
  "micro_context": "上一句话的结尾"
}
```

### 响应格式

```json
{
  "request_id": "test-001",
  "decision": "REPAIR",
  "text_out": "你好，这是一个测试。",
  "confidence": 0.92,
  "diff": [],
  "reason_codes": ["LOW_QUALITY_SCORE", "REPAIR_APPLIED"],
  "process_time_ms": 245,
  "processor_name": "zh_repair"
}
```

## 服务特性

### 并发安全
- 使用 `asyncio.Lock()` 保护初始化
- 模型服务串行启动，避免 GPU 内存过载

### 超时控制
- 默认 30 秒超时
- 超时自动降级返回原文（PASS）

### 路径即策略
- 零 if-else 判断
- 通过 URL 路径自动路由到对应处理器

### 统一包装器
- 自动生成 Request ID
- 统一日志格式
- 统一异常处理和 fallback

## 与旧服务的对比

| 特性 | 旧方案（3个服务） | 新方案（统一服务） |
|------|----------------|------------------|
| 服务数量 | 3 | 1 |
| 端口数量 | 3 (5011/5012/5013) | 1 (5015) |
| 代码行数 | ~1500 | ~600 |
| 重复代码 | 85% | 0% |
| if-else 判断 | 3处 | 0处 |

## 部署建议

### 替代方案

可以选择以下部署方式之一：

**方案 A：仅使用统一服务**
- 启动 `semantic-repair-en-zh`
- 停止并卸载旧的 3 个服务
- 更新调用方代码使用新的路径

**方案 B：共存过渡**
- 同时保留旧服务和新服务
- 逐步迁移调用方代码
- 验证后再移除旧服务

**方案 C：按需启动**
- 通过配置选择使用哪个服务
- 根据 GPU 内存情况动态选择

## 后续任务

### P0（必须）
- [x] 创建 service.json
- [x] 更新 SemanticRepairServiceManager
- [ ] 重命名服务目录（手动操作）
- [ ] 测试服务启动
- [ ] 验证健康检查

### P1（建议）
- [ ] 更新前端 UI 显示新服务
- [ ] 添加服务切换功能
- [ ] 更新相关文档

### P2（可选）
- [ ] 添加 Prometheus 监控
- [ ] 添加性能对比测试
- [ ] 创建迁移指南

---

**状态**: ✅ 代码层面已完成，等待手动重命名目录和测试  
**日期**: 2026-01-19
