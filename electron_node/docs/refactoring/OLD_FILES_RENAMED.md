# 旧架构文件重命名清单

## 重命名时间
**日期**: 2026-01-20  
**保留期限**: 2026-02-03（2周后可删除）

---

## 已重命名的文件

### 1. 应用初始化
- ✅ `app/app-init.ts` → `app/app-init.ts.old`
  - 复杂的服务初始化逻辑
  - 使用 ServiceRegistryManager
  - 使用 SemanticRepairServiceManager

### 2. NodeAgent
- ✅ `agent/node-agent.ts` → `agent/node-agent.ts.old`
  - 复杂的 NodeAgent 实现
  - 依赖多个服务管理器

### 3. 服务处理器
- ✅ `agent/node-agent-services.ts` → `agent/node-agent-services.ts.old`
  - 复杂的服务列表收集逻辑
  - 硬编码的服务类型映射
  - 多处重复的状态检查

- ✅ `agent/node-agent-services-semantic-repair.ts` → `agent/node-agent-services-semantic-repair.ts.old`
  - 专门的语义修复服务发现模块
  - 已被统一的服务发现替代

### 4. IPC 处理器
- ✅ `ipc-handlers/service-handlers.ts` → `ipc-handlers/service-handlers.ts.old`
  - 复杂的 IPC 处理逻辑
  - 包含缓存管理
  - 包含下载/卸载逻辑

### 5. 入口文件备份
- ✅ `index.ts.backup`
  - 原始主入口文件的备份
  - 可用于回退

---

## 新架构文件

### 核心模块
- ✅ `service-layer/ServiceTypes.ts` - 类型定义
- ✅ `service-layer/ServiceDiscovery.ts` - 服务发现
- ✅ `service-layer/NodeServiceSupervisor.ts` - 服务管理
- ✅ `service-layer/service-ipc-handlers.ts` - IPC 处理
- ✅ `service-layer/index.ts` - 入口文件

### 简化的 NodeAgent
- ✅ `agent/node-agent-simple.ts` - 简化的 NodeAgent
- ✅ `agent/node-agent-services-simple.ts` - 简化的服务处理器

### 应用初始化
- ✅ `app/app-init-simple.ts` - 简化的初始化逻辑

### 主入口
- ✅ `index.ts` - 使用新架构的主入口文件

---

## 不需要重命名的文件

以下文件在新旧架构中都使用，保持不变：

### 保留的模块
- `agent/node-agent-heartbeat.ts` - 心跳处理（新架构复用）
- `agent/node-agent-registration.ts` - 注册处理（新架构复用）
- `agent/node-agent-hardware.ts` - 硬件信息（新架构复用）
- `agent/node-agent-job-processor.ts` - 任务处理（新架构复用）
- `agent/node-agent-result-sender.ts` - 结果发送（新架构复用）

### 其他管理器
- `rust-service-manager/` - Rust 服务管理（特定服务，保留）
- `python-service-manager/` - Python 服务管理（特定服务，保留）
- `model-manager/` - 模型管理（独立模块，保留）
- `inference/` - 推理服务（独立模块，保留）

### 服务注册表相关（待处理）
- `service-registry/` - 旧的注册表管理器
  - **状态**: 暂时保留
  - **原因**: 某些地方可能还在使用
  - **计划**: 1-2 周后检查依赖，确认可删除

- `semantic-repair-service-manager/` - 语义修复服务管理器
  - **状态**: 暂时保留
  - **原因**: 某些地方可能还在使用
  - **计划**: 1-2 周后检查依赖，确认可删除

---

## 删除计划

### 第 1 周（2026-01-20 - 2026-01-27）
- ✅ 重命名旧文件为 `.old`
- ⏳ 测试新架构
- ⏳ 监控问题和错误
- ⏳ 确认所有功能正常

### 第 2 周（2026-01-27 - 2026-02-03）
- ⏳ 确认没有回退需求
- ⏳ 检查是否有其他模块依赖旧文件
- ⏳ 准备最终删除

### 第 3 周（2026-02-03 后）
- ⏳ 删除所有 `.old` 文件
- ⏳ 删除或重命名 `service-registry/`
- ⏳ 删除或重命名 `semantic-repair-service-manager/`
- ⏳ 更新所有 import 语句

---

## 回退步骤（如果需要）

如果新架构出现严重问题，可以按以下步骤回退：

1. **恢复主入口**
   ```bash
   cd electron_node/electron-node/main/src
   mv index.ts index.ts.new
   mv index.ts.backup index.ts
   ```

2. **恢复旧文件**
   ```bash
   mv app/app-init.ts.old app/app-init.ts
   mv agent/node-agent.ts.old agent/node-agent.ts
   mv agent/node-agent-services.ts.old agent/node-agent-services.ts
   mv agent/node-agent-services-semantic-repair.ts.old agent/node-agent-services-semantic-repair.ts
   mv ipc-handlers/service-handlers.ts.old ipc-handlers/service-handlers.ts
   ```

3. **重启应用**
   ```bash
   npm run dev
   ```

4. **验证功能**
   - 检查服务列表
   - 测试服务启动/停止
   - 测试心跳上报

---

## 代码行数对比

| 模块 | 旧架构（已重命名） | 新架构 | 减少 |
|------|-------------------|-------|-----|
| app-init | ~430 行 | ~310 行 | 28% |
| node-agent | ~455 行 | ~280 行 | 38% |
| node-agent-services | ~329 行 | ~150 行 | 54% |
| node-agent-services-semantic-repair | ~105 行 | 整合到 services-simple | 100% |
| service-handlers | ~366 行 | ~150 行 | 59% |
| **总计** | ~1685 行 | ~890 行 | **47%** |

---

## 检查清单

在删除 `.old` 文件之前，请确认：

- [ ] 新架构运行正常（至少 1 周无严重问题）
- [ ] 所有服务都能正常启动/停止
- [ ] 心跳消息正确上报
- [ ] UI 功能完整
- [ ] 性能符合预期
- [ ] 没有内存泄漏
- [ ] 日志中无严重错误
- [ ] 用户反馈正面

---

## 联系人

如有问题，请联系：
- **技术负责人**: AI Assistant
- **文档维护**: AI Assistant
- **测试验证**: 开发团队

---

**创建时间**: 2026-01-20  
**下次检查**: 2026-01-27  
**计划删除**: 2026-02-03
